-- Migration: Add destination_mismatch to irregularity_type enum
-- Allows explicit tracking of alighting destination discrepancies

DO $$
BEGIN
  ALTER TYPE irregularity_type ADD VALUE IF NOT EXISTS 'destination_mismatch';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON COLUMN fare_irregularities.type IS 
  'Type of irregularity: double_scan, count_mismatch, fare_evasion, destination_overstay, missed_alighting, destination_mismatch, unauthorized_passenger, wrong_route, card_sharing, overshooting, underpayment, passenger_dispute, other';

