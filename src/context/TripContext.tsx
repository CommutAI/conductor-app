import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { OfflineStorage, CachedTripState } from '../utils/offlineStorage';
import { supabase } from '../supabaseClient';

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
  /** True while the context is attempting to restore an active trip from the database */
  isRestoringTrip: boolean;
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
  const [isRestoringTrip, setIsRestoringTrip] = useState(false);

  // ── Auto-restore from Supabase if localStorage is empty ────────────────────
  // This prevents scanned QR data from "disappearing" after a redeploy or
  // when the browser clears localStorage, even though Supabase still holds all data.
  useEffect(() => {
    // Only attempt DB restore if we have no cached trip
    if (cached?.currentTrip) return;

    async function restoreActiveTrip() {
      try {
        // Get current authenticated session
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.user) return; // Not logged in — nothing to restore

        setIsRestoringTrip(true);

        // Find the conductor's latest in-progress trip
        const { data: trip, error: tripError } = await supabase
          .from('trips')
          .select('id, bus_id, conductor_id, started_at, ended_at, status')
          .eq('conductor_id', session.user.id)
          .eq('status', 'in_progress')
          .order('started_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (tripError || !trip) {
          console.log('[TripContext] No active trip found in database for restore.');
          setIsRestoringTrip(false);
          return;
        }

        // Fetch the associated bus
        const { data: bus, error: busError } = await supabase
          .from('buses')
          .select('id, plate_number, route, seat_capacity, status')
          .eq('id', trip.bus_id)
          .maybeSingle();

        if (busError || !bus) {
          console.log('[TripContext] Could not fetch bus for restored trip.');
          setIsRestoringTrip(false);
          return;
        }

        // Count how many passengers were validated (boarded) on this trip
        // so the validated count reflects reality after a redeploy
        const { count: boardedCount } = await supabase
          .from('boarded_passengers')
          .select('id', { count: 'exact', head: true })
          .eq('trip_id', trip.id);

        console.log('[TripContext] Restored active trip from database:', trip.id);

        _setCurrentTrip(trip as Trip);
        _setCurrentBus(bus as Bus);
        _setValidatedCount(boardedCount ?? 0);
        // Note: fareCollected is tricky to recompute here — leave as 0 since
        // it's a display-only counter in this session.
        OfflineStorage.saveTripState({
          currentTrip: trip as Trip,
          currentBus: bus as Bus,
          validatedCount: boardedCount ?? 0,
          fareCollected: 0,
        });
      } catch (err) {
        console.error('[TripContext] Error restoring active trip:', err);
      } finally {
        setIsRestoringTrip(false);
      }
    }

    restoreActiveTrip();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
        isRestoringTrip,
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
