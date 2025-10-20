/*
  # Rozszerzenie systemu transportu o przyczepki

  1. Zmiany w tabeli event_vehicles
    - `has_trailer` - czy pojazd ma przyczepkę
    - `trailer_vehicle_id` - ID przyczepki z własnej floty (FK do vehicles)
    - `is_trailer_external` - czy przyczepka jest zewnętrzna (wypożyczona)
    - `external_trailer_name` - nazwa zewnętrznej przyczepki
    - `external_trailer_company` - firma wypożyczająca
    - `external_trailer_rental_cost` - koszt wypożyczenia
    - `external_trailer_return_date` - termin zwrotu
    - `external_trailer_return_location` - miejsce zwrotu
    - `external_trailer_notes` - dodatkowe notatki

  2. Zabezpieczenia
    - Aktualizacja RLS - creator, admin i współpracownicy mogą edytować
    - Wykorzystanie tabeli employee_assignments z kolumną status
*/

-- Dodaj kolumny dla przyczepek do event_vehicles
ALTER TABLE event_vehicles 
  ADD COLUMN IF NOT EXISTS has_trailer boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS trailer_vehicle_id uuid REFERENCES vehicles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_trailer_external boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS external_trailer_name text,
  ADD COLUMN IF NOT EXISTS external_trailer_company text,
  ADD COLUMN IF NOT EXISTS external_trailer_rental_cost numeric(10,2),
  ADD COLUMN IF NOT EXISTS external_trailer_return_date timestamptz,
  ADD COLUMN IF NOT EXISTS external_trailer_return_location text,
  ADD COLUMN IF NOT EXISTS external_trailer_notes text;

-- Aktualizuj RLS policies dla event_vehicles
-- Usuń stare policies
DROP POLICY IF EXISTS "Authenticated users can view event vehicles" ON event_vehicles;
DROP POLICY IF EXISTS "Users with equipment_manage can manage event vehicles" ON event_vehicles;

-- Nowe policies z dostępem dla creatora, admina i współpracowników
CREATE POLICY "Authenticated users can view event vehicles"
  ON event_vehicles FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Creator, admin and collaborators can insert event vehicles"
  ON event_vehicles FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM events e
      WHERE e.id = event_id
      AND (
        e.created_by = auth.uid()
        OR EXISTS (
          SELECT 1 FROM employees
          WHERE id = auth.uid()
          AND 'events_manage' = ANY(permissions)
        )
        OR EXISTS (
          SELECT 1 FROM employee_assignments ea
          WHERE ea.event_id = e.id
          AND ea.employee_id = auth.uid()
          AND ea.status = 'accepted'
        )
      )
    )
  );

CREATE POLICY "Creator, admin and collaborators can update event vehicles"
  ON event_vehicles FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM events e
      WHERE e.id = event_id
      AND (
        e.created_by = auth.uid()
        OR EXISTS (
          SELECT 1 FROM employees
          WHERE id = auth.uid()
          AND 'events_manage' = ANY(permissions)
        )
        OR EXISTS (
          SELECT 1 FROM employee_assignments ea
          WHERE ea.event_id = e.id
          AND ea.employee_id = auth.uid()
          AND ea.status = 'accepted'
        )
      )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM events e
      WHERE e.id = event_id
      AND (
        e.created_by = auth.uid()
        OR EXISTS (
          SELECT 1 FROM employees
          WHERE id = auth.uid()
          AND 'events_manage' = ANY(permissions)
        )
        OR EXISTS (
          SELECT 1 FROM employee_assignments ea
          WHERE ea.event_id = e.id
          AND ea.employee_id = auth.uid()
          AND ea.status = 'accepted'
        )
      )
    )
  );

CREATE POLICY "Creator, admin and collaborators can delete event vehicles"
  ON event_vehicles FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM events e
      WHERE e.id = event_id
      AND (
        e.created_by = auth.uid()
        OR EXISTS (
          SELECT 1 FROM employees
          WHERE id = auth.uid()
          AND 'events_manage' = ANY(permissions)
        )
        OR EXISTS (
          SELECT 1 FROM employee_assignments ea
          WHERE ea.event_id = e.id
          AND ea.employee_id = auth.uid()
          AND ea.status = 'accepted'
        )
      )
    )
  );