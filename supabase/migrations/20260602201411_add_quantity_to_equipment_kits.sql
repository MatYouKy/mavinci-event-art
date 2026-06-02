/*
  # Add quantity to equipment_kits

  1. Modified Tables
    - `equipment_kits`
      - Add `quantity` (integer, default 1) - how many identical physical kits exist

  2. Notes
    - Default is 1 for backward compatibility with existing kits
    - Quantity represents how many copies of this kit the company owns
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'equipment_kits' AND column_name = 'quantity'
  ) THEN
    ALTER TABLE equipment_kits ADD COLUMN quantity integer NOT NULL DEFAULT 1 CHECK (quantity > 0);
  END IF;
END $$;
