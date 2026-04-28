/*
  # Add signature_thumb column to employees

  1. Changes
    - Add `signature_thumb` (text) to `employees` table
      - Stores public URL of dedicated thumbnail used in email signatures
      - Independent from main `avatar_url` so it can be optimized for email
      - Nullable (falls back to avatar_url when empty)

  2. Security
    - No RLS changes needed; existing employees policies already cover this column
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'employees' AND column_name = 'signature_thumb'
  ) THEN
    ALTER TABLE employees ADD COLUMN signature_thumb text;
  END IF;
END $$;