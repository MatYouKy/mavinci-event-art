/*
  # Fix Custom Icons RLS Policies - Final

  1. Changes
    - Drop ALL existing policies on custom_icons
    - Create new policies with correct permission checks
    - Use event_categories_manage permission

  2. Security
    - Authenticated users can view icons
    - Only users with event_categories_manage can create/update/delete icons
*/

-- Drop ALL existing policies on custom_icons
DROP POLICY IF EXISTS "Authenticated employees can view custom icons" ON custom_icons;
DROP POLICY IF EXISTS "Authenticated users can view custom icons" ON custom_icons;
DROP POLICY IF EXISTS "Employees with events_manage can insert icons" ON custom_icons;
DROP POLICY IF EXISTS "Employees with events_manage can update icons" ON custom_icons;
DROP POLICY IF EXISTS "Employees with events_manage can delete icons" ON custom_icons;
DROP POLICY IF EXISTS "Employees with event_categories_manage can insert icons" ON custom_icons;
DROP POLICY IF EXISTS "Employees with event_categories_manage can update icons" ON custom_icons;
DROP POLICY IF EXISTS "Employees with event_categories_manage can delete icons" ON custom_icons;

-- Ensure RLS is enabled
ALTER TABLE custom_icons ENABLE ROW LEVEL SECURITY;

-- Create new policies with correct names and permissions
CREATE POLICY "custom_icons_select_policy"
  ON custom_icons FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "custom_icons_insert_policy"
  ON custom_icons FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'event_categories_manage' = ANY(employees.permissions)
    )
  );

CREATE POLICY "custom_icons_update_policy"
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

CREATE POLICY "custom_icons_delete_policy"
  ON custom_icons FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'event_categories_manage' = ANY(employees.permissions)
    )
  );
