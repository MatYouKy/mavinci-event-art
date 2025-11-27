/*
  # Create editable sections for conferences page

  1. New Tables
    - `conferences_gallery` - Gallery images with title/caption
      - `id` (uuid, primary key)
      - `image_url` (text)
      - `alt_text` (text)
      - `title` (text, optional)
      - `caption` (text, optional)
      - `display_order` (integer)
      - `is_active` (boolean)
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

    - `conferences_packages` - Conference packages with ratings
      - `id` (uuid, primary key)
      - `package_name` (text)
      - `package_level` (text) - basic, standard, pro
      - `target_audience` (text)
      - `description` (text)
      - `price_info` (text)
      - `features` (jsonb) - {category: [items]}
      - `rating` (integer) - 1, 2, or 3 stars
      - `display_order` (integer)
      - `is_active` (boolean)
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

  2. Security
    - Enable RLS on all tables
    - Public can read active items
    - Anyone can insert/update/delete (for edit mode)
*/

-- Gallery table
CREATE TABLE IF NOT EXISTS conferences_gallery (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  image_url text NOT NULL,
  alt_text text,
  title text,
  caption text,
  display_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Packages table
CREATE TABLE IF NOT EXISTS conferences_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_name text NOT NULL,
  package_level text NOT NULL CHECK (package_level IN ('basic', 'standard', 'pro')),
  target_audience text,
  description text,
  price_info text,
  features jsonb NOT NULL DEFAULT '{}'::jsonb,
  rating integer CHECK (rating >= 1 AND rating <= 3),
  display_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Update timestamps trigger function
CREATE OR REPLACE FUNCTION update_conferences_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Add triggers
CREATE TRIGGER update_conferences_gallery_updated_at
  BEFORE UPDATE ON conferences_gallery
  FOR EACH ROW
  EXECUTE FUNCTION update_conferences_updated_at();

CREATE TRIGGER update_conferences_packages_updated_at
  BEFORE UPDATE ON conferences_packages
  FOR EACH ROW
  EXECUTE FUNCTION update_conferences_updated_at();

-- Enable RLS
ALTER TABLE conferences_gallery ENABLE ROW LEVEL SECURITY;
ALTER TABLE conferences_packages ENABLE ROW LEVEL SECURITY;

-- Gallery policies
CREATE POLICY "Anyone can view active gallery items"
  ON conferences_gallery
  FOR SELECT
  USING (is_active = true);

CREATE POLICY "Anyone can insert gallery items"
  ON conferences_gallery
  FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Anyone can update gallery items"
  ON conferences_gallery
  FOR UPDATE
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Anyone can delete gallery items"
  ON conferences_gallery
  FOR DELETE
  USING (true);

-- Packages policies
CREATE POLICY "Anyone can view active packages"
  ON conferences_packages
  FOR SELECT
  USING (is_active = true);

CREATE POLICY "Anyone can insert packages"
  ON conferences_packages
  FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Anyone can update packages"
  ON conferences_packages
  FOR UPDATE
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Anyone can delete packages"
  ON conferences_packages
  FOR DELETE
  USING (true);

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE conferences_gallery;
ALTER PUBLICATION supabase_realtime ADD TABLE conferences_packages;

-- Insert sample gallery data
INSERT INTO conferences_gallery (image_url, alt_text, title, caption, display_order) VALUES
  ('https://images.pexels.com/photos/2774556/pexels-photo-2774556.jpeg', 'Konferencja biznesowa', 'Konferencja Tech Summit 2024', 'Obsługa techniczna 500+ uczestników', 1),
  ('https://images.pexels.com/photos/2608517/pexels-photo-2608517.jpeg', 'Prelegent na scenie', 'Forum Innowacji', 'Profesjonalne nagłośnienie i oświetlenie', 2),
  ('https://images.pexels.com/photos/2774570/pexels-photo-2774570.jpeg', 'Panel dyskusyjny', 'Panel Ekspercki 2024', 'Rejestracja video i transmisja online', 3),
  ('https://images.pexels.com/photos/1181406/pexels-photo-1181406.jpeg', 'Sala konferencyjna', 'Kongres Ekonomiczny', 'Kompleksowa obsługa audio-video', 4);

-- Insert sample packages
INSERT INTO conferences_packages (
  package_name, package_level, target_audience, description, price_info, features, rating, display_order
) VALUES
  (
    'Pakiet Start',
    'basic',
    'Do 50 uczestników',
    'Idealny dla małych spotkań biznesowych, warsztatów i prezentacji firmowych.',
    'od 2500 zł',
    '{
      "Audio": ["Mikrofony bezprzewodowe (2 szt.)", "Nagłośnienie sali", "Mikser audio"],
      "Video": ["Projektor Full HD", "Ekran projekcyjny 3m", "Laptop do prezentacji"],
      "Oświetlenie": ["Podstawowe oświetlenie sceniczne"]
    }'::jsonb,
    1,
    1
  ),
  (
    'Pakiet Standard',
    'standard',
    'Do 150 uczestników',
    'Kompleksowe rozwiązanie dla konferencji, seminariów i eventów firmowych średniej wielkości.',
    'od 5500 zł',
    '{
      "Audio": ["Mikrofony bezprzewodowe (4 szt.)", "System nagłośnienia stereo", "Mikser cyfrowy", "Monitory sceniczne"],
      "Video": ["Projektor 4K", "Ekran panoramiczny 5m", "Kamera Full HD", "Transmisja na żywo"],
      "Oświetlenie": ["Profesjonalne oświetlenie LED", "Reflektor śledzący prelegenta", "Kolorowe podświetlenie sceny"]
    }'::jsonb,
    2,
    2
  ),
  (
    'Pakiet Premium',
    'pro',
    '150+ uczestników',
    'Najwyższej klasy obsługa techniczna dla dużych konferencji, kongresów i gal. Pełna personalizacja i wsparcie techniczne 24/7.',
    'od 12000 zł',
    '{
      "Audio": ["Mikrofony bezprzewodowe (8+ szt.)", "System line array", "Cyfrowa konsola audio", "Monitory in-ear dla prelegentów", "System konferencyjny"],
      "Video": ["Projektor laserowy 4K", "Ekran LED modułowy", "Rejestracja multi-kamerowa 4K", "Live streaming w wysokiej jakości", "System do videokonferencji"],
      "Oświetlenie": ["Inteligentne głowice ruchome", "System LED RGB", "Efekty specjalne", "Pilot oświetlenia DMX"],
      "Dodatki": ["Tłumaczenia symultaniczne", "System głosowania", "Dedykowany realizator", "Backup sprzętowy"]
    }'::jsonb,
    3,
    3
  );
