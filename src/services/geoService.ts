/**
 * geoService.ts
 * Free GPS reverse-geocoding via Nominatim (OpenStreetMap) +
 * known stop coordinates for the Manolo Fortich ↔ Agora route.
 * Includes circuit breaker pattern for GPS service resilience
 * Network-aware caching for offline support
 */

import { withCircuitBreaker } from './circuitBreaker';
import { Geolocation } from '@capacitor/geolocation';

// ── GPS Cache for Offline Support ─────────────────────────────────────────────
interface CachedLocation {
  locationName: string;
  fullAddress: string;
  timestamp: number;
  coordinates: { lat: number; lng: number };
}

const GPS_CACHE_KEY = 'commutai_gps_cache';
const GPS_CACHE_TTL = 5 * 60 * 1000; // 5 minutes cache TTL

class GpsCache {
  private cache: Map<string, CachedLocation> = new Map();

  getCachedLocation(lat: number, lng: number): CachedLocation | null {
    const key = `${lat.toFixed(4)}_${lng.toFixed(4)}`;
    const cached = this.cache.get(key);
    
    if (!cached) {
      // Try localStorage
      try {
        const stored = localStorage.getItem(GPS_CACHE_KEY);
        if (stored) {
          const parsed = JSON.parse(stored);
          const allCache = parsed.all || {};
          const storedItem = allCache[key];
          if (storedItem && Date.now() - storedItem.timestamp < GPS_CACHE_TTL) {
            this.cache.set(key, storedItem);
            return storedItem;
          }
        }
      } catch (err) {
        console.error('[GpsCache] Error reading from localStorage:', err);
      }
      return null;
    }

    // Check if cache is still valid
    if (Date.now() - cached.timestamp > GPS_CACHE_TTL) {
      this.cache.delete(key);
      return null;
    }

    return cached;
  }

  cacheLocation(lat: number, lng: number, locationName: string, fullAddress: string): void {
    const key = `${lat.toFixed(4)}_${lng.toFixed(4)}`;
    const item: CachedLocation = {
      locationName,
      fullAddress,
      timestamp: Date.now(),
      coordinates: { lat, lng }
    };

    this.cache.set(key, item);

    // Persist to localStorage
    try {
      const stored = localStorage.getItem(GPS_CACHE_KEY);
      const parsed = stored ? JSON.parse(stored) : { all: {} };
      parsed.all[key] = item;
      localStorage.setItem(GPS_CACHE_KEY, JSON.stringify(parsed));
    } catch (err) {
      console.error('[GpsCache] Error writing to localStorage:', err);
    }
  }

  getLastKnownLocation(): CachedLocation | null {
    let newest: CachedLocation | null = null;

    for (const item of this.cache.values()) {
      if (!newest || item.timestamp > newest.timestamp) {
        newest = item;
      }
    }

    try {
      const stored = localStorage.getItem(GPS_CACHE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        const allCache = parsed.all || {};
        for (const item of Object.values(allCache) as CachedLocation[]) {
          if (!newest || item.timestamp > newest.timestamp) {
            newest = item;
          }
        }
      }
    } catch (err) {
      console.error('[GpsCache] Error reading last known location:', err);
    }

    // Allow last-known for up to 24 h when live GPS is unavailable
    if (newest && Date.now() - newest.timestamp < 24 * 60 * 60 * 1000) {
      return newest;
    }
    return null;
  }

  clearOldCache(): void {
    const now = Date.now();
    for (const [key, item] of this.cache.entries()) {
      if (now - item.timestamp > GPS_CACHE_TTL) {
        this.cache.delete(key);
      }
    }
  }
}

const gpsCache = new GpsCache();

// Auto-clear old cache periodically
if (typeof window !== 'undefined') {
  setInterval(() => {
    gpsCache.clearOldCache();
  }, 5 * 60 * 1000); // Every 5 minutes
}

export interface StopCoords {
  name: string;
  lat: number;
  lng: number;
  /** Acceptable radius in km for "at this stop" */
  radiusKm: number;
}

// ── Known stop coordinates (Manolo Fortich – Agora Terminal route) ────────────
// Coordinates sourced from OpenStreetMap for Bukidnon / Cagayan de Oro area.
export const ROUTE_STOPS: StopCoords[] = [
  { name: 'Agora Terminal',   lat: 8.4796,  lng: 124.6508, radiusKm: 0.4 },
  { name: 'Puerto',           lat: 8.4701,  lng: 124.6392, radiusKm: 0.35 },
  { name: 'Ba-e',             lat: 8.4550,  lng: 124.6100, radiusKm: 0.35 },
  { name: 'Mambatangan',      lat: 8.4380,  lng: 124.5850, radiusKm: 0.35 },
  { name: 'Maitom',           lat: 8.4210,  lng: 124.5620, radiusKm: 0.35 },
  { name: 'Ala-e',            lat: 8.4040,  lng: 124.5390, radiusKm: 0.35 },
  { name: 'Lonocan',          lat: 8.3860,  lng: 124.5150, radiusKm: 0.35 },
  { name: 'San Miguel',       lat: 8.3680,  lng: 124.4900, radiusKm: 0.35 },
  { name: 'Diclum',           lat: 8.3500,  lng: 124.4650, radiusKm: 0.35 },
  { name: 'Manolo Fortich',   lat: 8.3695,  lng: 124.8600, radiusKm: 0.5  },
];

// ── Haversine distance (km) ───────────────────────────────────────────────────
export function haversineKm(
  lat1: number, lng1: number,
  lat2: number, lng2: number,
): number {
  const R    = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── Get current GPS position via Capacitor ────────────────────────────────────
export interface GpsPosition {
  lat: number;
  lng: number;
  accuracy: number; // metres
}

export async function getCurrentPosition(timeoutMs = 15000): Promise<GpsPosition> {
  const options = {
    enableHighAccuracy: false,
    timeout: timeoutMs,
    maximumAge: 120000, // accept a recent fix up to 2 minutes old
  };

  try {
    const pos = await Geolocation.getCurrentPosition(options);
    return {
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
      accuracy: pos.coords.accuracy,
    };
  } catch (fastErr) {
    console.warn('[geoService] Fast GPS failed, trying high accuracy:', fastErr);
  }

  const pos = await Geolocation.getCurrentPosition({
    enableHighAccuracy: true,
    timeout: timeoutMs,
    maximumAge: 120000,
  });

  return {
    lat: pos.coords.latitude,
    lng: pos.coords.longitude,
    accuracy: pos.coords.accuracy,
  };
}

// ── Nominatim reverse-geocode (free, no key) ──────────────────────────────────
export interface NominatimResult {
  display_name: string;
  address: {
    village?: string;
    suburb?: string;
    city_district?: string;
    town?: string;
    city?: string;
    county?: string;
    state?: string;
  };
}

export async function reverseGeocode(lat: number, lng: number): Promise<NominatimResult | null> {
  return withCircuitBreaker('gps', async () => {
    try {
      const url =
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=16&addressdetails=1`;
      const res = await fetch(url, {
        headers: { 'Accept-Language': 'en', 'User-Agent': 'CommutAI-ConductorApp/1.0' },
      });
      if (!res.ok) return null;
      return (await res.json()) as NominatimResult;
    } catch {
      return null;
    }
  }, () => null); // Fallback: return null on circuit open
}

// ── Match current position to a known stop ────────────────────────────────────
export interface StopMatch {
  stop: StopCoords;
  distanceKm: number;
  isWithinRadius: boolean;
}

export function nearestStop(lat: number, lng: number): StopMatch {
  let best: StopMatch = {
    stop: ROUTE_STOPS[0],
    distanceKm: Infinity,
    isWithinRadius: false,
  };
  for (const stop of ROUTE_STOPS) {
    const d = haversineKm(lat, lng, stop.lat, stop.lng);
    if (d < best.distanceKm) {
      best = { stop, distanceKm: d, isWithinRadius: d <= stop.radiusKm };
    }
  }
  return best;
}

// ── Fuzzy stop name match ─────────────────────────────────────────────────────
/** Returns true if the GPS-derived place name resembles the stored destination */
export function stopNameMatches(gpsName: string, storedDestination: string): boolean {
  const norm = (s: string) =>
    s.toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
  const g = norm(gpsName);
  const d = norm(storedDestination);

  if (g.includes(d) || d.includes(g)) return true;

  // token overlap ≥ 1 significant word
  const gTokens = g.split(' ').filter(t => t.length > 2);
  const dTokens = d.split(' ').filter(t => t.length > 2);
  return gTokens.some(t => dTokens.includes(t));
}

// ── Main validation: is the bus near the passenger's destination? ─────────────
export interface GpsValidationResult {
  status: 'confirmed' | 'mismatch' | 'no_gps' | 'no_coords';
  nearestStopName: string;
  distanceKm: number;
  reverseAddress?: string;
  message: string;
}

export async function validateAlightingLocation(
  storedDestination: string,
): Promise<GpsValidationResult> {
  // 1. Get GPS fix with optimized timeout for alighting
  let pos: GpsPosition;
  try {
    pos = await getCurrentPosition(15000); // Increased timeout for alighting (15s) to handle slow GPS
  } catch {
    return {
      status: 'no_gps',
      nearestStopName: '',
      distanceKm: 0,
      message: 'GPS unavailable — proceeding without location check',
    };
  }

  // 2. Find nearest known stop by coordinates
  const match = nearestStop(pos.lat, pos.lng);

  // 3. Reverse-geocode for display (non-blocking, best-effort)
  const geo = await reverseGeocode(pos.lat, pos.lng);
  const revAddr = geo
    ? (geo.address.village ||
       geo.address.suburb ||
       geo.address.city_district ||
       geo.address.town ||
       geo.address.city ||
       geo.display_name.split(',')[0])
    : undefined;

  // 4. Match against stored destination
  // Primary: proximity to known stop coordinates
  if (match.isWithinRadius) {
    const coordMatch =
      stopNameMatches(match.stop.name, storedDestination) ||
      match.stop.name.toLowerCase().includes(storedDestination.toLowerCase().slice(0, 4));

    if (coordMatch) {
      return {
        status: 'confirmed',
        nearestStopName: match.stop.name,
        distanceKm: match.distanceKm,
        reverseAddress: revAddr,
        message: `At ${match.stop.name} — matches destination ✓`,
      };
    }

    // Within a stop radius but wrong stop
    return {
      status: 'mismatch',
      nearestStopName: match.stop.name,
      distanceKm: match.distanceKm,
      reverseAddress: revAddr,
      message: `GPS shows ${match.stop.name}, card destination is ${storedDestination}`,
    };
  }

  // Secondary: reverse-geocode string match
  if (revAddr && stopNameMatches(revAddr, storedDestination)) {
    return {
      status: 'confirmed',
      nearestStopName: revAddr,
      distanceKm: match.distanceKm,
      reverseAddress: revAddr,
      message: `Location matches ${storedDestination} ✓`,
    };
  }

  // Not near any known stop — warn but allow override
  return {
    status: 'no_coords',
    nearestStopName: match.stop.name,
    distanceKm: match.distanceKm,
    reverseAddress: revAddr,
    message: `${(match.distanceKm * 1000).toFixed(0)}m from nearest stop (${match.stop.name})`,
  };
}

// ── Simplified GPS: Get coordinates and decode location for display ─────────
export interface GpsLocationResult {
  success: boolean;
  coordinates?: {
    lat: number;
    lng: number;
    accuracy: number;
  };
  locationName?: string;
  fullAddress?: string;
  error?: string;
}

export async function requestLocationAccess(): Promise<'granted' | 'denied'> {
  try {
    let status = await Geolocation.checkPermissions();
    if (status.location !== 'granted' && status.coarseLocation !== 'granted') {
      status = await Geolocation.requestPermissions();
    }
    if (status.location === 'denied' && status.coarseLocation !== 'granted') {
      return 'denied';
    }
    return 'granted';
  } catch (err) {
    console.warn('[geoService] Permission check failed, will attempt GPS anyway:', err);
    return 'granted';
  }
}

function decodeCoordinates(pos: GpsPosition): GpsLocationResult {
  const cached = gpsCache.getCachedLocation(pos.lat, pos.lng);
  if (cached) {
    return {
      success: true,
      coordinates: { lat: pos.lat, lng: pos.lng, accuracy: pos.accuracy },
      locationName: cached.locationName,
      fullAddress: cached.fullAddress,
    };
  }

  const stopMatch = nearestStop(pos.lat, pos.lng);
  const locationName = stopMatch.isWithinRadius
    ? stopMatch.stop.name
    : `${stopMatch.stop.name} (${(stopMatch.distanceKm * 1000).toFixed(0)}m away)`;

  const fullAddress = `${pos.lat.toFixed(6)}, ${pos.lng.toFixed(6)}`;
  gpsCache.cacheLocation(pos.lat, pos.lng, stopMatch.stop.name, fullAddress);

  return {
    success: true,
    coordinates: { lat: pos.lat, lng: pos.lng, accuracy: pos.accuracy },
    locationName,
    fullAddress,
  };
}

export async function getLocationAndDecode(): Promise<GpsLocationResult> {
  await requestLocationAccess();

  try {
    const pos = await getCurrentPosition(15000);
    const decoded = decodeCoordinates(pos);

    // Enrich with reverse-geocode when online (non-blocking for the stop name)
    if (navigator.onLine) {
      try {
        const geo = await reverseGeocode(pos.lat, pos.lng);
        if (geo) {
          const preciseName =
            geo.address.village ||
            geo.address.suburb ||
            geo.address.city_district ||
            geo.address.town ||
            geo.address.city ||
            geo.display_name.split(',')[0];
          if (preciseName) {
            decoded.locationName = preciseName;
            decoded.fullAddress = geo.display_name;
            gpsCache.cacheLocation(pos.lat, pos.lng, preciseName, geo.display_name);
          }
        }
      } catch {
        /* keep stop-based name */
      }
    }

    return decoded;
  } catch (error) {
    console.warn('[geoService] Live GPS failed:', error);

    const lastKnown = gpsCache.getLastKnownLocation();
    if (lastKnown) {
      return {
        success: true,
        coordinates: {
          lat: lastKnown.coordinates.lat,
          lng: lastKnown.coordinates.lng,
          accuracy: 999,
        },
        locationName: lastKnown.locationName,
        fullAddress: lastKnown.fullAddress,
      };
    }

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get location',
    };
  }
}
