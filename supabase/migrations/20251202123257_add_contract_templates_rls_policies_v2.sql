/*
  # Add RLS Policies for Contract Templates
  
  1. Security
    - Add RLS policies for contract_templates table
    - Allow admins and users with 'contracts_manage' permission to:
      - SELECT (view templates)
      - INSERT (create new templates)
      - UPDATE (edit templates)
      - DELETE (remove templates)
  
  2. Changes
    - Add policy for SELECT operations
    - Add policy for INSERT operations
    - Add policy for UPDATE operations
    - Add policy for DELETE operations
  
  3. Notes
    - employees.id is the primary key and references auth.uid()
    - employees.role = 'admin' identifies admin users
    - permissions is a text[] array column
*/

-- Drop existing policies if any
DROP POLICY IF EXISTS "Allow admins and contracts managers to view templates" ON contract_templates;
DROP POLICY IF EXISTS "Allow admins and contracts managers to create templates" ON contract_templates;
DROP POLICY IF EXISTS "Allow admins and contracts managers to update templates" ON contract_templates;
DROP POLICY IF EXISTS "Allow admins and contracts managers to delete templates" ON contract_templates;

-- Allow SELECT for admins and users with contracts_manage permission
CREATE POLICY "Allow admins and contracts managers to view templates"
  ON contract_templates
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND (
        employees.role = 'admin'
        OR 'contracts_manage' = ANY(employees.permissions)
      )
    )
  );

-- Allow INSERT for admins and users with contracts_manage permission
CREATE POLICY "Allow admins and contracts managers to create templates"
  ON contract_templates
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND (
        employees.role = 'admin'
        OR 'contracts_manage' = ANY(employees.permissions)
      )
    )
  );

-- Allow UPDATE for admins and users with contracts_manage permission
CREATE POLICY "Allow admins and contracts managers to update templates"
  ON contract_templates
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND (
        employees.role = 'admin'
        OR 'contracts_manage' = ANY(employees.permissions)
      )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND (
        employees.role = 'admin'
        OR 'contracts_manage' = ANY(employees.permissions)
      )
    )
  );

-- Allow DELETE for admins and users with contracts_manage permission
CREATE POLICY "Allow admins and contracts managers to delete templates"
  ON contract_templates
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND (
        employees.role = 'admin'
        OR 'contracts_manage' = ANY(employees.permissions)
      )
    )
  );