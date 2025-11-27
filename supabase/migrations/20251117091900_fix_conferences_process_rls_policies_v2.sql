/*
  # Fix RLS policies for conferences_process

  1. Changes
    - Drop overly permissive policies
    - Add proper RLS policies with website_edit permission check
    
  2. Security
    - Public can view (SELECT)
    - Only users with website_edit permission can modify
*/

-- Drop existing policies
DROP POLICY IF EXISTS "Anyone can view conferences process" ON conferences_process;
DROP POLICY IF EXISTS "Authenticated users can manage conferences process" ON conferences_process;

-- Public can view
CREATE POLICY "Public can view conferences process"
  ON conferences_process
  FOR SELECT
  USING (is_active = true);

-- Website editors can insert
CREATE POLICY "Website editors can insert conferences process"
  ON conferences_process
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'website_edit' = ANY(employees.permissions)
    )
  );

-- Website editors can update
CREATE POLICY "Website editors can update conferences process"
  ON conferences_process
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'website_edit' = ANY(employees.permissions)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'website_edit' = ANY(employees.permissions)
    )
  );

-- Website editors can delete
CREATE POLICY "Website editors can delete conferences process"
  ON conferences_process
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'website_edit' = ANY(employees.permissions)
    )
  );
