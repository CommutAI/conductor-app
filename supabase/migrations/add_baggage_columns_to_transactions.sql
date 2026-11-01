-- Add missing columns to transactions table
-- Run this in the Supabase SQL Editor

DO $$
BEGIN
  -- Add transaction_type column if it doesn't exist (separate from type)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'transactions' AND column_name = 'transaction_type'
  ) THEN
    ALTER TABLE transactions ADD COLUMN transaction_type transaction_type NOT NULL DEFAULT 'fare_validation';
  END IF;

  -- Add type column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'transactions' AND column_name = 'type'
  ) THEN
    ALTER TABLE transactions ADD COLUMN type transaction_type NOT NULL DEFAULT 'fare_validation';
  END IF;

  -- Add staff_id column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'transactions' AND column_name = 'staff_id'
  ) THEN
    ALTER TABLE transactions ADD COLUMN staff_id UUID REFERENCES staff_users (id);
  END IF;

  -- Add channel column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'transactions' AND column_name = 'channel'
  ) THEN
    ALTER TABLE transactions ADD COLUMN channel TEXT NOT NULL DEFAULT 'qr_card';
  END IF;

  -- Add baggage_category column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'transactions' AND column_name = 'baggage_category'
  ) THEN
    ALTER TABLE transactions ADD COLUMN baggage_category TEXT;
  END IF;

  -- Add baggage_weight column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'transactions' AND column_name = 'baggage_weight'
  ) THEN
    ALTER TABLE transactions ADD COLUMN baggage_weight NUMERIC(10,2);
  END IF;

  -- Add baggage_fee column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'transactions' AND column_name = 'baggage_fee'
  ) THEN
    ALTER TABLE transactions ADD COLUMN baggage_fee NUMERIC(10,2);
  END IF;

  -- Add payment_method column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'transactions' AND column_name = 'payment_method'
  ) THEN
    ALTER TABLE transactions ADD COLUMN payment_method TEXT NOT NULL DEFAULT 'qr_card';
  ELSE
    -- Column exists, check if it's nullable and fix if needed
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'transactions' AND column_name = 'payment_method' AND is_nullable = 'YES'
    ) THEN
      UPDATE transactions SET payment_method = COALESCE(payment_method, channel, 'qr_card') WHERE payment_method IS NULL;
      ALTER TABLE transactions ALTER COLUMN payment_method SET NOT NULL;
      ALTER TABLE transactions ALTER COLUMN payment_method SET DEFAULT 'qr_card';
    END IF;
  END IF;

  -- Drop any existing check constraints and recreate with valid values
  DO $$
  BEGIN
    IF EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = 'transactions_payment_method_check'
    ) THEN
      ALTER TABLE transactions DROP CONSTRAINT transactions_payment_method_check;
    END IF;

    IF EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = 'transactions_transaction_type_check'
    ) THEN
      ALTER TABLE transactions DROP CONSTRAINT transactions_transaction_type_check;
    END IF;
  END $$;

  ALTER TABLE transactions ADD CONSTRAINT transactions_payment_method_check 
    CHECK (payment_method IN ('cash', 'gcash', 'qr_card'));

  ALTER TABLE transactions ADD CONSTRAINT transactions_transaction_type_check 
    CHECK (transaction_type IN ('fare_validation', 'balance_topup', 'card_issuance', 'baggage_fee', 'refund'));

  -- Add fare_amount column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'transactions' AND column_name = 'fare_amount'
  ) THEN
    ALTER TABLE transactions ADD COLUMN fare_amount NUMERIC(10,2);
    -- Update existing rows to copy amount to fare_amount
    UPDATE transactions SET fare_amount = amount WHERE fare_amount IS NULL;
    -- Now make it NOT NULL
    ALTER TABLE transactions ALTER COLUMN fare_amount SET NOT NULL;
    ALTER TABLE transactions ALTER COLUMN fare_amount SET DEFAULT 0;
  ELSE
    -- Column exists, check if it's nullable and fix if needed
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'transactions' AND column_name = 'fare_amount' AND is_nullable = 'YES'
    ) THEN
      UPDATE transactions SET fare_amount = COALESCE(fare_amount, amount, 0) WHERE fare_amount IS NULL;
      ALTER TABLE transactions ALTER COLUMN fare_amount SET NOT NULL;
      ALTER TABLE transactions ALTER COLUMN fare_amount SET DEFAULT 0;
    END IF;
  END IF;

  -- Add discount_amount column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'transactions' AND column_name = 'discount_amount'
  ) THEN
    ALTER TABLE transactions ADD COLUMN discount_amount NUMERIC(10,2) NOT NULL DEFAULT 0;
  ELSE
    -- Column exists, check if it's nullable and fix if needed
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'transactions' AND column_name = 'discount_amount' AND is_nullable = 'YES'
    ) THEN
      UPDATE transactions SET discount_amount = COALESCE(discount_amount, 0) WHERE discount_amount IS NULL;
      ALTER TABLE transactions ALTER COLUMN discount_amount SET NOT NULL;
      ALTER TABLE transactions ALTER COLUMN discount_amount SET DEFAULT 0;
    END IF;
  END IF;

  -- Add final_amount column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'transactions' AND column_name = 'final_amount'
  ) THEN
    ALTER TABLE transactions ADD COLUMN final_amount NUMERIC(10,2);
    -- Update existing rows to copy amount to final_amount
    UPDATE transactions SET final_amount = amount WHERE final_amount IS NULL;
    -- Now make it NOT NULL
    ALTER TABLE transactions ALTER COLUMN final_amount SET NOT NULL;
    ALTER TABLE transactions ALTER COLUMN final_amount SET DEFAULT 0;
  ELSE
    -- Column exists, check if it's nullable and fix if needed
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'transactions' AND column_name = 'final_amount' AND is_nullable = 'YES'
    ) THEN
      UPDATE transactions SET final_amount = COALESCE(final_amount, amount, 0) WHERE final_amount IS NULL;
      ALTER TABLE transactions ALTER COLUMN final_amount SET NOT NULL;
      ALTER TABLE transactions ALTER COLUMN final_amount SET DEFAULT 0;
    END IF;
  END IF;

  -- Add status column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'transactions' AND column_name = 'status'
  ) THEN
    ALTER TABLE transactions ADD COLUMN status TEXT NOT NULL DEFAULT 'completed';
  ELSE
    -- Column exists, check if it's nullable and fix if needed
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'transactions' AND column_name = 'status' AND is_nullable = 'YES'
    ) THEN
      UPDATE transactions SET status = COALESCE(status, 'completed') WHERE status IS NULL;
      ALTER TABLE transactions ALTER COLUMN status SET NOT NULL;
      ALTER TABLE transactions ALTER COLUMN status SET DEFAULT 'completed';
    END IF;
  END IF;

  -- Add recorded_at column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'transactions' AND column_name = 'recorded_at'
  ) THEN
    ALTER TABLE transactions ADD COLUMN recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
  END IF;

  -- Add passenger_name column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'transactions' AND column_name = 'passenger_name'
  ) THEN
    ALTER TABLE transactions ADD COLUMN passenger_name TEXT;
  END IF;

  -- Add from_stop_id column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'transactions' AND column_name = 'from_stop_id'
  ) THEN
    ALTER TABLE transactions ADD COLUMN from_stop_id UUID REFERENCES bus_stops (id);
  END IF;

  -- Add to_stop_id column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'transactions' AND column_name = 'to_stop_id'
  ) THEN
    ALTER TABLE transactions ADD COLUMN to_stop_id UUID REFERENCES bus_stops (id);
  END IF;

  -- Fix card_id foreign key to point to qr_cards instead of cards
  DO $$
  BEGIN
    IF EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = 'transactions_card_id_fkey'
    ) THEN
      ALTER TABLE transactions DROP CONSTRAINT transactions_card_id_fkey;
    END IF;
  END $$;

  ALTER TABLE transactions ADD CONSTRAINT transactions_card_id_fkey 
    FOREIGN KEY (card_id) REFERENCES qr_cards(id);
END $$;
