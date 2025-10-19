/*
  # Naprawa polityk RLS dla warehouse_categories

  1. Zmiany
    - Usunięcie starej restrykcyjnej polityki
    - Dodanie bardziej elastycznych polityk dla CRUD
    - Umożliwienie zarządzania kategoriami przez użytkowników z uprawnieniem equipment_manage

  2. Bezpieczeństwo
    - Wszyscy mogą czytać aktywne kategorie
    - Tylko użytkownicy z equipment_manage mogą dodawać/edytować/usuwać
*/

-- Usuńmy starą politykę
DROP POLICY IF EXISTS "Employees with equipment_manage can manage warehouse categories" ON warehouse_categories;

-- Polityka SELECT - wszyscy mogą czytać aktywne kategorie
DROP POLICY IF EXISTS "Anyone can read active warehouse categories" ON warehouse_categories;
CREATE POLICY "Anyone can read active warehouse categories"
  ON warehouse_categories
  FOR SELECT
  USING (is_active = true);

-- Polityka INSERT - tylko użytkownicy z equipment_manage
CREATE POLICY "Employees with equipment_manage can insert categories"
  ON warehouse_categories
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'equipment_manage' = ANY(employees.permissions)
    )
  );

-- Polityka UPDATE - tylko użytkownicy z equipment_manage
CREATE POLICY "Employees with equipment_manage can update categories"
  ON warehouse_categories
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'equipment_manage' = ANY(employees.permissions)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'equipment_manage' = ANY(employees.permissions)
    )
  );

-- Polityka DELETE - tylko użytkownicy z equipment_manage
CREATE POLICY "Employees with equipment_manage can delete categories"
  ON warehouse_categories
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'equipment_manage' = ANY(employees.permissions)
    )
  );
