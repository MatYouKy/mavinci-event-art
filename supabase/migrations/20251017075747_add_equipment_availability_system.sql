/*
  # System Dostępności Sprzętu dla Wydarzeń
  
  ## Opis
  Dodaje tabele i funkcje do zarządzania rezerwacjami jednostek sprzętu
  oraz sprawdzania dostępności w danym terminie.
  
  ## Nowe Tabele
  
  ### `event_equipment_units`
  Tabela łącząca konkretne jednostki sprzętu z wydarzeniami
  - `id` (uuid, primary key)
  - `event_equipment_id` (uuid) - foreign key do event_equipment
  - `equipment_unit_id` (uuid) - foreign key do equipment_units
  - `created_at` (timestamptz)
  
  ## Nowe Funkcje
  
  ### `get_available_equipment_count(equipment_id, event_date)`
  Zwraca liczbę dostępnych jednostek dla danego sprzętu w określonym terminie
  
  ### `get_event_equipment_with_availability(event_id)`
  Zwraca sprzęt wydarzenia z informacją o dostępności
  
  ## Bezpieczeństwo
  - RLS włączony dla nowych tabel
  - Polityki dla authenticated users z uprawnieniami equipment:view
  
  ## Notatki
  - System rezerwacji jednostek pozwala na dokładne śledzenie dostępności
  - Funkcja sprawdza konflikty z innymi wydarzeniami w tym samym dniu
*/

-- Tabela rezerwacji jednostek dla wydarzeń
CREATE TABLE IF NOT EXISTS event_equipment_units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_equipment_id uuid NOT NULL REFERENCES event_equipment(id) ON DELETE CASCADE,
  equipment_unit_id uuid NOT NULL REFERENCES equipment_units(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now() NOT NULL,
  UNIQUE(event_equipment_id, equipment_unit_id)
);

CREATE INDEX IF NOT EXISTS idx_event_equipment_units_event_equipment_id 
  ON event_equipment_units(event_equipment_id);
CREATE INDEX IF NOT EXISTS idx_event_equipment_units_equipment_unit_id 
  ON event_equipment_units(equipment_unit_id);

-- Funkcja zwracająca liczbę dostępnych jednostek dla danego sprzętu w danym terminie
CREATE OR REPLACE FUNCTION get_available_equipment_count(
  p_equipment_id uuid,
  p_event_date timestamptz,
  p_exclude_event_id uuid DEFAULT NULL
)
RETURNS integer AS $$
DECLARE
  v_total_count integer;
  v_reserved_count integer;
BEGIN
  -- Zlicz wszystkie jednostki o statusie 'available'
  SELECT COUNT(*)
  INTO v_total_count
  FROM equipment_units
  WHERE equipment_id = p_equipment_id
    AND status = 'available';
  
  -- Zlicz zarezerwowane jednostki w tym dniu (z wyłączeniem bieżącego wydarzenia)
  SELECT COUNT(DISTINCT eeu.equipment_unit_id)
  INTO v_reserved_count
  FROM event_equipment_units eeu
  JOIN event_equipment ee ON eeu.event_equipment_id = ee.id
  JOIN events e ON ee.event_id = e.id
  WHERE ee.equipment_id = p_equipment_id
    AND DATE(e.event_date) = DATE(p_event_date)
    AND (p_exclude_event_id IS NULL OR e.id != p_exclude_event_id);
  
  -- Zwróć różnicę
  RETURN GREATEST(0, v_total_count - COALESCE(v_reserved_count, 0));
END;
$$ LANGUAGE plpgsql STABLE;

-- Funkcja zwracająca sprzęt z dostępnością dla wydarzenia
CREATE OR REPLACE FUNCTION get_event_equipment_with_availability(p_event_id uuid)
RETURNS TABLE (
  equipment_id uuid,
  equipment_name text,
  requested_quantity integer,
  available_quantity integer,
  reserved_units_count integer
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    ee.equipment_id,
    ei.name,
    ee.quantity,
    get_available_equipment_count(ee.equipment_id, e.event_date, e.id) as available_quantity,
    (SELECT COUNT(*) FROM event_equipment_units eeu WHERE eeu.event_equipment_id = ee.id)::integer as reserved_units_count
  FROM event_equipment ee
  JOIN equipment_items ei ON ee.equipment_id = ei.id
  JOIN events e ON ee.event_id = e.id
  WHERE ee.event_id = p_event_id
    AND ee.equipment_id IS NOT NULL;
END;
$$ LANGUAGE plpgsql STABLE;

-- RLS dla event_equipment_units
ALTER TABLE event_equipment_units ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow authenticated users to read event equipment units"
  ON event_equipment_units
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Allow users with equipment:manage to insert event equipment units"
  ON event_equipment_units
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
        AND 'equipment:manage' = ANY(employees.permissions)
    )
  );

CREATE POLICY "Allow users with equipment:manage to delete event equipment units"
  ON event_equipment_units
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
        AND 'equipment:manage' = ANY(employees.permissions)
    )
  );