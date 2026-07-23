// Fare Validation System Types

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

export interface FareValidation {
  id: string;
  card_id: string;
  conductor_id: string;
  route_id: string;
  fare: number;
  discount: number;
  final_fare: number;
  balance_before: number;
  balance_after: number;
  validated_at: string;
  status: string;
  trip_id?: string;
}

export interface ValidateFareRequest {
  cardId: string;
  terminal: string;
  conductorId: string;
}

export interface ValidateFareResponse {
  success: boolean;
  passengerType: PassengerType;
  destination: string;
  fare: number;
  discount: number;
  finalFare: number;
  balanceBefore: number;
  balanceAfter: number;
  transactionId: string;
  error?: string;
}

export interface PassengerDestinationResponse {
  cardId: string;
  destination: string;
  fare: number;
  balance: number;
  passengerType: PassengerType;
  route?: Route;
}

export interface RouteInfoResponse {
  terminal: string;
  destination: string;
  fare: number;
  distance: string;
  estimatedTime: string;
}

export interface FareCalculationResult {
  baseFare: number;
  discountPercentage: number;
  discountAmount: number;
  finalFare: number;
  passengerType: PassengerType;
}
