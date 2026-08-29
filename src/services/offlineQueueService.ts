import { supabase } from '../supabaseClient';

export interface QueuedScan {
  id: string;
  type: 'boarding' | 'alighting';
  cardId?: string;
  tempTicketId?: string;
  cardUid?: string;
  ticketUid?: string;
  fare?: number;
  baggageFee?: number;
  paymentMethod?: string;
  destination?: string;
  tripId?: string;
  timestamp: string;
  status: 'pending' | 'syncing' | 'failed';
  error?: string;
  retryCount: number;
}

const QUEUE_STORAGE_KEY = 'offline_scan_queue';
const MAX_RETRY_COUNT = 3;

class OfflineQueueService {
  private queue: QueuedScan[] = [];
  private isSyncing = false;
  private listeners: Set<(queue: QueuedScan[]) => void> = new Set();
  private saveTimeout: NodeJS.Timeout | null = null;
  private pendingSave = false;

  constructor() {
    this.loadQueue();
  }

  /**
   * Load queue from localStorage with validation
   */
  private loadQueue() {
    try {
      const stored = localStorage.getItem(QUEUE_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        // Validate that it's an array
        if (Array.isArray(parsed)) {
          this.queue = parsed;
          console.log('[OfflineQueue] Loaded queue:', this.queue.length, 'items');
        } else {
          console.error('[OfflineQueue] Invalid queue data format, resetting');
          this.queue = [];
        }
      }
    } catch (error) {
      console.error('[OfflineQueue] Error loading queue:', error);
      this.queue = []; // Reset on error
    }
  }

  /**
   * Save queue to localStorage with debouncing and atomic write
   */
  private saveQueue() {
    // Debounce saves to prevent localStorage thrashing during normal operation
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
    }

    this.saveTimeout = setTimeout(() => {
      this._persistQueue();
    }, 100); // 100ms debounce for normal saves
  }

  /**
   * BUG 10 FIX: Write the queue synchronously without any debounce delay.
   * Used during active sync to ensure status changes (syncing/failed/pending)
   * are persisted immediately. If the debounced saveQueue() was used during
   * sync and the app crashed within the 100ms window, a scan's status change
   * would be lost and the same scan could be re-submitted on the next sync.
   */
  private saveImmediate() {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
      this.saveTimeout = null;
    }
    this._persistQueue();
  }

  private _persistQueue() {
    try {
      const queueJson = JSON.stringify(this.queue);
      localStorage.setItem(QUEUE_STORAGE_KEY, queueJson);
      this.notifyListeners();
      console.log('[OfflineQueue] Queue saved:', this.queue.length, 'items');
    } catch (error) {
      if (error instanceof Error && error.name === 'QuotaExceededError') {
        console.error('[OfflineQueue] Storage quota exceeded, attempting cleanup');
        this.cleanupOldScans();
        try {
          localStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(this.queue));
          this.notifyListeners();
        } catch (retryError) {
          console.error('[OfflineQueue] Failed to save queue even after cleanup:', retryError);
        }
      } else {
        console.error('[OfflineQueue] Error saving queue:', error);
      }
    }
  }

  /**
   * Cleanup old failed scans to free space
   */
  private cleanupOldScans() {
    const maxQueueSize = 1000;
    if (this.queue.length > maxQueueSize) {
      // Keep most recent items, remove oldest failed ones first
      const failedScans = this.queue.filter(s => s.status === 'failed').sort((a, b) => 
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
      );
      
      const toRemove = this.queue.length - maxQueueSize;
      if (toRemove > 0 && failedScans.length > 0) {
        const idsToRemove = failedScans.slice(0, toRemove).map(s => s.id);
        this.queue = this.queue.filter(s => !idsToRemove.includes(s.id));
        console.log('[OfflineQueue] Cleaned up', toRemove, 'old failed scans');
      }
    }
  }

  /**
   * Notify all listeners of queue changes
   */
  private notifyListeners() {
    this.listeners.forEach(listener => listener([...this.queue]));
  }

  /**
   * Add a scan to the offline queue with atomic operation
   */
  addScan(scan: Omit<QueuedScan, 'id' | 'timestamp' | 'status' | 'retryCount'>): string {
    const queuedScan: QueuedScan = {
      ...scan,
      id: `queue_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date().toISOString(),
      status: 'pending',
      retryCount: 0,
    };

    // Atomic add operation
    const newQueue = [...this.queue, queuedScan];
    this.queue = newQueue;
    this.saveQueue();
    console.log('[OfflineQueue] Added scan to queue:', queuedScan.id);
    return queuedScan.id;
  }

  /**
   * Remove a scan from the queue with atomic operation
   */
  removeScan(id: string) {
    const newQueue = this.queue.filter(scan => scan.id !== id);
    this.queue = newQueue;
    if (this.isSyncing) {
      this.saveImmediate();
    } else {
      this.saveQueue();
    }
    console.log('[OfflineQueue] Removed scan from queue:', id);
  }

  /**
   * Check if a boarding for this card/ticket is already queued (pending or syncing).
   */
  hasPendingBoarding(tripId: string, cardUid?: string, ticketUid?: string): boolean {
    const normalizedCard = cardUid?.toUpperCase();
    const normalizedTicket = ticketUid?.toUpperCase();
    if (!normalizedCard && !normalizedTicket) return false;

    return this.queue.some(
      (scan) =>
        scan.type === 'boarding' &&
        scan.tripId === tripId &&
        (scan.status === 'pending' || scan.status === 'syncing') &&
        ((normalizedCard && scan.cardUid?.toUpperCase() === normalizedCard) ||
          (normalizedTicket && scan.ticketUid?.toUpperCase() === normalizedTicket)),
    );
  }

  /**
   * Get all queued scans
   */
  getQueue(): QueuedScan[] {
    return [...this.queue];
  }

  /**
   * Get pending scans count
   */
  getPendingCount(): number {
    return this.queue.filter(scan => scan.status === 'pending').length;
  }

  /**
   * Sync all pending scans to the server
   */
  async syncQueue(): Promise<{ success: number; failed: number }> {
    if (this.isSyncing) {
      console.log('[OfflineQueue] Already syncing, skipping');
      return { success: 0, failed: 0 };
    }

    const pendingScans = this.queue.filter(scan => scan.status === 'pending');
    if (pendingScans.length === 0) {
      console.log('[OfflineQueue] No pending scans to sync');
      return { success: 0, failed: 0 };
    }

    this.isSyncing = true;
    console.log('[OfflineQueue] Starting sync for', pendingScans.length, 'scans');

    let successCount = 0;
    let failedCount = 0;

    for (const scan of pendingScans) {
      if (!navigator.onLine) {
        console.log('[OfflineQueue] Network lost mid-sync, stopping');
        break;
      }

      try {
        scan.status = 'syncing';
        this.saveImmediate(); // BUG 10 FIX: use immediate save during sync (no debounce)

        await this.syncSingleScan(scan);

        // Remove successfully synced scan
        this.removeScan(scan.id);
        successCount++;
        console.log('[OfflineQueue] Successfully synced scan:', scan.id);
      } catch (error) {
        scan.status = 'failed';
        scan.error = error instanceof Error ? error.message : 'Unknown error';
        scan.retryCount++;

        if (scan.retryCount >= MAX_RETRY_COUNT) {
          console.error('[OfflineQueue] Scan failed after max retries:', scan.id, scan.error);
          // Keep it in queue but mark as failed for manual review
        } else {
          // Reset to pending for retry
          scan.status = 'pending';
          console.warn('[OfflineQueue] Scan failed, will retry later:', scan.id, scan.error);
        }

        this.saveImmediate(); // BUG 10 FIX: persist failure status immediately
        failedCount++;
      }
    }

    this.isSyncing = false;
    console.log('[OfflineQueue] Sync complete:', { success: successCount, failed: failedCount });
    return { success: successCount, failed: failedCount };
  }

  /**
   * Sync a single scan based on its type
   */
  private async syncSingleScan(scan: QueuedScan): Promise<void> {
    if (scan.type === 'boarding') {
      await this.syncBoardingScan(scan);
    } else if (scan.type === 'alighting') {
      await this.syncAlightingScan(scan);
    }
  }

  /**
   * Resolve card/ticket IDs from UIDs when missing (older queued scans).
   */
  private async resolveBoardingIds(
    scan: QueuedScan,
  ): Promise<{ cardId?: string; tempTicketId?: string }> {
    let cardId = scan.cardId;
    let tempTicketId = scan.tempTicketId;

    if (!cardId && scan.cardUid) {
      const { data: card } = await supabase
        .from('qr_cards')
        .select('id')
        .eq('card_uid', scan.cardUid.toUpperCase())
        .maybeSingle();
      cardId = card?.id;
    }

    if (!tempTicketId && scan.ticketUid) {
      const { data: ticket } = await supabase
        .from('temporary_tickets')
        .select('id')
        .eq('ticket_uid', scan.ticketUid.toUpperCase())
        .maybeSingle();
      tempTicketId = ticket?.id;
    }

    return { cardId, tempTicketId };
  }

  /**
   * Sync a boarding scan with atomic transaction support
   */
  private async syncBoardingScan(scan: QueuedScan): Promise<void> {
    if (!scan.tripId) {
      throw new Error('Trip ID is required for boarding scan');
    }

    const { cardId, tempTicketId } = await this.resolveBoardingIds(scan);
    if (!cardId && !tempTicketId) {
      throw new Error('Card or ticket ID required for offline boarding sync');
    }

    // Check if passenger already boarded
    let existingQuery = supabase
      .from('boarded_passengers')
      .select('id')
      .eq('trip_id', scan.tripId)
      .is('alighted_at', null);

    if (cardId) {
      existingQuery = existingQuery.eq('card_id', cardId);
    } else if (tempTicketId) {
      existingQuery = existingQuery.eq('temp_ticket_id', tempTicketId);
    }

    const { data: existingPassenger } = await existingQuery.maybeSingle();

    if (existingPassenger) {
      console.log('[OfflineQueue] Passenger already boarded, skipping:', scan.id);
      return;
    }

    const paymentMethod =
      scan.paymentMethod === 'cash' ? 'cash' : tempTicketId ? 'ticket' : 'qr_card';

    // Implement two-phase commit for atomicity
    let passengerId: string | null = null;

    try {
      // Phase 1: Insert boarded passenger (schema-aligned columns only)
      const { data: passengerData, error: passengerError } = await supabase
        .from('boarded_passengers')
        .insert({
          trip_id: scan.tripId,
          card_id: cardId ?? null,
          temp_ticket_id: tempTicketId ?? null,
          payment_method: paymentMethod,
          destination_stop: scan.destination || null,
          boarded_at: scan.timestamp,
        })
        .select('id')
        .single();

      if (passengerError && passengerError.code !== '23505') {
        throw passengerError;
      }

      passengerId = passengerData?.id || null;

      // Phase 2: Create transaction if fare was collected
      const totalAmount = (scan.fare || 0) + (scan.baggageFee || 0);
      if (totalAmount > 0 && passengerId) {
        const { error: txError } = await supabase.from('transactions').insert({
          trip_id: scan.tripId,
          card_id: cardId ?? null,
          temp_ticket_id: tempTicketId ?? null,
          amount: totalAmount,
          baggage_fee: scan.baggageFee || null,
          type: 'fare_validation',
          channel: scan.paymentMethod === 'cash' ? 'cash' : 'offline_sync',
          created_at: scan.timestamp,
        });

        if (txError && txError.code !== '23505') {
          console.error('[OfflineQueue] Transaction failed, rolling back passenger:', txError);
          await supabase.from('boarded_passengers').delete().eq('id', passengerId);
          throw txError;
        }
      }
    } catch (error) {
      if (passengerId) {
        try {
          await supabase.from('boarded_passengers').delete().eq('id', passengerId);
          console.log('[OfflineQueue] Rolled back passenger insertion due to error');
        } catch (rollbackError) {
          console.error('[OfflineQueue] Failed to rollback passenger:', rollbackError);
        }
      }
      throw error;
    }
  }

  /**
   * Sync an alighting scan
   */
  private async syncAlightingScan(scan: QueuedScan): Promise<void> {
    if (!scan.tripId) {
      throw new Error('Trip ID is required for alighting scan');
    }

    const { cardId, tempTicketId } = await this.resolveBoardingIds(scan);

    let findQuery = supabase
      .from('boarded_passengers')
      .select('id')
      .eq('trip_id', scan.tripId)
      .is('alighted_at', null);

    if (cardId) {
      findQuery = findQuery.eq('card_id', cardId);
    } else if (tempTicketId) {
      findQuery = findQuery.eq('temp_ticket_id', tempTicketId);
    } else {
      throw new Error('Card or ticket ID required for offline alighting sync');
    }

    const { data: passenger, error: findError } = await findQuery.maybeSingle();

    if (findError) {
      throw new Error(`Failed to find passenger: ${findError.message}`);
    }

    if (!passenger) {
      console.log('[OfflineQueue] Passenger not found or already alighted, skipping:', scan.id);
      return; // Skip if passenger doesn't exist (already alighted elsewhere)
    }

    // Update passenger as alighted with conflict resolution
    const { error: updateError } = await supabase
      .from('boarded_passengers')
      .update({
        alighted_at: scan.timestamp,
      })
      .eq('id', passenger.id);

    if (updateError) {
      // If already alighted, consider it a success (idempotent operation)
      if (updateError.message.includes('already alighted') || updateError.code === 'P0002') {
        console.log('[OfflineQueue] Passenger already alighted, treating as success:', scan.id);
        return;
      }
      throw new Error(`Failed to update passenger: ${updateError.message}`);
    }
  }

  /**
   * Clear all failed scans from the queue
   */
  clearFailed() {
    this.queue = this.queue.filter(scan => scan.status !== 'failed');
    this.saveQueue();
    console.log('[OfflineQueue] Cleared failed scans');
  }

  /**
   * Clear all scans from the queue
   */
  clearAll() {
    this.queue = [];
    this.saveQueue();
    console.log('[OfflineQueue] Cleared all scans');
  }

  /**
   * Subscribe to queue changes
   */
  subscribe(listener: (queue: QueuedScan[]) => void): () => void {
    this.listeners.add(listener);
    // Immediately call with current queue
    listener([...this.queue]);

    // Return unsubscribe function
    return () => {
      this.listeners.delete(listener);
    };
  }
}

export const offlineQueueService = new OfflineQueueService();
