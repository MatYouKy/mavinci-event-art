/*
  # Fix RLS policies for conferences_service_items

  1. Changes
    - Add INSERT policy for authenticated users with 'website_edit' permission
    - Add UPDATE policy for authenticated users with 'website_edit' permission
    - Add DELETE policy for authenticated users with 'website_edit' permission
  
  2. Security
    - Only employees with 'website_edit' in their permissions array can modify service items
    - Public users can still read active items (existing policy)
    - Uses employees table to check permissions via auth.uid()
*/

-- Drop existing policies if any (except the public read policy)
DO $$ 
BEGIN
  DROP POLICY IF EXISTS "Employees with website_edit can insert service items" ON conferences_service_items;
  DROP POLICY IF EXISTS "Employees with website_edit can update service items" ON conferences_service_items;
  DROP POLICY IF EXISTS "Employees with website_edit can delete service items" ON conferences_service_items;
END $$;

-- INSERT: Allow authenticated users with website_edit permission
CREATE POLICY "Employees with website_edit can insert service items"
ON conferences_service_items
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM employees
    WHERE employees.id = auth.uid()
    AND 'website_edit' = ANY(employees.permissions)
  )
);

-- UPDATE: Allow authenticated users with website_edit permission
CREATE POLICY "Employees with website_edit can update service items"
ON conferences_service_items
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

-- DELETE: Allow authenticated users with website_edit permission
CREATE POLICY "Employees with website_edit can delete service items"
ON conferences_service_items
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM employees
    WHERE employees.id = auth.uid()
    AND 'website_edit' = ANY(employees.permissions)
  )
);
