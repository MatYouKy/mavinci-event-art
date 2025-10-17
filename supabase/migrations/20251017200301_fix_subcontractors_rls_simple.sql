/*
  # Uproszczenie polityk RLS dla podwykonawców

  ## Problem
  Polityki były zbyt restrykcyjne i wymagały nieistniejących uprawnień

  ## Rozwiązanie
  Uproszczone polityki zgodne z resztą systemu:
  - Wszyscy zalogowani użytkownicy mogą zarządzać podwykonawcami
  - Service role ma pełen dostęp

  ## Bezpieczeństwo
  - RLS pozostaje włączony
  - Tylko zalogowani użytkownicy (authenticated)
  - Service role dla automatyzacji
*/

-- Usuń wszystkie stare polityki dla subcontractors
DROP POLICY IF EXISTS "Pracownicy mogą zarządzać podwykonawcami" ON subcontractors;
DROP POLICY IF EXISTS "Pracownicy mogą przeglądać podwykonawców" ON subcontractors;
DROP POLICY IF EXISTS "Admini mają pełen dostęp do podwykonawców" ON subcontractors;
DROP POLICY IF EXISTS "Service role ma pełen dostęp do podwykonawców" ON subcontractors;

-- Nowe proste polityki
CREATE POLICY "Allow authenticated users to view subcontractors"
  ON subcontractors
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Allow authenticated users to insert subcontractors"
  ON subcontractors
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Allow authenticated users to update subcontractors"
  ON subcontractors
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow authenticated users to delete subcontractors"
  ON subcontractors
  FOR DELETE
  TO authenticated
  USING (true);

CREATE POLICY "Service role full access to subcontractors"
  ON subcontractors
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Napraw polityki dla subcontractor_tasks
DROP POLICY IF EXISTS "Pracownicy mogą zarządzać zadaniami podwykonawców" ON subcontractor_tasks;
DROP POLICY IF EXISTS "Pracownicy mogą przeglądać zadania podwykonawców" ON subcontractor_tasks;
DROP POLICY IF EXISTS "Admini zarządzają zadaniami podwykonawców" ON subcontractor_tasks;
DROP POLICY IF EXISTS "Service role ma pełen dostęp do zadań" ON subcontractor_tasks;
DROP POLICY IF EXISTS "Pracownicy przeglądają zadania podwykonawców" ON subcontractor_tasks;

CREATE POLICY "Allow authenticated users to view tasks"
  ON subcontractor_tasks
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Allow authenticated users to insert tasks"
  ON subcontractor_tasks
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Allow authenticated users to update tasks"
  ON subcontractor_tasks
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow authenticated users to delete tasks"
  ON subcontractor_tasks
  FOR DELETE
  TO authenticated
  USING (true);

CREATE POLICY "Service role full access to tasks"
  ON subcontractor_tasks
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Napraw polityki dla subcontractor_contracts
DROP POLICY IF EXISTS "Pracownicy mogą zarządzać umowami podwykonawców" ON subcontractor_contracts;
DROP POLICY IF EXISTS "Pracownicy mogą przeglądać umowy podwykonawców" ON subcontractor_contracts;
DROP POLICY IF EXISTS "Admini zarządzają umowami podwykonawców" ON subcontractor_contracts;
DROP POLICY IF EXISTS "Service role ma pełen dostęp do umów" ON subcontractor_contracts;
DROP POLICY IF EXISTS "Pracownicy przeglądają umowy podwykonawców" ON subcontractor_contracts;

CREATE POLICY "Allow authenticated users to view contracts"
  ON subcontractor_contracts
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Allow authenticated users to insert contracts"
  ON subcontractor_contracts
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Allow authenticated users to update contracts"
  ON subcontractor_contracts
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow authenticated users to delete contracts"
  ON subcontractor_contracts
  FOR DELETE
  TO authenticated
  USING (true);

CREATE POLICY "Service role full access to contracts"
  ON subcontractor_contracts
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);