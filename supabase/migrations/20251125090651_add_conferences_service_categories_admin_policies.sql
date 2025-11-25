/*
  # Add admin policies for conferences_service_categories

  Allows employees with website_edit permission to:
  - View all categories (including inactive)
  - Create, update, and delete categories
*/

-- Allow website_edit employees to view all categories
CREATE POLICY "Employees with website_edit can view all service categories"
ON conferences_service_categories
FOR SELECT
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

-- Allow website_edit employees to insert categories
CREATE POLICY "Employees with website_edit can insert service categories"
ON conferences_service_categories
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

-- Allow website_edit employees to update categories
CREATE POLICY "Employees with website_edit can update service categories"
ON conferences_service_categories
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

-- Allow website_edit employees to delete categories
CREATE POLICY "Employees with website_edit can delete service categories"
ON conferences_service_categories
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
