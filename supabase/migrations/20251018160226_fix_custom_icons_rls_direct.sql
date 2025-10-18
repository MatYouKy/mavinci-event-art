/*
  # Fix Custom Icons RLS - Direct Application

  1. Changes
    - Drop ALL old policies completely
    - Create new clean policies with event_categories_manage
    
  2. Security
    - Proper permission checks for custom icons management
*/

-- Drop ALL existing policies
DROP POLICY IF EXISTS "Authenticated employees can view custom icons" ON custom_icons CASCADE;
DROP POLICY IF EXISTS "Authenticated users can view custom icons" ON custom_icons CASCADE;
DROP POLICY IF EXISTS "Employees with events_manage can insert icons" ON custom_icons CASCADE;
DROP POLICY IF EXISTS "Employees with events_manage can update icons" ON custom_icons CASCADE;
DROP POLICY IF EXISTS "Employees with events_manage can delete icons" ON custom_icons CASCADE;
DROP POLICY IF EXISTS "Employees with event_categories_manage can insert icons" ON custom_icons CASCADE;
DROP POLICY IF EXISTS "Employees with event_categories_manage can update icons" ON custom_icons CASCADE;
DROP POLICY IF EXISTS "Employees with event_categories_manage can delete icons" ON custom_icons CASCADE;
DROP POLICY IF EXISTS "custom_icons_select_policy" ON custom_icons CASCADE;
DROP POLICY IF EXISTS "custom_icons_insert_policy" ON custom_icons CASCADE;
DROP POLICY IF EXISTS "custom_icons_update_policy" ON custom_icons CASCADE;
DROP POLICY IF EXISTS "custom_icons_delete_policy" ON custom_icons CASCADE;

-- Ensure RLS is enabled
ALTER TABLE custom_icons ENABLE ROW LEVEL SECURITY;

-- Create simple, clean policies
CREATE POLICY "view_icons"
  ON custom_icons FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "manage_icons_insert"
  ON custom_icons FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'event_categories_manage' = ANY(employees.permissions)
    )
  );

CREATE POLICY "manage_icons_update"
  ON custom_icons FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'event_categories_manage' = ANY(employees.permissions)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'event_categories_manage' = ANY(employees.permissions)
    )
  );

CREATE POLICY "manage_icons_delete"
  ON custom_icons FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'event_categories_manage' = ANY(employees.permissions)
    )
  );
