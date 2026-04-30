/*
  # Add VAT rate to event_calculation_items

  1. Changes
    - `event_calculation_items.vat_rate` (numeric, default 23)
      - Stores the VAT percentage for each calculation row so we can present
        net and gross totals on screen and in the printable PDF.

  2. Notes
    - Safe migration: uses IF NOT EXISTS guard. No data is destroyed.
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'event_calculation_items' AND column_name = 'vat_rate'
  ) THEN
    ALTER TABLE event_calculation_items
      ADD COLUMN vat_rate numeric NOT NULL DEFAULT 23;
  END IF;
END $$;