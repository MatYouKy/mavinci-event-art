/*
  # Napraw dostęp do własnego profilu pracownika

  1. Problem
    - Użytkownik bez uprawnień employees_view nie widzi własnego profilu

  2. Rozwiązanie
    - Dodaj logikę: każdy może zobaczyć swój profil LUB musisz mieć uprawnienie employees_view
*/

-- Usuń starą politykę SELECT
DROP POLICY IF EXISTS "Authenticated users can view employees" ON employees;

-- Nowa polityka: możesz zobaczyć swój profil lub mieć uprawnienie employees_view
CREATE POLICY "Users can view own profile or with permission"
  ON employees
  FOR SELECT
  TO authenticated
  USING (
    -- Własny profil
    auth.uid() = id
    OR
    -- Lub uprawnienie employees_view
    EXISTS (
      SELECT 1 FROM employees e
      WHERE e.id = auth.uid()
      AND 'employees_view' = ANY(e.permissions)
    )
  );
