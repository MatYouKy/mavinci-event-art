/*
  # Fix RLS policies for conferences_related_services

  1. Changes
    - Drop existing admin policy
    - Create separate policies for SELECT, INSERT, UPDATE, DELETE
    - Add WITH CHECK for INSERT and UPDATE
    - Ensure admins can manage all operations

  2. Security
    - Public can SELECT active items
    - Admins (with 'admin' permission) can INSERT, UPDATE, DELETE
*/

-- Drop existing policies
DROP POLICY IF EXISTS "Anyone can view active related services" ON conferences_related_services;
DROP POLICY IF EXISTS "Admins can manage related services" ON conferences_related_services;

-- Public can view active related services
CREATE POLICY "Anyone can view active related services"
  ON conferences_related_services
  FOR SELECT
  USING (is_active = true);

-- Admins can insert related services
CREATE POLICY "Admins can insert related services"
  ON conferences_related_services
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees
      WHERE id = auth.uid()
      AND 'admin' = ANY(permissions)
    )
  );

-- Admins can update related services
CREATE POLICY "Admins can update related services"
  ON conferences_related_services
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE id = auth.uid()
      AND 'admin' = ANY(permissions)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees
      WHERE id = auth.uid()
      AND 'admin' = ANY(permissions)
    )
  );

-- Admins can delete related services
CREATE POLICY "Admins can delete related services"
  ON conferences_related_services
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE id = auth.uid()
      AND 'admin' = ANY(permissions)
    )
  );
