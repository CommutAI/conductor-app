-- ============================================================
-- CommutAI · Complete Database Schema
-- Run this in the Supabase SQL Editor on a clean slate.
-- All statements use IF NOT EXISTS / IF EXISTS guards so
-- re-running is safe.
-- ============================================================

-- ── 0. Custom Enum Types ──────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE staff_role AS ENUM ('admin', 'conductor', 'cs_desk');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE bus_status AS ENUM ('active', 'maintenance', 'inactive');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE trip_status AS ENUM ('in_progress', 'completed', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE qr_card_status AS ENUM ('active', 'lost', 'replaced', 'deactivated');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE card_type AS ENUM ('regular', 'student', 'senior_citizen', 'pwd');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE ticket_status AS ENUM ('issued', 'validated', 'expired');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE transaction_type AS ENUM ('fare_validation', 'balance_topup', 'card_issuance', 'baggage_fee');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE irregularity_type AS ENUM ('double_scan', 'count_mismatch', 'fare_evasion', 'other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE cs_action_type AS ENUM ('complaint', 'inquiry', 'refund', 'lost_card', 'other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 1. Staff Users ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS staff_users (
  id          UUID        PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  full_name   TEXT        NOT NULL,
  email       TEXT        NOT NULL UNIQUE,
  role        staff_role  NOT NULL DEFAULT 'conductor',
  is_active   BOOLEAN     NOT NULL DEFAULT TRUE,
  bus_id      UUID        REFERENCES buses (id),  -- Assigned bus for conductors
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add bus_id column to existing staff_users table if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'staff_users' AND column_name = 'bus_id'
  ) THEN
    ALTER TABLE staff_users ADD COLUMN bus_id UUID REFERENCES buses (id);
  END IF;
END $$;

-- Auto-create staff_users row when a new auth user is created
CREATE OR REPLACE FUNCTION handle_new_staff_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO staff_users (id, full_name, email, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    NEW.email,
    COALESCE((NEW.raw_user_meta_data->>'role')::staff_role, 'conductor')
  )
  ON CONFLICT (id) DO UPDATE SET
    full_name = EXCLUDED.full_name,
    email     = EXCLUDED.email,
    role      = EXCLUDED.role;
  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    RAISE LOG 'Error creating staff_users record for user %: %', NEW.id, SQLERRM;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_staff_user();

-- ── 2. Buses ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS buses (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  plate_number   TEXT        NOT NULL UNIQUE,
  bus_number     INTEGER     UNIQUE,
  route          TEXT        NOT NULL,
  seat_capacity  INTEGER     NOT NULL DEFAULT 50,
  status         bus_status  NOT NULL DEFAULT 'active',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add bus_number column if it doesn't exist (for existing tables)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'buses' AND column_name = 'bus_number'
  ) THEN
    ALTER TABLE buses ADD COLUMN bus_number INTEGER UNIQUE;
  END IF;
END $$;

-- Add card_type and purchase_price columns to qr_cards if they don't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'qr_cards' AND column_name = 'card_type'
  ) THEN
    ALTER TABLE qr_cards ADD COLUMN card_type card_type NOT NULL DEFAULT 'regular';
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'qr_cards' AND column_name = 'purchase_price'
  ) THEN
    ALTER TABLE qr_cards ADD COLUMN purchase_price NUMERIC(10,2) NOT NULL DEFAULT 100.00;
  END IF;
END $$;

-- Update existing card_type values if enum was changed from old values
DO $$
BEGIN
  -- Update 'elderly' to 'senior_citizen' if it exists
  UPDATE qr_cards SET card_type = 'senior_citizen' WHERE card_type = 'elderly';
  -- Update 'disabled' to 'pwd' if it exists
  UPDATE qr_cards SET card_type = 'pwd' WHERE card_type = 'disabled';
EXCEPTION WHEN others THEN
  -- Ignore errors if the old values don't exist
  NULL;
END $$;

-- Update existing buses to have bus_number values based on plate_number
DO $$
BEGIN
  UPDATE buses SET bus_number = 1001 WHERE plate_number = 'BUS-001' AND bus_number IS NULL;
  UPDATE buses SET bus_number = 1002 WHERE plate_number = 'BUS-002' AND bus_number IS NULL;
  UPDATE buses SET bus_number = 1003 WHERE plate_number = 'BUS-003' AND bus_number IS NULL;
  UPDATE buses SET bus_number = 1004 WHERE plate_number = 'BUS-004' AND bus_number IS NULL;
  UPDATE buses SET bus_number = 1005 WHERE plate_number = 'BUS-005' AND bus_number IS NULL;
  UPDATE buses SET bus_number = 1006 WHERE plate_number = 'BUS-006' AND bus_number IS NULL;
  UPDATE buses SET bus_number = 1007 WHERE plate_number = 'BUS-007' AND bus_number IS NULL;
  UPDATE buses SET bus_number = 1008 WHERE plate_number = 'BUS-008' AND bus_number IS NULL;
  UPDATE buses SET bus_number = 1009 WHERE plate_number = 'BUS-009' AND bus_number IS NULL;
  UPDATE buses SET bus_number = 1010 WHERE plate_number = 'BUS-010' AND bus_number IS NULL;
END $$;

-- ── 3. Trips ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS trips (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  bus_id          UUID        NOT NULL REFERENCES buses (id),
  conductor_id    UUID        NOT NULL REFERENCES staff_users (id),
  started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at        TIMESTAMPTZ,
  status          trip_status NOT NULL DEFAULT 'in_progress',
  -- GPS tracking columns (updated in real time by the conductor app)
  current_lat     FLOAT8,
  current_lng     FLOAT8,
  gps_updated_at  TIMESTAMPTZ
);

-- ── 4. QR Cards ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS qr_cards (
  id              UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  card_uid        TEXT           NOT NULL UNIQUE,
  owner_name      TEXT           NOT NULL,
  contact_number  TEXT,
  balance         NUMERIC(10,2)  NOT NULL DEFAULT 0,
  status          qr_card_status NOT NULL DEFAULT 'active',
  card_type       card_type      NOT NULL DEFAULT 'regular',
  purchase_price  NUMERIC(10,2)  NOT NULL DEFAULT 100.00,
  allowed_routes  TEXT[]         DEFAULT '{}',
  passenger_id    UUID,          -- links to a registered passenger if applicable
  issued_by       UUID           REFERENCES staff_users (id),
  created_at      TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

-- ── 5. Temporary Tickets ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS temporary_tickets (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_uid      TEXT          NOT NULL UNIQUE,
  fare_amount     NUMERIC(10,2) NOT NULL DEFAULT 12,
  status          ticket_status NOT NULL DEFAULT 'issued',
  allowed_routes  TEXT[]        DEFAULT '{}',
  passenger_id    UUID,
  trip_id         UUID          REFERENCES trips (id),
  issued_by       UUID          REFERENCES staff_users (id),
  issued_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  validated_at    TIMESTAMPTZ
);

-- ── 6. Transactions ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS transactions (
  id               UUID             PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id          UUID             REFERENCES qr_cards (id),
  temp_ticket_id   UUID             REFERENCES temporary_tickets (id),
  trip_id          UUID             REFERENCES trips (id),
  type             transaction_type NOT NULL,
  amount           NUMERIC(10,2)    NOT NULL,
  channel          TEXT             NOT NULL, -- 'qr_card', 'temp_ticket', 'cash', 'card'
  staff_id         UUID             REFERENCES staff_users (id),
  created_at       TIMESTAMPTZ      NOT NULL DEFAULT NOW(),
  -- Baggage-related columns
  baggage_category TEXT,
  baggage_weight   NUMERIC(10,2),
  baggage_fee      NUMERIC(10,2)
);

-- Add baggage columns to existing transactions table if they don't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'transactions' AND column_name = 'baggage_category'
  ) THEN
    ALTER TABLE transactions ADD COLUMN baggage_category TEXT;
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'transactions' AND column_name = 'baggage_weight'
  ) THEN
    ALTER TABLE transactions ADD COLUMN baggage_weight NUMERIC(10,2);
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'transactions' AND column_name = 'baggage_fee'
  ) THEN
    ALTER TABLE transactions ADD COLUMN baggage_fee NUMERIC(10,2);
  END IF;
END $$;

-- ── 7. Passenger Counts ───────────────────────────────────────────────────────
-- Records periodic headcount snapshots (manual + AI-assisted) for video monitoring.
CREATE TABLE IF NOT EXISTS passenger_counts (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id      UUID        NOT NULL REFERENCES trips (id) ON DELETE CASCADE,
  count        INTEGER     NOT NULL,
  recorded_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ai_count     INTEGER,    -- AI-estimated headcount from camera feed
  source       TEXT        NOT NULL DEFAULT 'manual' -- 'manual' | 'ai' | 'scan'
);

-- Add video monitoring columns if they don't exist (for existing tables)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'passenger_counts' AND column_name = 'ai_count'
  ) THEN
    ALTER TABLE passenger_counts ADD COLUMN ai_count INTEGER;
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'passenger_counts' AND column_name = 'source'
  ) THEN
    ALTER TABLE passenger_counts ADD COLUMN source TEXT NOT NULL DEFAULT 'manual';
  END IF;
END $$;

-- ── 8. Boarded Passengers ─────────────────────────────────────────────────────
-- One row per successful boarding event (QR card or temp ticket validated).
CREATE TABLE IF NOT EXISTS boarded_passengers (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id         UUID        NOT NULL REFERENCES trips (id) ON DELETE CASCADE,
  passenger_id    UUID,       -- optional link to a registered passenger profile
  card_id         UUID        REFERENCES qr_cards (id),
  temp_ticket_id  UUID        REFERENCES temporary_tickets (id),
  boarded_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  alighted_at     TIMESTAMPTZ, -- When the passenger got off the bus
  CONSTRAINT chk_boarding_source CHECK (card_id IS NOT NULL OR temp_ticket_id IS NOT NULL)
);

-- Add alighted_at column to existing boarded_passengers table if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'boarded_passengers' AND column_name = 'alighted_at'
  ) THEN
    ALTER TABLE boarded_passengers ADD COLUMN alighted_at TIMESTAMPTZ;
  END IF;
END $$;

-- ── 9. GPS Logs ───────────────────────────────────────────────────────────────
-- Periodic position snapshots stored separately from the trip row for history.
CREATE TABLE IF NOT EXISTS gps_logs (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id      UUID        NOT NULL REFERENCES trips (id) ON DELETE CASCADE,
  lat          FLOAT8      NOT NULL,
  lng          FLOAT8      NOT NULL,
  recorded_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 10. Fare Irregularities ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fare_irregularities (
  id           UUID               PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id      UUID               NOT NULL REFERENCES trips (id) ON DELETE CASCADE,
  type         irregularity_type  NOT NULL,
  description  TEXT               NOT NULL,
  detected_at  TIMESTAMPTZ        NOT NULL DEFAULT NOW(),
  resolved     BOOLEAN            NOT NULL DEFAULT FALSE,
  resolved_by  UUID               REFERENCES staff_users (id),
  resolved_at  TIMESTAMPTZ
);

-- ── 11. Emergency Alerts ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS emergency_alerts (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id          UUID        NOT NULL REFERENCES trips (id) ON DELETE CASCADE,
  conductor_id     UUID        NOT NULL REFERENCES staff_users (id),
  bus_id           UUID        REFERENCES buses (id),
  lat              FLOAT8,
  lng              FLOAT8,
  status           TEXT        NOT NULL DEFAULT 'active', -- 'active' | 'acknowledged' | 'resolved'
  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  acknowledged_at  TIMESTAMPTZ,
  resolved_at      TIMESTAMPTZ,
  triggered_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  location_lat     DECIMAL(10, 8),
  location_lng     DECIMAL(11, 8),
  location_source  TEXT, -- 'gps', 'ip_geolocation', 'unknown'
  location_accuracy DECIMAL(10, 2)
);

-- Add columns for hardware integration if they don't exist (for existing tables)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'emergency_alerts' AND column_name = 'triggered_at'
  ) THEN
    ALTER TABLE emergency_alerts ADD COLUMN triggered_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'emergency_alerts' AND column_name = 'location_lat'
  ) THEN
    ALTER TABLE emergency_alerts ADD COLUMN location_lat DECIMAL(10, 8);
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'emergency_alerts' AND column_name = 'location_lng'
  ) THEN
    ALTER TABLE emergency_alerts ADD COLUMN location_lng DECIMAL(11, 8);
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'emergency_alerts' AND column_name = 'location_source'
  ) THEN
    ALTER TABLE emergency_alerts ADD COLUMN location_source TEXT;
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'emergency_alerts' AND column_name = 'location_accuracy'
  ) THEN
    ALTER TABLE emergency_alerts ADD COLUMN location_accuracy DECIMAL(10, 2);
  END IF;
END $$;

-- ── 12. Emergency Contacts ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS emergency_contacts (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT        NOT NULL,
  phone       TEXT        NOT NULL,
  email       TEXT,
  relationship TEXT,
  is_active   BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Trigger to automatically update updated_at
CREATE OR REPLACE FUNCTION update_emergency_contacts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_emergency_contacts_updated_at_trigger ON emergency_contacts;
CREATE TRIGGER update_emergency_contacts_updated_at_trigger
  BEFORE UPDATE ON emergency_contacts
  FOR EACH ROW
  EXECUTE FUNCTION update_emergency_contacts_updated_at();

-- ── 13. SMS Logs ───────────────────────────────────────────────────────────────
-- Hardware integration for SMS notifications
CREATE TABLE IF NOT EXISTS sms_logs (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_number    TEXT        NOT NULL,
  message         TEXT        NOT NULL,
  sms_type        TEXT        NOT NULL, -- 'transaction', 'topup', 'reload', 'trip', 'emergency'
  status          TEXT        NOT NULL DEFAULT 'sent', -- 'sent', 'failed', 'pending'
  trip_id         UUID        REFERENCES trips (id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 14. GPS Locations ───────────────────────────────────────────────────────────
-- Hardware integration for GPS tracking
CREATE TABLE IF NOT EXISTS gps_locations (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  latitude         DECIMAL(10, 8) NOT NULL,
  longitude        DECIMAL(11, 8) NOT NULL,
  altitude         DECIMAL(10, 2),
  speed            DECIMAL(10, 2),
  accuracy         DECIMAL(10, 2),
  source           TEXT        NOT NULL, -- 'gps', 'ip_geolocation'
  trip_id          UUID        REFERENCES trips (id),
  satellite_count  INTEGER,
  fix_quality      INTEGER,
  recorded_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 15. Hardware Status ───────────────────────────────────────────────────────
-- Hardware integration for component monitoring
CREATE TABLE IF NOT EXISTS hardware_status (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  component   TEXT        NOT NULL, -- 'sim900a', 'neo6m', 'emergency_button', 'camera'
  status      TEXT        NOT NULL, -- 'online', 'offline', 'error', 'maintenance'
  details     JSONB,
  last_check  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 16. Customer Service Logs ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS customer_service_logs (
  id          UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id     UUID           REFERENCES trips (id),
  handled_by  UUID           REFERENCES staff_users (id),
  action      cs_action_type NOT NULL,
  description TEXT,
  created_at  TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

-- ── 17. GCash Transactions ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS gcash_transactions (
  id                BIGSERIAL PRIMARY KEY,
  phone_number      TEXT        NOT NULL,
  amount            NUMERIC     NOT NULL,
  status            TEXT        NOT NULL CHECK (status IN ('completed', 'failed', 'pending')),
  stripe_payment_id TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 18. Notifications ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notifications (
  id         BIGSERIAL PRIMARY KEY,
  message    TEXT        NOT NULL,
  type       TEXT        DEFAULT 'info' CHECK (type IN ('alert', 'success', 'info')),
  read       BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 19. Fare Matrix ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fare_matrix (
  id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  route_from              TEXT        NOT NULL,
  route_to                TEXT        NOT NULL,
  km_distance             NUMERIC     NOT NULL,
  regular_fare            NUMERIC     NOT NULL,
  discounted_fare         NUMERIC     NOT NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT unique_route UNIQUE (route_from, route_to)
);

-- ── 19.1. Baggage Fee Matrix ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS baggage_fee_matrix (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  category        TEXT        NOT NULL,
  max_weight_kg   NUMERIC     NOT NULL,
  fee             NUMERIC     NOT NULL,
  remarks         TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 20. Bus Schedules ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bus_schedules (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  bus_id      UUID        NOT NULL REFERENCES buses (id),
  day_number  INTEGER     NOT NULL CHECK (day_number BETWEEN 1 AND 10),
  trip_number INTEGER     NOT NULL CHECK (trip_number BETWEEN 1 AND 10),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT unique_bus_day_trip UNIQUE (bus_id, day_number, trip_number)
);

-- ── 21. Trip Schedules ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS trip_schedules (
  id                     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_number            INTEGER     NOT NULL CHECK (trip_number BETWEEN 1 AND 10),
  arrival_time_start     TIME        NOT NULL,
  arrival_time_end       TIME        NOT NULL,
  departure_time_start   TIME        NOT NULL,
  departure_time_end     TIME        NOT NULL,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT unique_trip_number UNIQUE (trip_number)
);

-- ── 22. Audit Logs ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_logs (
  id          BIGSERIAL PRIMARY KEY,
  username    TEXT        NOT NULL,
  action      TEXT        DEFAULT 'info' CHECK (action IN ('CREATE', 'UPDATE', 'DELETE', 'LOGIN', 'VIEW', 'EXPORT')),
  module      TEXT,
  details     TEXT,
  ip_address  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 23. Helper Functions ──────────────────────────────────────────────────────
-- Returns the active trip ID for the currently authenticated conductor
CREATE OR REPLACE FUNCTION conductor_active_trip_id()
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT id FROM trips
  WHERE conductor_id = auth.uid()
    AND status = 'in_progress'
  ORDER BY started_at DESC
  LIMIT 1;
$$;

-- Returns the role of the authenticated user
CREATE OR REPLACE FUNCTION current_user_role()
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT role::TEXT FROM staff_users WHERE id = auth.uid();
$$;

-- ── 24. Row-Level Security ────────────────────────────────────────────────────
ALTER TABLE staff_users           ENABLE ROW LEVEL SECURITY;
ALTER TABLE buses                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE trips                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE qr_cards              ENABLE ROW LEVEL SECURITY;
ALTER TABLE temporary_tickets     ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions          ENABLE ROW LEVEL SECURITY;
ALTER TABLE passenger_counts      ENABLE ROW LEVEL SECURITY;
ALTER TABLE boarded_passengers    ENABLE ROW LEVEL SECURITY;
ALTER TABLE gps_logs              ENABLE ROW LEVEL SECURITY;
ALTER TABLE fare_irregularities   ENABLE ROW LEVEL SECURITY;
ALTER TABLE emergency_alerts      ENABLE ROW LEVEL SECURITY;
ALTER TABLE emergency_contacts    ENABLE ROW LEVEL SECURITY;
ALTER TABLE sms_logs              ENABLE ROW LEVEL SECURITY;
ALTER TABLE gps_locations         ENABLE ROW LEVEL SECURITY;
ALTER TABLE hardware_status       ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_service_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE gcash_transactions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications         ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs            ENABLE ROW LEVEL SECURITY;
ALTER TABLE fare_matrix            ENABLE ROW LEVEL SECURITY;
ALTER TABLE baggage_fee_matrix     ENABLE ROW LEVEL SECURITY;
ALTER TABLE bus_schedules          ENABLE ROW LEVEL SECURITY;
ALTER TABLE trip_schedules         ENABLE ROW LEVEL SECURITY;

-- Staff can view their own profile (admins see all)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'staff_users' AND policyname = 'staff_users_self_select'
  ) THEN
    CREATE POLICY "staff_users_self_select"
      ON staff_users FOR SELECT
      USING (id = auth.uid() OR current_user_role() = 'admin');
  END IF;
END $$;

-- Authenticated staff can read all buses
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'buses' AND policyname = 'buses_read_all'
  ) THEN
    CREATE POLICY "buses_read_all"
      ON buses FOR SELECT
      USING (auth.role() = 'authenticated');
  END IF;
END $$;

-- Conductors can read/write their own trips; admins see all
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'trips' AND policyname = 'trips_conductor_rw'
  ) THEN
    CREATE POLICY "trips_conductor_rw"
      ON trips FOR ALL
      USING (conductor_id = auth.uid() OR current_user_role() = 'admin')
      WITH CHECK (conductor_id = auth.uid());
  END IF;
END $$;

-- QR cards: read by any authenticated staff
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'qr_cards' AND policyname = 'qr_cards_read_authenticated'
  ) THEN
    CREATE POLICY "qr_cards_read_authenticated"
      ON qr_cards FOR SELECT
      USING (auth.role() = 'authenticated');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'qr_cards' AND policyname = 'qr_cards_delete_authenticated'
  ) THEN
    CREATE POLICY "qr_cards_delete_authenticated"
      ON qr_cards FOR DELETE
      USING (auth.role() = 'authenticated');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'qr_cards' AND policyname = 'qr_cards_insert_authenticated'
  ) THEN
    CREATE POLICY "qr_cards_insert_authenticated"
      ON qr_cards FOR INSERT
      WITH CHECK (auth.role() = 'authenticated');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'qr_cards' AND policyname = 'qr_cards_update_authenticated'
  ) THEN
    CREATE POLICY "qr_cards_update_authenticated"
      ON qr_cards FOR UPDATE
      USING (auth.role() = 'authenticated');
  END IF;
END $$;

-- Temporary tickets: full access for authenticated staff
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'temporary_tickets' AND policyname = 'temp_tickets_rw_authenticated'
  ) THEN
    CREATE POLICY "temp_tickets_rw_authenticated"
      ON temporary_tickets FOR ALL
      USING (auth.role() = 'authenticated')
      WITH CHECK (auth.role() = 'authenticated');
  END IF;
END $$;

-- Transactions: insert + select for authenticated staff
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'transactions' AND policyname = 'transactions_insert_authenticated'
  ) THEN
    CREATE POLICY "transactions_insert_authenticated"
      ON transactions FOR INSERT
      WITH CHECK (auth.role() = 'authenticated');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'transactions' AND policyname = 'transactions_select_authenticated'
  ) THEN
    CREATE POLICY "transactions_select_authenticated"
      ON transactions FOR SELECT
      USING (auth.role() = 'authenticated');
  END IF;
END $$;

-- Passenger counts
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'passenger_counts' AND policyname = 'passenger_counts_rw_authenticated'
  ) THEN
    CREATE POLICY "passenger_counts_rw_authenticated"
      ON passenger_counts FOR ALL
      USING (auth.role() = 'authenticated')
      WITH CHECK (auth.role() = 'authenticated');
  END IF;
END $$;

-- Boarded passengers
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'boarded_passengers' AND policyname = 'boarded_passengers_rw_authenticated'
  ) THEN
    CREATE POLICY "boarded_passengers_rw_authenticated"
      ON boarded_passengers FOR ALL
      USING (auth.role() = 'authenticated')
      WITH CHECK (auth.role() = 'authenticated');
  END IF;
END $$;

-- GPS logs
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'gps_logs' AND policyname = 'gps_logs_rw_authenticated'
  ) THEN
    CREATE POLICY "gps_logs_rw_authenticated"
      ON gps_logs FOR ALL
      USING (auth.role() = 'authenticated')
      WITH CHECK (auth.role() = 'authenticated');
  END IF;
END $$;

-- Fare irregularities
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'fare_irregularities' AND policyname = 'fare_irregularities_rw_authenticated'
  ) THEN
    CREATE POLICY "fare_irregularities_rw_authenticated"
      ON fare_irregularities FOR ALL
      USING (auth.role() = 'authenticated')
      WITH CHECK (auth.role() = 'authenticated');
  END IF;
END $$;

-- Emergency alerts
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'emergency_alerts' AND policyname = 'emergency_alerts_rw_authenticated'
  ) THEN
    CREATE POLICY "emergency_alerts_rw_authenticated"
      ON emergency_alerts FOR ALL
      USING (auth.role() = 'authenticated')
      WITH CHECK (auth.role() = 'authenticated');
  END IF;
END $$;

-- Emergency contacts
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'emergency_contacts' AND policyname = 'emergency_contacts_rw_authenticated'
  ) THEN
    CREATE POLICY "emergency_contacts_rw_authenticated"
      ON emergency_contacts FOR ALL
      USING (auth.role() = 'authenticated')
      WITH CHECK (auth.role() = 'authenticated');
  END IF;
END $$;

-- SMS logs
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'sms_logs' AND policyname = 'sms_logs_rw_authenticated'
  ) THEN
    CREATE POLICY "sms_logs_rw_authenticated"
      ON sms_logs FOR ALL
      USING (auth.role() = 'authenticated')
      WITH CHECK (auth.role() = 'authenticated');
  END IF;
END $$;

-- GPS locations
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'gps_locations' AND policyname = 'gps_locations_rw_authenticated'
  ) THEN
    CREATE POLICY "gps_locations_rw_authenticated"
      ON gps_locations FOR ALL
      USING (auth.role() = 'authenticated')
      WITH CHECK (auth.role() = 'authenticated');
  END IF;
END $$;

-- Hardware status
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'hardware_status' AND policyname = 'hardware_status_rw_authenticated'
  ) THEN
    CREATE POLICY "hardware_status_rw_authenticated"
      ON hardware_status FOR ALL
      USING (auth.role() = 'authenticated')
      WITH CHECK (auth.role() = 'authenticated');
  END IF;
END $$;

-- Customer service logs
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'customer_service_logs' AND policyname = 'cs_logs_rw_authenticated'
  ) THEN
    CREATE POLICY "cs_logs_rw_authenticated"
      ON customer_service_logs FOR ALL
      USING (auth.role() = 'authenticated')
      WITH CHECK (auth.role() = 'authenticated');
  END IF;
END $$;

-- GCash transactions
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'gcash_transactions' AND policyname = 'gcash_transactions_rw_authenticated'
  ) THEN
    CREATE POLICY "gcash_transactions_rw_authenticated"
      ON gcash_transactions FOR ALL
      USING (auth.role() = 'authenticated')
      WITH CHECK (auth.role() = 'authenticated');
  END IF;
END $$;

-- Notifications
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'notifications' AND policyname = 'notifications_rw_authenticated'
  ) THEN
    CREATE POLICY "notifications_rw_authenticated"
      ON notifications FOR ALL
      USING (auth.role() = 'authenticated')
      WITH CHECK (auth.role() = 'authenticated');
  END IF;
END $$;

-- Audit logs
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'audit_logs' AND policyname = 'audit_logs_rw_authenticated'
  ) THEN
    CREATE POLICY "audit_logs_rw_authenticated"
      ON audit_logs FOR ALL
      USING (auth.role() = 'authenticated')
      WITH CHECK (auth.role() = 'authenticated');
  END IF;
END $$;

-- Fare matrix
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'fare_matrix' AND policyname = 'fare_matrix_rw_authenticated'
  ) THEN
    CREATE POLICY "fare_matrix_rw_authenticated"
      ON fare_matrix FOR ALL
      USING (auth.role() = 'authenticated')
      WITH CHECK (auth.role() = 'authenticated');
  END IF;
END $$;

-- Baggage fee matrix
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'baggage_fee_matrix' AND policyname = 'baggage_fee_matrix_rw_authenticated'
  ) THEN
    CREATE POLICY "baggage_fee_matrix_rw_authenticated"
      ON baggage_fee_matrix FOR ALL
      USING (auth.role() = 'authenticated')
      WITH CHECK (auth.role() = 'authenticated');
  END IF;
END $$;

-- Bus schedules
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'bus_schedules' AND policyname = 'bus_schedules_rw_authenticated'
  ) THEN
    CREATE POLICY "bus_schedules_rw_authenticated"
      ON bus_schedules FOR ALL
      USING (auth.role() = 'authenticated')
      WITH CHECK (auth.role() = 'authenticated');
  END IF;
END $$;

-- Trip schedules
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'trip_schedules' AND policyname = 'trip_schedules_rw_authenticated'
  ) THEN
    CREATE POLICY "trip_schedules_rw_authenticated"
      ON trip_schedules FOR ALL
      USING (auth.role() = 'authenticated')
      WITH CHECK (auth.role() = 'authenticated');
  END IF;
END $$;

-- ── 25. Indexes for Performance ───────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_trips_conductor_status
  ON trips(conductor_id, status) WHERE status = 'in_progress';

CREATE INDEX IF NOT EXISTS idx_qr_cards_uid
  ON qr_cards(card_uid);

CREATE INDEX IF NOT EXISTS idx_temp_tickets_uid
  ON temporary_tickets(ticket_uid);

CREATE INDEX IF NOT EXISTS idx_transactions_trip
  ON transactions(trip_id);

CREATE INDEX IF NOT EXISTS idx_boarded_passengers_trip
  ON boarded_passengers(trip_id);

CREATE INDEX IF NOT EXISTS idx_passenger_counts_trip
  ON passenger_counts(trip_id);

CREATE INDEX IF NOT EXISTS idx_passenger_counts_recorded_at
  ON passenger_counts(recorded_at);

CREATE INDEX IF NOT EXISTS idx_fare_irregularities_trip
  ON fare_irregularities(trip_id);

CREATE INDEX IF NOT EXISTS idx_gps_logs_trip
  ON gps_logs(trip_id);

CREATE INDEX IF NOT EXISTS idx_emergency_alerts_trip
  ON emergency_alerts(trip_id);

CREATE INDEX IF NOT EXISTS idx_emergency_alerts_status
  ON emergency_alerts(status);

CREATE INDEX IF NOT EXISTS idx_emergency_alerts_triggered_at
  ON emergency_alerts(triggered_at);

-- Hardware integration indexes
CREATE INDEX IF NOT EXISTS idx_sms_logs_phone_number
  ON sms_logs(phone_number);

CREATE INDEX IF NOT EXISTS idx_sms_logs_sms_type
  ON sms_logs(sms_type);

CREATE INDEX IF NOT EXISTS idx_sms_logs_created_at
  ON sms_logs(created_at);

CREATE INDEX IF NOT EXISTS idx_sms_logs_trip_id
  ON sms_logs(trip_id);

CREATE INDEX IF NOT EXISTS idx_gps_locations_trip_id
  ON gps_locations(trip_id);

CREATE INDEX IF NOT EXISTS idx_gps_locations_recorded_at
  ON gps_locations(recorded_at);

CREATE INDEX IF NOT EXISTS idx_gps_locations_source
  ON gps_locations(source);

CREATE INDEX IF NOT EXISTS idx_hardware_status_component
  ON hardware_status(component);

CREATE INDEX IF NOT EXISTS idx_hardware_status_last_check
  ON hardware_status(last_check);

-- Hardware integration views
CREATE OR REPLACE VIEW trip_statistics AS
SELECT 
  trip_id,
  COUNT(*) as total_recordings,
  AVG(count) as average_passengers,
  MAX(count) as max_passengers,
  MIN(count) as min_passengers,
  MIN(recorded_at) as first_recording,
  MAX(recorded_at) as last_recording
FROM passenger_counts
GROUP BY trip_id;

CREATE OR REPLACE VIEW sms_statistics AS
SELECT 
  DATE(created_at) as date,
  sms_type,
  COUNT(*) as total_sent,
  COUNT(*) FILTER (WHERE status = 'sent') as successful,
  COUNT(*) FILTER (WHERE status = 'failed') as failed
FROM sms_logs
GROUP BY DATE(created_at), sms_type
ORDER BY date DESC, sms_type;

CREATE OR REPLACE VIEW emergency_statistics AS
SELECT 
  COALESCE(DATE(triggered_at), DATE(created_at)) as date,
  COUNT(*) as total_emergencies,
  COUNT(*) FILTER (WHERE status = 'resolved') as resolved,
  COUNT(*) FILTER (WHERE status != 'resolved') as unresolved
FROM emergency_alerts
GROUP BY COALESCE(DATE(triggered_at), DATE(created_at))
ORDER BY date DESC;

CREATE OR REPLACE VIEW gps_statistics AS
SELECT 
  DATE(recorded_at) as date,
  source,
  COUNT(*) as total_readings,
  AVG(accuracy) as avg_accuracy,
  AVG(speed) as avg_speed
FROM gps_locations
GROUP BY DATE(recorded_at), source
ORDER BY date DESC, source;

CREATE INDEX IF NOT EXISTS idx_gcash_transactions_created_at
  ON gcash_transactions(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_gcash_transactions_status
  ON gcash_transactions(status);

CREATE INDEX IF NOT EXISTS idx_gcash_transactions_phone_number
  ON gcash_transactions(phone_number);

CREATE INDEX IF NOT EXISTS idx_notifications_created_at
  ON notifications(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_read
  ON notifications(read);

CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at
  ON audit_logs(created_at);

CREATE INDEX IF NOT EXISTS idx_audit_logs_username
  ON audit_logs(username);

CREATE INDEX IF NOT EXISTS idx_audit_logs_action
  ON audit_logs(action);

CREATE INDEX IF NOT EXISTS idx_fare_matrix_route
  ON fare_matrix(route_from, route_to);

CREATE INDEX IF NOT EXISTS idx_baggage_fee_matrix_category
  ON baggage_fee_matrix(category);

CREATE INDEX IF NOT EXISTS idx_bus_schedules_bus_day
  ON bus_schedules(bus_id, day_number);

CREATE INDEX IF NOT EXISTS idx_bus_schedules_day_trip
  ON bus_schedules(day_number, trip_number);

CREATE INDEX IF NOT EXISTS idx_trip_schedules_trip_number
  ON trip_schedules(trip_number);

-- ── 26. Realtime Publications ─────────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'passenger_counts'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE passenger_counts;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'fare_irregularities'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE fare_irregularities;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'emergency_alerts'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE emergency_alerts;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'trips'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE trips;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'boarded_passengers'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE boarded_passengers;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'emergency_contacts'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE emergency_contacts;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'sms_logs'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE sms_logs;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'gps_locations'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE gps_locations;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'hardware_status'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE hardware_status;
  END IF;
END $$;

-- ============================================================
-- Schema complete.
-- ============================================================

-- ── 27. Seed: Test Bus Data ───────────────────────────────────────────────────
INSERT INTO buses (plate_number, bus_number, route, seat_capacity, status) VALUES
  ('BUS-001', 1001, 'Manalo Fortich Terminal ↔ Agora Terminal', 35, 'active'),
  ('BUS-002', 1002, 'Manalo Fortich Terminal ↔ Agora Terminal', 35, 'active'),
  ('BUS-003', 1003, 'Manalo Fortich Terminal ↔ Agora Terminal', 35, 'active'),
  ('BUS-004', 1004, 'Manalo Fortich Terminal ↔ Agora Terminal', 35, 'active'),
  ('BUS-005', 1005, 'Manalo Fortich Terminal ↔ Agora Terminal', 35, 'active'),
  ('BUS-006', 1006, 'Manalo Fortich Terminal ↔ Agora Terminal', 35, 'active'),
  ('BUS-007', 1007, 'Manalo Fortich Terminal ↔ Agora Terminal', 35, 'active'),
  ('BUS-008', 1008, 'Manalo Fortich Terminal ↔ Agora Terminal', 35, 'active'),
  ('BUS-009', 1009, 'Manalo Fortich Terminal ↔ Agora Terminal', 35, 'active'),
  ('BUS-010', 1010, 'Manalo Fortich Terminal ↔ Agora Terminal', 35, 'active')
ON CONFLICT (plate_number) DO UPDATE SET
  bus_number = EXCLUDED.bus_number,
  route = EXCLUDED.route,
  seat_capacity = EXCLUDED.seat_capacity,
  status = EXCLUDED.status;

-- ── 28. Seed: Fare Matrix Data ─────────────────────────────────────────────────
INSERT INTO fare_matrix (route_from, route_to, km_distance, regular_fare, discounted_fare) VALUES
  ('Agora Terminal', 'Puerto', 13, 34.75, 27.75),
  ('Agora Terminal', 'Ba-e', 16, 41.50, 33.00),
  ('Agora Terminal', 'Mambatangan', 20, 50.25, 40.25),
  ('Agora Terminal', 'Maitom', 24, 59.00, 47.25),
  ('Agora Terminal', 'Ala-e', 26, 63.50, 50.75),
  ('Agora Terminal', 'Lonocan', 27, 65.50, 52.50),
  ('Agora Terminal', 'San Miguel', 31, 74.50, 59.50),
  ('Agora Terminal', 'Diclum', 35, 83.25, 66.50),
  ('Agora Terminal', 'Manolo Fortich', 36, 85.50, 68.25),
  ('Puerto', 'Agora Terminal', 13, 34.75, 27.75),
  ('Ba-e', 'Agora Terminal', 16, 41.50, 33.00),
  ('Mambatangan', 'Agora Terminal', 20, 50.25, 40.25),
  ('Maitom', 'Agora Terminal', 24, 59.00, 47.25),
  ('Ala-e', 'Agora Terminal', 26, 63.50, 50.75),
  ('Lonocan', 'Agora Terminal', 27, 65.50, 52.50),
  ('San Miguel', 'Agora Terminal', 31, 74.50, 59.50),
  ('Diclum', 'Agora Terminal', 35, 83.25, 66.50),
  ('Manolo Fortich', 'Agora Terminal', 36, 85.50, 68.25)
ON CONFLICT (route_from, route_to) DO NOTHING;

-- ── 28.1. Seed: Baggage Fee Matrix Data ─────────────────────────────────────────────
INSERT INTO baggage_fee_matrix (category, max_weight_kg, fee, remarks) VALUES
  ('Free Carry-on', 7, 0, 'Included in passenger fare'),
  ('Small', 10, 20, 'Fits under seat or overhead area'),
  ('Medium', 20, 40, 'Stored in baggage compartment'),
  ('Large', 30, 60, 'Requires larger storage space'),
  ('Oversized', 31, 100, 'Subject to conductor approval')
ON CONFLICT DO NOTHING;

-- ── 29. Seed: Trip Schedule Data ─────────────────────────────────────────────────
INSERT INTO trip_schedules (trip_number, arrival_time_start, arrival_time_end, departure_time_start, departure_time_end) VALUES
  (1, '04:15:00', '04:25:00', '04:30:00', '04:30:00'),
  (2, '04:45:00', '04:45:00', '05:15:00', '05:15:00'),
  (3, '05:15:00', '05:15:00', '05:45:00', '05:45:00'),
  (4, '05:40:00', '05:40:00', '06:10:00', '06:15:00'),
  (5, '06:00:00', '06:00:00', '06:30:00', '06:35:00'),
  (6, '06:20:00', '06:20:00', '06:50:00', '06:55:00'),
  (7, '06:40:00', '06:40:00', '07:10:00', '07:15:00'),
  (8, '07:00:00', '07:00:00', '07:30:00', '07:35:00'),
  (9, '07:20:00', '07:20:00', '07:50:00', '07:55:00'),
  (10, '07:40:00', '07:40:00', '08:10:00', '08:15:00')
ON CONFLICT (trip_number) DO NOTHING;

-- ── 30. Seed: Bus Schedule Data ───────────────────────────────────────────────────
-- Get bus IDs for scheduling
DO $$
DECLARE
  bus_1001_id UUID;
  bus_1002_id UUID;
  bus_1003_id UUID;
  bus_1004_id UUID;
  bus_1005_id UUID;
  bus_1006_id UUID;
  bus_1007_id UUID;
  bus_1008_id UUID;
  bus_1009_id UUID;
  bus_1010_id UUID;
BEGIN
  SELECT id INTO bus_1001_id FROM buses WHERE bus_number = 1001;
  SELECT id INTO bus_1002_id FROM buses WHERE bus_number = 1002;
  SELECT id INTO bus_1003_id FROM buses WHERE bus_number = 1003;
  SELECT id INTO bus_1004_id FROM buses WHERE bus_number = 1004;
  SELECT id INTO bus_1005_id FROM buses WHERE bus_number = 1005;
  SELECT id INTO bus_1006_id FROM buses WHERE bus_number = 1006;
  SELECT id INTO bus_1007_id FROM buses WHERE bus_number = 1007;
  SELECT id INTO bus_1008_id FROM buses WHERE bus_number = 1008;
  SELECT id INTO bus_1009_id FROM buses WHERE bus_number = 1009;
  SELECT id INTO bus_1010_id FROM buses WHERE bus_number = 1010;

  -- Insert bus schedules for Day 1
  INSERT INTO bus_schedules (bus_id, day_number, trip_number) VALUES
    (bus_1007_id, 1, 1), (bus_1008_id, 1, 2), (bus_1005_id, 1, 3), (bus_1004_id, 1, 4),
    (bus_1003_id, 1, 5), (bus_1002_id, 1, 6), (bus_1009_id, 1, 7), (bus_1010_id, 1, 8),
    (bus_1001_id, 1, 9), (bus_1006_id, 1, 10)
  ON CONFLICT (bus_id, day_number, trip_number) DO NOTHING;

  -- Insert bus schedules for Day 2
  INSERT INTO bus_schedules (bus_id, day_number, trip_number) VALUES
    (bus_1008_id, 2, 1), (bus_1005_id, 2, 2), (bus_1004_id, 2, 3), (bus_1003_id, 2, 4),
    (bus_1002_id, 2, 5), (bus_1009_id, 2, 6), (bus_1010_id, 2, 7), (bus_1001_id, 2, 8),
    (bus_1006_id, 2, 9), (bus_1007_id, 2, 10)
  ON CONFLICT (bus_id, day_number, trip_number) DO NOTHING;

  -- Insert bus schedules for Day 3
  INSERT INTO bus_schedules (bus_id, day_number, trip_number) VALUES
    (bus_1005_id, 3, 1), (bus_1004_id, 3, 2), (bus_1003_id, 3, 3), (bus_1002_id, 3, 4),
    (bus_1009_id, 3, 5), (bus_1010_id, 3, 6), (bus_1001_id, 3, 7), (bus_1006_id, 3, 8),
    (bus_1007_id, 3, 9), (bus_1008_id, 3, 10)
  ON CONFLICT (bus_id, day_number, trip_number) DO NOTHING;

  -- Insert bus schedules for Day 4
  INSERT INTO bus_schedules (bus_id, day_number, trip_number) VALUES
    (bus_1004_id, 4, 1), (bus_1003_id, 4, 2), (bus_1002_id, 4, 3), (bus_1009_id, 4, 4),
    (bus_1010_id, 4, 5), (bus_1001_id, 4, 6), (bus_1006_id, 4, 7), (bus_1007_id, 4, 8),
    (bus_1008_id, 4, 9), (bus_1005_id, 4, 10)
  ON CONFLICT (bus_id, day_number, trip_number) DO NOTHING;

  -- Insert bus schedules for Day 5
  INSERT INTO bus_schedules (bus_id, day_number, trip_number) VALUES
    (bus_1003_id, 5, 1), (bus_1002_id, 5, 2), (bus_1009_id, 5, 3), (bus_1010_id, 5, 4),
    (bus_1001_id, 5, 5), (bus_1006_id, 5, 6), (bus_1007_id, 5, 7), (bus_1008_id, 5, 8),
    (bus_1005_id, 5, 9), (bus_1004_id, 5, 10)
  ON CONFLICT (bus_id, day_number, trip_number) DO NOTHING;

  -- Insert bus schedules for Day 6
  INSERT INTO bus_schedules (bus_id, day_number, trip_number) VALUES
    (bus_1002_id, 6, 1), (bus_1009_id, 6, 2), (bus_1010_id, 6, 3), (bus_1001_id, 6, 4),
    (bus_1006_id, 6, 5), (bus_1007_id, 6, 6), (bus_1008_id, 6, 7), (bus_1005_id, 6, 8),
    (bus_1004_id, 6, 9), (bus_1003_id, 6, 10)
  ON CONFLICT (bus_id, day_number, trip_number) DO NOTHING;

  -- Insert bus schedules for Day 7
  INSERT INTO bus_schedules (bus_id, day_number, trip_number) VALUES
    (bus_1009_id, 7, 1), (bus_1010_id, 7, 2), (bus_1001_id, 7, 3), (bus_1006_id, 7, 4),
    (bus_1007_id, 7, 5), (bus_1008_id, 7, 6), (bus_1005_id, 7, 7), (bus_1004_id, 7, 8),
    (bus_1003_id, 7, 9), (bus_1002_id, 7, 10)
  ON CONFLICT (bus_id, day_number, trip_number) DO NOTHING;

  -- Insert bus schedules for Day 8
  INSERT INTO bus_schedules (bus_id, day_number, trip_number) VALUES
    (bus_1010_id, 8, 1), (bus_1001_id, 8, 2), (bus_1006_id, 8, 3), (bus_1007_id, 8, 4),
    (bus_1008_id, 8, 5), (bus_1005_id, 8, 6), (bus_1004_id, 8, 7), (bus_1003_id, 8, 8),
    (bus_1002_id, 8, 9), (bus_1009_id, 8, 10)
  ON CONFLICT (bus_id, day_number, trip_number) DO NOTHING;

  -- Insert bus schedules for Day 9
  INSERT INTO bus_schedules (bus_id, day_number, trip_number) VALUES
    (bus_1001_id, 9, 1), (bus_1006_id, 9, 2), (bus_1007_id, 9, 3), (bus_1008_id, 9, 4),
    (bus_1005_id, 9, 5), (bus_1004_id, 9, 6), (bus_1003_id, 9, 7), (bus_1002_id, 9, 8),
    (bus_1009_id, 9, 9), (bus_1010_id, 9, 10)
  ON CONFLICT (bus_id, day_number, trip_number) DO NOTHING;

  -- Insert bus schedules for Day 10
  INSERT INTO bus_schedules (bus_id, day_number, trip_number) VALUES
    (bus_1006_id, 10, 1), (bus_1007_id, 10, 2), (bus_1008_id, 10, 3), (bus_1005_id, 10, 4),
    (bus_1004_id, 10, 5), (bus_1003_id, 10, 6), (bus_1002_id, 10, 7), (bus_1009_id, 10, 8),
    (bus_1010_id, 10, 9), (bus_1001_id, 10, 10)
  ON CONFLICT (bus_id, day_number, trip_number) DO NOTHING;
END $$;

-- ── 31. Create Admin Test User Instructions ─────────────────────────────────────
-- To create test users, follow these steps in the Supabase Dashboard:
--
-- 1. Go to Supabase Dashboard → Authentication → Users → Add user
-- 2. Email: admin@commutai.test  Password: Admin123!  Auto-confirm: Yes
-- 3. Copy the user UUID from the users table, then run:
--
--    INSERT INTO staff_users (id, full_name, email, role, is_active)
--    VALUES (
--      '<paste-uuid-here>',
--      'System Admin',
--      'admin@commutai.test',
--      'admin',
--      true
--    );
--
-- 4. Repeat for conductor:
--    Email: conductor@commutai.test  Password: Conductor123!
--    Role: conductor
--
-- 5. Repeat for CS Desk:
--    Email: csdesk@commutai.test  Password: CSDesk123!
--    Role: cs_desk

-- Note: Additional maintenance and utility queries have been moved to maintenance_queries.sql
