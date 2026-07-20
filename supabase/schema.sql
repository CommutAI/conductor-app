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
  CREATE TYPE ticket_status AS ENUM ('issued', 'validated', 'expired');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE transaction_type AS ENUM ('fare_validation', 'balance_topup', 'card_issuance');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE irregularity_type AS ENUM ('double_scan', 'count_mismatch', 'fare_evasion', 'other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE cs_action_type AS ENUM ('complaint', 'inquiry', 'refund', 'lost_card', 'other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE passenger_type AS ENUM ('regular', 'student', 'senior_citizen', 'pwd');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- ── 1. Staff Users ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS staff_users (
  id          UUID PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  full_name   TEXT        NOT NULL,
  email       TEXT        NOT NULL UNIQUE,
  role        staff_role  NOT NULL DEFAULT 'conductor',
  is_active   BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

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
    email = EXCLUDED.email,
    role = EXCLUDED.role;
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
  id             UUID       PRIMARY KEY DEFAULT gen_random_uuid(),
  plate_number   TEXT       NOT NULL UNIQUE,
  route          TEXT       NOT NULL,
  seat_capacity  INTEGER    NOT NULL DEFAULT 50,
  status         bus_status NOT NULL DEFAULT 'active',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ── 3. Trips ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS trips (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  bus_id          UUID         NOT NULL REFERENCES buses (id),
  conductor_id    UUID         NOT NULL REFERENCES staff_users (id),
  started_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  ended_at        TIMESTAMPTZ,
  status          trip_status  NOT NULL DEFAULT 'in_progress',
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
  allowed_routes  TEXT[]         DEFAULT '{}',
  passenger_id    UUID,          -- links to a registered passenger if applicable
  passenger_type  passenger_type NOT NULL DEFAULT 'regular',
  destination     TEXT,          -- registered destination for the passenger
  route_id        UUID,          -- references routes(id)
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
  channel          TEXT             NOT NULL,  -- 'qr_card', 'temp_ticket', etc.
  staff_id         UUID             REFERENCES staff_users (id),
  created_at       TIMESTAMPTZ      NOT NULL DEFAULT NOW()
);


-- ── 7. Passenger Counts ───────────────────────────────────────────────────────
-- Records periodic headcount snapshots (manual + AI-assisted).
CREATE TABLE IF NOT EXISTS passenger_counts (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id      UUID        NOT NULL REFERENCES trips (id) ON DELETE CASCADE,
  count        INTEGER     NOT NULL DEFAULT 0,
  ai_count     INTEGER,    -- AI-estimated headcount from camera feed
  source       TEXT        NOT NULL DEFAULT 'manual',  -- 'manual' | 'ai' | 'scan'
  recorded_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ── 8. Boarded Passengers ─────────────────────────────────────────────────────
-- One row per successful boarding event (QR card or temp ticket validated).
CREATE TABLE IF NOT EXISTS boarded_passengers (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id         UUID        NOT NULL REFERENCES trips (id) ON DELETE CASCADE,
  passenger_id    UUID,       -- optional link to a registered passenger profile
  card_id         UUID        REFERENCES qr_cards (id),
  temp_ticket_id  UUID        REFERENCES temporary_tickets (id),
  boarded_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_boarding_source CHECK (
    card_id IS NOT NULL OR temp_ticket_id IS NOT NULL
  )
);


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
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id       UUID        NOT NULL REFERENCES trips (id) ON DELETE CASCADE,
  conductor_id  UUID        NOT NULL REFERENCES staff_users (id),
  bus_id        UUID        REFERENCES buses (id),
  lat           FLOAT8,
  lng           FLOAT8,
  status        TEXT        NOT NULL DEFAULT 'active',  -- 'active' | 'acknowledged' | 'resolved'
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  acknowledged_at TIMESTAMPTZ,
  resolved_at   TIMESTAMPTZ
);


-- ── 12. Customer Service Logs ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS customer_service_logs (
  id          UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id     UUID           REFERENCES trips (id),
  handled_by  UUID           REFERENCES staff_users (id),
  action      cs_action_type NOT NULL,
  description TEXT,
  created_at  TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);


-- ── 13. Routes ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS routes (
  id                    UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  terminal              TEXT         NOT NULL,
  destination           TEXT         NOT NULL,
  fare                  NUMERIC(10,2) NOT NULL,
  distance_km           NUMERIC(10,2),
  estimated_time_minutes INTEGER,
  UNIQUE(terminal, destination)
);


-- ── 14. Fare Validations ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fare_validations (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id          UUID         NOT NULL REFERENCES qr_cards (id),
  conductor_id     UUID         NOT NULL REFERENCES staff_users (id),
  route_id         UUID         NOT NULL REFERENCES routes (id),
  fare             NUMERIC(10,2) NOT NULL,
  discount         NUMERIC(10,2) DEFAULT 0,
  final_fare       NUMERIC(10,2) NOT NULL,
  balance_before   NUMERIC(10,2) NOT NULL,
  balance_after    NUMERIC(10,2) NOT NULL,
  validated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  status           TEXT         NOT NULL DEFAULT 'completed',
  trip_id          UUID         REFERENCES trips (id)
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


-- ── 15. Row-Level Security ────────────────────────────────────────────────────
-- Enable RLS on all tables that hold sensitive operational data.
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
ALTER TABLE customer_service_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE routes                ENABLE ROW LEVEL SECURITY;
ALTER TABLE fare_validations      ENABLE ROW LEVEL SECURITY;

-- Staff can view their own profile
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' 
    AND tablename = 'staff_users' 
    AND policyname = 'staff_users_self_select'
  ) THEN
    CREATE POLICY "staff_users_self_select"
      ON staff_users FOR SELECT
      USING (id = auth.uid() OR current_user_role() = 'admin');
  END IF;
END $$;

-- Conductors can read all buses
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' 
    AND tablename = 'buses' 
    AND policyname = 'buses_read_all'
  ) THEN
    CREATE POLICY "buses_read_all"
      ON buses FOR SELECT
      USING (auth.role() = 'authenticated');
  END IF;
END $$;

-- Conductors can read/write their own trips
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' 
    AND tablename = 'trips' 
    AND policyname = 'trips_conductor_rw'
  ) THEN
    CREATE POLICY "trips_conductor_rw"
      ON trips FOR ALL
      USING (conductor_id = auth.uid() OR current_user_role() = 'admin')
      WITH CHECK (conductor_id = auth.uid());
  END IF;
END $$;

-- QR cards readable by authenticated staff
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' 
    AND tablename = 'qr_cards' 
    AND policyname = 'qr_cards_read_authenticated'
  ) THEN
    CREATE POLICY "qr_cards_read_authenticated"
      ON qr_cards FOR SELECT
      USING (auth.role() = 'authenticated');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' 
    AND tablename = 'qr_cards' 
    AND policyname = 'qr_cards_update_authenticated'
  ) THEN
    CREATE POLICY "qr_cards_update_authenticated"
      ON qr_cards FOR UPDATE
      USING (auth.role() = 'authenticated');
  END IF;
END $$;

-- Temporary tickets readable/updatable by authenticated staff
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' 
    AND tablename = 'temporary_tickets' 
    AND policyname = 'temp_tickets_rw_authenticated'
  ) THEN
    CREATE POLICY "temp_tickets_rw_authenticated"
      ON temporary_tickets FOR ALL
      USING (auth.role() = 'authenticated')
      WITH CHECK (auth.role() = 'authenticated');
  END IF;
END $$;

-- Transactions insertable by authenticated staff
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' 
    AND tablename = 'transactions' 
    AND policyname = 'transactions_insert_authenticated'
  ) THEN
    CREATE POLICY "transactions_insert_authenticated"
      ON transactions FOR INSERT
      WITH CHECK (auth.role() = 'authenticated');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' 
    AND tablename = 'transactions' 
    AND policyname = 'transactions_select_authenticated'
  ) THEN
    CREATE POLICY "transactions_select_authenticated"
      ON transactions FOR SELECT
      USING (auth.role() = 'authenticated');
  END IF;
END $$;

-- Passenger counts insertable and readable by authenticated staff
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' 
    AND tablename = 'passenger_counts' 
    AND policyname = 'passenger_counts_rw_authenticated'
  ) THEN
    CREATE POLICY "passenger_counts_rw_authenticated"
      ON passenger_counts FOR ALL
      USING (auth.role() = 'authenticated')
      WITH CHECK (auth.role() = 'authenticated');
  END IF;
END $$;

-- Boarded passengers insertable and readable by authenticated staff
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' 
    AND tablename = 'boarded_passengers' 
    AND policyname = 'boarded_passengers_rw_authenticated'
  ) THEN
    CREATE POLICY "boarded_passengers_rw_authenticated"
      ON boarded_passengers FOR ALL
      USING (auth.role() = 'authenticated')
      WITH CHECK (auth.role() = 'authenticated');
  END IF;
END $$;

-- GPS logs insertable and readable by authenticated staff
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' 
    AND tablename = 'gps_logs' 
    AND policyname = 'gps_logs_rw_authenticated'
  ) THEN
    CREATE POLICY "gps_logs_rw_authenticated"
      ON gps_logs FOR ALL
      USING (auth.role() = 'authenticated')
      WITH CHECK (auth.role() = 'authenticated');
  END IF;
END $$;

-- Fare irregularities insertable by authenticated, readable by all staff
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' 
    AND tablename = 'fare_irregularities' 
    AND policyname = 'fare_irregularities_rw_authenticated'
  ) THEN
    CREATE POLICY "fare_irregularities_rw_authenticated"
      ON fare_irregularities FOR ALL
      USING (auth.role() = 'authenticated')
      WITH CHECK (auth.role() = 'authenticated');
  END IF;
END $$;

-- Emergency alerts insertable and readable by authenticated staff
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' 
    AND tablename = 'emergency_alerts' 
    AND policyname = 'emergency_alerts_rw_authenticated'
  ) THEN
    CREATE POLICY "emergency_alerts_rw_authenticated"
      ON emergency_alerts FOR ALL
      USING (auth.role() = 'authenticated')
      WITH CHECK (auth.role() = 'authenticated');
  END IF;
END $$;

-- Customer service logs
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' 
    AND tablename = 'customer_service_logs' 
    AND policyname = 'cs_logs_rw_authenticated'
  ) THEN
    CREATE POLICY "cs_logs_rw_authenticated"
      ON customer_service_logs FOR ALL
      USING (auth.role() = 'authenticated')
      WITH CHECK (auth.role() = 'authenticated');
  END IF;
END $$;

-- Routes readable by authenticated staff
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' 
    AND tablename = 'routes' 
    AND policyname = 'routes_read_authenticated'
  ) THEN
    CREATE POLICY "routes_read_authenticated"
      ON routes FOR SELECT
      USING (auth.role() = 'authenticated');
  END IF;
END $$;

-- Fare validations insertable and readable by authenticated staff
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' 
    AND tablename = 'fare_validations' 
    AND policyname = 'fare_validations_rw_authenticated'
  ) THEN
    CREATE POLICY "fare_validations_rw_authenticated"
      ON fare_validations FOR ALL
      USING (auth.role() = 'authenticated')
      WITH CHECK (auth.role() = 'authenticated');
  END IF;
END $$;


-- ── 15. Indexes for Performance ───────────────────────────────────────────────

-- Speed up trip queries for conductors
CREATE INDEX IF NOT EXISTS idx_trips_conductor_status 
  ON trips(conductor_id, status) 
  WHERE status = 'in_progress';

-- Speed up QR card lookups by UID
CREATE INDEX IF NOT EXISTS idx_qr_cards_uid ON qr_cards(card_uid);

-- Speed up temporary ticket lookups by UID
CREATE INDEX IF NOT EXISTS idx_temp_tickets_uid ON temporary_tickets(ticket_uid);

-- Speed up transaction queries by trip
CREATE INDEX IF NOT EXISTS idx_transactions_trip ON transactions(trip_id);

-- Speed up boarded passengers queries by trip
CREATE INDEX IF NOT EXISTS idx_boarded_passengers_trip ON boarded_passengers(trip_id);

-- Speed up passenger counts queries by trip
CREATE INDEX IF NOT EXISTS idx_passenger_counts_trip ON passenger_counts(trip_id);

-- Speed up fare irregularities queries by trip
CREATE INDEX IF NOT EXISTS idx_fare_irregularities_trip ON fare_irregularities(trip_id);

-- Speed up GPS logs queries by trip
CREATE INDEX IF NOT EXISTS idx_gps_logs_trip ON gps_logs(trip_id);

-- Speed up emergency alerts queries by trip
CREATE INDEX IF NOT EXISTS idx_emergency_alerts_trip ON emergency_alerts(trip_id);

-- Speed up emergency alerts by status
CREATE INDEX IF NOT EXISTS idx_emergency_alerts_status ON emergency_alerts(status);

-- Speed up route lookups by terminal and destination
CREATE INDEX IF NOT EXISTS idx_routes_terminal_destination ON routes(terminal, destination);

-- Speed up fare validations by card
CREATE INDEX IF NOT EXISTS idx_fare_validations_card ON fare_validations(card_id);

-- Speed up fare validations by conductor
CREATE INDEX IF NOT EXISTS idx_fare_validations_conductor ON fare_validations(conductor_id);

-- Speed up fare validations by trip
CREATE INDEX IF NOT EXISTS idx_fare_validations_trip ON fare_validations(trip_id);

-- ── 16. Realtime Publications ─────────────────────────────────────────────────
-- Enable Realtime for the tables subscribed to in the conductor app.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' 
    AND tablename = 'passenger_counts'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE passenger_counts;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' 
    AND tablename = 'fare_irregularities'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE fare_irregularities;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' 
    AND tablename = 'emergency_alerts'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE emergency_alerts;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' 
    AND tablename = 'trips'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE trips;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' 
    AND tablename = 'boarded_passengers'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE boarded_passengers;
  END IF;
END $$;

-- ============================================================
-- Schema complete.
-- ============================================================

-- ── 18. Insert Test Bus Data ───────────────────────────────────────────────────
INSERT INTO buses (plate_number, route, seat_capacity, status) VALUES
  ('BUS-001', 'Manalo Fortich Terminal ↔ Agora Terminal', 35, 'active'),
  ('BUS-002', 'Manalo Fortich Terminal ↔ Agora Terminal', 35, 'active'),
  ('BUS-003', 'Manalo Fortich Terminal ↔ Agora Terminal', 35, 'active'),
  ('BUS-004', 'Manalo Fortich Terminal ↔ Agora Terminal', 35, 'active'),
  ('BUS-005', 'Manalo Fortich Terminal ↔ Agora Terminal', 35, 'maintenance')
ON CONFLICT (plate_number) DO NOTHING;

-- ── 19. Insert Route Data (from Manolo Fortich Terminal) ─────────────────────
INSERT INTO routes (terminal, destination, fare, distance_km, estimated_time_minutes) VALUES
  ('Manolo Fortich Terminal', 'Dicklum', 15.00, 5.2, 15),
  ('Manolo Fortich Terminal', 'San Miguel', 20.00, 10.5, 25),
  ('Manolo Fortich Terminal', 'Lunocan', 25.00, 15.8, 35),
  ('Manolo Fortich Terminal', 'Alae', 30.00, 22.3, 45),
  ('Manolo Fortich Terminal', 'Mambatangan', 40.00, 35.7, 60),
  ('Manolo Fortich Terminal', 'Puerto', 50.00, 48.2, 75),
  ('Manolo Fortich Terminal', 'Agora Terminal', 65.00, 62.5, 90)
ON CONFLICT (terminal, destination) DO NOTHING;

-- ── 17. Create Test Conductor User (for testing) ───────────────────────────────
-- SIMPLE METHOD (bypasses trigger):
-- 1. Go to Supabase Dashboard → Authentication → Users → Add user
-- 2. Email: conductor@commutai.test, Password: Conductor123!, Auto-confirm: Yes
-- 3. Copy the user's UUID from the dashboard
-- 4. Run this SQL in the SQL Editor:
--
-- INSERT INTO staff_users (id, full_name, email, role, is_active)
-- VALUES (
--   '<paste-uuid-here>',
--   'Test Conductor',
--   'conductor@commutai.test',
--   'conductor',
--   true
-- );
--
-- 5. Test login with: conductor@commutai.test / Conductor123!