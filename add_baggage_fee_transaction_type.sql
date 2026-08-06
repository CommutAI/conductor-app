-- Add baggage_fee to transaction_type enum
-- This script adds 'baggage_fee' to the existing transaction_type enum

-- Step 1: Add the new value to the enum (PostgreSQL requires recreating the type)
DO $$
BEGIN
  -- First, check if the new value already exists
  IF NOT EXISTS (
    SELECT 1 
    FROM pg_enum 
    WHERE enumlabel = 'baggage_fee' 
    AND enumtypid = (
      SELECT oid FROM pg_type WHERE typname = 'transaction_type'
    )
  ) THEN
    -- Add the new value to the enum
    ALTER TYPE transaction_type ADD VALUE 'baggage_fee';
  END IF;
EXCEPTION
  WHEN duplicate_object THEN
    -- Value already exists, ignore error
    NULL;
END $$;

-- Verify the addition
SELECT enumlabel 
FROM pg_enum 
WHERE enumtypid = (SELECT oid FROM pg_type WHERE typname = 'transaction_type')
ORDER BY enumsortorder;
