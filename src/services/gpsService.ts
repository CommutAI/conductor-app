/**
 * GPS Service
 * Handles GPS data fetching from Raspberry Pi with fallback to mobile GPS
 */

interface GPSPosition {
  lat: number;
  lng: number;
  accuracy?: number;
  altitude?: number;
  speed?: number;
  heading?: number;
  timestamp: number;
  source: 'pi_gps' | 'mobile_gps';
}

class GPSService {
  private piEndpoint: string;
  private usePiGPS: boolean;

  constructor() {
    this.piEndpoint = import.meta.env.VITE_GPS_PI_ENDPOINT || 'http://commutai.local:5000/api/gps';
    this.usePiGPS = import.meta.env.VITE_USE_PI_GPS !== 'false';
    console.log(`[GPS] Initialized: Pi GPS ${this.usePiGPS ? 'enabled' : 'disabled'}, endpoint: ${this.piEndpoint}`);
  }

  /**
   * Try to get GPS position from Raspberry Pi first, fallback to mobile GPS
   */
  async getCurrentPosition(): Promise<GPSPosition | null> {
    if (this.usePiGPS) {
      try {
        const piPosition = await this.getPiGPSPosition();
        if (piPosition) {
          console.log('[GPS] Using Raspberry Pi GPS position');
          return piPosition;
        }
      } catch (error) {
        console.warn('[GPS] Raspberry Pi GPS unavailable, falling back to mobile GPS');
      }
    }

    // Fallback to mobile GPS
    const mobilePosition = await this.getMobileGPSPosition();
    if (mobilePosition) {
      console.log('[GPS] Using mobile GPS position');
    }
    return mobilePosition;
  }

  /**
   * Get GPS position from Raspberry Pi
   */
  private async getPiGPSPosition(): Promise<GPSPosition | null> {
    try {
      const response = await fetch(this.piEndpoint, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
        signal: AbortSignal.timeout(5000) // 5 second timeout
      });

      if (!response.ok) {
        throw new Error(`Pi GPS returned ${response.status}`);
      }

      const data = await response.json();

      if (data.lat && data.lng) {
        return {
          lat: parseFloat(data.lat),
          lng: parseFloat(data.lng),
          accuracy: data.accuracy ? parseFloat(data.accuracy) : undefined,
          altitude: data.altitude ? parseFloat(data.altitude) : undefined,
          speed: data.speed ? parseFloat(data.speed) : undefined,
          heading: data.heading ? parseFloat(data.heading) : undefined,
          timestamp: Date.now(),
          source: 'pi_gps'
        };
      }

      return null;
    } catch (error) {
      console.error('[GPS] Pi GPS error:', error);
      return null;
    }
  }

  /**
   * Get GPS position from mobile device (Capacitor)
   */
  private async getMobileGPSPosition(): Promise<GPSPosition | null> {
    try {
      const position = await (window as any).Capacitor?.Geolocation?.getCurrentPosition({
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 5000
      });

      if (position?.coords) {
        return {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy: position.coords.accuracy,
          altitude: position.coords.altitude,
          speed: position.coords.speed,
          heading: position.coords.heading,
          timestamp: position.timestamp || Date.now(),
          source: 'mobile_gps'
        };
      }

      return null;
    } catch (error) {
      console.error('[GPS] Mobile GPS error:', error);
      return null;
    }
  }

  /**
   * Watch position changes (for continuous tracking)
   */
  async watchPosition(callback: (position: GPSPosition | null) => void): Promise<string | null> {
    try {
      const watchId = await (window as any).Capacitor?.Geolocation?.watchPosition({
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 5000
      }, (position: any) => {
        if (position?.coords) {
          callback({
            lat: position.coords.latitude,
            lng: position.coords.longitude,
            accuracy: position.coords.accuracy,
            altitude: position.coords.altitude,
            speed: position.coords.speed,
            heading: position.coords.heading,
            timestamp: position.timestamp || Date.now(),
            source: 'mobile_gps'
          });
        }
      });

      return watchId;
    } catch (error) {
      console.error('[GPS] Watch position error:', error);
      return null;
    }
  }

  /**
   * Clear position watch
   */
  async clearWatch(watchId: string): Promise<void> {
    try {
      await (window as any).Capacitor?.Geolocation?.clearWatch({ id: watchId });
    } catch (error) {
      console.error('[GPS] Clear watch error:', error);
    }
  }

  /**
   * Set Raspberry Pi endpoint (for configuration)
   */
  setPiEndpoint(endpoint: string): void {
    this.piEndpoint = endpoint;
  }

  /**
   * Enable/disable Raspberry Pi GPS
   */
  setUsePiGPS(use: boolean): void {
    this.usePiGPS = use;
  }

  /**
   * Get current GPS source preference
   */
  getCurrentSource(): 'pi_gps' | 'mobile_gps' {
    return this.usePiGPS ? 'pi_gps' : 'mobile_gps';
  }
}

export const gpsService = new GPSService();