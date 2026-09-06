/**
 * Geocoding Service
 * Handles location decoding using OpenStreetMap Nominatim API with improved accuracy
 */

interface GeocodingResult {
  address: string;
  city?: string;
  country?: string;
  postalCode?: string;
  street?: string;
  coordinates: {
    lat: number;
    lng: number;
  };
}

class GeocodingService {
  private cache: Map<string, { result: GeocodingResult; timestamp: number }> = new Map();
  private readonly CACHE_DURATION = 3600000; // 1 hour cache

  /**
   * Reverse geocode coordinates to address using OpenStreetMap Nominatim
   */
  async reverseGeocode(lat: number, lng: number): Promise<GeocodingResult | null> {
    // Check cache first
    const cacheKey = `${lat.toFixed(4)},${lng.toFixed(4)}`;
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.CACHE_DURATION) {
      return cached.result;
    }

    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`,
        { 
          headers: { 
            'User-Agent': 'CommutAI Conductor App (https://omanfortsco.ph)',
            'Accept-Language': 'en-US,en-PH'
          } 
        }
      );

      if (!response.ok) {
        throw new Error(`OSM API returned ${response.status}`);
      }

      const data = await response.json();

      if (data.display_name) {
        const result = this.parseOSMResponse(data, lat, lng);
        
        // Cache the result
        this.cache.set(cacheKey, { result, timestamp: Date.now() });
        
        return result;
      }

      return null;
    } catch (error) {
      console.error('[Geocoding] OSM API error:', error);
      return null;
    }
  }

  /**
   * Parse OpenStreetMap response into standardized format
   */
  private parseOSMResponse(data: any, lat: number, lng: number): GeocodingResult {
    const address = data.address || {};
    
    // Build a more readable address
    const parts = [];
    
    // Priority order for address components
    if (address.road || address.building) {
      parts.push(address.road || address.building);
    }
    if (address.suburb || address.district) {
      parts.push(address.suburb || address.district);
    }
    if (address.city || address.town || address.village) {
      parts.push(address.city || address.town || address.village);
    }
    if (address.state || address.province) {
      parts.push(address.state || address.province);
    }
    if (address.country) {
      parts.push(address.country);
    }

    // If we have very few parts, use the full display name
    const formattedAddress = parts.length >= 3 
      ? parts.join(', ')
      : data.display_name;

    return {
      address: formattedAddress,
      city: address.city || address.town || address.village,
      country: address.country,
      postalCode: address.postcode,
      street: address.road,
      coordinates: { lat, lng }
    };
  }

  /**
   * Get simple location name for SMS messages
   */
  async getLocationName(lat: number, lng: number): Promise<string> {
    const result = await this.reverseGeocode(lat, lng);
    
    if (result) {
      // Return city + country for brevity in SMS
      if (result.city && result.country) {
        return `${result.city}, ${result.country}`;
      }
      // If street is available, use street + city
      if (result.street && result.city) {
        return `${result.street}, ${result.city}`;
      }
      // Fallback to full address
      return result.address;
    }

    // Final fallback to coordinates
    return `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
  }

  /**
   * Batch reverse geocode for multiple points
   */
  async batchReverseGeocode(points: Array<{ lat: number; lng: number }>): Promise<Map<string, GeocodingResult>> {
    const results = new Map<string, GeocodingResult>();
    
    for (const point of points) {
      const result = await this.reverseGeocode(point.lat, point.lng);
      if (result) {
        results.set(`${point.lat},${point.lng}`, result);
      }
    }
    
    return results;
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.cache.clear();
  }
}

export const geocodingService = new GeocodingService();