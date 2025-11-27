/*
  # Dodaj link_url i napraw polityki RLS

  1. Zmiany
    - Dodaj `link_url` do quiz_show_formats
    - Napraw polityki RLS aby nie powodowały konfliktów
    - Dodaj brakujące uprawnienia dla anonymous

  2. Security
    - Upewnij się że anonymous może czytać
    - Admin i website_edit mogą edytować
*/

-- Add link_url column
ALTER TABLE quiz_show_formats 
ADD COLUMN IF NOT EXISTS link_url text;

-- Drop existing policies to recreate them properly
DROP POLICY IF EXISTS "Anyone can view visible quiz show formats" ON quiz_show_formats;
DROP POLICY IF EXISTS "Admins can view all quiz show formats" ON quiz_show_formats;
DROP POLICY IF EXISTS "Admins can insert quiz show formats" ON quiz_show_formats;
DROP POLICY IF EXISTS "Admins can update quiz show formats" ON quiz_show_formats;
DROP POLICY IF EXISTS "Admins can delete quiz show formats" ON quiz_show_formats;
DROP POLICY IF EXISTS "Website editors can update quiz show formats" ON quiz_show_formats;

-- Public can read visible formats (anonymous + authenticated)
CREATE POLICY "Public can view visible quiz show formats"
  ON quiz_show_formats
  FOR SELECT
  USING (is_visible = true);

-- Authenticated users with admin permission can do everything
CREATE POLICY "Admins have full access to quiz show formats"
  ON quiz_show_formats
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'admin' = ANY(employees.permissions)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'admin' = ANY(employees.permissions)
    )
  );

-- Users with website_edit permission can update
CREATE POLICY "Website editors can update quiz show formats"
  ON quiz_show_formats
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

-- Users with website_edit permission can insert
CREATE POLICY "Website editors can insert quiz show formats"
  ON quiz_show_formats
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'website_edit' = ANY(employees.permissions)
    )
  );