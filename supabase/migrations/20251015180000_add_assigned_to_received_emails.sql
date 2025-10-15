/*
  # Add assignment feature to received emails

  1. Changes
    - Add `assigned_to` column to `received_emails` table
      - References employees(id)
      - Allows tracking who is responsible for handling the email
    - Add index for faster filtering by assigned employee

  2. Security
    - Existing RLS policies cover the new column
*/

-- Add assigned_to column to received_emails
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'received_emails' AND column_name = 'assigned_to'
  ) THEN
    ALTER TABLE received_emails
    ADD COLUMN assigned_to uuid REFERENCES employees(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Create index for filtering by assigned employee
CREATE INDEX IF NOT EXISTS idx_received_emails_assigned_to ON received_emails(assigned_to);
