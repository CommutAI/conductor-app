import { supabase } from '../supabaseClient';

/**
 * Normalizes QR code strings by replacing special dash characters with regular hyphens.
 * This handles cases where QR codes contain en dashes (–), em dashes (—), or other dash variants
 * that should be treated as regular hyphens for database lookup.
 */
function normalizeQrCode(scannedUid: string): string {
  return scannedUid
    .replace(/[\u2013\u2014\u2015\u2212\uFF0D]/g, '-'); // en dash, em dash, horizontal bar, minus sign, fullwidth hyphen-minus
}

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
  // Normalize the scanned UID to handle special dash characters
  const normalizedUid = normalizeQrCode(scannedUid);

  // ── 1. Check for QR card ──────────────────────────────────────────────────
  const { data: card } = await supabase
    .from('qr_cards')
    .select('id, balance, status, passenger_id, allowed_routes, destination')
    .eq('card_uid', normalizedUid)
    .maybeSingle();

  if (card) {
    // Check for fake QR (invalid format)
    if (!scannedUid || scannedUid.length < 8) {
      return { status: 'qr_fake', reason: 'Invalid QR format' };
    }

    // Check if card is allowed on this route
    // Cards with "type:XXX" format are allowed on any route (passenger type restrictions)
    // Cards with specific route names must match the current bus route
    if (card.allowed_routes && card.allowed_routes.length > 0 && busRoute) {
      const hasRouteRestriction = card.allowed_routes.some((route: string) => !route.startsWith('type:') && route !== 'temporary');
      if (hasRouteRestriction) {
        console.log('Card allowed_routes:', card.allowed_routes);
        console.log('Current bus route:', busRoute);
        
        // Normalize both for comparison (trim, case-insensitive, remove special chars)
        const normalizeRoute = (route: string) => route.trim().toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ');
        const normalizedBusRoute = normalizeRoute(busRoute);
        
        const isAllowed = card.allowed_routes.some((allowedRoute: string) => {
          const normalizedAllowed = normalizeRoute(allowedRoute);
          // Allow partial match (e.g., "manalo fortich" matches "manolo fortich")
          const busWords = normalizedBusRoute.split(' ');
          const allowedWords = normalizedAllowed.split(' ');
          const matchCount = busWords.filter(word => allowedWords.some(aw => aw.includes(word) || word.includes(aw))).length;
          const similarity = matchCount / Math.max(busWords.length, allowedWords.length);
          return similarity >= 0.5; // At least 50% word similarity
        });
        
        if (!isAllowed) {
          console.log('Route mismatch - card not allowed on this route');
          return { status: 'qr_wrong_trip', expectedRoute: card.allowed_routes.join(', ') };
        }
        console.log('Route match confirmed');
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
      // Prevent duplicate boarding - check if already boarded and not yet alighted
      if (boardedPassenger && !boardedPassenger.alighted_at) {
        return { status: 'duplicate_scan', type: 'qr_card', uid: scannedUid };
      }
    } else if (scanType === 'alighting') {
      // First check if passenger is boarded on this trip
      if (!boardedPassenger) {
        return { status: 'error', message: 'Passenger not boarded on this trip' };
      }
      // Check if already alighted (duplicate scan)
      if (boardedPassenger.alighted_at) {
        return { status: 'duplicate_scan', type: 'qr_card', uid: scannedUid };
      }
      // Then validate destination matches (only if passenger is boarded)
      if (currentDestination && card.destination) {
        const normalizedCardDest = card.destination.toLowerCase().trim();
        const normalizedCurrentDest = currentDestination.toLowerCase().trim();
        // Allow partial match for flexibility (e.g., "Agora" matches "Agora Terminal")
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

    // Fare is deducted on ALIGHTING (not onboarding)
    const fare = DEFAULT_FARE;

    if (scanType === 'onboarding') {
      console.log('Starting onboarding for card:', card.id, 'destination:', currentDestination);
      
      // On boarding: store the conductor-selected destination on the card record
      // so it can be verified on alighting
      const updatePayload: Record<string, unknown> = {};
      if (currentDestination) updatePayload.destination = currentDestination;

      if (Object.keys(updatePayload).length > 0) {
        console.log('Updating card with:', updatePayload);
        const { error: updateErr } = await supabase.from('qr_cards').update(updatePayload).eq('id', card.id);
        if (updateErr) {
          console.error('Card update error:', updateErr);
          return { status: 'error', message: `Failed to update card: ${updateErr.message}` };
        }
        console.log('Card updated successfully');
      }

      // Insert a boarding transaction (amount = 0, fare paid on alighting)
      console.log('Creating boarding transaction');
      const { error: txErr } = await supabase.from('transactions').insert({
        card_id: card.id,
        trip_id: tripId,
        type: 'boarding',
        amount: 0,
        channel: 'qr_card',
        staff_id: conductorId,
      });
      if (txErr) {
        console.error('Transaction error:', txErr);
        return { status: 'error', message: `Failed to create transaction: ${txErr.message}` };
      }
      console.log('Transaction created successfully');

      // Mark passenger as boarded (always insert, even without passenger_id)
      console.log('Marking as boarded, passenger_id:', card.passenger_id);
      const { error: boardErr } = await supabase.from('boarded_passengers').insert({
        trip_id: tripId,
        passenger_id: card.passenger_id,
        card_id: card.id,
        boarded_at: new Date().toISOString(),
      });
      if (boardErr) {
        console.error('Boarding error:', boardErr);
        return { status: 'error', message: `Failed to mark as boarded: ${boardErr.message}` };
      }
      console.log('Boarded successfully');

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
      if (balErr) return { status: 'error', message: `Failed to deduct fare: ${balErr.message}` };

      // Insert fare transaction
      const { error: txErr } = await supabase.from('transactions').insert({
        card_id: card.id,
        trip_id: tripId,
        type: 'fare_validation',
        amount: fare,
        channel: 'qr_card',
        staff_id: conductorId,
      });
      if (txErr) return { status: 'error', message: `Failed to create fare transaction: ${txErr.message}` };

      // Mark passenger as alighted
      const { error: alightErr } = await supabase
        .from('boarded_passengers')
        .update({ alighted_at: new Date().toISOString() })
        .eq('card_id', card.id)
        .eq('trip_id', tripId);
      if (alightErr) return { status: 'error', message: `Failed to mark as alighted: ${alightErr.message}` };

      return { status: 'qr_pass', newBalance: card.balance - fare, fare, passengerId: card.passenger_id, destination: card.destination };
    }
  }

  // ── 2. Check for temporary ticket ────────────────────────────────────────
  const { data: ticket } = await supabase
    .from('temporary_tickets')
    .select('id, ticket_uid, fare_amount, status, trip_id, passenger_id, allowed_routes, destination')
    .eq('ticket_uid', normalizedUid)
    .maybeSingle();

  if (ticket) {
    // Check if ticket is allowed on this route
    // Tickets with "type:XXX" format are allowed on any route (passenger type restrictions)
    // Tickets with specific route names must match the current bus route
    if (ticket.allowed_routes && ticket.allowed_routes.length > 0 && busRoute) {
      const hasRouteRestriction = ticket.allowed_routes.some((route: string) => !route.startsWith('type:') && route !== 'temporary');
      if (hasRouteRestriction) {
        console.log('Ticket allowed_routes:', ticket.allowed_routes);
        console.log('Current bus route:', busRoute);
        
        // Normalize both for comparison (trim, case-insensitive, remove special chars)
        const normalizeRoute = (route: string) => route.trim().toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ');
        const normalizedBusRoute = normalizeRoute(busRoute);
        
        const isAllowed = ticket.allowed_routes.some((allowedRoute: string) => {
          const normalizedAllowed = normalizeRoute(allowedRoute);
          // Allow partial match (e.g., "manalo fortich" matches "manolo fortich")
          const busWords = normalizedBusRoute.split(' ');
          const allowedWords = normalizedAllowed.split(' ');
          const matchCount = busWords.filter(word => allowedWords.some(aw => aw.includes(word) || word.includes(aw))).length;
          const similarity = matchCount / Math.max(busWords.length, allowedWords.length);
          return similarity >= 0.5; // At least 50% word similarity
        });
        
        if (!isAllowed) {
          console.log('Route mismatch - ticket not allowed on this route');
          return { status: 'ticket_wrong_trip', expectedRoute: ticket.allowed_routes.join(', ') };
        }
        console.log('Route match confirmed for ticket');
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
      // Prevent duplicate boarding - check if already validated and boarded on this trip
      if (ticket.status === 'validated') {
        if (ticket.trip_id === tripId && boardedTicket && !boardedTicket.alighted_at) {
          return { status: 'duplicate_scan', type: 'temp_ticket', uid: scannedUid };
        }
        return { status: 'ticket_already_used' };
      }
    } else if (scanType === 'alighting') {
      // First check if ticket is boarded on this trip
      if (!boardedTicket) {
        return { status: 'error', message: 'Ticket not boarded on this trip' };
      }
      // Check if already alighted (duplicate scan)
      if (boardedTicket.alighted_at) {
        return { status: 'duplicate_scan', type: 'temp_ticket', uid: scannedUid };
      }
      // Then validate destination matches (only if ticket is boarded)
      if (currentDestination && ticket.destination) {
        const normalizedTicketDest = ticket.destination.toLowerCase().trim();
        const normalizedCurrentDest = currentDestination.toLowerCase().trim();
        // Allow partial match for flexibility
        const isDestinationMatch = normalizedTicketDest === normalizedCurrentDest || 
                                   normalizedTicketDest.includes(normalizedCurrentDest) ||
                                   normalizedCurrentDest.includes(normalizedTicketDest);
        
        if (!isDestinationMatch) {
          await supabase.from('fare_irregularities').insert({
            trip_id: tripId,
            type: 'other',
            description: `Destination mismatch: Ticket destination ${ticket.destination} vs alighting stop ${currentDestination}`,
            detected_at: new Date().toISOString(),
          });
          return { status: 'error', message: `Destination mismatch. Ticket is for: ${ticket.destination}` };
        }
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

      if (ticketErr) return { status: 'error', message: `Failed to validate ticket: ${ticketErr.message}` };

      // Insert a boarding transaction (fare = 0, collected on alighting)
      const { error: txErr } = await supabase.from('transactions').insert({
        temp_ticket_id: ticket.id,
        trip_id: tripId,
        type: 'boarding',
        amount: 0,
        channel: 'temp_ticket',
        staff_id: conductorId,
      });

      if (txErr) return { status: 'error', message: `Failed to create ticket transaction: ${txErr.message}` };

      // Mark passenger as boarded (always insert, even without passenger_id)
      const { error: boardErr } = await supabase.from('boarded_passengers').insert({
        trip_id: tripId,
        passenger_id: ticket.passenger_id,
        temp_ticket_id: ticket.id,
        boarded_at: new Date().toISOString(),
      });
      if (boardErr) return { status: 'error', message: `Failed to mark ticket as boarded: ${boardErr.message}` };

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
      if (txErr) return { status: 'error', message: `Failed to create fare transaction: ${txErr.message}` };

      // Mark passenger as alighted
      const { error: alightErr } = await supabase
        .from('boarded_passengers')
        .update({ alighted_at: new Date().toISOString() })
        .eq('temp_ticket_id', ticket.id)
        .eq('trip_id', tripId);
      if (alightErr) return { status: 'error', message: `Failed to mark ticket as alighted: ${alightErr.message}` };

      return { status: 'ticket_validated', fareAmount: ticket.fare_amount, passengerId: ticket.passenger_id, destination: ticket.destination };
    }
  }

  // ── 3. Not found ──────────────────────────────────────────────────────────
  return { status: 'not_found' };
}
