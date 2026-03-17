/*
  # Add Compatibility Groups to Equipment Components

  1. Changes
    - Add `compatibility_group` column to `equipment_compatible_items` table
    - This column allows grouping alternative components (e.g., "wzmacniacz")
    - NULL value = single required component (must be added)
    - Non-NULL value = group of alternatives (user must choose ONE from the group)

  2. Purpose
    - Enable flexible component requirements
    - Support scenarios like: "Subwoofer requires ONE of: AMP RACK 2x OR APM RACK 1x"
    - Maintain backward compatibility with existing single required components

  3. Example Usage
    - Subwoofer → compatibility_group: "wzmacniacz" → [AMP RACK 2x, APM RACK 1x]
    - Subwoofer → compatibility_group: NULL → [Kabel XLR 10m] (always required)

  4. Index
    - Add index for efficient querying by equipment_id and compatibility_group
*/

-- Add compatibility_group column
ALTER TABLE equipment_compatible_items 
ADD COLUMN IF NOT EXISTS compatibility_group text NULL;

-- Add index for efficient querying
CREATE INDEX IF NOT EXISTS idx_equipment_compatible_items_group 
ON equipment_compatible_items(equipment_id, compatibility_group) 
WHERE compatibility_group IS NOT NULL;

-- Add helpful comment
COMMENT ON COLUMN equipment_compatible_items.compatibility_group IS 
'Nazwa grupy alternatywnych komponentów. Komponenty z tą samą grupą są alternatywami - użytkownik musi wybrać JEDEN z nich. NULL = pojedynczy wymagany komponent (zawsze wymagany).';
