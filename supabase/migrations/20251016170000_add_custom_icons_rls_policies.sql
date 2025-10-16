/*
  # Add RLS Policies for custom_icons

  1. Security
    - Enable RLS on custom_icons table
    - Add SELECT policy for authenticated users
    - Add INSERT, UPDATE, DELETE policies for employees with events_manage permission
*/

-- Enable RLS if not already enabled
ALTER TABLE custom_icons ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if any
DROP POLICY IF EXISTS "Authenticated users can view custom icons" ON custom_icons;
DROP POLICY IF EXISTS "Employees with events_manage can insert icons" ON custom_icons;
DROP POLICY IF EXISTS "Employees with events_manage can update icons" ON custom_icons;
DROP POLICY IF EXISTS "Employees with events_manage can delete icons" ON custom_icons;

-- Policies for custom_icons
CREATE POLICY "Authenticated users can view custom icons"
  ON custom_icons FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Employees with events_manage can insert icons"
  ON custom_icons FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'events_manage' = ANY(employees.permissions)
    )
  );

CREATE POLICY "Employees with events_manage can update icons"
  ON custom_icons FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'events_manage' = ANY(employees.permissions)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'events_manage' = ANY(employees.permissions)
    )
  );

CREATE POLICY "Employees with events_manage can delete icons"
  ON custom_icons FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'events_manage' = ANY(employees.permissions)
    )
  );
