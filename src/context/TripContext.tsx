import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { OfflineStorage, CachedTripState } from '../utils/offlineStorage';

interface Bus {
  id: string;
  plate_number: string;
  route: string;
  seat_capacity: number;
  status: string;
}

interface Trip {
  id: string;
  bus_id: string;
  conductor_id: string;
  started_at: string;
  ended_at: string | null;
  status: 'in_progress' | 'completed' | 'cancelled';
}

interface TripContextType {
  currentTrip: Trip | null;
  currentBus: Bus | null;
  setCurrentTrip: (trip: Trip | null) => void;
  setCurrentBus: (bus: Bus | null) => void;
  validatedCount: number;
  setValidatedCount: (n: number) => void;
  fareCollected: number;
  setFareCollected: (n: number) => void;
  incrementValidated: (fare: number) => void;
  clearTrip: () => void;
}

const TripContext = createContext<TripContextType | undefined>(undefined);

export function TripProvider({ children }: { children: ReactNode }) {
  // ── Restore from localStorage on mount ─────────────────────────────────────
  const cached = OfflineStorage.loadTripState();

  const [currentTrip, _setCurrentTrip] = useState<Trip | null>(
    cached?.currentTrip ?? null
  );
  const [currentBus, _setCurrentBus] = useState<Bus | null>(
    cached?.currentBus ?? null
  );
  const [validatedCount, _setValidatedCount] = useState(
    cached?.validatedCount ?? 0
  );
  const [fareCollected, _setFareCollected] = useState(
    cached?.fareCollected ?? 0
  );

  // ── Persist to localStorage whenever state changes ─────────────────────────
  useEffect(() => {
    if (currentTrip) {
      OfflineStorage.saveTripState({
        currentTrip,
        currentBus,
        validatedCount,
        fareCollected,
      });
    }
  }, [currentTrip, currentBus, validatedCount, fareCollected]);

  // ── Setters that keep state + cache in sync ────────────────────────────────
  function setCurrentTrip(trip: Trip | null) {
    _setCurrentTrip(trip);
    if (!trip) {
      // trip cleared — remove cache
      OfflineStorage.clearTripState();
    }
  }

  function setCurrentBus(bus: Bus | null) {
    _setCurrentBus(bus);
  }

  function setValidatedCount(n: number) {
    _setValidatedCount(n);
  }

  function setFareCollected(n: number) {
    _setFareCollected(n);
  }

  function incrementValidated(fare: number) {
    _setValidatedCount((c) => c + 1);
    _setFareCollected((f) => f + fare);
  }

  function clearTrip() {
    _setCurrentTrip(null);
    _setCurrentBus(null);
    _setValidatedCount(0);
    _setFareCollected(0);
    OfflineStorage.clearTripState();
  }

  return (
    <TripContext.Provider
      value={{
        currentTrip,
        currentBus,
        setCurrentTrip,
        setCurrentBus,
        validatedCount,
        setValidatedCount,
        fareCollected,
        setFareCollected,
        incrementValidated,
        clearTrip,
      }}
    >
      {children}
    </TripContext.Provider>
  );
}

export function useTrip() {
  const ctx = useContext(TripContext);
  if (!ctx) throw new Error('useTrip must be used within TripProvider');
  return ctx;
}
