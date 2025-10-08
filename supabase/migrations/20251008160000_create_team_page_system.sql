/*
  # Create Team Page Content System

  1. New Tables
    - `team_page` - Zawartość tekstowa strony zespołu
      - `id` (uuid, primary key)
      - `hero_title` (text) - Tytuł główny hero
      - `hero_subtitle` (text) - Podtytuł hero
      - `section_title` (text) - Tytuł sekcji zespołu
      - `section_description` (text) - Opis sekcji zespołu
      - `cta_title` (text) - Tytuł CTA
      - `cta_description` (text) - Opis CTA
      - `seo_title` (text) - Tytuł SEO
      - `seo_description` (text) - Opis SEO
      - `seo_keywords` (text[]) - Słowa kluczowe SEO
      - `updated_at` (timestamptz)

    - `team_page_images` - Obrazy dla strony zespołu
      - `id` (uuid, primary key)
      - `section` (text) - Sekcja: 'hero', 'background', 'gallery'
      - `name` (text) - Nazwa obrazu
      - `description` (text) - Opis obrazu
      - `image_url` (text) - URL obrazu
      - `alt_text` (text) - Tekst alternatywny
      - `image_metadata` (jsonb) - Metadata pozycji/skalowania
      - `opacity` (numeric) - Przezroczystość (0-1)
      - `order_index` (integer) - Kolejność
      - `is_active` (boolean) - Czy aktywny
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

  2. Security
    - Enable RLS on both tables
    - Anyone can read (public access)
    - Anyone can update (for editing mode)
*/

-- Create team_page table
CREATE TABLE IF NOT EXISTS team_page (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hero_title text DEFAULT 'Nasz Zespół',
  hero_subtitle text DEFAULT 'Poznaj ludzi, którzy tworzą Mavinci',
  section_title text DEFAULT 'Zespół',
  section_description text DEFAULT 'Nasz zespół składa się z doświadczonych specjalistów',
  cta_title text DEFAULT 'Dołącz do nas',
  cta_description text DEFAULT 'Szukamy utalentowanych osób do naszego zespołu',
  seo_title text DEFAULT 'Zespół - Mavinci',
  seo_description text DEFAULT 'Poznaj nasz zespół profesjonalistów',
  seo_keywords text[] DEFAULT ARRAY['zespół', 'mavinci', 'pracownicy'],
  updated_at timestamptz DEFAULT now()
);

-- Create team_page_images table
CREATE TABLE IF NOT EXISTS team_page_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  section text NOT NULL,
  name text NOT NULL,
  description text,
  image_url text NOT NULL,
  alt_text text NOT NULL,
  image_metadata jsonb DEFAULT '{
    "desktop": {
      "position": {"posX": 0, "posY": 0, "scale": 1},
      "objectFit": "cover"
    },
    "mobile": {
      "position": {"posX": 0, "posY": 0, "scale": 1},
      "objectFit": "cover"
    }
  }'::jsonb,
  opacity numeric(3,2) DEFAULT 0.20 CHECK (opacity >= 0 AND opacity <= 1),
  order_index integer DEFAULT 1,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE team_page ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_page_images ENABLE ROW LEVEL SECURITY;

-- Policies for team_page
CREATE POLICY "Anyone can read team page content"
  ON team_page FOR SELECT
  TO public
  USING (true);

CREATE POLICY "Anyone can update team page content"
  ON team_page FOR UPDATE
  TO public
  USING (true);

CREATE POLICY "Anyone can insert team page content"
  ON team_page FOR INSERT
  TO public
  WITH CHECK (true);

-- Policies for team_page_images
CREATE POLICY "Anyone can read team page images"
  ON team_page_images FOR SELECT
  TO public
  USING (true);

CREATE POLICY "Anyone can update team page images"
  ON team_page_images FOR UPDATE
  TO public
  USING (true);

CREATE POLICY "Anyone can insert team page images"
  ON team_page_images FOR INSERT
  TO public
  WITH CHECK (true);

CREATE POLICY "Anyone can delete team page images"
  ON team_page_images FOR DELETE
  TO public
  USING (true);

-- Insert default content
INSERT INTO team_page (id)
VALUES (gen_random_uuid())
ON CONFLICT DO NOTHING;

-- Insert default hero image
INSERT INTO team_page_images (section, name, description, image_url, alt_text, opacity)
VALUES (
  'hero',
  'Hero Zespół',
  'Główny obraz tła strony zespołu',
  'https://images.pexels.com/photos/1181406/pexels-photo-1181406.jpeg?auto=compress&cs=tinysrgb&w=1920',
  'Zespół Mavinci',
  0.2
)
ON CONFLICT DO NOTHING;
