/*
  # Add admin SELECT policy for conferences_service_items

  Allows employees with website_edit permission to see all service items
  (including inactive ones) for editing purposes.
*/

CREATE POLICY "Employees with website_edit can view all service items"
ON conferences_service_items
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
