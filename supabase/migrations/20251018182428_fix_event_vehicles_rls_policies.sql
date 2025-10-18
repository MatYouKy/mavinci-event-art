/*
  # Naprawa polityk RLS dla event_vehicles

  1. Zmiany
    - Uproszczenie polityk RLS dla event_vehicles
    - Pozwolenie na zarządzanie pojazdami w eventach dla użytkowników z dostępem do eventów
*/

-- Usuń stare polityki
DROP POLICY IF EXISTS "Employees can manage event vehicles" ON event_vehicles;
DROP POLICY IF EXISTS "Employees can view event vehicles" ON event_vehicles;

-- Pozwól zalogowanym użytkownikom na odczyt pojazdów w eventach
CREATE POLICY "Authenticated users can view event vehicles"
  ON event_vehicles FOR SELECT
  TO authenticated
  USING (true);

-- Pozwól zalogowanym użytkownikom na dodawanie pojazdów do eventów
CREATE POLICY "Authenticated users can insert event vehicles"
  ON event_vehicles FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Pozwól zalogowanym użytkownikom na aktualizację pojazdów w eventach
CREATE POLICY "Authenticated users can update event vehicles"
  ON event_vehicles FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Pozwól zalogowanym użytkownikom na usuwanie pojazdów z eventów
CREATE POLICY "Authenticated users can delete event vehicles"
  ON event_vehicles FOR DELETE
  TO authenticated
  USING (true);
