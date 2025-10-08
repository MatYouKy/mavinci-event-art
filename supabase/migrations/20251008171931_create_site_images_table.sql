-- ============================================================================
-- SITE IMAGES TABLE - Podstawowa tabela dla wszystkich obrazów stron
-- 
-- Ta tabela przechowuje obrazy używane na różnych sekcjach strony.
-- Jest używana przez komponent PageHeroImage.tsx jako fallback.
-- 
-- 1. Tabele
--    - site_images: przechowuje obrazy dla różnych sekcji
-- 
-- 2. Bezpieczeństwo
--    - RLS włączone
--    - Publiczny dostęp do odczytu
--    - Publiczny dostęp do zapisu (dla trybu edycji)
-- ============================================================================

CREATE TABLE IF NOT EXISTS site_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  section text NOT NULL,
  name text NOT NULL,
  description text,
  desktop_url text NOT NULL,
  mobile_url text,
  alt_text text,
  position text DEFAULT 'center',
  order_index integer DEFAULT 1,
  is_active boolean DEFAULT true,
  opacity numeric DEFAULT 0.2,
  image_metadata jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Indeksy dla lepszej wydajności
CREATE INDEX IF NOT EXISTS idx_site_images_section ON site_images(section);
CREATE INDEX IF NOT EXISTS idx_site_images_is_active ON site_images(is_active);

-- RLS
ALTER TABLE site_images ENABLE ROW LEVEL SECURITY;

-- Publiczny odczyt
CREATE POLICY "Public read site_images" 
  ON site_images 
  FOR SELECT 
  TO public 
  USING (true);

-- Publiczny zapis (wszystkie operacje)
CREATE POLICY "Public write site_images" 
  ON site_images 
  FOR ALL 
  TO public 
  USING (true) 
  WITH CHECK (true);
