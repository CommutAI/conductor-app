-- Migration: Fix trips RLS and bus assignment
-- Date: 2026-11-13
-- Problem 1: Trips started by driver on bus are not readable by conductor if conductor_id is not yet set
-- Problem 2: Conductors and drivers assigned via staff_users.bus_id cannot select trips on their bus if buses.assigned_conductor_id was not explicitly set
-- Fix:
-- 1. Add SELECT policy for all authenticated staff on trips
-- 2. Allow conductors and drivers to read/write trips where bus_id matches their assigned bus in staff_users
-- 3. Ensure trips table is in supabase_realtime publication with full replica identity

ALTER TABLE trips REPLICA IDENTITY FULL;

-- Ensure trips is in supabase_realtime publication
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'trips'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE trips;
  END IF;
END $$;

-- Allow all authenticated staff to SELECT trips
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'trips' AND policyname = 'trips_select_authenticated'
  ) THEN
    CREATE POLICY "trips_select_authenticated"
      ON trips FOR SELECT
      USING (auth.role() = 'authenticated');
  END IF;
END $$;

-- Update trips_conductor_rw to include bus assignments from staff_users.bus_id
DROP POLICY IF EXISTS "trips_conductor_rw" ON trips;

CREATE POLICY "trips_conductor_rw"
  ON trips FOR ALL
  USING (
    conductor_id = auth.uid()
    OR driver_id = auth.uid()
    OR current_user_role() = 'admin'
    OR (
      bus_id IN (
        SELECT id FROM buses
        WHERE assigned_conductor_id = auth.uid()
           OR assigned_driver_id = auth.uid()
      )
    )
    OR (
      bus_id IN (
        SELECT bus_id FROM staff_users
        WHERE id = auth.uid() AND bus_id IS NOT NULL
      )
    )
  )
  WITH CHECK (
    conductor_id = auth.uid()
    OR driver_id = auth.uid()
    OR current_user_role() = 'admin'
    OR (
      bus_id IN (
        SELECT id FROM buses
        WHERE assigned_conductor_id = auth.uid()
           OR assigned_driver_id = auth.uid()
      )
    )
    OR (
      bus_id IN (
        SELECT bus_id FROM staff_users
        WHERE id = auth.uid() AND bus_id IS NOT NULL
      )
    )
  );

-- Sync buses assigned_conductor_id where staff_users has a conductor assigned to the bus
UPDATE buses b
SET assigned_conductor_id = s.id
FROM staff_users s
WHERE s.bus_id = b.id
  AND s.role = 'conductor'
  AND (b.assigned_conductor_id IS NULL OR b.assigned_conductor_id != s.id);

