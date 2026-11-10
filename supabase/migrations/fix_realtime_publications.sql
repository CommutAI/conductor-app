-- Migration: Fix Realtime channel errors
-- Date: 2026-09-19
-- Problem: CHANNEL_ERROR on trips, boarded_passengers, passenger_counts
-- Cause 1: Tables missing from supabase_realtime publication
-- Cause 2: REPLICA IDENTITY DEFAULT means UPDATE/DELETE payloads have no old row data
-- Fix: Add all subscribed tables to the publication + set REPLICA IDENTITY FULL

-- Step 1: Set REPLICA IDENTITY FULL on all realtime tables
-- This is required for UPDATE and DELETE payloads to include old row values
ALTER TABLE trips               REPLICA IDENTITY FULL;
ALTER TABLE boarded_passengers  REPLICA IDENTITY FULL;
ALTER TABLE passenger_counts    REPLICA IDENTITY FULL;
ALTER TABLE fare_irregularities REPLICA IDENTITY FULL;
ALTER TABLE emergency_alerts    REPLICA IDENTITY FULL;

-- Step 2: Add tables to the supabase_realtime publication (idempotent)
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

-- Step 3: Verify the result
SELECT schemaname, tablename
FROM pg_publication_tables
WHERE pubname = 'supabase_realtime'
ORDER BY tablename;
