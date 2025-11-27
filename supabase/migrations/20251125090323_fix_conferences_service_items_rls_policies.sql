/*
  # Fix conferences_service_items RLS Policies

  Updates RLS policies to use employees.id instead of email matching.
  employees.id is the UUID from auth.users.
*/

-- Drop old policies
DROP POLICY IF EXISTS "Employees with website_edit can insert service items" ON conferences_service_items;
DROP POLICY IF EXISTS "Employees with website_edit can update service items" ON conferences_service_items;
DROP POLICY IF EXISTS "Employees with website_edit can delete service items" ON conferences_service_items;

-- Recreate with correct employee ID check
CREATE POLICY "Employees with website_edit can insert service items"
ON conferences_service_items
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM employees
    WHERE employees.id = auth.uid()
    AND 'website_edit' = ANY(employees.permissions)
    AND employees.is_active = true
  )
);

CREATE POLICY "Employees with website_edit can update service items"
ON conferences_service_items
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM employees
    WHERE employees.id = auth.uid()
    AND 'website_edit' = ANY(employees.permissions)
    AND employees.is_active = true
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM employees
    WHERE employees.id = auth.uid()
    AND 'website_edit' = ANY(employees.permissions)
    AND employees.is_active = true
  )
);

CREATE POLICY "Employees with website_edit can delete service items"
ON conferences_service_items
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM employees
    WHERE employees.id = auth.uid()
    AND 'website_edit' = ANY(employees.permissions)
    AND employees.is_active = true
  )
);
