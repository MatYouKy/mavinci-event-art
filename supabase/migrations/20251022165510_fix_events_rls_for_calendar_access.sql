/*
  # Naprawa polityk RLS dla kalendarza wydarzeń

  Problem:
  - Kalendarz nie pokazuje wydarzeń, bo polityka RLS jest zbyt restrykcyjna
  - Użytkownicy bez events_manage nie widzą żadnych wydarzeń
  
  Rozwiązanie:
  - Zmiana polityki SELECT aby wszyscy authenticated użytkownicy widzieli wydarzenia
  - Zachowanie restrykcyjnych polityk dla UPDATE/DELETE
*/

-- Usuń starą restrykcyjną politykę SELECT
DROP POLICY IF EXISTS "Users can view own and assigned events" ON events;

-- Stwórz nową liberalną politykę SELECT - wszyscy authenticated mogą widzieć wydarzenia
CREATE POLICY "Authenticated users can view all events"
  ON events
  FOR SELECT
  TO authenticated
  USING (true);

-- Dodaj bardziej restrykcyjną politykę dla INSERT - tylko z uprawnieniami
DROP POLICY IF EXISTS "Authenticated users can create events" ON events;

CREATE POLICY "Users with permission can create events"
  ON events
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees emp
      WHERE emp.id = auth.uid()
      AND ('events_manage' = ANY(emp.permissions) OR emp.role = 'admin')
    )
  );

COMMENT ON POLICY "Authenticated users can view all events" ON events IS 
  'Wszyscy zalogowani użytkownicy mogą przeglądać kalendarz wydarzeń';
