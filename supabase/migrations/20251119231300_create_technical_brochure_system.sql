/*
  # Technical Brochure Content Management System

  1. New Tables
    - `technical_brochure_content`
      - `id` (uuid, primary key)
      - `section` (text) - section identifier (hero, services, contact, etc.)
      - `content_key` (text) - specific content field key
      - `content_value` (text) - the actual content
      - `content_type` (text) - type: text, image, phone, email, etc.
      - `order_index` (integer) - for ordering items in sections
      - `is_visible` (boolean) - show/hide content
      - `metadata` (jsonb) - additional data (colors, styles, etc.)
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

    - `technical_brochure_images`
      - `id` (uuid, primary key)
      - `section` (text) - which section (hero, services, contact, team)
      - `image_url` (text) - Supabase storage URL
      - `alt_text` (text) - accessibility text
      - `position_x` (integer) - horizontal position percentage (0-100)
      - `position_y` (integer) - vertical position percentage (0-100)
      - `object_fit` (text) - cover, contain, fill
      - `order_index` (integer) - ordering
      - `is_visible` (boolean)
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

  2. Security
    - Enable RLS on both tables
    - Allow public SELECT (for viewing brochure)
    - Require 'website_edit' permission for INSERT/UPDATE/DELETE

  3. Sample Data
    - Initial content for all sections
    - Default images with positions
*/

-- Create technical_brochure_content table
CREATE TABLE IF NOT EXISTS technical_brochure_content (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  section text NOT NULL,
  content_key text NOT NULL,
  content_value text NOT NULL,
  content_type text DEFAULT 'text',
  order_index integer DEFAULT 0,
  is_visible boolean DEFAULT true,
  metadata jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(section, content_key)
);

-- Create technical_brochure_images table
CREATE TABLE IF NOT EXISTS technical_brochure_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  section text NOT NULL,
  image_url text NOT NULL,
  alt_text text,
  position_x integer DEFAULT 50,
  position_y integer DEFAULT 50,
  object_fit text DEFAULT 'cover',
  order_index integer DEFAULT 0,
  is_visible boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE technical_brochure_content ENABLE ROW LEVEL SECURITY;
ALTER TABLE technical_brochure_images ENABLE ROW LEVEL SECURITY;

-- Public can view
CREATE POLICY "Anyone can view brochure content"
  ON technical_brochure_content FOR SELECT
  USING (true);

CREATE POLICY "Anyone can view brochure images"
  ON technical_brochure_images FOR SELECT
  USING (true);

-- Only users with website_edit can modify
CREATE POLICY "Website editors can insert brochure content"
  ON technical_brochure_content FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees
      WHERE id = auth.uid()
      AND 'website_edit' = ANY(permissions)
    )
  );

CREATE POLICY "Website editors can update brochure content"
  ON technical_brochure_content FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE id = auth.uid()
      AND 'website_edit' = ANY(permissions)
    )
  );

CREATE POLICY "Website editors can delete brochure content"
  ON technical_brochure_content FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE id = auth.uid()
      AND 'website_edit' = ANY(permissions)
    )
  );

CREATE POLICY "Website editors can insert brochure images"
  ON technical_brochure_images FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees
      WHERE id = auth.uid()
      AND 'website_edit' = ANY(permissions)
    )
  );

CREATE POLICY "Website editors can update brochure images"
  ON technical_brochure_images FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE id = auth.uid()
      AND 'website_edit' = ANY(permissions)
    )
  );

CREATE POLICY "Website editors can delete brochure images"
  ON technical_brochure_images FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE id = auth.uid()
      AND 'website_edit' = ANY(permissions)
    )
  );

-- Insert sample content
INSERT INTO technical_brochure_content (section, content_key, content_value, content_type, order_index) VALUES
-- Hero section
('hero', 'title', 'Technika Estradowa', 'text', 1),
('hero', 'subtitle', 'Premium', 'text', 2),
('hero', 'description', 'Twórz niezapomniane wydarzenia z najlepszym sprzętem scenicznym i profesjonalną obsługą techniczną', 'text', 3),

-- Services sections
('services', 'sound_title', 'Nagłośnienie', 'text', 1),
('services', 'sound_desc', 'Systemy line array premium, mikrofony bezprzewodowe najwyższej klasy, cyfrowe konsole mikserskie', 'text', 2),
('services', 'light_title', 'Oświetlenie', 'text', 3),
('services', 'light_desc', 'Inteligentne reflektory LED, lasery i efekty specjalne, sterowanie DMX i Art-Net', 'text', 4),
('services', 'led_title', 'Ekrany LED', 'text', 5),
('services', 'led_desc', 'Ekrany wewnętrzne i zewnętrzne HD, modułowa konstrukcja, pełna obsługa techniczna', 'text', 6),
('services', 'stage_title', 'Scena i konstrukcje', 'text', 7),
('services', 'stage_desc', 'Podesty sceniczne, konstrukcje aluminiowe, dekoracje i zabudowy sceniczne', 'text', 8),
('services', 'streaming_title', 'Realizacja i Streaming', 'text', 9),
('services', 'streaming_desc', 'Kamery 4K, reżyseria obrazu, transmisje live, nagrania HD', 'text', 10),
('services', 'power_title', 'Zasilanie i dystrybucja', 'text', 11),
('services', 'power_desc', 'Agregaty prądotwórcze, systemy UPS, profesjonalna dystrybucja energii', 'text', 12),

-- Contact section
('contact', 'title', 'Skontaktuj się z nami', 'text', 1),
('contact', 'subtitle', 'Porozmawiajmy o Twoim projekcie', 'text', 2),
('contact', 'phone', '+48 123 456 789', 'phone', 3),
('contact', 'email', 'kontakt@mavinci.pl', 'email', 4),
('contact', 'location', 'Polska', 'text', 5),
('contact', 'location_desc', 'Działamy w całym kraju', 'text', 6),
('contact', 'company_name', 'Mavinci Event & Art', 'text', 7),
('contact', 'company_tagline', 'Profesjonalna obsługa techniczna eventów', 'text', 8),
('contact', 'company_desc', 'Od ponad 15 lat realizujemy wydarzenia na najwyższym poziomie. Konferencje, gale, koncerty i eventy korporacyjne – każdy projekt traktujemy indywidualnie i z pełnym zaangażowaniem.', 'text', 9),
('contact', 'feature_1', 'Nagłośnienie premium', 'text', 10),
('contact', 'feature_2', 'Oświetlenie sceniczne i architektoniczne', 'text', 11),
('contact', 'feature_3', 'Konstrukcje sceniczne i multimedia', 'text', 12),
('contact', 'feature_4', 'Realizacja i streaming online', 'text', 13),
('contact', 'availability_title', 'Dostępność 24/7', 'text', 14),
('contact', 'availability_desc', 'W przypadku pilnych zleceń jesteśmy do dyspozycji', 'text', 15)
ON CONFLICT (section, content_key) DO NOTHING;

-- Insert sample images
INSERT INTO technical_brochure_images (section, image_url, alt_text, position_x, position_y, object_fit, order_index) VALUES
('hero', 'https://images.pexels.com/photos/1763075/pexels-photo-1763075.jpeg?auto=compress&cs=tinysrgb&w=1600', 'Stage lighting', 50, 50, 'cover', 1),
('contact', 'https://images.pexels.com/photos/2182970/pexels-photo-2182970.jpeg?auto=compress&cs=tinysrgb&w=800', 'Mavinci team', 50, 50, 'cover', 1)
ON CONFLICT DO NOTHING;

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_brochure_content_section ON technical_brochure_content(section);
CREATE INDEX IF NOT EXISTS idx_brochure_images_section ON technical_brochure_images(section);

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE technical_brochure_content;
ALTER PUBLICATION supabase_realtime ADD TABLE technical_brochure_images;