/*
  # Add kit support to event_equipment

  1. Changes
    - Add `kit_id` column to `event_equipment` table
    - Add foreign key to `equipment_kits`
    - Make `equipment_id` nullable (when kit_id is set, equipment_id can be null)
    - Add check constraint to ensure either kit_id or equipment_id is set

  2. Notes
    - This allows storing either a kit or individual equipment item
    - When kit_id is set, the entry represents the entire kit
    - When equipment_id is set, it represents a single item
*/

-- Add kit_id column
ALTER TABLE event_equipment 
ADD COLUMN IF NOT EXISTS kit_id uuid REFERENCES equipment_kits(id) ON DELETE CASCADE;

-- Make equipment_id nullable
ALTER TABLE event_equipment 
ALTER COLUMN equipment_id DROP NOT NULL;

-- Add check constraint to ensure either kit_id or equipment_id is set (but not both)
ALTER TABLE event_equipment 
ADD CONSTRAINT event_equipment_item_or_kit_check 
CHECK (
  (kit_id IS NOT NULL AND equipment_id IS NULL) OR 
  (kit_id IS NULL AND equipment_id IS NOT NULL)
);