/*
  # Add weight_kg to event_calculation_items

  1. Changes
    - Add `weight_kg` column (numeric, nullable) to `event_calculation_items`
      for storing weight per unit in kilograms (pulled from equipment_items.weight_kg)

  2. Purpose
    - Enables total weight summary display in the calculation editor UI
    - Weight is NOT included in PDF output - display only

  3. Security
    - Column only; no RLS changes needed
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'event_calculation_items' AND column_name = 'weight_kg'
  ) THEN
    ALTER TABLE event_calculation_items ADD COLUMN weight_kg numeric;
  END IF;
END $$;