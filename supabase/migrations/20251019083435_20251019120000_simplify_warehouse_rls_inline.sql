/*
  # Uproszczenie polityk RLS - inline checking

  1. Problem
    - Funkcja pomocnicza może nie działać w kontekście RLS
    - Polityki nie przepuszczają operacji INSERT/UPDATE

  2. Rozwiązanie
    - Usunięcie funkcji pomocniczej
    - Bezpośrednie sprawdzenie w politykach
    - Bardziej liberalne podejście dla authenticated users

  3. Bezpieczeństwo
    - Public może czytać aktywne kategorie
    - Authenticated users z permissions mogą modyfikować
*/

-- Usuńmy wszystkie polityki
DROP POLICY IF EXISTS "warehouse_categories_select" ON warehouse_categories;
DROP POLICY IF EXISTS "warehouse_categories_insert" ON warehouse_categories;
DROP POLICY IF EXISTS "warehouse_categories_update" ON warehouse_categories;
DROP POLICY IF EXISTS "warehouse_categories_delete" ON warehouse_categories;

-- Usuńmy funkcję pomocniczą
DROP FUNCTION IF EXISTS user_has_equipment_permission();

-- Polityka SELECT - public może czytać aktywne
CREATE POLICY "warehouse_categories_select"
  ON warehouse_categories
  FOR SELECT
  TO public
  USING (is_active = true);

-- Polityka INSERT - authenticated users
CREATE POLICY "warehouse_categories_insert"
  ON warehouse_categories
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees
      WHERE id = auth.uid()
      AND (
        permissions @> ARRAY['equipment_manage']::text[]
        OR permissions @> ARRAY['equipment_create']::text[]
      )
    )
  );

-- Polityka UPDATE - authenticated users
CREATE POLICY "warehouse_categories_update"
  ON warehouse_categories
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE id = auth.uid()
      AND permissions @> ARRAY['equipment_manage']::text[]
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees
      WHERE id = auth.uid()
      AND permissions @> ARRAY['equipment_manage']::text[]
    )
  );

-- Polityka DELETE - authenticated users
CREATE POLICY "warehouse_categories_delete"
  ON warehouse_categories
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE id = auth.uid()
      AND permissions @> ARRAY['equipment_manage']::text[]
    )
  );
