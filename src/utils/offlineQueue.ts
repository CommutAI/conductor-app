/**
 * offlineQueue.ts
 *
 * Re-exports the unified offline scan queue from offlineStorage.ts.
 * Kept for backwards-compatibility with any existing imports.
 * New code should import directly from offlineStorage.ts.
 */

export type { OfflineScan as QueuedScan } from './offlineStorage';
export {
  OfflineStorage,
  setupOfflineListeners,
} from './offlineStorage';

// Legacy function aliases (kept for backwards compatibility)
import { OfflineStorage } from './offlineStorage';

export function enqueueOfflineScan(scan: {
  id: string;
  scannedUid: string;
  tripId: string;
  conductorId: string;
  scannedAt: string;
}): void {
  OfflineStorage.addOfflineScan(
    scan.scannedUid,
    scan.tripId,
    scan.conductorId
  );
}

export function getOfflineQueue() {
  return OfflineStorage.getOfflineScans();
}

export function clearOfflineQueue(): void {
  OfflineStorage.clearAllScans();
}

export function removeFromQueue(id: string): void {
  OfflineStorage.markAsSynced(id);
  OfflineStorage.removeSyncedScans();
}

export function isOnline(): boolean {
  return OfflineStorage.isOnline();
}
