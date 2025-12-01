/*
  # Fix invoices RLS policies to allow admin and invoices_manage

  ## Changes
  1. Update all invoices policies to check:
     - admin role
     - finances_manage permission
     - invoices_manage permission
  
  ## Security
  - Still requires authentication
  - Multiple permission levels supported
*/

-- Drop existing policies
DROP POLICY IF EXISTS "Allow read invoices for finances_manage" ON invoices;
DROP POLICY IF EXISTS "Allow insert invoices for finances_manage" ON invoices;
DROP POLICY IF EXISTS "Allow update invoices for finances_manage" ON invoices;
DROP POLICY IF EXISTS "Allow delete invoices for finances_manage" ON invoices;

-- Create new policies with admin and invoices_manage support

-- SELECT policy
CREATE POLICY "Allow read invoices for authorized users"
ON invoices
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM employees
    WHERE employees.id = auth.uid()
      AND (
        employees.role = 'admin' OR
        employees.access_level = 'admin' OR
        'finances_manage' = ANY(employees.permissions) OR
        'invoices_manage' = ANY(employees.permissions) OR
        'finances_view' = ANY(employees.permissions)
      )
  )
);

-- INSERT policy
CREATE POLICY "Allow insert invoices for authorized users"
ON invoices
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM employees
    WHERE employees.id = auth.uid()
      AND (
        employees.role = 'admin' OR
        employees.access_level = 'admin' OR
        'finances_manage' = ANY(employees.permissions) OR
        'invoices_manage' = ANY(employees.permissions)
      )
  )
);

-- UPDATE policy
CREATE POLICY "Allow update invoices for authorized users"
ON invoices
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM employees
    WHERE employees.id = auth.uid()
      AND (
        employees.role = 'admin' OR
        employees.access_level = 'admin' OR
        'finances_manage' = ANY(employees.permissions) OR
        'invoices_manage' = ANY(employees.permissions)
      )
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM employees
    WHERE employees.id = auth.uid()
      AND (
        employees.role = 'admin' OR
        employees.access_level = 'admin' OR
        'finances_manage' = ANY(employees.permissions) OR
        'invoices_manage' = ANY(employees.permissions)
      )
  )
);

-- DELETE policy
CREATE POLICY "Allow delete invoices for authorized users"
ON invoices
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM employees
    WHERE employees.id = auth.uid()
      AND (
        employees.role = 'admin' OR
        employees.access_level = 'admin' OR
        'finances_manage' = ANY(employees.permissions)
      )
  )
);
