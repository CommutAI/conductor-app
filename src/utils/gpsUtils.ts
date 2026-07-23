/**
 * GPS Utility Functions for distance calculations and proximity alerts
 */

/**
 * Calculate distance between two coordinates using Haversine formula
 * @param lat1 Latitude of first point
 * @param lon1 Longitude of first point
 * @param lat2 Latitude of second point
 * @param lon2 Longitude of second point
 * @returns Distance in kilometers
 */
export function calculateDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371; // Earth's radius in kilometers
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = R * c;
  
  return distance;
}

function toRadians(degrees: number): number {
  return degrees * (Math.PI / 180);
}

/**
 * Check if current location is within proximity threshold of destination
 * @param currentLat Current latitude
 * @param currentLng Current longitude
 * @param destLat Destination latitude
 * @param destLng Destination longitude
 * @param thresholdKm Proximity threshold in kilometers (default: 0.5 km)
 * @returns True if within threshold
 */
export function isWithinProximity(
  currentLat: number,
  currentLng: number,
  destLat: number,
  destLng: number,
  thresholdKm: number = 0.5
): boolean {
  if (!destLat || !destLng) return false;
  const distance = calculateDistance(currentLat, currentLng, destLat, destLng);
  return distance <= thresholdKm;
}

/**
 * Get proximity status message based on distance
 * @param distance Distance in kilometers
 * @returns Status message
 */
export function getProximityStatus(distance: number): {
  status: 'far' | 'approaching' | 'near' | 'arrived';
  message: string;
  color: 'success' | 'warning' | 'danger' | 'info';
} {
  if (distance < 0.1) {
    return {
      status: 'arrived',
      message: 'Arrived at destination',
      color: 'success'
    };
  } else if (distance < 0.5) {
    return {
      status: 'near',
      message: 'Very close to destination',
      color: 'success'
    };
  } else if (distance < 2) {
    return {
      status: 'approaching',
      message: 'Approaching destination',
      color: 'warning'
    };
  } else {
    return {
      status: 'far',
      message: 'En route to destination',
      color: 'info'
    };
  }
}
