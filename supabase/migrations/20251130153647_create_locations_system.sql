/*
  # Create Locations System

  1. New Tables
    - `locations`
      - `id` (uuid, primary key)
      - `name` (text) - Nazwa lokalizacji
      - `address` (text) - Dokładny adres
      - `city` (text) - Miasto
      - `postal_code` (text) - Kod pocztowy
      - `country` (text) - Kraj, domyślnie Polska
      - `nip` (text) - NIP lokalizacji (jeśli firma)
      - `contact_person_name` (text) - Osoba kontaktowa w lokalizacji
      - `contact_phone` (text) - Telefon kontaktowy
      - `contact_email` (text) - Email kontaktowy
      - `notes` (text) - Dodatkowe notatki
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

  2. Security
    - Enable RLS on `locations` table
    - Add policies for authenticated users with permissions
*/

CREATE TABLE IF NOT EXISTS locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  address text,
  city text,
  postal_code text,
  country text DEFAULT 'Polska',
  nip text,
  contact_person_name text,
  contact_phone text,
  contact_email text,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE locations ENABLE ROW LEVEL SECURITY;

-- Policies for locations
CREATE POLICY "Users with locations_view can view locations"
  ON locations
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND (
        'locations_view' = ANY(employees.permissions)
        OR 'admin' = ANY(employees.permissions)
      )
    )
  );

CREATE POLICY "Users with locations_manage can insert locations"
  ON locations
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND (
        'locations_manage' = ANY(employees.permissions)
        OR 'admin' = ANY(employees.permissions)
      )
    )
  );

CREATE POLICY "Users with locations_manage can update locations"
  ON locations
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND (
        'locations_manage' = ANY(employees.permissions)
        OR 'admin' = ANY(employees.permissions)
      )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND (
        'locations_manage' = ANY(employees.permissions)
        OR 'admin' = ANY(employees.permissions)
      )
    )
  );

CREATE POLICY "Users with locations_manage can delete locations"
  ON locations
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND (
        'locations_manage' = ANY(employees.permissions)
        OR 'admin' = ANY(employees.permissions)
      )
    )
  );

-- Create index for faster searching by name
CREATE INDEX IF NOT EXISTS idx_locations_name ON locations(name);
CREATE INDEX IF NOT EXISTS idx_locations_city ON locations(city);

-- Trigger to update updated_at
CREATE OR REPLACE FUNCTION update_locations_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_locations_updated_at_trigger
  BEFORE UPDATE ON locations
  FOR EACH ROW
  EXECUTE FUNCTION update_locations_updated_at();

-- Add some sample locations
INSERT INTO locations (name, address, city, postal_code, contact_person_name, contact_phone) VALUES
('Hotel Marriott Warsaw', 'Al. Jerozolimskie 65/79', 'Warszawa', '00-697', 'Anna Kowalska', '+48 22 630 63 06'),
('Centrum Konferencyjne Golden Floor Tower', 'Chłodna 51', 'Warszawa', '00-867', 'Piotr Nowak', '+48 22 290 00 00'),
('Sala Kongresowa PKiN', 'Plac Defilad 1', 'Warszawa', '00-901', 'Katarzyna Wiśniewska', '+48 22 656 76 00'),
('Hotel Sheraton Grand Kraków', 'Powiśle 7', 'Kraków', '31-101', 'Marek Zieliński', '+48 12 662 10 00'),
('Stadion Narodowy', 'Al. Księcia Józefa Poniatowskiego 1', 'Warszawa', '03-901', 'Tomasz Lewandowski', '+48 22 295 95 95')
ON CONFLICT DO NOTHING;