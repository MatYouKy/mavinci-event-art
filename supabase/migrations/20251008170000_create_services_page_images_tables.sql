/*
  # Create Services Page Images Tables

  1. New Tables
    - `kasyno_page_images` - Hero images for casino page
    - `streaming_page_images` - Hero images for streaming page
    - `integracje_page_images` - Hero images for integrations page
    - `konferencje_page_images` - Hero images for conferences page
    - `symulatory_vr_page_images` - Hero images for VR simulators page
    - `naglosnienie_page_images` - Hero images for sound systems page
    - `technika_sceniczna_page_images` - Hero images for stage tech page
    - `wieczory_tematyczne_page_images` - Hero images for themed evenings page
    - `quizy_teleturnieje_page_images` - Hero images for quiz shows page

  2. Schema
    Each table contains:
    - `id` (uuid, primary key)
    - `section` (text, unique) - page section identifier
    - `name` (text) - image name
    - `description` (text) - image description
    - `image_url` (text) - URL to the image
    - `alt_text` (text) - alternative text for accessibility
    - `order_index` (integer) - display order
    - `is_active` (boolean) - active status
    - `image_metadata` (jsonb) - position, scale, object-fit settings
    - `opacity` (numeric) - image opacity (0-1)
    - `created_at` (timestamptz)
    - `updated_at` (timestamptz)

  3. Security
    - Enable RLS on all tables
    - Public read access for displaying images
    - Authenticated users can manage all images
*/

-- 1. Kasyno
CREATE TABLE IF NOT EXISTS kasyno_page_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  section TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  image_url TEXT NOT NULL,
  alt_text TEXT,
  order_index INTEGER DEFAULT 1,
  is_active BOOLEAN DEFAULT true,
  image_metadata JSONB DEFAULT '{}',
  opacity NUMERIC DEFAULT 1.0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE kasyno_page_images ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read access to kasyno images"
  ON kasyno_page_images FOR SELECT
  TO public
  USING (true);

CREATE POLICY "Allow authenticated users to manage kasyno images"
  ON kasyno_page_images FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- 2. Streaming
CREATE TABLE IF NOT EXISTS streaming_page_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  section TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  image_url TEXT NOT NULL,
  alt_text TEXT,
  order_index INTEGER DEFAULT 1,
  is_active BOOLEAN DEFAULT true,
  image_metadata JSONB DEFAULT '{}',
  opacity NUMERIC DEFAULT 1.0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE streaming_page_images ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read access to streaming images"
  ON streaming_page_images FOR SELECT
  TO public
  USING (true);

CREATE POLICY "Allow authenticated users to manage streaming images"
  ON streaming_page_images FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- 3. Integracje
CREATE TABLE IF NOT EXISTS integracje_page_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  section TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  image_url TEXT NOT NULL,
  alt_text TEXT,
  order_index INTEGER DEFAULT 1,
  is_active BOOLEAN DEFAULT true,
  image_metadata JSONB DEFAULT '{}',
  opacity NUMERIC DEFAULT 1.0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE integracje_page_images ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read access to integracje images"
  ON integracje_page_images FOR SELECT
  TO public
  USING (true);

CREATE POLICY "Allow authenticated users to manage integracje images"
  ON integracje_page_images FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- 4. Konferencje
CREATE TABLE IF NOT EXISTS konferencje_page_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  section TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  image_url TEXT NOT NULL,
  alt_text TEXT,
  order_index INTEGER DEFAULT 1,
  is_active BOOLEAN DEFAULT true,
  image_metadata JSONB DEFAULT '{}',
  opacity NUMERIC DEFAULT 1.0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE konferencje_page_images ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read access to konferencje images"
  ON konferencje_page_images FOR SELECT
  TO public
  USING (true);

CREATE POLICY "Allow authenticated users to manage konferencje images"
  ON konferencje_page_images FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- 5. Symulatory VR
CREATE TABLE IF NOT EXISTS symulatory_vr_page_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  section TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  image_url TEXT NOT NULL,
  alt_text TEXT,
  order_index INTEGER DEFAULT 1,
  is_active BOOLEAN DEFAULT true,
  image_metadata JSONB DEFAULT '{}',
  opacity NUMERIC DEFAULT 1.0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE symulatory_vr_page_images ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read access to symulatory_vr images"
  ON symulatory_vr_page_images FOR SELECT
  TO public
  USING (true);

CREATE POLICY "Allow authenticated users to manage symulatory_vr images"
  ON symulatory_vr_page_images FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- 6. Nagłośnienie
CREATE TABLE IF NOT EXISTS naglosnienie_page_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  section TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  image_url TEXT NOT NULL,
  alt_text TEXT,
  order_index INTEGER DEFAULT 1,
  is_active BOOLEAN DEFAULT true,
  image_metadata JSONB DEFAULT '{}',
  opacity NUMERIC DEFAULT 1.0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE naglosnienie_page_images ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read access to naglosnienie images"
  ON naglosnienie_page_images FOR SELECT
  TO public
  USING (true);

CREATE POLICY "Allow authenticated users to manage naglosnienie images"
  ON naglosnienie_page_images FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- 7. Technika Sceniczna
CREATE TABLE IF NOT EXISTS technika_sceniczna_page_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  section TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  image_url TEXT NOT NULL,
  alt_text TEXT,
  order_index INTEGER DEFAULT 1,
  is_active BOOLEAN DEFAULT true,
  image_metadata JSONB DEFAULT '{}',
  opacity NUMERIC DEFAULT 1.0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE technika_sceniczna_page_images ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read access to technika_sceniczna images"
  ON technika_sceniczna_page_images FOR SELECT
  TO public
  USING (true);

CREATE POLICY "Allow authenticated users to manage technika_sceniczna images"
  ON technika_sceniczna_page_images FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- 8. Wieczory Tematyczne
CREATE TABLE IF NOT EXISTS wieczory_tematyczne_page_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  section TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  image_url TEXT NOT NULL,
  alt_text TEXT,
  order_index INTEGER DEFAULT 1,
  is_active BOOLEAN DEFAULT true,
  image_metadata JSONB DEFAULT '{}',
  opacity NUMERIC DEFAULT 1.0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE wieczory_tematyczne_page_images ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read access to wieczory_tematyczne images"
  ON wieczory_tematyczne_page_images FOR SELECT
  TO public
  USING (true);

CREATE POLICY "Allow authenticated users to manage wieczory_tematyczne images"
  ON wieczory_tematyczne_page_images FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- 9. Quizy i Teleturnieje
CREATE TABLE IF NOT EXISTS quizy_teleturnieje_page_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  section TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  image_url TEXT NOT NULL,
  alt_text TEXT,
  order_index INTEGER DEFAULT 1,
  is_active BOOLEAN DEFAULT true,
  image_metadata JSONB DEFAULT '{}',
  opacity NUMERIC DEFAULT 1.0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE quizy_teleturnieje_page_images ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read access to quizy_teleturnieje images"
  ON quizy_teleturnieje_page_images FOR SELECT
  TO public
  USING (true);

CREATE POLICY "Allow authenticated users to manage quizy_teleturnieje images"
  ON quizy_teleturnieje_page_images FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);
