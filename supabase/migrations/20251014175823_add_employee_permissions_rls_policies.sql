/*
  # Dodanie polityk RLS dla employee_permissions

  ## Zmiany
  - Dodanie polityk SELECT dla wszystkich zalogowanych pracowników
  - Dodanie polityk INSERT/UPDATE/DELETE dla adminów i osób z uprawnieniem employee_permissions
  
  ## Bezpieczeństwo
  - Tylko admini i osoby z uprawnieniem 'employee_permissions' mogą zarządzać uprawnieniami
  - Wszyscy zalogowani pracownicy mogą przeglądać uprawnienia (do celów UI)
*/

-- Polityka SELECT - wszyscy zalogowani pracownicy mogą czytać uprawnienia
CREATE POLICY "Authenticated employees can view permissions"
  ON employee_permissions
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
    )
  );

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
        OR (
          employees.permissions IS NOT NULL
          AND employees.permissions::jsonb ? 'employee_permissions'
        )
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
        OR (
          employees.permissions IS NOT NULL
          AND employees.permissions::jsonb ? 'employee_permissions'
        )
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
        OR (
          employees.permissions IS NOT NULL
          AND employees.permissions::jsonb ? 'employee_permissions'
        )
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
        OR (
          employees.permissions IS NOT NULL
          AND employees.permissions::jsonb ? 'employee_permissions'
        )
      )
    )
  );