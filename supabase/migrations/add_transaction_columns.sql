-- Migration: Add new columns to transactions table
-- This migration adds fare_amount, discount_amount, final_amount, status, recorded_at,
-- passenger_name, from_stop_id, and to_stop_id columns to the transactions table

-- Add fare_amount column
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'transactions' AND column_name = 'fare_amount'
  ) THEN
    ALTER TABLE transactions ADD COLUMN fare_amount NUMERIC(10,2);
  END IF;
END $$;

-- Add discount_amount column
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'transactions' AND column_name = 'discount_amount'
  ) THEN
    ALTER TABLE transactions ADD COLUMN discount_amount NUMERIC(10,2) DEFAULT 0;
  END IF;
END $$;

-- Add final_amount column
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'transactions' AND column_name = 'final_amount'
  ) THEN
    ALTER TABLE transactions ADD COLUMN final_amount NUMERIC(10,2);
  END IF;
END $$;

-- Add status column
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'transactions' AND column_name = 'status'
  ) THEN
    ALTER TABLE transactions ADD COLUMN status TEXT DEFAULT 'completed';
  END IF;
END $$;

-- Add recorded_at column
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'transactions' AND column_name = 'recorded_at'
  ) THEN
    ALTER TABLE transactions ADD COLUMN recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
  END IF;
END $$;

-- Add passenger_name column
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'transactions' AND column_name = 'passenger_name'
  ) THEN
    ALTER TABLE transactions ADD COLUMN passenger_name TEXT;
  END IF;
END $$;

-- Add from_stop_id column
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'transactions' AND column_name = 'from_stop_id'
  ) THEN
    ALTER TABLE transactions ADD COLUMN from_stop_id UUID REFERENCES bus_stops (id);
  END IF;
END $$;

-- Add to_stop_id column
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'transactions' AND column_name = 'to_stop_id'
  ) THEN
    ALTER TABLE transactions ADD COLUMN to_stop_id UUID REFERENCES bus_stops (id);
  END IF;
END $$;

-- Optional: Backfill existing data
-- Uncomment the following if you want to migrate existing data
-- UPDATE transactions SET fare_amount = amount WHERE fare_amount IS NULL;
-- UPDATE transactions SET final_amount = amount WHERE final_amount IS NULL;
-- UPDATE transactions SET recorded_at = created_at WHERE recorded_at IS NULL;
