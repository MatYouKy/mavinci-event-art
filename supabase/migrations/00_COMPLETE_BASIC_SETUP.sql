/*
  # KOMPLETNA KONFIGURACJA BAZY DANYCH - PODSTAWOWE FUNKCJE

  Ten plik zawiera WSZYSTKIE niezbędne migracje dla podstawowej funkcjonalności:
  - Site Images (hero images na podstronach)
  - Team Members (sekcja zespołu)
  - Portfolio Projects (portfolio)
  - Admin Users (panel administracyjny)

  INSTRUKCJA:
  1. Otwórz Supabase Dashboard → SQL Editor
  2. Skopiuj CAŁĄ zawartość tego pliku
  3. Wklej do SQL Editor
  4. Kliknij "Run"
  5. Gotowe!
*/

-- ============================================================================
-- 1. SITE IMAGES - Obrazy hero na podstronach
-- ============================================================================

CREATE TABLE IF NOT EXISTS site_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  section text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  desktop_url text NOT NULL,
  mobile_url text,
  alt_text text NOT NULL,
  position text DEFAULT 'center',
  order_index integer DEFAULT 1,
  is_active boolean DEFAULT true,
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
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- RLS dla site_images
ALTER TABLE site_images ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS "Anyone can view site images"
  ON site_images FOR SELECT
  TO public
  USING (true);

CREATE POLICY IF NOT EXISTS "Anyone can update site images"
  ON site_images FOR UPDATE
  TO public
  USING (true);

CREATE POLICY IF NOT EXISTS "Anyone can insert site images"
  ON site_images FOR INSERT
  TO public
  WITH CHECK (true);

-- ============================================================================
-- 2. TEAM MEMBERS - Członkowie zespołu
-- ============================================================================

CREATE TABLE IF NOT EXISTS team_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  position text NOT NULL,
  bio text,
  email text,
  phone text,
  image_url text,
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
  order_index integer DEFAULT 0,
  is_visible boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- RLS dla team_members
ALTER TABLE team_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS "Anyone can view visible team members"
  ON team_members FOR SELECT
  TO public
  USING (is_visible = true);

CREATE POLICY IF NOT EXISTS "Anyone can view all team members"
  ON team_members FOR SELECT
  TO public
  USING (true);

CREATE POLICY IF NOT EXISTS "Anyone can update team members"
  ON team_members FOR UPDATE
  TO public
  USING (true);

CREATE POLICY IF NOT EXISTS "Anyone can insert team members"
  ON team_members FOR INSERT
  TO public
  WITH CHECK (true);

CREATE POLICY IF NOT EXISTS "Anyone can delete team members"
  ON team_members FOR DELETE
  TO public
  USING (true);

-- ============================================================================
-- 3. PORTFOLIO PROJECTS - Projekty portfolio
-- ============================================================================

CREATE TABLE IF NOT EXISTS portfolio_projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text,
  long_description text,
  category text,
  client text,
  date date,
  image_url text,
  gallery_urls text[],
  technologies text[],
  is_featured boolean DEFAULT false,
  is_visible boolean DEFAULT true,
  order_index integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- RLS dla portfolio_projects
ALTER TABLE portfolio_projects ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS "Anyone can view visible portfolio projects"
  ON portfolio_projects FOR SELECT
  TO public
  USING (is_visible = true);

CREATE POLICY IF NOT EXISTS "Anyone can view all portfolio projects"
  ON portfolio_projects FOR SELECT
  TO public
  USING (true);

CREATE POLICY IF NOT EXISTS "Anyone can update portfolio projects"
  ON portfolio_projects FOR UPDATE
  TO public
  USING (true);

CREATE POLICY IF NOT EXISTS "Anyone can insert portfolio projects"
  ON portfolio_projects FOR INSERT
  TO public
  WITH CHECK (true);

CREATE POLICY IF NOT EXISTS "Anyone can delete portfolio projects"
  ON portfolio_projects FOR DELETE
  TO public
  USING (true);

-- ============================================================================
-- 4. ADMIN USERS - Użytkownicy administratorzy
-- ============================================================================

CREATE TABLE IF NOT EXISTS admin_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE NOT NULL,
  password_hash text NOT NULL,
  full_name text,
  is_active boolean DEFAULT true,
  last_login_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- RLS dla admin_users
ALTER TABLE admin_users ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS "Admins can view themselves"
  ON admin_users FOR SELECT
  TO public
  USING (true);

CREATE POLICY IF NOT EXISTS "Anyone can insert admin users"
  ON admin_users FOR INSERT
  TO public
  WITH CHECK (true);

CREATE POLICY IF NOT EXISTS "Anyone can update admin users"
  ON admin_users FOR UPDATE
  TO public
  USING (true);

-- ============================================================================
-- 5. STORAGE BUCKET - Bucket dla obrazów
-- ============================================================================

-- Uwaga: Storage bucket trzeba utworzyć ręcznie w Supabase Dashboard
-- 1. Przejdź do Storage
-- 2. Kliknij "Create bucket"
-- 3. Nazwa: "images"
-- 4. Zaznacz "Public bucket"
-- 5. Kliknij "Create"

-- ============================================================================
-- 6. PRZYKŁADOWE DANE
-- ============================================================================

-- Dodaj przykładowy wpis dla site_images (hero image strony głównej)
INSERT INTO site_images (section, name, description, desktop_url, alt_text, opacity)
VALUES (
  'home',
  'Hero strony głównej',
  'Główny obraz tła na stronie startowej',
  'https://images.pexels.com/photos/1190297/pexels-photo-1190297.jpeg?auto=compress&cs=tinysrgb&w=1920',
  'Mavinci - Wydarzenia Firmowe',
  0.2
)
ON CONFLICT (section) DO NOTHING;

-- ============================================================================
-- GOTOWE!
-- ============================================================================
-- Jeśli wszystko przebiegło pomyślnie, powinieneś zobaczyć komunikat:
-- "Success. No rows returned"
--
-- Teraz możesz:
-- 1. Uruchomić aplikację: npm run dev
-- 2. Włączyć tryb edycji w aplikacji
-- 3. Edytować hero images, zespół i portfolio
-- ============================================================================
