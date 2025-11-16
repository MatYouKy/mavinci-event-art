/*
  # Allow website editors to manage conferences_related_services

  1. Changes
    - Update policies to allow users with 'website_edit' permission
    - Keep admin access
    - Maintain public read access for active items

  2. Security
    - Public can SELECT active items
    - Users with 'admin' OR 'website_edit' permission can manage
*/

-- Drop existing admin-only policies
DROP POLICY IF EXISTS "Admins can insert related services" ON conferences_related_services;
DROP POLICY IF EXISTS "Admins can update related services" ON conferences_related_services;
DROP POLICY IF EXISTS "Admins can delete related services" ON conferences_related_services;

-- Allow website editors and admins to insert
CREATE POLICY "Website editors can insert related services"
  ON conferences_related_services
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees
      WHERE id = auth.uid()
      AND ('admin' = ANY(permissions) OR 'website_edit' = ANY(permissions))
    )
  );

-- Allow website editors and admins to update
CREATE POLICY "Website editors can update related services"
  ON conferences_related_services
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE id = auth.uid()
      AND ('admin' = ANY(permissions) OR 'website_edit' = ANY(permissions))
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees
      WHERE id = auth.uid()
      AND ('admin' = ANY(permissions) OR 'website_edit' = ANY(permissions))
    )
  );

-- Allow website editors and admins to delete
CREATE POLICY "Website editors can delete related services"
  ON conferences_related_services
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE id = auth.uid()
      AND ('admin' = ANY(permissions) OR 'website_edit' = ANY(permissions))
    )
  );
