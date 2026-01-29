/*
  # Add new column types and width support

  1. Changes
    - Add new column types: phone, email (in addition to text, number, date, boolean)
    - Add column_width field to custom_database_columns
    - column_width: integer (default 200px, can be adjusted by user)

  2. Notes
    - phone type: for phone numbers with validation
    - email type: for email addresses with validation
    - column_width: stored in pixels (default 200)
*/

-- Add column_width to custom_database_columns
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'custom_database_columns'
    AND column_name = 'column_width'
  ) THEN
    ALTER TABLE custom_database_columns
    ADD COLUMN column_width int DEFAULT 200;
  END IF;
END $$;

-- Drop old constraint and add new one with phone and email types
ALTER TABLE custom_database_columns
DROP CONSTRAINT IF EXISTS custom_database_columns_column_type_check;

ALTER TABLE custom_database_columns
ADD CONSTRAINT custom_database_columns_column_type_check
CHECK (column_type IN ('text', 'number', 'date', 'boolean', 'phone', 'email'));