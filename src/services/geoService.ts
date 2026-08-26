/**
 * geoService.ts
 * Free GPS reverse-geocoding via Nominatim (OpenStreetMap) +
 * known stop coordinates for the Manolo Fortich ↔ Agora route.
 */

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

export async function getCurrentPosition(timeoutMs = 10000): Promise<GpsPosition> {
  const cap = (window as any).Capacitor;
  
  // Progressive strategy: try fast cached position first, then high accuracy
  const tryFastPosition = async (): Promise<GpsPosition | null> => {
    try {
      if (cap?.Plugins?.Geolocation) {
        const pos = await cap.Plugins.Geolocation.getCurrentPosition({
          enableHighAccuracy: false,
          timeout: Math.min(8000, timeoutMs), // Increased from 5000ms to 8000ms for better indoor/bus performance
          maximumAge: 30000, // Accept positions up to 30 seconds old for better caching
        });
        return {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        };
      }
      // Web fallback for fast position
      return new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
          reject(new Error('Geolocation not supported'));
          return;
        }
        navigator.geolocation.getCurrentPosition(
          (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
          (e) => reject(new Error(e.message)),
          { enableHighAccuracy: false, timeout: Math.min(8000, timeoutMs), maximumAge: 30000 },
        );
      });
    } catch {
      return null;
    }
  };

  const tryHighAccuracyPosition = async (): Promise<GpsPosition> => {
    if (cap?.Plugins?.Geolocation) {
      const pos = await cap.Plugins.Geolocation.getCurrentPosition({
        enableHighAccuracy: true,
        timeout: timeoutMs,
        maximumAge: 30000, // Increased cache age for better performance
      });
      return {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
      };
    }
    // Web fallback
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error('Geolocation not supported'));
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
        (e) => reject(new Error(e.message)),
        { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 30000 },
      );
    });
  };

  // Try fast position first (cached or low accuracy)
  const fastPos = await tryFastPosition();
  if (fastPos && fastPos.accuracy < 150) { // Increased threshold from 100m to 150m for more lenient acceptance
    // If fast position is reasonably accurate (< 150m), use it
    return fastPos;
  }

  // Fall back to high accuracy position
  return tryHighAccuracyPosition();
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

export async function getLocationAndDecode(): Promise<GpsLocationResult> {
  try {
    // 1. Get current GPS coordinates
    const pos = await getCurrentPosition(10000);
    
    // 2. Reverse-geocode to get readable location
    const geo = await reverseGeocode(pos.lat, pos.lng);
    
    if (!geo) {
      return {
        success: true,
        coordinates: {
          lat: pos.lat,
          lng: pos.lng,
          accuracy: pos.accuracy,
        },
        locationName: 'Unknown location',
        fullAddress: `${pos.lat.toFixed(6)}, ${pos.lng.toFixed(6)}`,
      };
    }
    
    // Extract meaningful location name
    const locationName = 
      geo.address.village ||
      geo.address.suburb ||
      geo.address.city_district ||
      geo.address.town ||
      geo.address.city ||
      geo.display_name.split(',')[0] ||
      'Current location';
    
    return {
      success: true,
      coordinates: {
        lat: pos.lat,
        lng: pos.lng,
        accuracy: pos.accuracy,
      },
      locationName,
      fullAddress: geo.display_name,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get location',
    };
  }
}
