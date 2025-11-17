/*
  # Fix conferences_cities policies and add name column

  1. Changes
    - Add 'name' column (for backward compatibility with Schema.org)
    - Drop overly permissive policies
    - Add proper RLS policies with website_edit permission
    
  2. Security
    - Public can view active cities
    - Only users with website_edit permission can modify
*/

-- Add name column if doesn't exist (for Schema.org compatibility)
ALTER TABLE conferences_cities 
ADD COLUMN IF NOT EXISTS name text;

-- Copy city_name to name for existing records
UPDATE conferences_cities 
SET name = city_name 
WHERE name IS NULL;

-- Drop existing overly permissive policies
DROP POLICY IF EXISTS "Anyone can view conferences cities" ON conferences_cities;
DROP POLICY IF EXISTS "Authenticated users can manage conferences cities" ON conferences_cities;

-- Public can view active cities
CREATE POLICY "Public can view conferences cities"
  ON conferences_cities
  FOR SELECT
  USING (is_active = true);

-- Website editors can insert
CREATE POLICY "Website editors can insert conferences cities"
  ON conferences_cities
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
CREATE POLICY "Website editors can update conferences cities"
  ON conferences_cities
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
CREATE POLICY "Website editors can delete conferences cities"
  ON conferences_cities
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'website_edit' = ANY(employees.permissions)
    )
  );
