/*
  # Add sync status tracking to email accounts

  1. Changes
    - Add `last_sync_at` (timestamptz) to track when last sync happened
    - Add `last_sync_status` (text) to track sync result
    - Add `last_sync_error` (text) to store error messages if sync fails

  2. Purpose
    - Allow monitoring of IMAP sync worker health
    - Show last sync time in CRM admin panel
    - Debug sync issues easily
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'employee_email_accounts' AND column_name = 'last_sync_at'
  ) THEN
    ALTER TABLE employee_email_accounts ADD COLUMN last_sync_at timestamptz;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'employee_email_accounts' AND column_name = 'last_sync_status'
  ) THEN
    ALTER TABLE employee_email_accounts ADD COLUMN last_sync_status text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'employee_email_accounts' AND column_name = 'last_sync_error'
  ) THEN
    ALTER TABLE employee_email_accounts ADD COLUMN last_sync_error text;
  END IF;
END $$;
