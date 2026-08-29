import React, { createContext, useContext, useEffect, useState, useCallback, useRef, ReactNode } from 'react';
import { StorageService } from '../services/storageService';
import { offlineQueueService } from '../services/offlineQueueService';
import { cache } from '../services/cacheService';

interface NetworkContextType {
  isOnline: boolean;
  pendingCount: number;
  isSyncing: boolean;
  lastSyncAt: number | null;
  triggerSync: () => Promise<void>;
  bumpPending: (count?: number) => void;
  syncInProgress: boolean;
}

const NetworkContext = createContext<NetworkContextType | undefined>(undefined);

export function NetworkProvider({ children }: { children: ReactNode }) {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [pendingCount, setPendingCount] = useState(offlineQueueService.getPendingCount());
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncInProgress, setSyncInProgress] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null);
  const syncingRef = useRef(false);
  const syncTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const refreshPendingCount = useCallback(() => {
    setPendingCount(offlineQueueService.getPendingCount());
  }, []);

  const triggerSync = useCallback(async (): Promise<void> => {
    if (!navigator.onLine || syncingRef.current) {
      console.log('[NetworkContext] Sync skipped - offline or already syncing');
      return;
    }

    StorageService.purgeLegacyOfflineScansIfNeeded();

    const pendingScans = offlineQueueService.getPendingCount();
    const hasCachedTrip = !!StorageService.loadTripState()?.currentTrip;

    if (pendingScans === 0 && !hasCachedTrip) {
      console.log('[NetworkContext] Sync skipped - no pending scans or cached trip');
      return;
    }

    syncingRef.current = true;
    setIsSyncing(true);
    setSyncInProgress(true);

    try {
      // Phase 1: Ensure offline-started trip exists in DB before scan inserts
      await StorageService.syncTripStateToDatabase();

      // Phase 2: Flush the typed boarding/alighting queue
      if (offlineQueueService.getPendingCount() > 0) {
        console.log('[NetworkContext] Flushing offlineQueueService...');
        const { success, failed } = await offlineQueueService.syncQueue();
        console.log(`[NetworkContext] offlineQueueService sync: ${success} ok, ${failed} failed`);
      }

      refreshPendingCount();
      setLastSyncAt(Date.now());
    } catch (err) {
      console.error('[NetworkContext] Sync failed:', err);
    } finally {
      syncingRef.current = false;
      setIsSyncing(false);
      setSyncInProgress(false);
    }
  }, [refreshPendingCount]);

  useEffect(() => {
    StorageService.purgeLegacyOfflineScansIfNeeded();

    function handleOnline() {
      setIsOnline(true);
      cache.invalidateOfflineEntries();

      if (syncTimeoutRef.current) {
        clearTimeout(syncTimeoutRef.current);
      }
      syncTimeoutRef.current = setTimeout(() => {
        triggerSync();
      }, 1000);
    }

    function handleOffline() {
      setIsOnline(false);
      if (syncTimeoutRef.current) {
        clearTimeout(syncTimeoutRef.current);
        syncTimeoutRef.current = null;
      }
    }

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    const interval = setInterval(refreshPendingCount, 10_000);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      clearInterval(interval);
      if (syncTimeoutRef.current) {
        clearTimeout(syncTimeoutRef.current);
      }
    };
  }, [triggerSync, refreshPendingCount]);

  const bumpPending = useCallback(
    (count?: number) => {
      if (count !== undefined) {
        setPendingCount(count);
      } else {
        refreshPendingCount();
      }
    },
    [refreshPendingCount],
  );

  return (
    <NetworkContext.Provider
      value={{
        isOnline,
        pendingCount,
        isSyncing,
        lastSyncAt,
        triggerSync,
        bumpPending,
        syncInProgress,
      }}
    >
      {children}
    </NetworkContext.Provider>
  );
}

export function useNetwork() {
  const ctx = useContext(NetworkContext);
  if (!ctx) throw new Error('useNetwork must be used within NetworkProvider');
  return ctx;
}
