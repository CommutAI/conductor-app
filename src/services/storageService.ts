// ─────────────────────────────────────────────────────────────────────────────
// Storage Service — Unified local persistence and sync for the CommutAI conductor app
// Enhanced with message queue patterns for offline scan synchronization
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '../supabaseClient';
import { processScan, ScanResult } from './fareService';
import { observability } from './observability';

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
  priority?: 'high' | 'normal' | 'low'; // Message queue priority
  retryDelay?: number; // Exponential backoff delay
}

export interface LocalPassengerRecord {
  id: string;
  cardUid?: string;
  ticketUid?: string;
  cardId?: string;
  tempTicketId?: string;
  destination?: string;
  fare: number;
  baggageFee?: number;
  paymentMethod?: string;
  boardedAt: string;
  alightedAt?: string;
  isTicket: boolean;
}

export interface CachedTripHistoryEntry {
  id: string;
  started_at: string;
  ended_at?: string;
  status: 'completed' | 'cancelled';
  route: string;
  plate_number: string;
  starting_point?: string;
  end_point?: string;
  passenger_count: number;
  fare_collected: number;
  irregularities: number;
  passengers: LocalPassengerRecord[];
  pendingSync?: boolean;
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
  currentPassengersCount: number;
  fareCollected: number;
  savedAt: string;
  pendingTripEndSync?: boolean;
  endPoint?: string;
  startingPoint?: string;
  localPassengers?: LocalPassengerRecord[];
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
const TRIP_HISTORY_KEY = 'commutai_trip_history';
const OFFLINE_QUEUE_KEY = 'offline_scan_queue';
const CARD_CACHE_KEY = 'commutai_card_cache';

// ── Persistent Card Cache (survives app restarts, used for offline lookups) ───
export interface CachedCard {
  id: string;
  card_uid: string;
  balance: number;
  status: string;
  passenger_type: string;
  destination?: string;
  allowed_routes: string[];
  owner_name?: string;
  cachedAt: number;
}

export interface CachedTicket {
  id: string;
  ticket_uid: string;
  fare_amount: number;
  status: string;
  destination?: string;
  passenger_type?: string;
  cachedAt: number;
}

// ── Storage Service ───────────────────────────────────────────────────────────

const LEGACY_QUEUE_PURGED_KEY = 'commutai_legacy_queue_purged_v1';

export class StorageService {
  // ── Network Status ───────────────────────────────────────────────────────────
  static isOnline(): boolean {
    return navigator.onLine;
  }

  /**
   * One-time purge of the legacy offline scan queue (commutai_offline_scans).
   * ScanPage no longer writes to this queue (BUG 1 fix); leftover entries from
   * before that fix could duplicate boardings if synced alongside offlineQueueService.
   */
  static purgeLegacyOfflineScansIfNeeded(): void {
    if (localStorage.getItem(LEGACY_QUEUE_PURGED_KEY)) return;

    const legacy = this.getOfflineScans();
    if (legacy.length > 0) {
      console.warn(
        `[StorageService] Purging ${legacy.length} legacy offline scan(s) to prevent duplicate sync`,
      );
      localStorage.removeItem(OFFLINE_SCANS_KEY);
    }

    localStorage.setItem(LEGACY_QUEUE_PURGED_KEY, '1');
  }

  // ── Persistent Card/Ticket Cache (offline lookups) ────────────────────────
  static cacheCard(card: Omit<CachedCard, 'cachedAt'>): void {
    const all = this._read<Record<string, CachedCard>>(CARD_CACHE_KEY) ?? {};
    all[card.card_uid.toUpperCase()] = { ...card, cachedAt: Date.now() };
    this._write(CARD_CACHE_KEY, all);
  }

  static getCachedCard(cardUid: string): CachedCard | null {
    const all = this._read<Record<string, CachedCard>>(CARD_CACHE_KEY) ?? {};
    return all[cardUid.toUpperCase()] ?? null;
  }

  static cacheTicket(ticket: Omit<CachedTicket, 'cachedAt'>): void {
    const key = `ticket_${CARD_CACHE_KEY}`;
    const all = this._read<Record<string, CachedTicket>>(key) ?? {};
    all[ticket.ticket_uid.toUpperCase()] = { ...ticket, cachedAt: Date.now() };
    this._write(key, all);
  }

  static getCachedTicket(ticketUid: string): CachedTicket | null {
    const key = `ticket_${CARD_CACHE_KEY}`;
    const all = this._read<Record<string, CachedTicket>>(key) ?? {};
    return all[ticketUid.toUpperCase()] ?? null;
  }

  // ── Scan Queue with Message Queue Patterns ───────────────────────────────────
  static addOfflineScan(
    scannedUid: string,
    tripId: string,
    conductorId: string,
    busRoute?: string,
    priority: 'high' | 'normal' | 'low' = 'normal'
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
      priority,
      retryDelay: 1000, // Initial retry delay: 1 second
    };
    
    // Insert based on priority (high priority first)
    const priorityOrder = { high: 0, normal: 1, low: 2 };
    let insertIndex = scans.length;
    
    for (let i = 0; i < scans.length; i++) {
      if (priorityOrder[priority] < priorityOrder[scans[i].priority || 'normal']) {
        insertIndex = i;
        break;
      }
    }
    
    scans.splice(insertIndex, 0, newScan);
    this._write(OFFLINE_SCANS_KEY, scans);
    
    observability.info('Offline scan added to queue', {
      scanId: newScan.id,
      priority,
      queueSize: scans.length
    });
    observability.recordMetric('offline_queue_size', scans.length);
    
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
    const scans = this.getOfflineScans().map((s) => {
      if (s.id === scanId) {
        // Implement exponential backoff: delay doubles with each attempt
        const newRetryDelay = Math.min(
          (s.retryDelay || 1000) * 2,
          60000 // Max delay: 1 minute
        );
        
        observability.warn('Offline scan sync failed', {
          scanId,
          attempt: s.syncAttempts + 1,
          error,
          nextRetryDelay: newRetryDelay
        });
        
        return {
          ...s,
          syncAttempts: s.syncAttempts + 1,
          lastError: error,
          retryDelay: newRetryDelay
        };
      }
      return s;
    });
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
    const existing = this.loadTripState();
    this._write<CachedTripState>(TRIP_STATE_KEY, {
      currentTrip: state.currentTrip,
      currentBus: state.currentBus,
      validatedCount: state.validatedCount,
      currentPassengersCount: state.currentPassengersCount ?? existing?.currentPassengersCount ?? 0,
      fareCollected: state.fareCollected,
      localPassengers: state.localPassengers ?? existing?.localPassengers ?? [],
      pendingTripEndSync: state.pendingTripEndSync ?? existing?.pendingTripEndSync,
      endPoint: state.endPoint ?? existing?.endPoint,
      startingPoint: state.startingPoint ?? existing?.startingPoint,
      savedAt: new Date().toISOString(),
    });
  }

  static hasPendingScans(): boolean {
    try {
      const raw = localStorage.getItem(OFFLINE_QUEUE_KEY);
      if (!raw) return false;
      const queue = JSON.parse(raw);
      return Array.isArray(queue) && queue.some((s: { status?: string }) => s.status === 'pending');
    } catch {
      return false;
    }
  }

  static hasUnsyncedTripData(): boolean {
    const cached = this.loadTripState();
    if (!cached?.currentTrip) return false;
    return (
      cached.pendingTripEndSync === true ||
      cached.currentTrip.status === 'in_progress' ||
      this.hasPendingScans()
    );
  }

  static addLocalPassenger(tripId: string, passenger: Omit<LocalPassengerRecord, 'id'>): void {
    const cached = this.loadTripState();
    if (!cached?.currentTrip || cached.currentTrip.id !== tripId) return;

    const passengers = [...(cached.localPassengers ?? [])];
    passengers.push({
      ...passenger,
      id: `local_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    });

    this.saveTripState({ ...cached, localPassengers: passengers });
  }

  static markLocalAlighted(
    tripId: string,
    cardUid?: string,
    ticketUid?: string,
  ): boolean {
    const cached = this.loadTripState();
    if (!cached?.currentTrip || cached.currentTrip.id !== tripId) return false;

    const cardNorm = cardUid?.toUpperCase();
    const ticketNorm = ticketUid?.toUpperCase();
    let found = false;

    const passengers = (cached.localPassengers ?? []).map((p) => {
      if (p.alightedAt) return p;
      const match =
        (cardNorm && p.cardUid?.toUpperCase() === cardNorm) ||
        (ticketNorm && p.ticketUid?.toUpperCase() === ticketNorm);
      if (match) {
        found = true;
        return { ...p, alightedAt: new Date().toISOString() };
      }
      return p;
    });

    if (found) {
      this.saveTripState({ ...cached, localPassengers: passengers });
    }
    return found;
  }

  static isLocallyBoarded(tripId: string, cardUid?: string, ticketUid?: string): boolean {
    const cached = this.loadTripState();
    if (!cached?.currentTrip || cached.currentTrip.id !== tripId) return false;

    const cardNorm = cardUid?.toUpperCase();
    const ticketNorm = ticketUid?.toUpperCase();

    return (cached.localPassengers ?? []).some(
      (p) =>
        !p.alightedAt &&
        ((cardNorm && p.cardUid?.toUpperCase() === cardNorm) ||
          (ticketNorm && p.ticketUid?.toUpperCase() === ticketNorm)),
    );
  }

  static getLocalPassengers(tripId: string): LocalPassengerRecord[] {
    const cached = this.loadTripState();
    if (!cached?.currentTrip || cached.currentTrip.id !== tripId) return [];
    return cached.localPassengers ?? [];
  }

  static archiveCompletedTrip(): void {
    const cached = this.loadTripState();
    if (!cached?.currentTrip || !cached.currentBus) return;
    if (cached.currentTrip.status !== 'completed') return;

    const history = this.getTripHistory();
    const entry: CachedTripHistoryEntry = {
      id: cached.currentTrip.id,
      started_at: cached.currentTrip.started_at,
      ended_at: cached.currentTrip.ended_at ?? undefined,
      status: 'completed',
      route: cached.currentBus.route,
      plate_number: cached.currentBus.plate_number,
      starting_point: cached.startingPoint,
      end_point: cached.endPoint,
      passenger_count: cached.validatedCount,
      fare_collected: cached.fareCollected,
      irregularities: 0,
      passengers: cached.localPassengers ?? [],
      pendingSync: true,
    };

    const withoutDup = history.filter((t) => t.id !== entry.id);
    this._write<CachedTripHistoryEntry[]>(TRIP_HISTORY_KEY, [entry, ...withoutDup]);
  }

  static getTripHistory(): CachedTripHistoryEntry[] {
    return this._read<CachedTripHistoryEntry[]>(TRIP_HISTORY_KEY) ?? [];
  }

  static getTripHistoryEntry(tripId: string): CachedTripHistoryEntry | null {
    return this.getTripHistory().find((t) => t.id === tripId) ?? null;
  }

  static markTripHistorySynced(tripId: string): void {
    const history = this.getTripHistory().map((t) =>
      t.id === tripId ? { ...t, pendingSync: false } : t,
    );
    this._write(TRIP_HISTORY_KEY, history);
  }

  static getTripHistoryForDisplay(segment: 'all' | 'today'): CachedTripHistoryEntry[] {
    const history = this.getTripHistory();
    if (segment === 'all') return history;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    return history.filter((t) => {
      const started = new Date(t.started_at);
      return started >= today && started < tomorrow;
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

    // Completed trips with pending end sync are handled by syncTripEndToDatabase
    if (cached.currentTrip.status === 'completed' && cached.pendingTripEndSync) {
      return true;
    }

    if (cached.currentTrip.status === 'completed' && !this.hasPendingScans()) {
      return false;
    }

    try {
      const { data: existingTrip } = await supabase
        .from('trips')
        .select('id, status, ended_at')
        .eq('id', cached.currentTrip.id)
        .maybeSingle();

      if (existingTrip) {
        if (existingTrip.status === 'completed' || existingTrip.status === 'cancelled') {
          if (!this.hasPendingScans()) {
            this.clearTripState();
          }
          return false;
        }
        return true;
      }

      // Trip not in DB — insert as in_progress so scan FK references work
      const { error } = await supabase.from('trips').insert({
        id: cached.currentTrip.id,
        bus_id: cached.currentTrip.bus_id,
        conductor_id: cached.currentTrip.conductor_id,
        started_at: cached.currentTrip.started_at,
        status: 'in_progress',
        starting_point: cached.startingPoint ?? null,
      });

      if (error) {
        console.error('[StorageService] Failed to insert trip in database:', error);
        return false;
      }
      console.log('[StorageService] Inserted offline trip into database');
      return true;
    } catch (err) {
      console.error('[StorageService] Error syncing trip state:', err);
      return false;
    }
  }

  static async syncTripEndToDatabase(): Promise<boolean> {
    const cached = this.loadTripState();
    if (!cached?.currentTrip || !cached.pendingTripEndSync) {
      return false;
    }

    try {
      await this.syncTripStateToDatabase();

      const { error } = await supabase
        .from('trips')
        .update({
          status: 'completed',
          ended_at: cached.currentTrip.ended_at ?? new Date().toISOString(),
          end_point: cached.endPoint ?? null,
        })
        .eq('id', cached.currentTrip.id);

      if (error) {
        console.error('[StorageService] Failed to sync trip end:', error);
        return false;
      }

      this.markTripHistorySynced(cached.currentTrip.id);
      this.clearTripState();
      console.log('[StorageService] Trip end synced to database');
      return true;
    } catch (err) {
      console.error('[StorageService] Error syncing trip end:', err);
      return false;
    }
  }

  // ── Enhanced Sync Operations with Message Queue Patterns ─────────────────────
  static async syncOfflineScans(
    onProgress?: (progress: SyncProgress) => void
  ): Promise<SyncResult> {
    const pending = this.getUnsyncedScans();
    
    observability.info('Starting offline scan sync', { 
      pendingCount: pending.length,
      timestamp: new Date().toISOString()
    });

    const result: SyncResult = {
      synced: 0,
      failed: 0,
      fareTotal: 0,
      validatedCount: 0,
    };

    // Filter out scans that have exceeded max retry attempts (dead letter queue)
    const MAX_RETRY_ATTEMPTS = 5;
    const activeScans = pending.filter(scan => scan.syncAttempts < MAX_RETRY_ATTEMPTS);
    const deadLetterScans = pending.filter(scan => scan.syncAttempts >= MAX_RETRY_ATTEMPTS);
    
    if (deadLetterScans.length > 0) {
      observability.error('Scans moved to dead letter queue', {
        count: deadLetterScans.length,
        scanIds: deadLetterScans.map(s => s.id)
      });
      observability.recordMetric('dead_letter_queue_size', deadLetterScans.length);
    }

    for (let i = 0; i < activeScans.length; i++) {
      const scan = activeScans[i];

      onProgress?.({
        total: activeScans.length,
        processed: i,
        succeeded: result.synced,
        failed: result.failed,
      });

      // Implement retry delay based on exponential backoff
      if (scan.retryDelay && scan.syncAttempts > 0) {
        observability.debug(`Applying retry delay for scan ${scan.id}`, {
          delay: scan.retryDelay,
          attempt: scan.syncAttempts
        });
        await new Promise(resolve => setTimeout(resolve, scan.retryDelay));
      }

      try {
        const endTimer = observability.startTimer('offline_scan_sync');
        
        const scanResult: ScanResult = await processScan(
          scan.scannedUid,
          scan.tripId,
          scan.conductorId,
          scan.busRoute
        );
        
        endTimer();

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
          
          observability.info('Offline scan synced successfully', {
            scanId: scan.id,
            fare,
            totalFare: result.fareTotal
          });
          observability.recordMetric('offline_scan_sync_success', 1);
        }

        this.markAsSynced(scan.id);
        result.synced += 1;
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        this.markSyncFailed(scan.id, errMsg);
        result.failed += 1;
        
        observability.error('Failed to sync offline scan', {
          scanId: scan.id,
          error: errMsg,
          attempt: scan.syncAttempts + 1
        });
        observability.recordMetric('offline_scan_sync_error', 1);
        
        console.warn(`[StorageService] Failed to sync scan ${scan.id}:`, errMsg);
      }
    }

    this.removeSyncedScans();
    
    observability.info('Offline scan sync completed', {
      total: activeScans.length,
      synced: result.synced,
      failed: result.failed,
      fareTotal: result.fareTotal,
      deadLetterCount: deadLetterScans.length
    });
    observability.recordMetric('offline_sync_total', result.synced + result.failed);
    observability.recordMetric('offline_sync_success_rate', 
      (result.synced / (result.synced + result.failed)) * 100
    );

    onProgress?.({
      total: activeScans.length,
      processed: activeScans.length,
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
