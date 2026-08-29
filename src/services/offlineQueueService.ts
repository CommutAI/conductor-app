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

  constructor() {
    this.loadQueue();
  }

  /**
   * Load queue from localStorage
   */
  private loadQueue() {
    try {
      const stored = localStorage.getItem(QUEUE_STORAGE_KEY);
      if (stored) {
        this.queue = JSON.parse(stored);
        console.log('[OfflineQueue] Loaded queue:', this.queue.length, 'items');
      }
    } catch (error) {
      console.error('[OfflineQueue] Error loading queue:', error);
    }
  }

  /**
   * Save queue to localStorage
   */
  private saveQueue() {
    try {
      localStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(this.queue));
      this.notifyListeners();
    } catch (error) {
      console.error('[OfflineQueue] Error saving queue:', error);
    }
  }

  /**
   * Notify all listeners of queue changes
   */
  private notifyListeners() {
    this.listeners.forEach(listener => listener([...this.queue]));
  }

  /**
   * Add a scan to the offline queue
   */
  addScan(scan: Omit<QueuedScan, 'id' | 'timestamp' | 'status' | 'retryCount'>): string {
    const queuedScan: QueuedScan = {
      ...scan,
      id: `queue_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date().toISOString(),
      status: 'pending',
      retryCount: 0,
    };

    this.queue.push(queuedScan);
    this.saveQueue();
    console.log('[OfflineQueue] Added scan to queue:', queuedScan.id);
    return queuedScan.id;
  }

  /**
   * Remove a scan from the queue
   */
  removeScan(id: string) {
    this.queue = this.queue.filter(scan => scan.id !== id);
    this.saveQueue();
    console.log('[OfflineQueue] Removed scan from queue:', id);
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
      try {
        scan.status = 'syncing';
        this.saveQueue();

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

        this.saveQueue();
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
   * Sync a boarding scan
   */
  private async syncBoardingScan(scan: QueuedScan): Promise<void> {
    if (!scan.tripId) {
      throw new Error('Trip ID is required for boarding scan');
    }

    // Check if passenger already boarded
    const { data: existingPassenger } = await supabase
      .from('boarded_passengers')
      .select('id')
      .eq('trip_id', scan.tripId)
      .or(`card_uid.eq.${scan.cardUid},ticket_uid.eq.${scan.ticketUid}`)
      .is('alighted_at', null)
      .single();

    if (existingPassenger) {
      console.log('[OfflineQueue] Passenger already boarded, skipping:', scan.id);
      return;
    }

    // Insert boarded passenger
    const { error: passengerError } = await supabase
      .from('boarded_passengers')
      .insert({
        trip_id: scan.tripId,
        card_id: scan.cardId,
        temp_ticket_id: scan.tempTicketId,
        card_uid: scan.cardUid,
        ticket_uid: scan.ticketUid,
        fare: scan.fare,
        baggage_fee: scan.baggageFee,
        payment_method: scan.paymentMethod,
        boarded_at: scan.timestamp,
      });

    if (passengerError) throw passengerError;

    // Create transaction if fare was collected
    if (scan.fare && scan.fare > 0) {
      const { error: txError } = await supabase
        .from('transactions')
        .insert({
          trip_id: scan.tripId,
          card_id: scan.cardId,
          temp_ticket_id: scan.tempTicketId,
          amount: scan.fare,
          baggage_fee: scan.baggageFee,
          payment_method: scan.paymentMethod,
          type: 'fare_validation',
          channel: 'offline_sync',
          created_at: scan.timestamp,
        });

      if (txError) throw txError;
    }
  }

  /**
   * Sync an alighting scan
   */
  private async syncAlightingScan(scan: QueuedScan): Promise<void> {
    if (!scan.tripId) {
      throw new Error('Trip ID is required for alighting scan');
    }

    // Find the boarded passenger
    const { data: passenger, error: findError } = await supabase
      .from('boarded_passengers')
      .select('id')
      .eq('trip_id', scan.tripId)
      .or(`card_uid.eq.${scan.cardUid},ticket_uid.eq.${scan.ticketUid}`)
      .is('alighted_at', null)
      .single();

    if (findError || !passenger) {
      throw new Error('Passenger not found or already alighted');
    }

    // Update passenger as alighted
    const { error: updateError } = await supabase
      .from('boarded_passengers')
      .update({
        alighted_at: scan.timestamp,
      })
      .eq('id', passenger.id);

    if (updateError) throw updateError;
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
