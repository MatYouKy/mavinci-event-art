/*
  # Cleanup and fix time_entries RLS policies

  1. Problem
    - Duplikaty policies (polskie i angielskie wersje)
    - Może powodować konflikty w dostępie
    - Niepotrzebny overhead przy każdym zapytaniu

  2. Rozwiązanie
    - Usuń WSZYSTKIE istniejące policies
    - Stwórz czysty zestaw policies
    - Jeden policy per operacja per rola
*/

-- Usuń WSZYSTKIE istniejące policies
DROP POLICY IF EXISTS "Service role ma pełen dostęp do time_entries" ON time_entries;
DROP POLICY IF EXISTS "Admini widzą wszystkie wpisy czasu" ON time_entries;
DROP POLICY IF EXISTS "Admini mogą edytować wszystkie wpisy czasu" ON time_entries;
DROP POLICY IF EXISTS "Admini mogą usuwać wszystkie wpisy czasu" ON time_entries;
DROP POLICY IF EXISTS "Pracownicy widzą swoje wpisy czasu" ON time_entries;
DROP POLICY IF EXISTS "Pracownicy mogą dodawać swoje wpisy czasu" ON time_entries;
DROP POLICY IF EXISTS "Pracownicy mogą edytować swoje wpisy czasu" ON time_entries;
DROP POLICY IF EXISTS "Pracownicy mogą usuwać swoje wpisy czasu" ON time_entries;
DROP POLICY IF EXISTS "Admins can view all time entries" ON time_entries;
DROP POLICY IF EXISTS "Users can view own time entries" ON time_entries;
DROP POLICY IF EXISTS "Time tracking managers can view all entries" ON time_entries;
DROP POLICY IF EXISTS "Users can insert own time entries" ON time_entries;
DROP POLICY IF EXISTS "Users can update own time entries" ON time_entries;
DROP POLICY IF EXISTS "Users can delete own time entries" ON time_entries;

-- ============================================
-- NOWE CZYSTE POLICIES
-- ============================================

-- 1. SELECT: Admini i time_tracking_view widzą wszystkie
CREATE POLICY "time_entries_select_admin"
  ON time_entries
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND (
        'admin' = ANY(employees.permissions)
        OR 'time_tracking_view' = ANY(employees.permissions)
      )
    )
  );

-- 2. SELECT: Użytkownicy widzą swoje
CREATE POLICY "time_entries_select_own"
  ON time_entries
  FOR SELECT
  TO authenticated
  USING (employee_id = auth.uid());

-- 3. INSERT: Każdy zalogowany może dodawać swoje wpisy
CREATE POLICY "time_entries_insert_own"
  ON time_entries
  FOR INSERT
  TO authenticated
  WITH CHECK (employee_id = auth.uid());

-- 4. UPDATE: Admini mogą edytować wszystkie
CREATE POLICY "time_entries_update_admin"
  ON time_entries
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'admin' = ANY(employees.permissions)
    )
  );

-- 5. UPDATE: Użytkownicy mogą edytować swoje
CREATE POLICY "time_entries_update_own"
  ON time_entries
  FOR UPDATE
  TO authenticated
  USING (employee_id = auth.uid())
  WITH CHECK (employee_id = auth.uid());

-- 6. DELETE: Admini mogą usuwać wszystkie
CREATE POLICY "time_entries_delete_admin"
  ON time_entries
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'admin' = ANY(employees.permissions)
    )
  );

-- 7. DELETE: Użytkownicy mogą usuwać swoje
CREATE POLICY "time_entries_delete_own"
  ON time_entries
  FOR DELETE
  TO authenticated
  USING (employee_id = auth.uid());

-- 8. Service role ma zawsze pełen dostęp
CREATE POLICY "time_entries_service_role_all"
  ON time_entries
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Komentarz
COMMENT ON TABLE time_entries IS 
  'Time tracking entries - RLS enabled with clean policies for admin and user access';
