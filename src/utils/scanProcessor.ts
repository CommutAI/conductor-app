import { supabase } from '../supabaseClient';

export type ScanResult =
  | { status: 'qr_pass'; newBalance: number; fare: number; passengerId?: string; destination?: string }
  | { status: 'qr_fail_balance'; balance: number; fare: number }
  | { status: 'qr_inactive' }
  | { status: 'qr_wrong_trip'; expectedRoute: string }
  | { status: 'qr_fake'; reason: string }
  | { status: 'ticket_validated'; fareAmount: number; passengerId?: string; destination?: string }
  | { status: 'ticket_already_used' }
  | { status: 'ticket_expired' }
  | { status: 'ticket_wrong_trip'; expectedRoute: string }
  | { status: 'duplicate_scan'; type: 'qr_card' | 'temp_ticket'; uid: string }
  | { status: 'not_found' }
  | { status: 'error'; message: string };

// Default flat fare — adjust if your schema stores per-route fare
const DEFAULT_FARE = 12;

/**
 * Processes a raw QR scan string for the current trip.
 * Handles: registered QR cards, temporary tickets, duplicates, and errors.
 */
export async function processScan(
  scannedUid: string,
  tripId: string,
  conductorId: string,
  busRoute?: string,
  scanType: 'onboarding' | 'alighting' = 'onboarding',
  currentDestination?: string
): Promise<ScanResult> {
  // ── 1. Check for QR card ──────────────────────────────────────────────────
  const { data: card } = await supabase
    .from('qr_cards')
    .select('id, balance, status, passenger_id, allowed_routes, destination')
    .eq('card_uid', scannedUid)
    .maybeSingle();

  if (card) {
    // Check for fake QR (invalid format)
    if (!scannedUid || scannedUid.length < 8) {
      return { status: 'qr_fake', reason: 'Invalid QR format' };
    }

    // Check if card is allowed on this route
    if (card.allowed_routes && card.allowed_routes.length > 0 && busRoute) {
      if (!card.allowed_routes.includes(busRoute)) {
        return { status: 'qr_wrong_trip', expectedRoute: card.allowed_routes.join(', ') };
      }
    }

    // For alighting, validate that the card's stored destination matches the selected alighting stop
    if (scanType === 'alighting' && currentDestination) {
      if (card.destination && card.destination.toLowerCase().trim() !== currentDestination.toLowerCase().trim()) {
        await supabase.from('fare_irregularities').insert({
          trip_id: tripId,
          type: 'other',
          description: `Destination mismatch: Card destination ${card.destination} vs alighting stop ${currentDestination}`,
          detected_at: new Date().toISOString(),
        });
        return { status: 'error', message: `Destination mismatch. Card is for: ${card.destination}` };
      }
    }
    // Check if passenger is already boarded (for onboarding) or not boarded (for alighting)
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
    }

    if (card.status !== 'active') {
      return { status: 'qr_inactive' };
    }

    // Fare is deducted on ALIGHTING (not onboarding)
    const fare = DEFAULT_FARE;

    if (scanType === 'onboarding') {
      // On boarding: store the conductor-selected destination on the card record
      // so it can be verified on alighting
      const updatePayload: Record<string, unknown> = {};
      if (currentDestination) updatePayload.destination = currentDestination;

      if (Object.keys(updatePayload).length > 0) {
        await supabase.from('qr_cards').update(updatePayload).eq('id', card.id);
      }

      // Insert a boarding transaction (amount = 0, fare paid on alighting)
      const { error: txErr } = await supabase.from('transactions').insert({
        card_id: card.id,
        trip_id: tripId,
        type: 'boarding',
        amount: 0,
        channel: 'qr_card',
        staff_id: conductorId,
      });
      if (txErr) return { status: 'error', message: txErr.message };

      // Mark passenger as boarded
      if (card.passenger_id) {
        await supabase.from('boarded_passengers').insert({
          trip_id: tripId,
          passenger_id: card.passenger_id,
          card_id: card.id,
          boarded_at: new Date().toISOString(),
        });
      }
      // Return current balance (no deduction yet)
      return { status: 'qr_pass', newBalance: card.balance, fare: 0, passengerId: card.passenger_id, destination: currentDestination || card.destination };
    } else {
      // On alighting: check balance and deduct fare
      if (card.balance < fare) {
        return { status: 'qr_fail_balance', balance: card.balance, fare };
      }

      // Deduct balance
      const { error: balErr } = await supabase
        .from('qr_cards')
        .update({ balance: card.balance - fare })
        .eq('id', card.id);
      if (balErr) return { status: 'error', message: balErr.message };

      // Insert fare transaction
      const { error: txErr } = await supabase.from('transactions').insert({
        card_id: card.id,
        trip_id: tripId,
        type: 'fare_validation',
        amount: fare,
        channel: 'qr_card',
        staff_id: conductorId,
      });
      if (txErr) return { status: 'error', message: txErr.message };

      // Mark passenger as alighted
      await supabase
        .from('boarded_passengers')
        .update({ alighted_at: new Date().toISOString() })
        .eq('card_id', card.id)
        .eq('trip_id', tripId);

      return { status: 'qr_pass', newBalance: card.balance - fare, fare, passengerId: card.passenger_id, destination: card.destination };
    }
  }

  // ── 2. Check for temporary ticket ────────────────────────────────────────
  const { data: ticket } = await supabase
    .from('temporary_tickets')
    .select('id, ticket_uid, fare_amount, status, trip_id, passenger_id, allowed_routes, destination')
    .eq('ticket_uid', scannedUid)
    .maybeSingle();

  if (ticket) {
    // Check if ticket is allowed on this route
    if (ticket.allowed_routes && ticket.allowed_routes.length > 0 && busRoute) {
      if (!ticket.allowed_routes.includes(busRoute)) {
        return { status: 'ticket_wrong_trip', expectedRoute: ticket.allowed_routes.join(', ') };
      }
    }

    // For alighting, validate destination matches the selected alighting stop
    if (scanType === 'alighting' && currentDestination) {
      if (ticket.destination && ticket.destination.toLowerCase().trim() !== currentDestination.toLowerCase().trim()) {
        await supabase.from('fare_irregularities').insert({
          trip_id: tripId,
          type: 'other',
          description: `Destination mismatch: Ticket destination ${ticket.destination} vs alighting stop ${currentDestination}`,
          detected_at: new Date().toISOString(),
        });
        return { status: 'error', message: `Destination mismatch. Ticket is for: ${ticket.destination}` };
      }
    }
    // Check if ticket is already boarded/alighted
    const { data: boardedTicket } = await supabase
      .from('boarded_passengers')
      .select('id, alighted_at')
      .eq('trip_id', tripId)
      .eq('temp_ticket_id', ticket.id)
      .maybeSingle();

    if (scanType === 'onboarding') {
      if (ticket.status === 'validated') {
        if (ticket.trip_id === tripId && boardedTicket && !boardedTicket.alighted_at) {
          return { status: 'duplicate_scan', type: 'temp_ticket', uid: scannedUid };
        }
        return { status: 'ticket_already_used' };
      }
    } else if (scanType === 'alighting') {
      if (!boardedTicket) {
        return { status: 'error', message: 'Ticket not boarded on this trip' };
      }
      if (boardedTicket.alighted_at) {
        return { status: 'duplicate_scan', type: 'temp_ticket', uid: scannedUid };
      }
    }

    if (ticket.status === 'expired') {
      return { status: 'ticket_expired' };
    }

    if (scanType === 'onboarding') {
      // Mark ticket as validated (fare collected on alighting)
      const { error: ticketErr } = await supabase
        .from('temporary_tickets')
        .update({
          status: 'validated',
          trip_id: tripId,
          validated_at: new Date().toISOString(),
          // Store the conductor-selected destination
          destination: currentDestination || ticket.destination,
        })
        .eq('id', ticket.id);

      if (ticketErr) return { status: 'error', message: ticketErr.message };

      // Insert a boarding transaction (fare = 0, collected on alighting)
      const { error: txErr } = await supabase.from('transactions').insert({
        temp_ticket_id: ticket.id,
        trip_id: tripId,
        type: 'boarding',
        amount: 0,
        channel: 'temp_ticket',
        staff_id: conductorId,
      });

      if (txErr) return { status: 'error', message: txErr.message };

      // Mark passenger as boarded
      if (ticket.passenger_id) {
        await supabase.from('boarded_passengers').insert({
          trip_id: tripId,
          passenger_id: ticket.passenger_id,
          temp_ticket_id: ticket.id,
          boarded_at: new Date().toISOString(),
        });
      }
      // Return fareAmount = 0 (deducted on alighting)
      return { status: 'ticket_validated', fareAmount: 0, passengerId: ticket.passenger_id, destination: currentDestination || ticket.destination };
    } else {
      // On alighting: collect fare and mark as alighted
      const { error: txErr } = await supabase.from('transactions').insert({
        temp_ticket_id: ticket.id,
        trip_id: tripId,
        type: 'fare_validation',
        amount: ticket.fare_amount,
        channel: 'temp_ticket',
        staff_id: conductorId,
      });
      if (txErr) return { status: 'error', message: txErr.message };

      // Mark passenger as alighted
      await supabase
        .from('boarded_passengers')
        .update({ alighted_at: new Date().toISOString() })
        .eq('temp_ticket_id', ticket.id)
        .eq('trip_id', tripId);
      return { status: 'ticket_validated', fareAmount: ticket.fare_amount, passengerId: ticket.passenger_id, destination: ticket.destination };
    }
  }

  // ── 3. Not found ──────────────────────────────────────────────────────────
  return { status: 'not_found' };
}
