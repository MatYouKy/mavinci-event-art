-- ============================================================================
-- SERVICE PAGES IMAGES TABLES
-- 
-- Tabele dla obrazów hero wszystkich podstron usług.
-- Każda podstrona ma swoją dedykowaną tabelę.
-- 
-- Tabele:
-- - integracje_page_images
-- - kasyno_page_images
-- - konferencje_page_images
-- - naglosnienie_page_images
-- - quizy-teleturnieje_page_images
-- - streaming_page_images
-- - symulatory-vr_page_images
-- - technika-sceniczna_page_images
-- - wieczory-tematyczne_page_images
-- 
-- Bezpieczeństwo:
-- - RLS włączone na wszystkich tabelach
-- - Publiczny dostęp do odczytu
-- - Publiczny dostęp do zapisu
-- ============================================================================

-- INTEGRACJE
CREATE TABLE IF NOT EXISTS integracje_page_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  section text NOT NULL DEFAULT 'hero',
  name text NOT NULL,
  description text,
  image_url text NOT NULL,
  alt_text text,
  order_index integer DEFAULT 1,
  is_active boolean DEFAULT true,
  opacity numeric DEFAULT 0.2,
  image_metadata jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- KASYNO
CREATE TABLE IF NOT EXISTS kasyno_page_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  section text NOT NULL DEFAULT 'hero',
  name text NOT NULL,
  description text,
  image_url text NOT NULL,
  alt_text text,
  order_index integer DEFAULT 1,
  is_active boolean DEFAULT true,
  opacity numeric DEFAULT 0.2,
  image_metadata jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- KONFERENCJE
CREATE TABLE IF NOT EXISTS konferencje_page_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  section text NOT NULL DEFAULT 'hero',
  name text NOT NULL,
  description text,
  image_url text NOT NULL,
  alt_text text,
  order_index integer DEFAULT 1,
  is_active boolean DEFAULT true,
  opacity numeric DEFAULT 0.2,
  image_metadata jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- NAGLOSNIENIE
CREATE TABLE IF NOT EXISTS naglosnienie_page_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  section text NOT NULL DEFAULT 'hero',
  name text NOT NULL,
  description text,
  image_url text NOT NULL,
  alt_text text,
  order_index integer DEFAULT 1,
  is_active boolean DEFAULT true,
  opacity numeric DEFAULT 0.2,
  image_metadata jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- QUIZY TELETURNIEJE
CREATE TABLE IF NOT EXISTS "quizy-teleturnieje_page_images" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  section text NOT NULL DEFAULT 'hero',
  name text NOT NULL,
  description text,
  image_url text NOT NULL,
  alt_text text,
  order_index integer DEFAULT 1,
  is_active boolean DEFAULT true,
  opacity numeric DEFAULT 0.2,
  image_metadata jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- STREAMING
CREATE TABLE IF NOT EXISTS streaming_page_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  section text NOT NULL DEFAULT 'hero',
  name text NOT NULL,
  description text,
  image_url text NOT NULL,
  alt_text text,
  order_index integer DEFAULT 1,
  is_active boolean DEFAULT true,
  opacity numeric DEFAULT 0.2,
  image_metadata jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- SYMULATORY VR
CREATE TABLE IF NOT EXISTS "symulatory-vr_page_images" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  section text NOT NULL DEFAULT 'hero',
  name text NOT NULL,
  description text,
  image_url text NOT NULL,
  alt_text text,
  order_index integer DEFAULT 1,
  is_active boolean DEFAULT true,
  opacity numeric DEFAULT 0.2,
  image_metadata jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- TECHNIKA SCENICZNA
CREATE TABLE IF NOT EXISTS "technika-sceniczna_page_images" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  section text NOT NULL DEFAULT 'hero',
  name text NOT NULL,
  description text,
  image_url text NOT NULL,
  alt_text text,
  order_index integer DEFAULT 1,
  is_active boolean DEFAULT true,
  opacity numeric DEFAULT 0.2,
  image_metadata jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- WIECZORY TEMATYCZNE
CREATE TABLE IF NOT EXISTS "wieczory-tematyczne_page_images" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  section text NOT NULL DEFAULT 'hero',
  name text NOT NULL,
  description text,
  image_url text NOT NULL,
  alt_text text,
  order_index integer DEFAULT 1,
  is_active boolean DEFAULT true,
  opacity numeric DEFAULT 0.2,
  image_metadata jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- ============================================================================
-- RLS POLICIES
-- ============================================================================

ALTER TABLE integracje_page_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE kasyno_page_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE konferencje_page_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE naglosnienie_page_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE "quizy-teleturnieje_page_images" ENABLE ROW LEVEL SECURITY;
ALTER TABLE streaming_page_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE "symulatory-vr_page_images" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "technika-sceniczna_page_images" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "wieczory-tematyczne_page_images" ENABLE ROW LEVEL SECURITY;

-- Publiczny odczyt
CREATE POLICY "Public read integracje_images" ON integracje_page_images FOR SELECT TO public USING (true);
CREATE POLICY "Public read kasyno_images" ON kasyno_page_images FOR SELECT TO public USING (true);
CREATE POLICY "Public read konferencje_images" ON konferencje_page_images FOR SELECT TO public USING (true);
CREATE POLICY "Public read naglosnienie_images" ON naglosnienie_page_images FOR SELECT TO public USING (true);
CREATE POLICY "Public read quizy_images" ON "quizy-teleturnieje_page_images" FOR SELECT TO public USING (true);
CREATE POLICY "Public read streaming_images" ON streaming_page_images FOR SELECT TO public USING (true);
CREATE POLICY "Public read vr_images" ON "symulatory-vr_page_images" FOR SELECT TO public USING (true);
CREATE POLICY "Public read technika_images" ON "technika-sceniczna_page_images" FOR SELECT TO public USING (true);
CREATE POLICY "Public read wieczory_images" ON "wieczory-tematyczne_page_images" FOR SELECT TO public USING (true);

-- Publiczny zapis
CREATE POLICY "Public write integracje_images" ON integracje_page_images FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY "Public write kasyno_images" ON kasyno_page_images FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY "Public write konferencje_images" ON konferencje_page_images FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY "Public write naglosnienie_images" ON naglosnienie_page_images FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY "Public write quizy_images" ON "quizy-teleturnieje_page_images" FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY "Public write streaming_images" ON streaming_page_images FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY "Public write vr_images" ON "symulatory-vr_page_images" FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY "Public write technika_images" ON "technika-sceniczna_page_images" FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY "Public write wieczory_images" ON "wieczory-tematyczne_page_images" FOR ALL TO public USING (true) WITH CHECK (true);
