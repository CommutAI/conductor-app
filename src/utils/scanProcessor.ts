import { supabase } from '../supabaseClient';

export type ScanResult =
  | { status: 'qr_pass'; ownerName: string; newBalance: number; fare: number; passengerId?: string }
  | { status: 'qr_fail_balance'; ownerName: string; balance: number; fare: number }
  | { status: 'qr_inactive'; ownerName: string }
  | { status: 'qr_wrong_trip'; ownerName: string; expectedRoute: string }
  | { status: 'qr_fake'; reason: string }
  | { status: 'ticket_validated'; fareAmount: number; passengerId?: string }
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
  busRoute?: string
): Promise<ScanResult> {
  // ── 1. Check for QR card ──────────────────────────────────────────────────
  const { data: card } = await supabase
    .from('qr_cards')
    .select('id, owner_name, balance, status, passenger_id, allowed_routes')
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
        return { status: 'qr_wrong_trip', ownerName: card.owner_name, expectedRoute: card.allowed_routes.join(', ') };
      }
    }
    // Duplicate scan detection: has this card already been validated this trip?
    const { data: prevTx } = await supabase
      .from('transactions')
      .select('id')
      .eq('card_id', card.id)
      .eq('trip_id', tripId)
      .eq('type', 'fare_validation')
      .maybeSingle();

    if (prevTx) {
      // Flag as fare irregularity
      await supabase.from('fare_irregularities').insert({
        trip_id: tripId,
        type: 'double_scan',
        description: `QR card ${scannedUid} (owner: ${card.owner_name}) scanned twice on this trip.`,
        detected_at: new Date().toISOString(),
      });
      return { status: 'duplicate_scan', type: 'qr_card', uid: scannedUid };
    }

    if (card.status !== 'active') {
      return { status: 'qr_inactive', ownerName: card.owner_name };
    }

    const fare = DEFAULT_FARE;
    if (card.balance < fare) {
      return { status: 'qr_fail_balance', ownerName: card.owner_name, balance: card.balance, fare };
    }

    // Deduct balance
    const { error: balErr } = await supabase
      .from('qr_cards')
      .update({ balance: card.balance - fare })
      .eq('id', card.id);

    if (balErr) return { status: 'error', message: balErr.message };

    // Insert transaction
    const { error: txErr } = await supabase.from('transactions').insert({
      card_id: card.id,
      trip_id: tripId,
      type: 'fare_validation',
      amount: fare,
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

    return { status: 'qr_pass', ownerName: card.owner_name, newBalance: card.balance - fare, fare, passengerId: card.passenger_id };
  }

  // ── 2. Check for temporary ticket ────────────────────────────────────────
  const { data: ticket } = await supabase
    .from('temporary_tickets')
    .select('id, ticket_uid, fare_amount, status, trip_id, passenger_id, allowed_routes')
    .eq('ticket_uid', scannedUid)
    .maybeSingle();

  if (ticket) {
    // Check if ticket is allowed on this route
    if (ticket.allowed_routes && ticket.allowed_routes.length > 0 && busRoute) {
      if (!ticket.allowed_routes.includes(busRoute)) {
        return { status: 'ticket_wrong_trip', expectedRoute: ticket.allowed_routes.join(', ') };
      }
    }
    if (ticket.status === 'validated') {
      // Check if it was on THIS trip (duplicate scan) or a different trip (already used)
      if (ticket.trip_id === tripId) {
        await supabase.from('fare_irregularities').insert({
          trip_id: tripId,
          type: 'double_scan',
          description: `Temporary ticket ${scannedUid} scanned twice on this trip.`,
          detected_at: new Date().toISOString(),
        });
        return { status: 'duplicate_scan', type: 'temp_ticket', uid: scannedUid };
      }
      return { status: 'ticket_already_used' };
    }

    if (ticket.status === 'expired') {
      return { status: 'ticket_expired' };
    }

    // Mark as validated
    const { error: ticketErr } = await supabase
      .from('temporary_tickets')
      .update({
        status: 'validated',
        trip_id: tripId,
        validated_at: new Date().toISOString(),
      })
      .eq('id', ticket.id);

    if (ticketErr) return { status: 'error', message: ticketErr.message };

    // Insert transaction
    const { error: txErr } = await supabase.from('transactions').insert({
      temp_ticket_id: ticket.id,
      trip_id: tripId,
      type: 'fare_validation',
      amount: ticket.fare_amount,
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

    return { status: 'ticket_validated', fareAmount: ticket.fare_amount, passengerId: ticket.passenger_id };
  }

  // ── 3. Not found ──────────────────────────────────────────────────────────
  return { status: 'not_found' };
}
