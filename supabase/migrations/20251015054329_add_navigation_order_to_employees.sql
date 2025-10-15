/*
  # Add Navigation Order to Employees

  ## Purpose
  - Allow each employee to customize their CRM navigation menu order
  - Store as JSONB with menu item keys and their order positions
  
  ## Changes
  1. Add `navigation_order` column to employees table
  2. Store as JSONB array of menu item keys in user's preferred order
  
  ## Example structure
  navigation_order = ['clients', 'events', 'calendar', 'messages', 'equipment', ...]
  
  ## Notes
  - NULL means use default order
  - Each user can have their own custom order
*/

-- Add navigation_order column to employees
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'employees' AND column_name = 'navigation_order'
  ) THEN
    ALTER TABLE employees 
    ADD COLUMN navigation_order JSONB DEFAULT NULL;
  END IF;
END $$;

-- Add comment
COMMENT ON COLUMN employees.navigation_order IS 'User-specific navigation menu order stored as array of menu item keys';
