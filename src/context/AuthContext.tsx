import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { Session, User } from '@supabase/supabase-js';
import { supabase } from '../supabaseClient';

interface StaffProfile {
  id: string;
  full_name: string;
  email: string;
  role: 'admin' | 'conductor' | 'cs_desk';
  is_active: boolean;
}

interface AuthContextType {
  session: Session | null;
  user: User | null;
  profile: StaffProfile | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<StaffProfile | null>(null);
  const [loading, setLoading] = useState(true);

  async function fetchProfile(userId: string): Promise<StaffProfile | null> {
    const { data, error } = await supabase
      .from('staff_users')
      .select('id, full_name, email, role, is_active')
      .eq('id', userId)
      .single();

    if (error || !data) return null;
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

  async function signIn(email: string, password: string): Promise<{ error: string | null }> {
    console.log('[AuthContext] Attempting sign in with email:', email);
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      console.error('[AuthContext] Sign in error:', error);
      return { error: error.message };
    }
    console.log('[AuthContext] Sign in successful, user ID:', data.user.id);

    const p = await fetchProfile(data.user.id);
    console.log('[AuthContext] Fetched profile:', p);
    if (!p) return { error: 'Staff profile not found.' };
    if (p.role !== 'conductor') return { error: 'Access denied. This app is for conductors only.' };
    if (!p.is_active) return { error: 'Your account is inactive. Contact your administrator.' };

    setProfile(p);
    console.log('[AuthContext] Profile set successfully');
    return { error: null };
  }

  async function signOut() {
    await supabase.auth.signOut();
    setProfile(null);
  }

  return (
    <AuthContext.Provider value={{ session, user, profile, loading, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
