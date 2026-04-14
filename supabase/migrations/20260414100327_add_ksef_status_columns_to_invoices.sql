/*
  # Add KSeF status tracking columns to invoices table

  1. Modified Tables
    - `invoices`
      - `ksef_reference_number` (text) - KSeF reference number assigned after successful submission
      - `ksef_status` (text) - Current KSeF status: draft, sent, accepted, rejected
      - `ksef_error` (text) - Error message from KSeF if submission was rejected
      - `ksef_sent_at` (timestamptz) - Timestamp when the invoice was sent to KSeF

  2. Notes
    - These columns mirror key info from ksef_invoices for quick access
    - Default ksef_status is NULL (not yet interacted with KSeF)
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'invoices' AND column_name = 'ksef_reference_number'
  ) THEN
    ALTER TABLE invoices ADD COLUMN ksef_reference_number text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'invoices' AND column_name = 'ksef_status'
  ) THEN
    ALTER TABLE invoices ADD COLUMN ksef_status text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'invoices' AND column_name = 'ksef_error'
  ) THEN
    ALTER TABLE invoices ADD COLUMN ksef_error text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'invoices' AND column_name = 'ksef_sent_at'
  ) THEN
    ALTER TABLE invoices ADD COLUMN ksef_sent_at timestamptz;
  END IF;
END $$;
