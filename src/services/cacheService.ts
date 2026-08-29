/**
 * Cache Service
 * In-memory caching layer for frequently accessed data with TTL support
 * Includes observability integration for cache performance monitoring
 * Network-aware cache versioning and invalidation
 */

import { observability, logCacheOperation } from './observability';

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number; // Time to live in milliseconds
  version: number; // Cache version for invalidation
  lastNetworkState: boolean; // Network state when cached
}

class CacheService {
  private cache: Map<string, CacheEntry<any>> = new Map();
  private defaultTTL = 5 * 60 * 1000; // 5 minutes default
  private cacheVersion = 1; // Global cache version for mass invalidation
  private networkVersion = 0; // Network state version for invalidation on network changes

  /**
   * Set a value in cache with optional TTL and version tracking
   */
  set<T>(key: string, data: T, ttl?: number): void {
    const entry: CacheEntry<T> = {
      data,
      timestamp: Date.now(),
      ttl: ttl || this.defaultTTL,
      version: this.cacheVersion,
      lastNetworkState: navigator.onLine
    };
    this.cache.set(key, entry);
    console.log(`[Cache] Set key: ${key}, TTL: ${entry.ttl}ms, version: ${entry.version}`);
    logCacheOperation('set', key);
  }

  /**
   * Get a value from cache if it exists and hasn't expired
   * Invalidates cache on network state changes and version mismatches
   */
  get<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) {
      logCacheOperation('miss', key);
      return null;
    }

    const now = Date.now();
    const age = now - entry.timestamp;

    // Check if cache is expired
    if (age > entry.ttl) {
      console.log(`[Cache] Expired key: ${key} (age: ${age}ms, TTL: ${entry.ttl}ms)`);
      this.cache.delete(key);
      logCacheOperation('miss', key);
      return null;
    }

    // Check if cache version is outdated
    if (entry.version !== this.cacheVersion) {
      console.log(`[Cache] Outdated version for key: ${key} (cache: ${entry.version}, current: ${this.cacheVersion})`);
      this.cache.delete(key);
      logCacheOperation('miss', key);
      return null;
    }

    // Entries cached while offline are estimates — discard once back online.
    // Entries cached while online remain valid when going offline (no re-fetch storm).
    if (navigator.onLine && !entry.lastNetworkState) {
      console.log(`[Cache] Stale offline entry invalidated on reconnect: ${key}`);
      this.cache.delete(key);
      logCacheOperation('miss', key);
      return null;
    }

    console.log(`[Cache] Hit key: ${key} (age: ${age}ms)`);
    logCacheOperation('hit', key);
    return entry.data as T;
  }

  /**
   * Check if a key exists and is valid
   */
  has(key: string): boolean {
    return this.get(key) !== null;
  }

  /**
   * Delete a specific key
   */
  delete(key: string): void {
    this.cache.delete(key);
    console.log(`[Cache] Deleted key: ${key}`);
    logCacheOperation('delete', key);
  }

  /**
   * Clear all cache entries
   */
  clear(): void {
    const size = this.cache.size;
    this.cache.clear();
    console.log(`[Cache] Cleared ${size} entries`);
  }

  /**
   * BUG 5 FIX — Smart invalidation on network restore.
   *
   * Old behaviour: invalidateOnNetworkChange() wiped the ENTIRE in-memory cache
   * on both the 'online' and 'offline' events. For a conductor scanning 20+ cards
   * per minute, this caused a full re-fetch storm every time the bus passed through
   * a dead zone and reconnected.
   *
   * New behaviour: invalidateOfflineEntries() is called ONLY when coming back online.
   * It removes only entries that were cached while the device was offline
   * (lastNetworkState === false). Entries that were already cached while online
   * remain valid and are served from the in-memory cache as normal.
   */
  invalidateOfflineEntries(): void {
    let cleared = 0;
    for (const [key, entry] of this.cache.entries()) {
      if (!entry.lastNetworkState) {
        // Entry was cached while offline — may contain stale/estimated data
        this.cache.delete(key);
        cleared++;
      }
    }
    this.networkVersion++;
    if (cleared > 0) {
      console.log(`[Cache] Invalidated ${cleared} offline-era entries on network restore`);
    } else {
      console.log('[Cache] No offline entries to invalidate');
    }
  }

  /**
   * @deprecated Use invalidateOfflineEntries() instead.
   * Kept for backward compatibility — only call this when you explicitly need
   * a full cache flush (e.g. sign-out, trip end).
   */
  invalidateOnNetworkChange(): void {
    this.networkVersion++;
    this.cacheVersion++;
    console.log(`[Cache] Full cache invalidation (version: ${this.cacheVersion})`);
    this.clear();
  }

  /**
   * Increment cache version for manual invalidation
   */
  incrementVersion(): void {
    this.cacheVersion++;
    console.log(`[Cache] Version incremented to ${this.cacheVersion}`);
  }

  /**
   * Clear expired entries
   */
  clearExpired(): void {
    const now = Date.now();
    let cleared = 0;

    for (const [key, entry] of this.cache.entries()) {
      const age = now - entry.timestamp;
      if (age > entry.ttl) {
        this.cache.delete(key);
        cleared++;
      }
    }

    if (cleared > 0) {
      console.log(`[Cache] Cleared ${cleared} expired entries`);
    }
  }

  /**
   * Get cache statistics
   */
  getStats(): { size: number; keys: string[] } {
    return {
      size: this.cache.size,
      keys: Array.from(this.cache.keys())
    };
  }

  /**
   * Get or set pattern - fetch from cache if available, otherwise fetch and cache
   */
  async getOrSet<T>(
    key: string,
    fetchFn: () => Promise<T>,
    ttl?: number
  ): Promise<T> {
    const cached = this.get<T>(key);
    if (cached !== null) {
      return cached;
    }

    const data = await fetchFn();
    this.set(key, data, ttl);
    return data;
  }
}

// Export singleton instance
export const cache = new CacheService();

// Cache key generators for consistent key naming
export const CacheKeys = {
  // Card lookups
  card: (cardUid: string) => `card:${cardUid}`,
  cardBalance: (cardUid: string) => `card_balance:${cardUid}`,
  
  // Route information
  route: (terminal: string, destination: string) => `route:${terminal}:${destination}`,
  routeStops: (route: string) => `route_stops:${route}`,
  
  // Fare information
  fare: (passengerType: string) => `fare:${passengerType}`,
  baggageFees: () => `baggage_fees`,
  
  // Trip information
  trip: (tripId: string) => `trip:${tripId}`,
  busInfo: (busId: string) => `bus:${busId}`,
  
  // Temporary tickets
  ticket: (ticketUid: string) => `ticket:${ticketUid}`,
  
  // Staff/conductor info
  staff: (staffId: string) => `staff:${staffId}`,
};

// TTL constants (in milliseconds)
export const CacheTTL = {
  SHORT: 1 * 60 * 1000,        // 1 minute
  MEDIUM: 5 * 60 * 1000,       // 5 minutes
  LONG: 15 * 60 * 1000,        // 15 minutes
  VERY_LONG: 60 * 60 * 1000,   // 1 hour
};

// Auto-clear expired entries every 5 minutes
if (typeof window !== 'undefined') {
  setInterval(() => {
    cache.clearExpired();
  }, 5 * 60 * 1000);
}