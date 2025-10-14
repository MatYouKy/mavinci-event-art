/*
  # Odtworzenie polityk RLS z nowym formatem permissions (TEXT[])

  ## Zmiany
  - Usunięcie starych polityk i utworzenie nowych
  - Używanie 'scope' = ANY(permissions) dla sprawdzania uprawnień
*/

-- Usuń istniejące polityki
DROP POLICY IF EXISTS "Authenticated employees can view permissions" ON employee_permissions;

-- ============================================
-- EMPLOYEE_PERMISSIONS POLICIES
-- ============================================

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
        OR 'employees_permissions' = ANY(employees.permissions)
      )
    )
  );

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
        OR 'employees_permissions' = ANY(employees.permissions)
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
        OR 'employees_permissions' = ANY(employees.permissions)
      )
    )
  );

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
        OR 'employees_permissions' = ANY(employees.permissions)
      )
    )
  );

-- ============================================
-- EQUIPMENT_EDIT_HISTORY POLICIES
-- ============================================

CREATE POLICY "Authorized employees can view edit history"
  ON equipment_edit_history
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND (
        employees.access_level = 'admin'
        OR employees.role = 'admin'
        OR 'equipment_view' = ANY(employees.permissions)
        OR 'equipment_manage' = ANY(employees.permissions)
      )
    )
  );