/*
  # System Zestawów Sprzętu (Equipment Kits)

  1. Nowe Tabele
    - `equipment_kits` - główna tabela zestawów
      - `id` (uuid, primary key)
      - `name` (text) - nazwa zestawu np. "Kablarka Standard 1"
      - `description` (text, nullable) - opis zestawu
      - `thumbnail_url` (text, nullable) - miniaturka zestawu
      - `is_active` (boolean) - czy zestaw jest aktywny
      - `created_by` (uuid) - kto stworzył zestaw
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

    - `equipment_kit_items` - pozycje w zestawie
      - `id` (uuid, primary key)
      - `kit_id` (uuid) - odniesienie do zestawu
      - `equipment_id` (uuid) - odniesienie do sprzętu
      - `quantity` (integer) - ilość w zestawie
      - `notes` (text, nullable) - notatki do pozycji
      - `order_index` (integer) - kolejność wyświetlania

  2. Security
    - RLS włączone dla wszystkich tabel
    - Użytkownicy authenticated mogą czytać, dodawać, edytować i usuwać zestawy

  3. Indexes
    - Indeksy na kit_id, equipment_id dla wydajności
*/

-- Tabela zestawów sprzętu
CREATE TABLE IF NOT EXISTS equipment_kits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  thumbnail_url text,
  is_active boolean DEFAULT true NOT NULL,
  created_by uuid REFERENCES employees(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_equipment_kits_active ON equipment_kits(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_equipment_kits_created_by ON equipment_kits(created_by);

-- Tabela pozycji w zestawach
CREATE TABLE IF NOT EXISTS equipment_kit_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kit_id uuid NOT NULL REFERENCES equipment_kits(id) ON DELETE CASCADE,
  equipment_id uuid NOT NULL REFERENCES equipment_items(id) ON DELETE CASCADE,
  quantity integer DEFAULT 1 NOT NULL CHECK (quantity > 0),
  notes text,
  order_index integer DEFAULT 0 NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_equipment_kit_items_kit_id ON equipment_kit_items(kit_id);
CREATE INDEX IF NOT EXISTS idx_equipment_kit_items_equipment_id ON equipment_kit_items(equipment_id);
CREATE INDEX IF NOT EXISTS idx_equipment_kit_items_order ON equipment_kit_items(kit_id, order_index);

-- Automatyczne aktualizowanie updated_at
CREATE OR REPLACE FUNCTION update_equipment_kit_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_equipment_kits_updated_at ON equipment_kits;
CREATE TRIGGER update_equipment_kits_updated_at
  BEFORE UPDATE ON equipment_kits
  FOR EACH ROW
  EXECUTE FUNCTION update_equipment_kit_timestamp();

-- RLS Policies
ALTER TABLE equipment_kits ENABLE ROW LEVEL SECURITY;
ALTER TABLE equipment_kit_items ENABLE ROW LEVEL SECURITY;

-- Equipment Kits policies
CREATE POLICY "Authenticated users can read equipment kits"
  ON equipment_kits FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert equipment kits"
  ON equipment_kits FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update equipment kits"
  ON equipment_kits FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can delete equipment kits"
  ON equipment_kits FOR DELETE
  TO authenticated
  USING (true);

-- Equipment Kit Items policies
CREATE POLICY "Authenticated users can read equipment kit items"
  ON equipment_kit_items FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert equipment kit items"
  ON equipment_kit_items FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update equipment kit items"
  ON equipment_kit_items FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can delete equipment kit items"
  ON equipment_kit_items FOR DELETE
  TO authenticated
  USING (true);

-- Komentarze
COMMENT ON TABLE equipment_kits IS 'Zestawy sprzętu - np. Kablarka Standard 1, Zestaw Oświetleniowy Basic';
COMMENT ON COLUMN equipment_kits.name IS 'Nazwa zestawu';
COMMENT ON COLUMN equipment_kits.is_active IS 'Czy zestaw jest aktywny i dostępny do użycia';
COMMENT ON TABLE equipment_kit_items IS 'Pozycje w zestawie - sprzęt i ilości';
COMMENT ON COLUMN equipment_kit_items.quantity IS 'Ilość danego sprzętu w zestawie';
COMMENT ON COLUMN equipment_kit_items.order_index IS 'Kolejność wyświetlania w zestawie';
