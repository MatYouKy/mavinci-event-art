/*
  # System Pojedynczych Jednostek Sprzętu

  ## Opis
  Tabela do śledzenia każdej jednostki/sztuki sprzętu osobno z numerami seryjnymi

  ## Nowa Tabela

  ### `equipment_units`
  Pojedyncze sztuki sprzętu z numerami seryjnymi i statusem
  - `id` (uuid, primary key)
  - `equipment_id` (uuid) - foreign key do equipment_items
  - `unit_serial_number` (text, nullable) - numer seryjny jednostki (opcjonalny, np. przewody nie mają)
  - `status` (text) - available, in_use, reserved, damaged, in_service
  - `location` (text, nullable) - aktualna lokalizacja (u klienta, na firmie, w serwisie)
  - `condition_notes` (text, nullable) - notatki o stanie
  - `purchase_date` (date, nullable) - data zakupu tej jednostki
  - `last_service_date` (date, nullable) - ostatni serwis
  - `created_at` (timestamptz)
  - `updated_at` (timestamptz)

  ## Bezpieczeństwo
  - RLS włączony
  - Polityki dla authenticated users

  ## Notatki
  - Pozwala śledzić każdą jednostkę osobno
  - Numery seryjne są opcjonalne (przewody, kable nie potrzebują)
  - Status determinuje dostępność jednostki
*/

CREATE TABLE IF NOT EXISTS equipment_units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  equipment_id uuid NOT NULL REFERENCES equipment_items(id) ON DELETE CASCADE,
  unit_serial_number text,
  status text NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'in_use', 'reserved', 'damaged', 'in_service')),
  location text,
  condition_notes text,
  purchase_date date,
  last_service_date date,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_equipment_units_equipment_id ON equipment_units(equipment_id);
CREATE INDEX IF NOT EXISTS idx_equipment_units_status ON equipment_units(status);
CREATE INDEX IF NOT EXISTS idx_equipment_units_serial ON equipment_units(unit_serial_number) WHERE unit_serial_number IS NOT NULL;

CREATE OR REPLACE FUNCTION update_equipment_units_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_equipment_units_updated_at
  BEFORE UPDATE ON equipment_units
  FOR EACH ROW
  EXECUTE FUNCTION update_equipment_units_updated_at();

ALTER TABLE equipment_units ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow authenticated users to read equipment units"
  ON equipment_units
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Allow authenticated users to insert equipment units"
  ON equipment_units
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Allow authenticated users to update equipment units"
  ON equipment_units
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow authenticated users to delete equipment units"
  ON equipment_units
  FOR DELETE
  TO authenticated
  USING (true);

COMMENT ON TABLE equipment_units IS 'Pojedyncze jednostki/sztuki sprzętu z numerami seryjnymi';
COMMENT ON COLUMN equipment_units.unit_serial_number IS 'Numer seryjny jednostki - opcjonalny dla sprzętu bez numerów (przewody, kable)';
COMMENT ON COLUMN equipment_units.status IS 'Status jednostki: available, in_use, reserved, damaged, in_service';
COMMENT ON COLUMN equipment_units.location IS 'Aktualna lokalizacja jednostki';
