/*
  # Naprawa dostępu adminów do wpisów czasu

  ## Zmiany
  1. Dodanie policy dla adminów do odczytu wszystkich wpisów czasu
  2. Admini mogą widzieć wpisy wszystkich pracowników

  ## Bezpieczeństwo
  - Sprawdzamy czy użytkownik ma uprawnienie 'admin'
*/

-- Dodaj policy dla adminów do odczytu wszystkich wpisów czasu
CREATE POLICY "Admini widzą wszystkie wpisy czasu"
  ON time_entries
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND employees.permissions @> ARRAY['admin']
    )
  );

-- Dodaj komentarz
COMMENT ON POLICY "Admini widzą wszystkie wpisy czasu" ON time_entries IS
  'Administratorzy mogą przeglądać wpisy czasu wszystkich pracowników w dashboardzie time-tracking';
