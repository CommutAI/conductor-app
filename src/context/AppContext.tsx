import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
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
}

interface Trip {
  id: string;
  bus_id: string;
  conductor_id: string;
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
  fareCollected: number;
  isRestoringTrip: boolean;
  setCurrentTrip: (trip: Trip | null) => void;
  setCurrentBus: (bus: Bus | null) => void;
  setValidatedCount: (n: number) => void;
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
  const cached = StorageService.loadTripState();
  const [currentTrip, _setCurrentTrip] = useState<Trip | null>(cached?.currentTrip ?? null);
  const [currentBus, _setCurrentBus] = useState<Bus | null>(cached?.currentBus ?? null);
  const [validatedCount, _setValidatedCount] = useState(cached?.validatedCount ?? 0);
  const [fareCollected, _setFareCollected] = useState(cached?.fareCollected ?? 0);
  const [isRestoringTrip, setIsRestoringTrip] = useState(false);

  // ── Theme Effects ────────────────────────────────────────────────────────────
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  // ── Auth Effects ────────────────────────────────────────────────────────────
  async function fetchProfile(userId: string): Promise<StaffProfile | null> {
    const { data, error } = await supabase
      .from('staff_users')
      .select('id, full_name, email, role, is_active, bus_id')
      .eq('id', userId)
      .single();

    if (error || !data) {
      console.error('[AppContext] Profile fetch error:', error);
      return null;
    }
    console.log('[AppContext] Profile fetched:', data);
    return data as StaffProfile;
  }

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        const p = await fetchProfile(session.user.id);
        setProfile(p);
      }
      setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange(async (_event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        const p = await fetchProfile(session.user.id);
        setProfile(p);
      } else {
        setProfile(null);
      }
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  // ── Trip Effects ────────────────────────────────────────────────────────────
  useEffect(() => {
    console.log('[AppContext] Trip effect triggered, cached trip:', cached?.currentTrip);
    
    // Only restore from cache (localStorage), not from database
    // This prevents automatically restoring old/stuck trips
    if (cached?.currentTrip) {
      console.log('[AppContext] Using cached trip state from localStorage');
      
      // Sync the cached trip state to database to ensure consistency
      StorageService.syncTripStateToDatabase().then((synced) => {
        if (synced) {
          console.log('[AppContext] Cached trip synced to database');
        }
      });
      
      return;
    }

    console.log('[AppContext] No cached trip found, starting fresh');
    setIsRestoringTrip(false);
  }, []);

  useEffect(() => {
    if (currentTrip) {
      StorageService.saveTripState({
        currentTrip,
        currentBus,
        validatedCount,
        fareCollected,
      });
    }
  }, [currentTrip, currentBus, validatedCount, fareCollected]);

  // ── Auth Functions ──────────────────────────────────────────────────────────
  async function signIn(email: string, password: string): Promise<{ error: string | null }> {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { error: error.message };

    const p = await fetchProfile(data.user.id);
    if (!p) return { error: 'Staff profile not found.' };
    if (p.role !== 'conductor') return { error: 'Access denied. This app is for conductors only.' };
    if (!p.is_active) return { error: 'Your account is inactive. Contact your administrator.' };

    setProfile(p);
    return { error: null };
  }

  async function signOut() {
    await supabase.auth.signOut();
    setProfile(null);
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
        fareCollected,
        isRestoringTrip,
        setCurrentTrip,
        setCurrentBus,
        setValidatedCount,
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
