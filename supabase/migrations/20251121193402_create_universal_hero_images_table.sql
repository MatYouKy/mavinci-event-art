/*
  # Uniwersalna tabela dla Hero Images wszystkich usług

  ## Opis
  Zamiast tworzyć osobne tabele dla każdej usługi (np. uslugi_streaming_page_images),
  używamy jednej uniwersalnej tabeli `service_hero_images` która obsługuje wszystkie usługi.

  ## Struktura
  1. Nowa tabela `service_hero_images`:
     - `id` (uuid, primary key)
     - `page_slug` (text, unique) - pełny slug strony (np. 'uslugi/streaming', 'uslugi/naglosnienie')
     - `section` (text) - nazwa sekcji (np. 'streaming-hero', 'naglosnienie-hero')
     - `name` (text) - nazwa wyświetlana
     - `description` (text) - opis
     - `image_url` (text) - URL głównego obrazu
     - `alt_text` (text) - tekst alternatywny
     - `opacity` (numeric) - przezroczystość overlay (0-1)
     - `image_metadata` (jsonb) - metadata z pozycjami desktop/mobile
     - `title` (text) - tytuł hero sekcji
     - `subtitle` (text) - podtytuł
     - `button_text` (text) - tekst przycisku CTA
     - `is_active` (boolean) - czy aktywna
     - `created_at` (timestamptz)
     - `updated_at` (timestamptz)

  2. Security
     - Enable RLS
     - Public SELECT
     - Admin/WebsiteEdit UPDATE, INSERT, DELETE

  3. Indeksy
     - page_slug (unique)
     - section
     - is_active
*/

-- Tworzenie tabeli
CREATE TABLE IF NOT EXISTS service_hero_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  page_slug text NOT NULL UNIQUE,
  section text NOT NULL,
  name text,
  description text,
  image_url text,
  alt_text text,
  opacity numeric DEFAULT 0.2,
  image_metadata jsonb DEFAULT '{"desktop": {"position": {"posX": 0, "posY": 0, "scale": 1}, "objectFit": "cover"}, "mobile": {"position": {"posX": 0, "posY": 0, "scale": 1}, "objectFit": "cover"}}'::jsonb,
  title text,
  subtitle text,
  button_text text,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Indeksy
CREATE INDEX IF NOT EXISTS idx_service_hero_images_page_slug ON service_hero_images(page_slug);
CREATE INDEX IF NOT EXISTS idx_service_hero_images_section ON service_hero_images(section);
CREATE INDEX IF NOT EXISTS idx_service_hero_images_is_active ON service_hero_images(is_active);

-- Enable RLS
ALTER TABLE service_hero_images ENABLE ROW LEVEL SECURITY;

-- Public SELECT policy
CREATE POLICY "Anyone can view active hero images"
  ON service_hero_images
  FOR SELECT
  USING (is_active = true);

-- Admin/WebsiteEdit UPDATE policy
CREATE POLICY "Authenticated users can update hero images"
  ON service_hero_images
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Admin/WebsiteEdit INSERT policy
CREATE POLICY "Authenticated users can insert hero images"
  ON service_hero_images
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Admin/WebsiteEdit DELETE policy
CREATE POLICY "Authenticated users can delete hero images"
  ON service_hero_images
  FOR DELETE
  TO authenticated
  USING (true);

-- Trigger dla updated_at
CREATE OR REPLACE FUNCTION update_service_hero_images_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER service_hero_images_updated_at
  BEFORE UPDATE ON service_hero_images
  FOR EACH ROW
  EXECUTE FUNCTION update_service_hero_images_updated_at();

-- Migracja danych z istniejących tabel (opcjonalnie - tylko dla przykładu)
-- Możesz dodać więcej INSERT INTO dla innych stron jeśli chcesz zmigrować dane

-- Przykład: streaming_page_images -> service_hero_images
INSERT INTO service_hero_images (page_slug, section, name, description, image_url, alt_text, opacity, image_metadata, title, subtitle, is_active)
SELECT 
  'uslugi/streaming' as page_slug,
  section,
  name,
  description,
  image_url,
  alt_text,
  opacity,
  COALESCE(image_metadata, '{"desktop": {"position": {"posX": 0, "posY": 0, "scale": 1}, "objectFit": "cover"}, "mobile": {"position": {"posX": 0, "posY": 0, "scale": 1}, "objectFit": "cover"}}'::jsonb) as image_metadata,
  title,
  subtitle,
  is_active
FROM streaming_page_images
WHERE section = 'hero'
ON CONFLICT (page_slug) DO NOTHING;

-- Komentarze
COMMENT ON TABLE service_hero_images IS 'Uniwersalna tabela dla hero images wszystkich stron usług';
COMMENT ON COLUMN service_hero_images.page_slug IS 'Pełny slug strony np. uslugi/streaming, uslugi/custom-service';
COMMENT ON COLUMN service_hero_images.section IS 'Nazwa sekcji np. streaming-hero, custom-service-hero';
COMMENT ON COLUMN service_hero_images.image_metadata IS 'JSONB z pozycjami desktop i mobile: {desktop: {position: {posX, posY, scale}, objectFit}, mobile: {...}}';
