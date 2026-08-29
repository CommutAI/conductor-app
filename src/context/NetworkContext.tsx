import React, { createContext, useContext, useEffect, useState, useCallback, useRef, ReactNode } from 'react';
import { StorageService, SyncResult } from '../services/storageService';

interface NetworkContextType {
  isOnline: boolean;
  pendingCount: number;
  isSyncing: boolean;
  lastSyncResult: SyncResult | null;
  triggerSync: () => Promise<SyncResult | null>;
  bumpPending: (count?: number) => void;
}

const NetworkContext = createContext<NetworkContextType | undefined>(undefined);

export function NetworkProvider({ children }: { children: ReactNode }) {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [pendingCount, setPendingCount] = useState(StorageService.getPendingSyncCount());
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncResult, setLastSyncResult] = useState<SyncResult | null>(null);
  const syncingRef = useRef(false);

  const triggerSync = useCallback(async (): Promise<SyncResult | null> => {
    if (!navigator.onLine || syncingRef.current) return null;
    if (StorageService.getPendingSyncCount() === 0) return null;

    syncingRef.current = true;
    setIsSyncing(true);

    try {
      const result = await StorageService.syncOfflineScans();
      setLastSyncResult(result);
      setPendingCount(StorageService.getPendingSyncCount());
      return result;
    } catch (err) {
      console.error('[NetworkContext] Sync failed:', err);
      return null;
    } finally {
      syncingRef.current = false;
      setIsSyncing(false);
    }
  }, []);

  useEffect(() => {
    function handleOnline() {
      setIsOnline(true);
      triggerSync();
    }

    function handleOffline() {
      setIsOnline(false);
    }

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    const interval = setInterval(() => {
      setPendingCount(StorageService.getPendingSyncCount());
    }, 10_000);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      clearInterval(interval);
    };
  }, [triggerSync]);

  const bumpPending = useCallback((count?: number) => {
    if (count !== undefined) {
      setPendingCount(count);
    } else {
      setPendingCount(StorageService.getPendingSyncCount());
    }
  }, []);

  return (
    <NetworkContext.Provider
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
    </NetworkContext.Provider>
  );
}

export function useNetwork() {
  const ctx = useContext(NetworkContext);
  if (!ctx) throw new Error('useNetwork must be used within NetworkProvider');
  return ctx;
}
