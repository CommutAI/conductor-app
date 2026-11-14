/**
 * Fare Service — Unified fare validation and scan processing
 * Combines fareValidationApi.ts and scanProcessor.ts functionality
 * Includes caching layer for improved performance
 */

import { supabase } from '../supabaseClient';
import { cache, CacheKeys, CacheTTL } from './cacheService';
import { smsService } from './smsService';
import fareMatrixData from '../data/fareMatrix.json';

export interface FareMatrixEntry {
  id?: string;
  route_from: string;
  route_to: string;
  km_distance: number | null;
  regular_fare: number;
  discounted_fare: number;
}

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
  quantity: number;
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
  | { status: 'qr_pass'; newBalance: number; fare: number; baggageFee?: number; totalFare?: number; passengerId?: string; destination?: string; contactNumber?: string; passengerName?: string; boardingPoint?: string; destinationMismatch?: boolean; expectedDestination?: string }
  | { status: 'qr_fail_balance'; balance: number; fare: number; baggageFee?: number; totalFare?: number }
  | { status: 'qr_inactive' }
  | { status: 'qr_wrong_trip'; expectedRoute: string }
  | { status: 'qr_fake'; reason: string }
  | { status: 'ticket_validated'; fareAmount: number; baggageFee?: number; totalFare?: number; passengerId?: string; destination?: string; contactNumber?: string; passengerName?: string; boardingPoint?: string; destinationMismatch?: boolean; expectedDestination?: string }
  | { status: 'ticket_already_used' }
  | { status: 'ticket_expired' }
  | { status: 'ticket_wrong_trip'; expectedRoute: string }
  | { status: 'duplicate_scan'; type: 'qr_card' | 'temp_ticket'; uid: string }
  | { status: 'not_found' }
  | { status: 'error'; message: string };

// ── Constants ─────────────────────────────────────────────────────────────────

export const DEFAULT_FARE = 12;

// ── Fare Matrix ───────────────────────────────────────────────────────────────
// Dynamic fare matrix synced with public.fare_matrix table in Supabase, with local cache & offline JSON fallback.

const FARE_MATRIX_STORAGE_KEY = 'commutai_fare_matrix_cache';

function loadInitialFareMatrix(): FareMatrixEntry[] {
  try {
    const cached = localStorage.getItem(FARE_MATRIX_STORAGE_KEY);
    if (cached) {
      const parsed = JSON.parse(cached);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
  } catch (e) {
    console.warn('[FareMatrix] Error loading cached fare matrix from localStorage:', e);
  }
  return fareMatrixData as FareMatrixEntry[];
}

let activeFareMatrix: FareMatrixEntry[] = loadInitialFareMatrix();

/**
 * Fetch latest fare matrix from Supabase public.fare_matrix table and cache for offline use.
 */
export async function loadFareMatrixFromDatabase(force = false): Promise<FareMatrixEntry[]> {
  try {
    if (!navigator.onLine && activeFareMatrix.length > 0 && !force) {
      return activeFareMatrix;
    }

    const { data, error } = await supabase
      .from('fare_matrix')
      .select('id, route_from, route_to, km_distance, regular_fare, discounted_fare');

    if (error) {
      console.warn('[FareMatrix] Error loading fare matrix from Supabase:', error);
      return activeFareMatrix;
    }

    if (data && data.length > 0) {
      const parsed: FareMatrixEntry[] = data.map((row: any) => ({
        id: row.id,
        route_from: (row.route_from || '').trim(),
        route_to: (row.route_to || '').trim(),
        km_distance: row.km_distance !== null && row.km_distance !== undefined ? Number(row.km_distance) : null,
        regular_fare: Number(row.regular_fare),
        discounted_fare: Number(row.discounted_fare),
      }));

      activeFareMatrix = parsed;
      try {
        localStorage.setItem(FARE_MATRIX_STORAGE_KEY, JSON.stringify(parsed));
      } catch (storageErr) {
        console.warn('[FareMatrix] Could not save fare matrix to localStorage:', storageErr);
      }
      console.log(`[FareMatrix] Successfully loaded and cached ${parsed.length} fare entries from database`);
      return parsed;
    }
  } catch (err) {
    console.error('[FareMatrix] Unexpected error loading fare matrix:', err);
  }
  return activeFareMatrix;
}

// Initialize live sync if running in browser
if (typeof window !== 'undefined') {
  // Initial background load
  loadFareMatrixFromDatabase().catch(() => {});

  // Realtime subscription to live fare changes in database
  try {
    supabase
      .channel('fare_matrix_live_sync')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'fare_matrix' },
        () => {
          console.log('[FareMatrix] Live update received from Supabase, refreshing fare matrix...');
          loadFareMatrixFromDatabase(true).catch(() => {});
        }
      )
      .subscribe();
  } catch (subErr) {
    console.warn('[FareMatrix] Could not subscribe to realtime fare_matrix changes:', subErr);
  }
}

/**
 * Comprehensive mapping of known stop aliases between UI dropdowns, database spellings, and terminal names.
 */
const STOP_ALIAS_MAP: Record<string, string[]> = {
  'agora terminal': ['agora terminal', 'agora'],
  'agora': ['agora', 'agora terminal'],
  'manolo fortich terminal': ['kalugmanan manolo', 'manolo fortich', 'manolo fortich terminal'],
  'manolo fortich': ['kalugmanan manolo', 'manolo fortich', 'manolo fortich terminal'],
  'kalugmanan manolo': ['kalugmanan manolo', 'manolo fortich', 'manolo fortich terminal'],
  'alae': ['alae manolo', 'ala-e', 'alae'],
  'alae manolo': ['alae manolo', 'ala-e', 'alae'],
  'ala-e': ['ala-e', 'alae manolo', 'alae'],
  'bae upper puerto': ['bae upper puerto', 'ba-e', 'bae'],
  'ba-e': ['ba-e', 'bae upper puerto', 'bae'],
  'bae': ['bae upper puerto', 'ba-e', 'bae'],
  'dicklum': ['dicklum', 'diclum'],
  'diclum': ['diclum', 'dicklum'],
  'lunocan': ['lunocan', 'lonocan'],
  'lonocan': ['lonocan', 'lunocan'],
  'maitum': ['maitum', 'maitom'],
  'maitom': ['maitom', 'maitum'],
  'tablon baloi': ['tablon baloi', 'tablon'],
  'cugman': ['cugman'],
  'gusa': ['gusa'],
  'agusan': ['agusan'],
  'puerto': ['puerto'],
  'mambatangan': ['mambatangan'],
  'balubal': ['balubal'],
  'cawayanon': ['cawayanon'],
  'san miguel': ['san miguel'],
  'tankulan': ['tankulan'],
  'sankanan': ['sankanan'],
  'gaisano cdo': ['gaisano cdo'],
};

function getStopCandidates(stopName: string): string[] {
  const clean = stopName.trim().toLowerCase();
  const aliases = STOP_ALIAS_MAP[clean] || [];
  return Array.from(new Set([clean, ...aliases]));
}

/**
 * Get fare from matrix based on origin and destination stops.
 * Supports:
 * 1. Live database fares with automatic offline cache and JSON bundle fallback.
 * 2. Bidirectional matching (A -> B or B -> A).
 * 3. Stop alias and terminal spelling normalization.
 * 4. Regular vs discounted fare rates.
 */
export function getFareFromMatrix(
  fromStop: string | undefined,
  toStop: string | undefined,
  passengerType: PassengerType = 'regular'
): number | null {
  if (!fromStop || !toStop) {
    console.warn('[FareMatrix] Missing fromStop or toStop');
    return null;
  }

  const fromCandidates = getStopCandidates(fromStop);
  const toCandidates = getStopCandidates(toStop);

  let fareEntry: FareMatrixEntry | undefined;

  // 1. Search in active fare matrix (database-synced / cached)
  for (const f of fromCandidates) {
    for (const t of toCandidates) {
      // Forward direction
      fareEntry = activeFareMatrix.find(
        (item) => item.route_from.toLowerCase() === f && item.route_to.toLowerCase() === t
      );
      if (fareEntry) break;

      // Bidirectional reverse direction
      fareEntry = activeFareMatrix.find(
        (item) => item.route_from.toLowerCase() === t && item.route_to.toLowerCase() === f
      );
      if (fareEntry) break;
    }
    if (fareEntry) break;
  }

  // 2. Fallback to bundled JSON if dynamic matrix had no match
  if (!fareEntry && (fareMatrixData as any[]).length > 0) {
    for (const f of fromCandidates) {
      for (const t of toCandidates) {
        fareEntry = (fareMatrixData as FareMatrixEntry[]).find(
          (item) => item.route_from.toLowerCase() === f && item.route_to.toLowerCase() === t
        );
        if (fareEntry) break;

        fareEntry = (fareMatrixData as FareMatrixEntry[]).find(
          (item) => item.route_from.toLowerCase() === t && item.route_to.toLowerCase() === f
        );
        if (fareEntry) break;
      }
      if (fareEntry) break;
    }
  }

  if (!fareEntry) {
    console.warn(`[FareMatrix] No fare data found for route: ${fromStop} <-> ${toStop}`);
    return null;
  }

  const isDiscounted = passengerType === 'student' || passengerType === 'senior_citizen' || passengerType === 'pwd';
  const fare = isDiscounted ? fareEntry.discounted_fare : fareEntry.regular_fare;
  return typeof fare === 'number' && !isNaN(fare) ? fare : Number(fare) || null;
}

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

export function calculateFare(
  baseFare: number,
  passengerType: PassengerType,
  baggageSelection?: BaggageSelection,
  fromStop?: string | undefined,
  toStop?: string | undefined
): FareCalculationResult {
  // Use fare matrix if both stops are provided
  if (fromStop && toStop) {
    const matrixFare = getFareFromMatrix(fromStop, toStop, passengerType);
    if (matrixFare !== null) {
      const baggageFee = baggageSelection?.fee || 0;
      const totalFare = matrixFare + baggageFee;

      return {
        baseFare: matrixFare,
        discountPercentage: passengerType === 'regular' ? 0 : 0.20,
        discountAmount: passengerType === 'regular' ? 0 : matrixFare * 0.20,
        finalFare: matrixFare,
        passengerType,
        baggageFee,
        totalFare
      };
    }
  }

  // Fallback to default calculation if matrix lookup fails or stops not provided
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
  baggageFee?: number,
  baggageCategory?: string,
  baggageWeight?: number,
  paymentMethod: 'card' | 'qr_card' | 'cash' | 'gcash' = 'qr_card',
  boardingStop?: string,
): Promise<ScanResult> {
  console.log('[FareService] processScan called with boardingStop:', boardingStop, 'currentDestination:', currentDestination);

  // ── Entry Point Validations ──────────────────────────────────────────────────
  if (!scannedUid || scannedUid.trim().length === 0) {
    return { status: 'qr_fake', reason: 'No QR code provided' };
  }

  if (!tripId || tripId.trim().length === 0) {
    return { status: 'error', message: 'No active trip. Please start a trip first.' };
  }

  if (!conductorId || conductorId.trim().length === 0) {
    return { status: 'error', message: 'Conductor not authenticated. Please log in again.' };
  }

  if (!['onboarding', 'alighting'].includes(scanType)) {
    return { status: 'error', message: 'Invalid scan type' };
  }

  const normalizedUid = normalizeQrCode(scannedUid);

  // Check cache for QR card first
  const cachedCard = cache.get<QRCard>(CacheKeys.card(normalizedUid));
  if (cachedCard) {
    console.log('[FareService] Cache hit for card:', normalizedUid);
    return processQRCard(cachedCard, scannedUid, tripId, conductorId, busRoute, scanType, currentDestination, baggageFee, baggageCategory, baggageWeight, paymentMethod, boardingStop);
  }

  // Check for QR card from database
  const { data: card } = await supabase
    .from('qr_cards')
    .select('id, balance, status, allowed_routes, destination, passenger_type, card_uid, owner_name, contact_number')
    .eq('card_uid', normalizedUid)
    .maybeSingle();

  if (card) {
    // Cache the card data for future lookups
    const cardData = {
      ...card,
      balance: Number(card.balance),
      passenger_type: card.passenger_type as PassengerType,
      owner_name: card.owner_name,
      contact_number: card.contact_number,
    };
    cache.set(CacheKeys.card(normalizedUid), cardData, CacheTTL.MEDIUM);
    return processQRCard(cardData, scannedUid, tripId, conductorId, busRoute, scanType, currentDestination, baggageFee, baggageCategory, baggageWeight, paymentMethod, boardingStop);
  }

  // Check cache for temporary ticket
  const cachedTicket = cache.get<any>(CacheKeys.ticket(normalizedUid));
  if (cachedTicket) {
    console.log('[FareService] Cache hit for ticket:', normalizedUid);
    return processTemporaryTicket(cachedTicket, scannedUid, tripId, conductorId, busRoute, scanType, currentDestination, baggageFee, baggageCategory, baggageWeight, paymentMethod, boardingStop);
  }

  // Check for temporary ticket from database
  const { data: ticket } = await supabase
    .from('temporary_tickets')
    .select('id, ticket_uid, fare_amount, status, destination, passenger_type, issued_at')
    .eq('ticket_uid', normalizedUid)
    .maybeSingle();

  if (ticket) {
    // Cache the ticket data
    cache.set(CacheKeys.ticket(normalizedUid), ticket, CacheTTL.SHORT);
    return processTemporaryTicket(ticket, scannedUid, tripId, conductorId, busRoute, scanType, currentDestination, baggageFee, baggageCategory, baggageWeight, paymentMethod, boardingStop);
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
  baggageFee?: number,
  baggageCategory?: string,
  baggageWeight?: number,
  paymentMethod: 'card' | 'qr_card' | 'cash' | 'gcash' = 'qr_card',
  boardingStop?: string,
): Promise<ScanResult> {
  // ── Basic QR Format Validation ───────────────────────────────────────────────
  if (!scannedUid || scannedUid.length < 8) {
    return { status: 'qr_fake', reason: 'Invalid QR format' };
  }

  // ── Card Status Validation ──────────────────────────────────────────────────
  if (card.status !== 'active') {
    return { status: 'qr_inactive' };
  }

  // ── Route Restriction Validation ─────────────────────────────────────────────
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

  // ── Trip Status Validation ───────────────────────────────────────────────────
  const { data: trip } = await supabase
    .from('trips')
    .select('status, ended_at')
    .eq('id', tripId)
    .single();

  if (!trip) {
    return { status: 'error', message: 'Trip not found' };
  }

  if (trip.status !== 'in_progress') {
    return { status: 'error', message: `Trip is ${trip.status}. Cannot process scan.` };
  }

  // ── Onboarding Validations ───────────────────────────────────────────────────
  if (scanType === 'onboarding') {
    // Validate boarding stop is provided
    if (!boardingStop) {
      return { status: 'error', message: 'Boarding location is required. Please select your current stop.' };
    }

    // Validate destination is provided
    if (!currentDestination) {
      return { status: 'error', message: 'Destination is required. Please select passenger destination.' };
    }

    // Validate payment method
    if (!['card', 'qr_card', 'cash', 'gcash'].includes(paymentMethod)) {
      return { status: 'error', message: 'Invalid payment method selected.' };
    }

    // Validate baggage fee matches category
    if (baggageCategory && baggageFee === undefined) {
      return { status: 'error', message: 'Baggage fee required when baggage category is selected.' };
    }
  }

  // ── Alighting Validations ────────────────────────────────────────────────────
  if (scanType === 'alighting') {
    // Validate destination is provided
    if (!currentDestination) {
      return { status: 'error', message: 'Alighting location is required.' };
    }
  }

  // ── Find Boarded Passenger ─────────────────────────────────────────────────
  const boardedPassengerResult = await supabase
    .from('boarded_passengers')
    .select('id, alighted_at, boarding_stop')
    .eq('trip_id', tripId)
    .eq('card_id', card.id)
    .is('alighted_at', null)
    .order('boarded_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  // If not found by card_id, try by temp_ticket_id (for tickets boarded as cards)
  let boardedPassenger = boardedPassengerResult;
  if (!boardedPassenger.data) {
    boardedPassenger = await supabase
      .from('boarded_passengers')
      .select('id, alighted_at, boarding_stop')
      .eq('trip_id', tripId)
      .eq('temp_ticket_id', card.id)
      .is('alighted_at', null)
      .order('boarded_at', { ascending: false })
      .limit(1)
      .maybeSingle();
  }

  const boardedData = boardedPassenger.data;

  // ── Duplicate Scan Validation (Onboarding) ─────────────────────────────────
  if (scanType === 'onboarding') {
    if (boardedData) {
      return { status: 'duplicate_scan', type: 'qr_card', uid: scannedUid };
    }
  }

  // ── Boarded Check Validation (Alighting) ────────────────────────────────────
  if (scanType === 'alighting') {
    if (!boardedData) {
      return { status: 'error', message: 'Passenger not boarded on this trip' };
    }
  }

  // ── Destination Mismatch Validation (Alighting) ──────────────────────────────
  let destinationMismatchOccurred = false;
  if (scanType === 'alighting' && currentDestination && card.destination) {
    const normalizedCardDest = card.destination.toLowerCase().trim();
    const normalizedCurrentDest = currentDestination.toLowerCase().trim();
    const isDestinationMatch = normalizedCardDest === normalizedCurrentDest ||
                               normalizedCardDest.includes(normalizedCurrentDest) ||
                               normalizedCurrentDest.includes(normalizedCardDest);

    if (!isDestinationMatch) {
      destinationMismatchOccurred = true;
      await supabase.from('fare_irregularities').insert({
        trip_id: tripId,
        conductor_id: conductorId,
        card_uid: card.card_uid,
        passenger_id: boardedData?.id,
        type: 'other',
        description: `Destination mismatch: Card destination "${card.destination}" vs actual alighting stop "${currentDestination}". Passenger: ${card.owner_name || card.card_uid}`,
        detected_at: new Date().toISOString(),
        destination_stop: card.destination,
        current_stop: currentDestination,
        notes: `Boarded at: ${boardedData?.boarding_stop || 'Unknown'}`,
      });
      console.warn(`[FareService] Destination irregularity logged: Card target is ${card.destination}, alighting at ${currentDestination}`);
    }
  }

  // Calculate fare using matrix if boarding stop and destination are provided
  let fare = DEFAULT_FARE;
  if (scanType === 'onboarding' && boardingStop && currentDestination) {
    const matrixFare = getFareFromMatrix(boardingStop, currentDestination, card.passenger_type);
    if (matrixFare !== null) {
      fare = matrixFare;
    }
  }
  const totalFare = fare + (baggageFee || 0);

  if (scanType === 'onboarding') {
    // For card payments, check balance. For cash and GCash payments, skip balance check.
    const isCardPayment = paymentMethod === 'card' || paymentMethod === 'qr_card';
    if (isCardPayment && card.balance < totalFare) {
      return { status: 'qr_fail_balance', balance: card.balance, fare: totalFare, baggageFee, totalFare };
    }

    const updatePayload: Record<string, unknown> = {};
    if (currentDestination) updatePayload.destination = currentDestination;

    // Only deduct balance for card payments
    if (isCardPayment) {
      updatePayload.balance = card.balance - totalFare;
    }

    if (Object.keys(updatePayload).length > 0) {
      const { error: updateErr } = await supabase.from('qr_cards').update(updatePayload).eq('id', card.id);
      if (updateErr) {
        return { status: 'error', message: `Failed to update card: ${updateErr.message}` };
      }
      
      // Invalidate cache for this card after balance update
      cache.delete(CacheKeys.card(card.card_uid));
      console.log('[FareService] Cache invalidated for card:', card.card_uid);
    }

    const { error: txErr } = await supabase.from('transactions').insert({
      card_id: card.id,
      trip_id: tripId,
      type: 'fare_validation',
      transaction_type: 'fare_validation',
      fare_amount: fare,
      discount_amount: card.passenger_type === 'student' || card.passenger_type === 'senior_citizen' || card.passenger_type === 'pwd' ? fare * 0.20 : 0,
      amount: totalFare,
      final_amount: totalFare,
      channel: paymentMethod === 'cash' ? 'cash' : paymentMethod === 'gcash' ? 'gcash' : 'qr_card',
      payment_method: paymentMethod === 'cash' ? 'cash' : paymentMethod === 'gcash' ? 'gcash' : paymentMethod === 'card' ? 'qr_card' : 'qr_card',
      status: 'completed',
      staff_id: conductorId,
      baggage_category: baggageCategory || null,
      baggage_weight: baggageWeight || null,
      baggage_fee: baggageFee || null,
    });
    if (txErr) {
      return { status: 'error', message: `Failed to create boarding transaction: ${txErr.message}` };
    }

    const { error: boardErr } = await supabase.from('boarded_passengers').insert({
      trip_id: tripId,
      card_id: card.id,
      boarded_at: new Date().toISOString(),
      payment_method: paymentMethod === 'cash' ? 'cash' : paymentMethod === 'gcash' ? 'gcash' : 'qr_card',
      boarding_stop: boardingStop || null,
      destination_stop: currentDestination || null,
    });
    if (boardErr) {
      return { status: 'error', message: `Failed to record boarding: ${boardErr.message}` };
    }

    const newBalance = isCardPayment ? card.balance - totalFare : card.balance;
    return {
      status: 'qr_pass',
      newBalance,
      fare: 0,
      baggageFee,
      totalFare,
      destination: currentDestination,
    };
  } else {
    // Alighting — no fare deduction since total fare was already charged at boarding
    // Just record the alighting time
    if (!boardedData) {
      return { status: 'error', message: 'Passenger not boarded on this trip' };
    }
    
    const { error: alightErr } = await supabase.from('boarded_passengers')
      .update({ alighted_at: new Date().toISOString() })
      .eq('id', boardedData.id);
    if (alightErr) {
      return { status: 'error', message: `Failed to record alighting: ${alightErr.message}` };
    }

    // Queue SMS notification if card has contact number
    if (card.contact_number) {
      try {
        await smsService.queueAlightingSMS(card.contact_number, {
          passengerName: card.owner_name || 'Passenger',
          tripSummary: {
            route: 'CommutAI Route',
            boardingPoint: boardedData.boarding_stop || 'Unknown',
            destination: currentDestination || card.destination || 'Unknown',
            fare: 0, // Fare already paid at boarding
          },
          tripId: tripId,
        });
        console.log('[FareService] Alighting SMS queued for', card.contact_number);
      } catch (smsError) {
        console.error('[FareService] Failed to queue alighting SMS:', smsError);
        // Don't fail the alighting if SMS fails
      }
    }

    return {
      status: 'qr_pass',
      newBalance: card.balance,
      fare: 0,
      baggageFee: 0,
      totalFare: 0,
      destination: currentDestination || card.destination,
      contactNumber: card.contact_number,
      passengerName: card.owner_name,
      boardingPoint: boardedData.boarding_stop,
      destinationMismatch: destinationMismatchOccurred,
      expectedDestination: card.destination,
    };
  }
}

async function processTemporaryTicket(
  ticket: any,
  scannedUid: string,
  tripId: string,
  conductorId: string,
  busRoute?: string,
  scanType: 'onboarding' | 'alighting' = 'onboarding',
  currentDestination?: string,
  baggageFee?: number,
  baggageCategory?: string,
  baggageWeight?: number,
  paymentMethod: 'card' | 'qr_card' | 'cash' | 'gcash' = 'cash',
  boardingStop?: string,
): Promise<ScanResult> {
  // ── Basic Ticket Format Validation ────────────────────────────────────────────
  if (!scannedUid || scannedUid.length < 4) {
    return { status: 'qr_fake', reason: 'Invalid ticket format' };
  }

  // ── Ticket Status Validation ──────────────────────────────────────────────────
  if (ticket.status !== 'issued') {
    return { status: ticket.status === 'expired' ? 'ticket_expired' : 'ticket_already_used' };
  }

  // ── Trip Status Validation ───────────────────────────────────────────────────
  const { data: trip } = await supabase
    .from('trips')
    .select('status, ended_at')
    .eq('id', tripId)
    .single();

  if (!trip) {
    return { status: 'error', message: 'Trip not found' };
  }

  if (trip.status !== 'in_progress') {
    return { status: 'error', message: `Trip is ${trip.status}. Cannot process scan.` };
  }

  // ── Onboarding Validations ───────────────────────────────────────────────────
  if (scanType === 'onboarding') {
    // Validate boarding stop is provided
    if (!boardingStop) {
      return { status: 'error', message: 'Boarding location is required. Please select your current stop.' };
    }

    // Validate destination is provided
    if (!currentDestination) {
      return { status: 'error', message: 'Destination is required. Please select passenger destination.' };
    }

    // Validate payment method
    if (!['cash', 'gcash'].includes(paymentMethod)) {
      return { status: 'error', message: 'Invalid payment method for temporary ticket. Only cash or GCash allowed.' };
    }

    // Validate baggage fee matches category
    if (baggageCategory && baggageFee === undefined) {
      return { status: 'error', message: 'Baggage fee required when baggage category is selected.' };
    }
  }

  // ── Alighting Validations ────────────────────────────────────────────────────
  if (scanType === 'alighting') {
    // Validate destination is provided
    if (!currentDestination) {
      return { status: 'error', message: 'Alighting location is required.' };
    }
  }

  // ── Find Boarded Passenger ─────────────────────────────────────────────────
  const boardedPassengerResult = await supabase
    .from('boarded_passengers')
    .select('id, alighted_at, boarding_stop')
    .eq('trip_id', tripId)
    .eq('temp_ticket_id', ticket.id)
    .is('alighted_at', null)
    .order('boarded_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const boardedData = boardedPassengerResult.data;

  // ── Duplicate Scan Validation (Onboarding) ─────────────────────────────────
  if (scanType === 'onboarding') {
    if (boardedData) {
      return { status: 'duplicate_scan', type: 'temp_ticket', uid: scannedUid };
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

    // Invalidate cache for this ticket after validation
    cache.delete(CacheKeys.ticket(ticket.ticket_uid));
    console.log('[FareService] Cache invalidated for ticket:', ticket.ticket_uid);

    const baseFare = ticket.fare_amount || DEFAULT_FARE;
    const totalFare = baseFare + (baggageFee || 0);

    const txChannel = paymentMethod === 'cash' ? 'cash' : paymentMethod === 'gcash' ? 'gcash' : 'temp_ticket';
    const txPaymentMethod = paymentMethod === 'cash' ? 'cash' : paymentMethod === 'gcash' ? 'gcash' : 'cash';
    const { error: txErr } = await supabase.from('transactions').insert({
      temp_ticket_id: ticket.id,
      trip_id: tripId,
      type: 'fare_validation',
      transaction_type: 'fare_validation',
      fare_amount: baseFare,
      discount_amount: 0,
      amount: totalFare,
      final_amount: totalFare,
      channel: txChannel,
      payment_method: txPaymentMethod,
      status: 'completed',
      staff_id: conductorId,
      baggage_category: baggageCategory || null,
      baggage_weight: baggageWeight || null,
      baggage_fee: baggageFee || null,
    });

    if (txErr) {
      return { status: 'error', message: `Failed to create transaction: ${txErr.message}` };
    }

    const boardPaymentMethod = paymentMethod === 'cash' ? 'cash' : paymentMethod === 'gcash' ? 'gcash' : 'ticket';
    const { error: boardErr } = await supabase.from('boarded_passengers').insert({
      trip_id: tripId,
      temp_ticket_id: ticket.id,
      boarded_at: new Date().toISOString(),
      payment_method: boardPaymentMethod,
      boarding_stop: boardingStop || null,
      destination_stop: currentDestination || ticket.destination || null,
    });

    if (boardErr) {
      return { status: 'error', message: `Failed to record boarding: ${boardErr.message}` };
    }

    return {
      status: 'ticket_validated',
      fareAmount: totalFare,
      destination: currentDestination || ticket.destination,
      passengerName: ticket.passenger_type || 'Passenger',
    };
  } else {
    // Alighting
    if (!boardedData) {
      return { status: 'error', message: 'Ticket not boarded on this trip' };
    }

    const { error: alightErr } = await supabase
      .from('boarded_passengers')
      .update({ alighted_at: new Date().toISOString() })
      .eq('id', boardedData.id);

    if (alightErr) {
      return { status: 'error', message: `Failed to record alighting: ${alightErr.message}` };
    }

    // Note: Temporary tickets don't have contact numbers, so no SMS is sent
    // To enable SMS for temporary tickets, add contact_number field to temporary_tickets table

    return {
      status: 'ticket_validated',
      fareAmount: 0,
      destination: currentDestination || ticket.destination,
      passengerName: ticket.passenger_type || 'Passenger',
      boardingPoint: boardedData.boarding_stop,
    };
  }
}

// ── API Functions ─────────────────────────────────────────────────────────────

export async function getBaggageFees(): Promise<BaggageFee[]> {
  // Try fetching from database first (allows admin to update fees without app release)
  try {
    const { data, error } = await supabase
      .from('baggage_fee_matrix')
      .select('id, category, max_weight_kg, fee, remarks')
      .order('fee', { ascending: true });

    if (!error && data && data.length > 0) {
      return data.map(row => ({
        id: row.id,
        category: row.category,
        max_weight_kg: Number(row.max_weight_kg),
        fee: Number(row.fee),
        remarks: row.remarks ?? undefined,
      }));
    }
  } catch {
    // Fall through to hardcoded values if DB unreachable
  }

  // Offline fallback — matches the DB seed data exactly
  return [
    { id: 'local-0', category: 'Free Carry-on', max_weight_kg: 7,  fee: 0,   remarks: 'Included in passenger fare' },
    { id: 'local-1', category: 'Small',          max_weight_kg: 10, fee: 20,  remarks: 'Fits under seat or overhead area' },
    { id: 'local-2', category: 'Medium',          max_weight_kg: 20, fee: 40,  remarks: 'Stored in baggage compartment' },
    { id: 'local-3', category: 'Large',           max_weight_kg: 30, fee: 60,  remarks: 'Requires larger storage space' },
    { id: 'local-4', category: 'Oversized',       max_weight_kg: 31, fee: 100, remarks: 'Subject to conductor approval' },
  ];
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

/**
 * Manually marks a boarded passenger as alighted (e.g. from the passenger manifest list)
 */
export async function alightBoardedPassenger(
  boardedPassengerId: string,
  tripId: string,
  alightingStop?: string
): Promise<{ success: boolean; message?: string }> {
  try {
    const updateData: { alighted_at: string; destination_stop?: string } = {
      alighted_at: new Date().toISOString(),
    };
    if (alightingStop) {
      updateData.destination_stop = alightingStop;
    }
    const { error } = await supabase
      .from('boarded_passengers')
      .update(updateData)
      .eq('id', boardedPassengerId)
      .eq('trip_id', tripId);

    if (error) {
      console.error('[FareService] Error alighting passenger:', error);
      return { success: false, message: error.message };
    }
    return { success: true };
  } catch (err: any) {
    console.error('[FareService] Exception alighting passenger:', err);
    return { success: false, message: err?.message || 'Unknown error' };
  }
}
