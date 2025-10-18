/*
  # System logistyki wydarzeń

  1. Nowe tabele
    - `event_vehicles` - przypisanie pojazdów do wydarzeń
      - `id` (uuid, primary key)
      - `event_id` (uuid, foreign key)
      - `vehicle_id` (uuid, foreign key)
      - `role` (text) - rola pojazdu: transport_equipment, transport_crew, support
      - `driver_id` (uuid) - ID pracownika kierowcy
      - `departure_location` (text) - miejsce wyjazdu
      - `departure_time` (timestamptz) - planowany czas wyjazdu
      - `arrival_time` (timestamptz) - planowany czas przyjazdu
      - `return_departure_time` (timestamptz) - czas wyjazdu z powrotem
      - `return_arrival_time` (timestamptz) - czas przyjazdu z powrotem
      - `estimated_distance_km` (numeric) - szacowana odległość
      - `actual_distance_km` (numeric) - rzeczywista odległość
      - `fuel_cost_estimate` (numeric) - szacowany koszt paliwa
      - `toll_cost_estimate` (numeric) - szacowany koszt autostrad
      - `notes` (text)
      - `status` (text) - planned, in_transit, arrived, returning, completed, cancelled
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

    - `event_logistics_timeline` - harmonogram logistyczny
      - `id` (uuid, primary key)
      - `event_id` (uuid, foreign key)
      - `activity_type` (text) - loading, unloading, setup, rehearsal, event, breakdown, packing
      - `title` (text) - tytuł czynności
      - `description` (text) - opis
      - `location` (text) - miejsce wykonania
      - `start_time` (timestamptz) - czas rozpoczęcia
      - `end_time` (timestamptz) - czas zakończenia
      - `duration_minutes` (integer) - planowany czas trwania
      - `responsible_employee_id` (uuid) - odpowiedzialny pracownik
      - `required_crew_count` (integer) - wymagana liczba pracowników
      - `assigned_vehicle_id` (uuid) - przypisany pojazd
      - `status` (text) - pending, in_progress, completed, delayed, cancelled
      - `completion_notes` (text)
      - `actual_start_time` (timestamptz)
      - `actual_end_time` (timestamptz)
      - `sort_order` (integer)
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

    - `event_routes` - trasy i szacowanie kosztów
      - `id` (uuid, primary key)
      - `event_vehicle_id` (uuid, foreign key)
      - `route_type` (text) - outbound (tam), return (powrót)
      - `start_address` (text)
      - `end_address` (text)
      - `waypoints` (jsonb) - pośrednie punkty trasy
      - `estimated_distance_km` (numeric)
      - `estimated_duration_minutes` (integer)
      - `estimated_fuel_cost` (numeric)
      - `estimated_toll_cost` (numeric)
      - `actual_distance_km` (numeric)
      - `actual_duration_minutes` (integer)
      - `actual_fuel_cost` (numeric)
      - `actual_toll_cost` (numeric)
      - `route_notes` (text)
      - `traffic_conditions` (text)
      - `weather_conditions` (text)
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

    - `event_loading_checklist` - lista sprawdzająca załadunku
      - `id` (uuid, primary key)
      - `event_id` (uuid, foreign key)
      - `vehicle_id` (uuid, foreign key)
      - `checklist_type` (text) - loading, unloading
      - `item_name` (text)
      - `quantity` (integer)
      - `weight_kg` (numeric)
      - `volume_m3` (numeric)
      - `fragile` (boolean)
      - `priority` (text) - high, medium, low
      - `loaded` (boolean)
      - `loaded_by` (uuid) - ID pracownika
      - `loaded_at` (timestamptz)
      - `unloaded` (boolean)
      - `unloaded_by` (uuid)
      - `unloaded_at` (timestamptz)
      - `notes` (text)
      - `sort_order` (integer)
      - `created_at` (timestamptz)

  2. Security
    - Enable RLS dla wszystkich tabel
    - Pracownicy z uprawnieniem events_view mogą czytać
    - Pracownicy z uprawnieniem events_manage mogą zarządzać
*/

-- Tabela przypisania pojazdów do wydarzeń
CREATE TABLE IF NOT EXISTS event_vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  vehicle_id uuid NOT NULL REFERENCES vehicles(id) ON DELETE RESTRICT,
  role text NOT NULL DEFAULT 'transport_equipment',
  driver_id uuid REFERENCES employees(id) ON DELETE SET NULL,
  departure_location text,
  departure_time timestamptz,
  arrival_time timestamptz,
  return_departure_time timestamptz,
  return_arrival_time timestamptz,
  estimated_distance_km numeric(10,2),
  actual_distance_km numeric(10,2),
  fuel_cost_estimate numeric(10,2),
  toll_cost_estimate numeric(10,2),
  notes text,
  status text DEFAULT 'planned' CHECK (status IN ('planned', 'in_transit', 'arrived', 'returning', 'completed', 'cancelled')),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(event_id, vehicle_id)
);

-- Tabela harmonogramu logistycznego
CREATE TABLE IF NOT EXISTS event_logistics_timeline (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  activity_type text NOT NULL CHECK (activity_type IN ('loading', 'unloading', 'setup', 'rehearsal', 'event', 'breakdown', 'packing')),
  title text NOT NULL,
  description text,
  location text,
  start_time timestamptz,
  end_time timestamptz,
  duration_minutes integer,
  responsible_employee_id uuid REFERENCES employees(id) ON DELETE SET NULL,
  required_crew_count integer DEFAULT 1,
  assigned_vehicle_id uuid REFERENCES event_vehicles(id) ON DELETE SET NULL,
  status text DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'delayed', 'cancelled')),
  completion_notes text,
  actual_start_time timestamptz,
  actual_end_time timestamptz,
  sort_order integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Tabela tras
CREATE TABLE IF NOT EXISTS event_routes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_vehicle_id uuid NOT NULL REFERENCES event_vehicles(id) ON DELETE CASCADE,
  route_type text NOT NULL CHECK (route_type IN ('outbound', 'return')),
  start_address text NOT NULL,
  end_address text NOT NULL,
  waypoints jsonb DEFAULT '[]'::jsonb,
  estimated_distance_km numeric(10,2),
  estimated_duration_minutes integer,
  estimated_fuel_cost numeric(10,2),
  estimated_toll_cost numeric(10,2),
  actual_distance_km numeric(10,2),
  actual_duration_minutes integer,
  actual_fuel_cost numeric(10,2),
  actual_toll_cost numeric(10,2),
  route_notes text,
  traffic_conditions text,
  weather_conditions text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(event_vehicle_id, route_type)
);

-- Tabela listy załadunkowej
CREATE TABLE IF NOT EXISTS event_loading_checklist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  vehicle_id uuid REFERENCES vehicles(id) ON DELETE SET NULL,
  checklist_type text NOT NULL CHECK (checklist_type IN ('loading', 'unloading')),
  item_name text NOT NULL,
  quantity integer DEFAULT 1,
  weight_kg numeric(10,2),
  volume_m3 numeric(10,3),
  fragile boolean DEFAULT false,
  priority text DEFAULT 'medium' CHECK (priority IN ('high', 'medium', 'low')),
  loaded boolean DEFAULT false,
  loaded_by uuid REFERENCES employees(id) ON DELETE SET NULL,
  loaded_at timestamptz,
  unloaded boolean DEFAULT false,
  unloaded_by uuid REFERENCES employees(id) ON DELETE SET NULL,
  unloaded_at timestamptz,
  notes text,
  sort_order integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

-- Indeksy
CREATE INDEX IF NOT EXISTS idx_event_vehicles_event ON event_vehicles(event_id);
CREATE INDEX IF NOT EXISTS idx_event_vehicles_vehicle ON event_vehicles(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_event_vehicles_driver ON event_vehicles(driver_id);
CREATE INDEX IF NOT EXISTS idx_event_vehicles_status ON event_vehicles(status);

CREATE INDEX IF NOT EXISTS idx_event_logistics_event ON event_logistics_timeline(event_id);
CREATE INDEX IF NOT EXISTS idx_event_logistics_employee ON event_logistics_timeline(responsible_employee_id);
CREATE INDEX IF NOT EXISTS idx_event_logistics_status ON event_logistics_timeline(status);
CREATE INDEX IF NOT EXISTS idx_event_logistics_time ON event_logistics_timeline(start_time);

CREATE INDEX IF NOT EXISTS idx_event_routes_vehicle ON event_routes(event_vehicle_id);
CREATE INDEX IF NOT EXISTS idx_event_routes_type ON event_routes(route_type);

CREATE INDEX IF NOT EXISTS idx_event_loading_event ON event_loading_checklist(event_id);
CREATE INDEX IF NOT EXISTS idx_event_loading_vehicle ON event_loading_checklist(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_event_loading_type ON event_loading_checklist(checklist_type);

-- Enable RLS
ALTER TABLE event_vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_logistics_timeline ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_routes ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_loading_checklist ENABLE ROW LEVEL SECURITY;

-- RLS Policies dla event_vehicles
CREATE POLICY "Employees can view event vehicles"
  ON event_vehicles FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'events_view' = ANY(employees.permissions)
    )
  );

CREATE POLICY "Employees can manage event vehicles"
  ON event_vehicles FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'events_manage' = ANY(employees.permissions)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'events_manage' = ANY(employees.permissions)
    )
  );

-- RLS Policies dla event_logistics_timeline
CREATE POLICY "Employees can view logistics timeline"
  ON event_logistics_timeline FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'events_view' = ANY(employees.permissions)
    )
  );

CREATE POLICY "Employees can manage logistics timeline"
  ON event_logistics_timeline FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'events_manage' = ANY(employees.permissions)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'events_manage' = ANY(employees.permissions)
    )
  );

-- RLS Policies dla event_routes
CREATE POLICY "Employees can view event routes"
  ON event_routes FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'events_view' = ANY(employees.permissions)
    )
  );

CREATE POLICY "Employees can manage event routes"
  ON event_routes FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'events_manage' = ANY(employees.permissions)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'events_manage' = ANY(employees.permissions)
    )
  );

-- RLS Policies dla event_loading_checklist
CREATE POLICY "Employees can view loading checklist"
  ON event_loading_checklist FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'events_view' = ANY(employees.permissions)
    )
  );

CREATE POLICY "Employees can manage loading checklist"
  ON event_loading_checklist FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'events_manage' = ANY(employees.permissions)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'events_manage' = ANY(employees.permissions)
    )
  );

-- Funkcje pomocnicze
CREATE OR REPLACE FUNCTION calculate_total_logistics_cost(p_event_id uuid)
RETURNS numeric AS $$
  SELECT COALESCE(SUM(
    COALESCE(fuel_cost_estimate, 0) + 
    COALESCE(toll_cost_estimate, 0)
  ), 0)
  FROM event_vehicles
  WHERE event_id = p_event_id;
$$ LANGUAGE sql STABLE;

-- Trigger do aktualizacji updated_at
CREATE OR REPLACE FUNCTION update_event_logistics_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER event_vehicles_updated_at
  BEFORE UPDATE ON event_vehicles
  FOR EACH ROW
  EXECUTE FUNCTION update_event_logistics_updated_at();

CREATE TRIGGER event_logistics_timeline_updated_at
  BEFORE UPDATE ON event_logistics_timeline
  FOR EACH ROW
  EXECUTE FUNCTION update_event_logistics_updated_at();

CREATE TRIGGER event_routes_updated_at
  BEFORE UPDATE ON event_routes
  FOR EACH ROW
  EXECUTE FUNCTION update_event_logistics_updated_at();
