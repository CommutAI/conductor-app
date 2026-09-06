// ─────────────────────────────────────────────────────────────────────────────
// Unified Type System for CommutAI Conductor App
// ─────────────────────────────────────────────────────────────────────────────

// ── Passenger Types ───────────────────────────────────────────────────────────

export type PassengerType = 'regular' | 'student' | 'senior_citizen' | 'pwd';

// ── Staff & Auth ──────────────────────────────────────────────────────────────

export interface StaffProfile {
  id: string;
  full_name: string;
  email: string;
  role: 'admin' | 'conductor' | 'cs_desk';
  is_active: boolean;
  bus_id: string | null;
}

// ── Bus & Trip ───────────────────────────────────────────────────────────────

export interface Bus {
  id: string;
  plate_number: string;
  route: string;
  seat_capacity: number;
  status: 'active' | 'maintenance' | 'inactive';
}

export interface Trip {
  id: string;
  bus_id: string;
  conductor_id: string;
  started_at: string;
  ended_at: string | null;
  status: 'in_progress' | 'completed' | 'cancelled';
  current_lat?: number;
  current_lng?: number;
  gps_updated_at?: string;
}

// ── Routes ───────────────────────────────────────────────────────────────────

export interface Route {
  id: string;
  terminal: string;
  destination: string;
  fare: number;
  distance_km?: number;
  estimated_time_minutes?: number;
  destination_lat?: number;
  destination_lng?: number;
}

// ── QR Cards ─────────────────────────────────────────────────────────────────

export interface QRCard {
  id: string;
  card_uid: string;
  owner_name?: string;
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

// ── Temporary Tickets ─────────────────────────────────────────────────────────

export interface TemporaryTicket {
  id: string;
  ticket_uid: string;
  fare_amount: number;
  issued_by: string | null;
  trip_id: string | null;
  status: 'issued' | 'validated' | 'expired';
  issued_at: string;
  validated_at: string | null;
}

// ── Transactions ─────────────────────────────────────────────────────────────

export interface Transaction {
  id: string;
  card_id: string | null;
  temp_ticket_id: string | null;
  trip_id: string | null;
  type: 'fare_validation' | 'balance_topup' | 'card_issuance' | 'baggage_fee';
  amount: number;
  channel: string;
  staff_id: string | null;
  created_at: string;
}

// ── Boarded Passengers ──────────────────────────────────────────────────────

export interface BoardedPassenger {
  id: string;
  trip_id: string;
  card_id: string | null;
  passenger_id: string | null;
  boarded_at: string;
  alighted_at: string | null;
}

// ── Baggage Fees ────────────────────────────────────────────────────────────

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

// ── Fare Validation ─────────────────────────────────────────────────────────

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

export interface FareCalculationResult {
  baseFare: number;
  discountPercentage: number;
  discountAmount: number;
  finalFare: number;
  passengerType: PassengerType;
  baggageFee?: number;
  totalFare?: number;
}

// ── Scan Results ─────────────────────────────────────────────────────────────

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

// ── Offline Storage ───────────────────────────────────────────────────────────

export interface OfflineScan {
  id: string;
  scannedUid: string;
  tripId: string;
  conductorId: string;
  busRoute?: string;
  timestamp: string;
  synced: boolean;
  syncAttempts: number;
  lastError?: string;
}

export interface CachedTripState {
  currentTrip: Trip | null;
  currentBus: Bus | null;
  validatedCount: number;
  currentPassengersCount: number;
  fareCollected: number;
  savedAt: string;
}

export interface SyncResult {
  synced: number;
  failed: number;
  fareTotal: number;
  validatedCount: number;
}

// ── Location & GPS ─────────────────────────────────────────────────────────

export interface LocationCoordinates {
  lat: number;
  lng: number;
}

export type GPSStatus = 'active' | 'inactive' | 'searching';

export interface ProximityStatus {
  status: 'far' | 'approaching' | 'near' | 'arrived';
  message: string;
  color: 'success' | 'warning' | 'danger' | 'info';
}

export interface ProximityAlert {
  id: string;
  passengerName: string;
  destination: string;
  distance: string;
  status: string;
  message: string;
  color: string;
  timestamp: string;
}

// ── Fare Irregularities ─────────────────────────────────────────────────────

export interface FareIrregularity {
  id: string;
  trip_id: string;
  type: 'double_scan' | 'count_mismatch' | 'fare_evasion' | 'other';
  description: string;
  detected_at: string;
  resolved: boolean;
  resolved_by: string | null;
}

// ── Theme ────────────────────────────────────────────────────────────────────

export type Theme = 'light' | 'dark';

// ── UI Component Props ───────────────────────────────────────────────────────

export type ToastColor = 'success' | 'danger' | 'warning';

export interface ToastProps {
  isOpen: boolean;
  message: string;
  color: ToastColor;
  onDismiss: () => void;
}

// ── SMS Types ─────────────────────────────────────────────────────────────────────

export type SMSType = 'emergency' | 'alighting' | 'other';
export type SMSStatus = 'pending' | 'sent' | 'failed' | 'cancelled';

export interface SMSQueue {
  id: string;
  phone_number: string;
  message: string;
  type: SMSType;
  priority: number;
  related_id?: string;
  trip_id?: string;
  status: SMSStatus;
  created_at: string;
  sent_at?: string;
  failed_at?: string;
  error_message?: string;
  retry_count: number;
  max_retries: number;
}

export interface EmergencySMSData {
  emergencyType: string;
  location?: { lat: number; lng: number };
  tripId?: string;
  busInfo?: {
    plateNumber: string;
    route: string;
  };
}

export interface AlightingSMSData {
  passengerName: string;
  tripSummary: {
    route: string;
    boardingPoint: string;
    destination: string;
    fare: number;
    duration?: string;
  };
  tripId: string;
}
