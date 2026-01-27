/*
  # Dodanie uprawnień usuwania wpisów czasu dla adminów

  ## Zmiany
  1. Dodanie policy DELETE dla adminów do usuwania wszystkich wpisów czasu
  2. Dodanie policy UPDATE dla adminów do edycji wszystkich wpisów czasu

  ## Bezpieczeństwo
  - Sprawdzamy czy użytkownik ma uprawnienie 'admin'
  - Tylko admini mogą usuwać i edytować wpisy innych pracowników
*/

-- Dodaj policy dla adminów do usuwania wszystkich wpisów czasu
CREATE POLICY "Admini mogą usuwać wszystkie wpisy czasu"
  ON time_entries
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND employees.permissions @> ARRAY['admin']
    )
  );

-- Dodaj policy dla adminów do edycji wszystkich wpisów czasu
CREATE POLICY "Admini mogą edytować wszystkie wpisy czasu"
  ON time_entries
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND employees.permissions @> ARRAY['admin']
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND employees.permissions @> ARRAY['admin']
    )
  );

-- Komentarze
COMMENT ON POLICY "Admini mogą usuwać wszystkie wpisy czasu" ON time_entries IS
  'Administratorzy mogą usuwać wpisy czasu wszystkich pracowników w dashboardzie time-tracking';

COMMENT ON POLICY "Admini mogą edytować wszystkie wpisy czasu" ON time_entries IS
  'Administratorzy mogą edytować wpisy czasu wszystkich pracowników w dashboardzie time-tracking';
