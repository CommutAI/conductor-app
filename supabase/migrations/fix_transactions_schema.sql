-- Migration: Fix transactions table schema
-- This migration ensures the transactions table has the correct columns

-- The code is trying to select 'amount' column but the schema might have different column names
-- This migration adds the column if it doesn't exist

DO $$
BEGIN
  -- Check if amount column exists, if not add it
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'transactions' AND column_name = 'amount'
  ) THEN
    ALTER TABLE transactions ADD COLUMN amount NUMERIC(10,2);
  END IF;
END $$;

-- Run the transaction columns migration if not already applied
-- This includes: fare_amount, discount_amount, final_amount, status, recorded_at, passenger_name, from_stop_id, to_stop_id

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'transactions' AND column_name = 'fare_amount'
  ) THEN
    ALTER TABLE transactions ADD COLUMN fare_amount NUMERIC(10,2);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'transactions' AND column_name = 'discount_amount'
  ) THEN
    ALTER TABLE transactions ADD COLUMN discount_amount NUMERIC(10,2) DEFAULT 0;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'transactions' AND column_name = 'final_amount'
  ) THEN
    ALTER TABLE transactions ADD COLUMN final_amount NUMERIC(10,2);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'transactions' AND column_name = 'status'
  ) THEN
    ALTER TABLE transactions ADD COLUMN status TEXT DEFAULT 'completed';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'transactions' AND column_name = 'recorded_at'
  ) THEN
    ALTER TABLE transactions ADD COLUMN recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'transactions' AND column_name = 'passenger_name'
  ) THEN
    ALTER TABLE transactions ADD COLUMN passenger_name TEXT;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'transactions' AND column_name = 'from_stop_id'
  ) THEN
    ALTER TABLE transactions ADD COLUMN from_stop_id UUID REFERENCES bus_stops (id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'transactions' AND column_name = 'to_stop_id'
  ) THEN
    ALTER TABLE transactions ADD COLUMN to_stop_id UUID REFERENCES bus_stops (id);
  END IF;
END $$;
