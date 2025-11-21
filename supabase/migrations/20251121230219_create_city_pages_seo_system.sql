/*
  # City Pages SEO Management System

  1. New Table: `city_pages_seo`
     - Stores SEO metadata for multi-city pages (e.g., /oferta/konferencje/[miasto])
     - Each city can have custom SEO title, description, keywords
     - Falls back to template-based defaults if not set

  2. Structure
     - `id` (uuid, primary key)
     - `page_type` (text) - typ strony (np. 'konferencje', 'streaming')
     - `city_slug` (text) - slug miasta (np. 'warszawa', 'krakow')
     - `city_name` (text) - pełna nazwa miasta (np. 'Warszawa', 'Kraków')
     - `seo_title` (text, nullable) - custom SEO title
     - `seo_description` (text, nullable) - custom SEO description
     - `seo_keywords` (text, nullable) - comma-separated keywords
     - `is_active` (boolean) - czy aktywne
     - `created_at`, `updated_at` (timestamptz)
     - UNIQUE(page_type, city_slug)

  3. Security
     - Enable RLS
     - Public can SELECT active entries
     - Authenticated users can UPDATE, INSERT, DELETE
*/

-- Create city_pages_seo table
CREATE TABLE IF NOT EXISTS city_pages_seo (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  page_type text NOT NULL DEFAULT 'konferencje',
  city_slug text NOT NULL,
  city_name text NOT NULL,
  seo_title text,
  seo_description text,
  seo_keywords text,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(page_type, city_slug)
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_city_pages_seo_page_type ON city_pages_seo(page_type);
CREATE INDEX IF NOT EXISTS idx_city_pages_seo_city_slug ON city_pages_seo(city_slug);
CREATE INDEX IF NOT EXISTS idx_city_pages_seo_active ON city_pages_seo(is_active);
CREATE INDEX IF NOT EXISTS idx_city_pages_seo_lookup ON city_pages_seo(page_type, city_slug) WHERE is_active = true;

-- Enable RLS
ALTER TABLE city_pages_seo ENABLE ROW LEVEL SECURITY;

-- Public can view active entries
CREATE POLICY "Anyone can view active city SEO data"
  ON city_pages_seo
  FOR SELECT
  USING (is_active = true);

-- Authenticated users can update
CREATE POLICY "Authenticated users can update city SEO"
  ON city_pages_seo
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Authenticated users can insert
CREATE POLICY "Authenticated users can insert city SEO"
  ON city_pages_seo
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Authenticated users can delete
CREATE POLICY "Authenticated users can delete city SEO"
  ON city_pages_seo
  FOR DELETE
  TO authenticated
  USING (true);

-- Trigger for updated_at
CREATE OR REPLACE FUNCTION update_city_pages_seo_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER city_pages_seo_updated_at
  BEFORE UPDATE ON city_pages_seo
  FOR EACH ROW
  EXECUTE FUNCTION update_city_pages_seo_updated_at();

-- Comments
COMMENT ON TABLE city_pages_seo IS 'SEO metadata dla stron multi-city (np. /oferta/konferencje/warszawa)';
COMMENT ON COLUMN city_pages_seo.page_type IS 'Typ strony: konferencje, streaming, etc.';
COMMENT ON COLUMN city_pages_seo.city_slug IS 'Slug miasta: warszawa, krakow, poznan';
COMMENT ON COLUMN city_pages_seo.city_name IS 'Pełna nazwa: Warszawa, Kraków, Poznań';
COMMENT ON COLUMN city_pages_seo.seo_keywords IS 'Słowa kluczowe oddzielone przecinkami';
