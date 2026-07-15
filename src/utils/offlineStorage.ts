// ─────────────────────────────────────────────────────────────────────────────
// Offline Storage — Unified local persistence for the CommutAI conductor app
// ─────────────────────────────────────────────────────────────────────────────

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

// ── Keys ──────────────────────────────────────────────────────────────────────
const OFFLINE_SCANS_KEY = 'commutai_offline_scans';
const TRIP_STATE_KEY = 'commutai_trip_state';

// ── Trip State Cache ───────────────────────────────────────────────────────────
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

// ─────────────────────────────────────────────────────────────────────────────
export class OfflineStorage {
  // ── Network status ───────────────────────────────────────────────────────
  static isOnline(): boolean {
    return navigator.onLine;
  }

  // ── Scan queue ────────────────────────────────────────────────────────────
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

  // ── Trip state cache ──────────────────────────────────────────────────────
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

  // ── Internal helpers ──────────────────────────────────────────────────────
  private static _write<T>(key: string, value: T): void {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (err) {
      console.error(`[OfflineStorage] Failed to write "${key}":`, err);
    }
  }

  private static _read<T>(key: string): T | null {
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch (err) {
      console.error(`[OfflineStorage] Failed to read "${key}":`, err);
      return null;
    }
  }
}

// ── Network event helpers ─────────────────────────────────────────────────────
export function setupOfflineListeners(
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
