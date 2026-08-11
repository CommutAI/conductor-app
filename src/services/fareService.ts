/**
 * Fare Service — Unified fare validation and scan processing
 * Combines fareValidationApi.ts and scanProcessor.ts functionality
 */

import { supabase } from '../supabaseClient';

// ── Types ─────────────────────────────────────────────────────────────────────

export type PassengerType = 'regular' | 'student' | 'senior_citizen' | 'pwd';

export interface Route {
  id: string;
  terminal: string;
  destination: string;
  fare: number;
  distance_km?: number;
  estimated_time_minutes?: number;
}

export interface QRCard {
  id: string;
  card_uid: string;
  contact_number?: string;
  balance: number;
  status: 'active' | 'lost' | 'replaced' | 'deactivated';
  allowed_routes: string[];
  passenger_id?: string;
  passenger_type: PassengerType;
  destination?: string;
  route_id?: string;
  issued_by?: string;
  created_at: string;
}

export interface BaggageFee {
  id: string;
  category: string;
  max_weight_kg: number;
  fee: number;
  remarks?: string;
}

export interface BaggageSelection {
  category: string;
  fee: number;
  weight: number;
}

export interface FareCalculationResult {
  baseFare: number;
  discountPercentage: number;
  discountAmount: number;
  finalFare: number;
  passengerType: PassengerType;
  baggageFee?: number;
  totalFare?: number;
}

export type ScanResult =
  | { status: 'qr_pass'; newBalance: number; fare: number; baggageFee?: number; totalFare?: number; passengerId?: string; destination?: string }
  | { status: 'qr_fail_balance'; balance: number; fare: number; baggageFee?: number; totalFare?: number }
  | { status: 'qr_inactive' }
  | { status: 'qr_wrong_trip'; expectedRoute: string }
  | { status: 'qr_fake'; reason: string }
  | { status: 'ticket_validated'; fareAmount: number; baggageFee?: number; totalFare?: number; passengerId?: string; destination?: string }
  | { status: 'ticket_already_used' }
  | { status: 'ticket_expired' }
  | { status: 'ticket_wrong_trip'; expectedRoute: string }
  | { status: 'duplicate_scan'; type: 'qr_card' | 'temp_ticket'; uid: string }
  | { status: 'not_found' }
  | { status: 'error'; message: string };

// ── Constants ─────────────────────────────────────────────────────────────────

const DEFAULT_FARE = 12;

// ── Helper Functions ──────────────────────────────────────────────────────────

function normalizeQrCode(scannedUid: string): string {
  return scannedUid
    .replace(/[\u2013\u2014\u2015\u2212\uFF0D]/g, '-'); // en dash, em dash, horizontal bar, minus sign, fullwidth hyphen-minus
}

function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371e3; // Earth's radius in meters
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;

  const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

function normalizeRoute(route: string): string {
  return route.trim().toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ');
}

// ── Fare Calculation ─────────────────────────────────────────────────────────

export function calculateFare(baseFare: number, passengerType: PassengerType, baggageSelection?: BaggageSelection): FareCalculationResult {
  const discountPercentage = getDiscountPercentage(passengerType);
  const discountAmount = baseFare * discountPercentage;
  const finalFare = baseFare - discountAmount;
  
  const baggageFee = baggageSelection?.fee || 0;
  const totalFare = finalFare + baggageFee;

  return {
    baseFare,
    discountPercentage,
    discountAmount,
    finalFare,
    passengerType,
    baggageFee,
    totalFare
  };
}

function getDiscountPercentage(passengerType: PassengerType): number {
  switch (passengerType) {
    case 'student':
    case 'senior_citizen':
    case 'pwd':
      return 0.20; // 20% discount
    case 'regular':
    default:
      return 0; // No discount
  }
}

// ── Scan Processing ───────────────────────────────────────────────────────────

export async function processScan(
  scannedUid: string,
  tripId: string,
  conductorId: string,
  busRoute?: string,
  scanType: 'onboarding' | 'alighting' = 'onboarding',
  currentDestination?: string,
  baggageFee?: number
): Promise<ScanResult> {
  const normalizedUid = normalizeQrCode(scannedUid);

  // Check for QR card
  const { data: card } = await supabase
    .from('qr_cards')
    .select('id, balance, status, passenger_id, allowed_routes, destination')
    .eq('card_uid', normalizedUid)
    .maybeSingle();

  if (card) {
    return processQRCard(card, scannedUid, tripId, conductorId, busRoute, scanType, currentDestination, baggageFee);
  }

  // Check for temporary ticket
  const { data: ticket } = await supabase
    .from('temporary_tickets')
    .select('id, ticket_uid, fare_amount, status, issued_at')
    .eq('ticket_uid', normalizedUid)
    .maybeSingle();

  if (ticket) {
    return processTemporaryTicket(ticket, scannedUid, tripId, conductorId, busRoute);
  }

  return { status: 'not_found' };
}

async function processQRCard(
  card: any,
  scannedUid: string,
  tripId: string,
  conductorId: string,
  busRoute?: string,
  scanType: 'onboarding' | 'alighting' = 'onboarding',
  currentDestination?: string,
  baggageFee?: number
): Promise<ScanResult> {
  // Check for fake QR
  if (!scannedUid || scannedUid.length < 8) {
    return { status: 'qr_fake', reason: 'Invalid QR format' };
  }

  // Check route restrictions
  if (card.allowed_routes && card.allowed_routes.length > 0 && busRoute) {
    const hasRouteRestriction = card.allowed_routes.some((route: string) => !route.startsWith('type:') && route !== 'temporary');
    if (hasRouteRestriction) {
      const normalizedBusRoute = normalizeRoute(busRoute);
      
      const isAllowed = card.allowed_routes.some((allowedRoute: string) => {
        const normalizedAllowed = normalizeRoute(allowedRoute);
        const busWords = normalizedBusRoute.split(' ');
        const allowedWords = normalizedAllowed.split(' ');
        const matchCount = busWords.filter(word => allowedWords.some(aw => aw.includes(word) || word.includes(aw))).length;
        const similarity = matchCount / Math.max(busWords.length, allowedWords.length);
        return similarity >= 0.5;
      });
      
      if (!isAllowed) {
        return { status: 'qr_wrong_trip', expectedRoute: card.allowed_routes.join(', ') };
      }
    }
  }

  // Check for duplicate scans
  const { data: boardedPassenger } = await supabase
    .from('boarded_passengers')
    .select('id, alighted_at')
    .eq('trip_id', tripId)
    .eq('card_id', card.id)
    .maybeSingle();

  if (scanType === 'onboarding') {
    if (boardedPassenger && !boardedPassenger.alighted_at) {
      return { status: 'duplicate_scan', type: 'qr_card', uid: scannedUid };
    }
  } else if (scanType === 'alighting') {
    if (!boardedPassenger) {
      return { status: 'error', message: 'Passenger not boarded on this trip' };
    }
    if (boardedPassenger.alighted_at) {
      return { status: 'duplicate_scan', type: 'qr_card', uid: scannedUid };
    }
    if (currentDestination && card.destination) {
      const normalizedCardDest = card.destination.toLowerCase().trim();
      const normalizedCurrentDest = currentDestination.toLowerCase().trim();
      const isDestinationMatch = normalizedCardDest === normalizedCurrentDest || 
                                 normalizedCardDest.includes(normalizedCurrentDest) ||
                                 normalizedCurrentDest.includes(normalizedCardDest);
      
      if (!isDestinationMatch) {
        await supabase.from('fare_irregularities').insert({
          trip_id: tripId,
          type: 'other',
          description: `Destination mismatch: Card destination ${card.destination} vs alighting stop ${currentDestination}`,
          detected_at: new Date().toISOString(),
        });
        return { status: 'error', message: `Destination mismatch. Card is for: ${card.destination}` };
      }
    }
  }

  if (card.status !== 'active') {
    return { status: 'qr_inactive' };
  }

  const fare = DEFAULT_FARE;
  const totalFare = fare + (baggageFee || 0);

  if (scanType === 'onboarding') {
    const updatePayload: Record<string, unknown> = {};
    if (currentDestination) updatePayload.destination = currentDestination;

    if (Object.keys(updatePayload).length > 0) {
      const { error: updateErr } = await supabase.from('qr_cards').update(updatePayload).eq('id', card.id);
      if (updateErr) {
        return { status: 'error', message: `Failed to update card: ${updateErr.message}` };
      }
    }

    const { error: txErr } = await supabase.from('transactions').insert({
      card_id: card.id,
      trip_id: tripId,
      type: 'boarding',
      amount: 0,
      channel: 'qr_card',
      staff_id: conductorId,
    });
    if (txErr) {
      return { status: 'error', message: `Failed to create boarding transaction: ${txErr.message}` };
    }

    const { error: boardErr } = await supabase.from('boarded_passengers').insert({
      trip_id: tripId,
      card_id: card.id,
      passenger_id: card.passenger_id,
      boarded_at: new Date().toISOString(),
    });
    if (boardErr) {
      return { status: 'error', message: `Failed to record boarding: ${boardErr.message}` };
    }

    return {
      status: 'qr_pass',
      newBalance: card.balance,
      fare: 0,
      baggageFee,
      totalFare: 0,
      passengerId: card.passenger_id,
      destination: currentDestination,
    };
  } else {
    // Alighting - deduct fare
    if (card.balance < totalFare) {
      return { status: 'qr_fail_balance', balance: card.balance, fare: totalFare, baggageFee, totalFare };
    }

    const newBalance = card.balance - totalFare;
    const { error: updateErr } = await supabase.from('qr_cards').update({ balance: newBalance }).eq('id', card.id);
    if (updateErr) {
      return { status: 'error', message: `Failed to update balance: ${updateErr.message}` };
    }

    const { error: txErr } = await supabase.from('transactions').insert({
      card_id: card.id,
      trip_id: tripId,
      type: 'fare_payment',
      amount: totalFare,
      channel: 'qr_card',
      staff_id: conductorId,
    });
    if (txErr) {
      return { status: 'error', message: `Failed to create payment transaction: ${txErr.message}` };
    }

    const { error: alightErr } = await supabase.from('boarded_passengers')
      .update({ alighted_at: new Date().toISOString() })
      .eq('trip_id', tripId)
      .eq('card_id', card.id);
    if (alightErr) {
      return { status: 'error', message: `Failed to record alighting: ${alightErr.message}` };
    }

    return {
      status: 'qr_pass',
      newBalance,
      fare: totalFare,
      baggageFee,
      totalFare,
      passengerId: card.passenger_id,
      destination: currentDestination,
    };
  }
}

async function processTemporaryTicket(
  ticket: any,
  scannedUid: string,
  tripId: string,
  conductorId: string,
  busRoute?: string
): Promise<ScanResult> {
  if (ticket.status !== 'issued') {
    return { status: 'ticket_already_used' };
  }

  const { error: updateErr } = await supabase
    .from('temporary_tickets')
    .update({
      status: 'validated',
      validated_at: new Date().toISOString(),
      trip_id: tripId,
    })
    .eq('id', ticket.id);

  if (updateErr) {
    return { status: 'error', message: `Failed to validate ticket: ${updateErr.message}` };
  }

  const { error: txErr } = await supabase.from('transactions').insert({
    temp_ticket_id: ticket.id,
    trip_id: tripId,
    type: 'fare_validation',
    amount: ticket.fare_amount,
    channel: 'temp_ticket',
    staff_id: conductorId,
  });

  if (txErr) {
    return { status: 'error', message: `Failed to create transaction: ${txErr.message}` };
  }

  return {
    status: 'ticket_validated',
    fareAmount: ticket.fare_amount,
  };
}

// ── API Functions ─────────────────────────────────────────────────────────────

export async function getBaggageFees(): Promise<BaggageFee[]> {
  const { data, error } = await supabase
    .from('baggage_fee_matrix')
    .select('*')
    .order('max_weight_kg', { ascending: true });

  if (error) {
    console.error('Error fetching baggage fees:', error);
    return [];
  }

  return (data || []).map(fee => ({
    id: fee.id,
    category: fee.category,
    max_weight_kg: Number(fee.max_weight_kg),
    fee: Number(fee.fee),
    remarks: fee.remarks
  }));
}

export async function getQRCardByUID(cardUID: string): Promise<QRCard | null> {
  const normalizedUID = normalizeQrCode(cardUID);
  const { data, error } = await supabase
    .from('qr_cards')
    .select('*')
    .eq('card_uid', normalizedUID)
    .single();

  if (error || !data) {
    console.error('Error fetching QR card:', error);
    return null;
  }

  return {
    ...data,
    balance: Number(data.balance),
    passenger_type: data.passenger_type as PassengerType
  };
}

export async function getRouteInfo(terminal: string, destination: string): Promise<Route | null> {
  const { data, error } = await supabase
    .from('routes')
    .select('*')
    .eq('terminal', terminal)
    .eq('destination', destination)
    .single();

  if (error || !data) {
    console.error('Error fetching route:', error);
    return null;
  }

  return {
    id: data.id,
    terminal: data.terminal,
    destination: data.destination,
    fare: Number(data.fare),
    distance_km: data.distance_km ? Number(data.distance_km) : undefined,
    estimated_time_minutes: data.estimated_time_minutes
  };
}
