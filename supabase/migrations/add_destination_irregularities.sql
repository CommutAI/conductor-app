-- Migration: Add destination-based irregularity tracking
-- Date: 2026-09-19
-- Description: Adds new irregularity types and detailed tracking columns

-- Step 1: Add new columns to fare_irregularities if they don't exist
DO $$
BEGIN
  -- Add conductor_id
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'fare_irregularities' AND column_name = 'conductor_id'
  ) THEN
    ALTER TABLE fare_irregularities ADD COLUMN conductor_id UUID REFERENCES staff_users(id);
  END IF;

  -- Add card_uid
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'fare_irregularities' AND column_name = 'card_uid'
  ) THEN
    ALTER TABLE fare_irregularities ADD COLUMN card_uid TEXT;
  END IF;

  -- Add passenger_id
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'fare_irregularities' AND column_name = 'passenger_id'
  ) THEN
    ALTER TABLE fare_irregularities ADD COLUMN passenger_id UUID;
  END IF;

  -- Add location_lat
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'fare_irregularities' AND column_name = 'location_lat'
  ) THEN
    ALTER TABLE fare_irregularities ADD COLUMN location_lat DECIMAL(10, 8);
  END IF;

  -- Add location_lng
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'fare_irregularities' AND column_name = 'location_lng'
  ) THEN
    ALTER TABLE fare_irregularities ADD COLUMN location_lng DECIMAL(11, 8);
  END IF;

  -- Add destination_stop
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'fare_irregularities' AND column_name = 'destination_stop'
  ) THEN
    ALTER TABLE fare_irregularities ADD COLUMN destination_stop TEXT;
  END IF;

  -- Add current_stop
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'fare_irregularities' AND column_name = 'current_stop'
  ) THEN
    ALTER TABLE fare_irregularities ADD COLUMN current_stop TEXT;
  END IF;

  -- Add distance_km
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'fare_irregularities' AND column_name = 'distance_km'
  ) THEN
    ALTER TABLE fare_irregularities ADD COLUMN distance_km DECIMAL(10, 3);
  END IF;

  -- Add notes
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'fare_irregularities' AND column_name = 'notes'
  ) THEN
    ALTER TABLE fare_irregularities ADD COLUMN notes TEXT;
  END IF;
END $$;

-- Step 2: Create new enum with additional values
DO $$ BEGIN
  -- Create a temporary type with all new values
  CREATE TYPE irregularity_type_new AS ENUM (
    'double_scan', 
    'count_mismatch', 
    'fare_evasion', 
    'destination_overstay', 
    'missed_alighting', 
    'other'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Step 3: Migrate existing data - convert unknown values to 'other'
-- This handles any values like 'trip_duration' that aren't in the new enum
DO $$
DECLARE
  old_values TEXT[];
  val TEXT;
BEGIN
  -- Get current enum values from the old type
  SELECT array_agg(enumlabel::text) INTO old_values
  FROM pg_enum
  WHERE enumtypid = 'irregularity_type'::regtype;

  -- For each value in old enum that's not in new enum, update to 'other'
  FOREACH val IN ARRAY old_values
  LOOP
    IF val NOT IN ('double_scan', 'count_mismatch', 'fare_evasion', 'destination_overstay', 'missed_alighting', 'other') THEN
      -- Map unknown/deprecated values to 'other'
      EXECUTE format('
        UPDATE fare_irregularities
        SET type = ''other''::irregularity_type
        WHERE type::text = %L
      ', val);
      
      RAISE NOTICE 'Migrated % rows with type "%" to "other"', 
        (SELECT COUNT(*) FROM fare_irregularities WHERE type::text = 'other'), val;
    END IF;
  END LOOP;
END $$;

-- Step 4: Update the type column to use new enum
DO $$
BEGIN
  -- Only proceed if the new type exists
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'irregularity_type_new') THEN
    -- Change column to use new type
    ALTER TABLE fare_irregularities 
      ALTER COLUMN type TYPE irregularity_type_new 
      USING type::text::irregularity_type_new;
    
    -- Drop old type and rename new type
    DROP TYPE irregularity_type;
    ALTER TYPE irregularity_type_new RENAME TO irregularity_type;
    
    RAISE NOTICE 'Successfully migrated irregularity_type enum';
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'Error during enum migration: %', SQLERRM;
    -- If migration fails, at least we have the new columns added
END $$;

-- Step 5: Create index on passenger_id for faster lookups
CREATE INDEX IF NOT EXISTS idx_fare_irregularities_passenger_id 
  ON fare_irregularities(passenger_id);

CREATE INDEX IF NOT EXISTS idx_fare_irregularities_card_uid 
  ON fare_irregularities(card_uid);

CREATE INDEX IF NOT EXISTS idx_fare_irregularities_conductor_id 
  ON fare_irregularities(conductor_id);

CREATE INDEX IF NOT EXISTS idx_fare_irregularities_type 
  ON fare_irregularities(type);

-- Step 6: Add comments for documentation
COMMENT ON COLUMN fare_irregularities.destination_stop IS 
  'The stop where passenger was expected to alight';

COMMENT ON COLUMN fare_irregularities.current_stop IS 
  'The actual stop/location where irregularity was detected';

COMMENT ON COLUMN fare_irregularities.distance_km IS 
  'Distance in kilometers from expected destination (for destination_overstay type)';

COMMENT ON COLUMN fare_irregularities.location_lat IS 
  'GPS latitude coordinate where irregularity was detected';

COMMENT ON COLUMN fare_irregularities.location_lng IS 
  'GPS longitude coordinate where irregularity was detected';

COMMENT ON COLUMN fare_irregularities.passenger_id IS 
  'Reference to boarded_passengers record';

COMMENT ON COLUMN fare_irregularities.card_uid IS 
  'Card or ticket UID involved in the irregularity';

COMMENT ON COLUMN fare_irregularities.conductor_id IS 
  'Conductor who was on duty when irregularity was detected';
