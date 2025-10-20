/*
  # Napraw dostęp do profili pracowników z uwzględnieniem adminów

  1. Problem
    - Administrator stracił dostęp do przeglądania listy pracowników
    - Mobile nie może załadować profilu po email
    - Poprzednia migracja nie uwzględniała funkcji is_admin()

  2. Rozwiązanie
    - Dodaj logikę admina: is_admin(auth.uid())
    - Dodaj możliwość załadowania po email
    - Każdy admin widzi wszystkich pracowników
    - Każdy pracownik widzi swój profil (po ID lub email)
    - Pracownicy z employees_view widzą wszystkich
*/

-- Usuń starą politykę SELECT
DROP POLICY IF EXISTS "Users can view own profile or with permission" ON employees;

-- Nowa polityka: możesz zobaczyć swój profil (po ID lub email), mieć uprawnienie employees_view, lub być adminem
CREATE POLICY "Users can view own profile or with permission"
  ON employees
  FOR SELECT
  TO authenticated
  USING (
    -- Własny profil (sprawdź po auth.uid lub po email z auth.jwt)
    auth.uid() = id
    OR
    email = (SELECT email FROM auth.users WHERE id = auth.uid())
    OR
    -- Lub admin (access_level = 'admin' OR role = 'admin')
    is_admin(auth.uid())
    OR
    -- Lub uprawnienie employees_view
    EXISTS (
      SELECT 1 FROM employees e
      WHERE e.id = auth.uid()
      AND 'employees_view' = ANY(e.permissions)
    )
  );