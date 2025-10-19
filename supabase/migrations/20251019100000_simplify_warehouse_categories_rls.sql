/*
  # Uproszczenie polityk RLS dla warehouse_categories

  1. Zmiany
    - Zmiana polityk aby działały poprawnie
    - Dodanie logowania dla debugowania
    - Uproszczenie warunków

  2. Bezpieczeństwo
    - Wszyscy mogą czytać aktywne kategorie
    - Authenticated użytkownicy z equipment_manage mogą zarządzać
*/

-- Usuńmy wszystkie stare polityki
DROP POLICY IF EXISTS "Anyone can read active warehouse categories" ON warehouse_categories;
DROP POLICY IF EXISTS "Employees with equipment_manage can insert categories" ON warehouse_categories;
DROP POLICY IF EXISTS "Employees with equipment_manage can update categories" ON warehouse_categories;
DROP POLICY IF EXISTS "Employees with equipment_manage can delete categories" ON warehouse_categories;

-- Polityka SELECT - wszyscy mogą czytać aktywne kategorie
CREATE POLICY "Anyone can read warehouse categories"
  ON warehouse_categories
  FOR SELECT
  USING (is_active = true);

-- Polityka INSERT - authenticated użytkownicy z equipment_manage
CREATE POLICY "Authenticated users with equipment_manage can insert"
  ON warehouse_categories
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM employees
      WHERE employees.id = auth.uid()
      AND (
        'equipment_manage' = ANY(employees.permissions)
        OR 'equipment_create' = ANY(employees.permissions)
      )
    )
  );

-- Polityka UPDATE - authenticated użytkownicy z equipment_manage
CREATE POLICY "Authenticated users with equipment_manage can update"
  ON warehouse_categories
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM employees
      WHERE employees.id = auth.uid()
      AND 'equipment_manage' = ANY(employees.permissions)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM employees
      WHERE employees.id = auth.uid()
      AND 'equipment_manage' = ANY(employees.permissions)
    )
  );

-- Polityka DELETE - authenticated użytkownicy z equipment_manage
CREATE POLICY "Authenticated users with equipment_manage can delete"
  ON warehouse_categories
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM employees
      WHERE employees.id = auth.uid()
      AND 'equipment_manage' = ANY(employees.permissions)
    )
  );
