/**
 * Fare Service — Unified fare validation and scan processing
 * Combines fareValidationApi.ts and scanProcessor.ts functionality
 * Includes caching layer for improved performance
 */

import { supabase } from '../supabaseClient';
import { cache, CacheKeys, CacheTTL } from './cacheService';
import { smsService } from './smsService';
import fareMatrixData from '../data/fareMatrix.json';
import fareMatrixManoloToAgora from '../data/fareMatrixManoloToAgora.json';
import fareMatrixAgoraToManolo from '../data/fareMatrixAgoraToManolo.json';
import busStopsData from '../data/busStops.json';
import { Trip, TripDirection, FareMatrixEntry } from '../types';

export type { TripDirection, FareMatrixEntry };

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
  | { status: 'qr_pass'; newBalance: number; fare: number; baggageFee?: number; totalFare?: number; passengerId?: string; destination?: string; contactNumber?: string; passengerName?: string; boardingPoint?: string; destinationMismatch?: boolean; expectedDestination?: string; uid?: string }
  | { status: 'qr_fail_balance'; balance: number; fare: number; baggageFee?: number; totalFare?: number; uid?: string }
  | { status: 'qr_inactive'; uid?: string }
  | { status: 'qr_wrong_trip'; expectedRoute: string; uid?: string }
  | { status: 'qr_fake'; reason: string; uid?: string }
  | { status: 'ticket_validated'; fareAmount: number; baggageFee?: number; totalFare?: number; passengerId?: string; destination?: string; contactNumber?: string; passengerName?: string; boardingPoint?: string; destinationMismatch?: boolean; expectedDestination?: string; uid?: string }
  | { status: 'ticket_already_used'; uid?: string }
  | { status: 'ticket_expired'; uid?: string }
  | { status: 'ticket_wrong_trip'; expectedRoute: string; uid?: string }
  | { status: 'duplicate_scan'; type: 'qr_card' | 'temp_ticket'; uid: string }
  | { status: 'not_found'; uid?: string }
  | { status: 'error'; message: string; uid?: string };

// ── Constants ─────────────────────────────────────────────────────────────────

export const DEFAULT_FARE = 15;

// ── Fare Matrix ───────────────────────────────────────────────────────────────
// Dynamic directional fare matrix synced with public.fare_matrix table in Supabase,
// with local cache and directional offline JSON fallbacks.

export const MANOLO_TO_AGORA_STOPS = [
  'Maluko Manolo',
  'Dalirig',
  'Tankulan',
  'Dicklum',
  'San Miguel',
  'Cawayanon',
  'Lunocan',
  'Alae Manolo',
  'Maitum',
  'Balubal',
  'Mambatangan',
  'Bae Upper Puerto',
  'Puerto',
  'Agusan',
  'Tablon',
  'Tablon Baloi',
  'Cugman',
  'Gusa',
  'Agora',
] as const;

export const AGORA_TO_MANOLO_STOPS = [
  'Agora',
  'Gusa',
  'Cugman',
  'Tablon Baloi',
  'Tablon',
  'Agusan',
  'Puerto',
  'Bae Upper Puerto',
  'Mambatangan',
  'Balubal',
  'Maitum',
  'Alae Manolo',
  'Lunocan',
  'Cawayanon',
  'San Miguel',
  'Dicklum',
  'Tankulan',
  'Dalirig',
  'Maluko Manolo',
] as const;

const FARE_MATRIX_STORAGE_KEY_PREFIX = 'commutai_fare_matrix_';
const FARE_MATRIX_STORAGE_KEY_LEGACY = 'commutai_fare_matrix_cache';

/**
 * Determine trip direction from trip object or route string.
 */
export function determineTripDirection(
  tripOrRoute?: Trip | { starting_point?: string | null; end_point?: string | null; route?: string | null; route_name?: string | null } | string | null
): TripDirection | null {
  if (!tripOrRoute) return null;

  if (typeof tripOrRoute === 'string') {
    const s = tripOrRoute.toLowerCase().trim();
    if (s === 'manolo_to_agora' || s === 'manolo-to-agora') return 'manolo_to_agora';
    if (s === 'agora_to_manolo' || s === 'agora-to-manolo') return 'agora_to_manolo';

    const isManoloFirst = /(manolo|maluko|tankulan).*(agora|cdo|cugman|gusa)/i.test(s);
    const isAgoraFirst = /(agora|cdo|cugman|gusa).*(manolo|maluko|tankulan)/i.test(s);
    if (isManoloFirst && !isAgoraFirst) return 'manolo_to_agora';
    if (isAgoraFirst && !isManoloFirst) return 'agora_to_manolo';

    if (s.startsWith('manolo') || s.startsWith('maluko')) return 'manolo_to_agora';
    if (s.startsWith('agora')) return 'agora_to_manolo';
    return null;
  }

  // Normalize starting_point and end_point to canonical forms
  const sp = normalizeStopName(tripOrRoute.starting_point || '').toLowerCase();
  const ep = normalizeStopName(tripOrRoute.end_point || '').toLowerCase();
  const route = (((tripOrRoute as any).route || (tripOrRoute as any).route_name) || '').toLowerCase().trim();

  console.log('[FareMatrix] determineTripDirection:', {
    original_start: tripOrRoute.starting_point,
    original_end: tripOrRoute.end_point,
    normalized_start: sp,
    normalized_end: ep,
    route
  });

  // Check starting_point and end_point
  if ((sp.includes('manolo') || sp.includes('maluko')) && ep.includes('agora')) {
    console.log('[FareMatrix] Detected direction: manolo_to_agora');
    return 'manolo_to_agora';
  }
  if (sp.includes('agora') && (ep.includes('manolo') || ep.includes('maluko'))) {
    console.log('[FareMatrix] Detected direction: agora_to_manolo');
    return 'agora_to_manolo';
  }
  if (sp.includes('manolo') || sp.includes('maluko')) {
    console.log('[FareMatrix] Fallback to manolo_to_agora (start point)');
    return 'manolo_to_agora';
  }
  if (sp.includes('agora')) {
    console.log('[FareMatrix] Fallback to agora_to_manolo (start point)');
    return 'agora_to_manolo';
  }
  if (ep.includes('agora')) {
    console.log('[FareMatrix] Fallback to manolo_to_agora (end point)');
    return 'manolo_to_agora';
  }
  if (ep.includes('manolo') || ep.includes('maluko')) {
    console.log('[FareMatrix] Fallback to agora_to_manolo (end point)');
    return 'agora_to_manolo';
  }

  if (route) {
    console.log('[FareMatrix] Fallback to route-based detection');
    return determineTripDirection(route);
  }

  console.log('[FareMatrix] Could not determine direction, returning null');
  return null;
}

/**
 * Stop aliases map for normalizing names between UI, database, and terminal variants.
 */
const STOP_ALIAS_MAP: Record<string, string[]> = {
  'agora terminal': ['agora terminal', 'agora'],
  'agora': ['agora', 'agora terminal'],
  'manolo fortich terminal': ['manolo fortich terminal', 'maluko manolo', 'manolo fortich', 'kalugmanan manolo', 'tankulan'],
  'manolo fortich': ['manolo fortich', 'manolo fortich terminal', 'maluko manolo', 'kalugmanan manolo'],
  'kalugmanan manolo': ['kalugmanan manolo', 'manolo fortich terminal', 'manolo fortich', 'maluko manolo'],
  'maluko manolo': ['maluko manolo', 'maluko', 'manolo fortich terminal', 'manolo fortich'],
  'maluko': ['maluko', 'maluko manolo', 'manolo fortich terminal'],
  'dalirig': ['dalirig'],
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
  'tablon baloi': ['tablon baloi'],
  'tablon': ['tablon'],
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
  'manolo': ['manolo', 'manolo fortich terminal', 'maluko manolo', 'manolo fortich'],
  'fortich': ['fortich', 'manolo fortich terminal', 'manolo fortich'],
  'terminal': ['terminal'],
};

export function getStopCandidates(stopName: string): string[] {
  const clean = stopName.trim().toLowerCase();
  const aliases = STOP_ALIAS_MAP[clean] || [];
  return Array.from(new Set([clean, ...aliases]));
}

/**
 * Normalize a stop name to its canonical form for fare matrix lookup.
 * This handles terminal variants like "Agora Terminal" → "Agora", "Manolo Fortich Terminal" → "Maluko Manolo".
 */
export function normalizeStopName(stopName: string): string {
  if (!stopName) return '';
  const clean = stopName.trim().toLowerCase();
  const candidates = getStopCandidates(stopName);

  // Map to canonical names used in fare_matrix database
  const canonicalMap: Record<string, string> = {
    'agora terminal': 'agora',
    'manolo fortich terminal': 'maluko manolo',
    'manolo fortich': 'maluko manolo',
    'kalugmanan manolo': 'maluko manolo',
    'ala-e': 'alae manolo',
    'ba-e': 'bae upper puerto',
    'diclum': 'dicklum',
    'lonocan': 'lunocan',
    'maitom': 'maitum',
  };

  for (const candidate of candidates) {
    if (canonicalMap[candidate]) {
      return canonicalMap[candidate];
    }
  }

  // Return the original if no mapping found
  return stopName.trim();
}

function findNormalizedStopIndex(stopName: string, stopsList: readonly string[]): number {
  if (!stopName) return -1;
  const normalized = normalizeStopName(stopName);
  const candidates = getStopCandidates(normalized);
  for (let i = 0; i < stopsList.length; i++) {
    const s = stopsList[i].toLowerCase();
    if (candidates.some((c) => c === s)) {
      return i;
    }
  }
  return -1;
}

/**
 * Check whether a database row belongs to a directional sequence (route_from appears before route_to).
 */
export function isRowInDirection(
  routeFrom: string,
  routeTo: string,
  direction: TripDirection
): boolean {
  const stops = direction === 'manolo_to_agora' ? MANOLO_TO_AGORA_STOPS : AGORA_TO_MANOLO_STOPS;
  const fromIdx = findNormalizedStopIndex(routeFrom, stops);
  const toIdx = findNormalizedStopIndex(routeTo, stops);
  return fromIdx !== -1 && toIdx !== -1 && fromIdx < toIdx;
}

/**
 * Validate if a stop combination is valid for the given trip direction.
 * Returns true if both stops exist in the direction's sequence and fromStop comes before toStop.
 */
export function isValidStopCombination(
  fromStop: string,
  toStop: string,
  direction?: TripDirection
): boolean {
  const dir = direction || currentActiveDirection;
  const normalizedFrom = normalizeStopName(fromStop);
  const normalizedTo = normalizeStopName(toStop);
  return isRowInDirection(normalizedFrom, normalizedTo, dir);
}

/**
 * Filter stops to only show valid destinations based on the current trip direction and boarding point.
 * Returns a list of stops that come after the boarding point in the direction's sequence.
 */
export function getValidDestinations(
  fromStop: string,
  direction?: TripDirection
): string[] {
  const dir = direction || currentActiveDirection;
  const stops = dir === 'manolo_to_agora' ? MANOLO_TO_AGORA_STOPS : AGORA_TO_MANOLO_STOPS;
  const normalizedFrom = normalizeStopName(fromStop);
  const fromIdx = findNormalizedStopIndex(normalizedFrom, stops);

  if (fromIdx === -1) {
    // If boarding point not found, return all stops after the first one
    return stops.slice(1);
  }

  // Return stops that come after the boarding point
  return stops.slice(fromIdx + 1);
}

/**
 * Filter stops to only show valid boarding points based on the current trip direction and destination.
 * Returns a list of stops that come before the destination in the direction's sequence.
 */
export function getValidBoardingPoints(
  toStop: string,
  direction?: TripDirection
): string[] {
  const dir = direction || currentActiveDirection;
  const stops = dir === 'manolo_to_agora' ? MANOLO_TO_AGORA_STOPS : AGORA_TO_MANOLO_STOPS;
  const normalizedTo = normalizeStopName(toStop);
  const toIdx = findNormalizedStopIndex(normalizedTo, stops);

  if (toIdx === -1) {
    // If destination not found, return all stops except the last one
    return stops.slice(0, -1);
  }

  // Return stops that come before the destination
  return stops.slice(0, toIdx);
}

function getBundledFareMatrixForDirection(direction: TripDirection): FareMatrixEntry[] {
  return direction === 'manolo_to_agora'
    ? (fareMatrixManoloToAgora as FareMatrixEntry[])
    : (fareMatrixAgoraToManolo as FareMatrixEntry[]);
}

function loadInitialFareMatrix(direction: TripDirection): FareMatrixEntry[] {
  try {
    const storageKey = `${FARE_MATRIX_STORAGE_KEY_PREFIX}${direction}`;
    const cached = localStorage.getItem(storageKey);
    if (cached) {
      const parsed = JSON.parse(cached);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
  } catch (e) {
    console.warn(`[FareMatrix] Error loading cached fare matrix for ${direction}:`, e);
  }
  return getBundledFareMatrixForDirection(direction);
}

let currentActiveDirection: TripDirection = 'manolo_to_agora';
let activeFareMatrix: FareMatrixEntry[] = loadInitialFareMatrix('manolo_to_agora');

/**
 * Explicitly switch the active trip direction and load its matrix (synchronous).
 */
export function setActiveTripDirection(
  tripOrDirection?: TripDirection | Trip | { starting_point?: string | null; end_point?: string | null } | string | null
): TripDirection {
  const resolved = determineTripDirection(tripOrDirection) || 'manolo_to_agora';
  if (currentActiveDirection !== resolved || activeFareMatrix.length === 0) {
    currentActiveDirection = resolved;
    activeFareMatrix = loadInitialFareMatrix(resolved);
    console.log(`[FareMatrix] Switched active trip direction to: ${resolved} (${activeFareMatrix.length} rows loaded)`);
  }
  return resolved;
}

export function getActiveTripDirection(): TripDirection {
  return currentActiveDirection;
}

export function getActiveFareMatrix(): FareMatrixEntry[] {
  return activeFareMatrix;
}

export function getStopsForDirection(direction?: TripDirection | null): string[] {
  const dir = direction || currentActiveDirection;
  return dir === 'agora_to_manolo' ? [...AGORA_TO_MANOLO_STOPS] : [...MANOLO_TO_AGORA_STOPS];
}

/**
 * Fetch latest fare matrix from Supabase public.fare_matrix table for the specified direction,
 * and cache for offline use. When online, only the 171 rows for that direction are kept.
 */
export async function loadFareMatrixFromDatabase(
  tripOrDirectionOrForce?: TripDirection | Trip | { starting_point?: string | null; end_point?: string | null } | string | boolean | null,
  force = false
): Promise<FareMatrixEntry[]> {
  let directionArg: TripDirection | Trip | { starting_point?: string | null; end_point?: string | null } | string | null = null;
  let forceArg = force;

  if (typeof tripOrDirectionOrForce === 'boolean') {
    forceArg = tripOrDirectionOrForce;
    directionArg = currentActiveDirection;
  } else {
    directionArg = tripOrDirectionOrForce ?? null;
  }

  const direction = setActiveTripDirection(directionArg);

  try {
    if (!navigator.onLine && activeFareMatrix.length > 0 && !forceArg) {
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
      // Filter rows to ONLY the 171 rows belonging to the active direction
      const directionalRows: FareMatrixEntry[] = data
        .filter((row: any) => isRowInDirection(row.route_from || '', row.route_to || '', direction))
        .map((row: any) => ({
          id: row.id,
          route_from: (row.route_from || '').trim(),
          route_to: (row.route_to || '').trim(),
          km_distance: row.km_distance !== null && row.km_distance !== undefined ? Number(row.km_distance) : null,
          regular_fare: Number(row.regular_fare),
          discounted_fare: Number(row.discounted_fare),
          direction,
        }));

      if (directionalRows.length > 0) {
        activeFareMatrix = directionalRows;
        try {
          localStorage.setItem(
            `${FARE_MATRIX_STORAGE_KEY_PREFIX}${direction}`,
            JSON.stringify(directionalRows)
          );
        } catch (storageErr) {
          console.warn(`[FareMatrix] Could not save fare matrix for ${direction} to localStorage:`, storageErr);
        }
        console.log(`[FareMatrix] Successfully loaded and cached ${directionalRows.length} fare entries for direction: ${direction}`);
        return directionalRows;
      }
    }
  } catch (err) {
    console.error('[FareMatrix] Unexpected error loading fare matrix:', err);
  }
  return activeFareMatrix;
}

// Initialize live sync if running in browser
if (typeof window !== 'undefined') {
  try {
    const rawTripState = localStorage.getItem('commutai_trip_state');
    if (rawTripState) {
      const parsed = JSON.parse(rawTripState);
      if (parsed?.currentTrip) {
        setActiveTripDirection(parsed.currentTrip);
      }
    }
  } catch (e) {
    // ignore
  }

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
          loadFareMatrixFromDatabase(currentActiveDirection, true).catch(() => {});
        }
      )
      .subscribe();
  } catch (subErr) {
    console.warn('[FareMatrix] Could not subscribe to realtime fare_matrix changes:', subErr);
  }
}

/**
 * Get sequence order of a bus stop along the route along the active trip direction.
 */
export function getStopSequenceOrder(stopName: string, direction?: TripDirection | null): number | null {
  if (!stopName) return null;
  const dir = direction || currentActiveDirection || 'manolo_to_agora';
  const stops = dir === 'agora_to_manolo' ? AGORA_TO_MANOLO_STOPS : MANOLO_TO_AGORA_STOPS;
  const idx = findNormalizedStopIndex(stopName, stops);
  if (idx !== -1) {
    return idx + 1; // 1-based order along trip
  }

  const candidates = getStopCandidates(stopName);
  for (const stop of busStopsData as any[]) {
    const sName = (stop.name || '').toLowerCase().trim();
    if (candidates.some((c) => c === sName || sName.includes(c) || c.includes(sName))) {
      return Number(stop.sequence_order);
    }
  }
  return null;
}

/**
 * Get fare from matrix based on origin and destination stops.
 * Supports:
 * 1. Strict directional lookup (only forward travel along the active trip's direction).
 * 2. Live database fares with automatic offline cache and directional JSON bundle fallback.
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

  // Normalize stop names to canonical forms used in fare_matrix database
  const normalizedFrom = normalizeStopName(fromStop);
  const normalizedTo = normalizeStopName(toStop);

  console.log('[FareMatrix] getFareFromMatrix called:', {
    original_from: fromStop,
    original_to: toStop,
    normalized_from: normalizedFrom,
    normalized_to: normalizedTo,
    passengerType,
    activeDirection: currentActiveDirection,
    matrixSize: activeFareMatrix.length
  });

  const fromCandidates = getStopCandidates(normalizedFrom);
  const toCandidates = getStopCandidates(normalizedTo);

  let fareEntry: FareMatrixEntry | undefined;

  // 1. Search in active directional fare matrix (ONLY forward direction along the trip)
  for (const f of fromCandidates) {
    for (const t of toCandidates) {
      fareEntry = activeFareMatrix.find(
        (item) => item.route_from.toLowerCase() === f && item.route_to.toLowerCase() === t
      );
      if (fareEntry) break;
    }
    if (fareEntry) break;
  }

  // 2. Fallback to bundled directional JSON if dynamic matrix had no match
  if (!fareEntry) {
    console.log('[FareMatrix] No match in active matrix, trying bundled data');
    const bundledData = getBundledFareMatrixForDirection(currentActiveDirection);
    for (const f of fromCandidates) {
      for (const t of toCandidates) {
        fareEntry = bundledData.find(
          (item) => item.route_from.toLowerCase() === f && item.route_to.toLowerCase() === t
        );
        if (fareEntry) break;
      }
      if (fareEntry) break;
    }
  }

  if (!fareEntry) {
    console.warn(`[FareMatrix] No fare data found for forward route: ${fromStop} -> ${toStop} (normalized: ${normalizedFrom} -> ${normalizedTo}, direction: ${currentActiveDirection})`);
    console.log('[FareMatrix] Available stops in matrix:', activeFareMatrix.slice(0, 5).map(m => `${m.route_from} -> ${m.route_to}`));
    return null;
  }

  const isDiscounted = passengerType === 'student' || passengerType === 'senior_citizen' || passengerType === 'pwd';
  const fare = isDiscounted ? fareEntry.discounted_fare : fareEntry.regular_fare;
  console.log('[FareMatrix] Fare found:', { fareEntry, finalFare: fare, isDiscounted });
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
    return { status: 'qr_fake', reason: 'Invalid QR format', uid: scannedUid };
  }

  // ── Card Status Validation ──────────────────────────────────────────────────
  if (card.status !== 'active') {
    return { status: 'qr_inactive', uid: scannedUid };
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
        return { status: 'qr_wrong_trip', expectedRoute: card.allowed_routes.join(', '), uid: scannedUid };
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

      // Determine specific irregularity type instead of generic 'other'
      const targetSeq = getStopSequenceOrder(card.destination);
      const currentSeq = getStopSequenceOrder(currentDestination);
      const boardSeq = boardedData?.boarding_stop ? getStopSequenceOrder(boardedData.boarding_stop) : null;

      let isOvershooting = false;
      if (targetSeq !== null && currentSeq !== null && boardSeq !== null) {
        const isForward = targetSeq >= boardSeq;
        isOvershooting = isForward ? currentSeq > targetSeq : currentSeq < targetSeq;
      } else if (targetSeq !== null && currentSeq !== null) {
        isOvershooting = currentSeq > targetSeq;
      }

      // Specific classification: 'overshooting' if traveled beyond paid destination, 'missed_alighting' if alighted early/different
      const specificType: 'overshooting' | 'missed_alighting' = isOvershooting ? 'overshooting' : 'missed_alighting';

      const detail = isOvershooting
        ? `Destination overshooting: Ticket destination was "${card.destination}" but passenger alighted past destination at "${currentDestination}".`
        : `Destination mismatch (early alighting): Ticket destination was "${card.destination}" but passenger alighted at "${currentDestination}".`;

      await supabase.from('fare_irregularities').insert({
        trip_id: tripId,
        conductor_id: conductorId,
        card_uid: card.card_uid,
        passenger_id: boardedData?.id,
        type: specificType,
        description: `${detail} Passenger: ${card.owner_name || card.card_uid}`,
        detected_at: new Date().toISOString(),
        destination_stop: card.destination,
        current_stop: currentDestination,
        boarding_stop: boardedData?.boarding_stop || null,
        notes: `Boarded at: ${boardedData?.boarding_stop || 'Unknown'}. Automated real-time alighting scan audit.`,
      });
      console.warn(`[FareService] Specific destination irregularity logged (${specificType}): Card target is ${card.destination}, alighting at ${currentDestination}`);
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
    return { status: 'qr_fake', reason: 'Invalid ticket format', uid: scannedUid };
  }

  // ── Ticket Status Validation ──────────────────────────────────────────────────
  if (ticket.status !== 'issued') {
    return { status: ticket.status === 'expired' ? 'ticket_expired' : 'ticket_already_used', uid: scannedUid };
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

    // ── Destination Mismatch Validation (Ticket Alighting) ────────────────────
    if (currentDestination && ticket.destination) {
      const normalizedTicketDest = ticket.destination.toLowerCase().trim();
      const normalizedCurrentDest = currentDestination.toLowerCase().trim();
      const isDestinationMatch = normalizedTicketDest === normalizedCurrentDest ||
                                 normalizedTicketDest.includes(normalizedCurrentDest) ||
                                 normalizedCurrentDest.includes(normalizedTicketDest);

      if (!isDestinationMatch) {
        const targetSeq = getStopSequenceOrder(ticket.destination);
        const currentSeq = getStopSequenceOrder(currentDestination);
        const boardSeq = boardedData?.boarding_stop ? getStopSequenceOrder(boardedData.boarding_stop) : null;

        let isOvershooting = false;
        if (targetSeq !== null && currentSeq !== null && boardSeq !== null) {
          const isForward = targetSeq >= boardSeq;
          isOvershooting = isForward ? currentSeq > targetSeq : currentSeq < targetSeq;
        } else if (targetSeq !== null && currentSeq !== null) {
          isOvershooting = currentSeq > targetSeq;
        }

        const specificType: 'overshooting' | 'missed_alighting' = isOvershooting ? 'overshooting' : 'missed_alighting';
        const detail = isOvershooting
          ? `Destination overshooting: Ticket destination was "${ticket.destination}" but passenger alighted past destination at "${currentDestination}".`
          : `Destination mismatch (early alighting): Ticket destination was "${ticket.destination}" but passenger alighted at "${currentDestination}".`;

        await supabase.from('fare_irregularities').insert({
          trip_id: tripId,
          conductor_id: conductorId,
          card_uid: ticket.ticket_uid,
          passenger_id: boardedData?.id,
          type: specificType,
          description: `${detail} Passenger: ${ticket.passenger_type || 'Ticket passenger'}`,
          detected_at: new Date().toISOString(),
          destination_stop: ticket.destination,
          current_stop: currentDestination,
          boarding_stop: boardedData?.boarding_stop || null,
          notes: `Boarded at: ${boardedData?.boarding_stop || 'Unknown'}. Automated real-time alighting scan audit for temporary ticket.`,
        });
        console.warn(`[FareService] Specific destination irregularity logged for ticket (${specificType}): Target is ${ticket.destination}, alighting at ${currentDestination}`);
      }
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
