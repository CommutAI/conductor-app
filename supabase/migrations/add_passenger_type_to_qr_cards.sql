-- Migration: Add passenger_type column to qr_cards table
-- This migration adds the passenger_type column if it doesn't exist

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'qr_cards' AND column_name = 'passenger_type'
  ) THEN
    ALTER TABLE qr_cards ADD COLUMN passenger_type TEXT DEFAULT 'regular';
  END IF;
END $$;

-- Update existing records to have passenger_type based on card_type
-- Uncomment if you want to backfill existing data
-- UPDATE qr_cards SET passenger_type = 
--   CASE card_type
--     WHEN 'student' THEN 'student'
--     WHEN 'senior_citizen' THEN 'senior_citizen'
--     WHEN 'pwd' THEN 'pwd'
--     ELSE 'regular'
--   END
-- WHERE passenger_type IS NULL;
