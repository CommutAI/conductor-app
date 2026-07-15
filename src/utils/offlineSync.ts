/**
 * offlineSync.ts
 * Single entry-point for flushing the offline scan queue to Supabase.
 * Called when the device regains network connectivity.
 */

import { OfflineStorage, OfflineScan } from './offlineStorage';
import { processScan, ScanResult } from './scanProcessor';

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

/**
 * Processes every unsynced scan in the offline queue.
 *
 * @param onProgress  Optional callback called after each item is processed.
 * @returns           Summary of what was synced.
 */
export async function syncOfflineScans(
  onProgress?: (progress: SyncProgress) => void
): Promise<SyncResult> {
  const pending = OfflineStorage.getUnsyncedScans();

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

      OfflineStorage.markAsSynced(scan.id);
      result.synced += 1;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      OfflineStorage.markSyncFailed(scan.id, errMsg);
      result.failed += 1;
      console.warn(`[offlineSync] Failed to sync scan ${scan.id}:`, errMsg);
    }
  }

  // Clean up fully-synced records to keep localStorage lean
  OfflineStorage.removeSyncedScans();

  onProgress?.({
    total: pending.length,
    processed: pending.length,
    succeeded: result.synced,
    failed: result.failed,
  });

  return result;
}
