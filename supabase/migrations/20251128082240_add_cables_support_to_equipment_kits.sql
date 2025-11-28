/*
  # Add cables support to equipment kits

  1. Changes
    - Add cable_id column to equipment_kit_items
    - Make equipment_id nullable (either equipment_id or cable_id must be set)
    - Add check constraint to ensure exactly one of equipment_id or cable_id is set
    - Add foreign key to cables table
    - Update RLS policies if needed

  2. Security
    - Maintain existing RLS policies
*/

-- Add cable_id column
ALTER TABLE equipment_kit_items
ADD COLUMN IF NOT EXISTS cable_id uuid REFERENCES cables(id) ON DELETE CASCADE;

-- Make equipment_id nullable
ALTER TABLE equipment_kit_items
ALTER COLUMN equipment_id DROP NOT NULL;

-- Add check constraint to ensure exactly one of equipment_id or cable_id is set
ALTER TABLE equipment_kit_items
ADD CONSTRAINT equipment_kit_items_item_type_check 
CHECK (
  (equipment_id IS NOT NULL AND cable_id IS NULL) OR
  (equipment_id IS NULL AND cable_id IS NOT NULL)
);

-- Add index for cable_id
CREATE INDEX IF NOT EXISTS idx_equipment_kit_items_cable_id ON equipment_kit_items(cable_id);

-- Update existing rows to ensure they have equipment_id (shouldn't be needed but safety first)
-- No action needed as existing rows already have equipment_id

COMMENT ON COLUMN equipment_kit_items.cable_id IS 'Reference to cable if this kit item is a cable';
COMMENT ON CONSTRAINT equipment_kit_items_item_type_check ON equipment_kit_items IS 'Ensures exactly one of equipment_id or cable_id is set';
