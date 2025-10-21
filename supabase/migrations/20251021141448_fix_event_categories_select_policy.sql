/*
  # Naprawa polityki SELECT dla event_categories

  1. Problem
    - Polityka SELECT wymaga events_manage lub event_categories_manage
    - Nie uwzględnia admina
    - Użytkownicy z samym event_categories_manage nie mogą czytać kategorii

  2. Rozwiązanie
    - Dodaj sprawdzanie roli admin
    - Upewnij się że users z event_categories_manage mogą czytać
*/

-- Usuń istniejącą politykę SELECT
DROP POLICY IF EXISTS "Authenticated employees can view event categories" ON event_categories;

-- Utwórz nową politykę SELECT z obsługą admina
CREATE POLICY "Authenticated employees can view event categories"
  ON event_categories FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND (
        employees.role = 'admin'
        OR 'events_manage' = ANY(employees.permissions)
        OR 'event_categories_manage' = ANY(employees.permissions)
      )
    )
  );

-- Upewnij się że polityki INSERT/UPDATE/DELETE też uwzględniają admina
DROP POLICY IF EXISTS "Employees with event_categories_manage can insert categories" ON event_categories;
DROP POLICY IF EXISTS "Employees with event_categories_manage can update categories" ON event_categories;
DROP POLICY IF EXISTS "Employees with event_categories_manage can delete categories" ON event_categories;

CREATE POLICY "Employees with event_categories_manage can insert categories"
  ON event_categories FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND (
        employees.role = 'admin'
        OR 'event_categories_manage' = ANY(employees.permissions)
      )
    )
  );

CREATE POLICY "Employees with event_categories_manage can update categories"
  ON event_categories FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND (
        employees.role = 'admin'
        OR 'event_categories_manage' = ANY(employees.permissions)
      )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND (
        employees.role = 'admin'
        OR 'event_categories_manage' = ANY(employees.permissions)
      )
    )
  );

CREATE POLICY "Employees with event_categories_manage can delete categories"
  ON event_categories FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND (
        employees.role = 'admin'
        OR 'event_categories_manage' = ANY(employees.permissions)
      )
    )
  );

-- Upewnij się że polityki custom_icons też uwzględniają admina
DROP POLICY IF EXISTS "custom_icons_insert_policy" ON custom_icons;
DROP POLICY IF EXISTS "custom_icons_update_policy" ON custom_icons;
DROP POLICY IF EXISTS "custom_icons_delete_policy" ON custom_icons;

CREATE POLICY "custom_icons_insert_policy"
  ON custom_icons FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND (
        employees.role = 'admin'
        OR 'event_categories_manage' = ANY(employees.permissions)
      )
    )
  );

CREATE POLICY "custom_icons_update_policy"
  ON custom_icons FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND (
        employees.role = 'admin'
        OR 'event_categories_manage' = ANY(employees.permissions)
      )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND (
        employees.role = 'admin'
        OR 'event_categories_manage' = ANY(employees.permissions)
      )
    )
  );

CREATE POLICY "custom_icons_delete_policy"
  ON custom_icons FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND (
        employees.role = 'admin'
        OR 'event_categories_manage' = ANY(employees.permissions)
      )
    )
  );
