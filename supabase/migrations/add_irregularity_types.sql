-- Migration: Add new irregularity_type enum values
-- Date: 2026-09-19
-- New values: unauthorized_passenger, wrong_route, card_sharing,
--             overshooting, underpayment, passenger_dispute

DO $$ BEGIN
  ALTER TYPE irregularity_type ADD VALUE IF NOT EXISTS 'unauthorized_passenger';
EXCEPTION WHEN others THEN NULL; END $$;

DO $$ BEGIN
  ALTER TYPE irregularity_type ADD VALUE IF NOT EXISTS 'wrong_route';
EXCEPTION WHEN others THEN NULL; END $$;

DO $$ BEGIN
  ALTER TYPE irregularity_type ADD VALUE IF NOT EXISTS 'card_sharing';
EXCEPTION WHEN others THEN NULL; END $$;

DO $$ BEGIN
  ALTER TYPE irregularity_type ADD VALUE IF NOT EXISTS 'overshooting';
EXCEPTION WHEN others THEN NULL; END $$;

DO $$ BEGIN
  ALTER TYPE irregularity_type ADD VALUE IF NOT EXISTS 'underpayment';
EXCEPTION WHEN others THEN NULL; END $$;

DO $$ BEGIN
  ALTER TYPE irregularity_type ADD VALUE IF NOT EXISTS 'passenger_dispute';
EXCEPTION WHEN others THEN NULL; END $$;

-- Verify
SELECT enumlabel FROM pg_enum
WHERE enumtypid = 'irregularity_type'::regtype
ORDER BY enumsortorder;
