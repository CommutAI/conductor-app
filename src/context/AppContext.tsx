import React, { createContext, useContext, useEffect, useState, useRef, useCallback, ReactNode } from 'react';
import { Session, User } from '@supabase/supabase-js';
import { supabase } from '../supabaseClient';
import { StorageService, CachedTripState } from '../services/storageService';

// ── Types ─────────────────────────────────────────────────────────────────────

type Theme = 'light' | 'dark';

interface StaffProfile {
  id: string;
  full_name: string;
  email: string;
  role: 'admin' | 'conductor' | 'cs_desk';
  is_active: boolean;
  bus_id: string | null;
}

interface Bus {
  id: string;
  plate_number: string;
  route: string;
  seat_capacity: number;
  status: string;
  assigned_driver_id?: string;
  assigned_conductor_id?: string;
  cachedAt?: number; // Timestamp for cache invalidation
}

interface Trip {
  id: string;
  bus_id: string;
  conductor_id: string;
  driver_id?: string;
  started_at: string;
  ended_at: string | null;
  status: 'in_progress' | 'completed' | 'cancelled';
}

interface AppContextType {
  // Auth
  session: Session | null;
  user: User | null;
  profile: StaffProfile | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;

  // Trip
  currentTrip: Trip | null;
  currentBus: Bus | null;
  validatedCount: number;
  currentPassengersCount: number;
  fareCollected: number;
  isRestoringTrip: boolean;
  setCurrentTrip: (trip: Trip | null) => void;
  setCurrentBus: (bus: Bus | null) => void;
  setValidatedCount: (n: number) => void;
  setCurrentPassengersCount: (n: number) => void;
  incrementCurrentPassengers: () => void;
  decrementCurrentPassengers: () => void;
  setFareCollected: (n: number) => void;
  incrementValidated: (fare: number) => void;
  clearTrip: () => void;

  // Theme
  theme: Theme;
  isDark: boolean;
  toggleTheme: () => void;
  setTheme: (theme: Theme) => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

const THEME_STORAGE_KEY = 'commutai-theme';
const PROFILE_CACHE_KEY = 'commutai_profile_cache';

export function AppProvider({ children }: { children: ReactNode }) {
  // ── Theme State ─────────────────────────────────────────────────────────────
  const [theme, setThemeState] = useState<Theme>(() => {
    const stored = localStorage.getItem(THEME_STORAGE_KEY) as Theme | null;
    if (stored === 'light' || stored === 'dark') return stored;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });

  // ── Auth State ─────────────────────────────────────────────────────────────
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<StaffProfile | null>(null);
  const [loading, setLoading] = useState(true);

  // ── Trip State ──────────────────────────────────────────────────────────────
  // BUG 6 FIX: Load cached state once for initial useState values only.
  // The 'cached' variable must NOT be reused inside async functions (like restoreTrip)
  // because by the time those run the state may have changed. Instead, call
  // StorageService.loadTripState() fresh inside restoreTrip.
  const initialCached = StorageService.loadTripState();
  const [currentTrip, _setCurrentTrip] = useState<Trip | null>(initialCached?.currentTrip ?? null);
  const [currentBus, _setCurrentBus] = useState<Bus | null>(initialCached?.currentBus ?? null);
  const [validatedCount, _setValidatedCount] = useState(initialCached?.validatedCount ?? 0);
  const [currentPassengersCount, _setCurrentPassengersCount] = useState(initialCached?.currentPassengersCount ?? 0);
  const [fareCollected, _setFareCollected] = useState(initialCached?.fareCollected ?? 0);
  const [isRestoringTrip, setIsRestoringTrip] = useState(false);
  const restoredOfflineOnlyRef = useRef(false);

  const validateTripWithDatabase = useCallback(async (showLoading = false) => {
    if (!profile || !navigator.onLine) return;

    if (showLoading) {
      setIsRestoringTrip(true);
    }
    const freshCached = StorageService.loadTripState();

    try {
      if (freshCached?.currentTrip) {
        const { data: dbTrip } = await supabase
          .from('trips')
          .select('*')
          .eq('id', freshCached.currentTrip.id)
          .eq('status', 'in_progress')
          .maybeSingle();

        if (dbTrip) {
          console.log('[AppContext] Cached trip confirmed active in DB:', dbTrip.id);
          _setCurrentTrip(dbTrip);
          restoredOfflineOnlyRef.current = false;
          return;
        }

        // Trip not in DB yet — keep local state if scans or offline trip data pending sync
        if (StorageService.hasUnsyncedTripData()) {
          console.log('[AppContext] Trip not in DB yet — preserving local state until sync');
          restoredOfflineOnlyRef.current = false;
          return;
        }

        console.log('[AppContext] Cached trip no longer active, clearing cache');
        StorageService.clearTripState();
        _setCurrentTrip(null);
        _setCurrentBus(null);
        _setValidatedCount(0);
        _setFareCollected(0);
      }

      const { data: activeTrip } = await supabase
        .from('trips')
        .select('*')
        .eq('conductor_id', profile.id)
        .eq('status', 'in_progress')
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (activeTrip) {
        console.log('[AppContext] Found active trip in DB, restoring:', activeTrip.id);

        const { data: bus } = await supabase
          .from('buses')
          .select('*')
          .eq('id', activeTrip.bus_id)
          .maybeSingle();

        _setCurrentTrip(activeTrip);
        if (bus) _setCurrentBus(bus);

        const cached = StorageService.loadTripState();
        const preserveCounts =
          cached?.currentTrip?.id === activeTrip.id &&
          (StorageService.hasPendingScans() || (cached?.validatedCount ?? 0) > 0);

        _setValidatedCount(preserveCounts ? (cached?.validatedCount ?? 0) : 0);
        _setFareCollected(preserveCounts ? (cached?.fareCollected ?? 0) : 0);

        StorageService.saveTripState({
          currentTrip: activeTrip,
          currentBus: bus,
          validatedCount: preserveCounts ? cached!.validatedCount : 0,
          currentPassengersCount: preserveCounts ? cached!.currentPassengersCount ?? 0 : 0,
          fareCollected: preserveCounts ? cached!.fareCollected : 0,
          localPassengers: preserveCounts ? cached!.localPassengers : [],
        });
      } else {
        console.log('[AppContext] No active trip found in DB');
      }
    } catch (err) {
      console.error('[AppContext] Error validating trip with DB:', err);
    } finally {
      if (showLoading) {
        setIsRestoringTrip(false);
      }
      restoredOfflineOnlyRef.current = false;
    }
  }, [profile]);

  // ── Theme Effects ────────────────────────────────────────────────────────────
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  // ── Auth Effects ────────────────────────────────────────────────────────────
  async function fetchProfile(userId: string): Promise<StaffProfile | null> {
    // Network-aware profile fetch with retry logic
    let retryCount = 0;
    const maxRetries = 2;
    
    while (retryCount <= maxRetries) {
      try {
        const { data, error } = await supabase
          .from('staff_users')
          .select('id, full_name, email, role, is_active, bus_id')
          .eq('id', userId)
          .single();

        if (error || !data) {
          console.error('[AppContext] Profile fetch error:', error);
          
          // Retry transient failures while online (not when genuinely offline)
          if (error && navigator.onLine && retryCount < maxRetries) {
            retryCount++;
            console.log(`[AppContext] Retrying profile fetch (${retryCount}/${maxRetries})`);
            await new Promise(resolve => setTimeout(resolve, 1000 * retryCount));
            continue;
          }
          
          return null;
        }
        console.log('[AppContext] Profile fetched:', data);
        return data as StaffProfile;
      } catch (err) {
        console.error('[AppContext] Profile fetch exception:', err);
        
        // Retry transient failures while online
        if (navigator.onLine && retryCount < maxRetries) {
          retryCount++;
          console.log(`[AppContext] Retrying profile fetch after exception (${retryCount}/${maxRetries})`);
          await new Promise(resolve => setTimeout(resolve, 1000 * retryCount));
          continue;
        }
        
        return null;
      }
    }
    
    return null;
  }

  function loadCachedProfile(userId: string): StaffProfile | null {
    try {
      const raw = localStorage.getItem(PROFILE_CACHE_KEY);
      if (!raw) return null;
      const { profile: cachedProfile } = JSON.parse(raw);
      if (cachedProfile?.id === userId) {
        return cachedProfile as StaffProfile;
      }
    } catch {
      /* ignore */
    }
    return null;
  }

  async function applySession(session: Session | null) {
    setSession(session);
    setUser(session?.user ?? null);

    if (!session?.user) {
      setProfile(null);
      return;
    }

    const p = await fetchProfile(session.user.id);
    if (p) {
      setProfile(p);
      return;
    }

    // Offline or transient failure — keep cached profile so the user isn't logged out
    const cached = loadCachedProfile(session.user.id);
    if (cached) {
      console.log('[AppContext] Using cached profile (offline or fetch failed)');
      setProfile(cached);
    }
  }

  useEffect(() => {
    // Only restore session on initial mount, not on network changes
    let hasMounted = false;

    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!hasMounted) {
        hasMounted = true;
        await applySession(session);
        setLoading(false);
      }
    });

    const { data: listener } = supabase.auth.onAuthStateChange(async (_event, session) => {
      // Only update session if it's a real auth event, not network-related
      if (_event === 'SIGNED_IN' || _event === 'SIGNED_OUT' || _event === 'TOKEN_REFRESHED') {
        if (_event === 'SIGNED_OUT') {
          setSession(null);
          setUser(null);
          setProfile(null);
          return;
        }
        await applySession(session);
      }
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  // ── Trip Restoration from Database ─────────────────────────────────────────
  // After the profile is loaded, check the DB for an active trip.
  // This is the key to cross-device sync: Device 2 opens the app, has no
  // localStorage cache, but finds the in-progress trip Device 1 created.
  useEffect(() => {
    if (!profile) return;

    let hasRestored = false;

    const restoreTrip = async () => {
      if (hasRestored) return;
      hasRestored = true;

      if (!navigator.onLine) {
        console.log('[AppContext] Offline — using cached trip state only');
        restoredOfflineOnlyRef.current = true;
        setIsRestoringTrip(false);
        return;
      }

      await validateTripWithDatabase(true);
    };

    restoreTrip();
  }, [profile?.id, validateTripWithDatabase]);

  // Re-validate cached trip against DB when connectivity returns after offline startup
  useEffect(() => {
    function handleOnline() {
      if (restoredOfflineOnlyRef.current && profile) {
        console.log('[AppContext] Back online — re-validating cached trip with DB (silent)');
        validateTripWithDatabase(false);
      }
    }

    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [profile?.id, validateTripWithDatabase]);

  useEffect(() => {
    if (currentTrip) {
      StorageService.saveTripState({
        currentTrip,
        currentBus,
        validatedCount,
        currentPassengersCount,
        fareCollected,
      });
    }
  }, [currentTrip, currentBus, validatedCount, currentPassengersCount, fareCollected]);

  // ── Auth Functions ──────────────────────────────────────────────────────────
  async function signIn(email: string, password: string): Promise<{ error: string | null }> {
    // ── Offline fallback: use cached credentials ──────────────────────────
    if (!navigator.onLine) {
      try {
        const raw = localStorage.getItem(PROFILE_CACHE_KEY);
        if (raw) {
          const { profile: cachedProfile, email: cachedEmail } = JSON.parse(raw);
          if (cachedEmail === email.trim() && cachedProfile) {
            console.log('[AppContext] Offline login using cached profile');
            setProfile(cachedProfile);
            setLoading(false);
            // Re-use the existing Supabase session if it is still stored locally
            const { data: { session: existing } } = await supabase.auth.getSession().catch(() => ({ data: { session: null } }));
            if (existing) {
              setSession(existing);
              // BUG 8 FIX: setUser was never called in the offline login path.
              // Components reading `user` (e.g. ProtectedRoute) saw null and
              // treated the conductor as signed out, even after a valid offline login.
              setUser(existing.user);
            }
            return { error: null };
          }
        }
      } catch (_) {}
      return { error: 'No internet connection. Please connect to log in for the first time.' };
    }

    // ── Online login ──────────────────────────────────────────────────────
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { error: error.message };

    const p = await fetchProfile(data.user.id);
    if (!p) return { error: 'Staff profile not found.' };
    if (p.role !== 'conductor') return { error: 'Access denied. This app is for conductors only.' };
    if (!p.is_active) return { error: 'Your account is inactive. Contact your administrator.' };

    // Cache the profile so offline login works on subsequent sessions
    localStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify({ email: email.trim(), profile: p }));

    setSession(data.session);
    setProfile(p);
    return { error: null };
  }

  async function signOut() {
    // Keep PROFILE_CACHE_KEY so offline login still works after signing out.
    // The Supabase session is cleared below — the cached profile data
    // (name, role, bus_id) is not sensitive and enables offline re-login.
    StorageService.clearTripState();
    setSession(null);
    setProfile(null);
    setUser(null);
    await supabase.auth.signOut();
  }

  // ── Trip Functions ──────────────────────────────────────────────────────────
  function setCurrentTrip(trip: Trip | null) {
    _setCurrentTrip(trip);
    if (!trip) {
      StorageService.clearTripState();
    }
  }

  function setCurrentBus(bus: Bus | null) {
    _setCurrentBus(bus);
  }

  function setValidatedCount(n: number) {
    _setValidatedCount(n);
  }

  function setCurrentPassengersCount(n: number) {
    _setCurrentPassengersCount(n);
  }

  function incrementCurrentPassengers() {
    _setCurrentPassengersCount((c) => c + 1);
  }

  function decrementCurrentPassengers() {
    _setCurrentPassengersCount((c) => Math.max(0, c - 1));
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
    StorageService.clearTripState();
  }

  // ── Theme Functions ─────────────────────────────────────────────────────────
  const setTheme = (t: Theme) => setThemeState(t);
  const toggleTheme = () => setThemeState((prev) => (prev === 'light' ? 'dark' : 'light'));

  return (
    <AppContext.Provider
      value={{
        // Auth
        session,
        user,
        profile,
        loading,
        signIn,
        signOut,
        // Trip
        currentTrip,
        currentBus,
        validatedCount,
        currentPassengersCount,
        fareCollected,
        isRestoringTrip,
        setCurrentTrip,
        setCurrentBus,
        setValidatedCount,
        setCurrentPassengersCount,
        incrementCurrentPassengers,
        decrementCurrentPassengers,
        setFareCollected,
        incrementValidated,
        clearTrip,
        // Theme
        theme,
        isDark: theme === 'dark',
        toggleTheme,
        setTheme,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}
