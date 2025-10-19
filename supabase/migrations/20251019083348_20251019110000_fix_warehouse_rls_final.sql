/*
  # Finalna naprawa polityk RLS dla warehouse_categories

  1. Problem
    - Polityki z EXISTS + auth.uid() nie działają poprawnie
    - UPDATE nie aktualizuje danych
    - INSERT blokowany przez RLS

  2. Rozwiązanie
    - Uproszczone polityki używające tylko authenticated role
    - Sprawdzanie uprawnień przez funkcję pomocniczą
    - Oddzielne polityki dla każdej operacji

  3. Bezpieczeństwo
    - Wszyscy mogą czytać aktywne kategorie
    - Tylko authenticated użytkownicy z odpowiednimi uprawnieniami mogą modyfikować
*/

-- Usuńmy wszystkie stare polityki
DROP POLICY IF EXISTS "Anyone can read warehouse categories" ON warehouse_categories;
DROP POLICY IF EXISTS "Authenticated users with equipment_manage can insert" ON warehouse_categories;
DROP POLICY IF EXISTS "Authenticated users with equipment_manage can update" ON warehouse_categories;
DROP POLICY IF EXISTS "Authenticated users with equipment_manage can delete" ON warehouse_categories;

-- Funkcja pomocnicza sprawdzająca uprawnienia
CREATE OR REPLACE FUNCTION user_has_equipment_permission()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 
    FROM employees 
    WHERE employees.id = auth.uid()
    AND (
      'equipment_manage' = ANY(employees.permissions)
      OR 'equipment_create' = ANY(employees.permissions)
    )
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Polityka SELECT - wszyscy mogą czytać aktywne kategorie
CREATE POLICY "warehouse_categories_select"
  ON warehouse_categories
  FOR SELECT
  TO public
  USING (is_active = true);

-- Polityka INSERT
CREATE POLICY "warehouse_categories_insert"
  ON warehouse_categories
  FOR INSERT
  TO authenticated
  WITH CHECK (user_has_equipment_permission());

-- Polityka UPDATE
CREATE POLICY "warehouse_categories_update"
  ON warehouse_categories
  FOR UPDATE
  TO authenticated
  USING (user_has_equipment_permission())
  WITH CHECK (user_has_equipment_permission());

-- Polityka DELETE
CREATE POLICY "warehouse_categories_delete"
  ON warehouse_categories
  FOR DELETE
  TO authenticated
  USING (user_has_equipment_permission());
