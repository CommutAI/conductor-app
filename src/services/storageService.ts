// ─────────────────────────────────────────────────────────────────────────────
// Storage Service — Unified local persistence and sync for the CommutAI conductor app
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '../supabaseClient';
import { processScan, ScanResult } from './fareService';

// ── Types ─────────────────────────────────────────────────────────────────────

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
  currentTrip: {
    id: string;
    bus_id: string;
    conductor_id: string;
    started_at: string;
    ended_at: string | null;
    status: 'in_progress' | 'completed' | 'cancelled';
  } | null;
  currentBus: {
    id: string;
    plate_number: string;
    route: string;
    seat_capacity: number;
    status: string;
  } | null;
  validatedCount: number;
  fareCollected: number;
  savedAt: string;
}

export interface SyncProgress {
  total: number;
  processed: number;
  succeeded: number;
  failed: number;
}

export interface SyncResult {
  synced: number;
  failed: number;
  fareTotal: number;
  validatedCount: number;
}

// ── Keys ──────────────────────────────────────────────────────────────────────

const OFFLINE_SCANS_KEY = 'commutai_offline_scans';
const TRIP_STATE_KEY = 'commutai_trip_state';

// ── Storage Service ───────────────────────────────────────────────────────────

export class StorageService {
  // ── Network Status ───────────────────────────────────────────────────────────
  static isOnline(): boolean {
    return navigator.onLine;
  }

  // ── Scan Queue ──────────────────────────────────────────────────────────────
  static addOfflineScan(
    scannedUid: string,
    tripId: string,
    conductorId: string,
    busRoute?: string
  ): OfflineScan {
    const scans = this.getOfflineScans();
    const newScan: OfflineScan = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      scannedUid,
      tripId,
      conductorId,
      busRoute,
      timestamp: new Date().toISOString(),
      synced: false,
      syncAttempts: 0,
    };
    scans.push(newScan);
    this._write(OFFLINE_SCANS_KEY, scans);
    return newScan;
  }

  static getOfflineScans(): OfflineScan[] {
    return this._read<OfflineScan[]>(OFFLINE_SCANS_KEY) ?? [];
  }

  static getUnsyncedScans(): OfflineScan[] {
    return this.getOfflineScans().filter((s) => !s.synced);
  }

  static getPendingSyncCount(): number {
    return this.getUnsyncedScans().length;
  }

  static markAsSynced(scanId: string): void {
    const scans = this.getOfflineScans().map((s) =>
      s.id === scanId ? { ...s, synced: true, lastError: undefined } : s
    );
    this._write(OFFLINE_SCANS_KEY, scans);
  }

  static markSyncFailed(scanId: string, error: string): void {
    const scans = this.getOfflineScans().map((s) =>
      s.id === scanId
        ? { ...s, syncAttempts: s.syncAttempts + 1, lastError: error }
        : s
    );
    this._write(OFFLINE_SCANS_KEY, scans);
  }

  static removeSyncedScans(): void {
    const unsynced = this.getOfflineScans().filter((s) => !s.synced);
    this._write(OFFLINE_SCANS_KEY, unsynced);
  }

  static clearAllScans(): void {
    localStorage.removeItem(OFFLINE_SCANS_KEY);
  }

  // ── Trip State Cache ──────────────────────────────────────────────────────
  static saveTripState(state: Omit<CachedTripState, 'savedAt'>): void {
    this._write<CachedTripState>(TRIP_STATE_KEY, {
      ...state,
      savedAt: new Date().toISOString(),
    });
  }

  static loadTripState(): CachedTripState | null {
    return this._read<CachedTripState>(TRIP_STATE_KEY);
  }

  static clearTripState(): void {
    localStorage.removeItem(TRIP_STATE_KEY);
  }

  // ── Sync Trip State to Database ───────────────────────────────────────────────
  static async syncTripStateToDatabase(): Promise<boolean> {
    const cached = this.loadTripState();
    if (!cached?.currentTrip) {
      console.log('[StorageService] No cached trip to sync');
      return false;
    }

    // Don't sync completed trips - they're already handled by endTrip
    if (cached.currentTrip.status === 'completed' || cached.currentTrip.status === 'cancelled') {
      console.log('[StorageService] Cached trip is already ended, skipping sync');
      this.clearTripState();
      return false;
    }

    // Check if trip is too old (more than 1 hour) - don't sync stale trips
    const tripAge = Date.now() - new Date(cached.savedAt).getTime();
    const MAX_SYNC_AGE = 60 * 60 * 1000; // 1 hour
    if (tripAge > MAX_SYNC_AGE) {
      console.log('[StorageService] Cached trip is too old to sync, clearing');
      this.clearTripState();
      return false;
    }

    try {
      // Check if trip exists in database
      const { data: existingTrip } = await supabase
        .from('trips')
        .select('id, status, ended_at')
        .eq('id', cached.currentTrip.id)
        .single();

      if (existingTrip) {
        // Trip exists in database
        // If it's already completed in database, clear the cache
        if (existingTrip.status === 'completed' || existingTrip.status === 'cancelled') {
          console.log('[StorageService] Trip is already completed in database, clearing cache');
          this.clearTripState();
          return false;
        }
        
        // Trip exists and is in_progress, update if needed
        if (existingTrip.status !== cached.currentTrip.status) {
          await supabase
            .from('trips')
            .update({ 
              status: cached.currentTrip.status,
              ended_at: cached.currentTrip.ended_at 
            })
            .eq('id', cached.currentTrip.id);
          console.log('[StorageService] Synced trip status to database');
        }
      } else {
        // Trip doesn't exist in database, recreate it (only if in_progress)
        if (cached.currentTrip.status === 'in_progress') {
          const { error } = await supabase
            .from('trips')
            .insert({
              id: cached.currentTrip.id,
              bus_id: cached.currentTrip.bus_id,
              conductor_id: cached.currentTrip.conductor_id,
              started_at: cached.currentTrip.started_at,
              ended_at: cached.currentTrip.ended_at,
              status: cached.currentTrip.status,
            });

          if (error) {
            console.error('[StorageService] Failed to recreate trip in database:', error);
            return false;
          }
          console.log('[StorageService] Recreated trip in database from cache');
        } else {
          console.log('[StorageService] Cached trip is not in_progress, skipping recreation');
          this.clearTripState();
          return false;
        }
      }

      return true;
    } catch (err) {
      console.error('[StorageService] Error syncing trip state:', err);
      return false;
    }
  }

  // ── Sync Operations ─────────────────────────────────────────────────────────
  static async syncOfflineScans(
    onProgress?: (progress: SyncProgress) => void
  ): Promise<SyncResult> {
    const pending = this.getUnsyncedScans();

    const result: SyncResult = {
      synced: 0,
      failed: 0,
      fareTotal: 0,
      validatedCount: 0,
    };

    for (let i = 0; i < pending.length; i++) {
      const scan = pending[i];

      onProgress?.({
        total: pending.length,
        processed: i,
        succeeded: result.synced,
        failed: result.failed,
      });

      try {
        const scanResult: ScanResult = await processScan(
          scan.scannedUid,
          scan.tripId,
          scan.conductorId,
          scan.busRoute
        );

        if (
          scanResult.status === 'qr_pass' ||
          scanResult.status === 'ticket_validated'
        ) {
          const fare =
            scanResult.status === 'qr_pass'
              ? scanResult.fare
              : scanResult.fareAmount;
          result.fareTotal += fare;
          result.validatedCount += 1;
        }

        this.markAsSynced(scan.id);
        result.synced += 1;
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        this.markSyncFailed(scan.id, errMsg);
        result.failed += 1;
        console.warn(`[StorageService] Failed to sync scan ${scan.id}:`, errMsg);
      }
    }

    this.removeSyncedScans();

    onProgress?.({
      total: pending.length,
      processed: pending.length,
      succeeded: result.synced,
      failed: result.failed,
    });

    return result;
  }

  // ── Internal Helpers ──────────────────────────────────────────────────────
  private static _write<T>(key: string, value: T): void {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (err) {
      console.error(`[StorageService] Failed to write "${key}":`, err);
    }
  }

  private static _read<T>(key: string): T | null {
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch (err) {
      console.error(`[StorageService] Failed to read "${key}":`, err);
      return null;
    }
  }
}

// ── Network Event Helpers ─────────────────────────────────────────────────────
export function setupNetworkListeners(
  onOnline: () => void,
  onOffline: () => void
): () => void {
  window.addEventListener('online', onOnline);
  window.addEventListener('offline', onOffline);
  return () => {
    window.removeEventListener('online', onOnline);
    window.removeEventListener('offline', onOffline);
  };
}
