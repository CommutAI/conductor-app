import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
  ReactNode,
} from 'react';
import { OfflineStorage } from '../utils/offlineStorage';
import { syncOfflineScans, SyncResult } from '../utils/offlineSync';

interface OfflineContextType {
  /** True when the device has no network connection */
  isOnline: boolean;
  /** Number of scans waiting to be synced */
  pendingCount: number;
  /** True while a sync operation is in progress */
  isSyncing: boolean;
  /** Last sync result, or null if none yet */
  lastSyncResult: SyncResult | null;
  /** Manually trigger a sync (no-op if offline or already syncing) */
  triggerSync: () => Promise<SyncResult | null>;
  /** Increment the pending count locally (called after an offline scan) */
  bumpPending: () => void;
}

const OfflineContext = createContext<OfflineContextType | undefined>(undefined);

export function OfflineProvider({ children }: { children: ReactNode }) {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [pendingCount, setPendingCount] = useState(
    OfflineStorage.getPendingSyncCount()
  );
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncResult, setLastSyncResult] = useState<SyncResult | null>(null);
  const syncingRef = useRef(false);

  // ── Sync function ──────────────────────────────────────────────────────────
  const triggerSync = useCallback(async (): Promise<SyncResult | null> => {
    if (!navigator.onLine || syncingRef.current) return null;
    if (OfflineStorage.getPendingSyncCount() === 0) return null;

    syncingRef.current = true;
    setIsSyncing(true);

    try {
      const result = await syncOfflineScans();
      setLastSyncResult(result);
      setPendingCount(OfflineStorage.getPendingSyncCount());
      return result;
    } catch (err) {
      console.error('[OfflineContext] Sync failed:', err);
      return null;
    } finally {
      syncingRef.current = false;
      setIsSyncing(false);
    }
  }, []);

  // ── Network event listeners ───────────────────────────────────────────────
  useEffect(() => {
    function handleOnline() {
      setIsOnline(true);
      // Auto-sync when coming back online
      triggerSync();
    }

    function handleOffline() {
      setIsOnline(false);
    }

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Refresh pending count periodically
    const interval = setInterval(() => {
      setPendingCount(OfflineStorage.getPendingSyncCount());
    }, 10_000);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      clearInterval(interval);
    };
  }, [triggerSync]);

  // ── Bump helper (called after adding a scan offline) ──────────────────────
  const bumpPending = useCallback(() => {
    setPendingCount(OfflineStorage.getPendingSyncCount());
  }, []);

  return (
    <OfflineContext.Provider
      value={{
        isOnline,
        pendingCount,
        isSyncing,
        lastSyncResult,
        triggerSync,
        bumpPending,
      }}
    >
      {children}
    </OfflineContext.Provider>
  );
}

export function useOffline(): OfflineContextType {
  const ctx = useContext(OfflineContext);
  if (!ctx) throw new Error('useOffline must be used within OfflineProvider');
  return ctx;
}
