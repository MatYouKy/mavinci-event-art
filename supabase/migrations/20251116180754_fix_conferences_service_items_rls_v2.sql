/*
  # Fix RLS policies for conferences_service_items - v2

  1. Changes
    - Drop old policies that use auth.uid()
    - Create new policies that check by email (auth.jwt()->>'email')
    - Match the logic used in frontend (useWebsiteEdit hook)
  
  2. Security
    - Only employees with 'website_edit' in permissions can modify
    - Uses email from JWT to match employee record
    - Public can still read active items
*/

-- Drop all existing modification policies
DROP POLICY IF EXISTS "Employees with website_edit can insert service items" ON conferences_service_items;
DROP POLICY IF EXISTS "Employees with website_edit can update service items" ON conferences_service_items;
DROP POLICY IF EXISTS "Employees with website_edit can delete service items" ON conferences_service_items;

-- INSERT: Check by email from JWT
CREATE POLICY "Employees with website_edit can insert service items"
ON conferences_service_items
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM employees
    WHERE employees.email = (auth.jwt()->>'email')
    AND 'website_edit' = ANY(employees.permissions)
  )
);

-- UPDATE: Check by email from JWT
CREATE POLICY "Employees with website_edit can update service items"
ON conferences_service_items
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM employees
    WHERE employees.email = (auth.jwt()->>'email')
    AND 'website_edit' = ANY(employees.permissions)
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM employees
    WHERE employees.email = (auth.jwt()->>'email')
    AND 'website_edit' = ANY(employees.permissions)
  )
);

-- DELETE: Check by email from JWT
CREATE POLICY "Employees with website_edit can delete service items"
ON conferences_service_items
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM employees
    WHERE employees.email = (auth.jwt()->>'email')
    AND 'website_edit' = ANY(employees.permissions)
  )
);
