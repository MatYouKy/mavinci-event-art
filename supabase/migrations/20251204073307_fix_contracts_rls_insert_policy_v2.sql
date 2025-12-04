/*
  # Naprawa polityk RLS dla tabeli contracts - dodanie polityki INSERT

  1. Zmiany
    - Usunięcie starej polityki ALL
    - Dodanie oddzielnych polityk dla SELECT, INSERT, UPDATE, DELETE
    - Pozwala to na tworzenie kontraktów przez użytkowników z odpowiednimi uprawnieniami
  
  2. Bezpieczeństwo
    - Tylko zalogowani użytkownicy z odpowiednimi uprawnieniami mogą tworzyć kontrakty
    - Administratorzy (access_level = 'admin') mają pełny dostęp
    - Utrzymuje bezpieczeństwo i kontrolę dostępu
*/

-- Usuń starą politykę
DROP POLICY IF EXISTS "Użytkownicy z contracts_manage mogą wszystko" ON contracts;

-- Dodaj politykę SELECT dla użytkowników z contracts_view
CREATE POLICY "Użytkownicy mogą przeglądać kontrakty" 
  ON contracts
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM employees
      WHERE employees.id = auth.uid()
      AND (
        employees.access_level = 'admin'
        OR 'contracts_view' = ANY(employees.permissions)
        OR 'contracts_manage' = ANY(employees.permissions)
      )
    )
  );

-- Dodaj politykę INSERT dla kontraktów
CREATE POLICY "Użytkownicy mogą tworzyć kontrakty" 
  ON contracts
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM employees
      WHERE employees.id = auth.uid()
      AND (
        employees.access_level = 'admin'
        OR 'contracts_create' = ANY(employees.permissions)
        OR 'contracts_manage' = ANY(employees.permissions)
        OR 'offers_manage' = ANY(employees.permissions)
      )
    )
  );

-- Dodaj politykę UPDATE
CREATE POLICY "Użytkownicy mogą aktualizować kontrakty" 
  ON contracts
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM employees
      WHERE employees.id = auth.uid()
      AND (
        employees.access_level = 'admin'
        OR 'contracts_manage' = ANY(employees.permissions)
      )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM employees
      WHERE employees.id = auth.uid()
      AND (
        employees.access_level = 'admin'
        OR 'contracts_manage' = ANY(employees.permissions)
      )
    )
  );

-- Dodaj politykę DELETE
CREATE POLICY "Użytkownicy mogą usuwać kontrakty" 
  ON contracts
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM employees
      WHERE employees.id = auth.uid()
      AND (
        employees.access_level = 'admin'
        OR 'contracts_manage' = ANY(employees.permissions)
      )
    )
  );
