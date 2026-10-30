/**
 * Fare Service — Unified fare validation and scan processing
 * Combines fareValidationApi.ts and scanProcessor.ts functionality
 * Includes caching layer for improved performance
 */

import { supabase } from '../supabaseClient';
import { cache, CacheKeys, CacheTTL } from './cacheService';

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
// Based on the provided fare matrix for Manolo Fortich → Cagayan de Oro route
// Format: from_stop -> to_stop -> { regularFare, discountedFare }

const FARE_MATRIX: Record<string, Record<string, { regularFare: number; discountedFare: number }>> = {
  'Gaisano CDO': {
    'Agora': { regularFare: 15, discountedFare: 15 },
    'Agora Terminal': { regularFare: 10.00, discountedFare: 8.00 },
  },
  'Agora': {
    'Gusa': { regularFare: 15, discountedFare: 15 },
    'Cugman': { regularFare: 20, discountedFare: 15 },
    'Tablon Baloi': { regularFare: 25, discountedFare: 20 },
    'Tablon': { regularFare: 25, discountedFare: 20 },
    'Agusan': { regularFare: 30, discountedFare: 20 },
    'Puerto': { regularFare: 30, discountedFare: 25 },
    'Bae Upper Puerto': { regularFare: 45, discountedFare: 25 },
    'Mambatangan': { regularFare: 45, discountedFare: 35 },
    'Balubal': { regularFare: 45, discountedFare: 35 },
    'Maitum': { regularFare: 50, discountedFare: 40 },
    'Alae Manolo': { regularFare: 55, discountedFare: 45 },
    'Lunocan': { regularFare: 65, discountedFare: 55 },
    'Cawayanon': { regularFare: 80, discountedFare: 75 },
    'San Miguel': { regularFare: 65, discountedFare: 55 },
    'Dicklum': { regularFare: 75, discountedFare: 65 },
    'Tankulan': { regularFare: 75, discountedFare: 65 },
    'Sankanan': { regularFare: 100, discountedFare: 90 },
    'Kalugmanan Manolo': { regularFare: 110, discountedFare: 100 },
  },
  'Gusa': {
    'Cugman': { regularFare: 15, discountedFare: 15 },
    'Tablon Baloi': { regularFare: 15, discountedFare: 15 },
    'Tablon': { regularFare: 15, discountedFare: 15 },
    'Agusan': { regularFare: 20, discountedFare: 15 },
    'Puerto': { regularFare: 23, discountedFare: 20 },
    'Bae Upper Puerto': { regularFare: 35, discountedFare: 30 },
    'Mambatangan': { regularFare: 40, discountedFare: 35 },
    'Balubal': { regularFare: 40, discountedFare: 35 },
    'Maitum': { regularFare: 48, discountedFare: 40 },
    'Alae Manolo': { regularFare: 52, discountedFare: 45 },
    'Lunocan': { regularFare: 55, discountedFare: 55 },
    'Cawayanon': { regularFare: 80, discountedFare: 75 },
    'San Miguel': { regularFare: 65, discountedFare: 55 },
    'Dicklum': { regularFare: 75, discountedFare: 65 },
    'Tankulan': { regularFare: 75, discountedFare: 65 },
    'Sankanan': { regularFare: 100, discountedFare: 90 },
    'Kalugmanan Manolo': { regularFare: 110, discountedFare: 100 },
    'Agora Terminal': { regularFare: 15.00, discountedFare: 12.00 },
  },
  'Cugman': {
    'Tablon Baloi': { regularFare: 15, discountedFare: 15 },
    'Tablon': { regularFare: 15, discountedFare: 15 },
    'Agusan': { regularFare: 17, discountedFare: 15 },
    'Puerto': { regularFare: 20, discountedFare: 15 },
    'Bae Upper Puerto': { regularFare: 30, discountedFare: 25 },
    'Mambatangan': { regularFare: 35, discountedFare: 30 },
    'Balubal': { regularFare: 35, discountedFare: 30 },
    'Maitum': { regularFare: 40, discountedFare: 35 },
    'Alae Manolo': { regularFare: 50, discountedFare: 40 },
    'Lunocan': { regularFare: 50, discountedFare: 50 },
    'Cawayanon': { regularFare: 75, discountedFare: 75 },
    'San Miguel': { regularFare: 60, discountedFare: 50 },
    'Dicklum': { regularFare: 70, discountedFare: 60 },
    'Tankulan': { regularFare: 70, discountedFare: 60 },
    'Sankanan': { regularFare: 95, discountedFare: 85 },
    'Kalugmanan Manolo': { regularFare: 105, discountedFare: 95 },
    'Agora Terminal': { regularFare: 12.00, discountedFare: 9.00 },
  },
  'Tablon Baloi': {
    'Tablon': { regularFare: 15, discountedFare: 15 },
    'Agusan': { regularFare: 15, discountedFare: 15 },
    'Puerto': { regularFare: 15, discountedFare: 15 },
    'Bae Upper Puerto': { regularFare: 25, discountedFare: 20 },
    'Mambatangan': { regularFare: 30, discountedFare: 20 },
    'Balubal': { regularFare: 30, discountedFare: 20 },
    'Maitum': { regularFare: 35, discountedFare: 25 },
    'Alae Manolo': { regularFare: 40, discountedFare: 30 },
    'Lunocan': { regularFare: 50, discountedFare: 40 },
    'Cawayanon': { regularFare: 75, discountedFare: 65 },
    'San Miguel': { regularFare: 55, discountedFare: 45 },
    'Dicklum': { regularFare: 60, discountedFare: 50 },
    'Tankulan': { regularFare: 70, discountedFare: 50 },
    'Sankanan': { regularFare: 95, discountedFare: 85 },
    'Kalugmanan Manolo': { regularFare: 105, discountedFare: 95 },
    'Agora Terminal': { regularFare: 35.00, discountedFare: 28.00 },
  },
  'Tablon': {
    'Agusan': { regularFare: 15, discountedFare: 15 },
    'Puerto': { regularFare: 15, discountedFare: 15 },
    'Bae Upper Puerto': { regularFare: 24, discountedFare: 20 },
    'Mambatangan': { regularFare: 30, discountedFare: 25 },
    'Balubal': { regularFare: 30, discountedFare: 25 },
    'Maitum': { regularFare: 35, discountedFare: 30 },
    'Alae Manolo': { regularFare: 40, discountedFare: 35 },
    'Lunocan': { regularFare: 45, discountedFare: 40 },
    'Cawayanon': { regularFare: 75, discountedFare: 65 },
    'San Miguel': { regularFare: 55, discountedFare: 45 },
    'Dicklum': { regularFare: 60, discountedFare: 50 },
    'Tankulan': { regularFare: 63, discountedFare: 50 },
    'Sankanan': { regularFare: 90, discountedFare: 80 },
    'Kalugmanan Manolo': { regularFare: 100, discountedFare: 90 },
    'Agora Terminal': { regularFare: 35.00, discountedFare: 28.00 },
  },
  'Agusan': {
    'Puerto': { regularFare: 15, discountedFare: 15 },
    'Bae Upper Puerto': { regularFare: 20, discountedFare: 15 },
    'Mambatangan': { regularFare: 25, discountedFare: 20 },
    'Balubal': { regularFare: 25, discountedFare: 20 },
    'Maitum': { regularFare: 30, discountedFare: 20 },
    'Alae Manolo': { regularFare: 35, discountedFare: 25 },
    'Lunocan': { regularFare: 40, discountedFare: 35 },
    'Cawayanon': { regularFare: 60, discountedFare: 50 },
    'San Miguel': { regularFare: 50, discountedFare: 40 },
    'Dicklum': { regularFare: 55, discountedFare: 45 },
    'Tankulan': { regularFare: 58, discountedFare: 45 },
    'Sankanan': { regularFare: 85, discountedFare: 75 },
    'Kalugmanan Manolo': { regularFare: 95, discountedFare: 85 },
    'Agora Terminal': { regularFare: 25.00, discountedFare: 20.00 },
  },
  'Puerto': {
    'Bae Upper Puerto': { regularFare: 20, discountedFare: 15 },
    'Mambatangan': { regularFare: 20, discountedFare: 20 },
    'Balubal': { regularFare: 20, discountedFare: 20 },
    'Maitum': { regularFare: 25, discountedFare: 20 },
    'Alae Manolo': { regularFare: 30, discountedFare: 25 },
    'Lunocan': { regularFare: 40, discountedFare: 35 },
    'Cawayanon': { regularFare: 60, discountedFare: 50 },
    'San Miguel': { regularFare: 45, discountedFare: 35 },
    'Dicklum': { regularFare: 55, discountedFare: 45 },
    'Tankulan': { regularFare: 55, discountedFare: 45 },
    'Sankanan': { regularFare: 80, discountedFare: 70 },
    'Kalugmanan Manolo': { regularFare: 90, discountedFare: 80 },
    'Agora Terminal': { regularFare: 34.75, discountedFare: 27.75 },
  },
  'Bae Upper Puerto': {
    'Mambatangan': { regularFare: 15, discountedFare: 15 },
    'Balubal': { regularFare: 15, discountedFare: 15 },
    'Maitum': { regularFare: 20, discountedFare: 15 },
    'Alae Manolo': { regularFare: 25, discountedFare: 20 },
    'Lunocan': { regularFare: 30, discountedFare: 25 },
    'Cawayanon': { regularFare: 50, discountedFare: 40 },
    'San Miguel': { regularFare: 40, discountedFare: 35 },
    'Dicklum': { regularFare: 45, discountedFare: 35 },
    'Tankulan': { regularFare: 50, discountedFare: 40 },
    'Sankanan': { regularFare: 75, discountedFare: 65 },
    'Kalugmanan Manolo': { regularFare: 85, discountedFare: 75 },
    'Agora Terminal': { regularFare: 41.50, discountedFare: 33.00 },
  },
  'Mambatangan': {
    'Balubal': { regularFare: 15, discountedFare: 15 },
    'Maitum': { regularFare: 15, discountedFare: 15 },
    'Alae Manolo': { regularFare: 20, discountedFare: 15 },
    'Lunocan': { regularFare: 30, discountedFare: 20 },
    'Cawayanon': { regularFare: 50, discountedFare:  40 },
    'San Miguel': { regularFare: 35, discountedFare: 25 },
    'Dicklum': { regularFare: 45, discountedFare: 35 },
    'Tankulan': { regularFare: 48, discountedFare: 38 },
    'Sankanan': { regularFare: 75, discountedFare: 65 },
    'Kalugmanan Manolo': { regularFare: 85, discountedFare: 75 },
    'Agora Terminal': { regularFare: 50.25, discountedFare: 40.25 },
  },
  'Balubal': {
    'Maitum': { regularFare: 15, discountedFare: 15 },
    'Alae Manolo': { regularFare: 20, discountedFare: 15 },
    'Lunocan': { regularFare: 30, discountedFare: 20 },
    'Cawayanon': { regularFare: 50, discountedFare: 40 },
    'San Miguel': { regularFare: 35, discountedFare: 30 },
    'Dicklum': { regularFare: 45, discountedFare: 35 },
    'Tankulan': { regularFare: 48, discountedFare: 38 },
    'Sankanan': { regularFare: 75, discountedFare: 65 },
    'Kalugmanan Manolo': { regularFare: 85, discountedFare: 75 },
    'Agora Terminal': { regularFare: 83.25, discountedFare: 66.50 },
  },
  'Maitom': {
    'Alae Manolo': { regularFare: 15, discountedFare: 15 },
    'Lunocan': { regularFare: 25, discountedFare: 20 },
    'Cawayanon': { regularFare: 40, discountedFare: 30 },
    'San Miguel': { regularFare: 35, discountedFare: 25 },
    'Dicklum': { regularFare: 35, discountedFare: 30 },
    'Tankulan': { regularFare: 40, discountedFare: 30 },
    'Sankanan': { regularFare: 65, discountedFare: 55 },
    'Kalugmanan Manolo': { regularFare: 75, discountedFare: 65 },
    'Agora Terminal': { regularFare: 59.00, discountedFare: 47.25 },
  },
  'Alae Manolo': {
    'Lunocan': { regularFare: 15, discountedFare: 15 },
    'Cawayanon': { regularFare: 30, discountedFare: 25 },
    'San Miguel': { regularFare: 20, discountedFare: 15 },
    'Dicklum': { regularFare: 30, discountedFare: 20 },
    'Tankulan': { regularFare: 30, discountedFare: 20 },
    'Sankanan': { regularFare: 55, discountedFare: 45 },
    'Kalugmanan Manolo': { regularFare: 65, discountedFare: 55 },
    'Agora Terminal': { regularFare: 41.50, discountedFare: 33.00 },
  },
  'Lonocan': {
    'Cawayanon': { regularFare: 25, discountedFare: 15 },
    'San Miguel': { regularFare: 20, discountedFare: 15 },
    'Dicklum': { regularFare: 20, discountedFare: 20 },
    'Tankulan': { regularFare: 25, discountedFare: 20 },
    'Sankanan': { regularFare: 50, discountedFare: 40 },
    'Kalugmanan Manolo': { regularFare: 60, discountedFare: 50 },
    'Agora Terminal': { regularFare: 65.50, discountedFare: 52.50 },
  },
  'Cawayanon': {
    'San Miguel': { regularFare: 20, discountedFare: 15 },
    'Dicklum': { regularFare: 20, discountedFare: 15 },
    'Tankulan': { regularFare: 20, discountedFare: 15 },
    'Sankanan': { regularFare: 45, discountedFare: 35 },
    'Kalugmanan Manolo': { regularFare: 55, discountedFare: 45 },
  },
  'San Miguel': {
    'Dicklum': { regularFare: 15, discountedFare: 15 },
    'Tankulan': { regularFare: 20, discountedFare: 15 },
    'Sankanan': { regularFare: 45, discountedFare: 35 },
    'Kalugmanan Manolo': { regularFare: 55, discountedFare: 45 },
    'Agora Terminal': { regularFare: 74.50, discountedFare: 59.50 },
  },
  'Dicklum': {
    'Tankulan': { regularFare: 15, discountedFare: 15 },
    'Sankanan': { regularFare: 40, discountedFare: 30 },
    'Kalugmanan Manolo': { regularFare: 50, discountedFare: 40 },
    'Agora Terminal': { regularFare: 83.25, discountedFare: 66.50 },
  },
  'Tankulan': {
    'Sankanan': { regularFare: 25, discountedFare: 15 },
    'Kalugmanan Manolo': { regularFare: 35, discountedFare: 25 },
  },
  'Sankanan': {
    'Kalugmanan Manolo': { regularFare: 20, discountedFare: 15 },
  },
  // New routes from database fare_matrix
  'Agora Terminal': {
    'Puerto': { regularFare: 34.75, discountedFare: 27.75 },
    'Ba-e': { regularFare: 41.50, discountedFare: 33.00 },
    'Mambatangan': { regularFare: 50.25, discountedFare: 40.25 },
    'Maitom': { regularFare: 59.00, discountedFare: 47.25 },
    'Alae': { regularFare: 63.50, discountedFare: 50.75 },
    'Lonocan': { regularFare: 65.50, discountedFare: 52.50 },
    'San Miguel': { regularFare: 74.50, discountedFare: 59.50 },
    'Diclum': { regularFare: 83.25, discountedFare: 66.50 },
    'Tankulan': { regularFare: 85.50, discountedFare: 68.25 },
    'Manolo Fortich Terminal': { regularFare: 85.50, discountedFare: 68.25 },
    'Bae Upper Puerto': { regularFare: 41.50, discountedFare: 33.00 },
    'Agusan': { regularFare: 25.00, discountedFare: 20.00 },
    'Tablon': { regularFare: 35.00, discountedFare: 28.00 },
    'Tablon Baloi': { regularFare: 35.00, discountedFare: 28.00 },
    'Gusa': { regularFare: 15.00, discountedFare: 12.00 },
    'Gaisano CDO': { regularFare: 10.00, discountedFare: 8.00 },
  },
  'Ala-e': {
    'Agora Terminal': { regularFare: 63.50, discountedFare: 50.75 },
  },
  'Manolo Fortich': {
    'Agora Terminal': { regularFare: 85.50, discountedFare: 68.25 },
  },
  'Manolo Fortich Terminal': {
    'Agora Terminal': { regularFare: 85.50, discountedFare: 68.25 },
  },
};

/**
 * Get fare from matrix based on origin and destination stops
 * @param fromStop - Origin stop name
 * @param toStop - Destination stop name
 * @param passengerType - Passenger type (regular, student, senior_citizen, pwd)
 * @returns Fare amount or null if route not found
 */
export function getFareFromMatrix(fromStop: string | undefined, toStop: string | undefined, passengerType: PassengerType = 'regular'): number | null {
  if (!fromStop || !toStop) {
    console.warn(`[FareMatrix] Missing fromStop or toStop`);
    return null;
  }

  const normalizedFrom = fromStop.trim();
  const normalizedTo = toStop.trim();

  const fromRoutes = FARE_MATRIX[normalizedFrom];
  if (!fromRoutes) {
    console.warn(`[FareMatrix] No fare data found for origin: ${normalizedFrom}`);
    return null;
  }

  const fareData = fromRoutes[normalizedTo];
  if (!fareData) {
    console.warn(`[FareMatrix] No fare data found for destination: ${normalizedTo} from ${normalizedFrom}`);
    return null;
  }

  // Return discounted fare for student, senior_citizen, pwd
  if (passengerType === 'student' || passengerType === 'senior_citizen' || passengerType === 'pwd') {
    return fareData.discountedFare;
  }

  return fareData.regularFare;
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
    .select('id, balance, status, allowed_routes, destination, passenger_type, card_uid')
    .eq('card_uid', normalizedUid)
    .maybeSingle();

  if (card) {
    // Cache the card data for future lookups
    const cardData = {
      ...card,
      balance: Number(card.balance),
      passenger_type: card.passenger_type as PassengerType
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

  // Find the most recent active (not yet alighted) boarding for this card on this trip
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

  let destinationMismatchOccurred = false;
  if (scanType === 'onboarding') {
    // Duplicate check: is the card currently on board (boarded but not yet alighted)?
    if (boardedData) {
      return { status: 'duplicate_scan', type: 'qr_card', uid: scannedUid };
    }
  } else if (scanType === 'alighting') {
    if (!boardedData) {
      return { status: 'error', message: 'Passenger not boarded on this trip' };
    }
    if (currentDestination && card.destination) {
      const normalizedCardDest = card.destination.toLowerCase().trim();
      const normalizedCurrentDest = currentDestination.toLowerCase().trim();
      const isDestinationMatch = normalizedCardDest === normalizedCurrentDest || 
                                 normalizedCardDest.includes(normalizedCurrentDest) ||
                                 normalizedCurrentDest.includes(normalizedCardDest);
      
      if (!isDestinationMatch) {
        destinationMismatchOccurred = true;
        await supabase.from('fare_irregularities').insert({
          trip_id: tripId,
          type: 'other',
          description: `Destination mismatch: Card destination ${card.destination} vs alighting stop ${currentDestination}`,
          detected_at: new Date().toISOString(),
        });
        console.warn(`[FareService] Destination irregularity logged: Card target is ${card.destination}, alighting at ${currentDestination}`);
      }
    }
  }

  if (card.status !== 'active') {
    return { status: 'qr_inactive' };
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
      amount: totalFare,
      channel: paymentMethod === 'cash' ? 'cash' : paymentMethod === 'gcash' ? 'gcash' : 'qr_card',
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
  // Check for fake QR
  if (!scannedUid || scannedUid.length < 4) {
    return { status: 'qr_fake', reason: 'Invalid ticket format' };
  }

  // Find the most recent active (not yet alighted) boarding for this ticket on this trip
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

  if (scanType === 'onboarding') {
    if (boardedData) {
      return { status: 'duplicate_scan', type: 'temp_ticket', uid: scannedUid };
    }

    if (ticket.status !== 'issued') {
      return { status: ticket.status === 'expired' ? 'ticket_expired' : 'ticket_already_used' };
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
    const { error: txErr } = await supabase.from('transactions').insert({
      temp_ticket_id: ticket.id,
      trip_id: tripId,
      type: 'fare_validation',
      amount: totalFare,
      channel: txChannel,
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
