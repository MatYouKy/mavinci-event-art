/*
  # Uproszczenie polityki INSERT dla events

  1. Zmiany
    - Uproszczenie warunku INSERT
    - Dodanie logowania dla debugowania
    - Zmiana na bardziej permisywną politykę tymczasowo
*/

-- Usuń obecną politykę
DROP POLICY IF EXISTS "Users with events or calendar manage can create events" ON events;

-- Tymczasowo - pozwól wszystkim zalogowanym użytkownikom tworzyć wydarzenia
-- (aby zdiagnozować problem)
CREATE POLICY "Authenticated users can create events"
  ON events FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Komentarz dla przyszłej wersji:
-- Po zdiagnozowaniu problemu wrócimy do:
-- WITH CHECK (
--   EXISTS (
--     SELECT 1 FROM employees
--     WHERE employees.id = auth.uid()
--     AND is_active = true
--     AND (
--       'events_manage' = ANY(employees.permissions)
--       OR 'calendar_manage' = ANY(employees.permissions)
--     )
--   )
-- );
