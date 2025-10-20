/*
  # Przywróć prostą politykę dostępu do pracowników

  1. Problem
    - Restrykcyjna polityka RLS zablokowała dostęp do zdjęć, ustawień i innych funkcji
    - Poprzednia prosta polityka działała dobrze

  2. Rozwiązanie
    - Przywróć prostą politykę: każdy zalogowany użytkownik widzi wszystkich pracowników
    - USING (true) dla SELECT
*/

-- Usuń restrykcyjną politykę
DROP POLICY IF EXISTS "Users can view own profile or with permission" ON employees;

-- Przywróć prostą politykę - każdy zalogowany widzi wszystkich
CREATE POLICY "Authenticated users can view employees"
  ON employees
  FOR SELECT
  TO authenticated
  USING (true);
