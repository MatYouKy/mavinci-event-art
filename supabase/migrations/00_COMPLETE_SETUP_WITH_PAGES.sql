/*
  # KOMPLETNA KONFIGURACJA BAZY DANYCH - WSZYSTKIE STRONY

  Ten plik zawiera WSZYSTKIE tabele dla całej aplikacji:

  SYSTEM STRON (dla każdej strony osobne tabele):
  - team_page + team_page_images (Zespół)
  - home_page + home_page_images (Strona główna)
  - about_page + about_page_images (O nas)
  - services_page + services_page_images (Usługi)
  - portfolio_page + portfolio_page_images (Portfolio)
  - contact_page + contact_page_images (Kontakt)

  INNE SYSTEMY:
  - team_members (Członkowie zespołu)
  - portfolio_projects (Projekty portfolio)
  - admin_users (Panel administracyjny)

  INSTRUKCJA:
  1. Otwórz Supabase Dashboard → SQL Editor
  2. Skopiuj CAŁĄ zawartość tego pliku
  3. Wklej do SQL Editor
  4. Kliknij "Run"
  5. Gotowe!
*/

-- ============================================================================
-- TEAM PAGE - Strona zespołu
-- ============================================================================

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

CREATE TABLE IF NOT EXISTS team_page_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  section text NOT NULL,
  name text NOT NULL,
  description text,
  image_url text NOT NULL,
  alt_text text NOT NULL,
  image_metadata jsonb DEFAULT '{
    "desktop": {"position": {"posX": 0, "posY": 0, "scale": 1}, "objectFit": "cover"},
    "mobile": {"position": {"posX": 0, "posY": 0, "scale": 1}, "objectFit": "cover"}
  }'::jsonb,
  opacity numeric(3,2) DEFAULT 0.20 CHECK (opacity >= 0 AND opacity <= 1),
  order_index integer DEFAULT 1,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- ============================================================================
-- HOME PAGE - Strona główna
-- ============================================================================

CREATE TABLE IF NOT EXISTS home_page (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hero_title text DEFAULT 'Mavinci',
  hero_subtitle text DEFAULT 'Profesjonalne wydarzenia firmowe',
  section_title text DEFAULT 'Co robimy',
  section_description text DEFAULT 'Organizujemy kompleksowe wydarzenia firmowe',
  cta_title text DEFAULT 'Skontaktuj się z nami',
  cta_description text DEFAULT 'Porozmawiajmy o Twoim wydarzeniu',
  seo_title text DEFAULT 'Mavinci - Wydarzenia Firmowe',
  seo_description text DEFAULT 'Profesjonalna organizacja wydarzeń firmowych',
  seo_keywords text[] DEFAULT ARRAY['wydarzenia', 'eventy', 'firmowe'],
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS home_page_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  section text NOT NULL,
  name text NOT NULL,
  description text,
  image_url text NOT NULL,
  alt_text text NOT NULL,
  image_metadata jsonb DEFAULT '{
    "desktop": {"position": {"posX": 0, "posY": 0, "scale": 1}, "objectFit": "cover"},
    "mobile": {"position": {"posX": 0, "posY": 0, "scale": 1}, "objectFit": "cover"}
  }'::jsonb,
  opacity numeric(3,2) DEFAULT 0.20 CHECK (opacity >= 0 AND opacity <= 1),
  order_index integer DEFAULT 1,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- ============================================================================
-- ABOUT PAGE - O nas
-- ============================================================================

CREATE TABLE IF NOT EXISTS about_page (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hero_title text DEFAULT 'O Nas',
  hero_subtitle text DEFAULT 'Kim jesteśmy i co nas wyróżnia',
  section_title text DEFAULT 'Nasza Historia',
  section_description text DEFAULT 'Od lat tworzymy niezapomniane wydarzenia',
  cta_title text DEFAULT 'Chcesz wiedzieć więcej?',
  cta_description text DEFAULT 'Skontaktuj się z nami',
  seo_title text DEFAULT 'O Nas - Mavinci',
  seo_description text DEFAULT 'Poznaj historię i zespół Mavinci',
  seo_keywords text[] DEFAULT ARRAY['o nas', 'mavinci', 'historia'],
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS about_page_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  section text NOT NULL,
  name text NOT NULL,
  description text,
  image_url text NOT NULL,
  alt_text text NOT NULL,
  image_metadata jsonb DEFAULT '{
    "desktop": {"position": {"posX": 0, "posY": 0, "scale": 1}, "objectFit": "cover"},
    "mobile": {"position": {"posX": 0, "posY": 0, "scale": 1}, "objectFit": "cover"}
  }'::jsonb,
  opacity numeric(3,2) DEFAULT 0.20 CHECK (opacity >= 0 AND opacity <= 1),
  order_index integer DEFAULT 1,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- ============================================================================
-- SERVICES PAGE - Usługi
-- ============================================================================

CREATE TABLE IF NOT EXISTS services_page (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hero_title text DEFAULT 'Nasze Usługi',
  hero_subtitle text DEFAULT 'Kompleksowa obsługa wydarzeń',
  section_title text DEFAULT 'Co oferujemy',
  section_description text DEFAULT 'Szerokie spektrum usług eventowych',
  cta_title text DEFAULT 'Potrzebujesz wyceny?',
  cta_description text DEFAULT 'Skontaktuj się z nami po szczegóły',
  seo_title text DEFAULT 'Usługi - Mavinci',
  seo_description text DEFAULT 'Pełna oferta usług eventowych',
  seo_keywords text[] DEFAULT ARRAY['usługi', 'eventy', 'organizacja'],
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS services_page_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  section text NOT NULL,
  name text NOT NULL,
  description text,
  image_url text NOT NULL,
  alt_text text NOT NULL,
  image_metadata jsonb DEFAULT '{
    "desktop": {"position": {"posX": 0, "posY": 0, "scale": 1}, "objectFit": "cover"},
    "mobile": {"position": {"posX": 0, "posY": 0, "scale": 1}, "objectFit": "cover"}
  }'::jsonb,
  opacity numeric(3,2) DEFAULT 0.20 CHECK (opacity >= 0 AND opacity <= 1),
  order_index integer DEFAULT 1,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- ============================================================================
-- PORTFOLIO PAGE - Portfolio
-- ============================================================================

CREATE TABLE IF NOT EXISTS portfolio_page (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hero_title text DEFAULT 'Portfolio',
  hero_subtitle text DEFAULT 'Nasze zrealizowane projekty',
  section_title text DEFAULT 'Projekty',
  section_description text DEFAULT 'Zobacz co dla nas stworzyliśmy',
  cta_title text DEFAULT 'Chcesz podobny projekt?',
  cta_description text DEFAULT 'Skontaktuj się z nami',
  seo_title text DEFAULT 'Portfolio - Mavinci',
  seo_description text DEFAULT 'Nasze najlepsze realizacje',
  seo_keywords text[] DEFAULT ARRAY['portfolio', 'projekty', 'realizacje'],
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS portfolio_page_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  section text NOT NULL,
  name text NOT NULL,
  description text,
  image_url text NOT NULL,
  alt_text text NOT NULL,
  image_metadata jsonb DEFAULT '{
    "desktop": {"position": {"posX": 0, "posY": 0, "scale": 1}, "objectFit": "cover"},
    "mobile": {"position": {"posX": 0, "posY": 0, "scale": 1}, "objectFit": "cover"}
  }'::jsonb,
  opacity numeric(3,2) DEFAULT 0.20 CHECK (opacity >= 0 AND opacity <= 1),
  order_index integer DEFAULT 1,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- ============================================================================
-- CONTACT PAGE - Kontakt
-- ============================================================================

CREATE TABLE IF NOT EXISTS contact_page (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hero_title text DEFAULT 'Kontakt',
  hero_subtitle text DEFAULT 'Skontaktuj się z nami',
  section_title text DEFAULT 'Dane Kontaktowe',
  section_description text DEFAULT 'Jesteśmy do Twojej dyspozycji',
  cta_title text DEFAULT 'Zadzwoń lub napisz',
  cta_description text DEFAULT 'Odpowiemy najszybciej jak to możliwe',
  seo_title text DEFAULT 'Kontakt - Mavinci',
  seo_description text DEFAULT 'Skontaktuj się z Mavinci',
  seo_keywords text[] DEFAULT ARRAY['kontakt', 'mavinci', 'telefon'],
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS contact_page_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  section text NOT NULL,
  name text NOT NULL,
  description text,
  image_url text NOT NULL,
  alt_text text NOT NULL,
  image_metadata jsonb DEFAULT '{
    "desktop": {"position": {"posX": 0, "posY": 0, "scale": 1}, "objectFit": "cover"},
    "mobile": {"position": {"posX": 0, "posY": 0, "scale": 1}, "objectFit": "cover"}
  }'::jsonb,
  opacity numeric(3,2) DEFAULT 0.20 CHECK (opacity >= 0 AND opacity <= 1),
  order_index integer DEFAULT 1,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- ============================================================================
-- TEAM MEMBERS - Członkowie zespołu
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
    "desktop": {"position": {"posX": 0, "posY": 0, "scale": 1}, "objectFit": "cover"},
    "mobile": {"position": {"posX": 0, "posY": 0, "scale": 1}, "objectFit": "cover"}
  }'::jsonb,
  order_index integer DEFAULT 0,
  is_visible boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- ============================================================================
-- PORTFOLIO PROJECTS - Projekty portfolio
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

-- ============================================================================
-- ADMIN USERS - Użytkownicy administratorzy
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

-- ============================================================================
-- ENABLE RLS & CREATE POLICIES
-- ============================================================================

-- Team page
ALTER TABLE team_page ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_page_images ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read team_page" ON team_page FOR SELECT TO public USING (true);
CREATE POLICY "Anyone can update team_page" ON team_page FOR UPDATE TO public USING (true);
CREATE POLICY "Anyone can insert team_page" ON team_page FOR INSERT TO public WITH CHECK (true);
CREATE POLICY "Anyone can read team_page_images" ON team_page_images FOR SELECT TO public USING (true);
CREATE POLICY "Anyone can update team_page_images" ON team_page_images FOR UPDATE TO public USING (true);
CREATE POLICY "Anyone can insert team_page_images" ON team_page_images FOR INSERT TO public WITH CHECK (true);
CREATE POLICY "Anyone can delete team_page_images" ON team_page_images FOR DELETE TO public USING (true);

-- Home page
ALTER TABLE home_page ENABLE ROW LEVEL SECURITY;
ALTER TABLE home_page_images ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read home_page" ON home_page FOR SELECT TO public USING (true);
CREATE POLICY "Anyone can update home_page" ON home_page FOR UPDATE TO public USING (true);
CREATE POLICY "Anyone can insert home_page" ON home_page FOR INSERT TO public WITH CHECK (true);
CREATE POLICY "Anyone can read home_page_images" ON home_page_images FOR SELECT TO public USING (true);
CREATE POLICY "Anyone can update home_page_images" ON home_page_images FOR UPDATE TO public USING (true);
CREATE POLICY "Anyone can insert home_page_images" ON home_page_images FOR INSERT TO public WITH CHECK (true);
CREATE POLICY "Anyone can delete home_page_images" ON home_page_images FOR DELETE TO public USING (true);

-- About page
ALTER TABLE about_page ENABLE ROW LEVEL SECURITY;
ALTER TABLE about_page_images ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read about_page" ON about_page FOR SELECT TO public USING (true);
CREATE POLICY "Anyone can update about_page" ON about_page FOR UPDATE TO public USING (true);
CREATE POLICY "Anyone can insert about_page" ON about_page FOR INSERT TO public WITH CHECK (true);
CREATE POLICY "Anyone can read about_page_images" ON about_page_images FOR SELECT TO public USING (true);
CREATE POLICY "Anyone can update about_page_images" ON about_page_images FOR UPDATE TO public USING (true);
CREATE POLICY "Anyone can insert about_page_images" ON about_page_images FOR INSERT TO public WITH CHECK (true);
CREATE POLICY "Anyone can delete about_page_images" ON about_page_images FOR DELETE TO public USING (true);

-- Services page
ALTER TABLE services_page ENABLE ROW LEVEL SECURITY;
ALTER TABLE services_page_images ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read services_page" ON services_page FOR SELECT TO public USING (true);
CREATE POLICY "Anyone can update services_page" ON services_page FOR UPDATE TO public USING (true);
CREATE POLICY "Anyone can insert services_page" ON services_page FOR INSERT TO public WITH CHECK (true);
CREATE POLICY "Anyone can read services_page_images" ON services_page_images FOR SELECT TO public USING (true);
CREATE POLICY "Anyone can update services_page_images" ON services_page_images FOR UPDATE TO public USING (true);
CREATE POLICY "Anyone can insert services_page_images" ON services_page_images FOR INSERT TO public WITH CHECK (true);
CREATE POLICY "Anyone can delete services_page_images" ON services_page_images FOR DELETE TO public USING (true);

-- Portfolio page
ALTER TABLE portfolio_page ENABLE ROW LEVEL SECURITY;
ALTER TABLE portfolio_page_images ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read portfolio_page" ON portfolio_page FOR SELECT TO public USING (true);
CREATE POLICY "Anyone can update portfolio_page" ON portfolio_page FOR UPDATE TO public USING (true);
CREATE POLICY "Anyone can insert portfolio_page" ON portfolio_page FOR INSERT TO public WITH CHECK (true);
CREATE POLICY "Anyone can read portfolio_page_images" ON portfolio_page_images FOR SELECT TO public USING (true);
CREATE POLICY "Anyone can update portfolio_page_images" ON portfolio_page_images FOR UPDATE TO public USING (true);
CREATE POLICY "Anyone can insert portfolio_page_images" ON portfolio_page_images FOR INSERT TO public WITH CHECK (true);
CREATE POLICY "Anyone can delete portfolio_page_images" ON portfolio_page_images FOR DELETE TO public USING (true);

-- Contact page
ALTER TABLE contact_page ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact_page_images ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read contact_page" ON contact_page FOR SELECT TO public USING (true);
CREATE POLICY "Anyone can update contact_page" ON contact_page FOR UPDATE TO public USING (true);
CREATE POLICY "Anyone can insert contact_page" ON contact_page FOR INSERT TO public WITH CHECK (true);
CREATE POLICY "Anyone can read contact_page_images" ON contact_page_images FOR SELECT TO public USING (true);
CREATE POLICY "Anyone can update contact_page_images" ON contact_page_images FOR UPDATE TO public USING (true);
CREATE POLICY "Anyone can insert contact_page_images" ON contact_page_images FOR INSERT TO public WITH CHECK (true);
CREATE POLICY "Anyone can delete contact_page_images" ON contact_page_images FOR DELETE TO public USING (true);

-- Team members
ALTER TABLE team_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can view team members" ON team_members FOR SELECT TO public USING (true);
CREATE POLICY "Anyone can update team members" ON team_members FOR UPDATE TO public USING (true);
CREATE POLICY "Anyone can insert team members" ON team_members FOR INSERT TO public WITH CHECK (true);
CREATE POLICY "Anyone can delete team members" ON team_members FOR DELETE TO public USING (true);

-- Portfolio projects
ALTER TABLE portfolio_projects ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can view portfolio projects" ON portfolio_projects FOR SELECT TO public USING (true);
CREATE POLICY "Anyone can update portfolio projects" ON portfolio_projects FOR UPDATE TO public USING (true);
CREATE POLICY "Anyone can insert portfolio projects" ON portfolio_projects FOR INSERT TO public WITH CHECK (true);
CREATE POLICY "Anyone can delete portfolio projects" ON portfolio_projects FOR DELETE TO public USING (true);

-- Admin users
ALTER TABLE admin_users ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can view themselves" ON admin_users FOR SELECT TO public USING (true);
CREATE POLICY "Anyone can insert admin users" ON admin_users FOR INSERT TO public WITH CHECK (true);
CREATE POLICY "Anyone can update admin users" ON admin_users FOR UPDATE TO public USING (true);

-- ============================================================================
-- INSERT DEFAULT DATA
-- ============================================================================

-- Team page
INSERT INTO team_page (id) VALUES (gen_random_uuid()) ON CONFLICT DO NOTHING;
INSERT INTO team_page_images (section, name, description, image_url, alt_text, opacity)
VALUES ('hero', 'Hero Zespół', 'Główny obraz strony zespołu',
  'https://images.pexels.com/photos/1181406/pexels-photo-1181406.jpeg?auto=compress&cs=tinysrgb&w=1920',
  'Zespół Mavinci', 0.2);

-- Home page
INSERT INTO home_page (id) VALUES (gen_random_uuid());
INSERT INTO home_page_images (section, name, description, image_url, alt_text, opacity)
VALUES ('hero', 'Hero Home', 'Główny obraz strony głównej',
  'https://images.pexels.com/photos/1190297/pexels-photo-1190297.jpeg?auto=compress&cs=tinysrgb&w=1920',
  'Mavinci Wydarzenia', 0.2);

-- About page
INSERT INTO about_page (id) VALUES (gen_random_uuid());
INSERT INTO about_page_images (section, name, description, image_url, alt_text, opacity)
VALUES ('hero', 'Hero O Nas', 'Główny obraz strony o nas',
  'https://images.pexels.com/photos/1181406/pexels-photo-1181406.jpeg?auto=compress&cs=tinysrgb&w=1920',
  'O Nas', 0.2);

-- Services page
INSERT INTO services_page (id) VALUES (gen_random_uuid());
INSERT INTO services_page_images (section, name, description, image_url, alt_text, opacity)
VALUES ('hero', 'Hero Usługi', 'Główny obraz strony usług',
  'https://images.pexels.com/photos/2774556/pexels-photo-2774556.jpeg?auto=compress&cs=tinysrgb&w=1920',
  'Usługi', 0.2);

-- Portfolio page
INSERT INTO portfolio_page (id) VALUES (gen_random_uuid());
INSERT INTO portfolio_page_images (section, name, description, image_url, alt_text, opacity)
VALUES ('hero', 'Hero Portfolio', 'Główny obraz strony portfolio',
  'https://images.pexels.com/photos/1181396/pexels-photo-1181396.jpeg?auto=compress&cs=tinysrgb&w=1920',
  'Portfolio', 0.2);

-- Contact page
INSERT INTO contact_page (id) VALUES (gen_random_uuid());
INSERT INTO contact_page_images (section, name, description, image_url, alt_text, opacity)
VALUES ('hero', 'Hero Kontakt', 'Główny obraz strony kontakt',
  'https://images.pexels.com/photos/1181533/pexels-photo-1181533.jpeg?auto=compress&cs=tinysrgb&w=1920',
  'Kontakt', 0.2);

-- ============================================================================
-- GOTOWE! ✅
-- ============================================================================
-- Jeśli wszystko przebiegło pomyślnie, powinieneś zobaczyć komunikat:
-- "Success. No rows returned"
--
-- Teraz masz:
-- ✅ 6 systemów stron (każda z osobnymi tabelami)
-- ✅ System członków zespołu
-- ✅ System projektów portfolio
-- ✅ System użytkowników admin
--
-- Każda strona ma:
-- - Tabelę z zawartością tekstową ({page}_page)
-- - Tabelę z obrazami ({page}_page_images)
-- ============================================================================
