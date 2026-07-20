import { supabase } from '../supabaseClient';
import type {
  Route,
  QRCard,
  FareValidation,
  ValidateFareRequest,
  ValidateFareResponse,
  PassengerDestinationResponse,
  RouteInfoResponse,
  PassengerType,
  FareCalculationResult
} from '../types/fareValidation';

// Fare calculation logic
export function calculateFare(baseFare: number, passengerType: PassengerType): FareCalculationResult {
  const discountPercentage = getDiscountPercentage(passengerType);
  const discountAmount = baseFare * discountPercentage;
  const finalFare = baseFare - discountAmount;

  return {
    baseFare,
    discountPercentage,
    discountAmount,
    finalFare,
    passengerType
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

// Get route information by terminal and destination
export async function getRouteInfo(terminal: string, destination: string): Promise<RouteInfoResponse | null> {
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
    terminal: data.terminal,
    destination: data.destination,
    fare: Number(data.fare),
    distance: data.distance_km ? `${data.distance_km} km` : 'N/A',
    estimatedTime: data.estimated_time_minutes ? `${data.estimated_time_minutes} min` : 'N/A'
  };
}

// Get all routes from a terminal
export async function getRoutesByTerminal(terminal: string): Promise<Route[]> {
  const { data, error } = await supabase
    .from('routes')
    .select('*')
    .eq('terminal', terminal)
    .order('fare', { ascending: true });

  if (error) {
    console.error('Error fetching routes:', error);
    return [];
  }

  return (data || []).map(route => ({
    ...route,
    fare: Number(route.fare),
    distance_km: route.distance_km ? Number(route.distance_km) : undefined
  }));
}

// Get QR card by UID
export async function getQRCardByUID(cardUID: string): Promise<QRCard | null> {
  const { data, error } = await supabase
    .from('qr_cards')
    .select('*')
    .eq('card_uid', cardUID)
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

// Get passenger destination by card ID
export async function getPassengerDestination(cardId: string): Promise<PassengerDestinationResponse | null> {
  const { data, error } = await supabase
    .from('qr_cards')
    .select(`
      *,
      routes:route_id(*)
    `)
    .eq('id', cardId)
    .single();

  if (error || !data) {
    console.error('Error fetching passenger destination:', error);
    return null;
  }

  const route = data.routes ? {
    id: data.routes.id,
    terminal: data.routes.terminal,
    destination: data.routes.destination,
    fare: Number(data.routes.fare),
    distance_km: data.routes.distance_km ? Number(data.routes.distance_km) : undefined,
    estimated_time_minutes: data.routes.estimated_time_minutes
  } : undefined;

  return {
    cardId: data.id,
    passengerName: data.owner_name,
    destination: data.destination || 'Not set',
    fare: route?.fare || 0,
    balance: Number(data.balance),
    passengerType: data.passenger_type as PassengerType,
    route
  };
}

// Validate fare and deduct from card balance
export async function validateFare(request: ValidateFareRequest): Promise<ValidateFareResponse> {
  try {
    // 1. Get the QR card
    const { data: card, error: cardError } = await supabase
      .from('qr_cards')
      .select('*')
      .eq('id', request.cardId)
      .single();

    if (cardError || !card) {
      return {
        success: false,
        passengerName: '',
        passengerType: 'regular',
        destination: '',
        fare: 0,
        discount: 0,
        finalFare: 0,
        balanceBefore: 0,
        balanceAfter: 0,
        transactionId: '',
        error: 'Card not found'
      };
    }

    // 2. Get the route
    const { data: route, error: routeError } = await supabase
      .from('routes')
      .select('*')
      .eq('terminal', request.terminal)
      .eq('destination', card.destination || '')
      .single();

    if (routeError || !route) {
      return {
        success: false,
        passengerName: card.owner_name,
        passengerType: card.passenger_type as PassengerType,
        destination: card.destination || 'Not set',
        fare: 0,
        discount: 0,
        finalFare: 0,
        balanceBefore: Number(card.balance),
        balanceAfter: Number(card.balance),
        transactionId: '',
        error: 'Route not found'
      };
    }

    // 3. Calculate fare with discount
    const fareCalc = calculateFare(Number(route.fare), card.passenger_type as PassengerType);
    const balanceBefore = Number(card.balance);

    // 4. Check sufficient balance
    if (balanceBefore < fareCalc.finalFare) {
      return {
        success: false,
        passengerName: card.owner_name,
        passengerType: card.passenger_type as PassengerType,
        destination: card.destination || 'Not set',
        fare: fareCalc.baseFare,
        discount: fareCalc.discountAmount,
        finalFare: fareCalc.finalFare,
        balanceBefore,
        balanceAfter: balanceBefore,
        transactionId: '',
        error: 'Insufficient balance'
      };
    }

    // 5. Deduct balance and create validation record
    const balanceAfter = balanceBefore - fareCalc.finalFare;

    // Update card balance
    const { error: updateError } = await supabase
      .from('qr_cards')
      .update({ balance: balanceAfter })
      .eq('id', request.cardId);

    if (updateError) {
      return {
        success: false,
        passengerName: card.owner_name,
        passengerType: card.passenger_type as PassengerType,
        destination: card.destination || 'Not set',
        fare: fareCalc.baseFare,
        discount: fareCalc.discountAmount,
        finalFare: fareCalc.finalFare,
        balanceBefore,
        balanceAfter: balanceBefore,
        transactionId: '',
        error: 'Failed to update balance'
      };
    }

    // Create fare validation record
    const { data: validation, error: validationError } = await supabase
      .from('fare_validations')
      .insert({
        card_id: request.cardId,
        conductor_id: request.conductorId,
        route_id: route.id,
        fare: fareCalc.baseFare,
        discount: fareCalc.discountAmount,
        final_fare: fareCalc.finalFare,
        balance_before: balanceBefore,
        balance_after: balanceAfter,
        status: 'completed'
      })
      .select()
      .single();

    if (validationError || !validation) {
      // Rollback balance update if validation record creation fails
      await supabase
        .from('qr_cards')
        .update({ balance: balanceBefore })
        .eq('id', request.cardId);

      return {
        success: false,
        passengerName: card.owner_name,
        passengerType: card.passenger_type as PassengerType,
        destination: card.destination || 'Not set',
        fare: fareCalc.baseFare,
        discount: fareCalc.discountAmount,
        finalFare: fareCalc.finalFare,
        balanceBefore,
        balanceAfter: balanceBefore,
        transactionId: '',
        error: 'Failed to create validation record'
      };
    }

    return {
      success: true,
      passengerName: card.owner_name,
      passengerType: card.passenger_type as PassengerType,
      destination: card.destination || 'Not set',
      fare: fareCalc.baseFare,
      discount: fareCalc.discountAmount,
      finalFare: fareCalc.finalFare,
      balanceBefore,
      balanceAfter,
      transactionId: validation.id
    };

  } catch (error) {
    console.error('Error validating fare:', error);
    return {
      success: false,
      passengerName: '',
      passengerType: 'regular',
      destination: '',
      fare: 0,
      discount: 0,
      finalFare: 0,
      balanceBefore: 0,
      balanceAfter: 0,
      transactionId: '',
      error: 'Unexpected error occurred'
    };
  }
}

// Get fare validations for a conductor
export async function getConductorValidations(conductorId: string, limit: number = 50): Promise<FareValidation[]> {
  const { data, error } = await supabase
    .from('fare_validations')
    .select('*')
    .eq('conductor_id', conductorId)
    .order('validated_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('Error fetching validations:', error);
    return [];
  }

  return (data || []).map(validation => ({
    ...validation,
    fare: Number(validation.fare),
    discount: Number(validation.discount),
    final_fare: Number(validation.final_fare),
    balance_before: Number(validation.balance_before),
    balance_after: Number(validation.balance_after)
  }));
}

// Get fare validations for a card
export async function getCardValidations(cardId: string, limit: number = 20): Promise<FareValidation[]> {
  const { data, error } = await supabase
    .from('fare_validations')
    .select(`
      *,
      routes:route_id(*),
      conductor:conductor_id(full_name)
    `)
    .eq('card_id', cardId)
    .order('validated_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('Error fetching card validations:', error);
    return [];
  }

  return (data || []).map(validation => ({
    ...validation,
    fare: Number(validation.fare),
    discount: Number(validation.discount),
    final_fare: Number(validation.final_fare),
    balance_before: Number(validation.balance_before),
    balance_after: Number(validation.balance_after)
  }));
}
