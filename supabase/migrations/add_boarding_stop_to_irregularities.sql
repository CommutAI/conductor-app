-- Migration: Add boarding_stop column to fare_irregularities
-- Date: 2026-09-19

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'fare_irregularities' AND column_name = 'boarding_stop'
  ) THEN
    ALTER TABLE fare_irregularities ADD COLUMN boarding_stop TEXT;
  END IF;
END $$;

COMMENT ON COLUMN fare_irregularities.boarding_stop IS
  'The stop where the passenger originally boarded';
