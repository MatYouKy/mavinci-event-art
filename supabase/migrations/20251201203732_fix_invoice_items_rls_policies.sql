/*
  # Fix invoice_items and invoice_history RLS policies

  ## Changes
  1. Update invoice_items to allow admin and invoices_manage
  2. Update invoice_history to allow admin and invoices_manage
  
  ## Security
  - Consistent with invoices table policies
*/

-- Drop existing policies
DROP POLICY IF EXISTS "Allow all invoice_items for finances_manage" ON invoice_items;
DROP POLICY IF EXISTS "Allow insert invoice_history for finances_manage" ON invoice_history;
DROP POLICY IF EXISTS "Allow read invoice_history for finances_manage" ON invoice_history;

-- Invoice Items policies
CREATE POLICY "Allow all invoice_items for authorized users"
ON invoice_items
FOR ALL
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

-- Invoice History - READ policy
CREATE POLICY "Allow read invoice_history for authorized users"
ON invoice_history
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

-- Invoice History - INSERT policy (system only, but allow same users)
CREATE POLICY "Allow insert invoice_history for authorized users"
ON invoice_history
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
