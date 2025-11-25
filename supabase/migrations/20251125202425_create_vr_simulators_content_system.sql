/*
  # System Symulatorów VR - content SEO

  1. Nowe tabele
    - `vr_simulators_intro` - intro sekcja (tytuł, opis)
    - `vr_equipment_types` - typy sprzętu (okulary VR, stanowiska wyścigowe)
    - `vr_features` - cechy/zalety
    - `vr_gallery` - galeria zdjęć
    - `vr_experiences` - rodzaje doświadczeń VR
    - `vr_benefits` - korzyści dla eventów

  2. Security
    - Enable RLS na wszystkich tabelach
    - Public read access
    - Admin/website_edit write access
*/

-- VR Simulators Intro
CREATE TABLE IF NOT EXISTS vr_simulators_intro (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  subtitle text NOT NULL,
  description text NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE vr_simulators_intro ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can view vr intro"
  ON vr_simulators_intro FOR SELECT
  USING (true);

CREATE POLICY "Admins manage vr intro"
  ON vr_simulators_intro FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM employees WHERE employees.id = auth.uid() AND 'admin' = ANY(employees.permissions)))
  WITH CHECK (EXISTS (SELECT 1 FROM employees WHERE employees.id = auth.uid() AND 'admin' = ANY(employees.permissions)));

CREATE POLICY "Website editors manage vr intro"
  ON vr_simulators_intro FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM employees WHERE employees.id = auth.uid() AND 'website_edit' = ANY(employees.permissions)))
  WITH CHECK (EXISTS (SELECT 1 FROM employees WHERE employees.id = auth.uid() AND 'website_edit' = ANY(employees.permissions)));

-- VR Equipment Types (okulary, stanowiska)
CREATE TABLE IF NOT EXISTS vr_equipment_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text NOT NULL,
  image_url text,
  specs jsonb,
  order_index integer NOT NULL DEFAULT 0,
  is_visible boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE vr_equipment_types ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can view visible vr equipment"
  ON vr_equipment_types FOR SELECT
  USING (is_visible = true);

CREATE POLICY "Admins manage vr equipment"
  ON vr_equipment_types FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM employees WHERE employees.id = auth.uid() AND 'admin' = ANY(employees.permissions)))
  WITH CHECK (EXISTS (SELECT 1 FROM employees WHERE employees.id = auth.uid() AND 'admin' = ANY(employees.permissions)));

CREATE POLICY "Website editors manage vr equipment"
  ON vr_equipment_types FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM employees WHERE employees.id = auth.uid() AND 'website_edit' = ANY(employees.permissions)))
  WITH CHECK (EXISTS (SELECT 1 FROM employees WHERE employees.id = auth.uid() AND 'website_edit' = ANY(employees.permissions)));

-- VR Features
CREATE TABLE IF NOT EXISTS vr_features (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text NOT NULL,
  icon_name text,
  order_index integer NOT NULL DEFAULT 0,
  is_visible boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE vr_features ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can view visible vr features"
  ON vr_features FOR SELECT
  USING (is_visible = true);

CREATE POLICY "Admins manage vr features"
  ON vr_features FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM employees WHERE employees.id = auth.uid() AND 'admin' = ANY(employees.permissions)))
  WITH CHECK (EXISTS (SELECT 1 FROM employees WHERE employees.id = auth.uid() AND 'admin' = ANY(employees.permissions)));

CREATE POLICY "Website editors manage vr features"
  ON vr_features FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM employees WHERE employees.id = auth.uid() AND 'website_edit' = ANY(employees.permissions)))
  WITH CHECK (EXISTS (SELECT 1 FROM employees WHERE employees.id = auth.uid() AND 'website_edit' = ANY(employees.permissions)));

-- VR Gallery
CREATE TABLE IF NOT EXISTS vr_gallery (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  image_url text NOT NULL,
  title text,
  description text,
  order_index integer NOT NULL DEFAULT 0,
  is_visible boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE vr_gallery ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can view visible vr gallery"
  ON vr_gallery FOR SELECT
  USING (is_visible = true);

CREATE POLICY "Admins manage vr gallery"
  ON vr_gallery FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM employees WHERE employees.id = auth.uid() AND 'admin' = ANY(employees.permissions)))
  WITH CHECK (EXISTS (SELECT 1 FROM employees WHERE employees.id = auth.uid() AND 'admin' = ANY(employees.permissions)));

CREATE POLICY "Website editors manage vr gallery"
  ON vr_gallery FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM employees WHERE employees.id = auth.uid() AND 'website_edit' = ANY(employees.permissions)))
  WITH CHECK (EXISTS (SELECT 1 FROM employees WHERE employees.id = auth.uid() AND 'website_edit' = ANY(employees.permissions)));

-- VR Experiences
CREATE TABLE IF NOT EXISTS vr_experiences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text NOT NULL,
  category text NOT NULL,
  image_url text,
  order_index integer NOT NULL DEFAULT 0,
  is_visible boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE vr_experiences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can view visible vr experiences"
  ON vr_experiences FOR SELECT
  USING (is_visible = true);

CREATE POLICY "Admins manage vr experiences"
  ON vr_experiences FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM employees WHERE employees.id = auth.uid() AND 'admin' = ANY(employees.permissions)))
  WITH CHECK (EXISTS (SELECT 1 FROM employees WHERE employees.id = auth.uid() AND 'admin' = ANY(employees.permissions)));

CREATE POLICY "Website editors manage vr experiences"
  ON vr_experiences FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM employees WHERE employees.id = auth.uid() AND 'website_edit' = ANY(employees.permissions)))
  WITH CHECK (EXISTS (SELECT 1 FROM employees WHERE employees.id = auth.uid() AND 'website_edit' = ANY(employees.permissions)));

-- VR Benefits
CREATE TABLE IF NOT EXISTS vr_benefits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text NOT NULL,
  order_index integer NOT NULL DEFAULT 0,
  is_visible boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE vr_benefits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can view visible vr benefits"
  ON vr_benefits FOR SELECT
  USING (is_visible = true);

CREATE POLICY "Admins manage vr benefits"
  ON vr_benefits FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM employees WHERE employees.id = auth.uid() AND 'admin' = ANY(employees.permissions)))
  WITH CHECK (EXISTS (SELECT 1 FROM employees WHERE employees.id = auth.uid() AND 'admin' = ANY(employees.permissions)));

CREATE POLICY "Website editors manage vr benefits"
  ON vr_benefits FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM employees WHERE employees.id = auth.uid() AND 'website_edit' = ANY(employees.permissions)))
  WITH CHECK (EXISTS (SELECT 1 FROM employees WHERE employees.id = auth.uid() AND 'website_edit' = ANY(employees.permissions)));

-- Indexes
CREATE INDEX IF NOT EXISTS idx_vr_equipment_order ON vr_equipment_types(order_index);
CREATE INDEX IF NOT EXISTS idx_vr_features_order ON vr_features(order_index);
CREATE INDEX IF NOT EXISTS idx_vr_gallery_order ON vr_gallery(order_index);
CREATE INDEX IF NOT EXISTS idx_vr_experiences_order ON vr_experiences(order_index);
CREATE INDEX IF NOT EXISTS idx_vr_benefits_order ON vr_benefits(order_index);

-- Sample Data - Intro
INSERT INTO vr_simulators_intro (title, subtitle, description) VALUES (
  'Symulatory VR i Stanowiska Wyścigowe',
  'Innowacyjne atrakcje na eventy firmowe',
  'Przenieś uczestników w świat wirtualnej rzeczywistości. Oferujemy profesjonalne okulary VR Meta Quest 3, gogle VR oraz zaawansowane stanowiska wyścigowe z kierownicami force feedback. Idealne na targi, konferencje, eventy integracyjne i gale firmowe.'
);

-- Sample Data - Equipment Types
INSERT INTO vr_equipment_types (title, description, image_url, specs, order_index) VALUES
(
  'Okulary VR Meta Quest 3',
  'Najnowsze gogle VR Meta Quest 3 zapewniają niesamowite wrażenia dzięki zaawansowanej technologii mixed reality. Bezprzewodowe, autonomiczne urządzenia gotowe do użycia bez dodatkowego sprzętu.',
  'https://images.unsplash.com/photo-1622979135225-d2ba269cf1ac?auto=format&fit=crop&w=800&q=80',
  '{"resolution": "4K+", "refresh_rate": "120Hz", "tracking": "Inside-out 6DoF", "wireless": true, "battery": "2-3 godziny"}',
  1
),
(
  'Stanowiska Wyścigowe Racing',
  'Profesjonalne symulatory wyścigowe z fotelami racing, kierownicami force feedback Logitech G923 i pedałami. Pełna immersja w świat motorsportu z obsługą najpopularniejszych gier wyścigowych.',
  'https://images.unsplash.com/photo-1593305841991-05c297ba4575?auto=format&fit=crop&w=800&q=80',
  '{"wheel": "Logitech G923 TrueForce", "pedals": "3-pedałowe", "shifter": "Opcjonalny", "screen": "32\" 144Hz", "games": ["Assetto Corsa", "F1", "Gran Turismo"]}',
  2
),
(
  'Gogle VR HTC Vive Pro 2',
  'Profesjonalne gogle VR dla najbardziej wymagających doświadczeń. Doskonała jakość obrazu 5K, precyzyjny tracking i szeroki kąt widzenia. Idealne do prezentacji architektonicznych i szkoleń.',
  'https://images.unsplash.com/photo-1617802690992-15d93263d3a9?auto=format&fit=crop&w=800&q=80',
  '{"resolution": "5K (2448x2448 per eye)", "refresh_rate": "120Hz", "fov": "120°", "tracking": "SteamVR Lighthouse 2.0"}',
  3
);

-- Sample Data - Features
INSERT INTO vr_features (title, description, icon_name, order_index) VALUES
('Plug & Play', 'Kompletne zestawy gotowe do użycia. Przywozimy, instalujemy, obsługujemy podczas eventu.', 'zap', 1),
('Bogata biblioteka gier', 'Setki gier i doświadczeń VR - od wyścigów, przez strzelanie, po relaksujące symulacje.', 'gamepad-2', 2),
('Obsługa techniczna', 'Dedykowany operator obsługuje stanowiska i pomaga uczestnikom podczas całego eventu.', 'users', 3),
('Branding', 'Możliwość personalizacji menu i ekranów startowych logo Twojej firmy.', 'palette', 4),
('Multiplayer', 'Wspólna zabawa - wyścigi przeciwko sobie, wspólne misje, rywalizacja drużynowa.', 'trophy', 5),
('Bezpieczeństwo', 'Przestrzegamy najwyższych standardów bezpieczeństwa. Sprzęt dezynfekowany po każdym użyciu.', 'shield-check', 6);

-- Sample Data - Gallery
INSERT INTO vr_gallery (image_url, title, order_index) VALUES
('https://images.unsplash.com/photo-1535223289827-42f1e9919769?auto=format&fit=crop&w=800&q=80', 'Stanowisko VR Meta Quest 3', 1),
('https://images.unsplash.com/photo-1593305841991-05c297ba4575?auto=format&fit=crop&w=800&q=80', 'Symulator wyścigowy F1', 2),
('https://images.unsplash.com/photo-1622979135225-d2ba269cf1ac?auto=format&fit=crop&w=800&q=80', 'Okulary VR na evencie', 3),
('https://images.unsplash.com/photo-1542751371-adc38448a05e?auto=format&fit=crop&w=800&q=80', 'Doświadczenie VR gaming', 4),
('https://images.unsplash.com/photo-1511512578047-dfb367046420?auto=format&fit=crop&w=800&q=80', 'Racing simulator setup', 5),
('https://images.unsplash.com/photo-1612287230202-1ff1d85d1bdf?auto=format&fit=crop&w=800&q=80', 'VR na targach firmowych', 6);

-- Sample Data - Experiences
INSERT INTO vr_experiences (title, description, category, order_index) VALUES
('Wyścigi Formuły 1', 'Poczuj emocje prawdziwego kierowcy F1. Tor Silverstone, Monaco, Spa-Francorchamps w realistycznej symulacji.', 'Racing', 1),
('Beat Saber', 'Najsłynniejsza gra rytmiczna VR. Tnij świetlne klocki w rytm muzyki - świetna zabawa i rozgrzewka!', 'Music & Rhythm', 2),
('Half-Life: Alyx', 'Pełna immersja w świat dystopijnej przyszłości. Eksploracja, strzelanie i rozwiązywanie zagadek.', 'Adventure', 3),
('Assetto Corsa Competizione', 'Profesjonalny symulator wyścigów GT3. Fizyka samochodów jak w prawdziwych bolidach.', 'Racing', 4),
('The Lab', 'Zestaw mini-gier pokazujących możliwości VR. Od strzelanki po realistyczną symulację łuku.', 'Mini-games', 5),
('Job Simulator', 'Humorystyczna symulacja różnych zawodów w świecie opanowanym przez roboty. Świetna na team building!', 'Simulation', 6);

-- Sample Data - Benefits
INSERT INTO vr_benefits (title, description, order_index) VALUES
('Niezapomniane wrażenia', 'Uczestnicy długo pamiętają emocje z VR. To doświadczenie, które zapadnie w pamięć na lata.', 1),
('Angażująca atrakcja', 'VR przyciąga tłumy na targach i eventach. Kolejki do stanowisk to świetna okazja do networkingu.', 2),
('Uniwersalność', 'Pasuje na każdy event - od integracji firmowej, przez targi, po gale premium.', 3),
('Integracja zespołu', 'Wspólne wyścigi i misje budują więzi. Team building w wirtualnej rzeczywistości działa!', 4),
('Nowoczesny wizerunek', 'Pokazujesz, że Twoja firma jest innowacyjna i idzie z duchem czasu.', 5),
('Statystyki i ranking', 'System zapisuje wyniki i czasy. Rywalizacja między uczestnikami buduje emocje.', 6);