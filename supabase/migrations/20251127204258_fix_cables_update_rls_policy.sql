/*
  # Naprawa polityki RLS dla aktualizacji kabli
  
  ## Opis
  Dodaje WITH CHECK do polityki UPDATE dla tabeli cables, aby zapewnić prawidłowe
  sprawdzanie uprawnień podczas aktualizacji rekordów.
  
  ## Zmiany
  - Usuwa istniejącą politykę UPDATE dla cables
  - Tworzy nową politykę z USING i WITH CHECK
  
  ## Bezpieczeństwo
  - Tylko użytkownicy z uprawnieniem 'equipment:manage' mogą aktualizować kable
*/

-- Usunięcie starej polityki
DROP POLICY IF EXISTS "Allow users with equipment:manage to update cables" ON cables;

-- Utworzenie nowej polityki z WITH CHECK
CREATE POLICY "Allow users with equipment:manage to update cables"
  ON cables FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'equipment:manage' = ANY(employees.permissions)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'equipment:manage' = ANY(employees.permissions)
    )
  );