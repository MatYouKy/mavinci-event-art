/*
  # Utworzenie systemu zarządzania kablami

  ## Opis
  Tworzy oddzielną tabelę `cables` do zarządzania przewodami, oddzielnie od sprzętu.
  
  ## Nowe tabele
  
  ### `cables`
  Główna tabela dla kabli/przewodów:
  - `id` (uuid, primary key)
  - `name` (text) - nazwa kabla
  - `warehouse_category_id` (uuid) - kategoria magazynowa (FK do warehouse_categories)
  - `storage_location_id` (uuid) - lokalizacja przechowywania
  - `thumbnail_url` (text) - miniatura
  - `description` (text) - opis
  - `length_meters` (numeric) - długość w metrach
  - `connector_in` (uuid) - złącze wejściowe (FK do connector_types)
  - `connector_out` (uuid) - złącze wyjściowe (FK do connector_types)
  - `stock_quantity` (integer) - ilość w magazynie
  - `purchase_date` (date) - data zakupu
  - `purchase_price` (numeric) - cena zakupu
  - `current_value` (numeric) - aktualna wartość
  - `notes` (text) - notatki
  - `is_active` (boolean) - czy aktywny
  - `created_at`, `updated_at`, `deleted_at` - znaczniki czasowe
  
  ### `cable_units`
  Jednostki kabli (pojedyncze przewody):
  - `id` (uuid, primary key)
  - `cable_id` (uuid) - FK do cables
  - `serial_number` (text) - numer seryjny/kod
  - `status` (enum) - status jednostki
  - `storage_location_id` (uuid) - lokalizacja
  - `condition_notes` (text) - notatki o stanie
  - `last_inspection_date` (date) - data ostatniej inspekcji
  - `created_at`, `updated_at`
  
  ### `equipment_kit_cables`
  Powiązanie kabli z zestawami:
  - `id` (uuid, primary key)
  - `kit_id` (uuid) - FK do equipment_kits
  - `cable_id` (uuid) - FK do cables
  - `quantity` (integer) - ilość kabli w zestawie
  - `notes` (text) - notatki
  - `created_at`
  
  ## Bezpieczeństwo
  - RLS włączone na wszystkich tabelach
  - Uprawnienia dla zalogowanych użytkowników z odpowiednimi permissions
*/

-- Tworzenie tabeli cables
CREATE TABLE IF NOT EXISTS cables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  warehouse_category_id uuid REFERENCES warehouse_categories(id) ON DELETE SET NULL,
  storage_location_id uuid REFERENCES storage_locations(id) ON DELETE SET NULL,
  thumbnail_url text,
  description text,
  length_meters numeric(10,2),
  connector_in uuid REFERENCES connector_types(id) ON DELETE SET NULL,
  connector_out uuid REFERENCES connector_types(id) ON DELETE SET NULL,
  stock_quantity integer DEFAULT 0,
  purchase_date date,
  purchase_price numeric(12,2),
  current_value numeric(12,2),
  notes text,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  deleted_at timestamptz
);

-- Tworzenie tabeli cable_units
CREATE TABLE IF NOT EXISTS cable_units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cable_id uuid NOT NULL REFERENCES cables(id) ON DELETE CASCADE,
  serial_number text,
  status text DEFAULT 'available' CHECK (status IN ('available', 'in_use', 'damaged', 'in_service', 'retired')),
  storage_location_id uuid REFERENCES storage_locations(id) ON DELETE SET NULL,
  condition_notes text,
  last_inspection_date date,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Tworzenie tabeli equipment_kit_cables (kabele w zestawach)
CREATE TABLE IF NOT EXISTS equipment_kit_cables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kit_id uuid NOT NULL REFERENCES equipment_kits(id) ON DELETE CASCADE,
  cable_id uuid NOT NULL REFERENCES cables(id) ON DELETE CASCADE,
  quantity integer DEFAULT 1 CHECK (quantity > 0),
  notes text,
  created_at timestamptz DEFAULT now(),
  UNIQUE(kit_id, cable_id)
);

-- Indeksy dla lepszej wydajności
CREATE INDEX IF NOT EXISTS idx_cables_warehouse_category ON cables(warehouse_category_id);
CREATE INDEX IF NOT EXISTS idx_cables_storage_location ON cables(storage_location_id);
CREATE INDEX IF NOT EXISTS idx_cables_is_active ON cables(is_active);
CREATE INDEX IF NOT EXISTS idx_cables_deleted_at ON cables(deleted_at);

CREATE INDEX IF NOT EXISTS idx_cable_units_cable ON cable_units(cable_id);
CREATE INDEX IF NOT EXISTS idx_cable_units_status ON cable_units(status);
CREATE INDEX IF NOT EXISTS idx_cable_units_storage_location ON cable_units(storage_location_id);

CREATE INDEX IF NOT EXISTS idx_equipment_kit_cables_kit ON equipment_kit_cables(kit_id);
CREATE INDEX IF NOT EXISTS idx_equipment_kit_cables_cable ON equipment_kit_cables(cable_id);

-- Włączenie RLS
ALTER TABLE cables ENABLE ROW LEVEL SECURITY;
ALTER TABLE cable_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE equipment_kit_cables ENABLE ROW LEVEL SECURITY;

-- Polityki RLS dla cables
CREATE POLICY "Allow authenticated users to view active cables"
  ON cables FOR SELECT
  TO authenticated
  USING (is_active = true AND deleted_at IS NULL);

CREATE POLICY "Allow users with equipment:manage to insert cables"
  ON cables FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'equipment:manage' = ANY(employees.permissions)
    )
  );

CREATE POLICY "Allow users with equipment:manage to update cables"
  ON cables FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'equipment:manage' = ANY(employees.permissions)
    )
  );

CREATE POLICY "Allow users with equipment:manage to delete cables"
  ON cables FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'equipment:manage' = ANY(employees.permissions)
    )
  );

-- Polityki RLS dla cable_units
CREATE POLICY "Allow authenticated users to view cable units"
  ON cable_units FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Allow users with equipment:manage to manage cable units"
  ON cable_units FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'equipment:manage' = ANY(employees.permissions)
    )
  );

-- Polityki RLS dla equipment_kit_cables
CREATE POLICY "Allow authenticated users to view kit cables"
  ON equipment_kit_cables FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Allow users with equipment:manage to manage kit cables"
  ON equipment_kit_cables FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'equipment:manage' = ANY(employees.permissions)
    )
  );

-- Trigger do automatycznej aktualizacji updated_at dla cables
CREATE OR REPLACE FUNCTION update_cables_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_cables_updated_at
  BEFORE UPDATE ON cables
  FOR EACH ROW
  EXECUTE FUNCTION update_cables_updated_at();

-- Trigger do automatycznej aktualizacji updated_at dla cable_units
CREATE OR REPLACE FUNCTION update_cable_units_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_cable_units_updated_at
  BEFORE UPDATE ON cable_units
  FOR EACH ROW
  EXECUTE FUNCTION update_cable_units_updated_at();
