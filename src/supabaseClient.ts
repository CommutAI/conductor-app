import { createClient } from '@supabase/supabase-js';

// Replace these with your actual Supabase project credentials.
// In Vite, env vars must be prefixed with VITE_ and accessed via import.meta.env
const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL || 'https://eiajnmocwxarymfdabjv.supabase.co';
const SUPABASE_ANON_KEY =
  import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVpYWpubW9jd3hhcnltZmRhYmp2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM5MDgyNTMsImV4cCI6MjA5OTQ4NDI1M30.ly_kuqsvnG4XesDpEHXYZFSq_ovI6ZSqFvScaH0GGTI';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
  realtime: {
    params: {
      eventsPerSecond: 10,
    },
  },
});

export type Database = {
  public: {
    Tables: {
      staff_users: {
        Row: {
          id: string;
          full_name: string;
          email: string;
          role: 'admin' | 'conductor' | 'cs_desk';
          is_active: boolean;
          created_at: string;
        };
      };
      buses: {
        Row: {
          id: string;
          plate_number: string;
          route: string;
          seat_capacity: number;
          status: 'active' | 'maintenance' | 'inactive';
        };
      };
      trips: {
        Row: {
          id: string;
          bus_id: string;
          conductor_id: string;
          started_at: string;
          ended_at: string | null;
          status: 'in_progress' | 'completed' | 'cancelled';
        };
        Insert: {
          bus_id: string;
          conductor_id: string;
          started_at: string;
          status: 'in_progress' | 'completed' | 'cancelled';
        };
      };
      qr_cards: {
        Row: {
          id: string;
          card_uid: string;
          owner_name: string;
          contact_number: string | null;
          balance: number;
          status: 'active' | 'lost' | 'replaced' | 'deactivated';
          issued_by: string;
          created_at: string;
        };
      };
      temporary_tickets: {
        Row: {
          id: string;
          ticket_uid: string;
          fare_amount: number;
          issued_by: string | null;
          trip_id: string | null;
          status: 'issued' | 'validated' | 'expired';
          issued_at: string;
          validated_at: string | null;
        };
      };
      transactions: {
        Row: {
          id: string;
          card_id: string | null;
          temp_ticket_id: string | null;
          trip_id: string | null;
          type: 'fare_validation' | 'balance_topup' | 'card_issuance';
          amount: number;
          channel: string;
          staff_id: string | null;
          created_at: string;
        };
        Insert: {
          card_id?: string | null;
          temp_ticket_id?: string | null;
          trip_id?: string | null;
          type: 'fare_validation' | 'balance_topup' | 'card_issuance';
          amount: number;
          channel: string;
          staff_id?: string | null;
        };
      };
      passenger_counts: {
        Row: {
          id: string;
          trip_id: string;
          count: number;
          source: string;
          recorded_at: string;
        };
      };
      fare_irregularities: {
        Row: {
          id: string;
          trip_id: string;
          type: 'double_scan' | 'count_mismatch' | 'fare_evasion' | 'other';
          description: string;
          detected_at: string;
          resolved: boolean;
          resolved_by: string | null;
        };
        Insert: {
          trip_id: string;
          type: 'double_scan' | 'count_mismatch' | 'fare_evasion' | 'other';
          description: string;
          detected_at: string;
        };
      };
    };
  };
};
