-- ============================================================
-- CommutAI · Conductor App Database Schema
-- Clean schema focused on conductor app functionality
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

-- ── 1. Staff Users ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS staff_users (
  id          UUID        PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  full_name   TEXT        NOT NULL,
  email       TEXT        NOT NULL UNIQUE,
  role        staff_role  NOT NULL DEFAULT 'conductor',
  is_active   BOOLEAN     NOT NULL DEFAULT TRUE,
  bus_id      UUID        REFERENCES buses (id),
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

-- Add bus_number column if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'buses' AND column_name = 'bus_number'
  ) THEN
    ALTER TABLE buses ADD COLUMN bus_number INTEGER UNIQUE;
  END IF;
END $$;

-- ── 3. Trips ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS trips (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  bus_id          UUID        NOT NULL REFERENCES buses (id),
  conductor_id    UUID        NOT NULL REFERENCES staff_users (id),
  started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at        TIMESTAMPTZ,
  status          trip_status NOT NULL DEFAULT 'in_progress',
  current_lat     FLOAT8,
  current_lng     FLOAT8,
  gps_updated_at  TIMESTAMPTZ,
  starting_point  TEXT,
  end_point       TEXT
);

-- Add starting_point and end_point columns if they don't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'trips' AND column_name = 'starting_point'
  ) THEN
    ALTER TABLE trips ADD COLUMN starting_point TEXT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'trips' AND column_name = 'end_point'
  ) THEN
    ALTER TABLE trips ADD COLUMN end_point TEXT;
  END IF;
END $$;

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
  passenger_id    UUID,
  destination     TEXT,
  issued_by       UUID           REFERENCES staff_users (id),
  created_at      TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

-- Add card_type, purchase_price, and destination columns if they don't exist
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
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'qr_cards' AND column_name = 'destination'
  ) THEN
    ALTER TABLE qr_cards ADD COLUMN destination TEXT;
  END IF;
END $$;

-- Update existing card_type values if enum was changed from old values
DO $$
BEGIN
  UPDATE qr_cards SET card_type = 'senior_citizen' WHERE card_type = 'elderly';
  UPDATE qr_cards SET card_type = 'pwd' WHERE card_type = 'disabled';
EXCEPTION WHEN others THEN NULL;
END $$;

-- ── 5. Temporary Tickets ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS temporary_tickets (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_uid      TEXT          NOT NULL UNIQUE,
  fare_amount     NUMERIC(10,2) NOT NULL DEFAULT 12,
  status          ticket_status NOT NULL DEFAULT 'issued',
  allowed_routes  TEXT[]        DEFAULT '{}',
  passenger_id    UUID,
  passenger_type  TEXT          DEFAULT 'regular',
  trip_id         UUID          REFERENCES trips (id),
  destination     TEXT,
  issued_by       UUID          REFERENCES staff_users (id),
  issued_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  validated_at    TIMESTAMPTZ
);

-- Add passenger_type column if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'temporary_tickets' AND column_name = 'passenger_type'
  ) THEN
    ALTER TABLE temporary_tickets ADD COLUMN passenger_type TEXT DEFAULT 'regular';
  END IF;
END $$;

-- ── 6. Transactions ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS transactions (
  id               UUID             PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id          UUID             REFERENCES qr_cards (id),
  temp_ticket_id   UUID             REFERENCES temporary_tickets (id),
  trip_id          UUID             REFERENCES trips (id),
  type             transaction_type NOT NULL,
  amount           NUMERIC(10,2)    NOT NULL,
  channel          TEXT             NOT NULL,
  staff_id         UUID             REFERENCES staff_users (id),
  created_at       TIMESTAMPTZ      NOT NULL DEFAULT NOW(),
  baggage_category TEXT,
  baggage_weight   NUMERIC(10,2),
  baggage_fee      NUMERIC(10,2),
  payment_method   TEXT
);

-- Add payment_method column if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'transactions' AND column_name = 'payment_method'
  ) THEN
    ALTER TABLE transactions ADD COLUMN payment_method TEXT;
  END IF;
END $$;

-- Add baggage columns if they don't exist
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
CREATE TABLE IF NOT EXISTS passenger_counts (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id      UUID        NOT NULL REFERENCES trips (id) ON DELETE CASCADE,
  count        INTEGER     NOT NULL,
  recorded_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ai_count     INTEGER,
  source       TEXT        NOT NULL DEFAULT 'manual'
);

-- Add ai_count and source columns if they don't exist
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
CREATE TABLE IF NOT EXISTS boarded_passengers (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id         UUID        NOT NULL REFERENCES trips (id) ON DELETE CASCADE,
  passenger_id    UUID,
  card_id         UUID        REFERENCES qr_cards (id),
  temp_ticket_id  UUID        REFERENCES temporary_tickets (id),
  boarded_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  alighted_at     TIMESTAMPTZ,
  payment_method  TEXT,
  CONSTRAINT chk_boarding_source CHECK (card_id IS NOT NULL OR temp_ticket_id IS NOT NULL)
);

-- Add alighted_at column if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'boarded_passengers' AND column_name = 'alighted_at'
  ) THEN
    ALTER TABLE boarded_passengers ADD COLUMN alighted_at TIMESTAMPTZ;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'boarded_passengers' AND column_name = 'payment_method'
  ) THEN
    ALTER TABLE boarded_passengers ADD COLUMN payment_method TEXT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'boarded_passengers' AND column_name = 'boarding_stop'
  ) THEN
    ALTER TABLE boarded_passengers ADD COLUMN boarding_stop TEXT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'boarded_passengers' AND column_name = 'destination_stop'
  ) THEN
    ALTER TABLE boarded_passengers ADD COLUMN destination_stop TEXT;
  END IF;
END $$;

-- ── 9. GPS Logs ───────────────────────────────────────────────────────────────
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
  status           TEXT        NOT NULL DEFAULT 'active',
  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  acknowledged_at  TIMESTAMPTZ,
  resolved_at      TIMESTAMPTZ,
  triggered_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  location_lat     DECIMAL(10, 8),
  location_lng     DECIMAL(11, 8),
  location_source  TEXT,
  location_accuracy DECIMAL(10, 2)
);

-- Add hardware integration columns if they don't exist
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

-- ── 12. Baggage Fee Matrix ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS baggage_fee_matrix (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  category        TEXT        NOT NULL,
  max_weight_kg   NUMERIC     NOT NULL,
  fee             NUMERIC     NOT NULL,
  remarks         TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 13. Helper Functions ──────────────────────────────────────────────────────
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

-- ── 14. Row-Level Security ────────────────────────────────────────────────────
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
ALTER TABLE baggage_fee_matrix    ENABLE ROW LEVEL SECURITY;

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

-- ── 15. Indexes for Performance ───────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_trips_conductor_status
  ON trips(conductor_id, status) WHERE status = 'in_progress';

-- Enforce one active trip per conductor at the database level.
-- This is the hard stop that prevents duplicate in_progress trips
-- regardless of which device or client inserts the row.
CREATE UNIQUE INDEX IF NOT EXISTS idx_trips_conductor_one_active
  ON trips(conductor_id) WHERE status = 'in_progress';

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

CREATE INDEX IF NOT EXISTS idx_baggage_fee_matrix_category
  ON baggage_fee_matrix(category);

-- ── 16. Realtime Publications ─────────────────────────────────────────────────
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

-- ============================================================
-- Schema complete.
-- ============================================================

-- ── 17. Seed: Test Bus Data ───────────────────────────────────────────────────
INSERT INTO buses (plate_number, bus_number, route, seat_capacity, status) VALUES
  ('BUS-001', 1001, 'Manolo Fortich Terminal ↔ Agora Terminal', 35, 'active'),
  ('BUS-002', 1002, 'Manolo Fortich Terminal ↔ Agora Terminal', 35, 'active'),
  ('BUS-003', 1003, 'Manolo Fortich Terminal ↔ Agora Terminal', 35, 'active'),
  ('BUS-004', 1004, 'Manolo Fortich Terminal ↔ Agora Terminal', 35, 'active'),
  ('BUS-005', 1005, 'Manolo Fortich Terminal ↔ Agora Terminal', 35, 'active'),
  ('BUS-006', 1006, 'Manolo Fortich Terminal ↔ Agora Terminal', 35, 'active'),
  ('BUS-007', 1007, 'Manolo Fortich Terminal ↔ Agora Terminal', 35, 'active'),
  ('BUS-008', 1008, 'Manolo Fortich Terminal ↔ Agora Terminal', 35, 'active'),
  ('BUS-009', 1009, 'Manolo Fortich Terminal ↔ Agora Terminal', 35, 'active'),
  ('BUS-010', 1010, 'Manolo Fortich Terminal ↔ Agora Terminal', 35, 'active')
ON CONFLICT (plate_number) DO UPDATE SET
  bus_number = EXCLUDED.bus_number,
  route = EXCLUDED.route,
  seat_capacity = EXCLUDED.seat_capacity,
  status = EXCLUDED.status;

-- ── 18. Seed: Baggage Fee Matrix Data ─────────────────────────────────────────
INSERT INTO baggage_fee_matrix (category, max_weight_kg, fee, remarks) VALUES
  ('Free Carry-on', 7, 0, 'Included in passenger fare'),
  ('Small', 10, 20, 'Fits under seat or overhead area'),
  ('Medium', 20, 40, 'Stored in baggage compartment'),
  ('Large', 30, 60, 'Requires larger storage space'),
  ('Oversized', 31, 100, 'Subject to conductor approval')
ON CONFLICT DO NOTHING;

-- ── 19. Create Admin Test User Instructions ─────────────────────────────────────
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