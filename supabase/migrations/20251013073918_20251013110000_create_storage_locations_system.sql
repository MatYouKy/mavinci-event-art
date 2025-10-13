/*
  # System lokalizacji magazynowych

  ## Nowe Tabele
  
  ### `storage_locations`
  - `id` (uuid, primary key)
  - `name` (text) - Nazwa lokalizacji np. "Magazyn główny", "Biuro"
  - `address` (text) - Szczegółowy adres
  - `access_info` (text) - Informacje o dostępie
  - `google_maps_url` (text) - Link do Google Maps
  - `notes` (text) - Dodatkowe notatki
  - `is_active` (boolean) - Czy lokalizacja jest aktywna
  - `created_at` (timestamptz)
  - `updated_at` (timestamptz)

  ## Zmiany
  - Zmieniamy kolumnę `location` w `equipment_units` na foreign key do `storage_locations`
  - Dodajemy nową kolumnę `location_id` zamiast text `location`

  ## Bezpieczeństwo
  - RLS włączony
  - Polityki dla uwierzytelnionych użytkowników
*/

-- Tworzenie tabeli lokalizacji
CREATE TABLE IF NOT EXISTS storage_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  address text,
  access_info text,
  google_maps_url text,
  notes text,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Dodaj nową kolumnę location_id do equipment_units
ALTER TABLE equipment_units
ADD COLUMN IF NOT EXISTS location_id uuid REFERENCES storage_locations(id);

-- Włącz RLS
ALTER TABLE storage_locations ENABLE ROW LEVEL SECURITY;

-- Polityki dla storage_locations
CREATE POLICY "Anyone can view active locations"
  ON storage_locations FOR SELECT
  USING (is_active = true OR auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can insert locations"
  ON storage_locations FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update locations"
  ON storage_locations FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can delete locations"
  ON storage_locations FOR DELETE
  TO authenticated
  USING (true);

-- Indeks dla wydajności
CREATE INDEX IF NOT EXISTS idx_storage_locations_active ON storage_locations(is_active);
CREATE INDEX IF NOT EXISTS idx_equipment_units_location ON equipment_units(location_id);

COMMENT ON TABLE storage_locations IS 'Lokalizacje magazynowe dla sprzętu';
COMMENT ON COLUMN equipment_units.location_id IS 'Referencja do lokalizacji magazynowej (zamiast text location)';