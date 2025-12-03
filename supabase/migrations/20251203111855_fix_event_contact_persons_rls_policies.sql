/*
  # Napraw polityki RLS dla event_contact_persons

  1. Problem
    - Polityka FOR ALL nie ma WITH CHECK
    - Powoduje błąd 42501 przy INSERT

  2. Rozwiązanie
    - Usuń starą politykę FOR ALL
    - Dodaj osobne polityki dla SELECT, INSERT, UPDATE, DELETE
    - Każda operacja INSERT/UPDATE ma WITH CHECK
*/

-- Usuń starą politykę
DROP POLICY IF EXISTS "Pracownicy mogą zarządzać osobami kontaktowymi eventów" ON event_contact_persons;

-- SELECT - tylko USING
CREATE POLICY "Pracownicy mogą przeglądać osoby kontaktowe eventów v2"
  ON event_contact_persons FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE id = auth.uid()
      AND 'events_view' = ANY(permissions)
    )
  );

-- INSERT - tylko WITH CHECK
CREATE POLICY "Pracownicy mogą dodawać osoby kontaktowe do eventów"
  ON event_contact_persons FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees
      WHERE id = auth.uid()
      AND 'events_manage' = ANY(permissions)
    )
  );

-- UPDATE - USING i WITH CHECK
CREATE POLICY "Pracownicy mogą aktualizować osoby kontaktowe eventów"
  ON event_contact_persons FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE id = auth.uid()
      AND 'events_manage' = ANY(permissions)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees
      WHERE id = auth.uid()
      AND 'events_manage' = ANY(permissions)
    )
  );

-- DELETE - tylko USING
CREATE POLICY "Pracownicy mogą usuwać osoby kontaktowe z eventów"
  ON event_contact_persons FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE id = auth.uid()
      AND 'events_manage' = ANY(permissions)
    )
  );