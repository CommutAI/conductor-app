/**
 * Background Sync Service
 * Handles background synchronization of cached data when internet is connected
 * Uses periodic checks and network state changes to trigger sync operations
 */

import { offlineQueueService } from './offlineQueueService';
import { StorageService } from './storageService';
import { cache } from './cacheService';
import { realtimeService } from './realtimeService';

class BackgroundSyncService {
  private isInitialized = false;
  private syncInterval: NodeJS.Timeout | null = null;

  /**
   * Initialize the background sync service
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      console.log('[BackgroundSync] Already initialized');
      return;
    }

    try {
      // Set up periodic sync checks
      this.setupPeriodicSync();

      this.isInitialized = true;
      console.log('[BackgroundSync] Service initialized successfully');
    } catch (error) {
      console.error('[BackgroundSync] Initialization failed:', error);
      throw error;
    }
  }

  /**
   * Set up periodic sync checks every 5 minutes
   */
  private setupPeriodicSync(): void {
    // Clear any existing interval
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
    }

    // Check for sync every 5 minutes
    this.syncInterval = setInterval(async () => {
      if (navigator.onLine) {
        const pendingCount = offlineQueueService.getPendingCount();
        const hasUnsyncedTrip = StorageService.hasUnsyncedTripData();

        if (pendingCount > 0 || hasUnsyncedTrip) {
          console.log('[BackgroundSync] Periodic check found data to sync');
          await this.triggerBackgroundSync();
        }
      }
    }, 5 * 60 * 1000); // 5 minutes

    console.log('[BackgroundSync] Periodic sync configured (5 min intervals)');
  }

  /**
   * Trigger a background sync task
   */
  async triggerBackgroundSync(): Promise<void> {
    if (!navigator.onLine) {
      console.log('[BackgroundSync] Skipping sync - offline');
      return;
    }

    const pendingCount = offlineQueueService.getPendingCount();
    const hasUnsyncedTrip = StorageService.hasUnsyncedTripData();

    if (pendingCount === 0 && !hasUnsyncedTrip) {
      console.log('[BackgroundSync] No data to sync');
      return;
    }

    try {
      console.log('[BackgroundSync] Starting background sync task');

      // Execute sync in foreground as Capacitor Background Runner may not support direct dispatch
      // The background task will be triggered by the native system when network is available
      await this.performForegroundSync();

      console.log('[BackgroundSync] Sync completed');
    } catch (error) {
      console.error('[BackgroundSync] Failed to perform sync:', error);
    }
  }

  /**
   * Perform sync in foreground (fallback if background sync fails)
   */
  private async performForegroundSync(): Promise<void> {
    try {
      console.log('[BackgroundSync] Performing foreground sync');

      // Purge legacy offline scans if needed
      StorageService.purgeLegacyOfflineScansIfNeeded();

      // Sync trip state to database
      await StorageService.syncTripStateToDatabase();

      // Flush offline queue
      if (offlineQueueService.getPendingCount() > 0) {
        console.log('[BackgroundSync] Flushing offline queue...');
        const { success, failed } = await offlineQueueService.syncQueue();
        console.log(`[BackgroundSync] Queue sync: ${success} ok, ${failed} failed`);
      }

      // Sync trip end if needed
      if (StorageService.loadTripState()?.pendingTripEndSync) {
        console.log('[BackgroundSync] Syncing trip end...');
        await StorageService.syncTripEndToDatabase();
      }

      // Invalidate offline cache entries
      cache.invalidateOfflineEntries();

      // Reconnect realtime subscriptions
      realtimeService.reconnectAll();

      console.log('[BackgroundSync] Foreground sync completed');
    } catch (error) {
      console.error('[BackgroundSync] Foreground sync failed:', error);
    }
  }

  /**
   * Manual sync trigger (can be called from UI)
   */
  async manualSync(): Promise<{ success: number; failed: number }> {
    if (!navigator.onLine) {
      throw new Error('Cannot sync while offline');
    }

    try {
      // Perform immediate sync
      await this.performForegroundSync();

      // Return sync results
      const pendingCount = offlineQueueService.getPendingCount();
      return {
        success: pendingCount === 0 ? 1 : 0,
        failed: pendingCount,
      };
    } catch (error) {
      console.error('[BackgroundSync] Manual sync failed:', error);
      throw error;
    }
  }

  /**
   * Get sync status information
   */
  getSyncStatus(): {
    isOnline: boolean;
    pendingScans: number;
    hasUnsyncedTrip: boolean;
  } {
    return {
      isOnline: navigator.onLine,
      pendingScans: offlineQueueService.getPendingCount(),
      hasUnsyncedTrip: StorageService.hasUnsyncedTripData(),
    };
  }

  /**
   * Stop the background sync service
   */
  async stop(): Promise<void> {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }

    this.isInitialized = false;
    console.log('[BackgroundSync] Service stopped');
  }
}

// Export singleton instance
export const backgroundSyncService = new BackgroundSyncService();