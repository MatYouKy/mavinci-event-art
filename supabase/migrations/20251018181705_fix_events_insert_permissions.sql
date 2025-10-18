/*
  # Naprawa uprawnień do tworzenia wydarzeń

  1. Zmiany
    - Zmiana polityki INSERT dla events
    - Użytkownicy z events_manage mogą tworzyć wydarzenia
    - Alternatywnie użytkownicy z calendar_manage też mogą
*/

-- Usuń starą politykę
DROP POLICY IF EXISTS "Users with calendar_manage can create events" ON events;

-- Utwórz nową politykę pozwalającą na tworzenie wydarzeń
CREATE POLICY "Users with events or calendar manage can create events"
  ON events FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND (
        'events_manage' = ANY(employees.permissions)
        OR 'calendar_manage' = ANY(employees.permissions)
      )
    )
  );
