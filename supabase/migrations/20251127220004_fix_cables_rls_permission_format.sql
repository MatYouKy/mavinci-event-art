/*
  # Fix cables RLS policies - correct permission format

  1. Changes
    - Change permission check from 'equipment:manage' to 'equipment_manage'
    - Update all cables RLS policies to match actual permission format in database

  2. Security
    - Only users with equipment_manage permission can manage cables
*/

-- Drop existing policies
DROP POLICY IF EXISTS "Allow users with equipment:manage to insert cables" ON cables;
DROP POLICY IF EXISTS "Allow users with equipment:manage to update cables" ON cables;
DROP POLICY IF EXISTS "Allow users with equipment:manage to delete cables" ON cables;

-- Recreate with correct permission format
CREATE POLICY "Allow users with equipment_manage to insert cables"
  ON cables
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'equipment_manage' = ANY(employees.permissions)
    )
  );

CREATE POLICY "Allow users with equipment_manage to update cables"
  ON cables
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'equipment_manage' = ANY(employees.permissions)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'equipment_manage' = ANY(employees.permissions)
    )
  );

CREATE POLICY "Allow users with equipment_manage to delete cables"
  ON cables
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'equipment_manage' = ANY(employees.permissions)
    )
  );
