-- Add the missing alighted_at column to boarded_passengers table
ALTER TABLE boarded_passengers 
ADD COLUMN IF NOT EXISTS alighted_at TIMESTAMPTZ;
