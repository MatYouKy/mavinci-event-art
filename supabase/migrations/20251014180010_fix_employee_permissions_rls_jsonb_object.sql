/*
  # Naprawa polityk RLS dla employee_permissions - używanie JSONB object

  ## Zmiany
  - Zmiana sprawdzania permissions z array na JSONB object
  - Sprawdzanie permissions->'employee_permissions' = 'true'::jsonb
  
  ## Bezpieczeństwo
  - Admin zawsze ma dostęp (access_level='admin' OR role='admin')
  - Osoby z permissions->employee_permissions = true mają dostęp
*/

-- Drop old policies
DROP POLICY IF EXISTS "Admins and authorized users can insert permissions" ON employee_permissions;
DROP POLICY IF EXISTS "Admins and authorized users can update permissions" ON employee_permissions;
DROP POLICY IF EXISTS "Admins and authorized users can delete permissions" ON employee_permissions;

-- Polityka INSERT - tylko admin i osoby z uprawnieniem employee_permissions
CREATE POLICY "Admins and authorized users can insert permissions"
  ON employee_permissions
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND (
        employees.access_level = 'admin'
        OR employees.role = 'admin'
        OR (employees.permissions->>'employee_permissions')::boolean = true
      )
    )
  );

-- Polityka UPDATE - tylko admin i osoby z uprawnieniem employee_permissions
CREATE POLICY "Admins and authorized users can update permissions"
  ON employee_permissions
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND (
        employees.access_level = 'admin'
        OR employees.role = 'admin'
        OR (employees.permissions->>'employee_permissions')::boolean = true
      )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND (
        employees.access_level = 'admin'
        OR employees.role = 'admin'
        OR (employees.permissions->>'employee_permissions')::boolean = true
      )
    )
  );

-- Polityka DELETE - tylko admin i osoby z uprawnieniem employee_permissions
CREATE POLICY "Admins and authorized users can delete permissions"
  ON employee_permissions
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND (
        employees.access_level = 'admin'
        OR employees.role = 'admin'
        OR (employees.permissions->>'employee_permissions')::boolean = true
      )
    )
  );