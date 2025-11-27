/*
  # System Obsługi DJ - DJ na imprezę

  1. Nowe tabele
    - `dj_intro` - intro sekcja
    - `dj_packages` - pakiety Standard, Premium, VIP
    - `dj_features` - cechy/zalety obsługi DJ
    - `dj_gallery` - galeria zdjęć z imprez
    - `dj_themes` - DJ-e tematyczni (lata 80/90, disco, latino, itp)
    - `dj_benefits` - korzyści dla klienta

  2. Security
    - Enable RLS na wszystkich tabelach
    - Public read access
    - Admin/website_edit write access
*/

-- DJ Intro
CREATE TABLE IF NOT EXISTS dj_intro (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  subtitle text NOT NULL,
  description text NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE dj_intro ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can view dj intro"
  ON dj_intro FOR SELECT
  USING (true);

CREATE POLICY "Admins manage dj intro"
  ON dj_intro FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM employees WHERE employees.id = auth.uid() AND 'admin' = ANY(employees.permissions)))
  WITH CHECK (EXISTS (SELECT 1 FROM employees WHERE employees.id = auth.uid() AND 'admin' = ANY(employees.permissions)));

CREATE POLICY "Website editors manage dj intro"
  ON dj_intro FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM employees WHERE employees.id = auth.uid() AND 'website_edit' = ANY(employees.permissions)))
  WITH CHECK (EXISTS (SELECT 1 FROM employees WHERE employees.id = auth.uid() AND 'website_edit' = ANY(employees.permissions)));

-- DJ Packages (Standard, Premium, VIP)
CREATE TABLE IF NOT EXISTS dj_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  level text NOT NULL CHECK (level IN ('Standard', 'Premium', 'VIP')),
  description text NOT NULL,
  price_from numeric(10,2),
  duration text,
  equipment jsonb,
  features text[] DEFAULT '{}',
  order_index integer NOT NULL DEFAULT 0,
  is_visible boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE dj_packages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can view visible dj packages"
  ON dj_packages FOR SELECT
  USING (is_visible = true);

CREATE POLICY "Admins manage dj packages"
  ON dj_packages FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM employees WHERE employees.id = auth.uid() AND 'admin' = ANY(employees.permissions)))
  WITH CHECK (EXISTS (SELECT 1 FROM employees WHERE employees.id = auth.uid() AND 'admin' = ANY(employees.permissions)));

CREATE POLICY "Website editors manage dj packages"
  ON dj_packages FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM employees WHERE employees.id = auth.uid() AND 'website_edit' = ANY(employees.permissions)))
  WITH CHECK (EXISTS (SELECT 1 FROM employees WHERE employees.id = auth.uid() AND 'website_edit' = ANY(employees.permissions)));

-- DJ Features
CREATE TABLE IF NOT EXISTS dj_features (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text NOT NULL,
  icon_name text,
  order_index integer NOT NULL DEFAULT 0,
  is_visible boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE dj_features ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can view visible dj features"
  ON dj_features FOR SELECT
  USING (is_visible = true);

CREATE POLICY "Admins manage dj features"
  ON dj_features FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM employees WHERE employees.id = auth.uid() AND 'admin' = ANY(employees.permissions)))
  WITH CHECK (EXISTS (SELECT 1 FROM employees WHERE employees.id = auth.uid() AND 'admin' = ANY(employees.permissions)));

CREATE POLICY "Website editors manage dj features"
  ON dj_features FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM employees WHERE employees.id = auth.uid() AND 'website_edit' = ANY(employees.permissions)))
  WITH CHECK (EXISTS (SELECT 1 FROM employees WHERE employees.id = auth.uid() AND 'website_edit' = ANY(employees.permissions)));

-- DJ Gallery
CREATE TABLE IF NOT EXISTS dj_gallery (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  image_url text NOT NULL,
  title text,
  description text,
  order_index integer NOT NULL DEFAULT 0,
  is_visible boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE dj_gallery ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can view visible dj gallery"
  ON dj_gallery FOR SELECT
  USING (is_visible = true);

CREATE POLICY "Admins manage dj gallery"
  ON dj_gallery FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM employees WHERE employees.id = auth.uid() AND 'admin' = ANY(employees.permissions)))
  WITH CHECK (EXISTS (SELECT 1 FROM employees WHERE employees.id = auth.uid() AND 'admin' = ANY(employees.permissions)));

CREATE POLICY "Website editors manage dj gallery"
  ON dj_gallery FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM employees WHERE employees.id = auth.uid() AND 'website_edit' = ANY(employees.permissions)))
  WITH CHECK (EXISTS (SELECT 1 FROM employees WHERE employees.id = auth.uid() AND 'website_edit' = ANY(employees.permissions)));

-- DJ Themes (DJ-e tematyczni)
CREATE TABLE IF NOT EXISTS dj_themes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text NOT NULL,
  music_styles text[] DEFAULT '{}',
  image_url text,
  order_index integer NOT NULL DEFAULT 0,
  is_visible boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE dj_themes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can view visible dj themes"
  ON dj_themes FOR SELECT
  USING (is_visible = true);

CREATE POLICY "Admins manage dj themes"
  ON dj_themes FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM employees WHERE employees.id = auth.uid() AND 'admin' = ANY(employees.permissions)))
  WITH CHECK (EXISTS (SELECT 1 FROM employees WHERE employees.id = auth.uid() AND 'admin' = ANY(employees.permissions)));

CREATE POLICY "Website editors manage dj themes"
  ON dj_themes FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM employees WHERE employees.id = auth.uid() AND 'website_edit' = ANY(employees.permissions)))
  WITH CHECK (EXISTS (SELECT 1 FROM employees WHERE employees.id = auth.uid() AND 'website_edit' = ANY(employees.permissions)));

-- DJ Benefits
CREATE TABLE IF NOT EXISTS dj_benefits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text NOT NULL,
  order_index integer NOT NULL DEFAULT 0,
  is_visible boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE dj_benefits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can view visible dj benefits"
  ON dj_benefits FOR SELECT
  USING (is_visible = true);

CREATE POLICY "Admins manage dj benefits"
  ON dj_benefits FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM employees WHERE employees.id = auth.uid() AND 'admin' = ANY(employees.permissions)))
  WITH CHECK (EXISTS (SELECT 1 FROM employees WHERE employees.id = auth.uid() AND 'admin' = ANY(employees.permissions)));

CREATE POLICY "Website editors manage dj benefits"
  ON dj_benefits FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM employees WHERE employees.id = auth.uid() AND 'website_edit' = ANY(employees.permissions)))
  WITH CHECK (EXISTS (SELECT 1 FROM employees WHERE employees.id = auth.uid() AND 'website_edit' = ANY(employees.permissions)));

-- Indexes
CREATE INDEX IF NOT EXISTS idx_dj_packages_order ON dj_packages(order_index);
CREATE INDEX IF NOT EXISTS idx_dj_features_order ON dj_features(order_index);
CREATE INDEX IF NOT EXISTS idx_dj_gallery_order ON dj_gallery(order_index);
CREATE INDEX IF NOT EXISTS idx_dj_themes_order ON dj_themes(order_index);
CREATE INDEX IF NOT EXISTS idx_dj_benefits_order ON dj_benefits(order_index);

-- Sample Data - Intro
INSERT INTO dj_intro (title, subtitle, description) VALUES (
  'DJ na Imprezę - Profesjonalna Obsługa Muzyczna',
  'Rozgrzeją parkiet na każdym evencie',
  'Doświadczeni DJ-e z profesjonalnym sprzętem. Gramy od hitów disco lat 80/90, przez dance i house, po najnowsze przeboje z list przebojów. Dostosujemy repertuar do charakteru imprezy - od eleganckich gal korporacyjnych po szalone imprezy integracyjne.'
);

-- Sample Data - Packages
INSERT INTO dj_packages (name, level, description, price_from, duration, equipment, features, order_index) VALUES
(
  'DJ Standard',
  'Standard',
  'Idealne rozwiązanie dla kameralnych imprez firmowych, urodzin i eventów do 100 osób. DJ z własnym sprzętem nagłaśniającym i oświetleniem podstawowym.',
  2500.00,
  'do 4 godzin',
  '{"speakers": "2x kolumny aktywne 800W", "mixer": "Pioneer DDJ-400", "lighting": "2x PAR LED RGB", "laptop": "MacBook Pro z Serato"}'::jsonb,
  ARRAY['Konsultacja repertuaru', 'Podstawowe oświetlenie', 'Mikrofon bezprzewodowy', 'Odczytywanie życzeń'],
  1
),
(
  'DJ Premium',
  'Premium',
  'Pełen zestaw dla imprez do 250 osób. Profesjonalny sprzęt, rozbudowane oświetlenie, wytwornica dymu. DJ doświadczony w eventach firmowych i weselach.',
  5500.00,
  'do 6 godzin',
  '{"speakers": "Line array 2x1200W + 2x subwoofer 18", "mixer": "Pioneer XDJ-RX3", "lighting": "4x moving head, 2x LED bar, 2x PAR LED", "effects": "Wytwornica dymu heavy", "laptop": "MacBook Pro z Rekordbox"}'::jsonb,
  ARRAY['Konsultacja + playlist online', 'Profesjonalne oświetlenie', '2x mikrofon bezprzewodowy', 'Efekty specjalne (dym)', 'Backup sprzętu', 'Asystent DJ'],
  2
),
(
  'DJ VIP',
  'VIP',
  'Ekskluzywna obsługa dla najważniejszych eventów. Top DJ z doświadczeniem klubowym, najwyższej klasy sprzęt, pełne oświetlenie koncertowe, efekty specjalne.',
  12000.00,
  'bez limitu czasu',
  '{"speakers": "d&b audiotechnik line array", "mixer": "Pioneer CDJ-3000 + DJM-V10", "lighting": "8x moving head beam, 4x LED wash, stroboskopy, lasery", "effects": "Heavy fog, CO2 jets, konfetti", "extras": "LED DJ booth, neonowe logo"}'::jsonb,
  ARRAY['Spotkanie przedeventowe', 'Show świetlne synchronizowane', '4x mikrofon bezprzewodowy', 'Pełne efekty specjalne', 'Backup DJ on-site', '2x asystent techniczny', 'Personalizowane intro/outro', 'Zapis audio z imprezy'],
  3
);

-- Sample Data - Features
INSERT INTO dj_features (title, description, icon_name, order_index) VALUES
('Szeroki repertuar', 'Od disco lat 80/90, przez dance i house, po najnowsze hity. Dostosujemy playlistę do Waszych potrzeb.', 'music', 1),
('Profesjonalny sprzęt', 'Najwyższej klasy konsole Pioneer, nagłośnienie line array, oświetlenie LED i moving heads.', 'monitor', 2),
('Doświadczeni DJ-e', 'Nasi DJ-e mają setki eventów za sobą - od kameralnych urodzin po wielkie festiwale korporacyjne.', 'award', 3),
('Personalizacja', 'Każdy event jest inny. Stworzymy unikalną playlistę i dostosujemy tempo do charakteru imprezy.', 'settings', 4),
('Efekty specjalne', 'Dymy, CO2 jets, konfetti, lasery - dodatkowe atrakcje, które zapadną w pamięć gościom.', 'sparkles', 5),
('Backup i bezpieczeństwo', 'Zapasowy sprzęt, backup DJ w pakietach Premium/VIP. Zero ryzyka, 100% profesjonalizmu.', 'shield', 6);

-- Sample Data - Gallery
INSERT INTO dj_gallery (image_url, title, order_index) VALUES
('https://images.unsplash.com/photo-1470229722913-7c0e2dbbafd3?auto=format&fit=crop&w=800&q=80', 'DJ set na evencie firmowym', 1),
('https://images.unsplash.com/photo-1514525253161-7a46d19cd819?auto=format&fit=crop&w=800&q=80', 'Profesjonalna konsola Pioneer', 2),
('https://images.unsplash.com/photo-1571266028243-d220c6ae1fe4?auto=format&fit=crop&w=800&q=80', 'DJ podczas imprezy', 3),
('https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?auto=format&fit=crop&w=800&q=80', 'Parkiet pełen gości', 4),
('https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?auto=format&fit=crop&w=800&q=80', 'Oświetlenie sceniczne LED', 5),
('https://images.unsplash.com/photo-1492684223066-81342ee5ff30?auto=format&fit=crop&w=800&q=80', 'DJ booth z logo firmowym', 6);

-- Sample Data - Themes (DJ-e tematyczni)
INSERT INTO dj_themes (title, description, music_styles, order_index) VALUES
(
  'DJ Retro - Lata 80/90',
  'Nostalgiczna podróż w czasie. Kultowe hity Eurodance, Italo Disco, Hi-NRG. Michael Jackson, Madonna, Modern Talking, 2 Unlimited.',
  ARRAY['Disco', 'Eurodance', 'Italo Disco', 'Hi-NRG', 'Pop 80s/90s'],
  1
),
(
  'DJ Latino & Reggaeton',
  'Gorące rytmy z Ameryki Łacińskiej. Salsa, bachata, reggaeton, dembow. Idealne na letnie eventy i imprezy integracyjne.',
  ARRAY['Reggaeton', 'Salsa', 'Bachata', 'Merengue', 'Dembow', 'Latin Pop'],
  2
),
(
  'DJ House & Techno',
  'Dla miłośników klubowego brzmienia. Deep house, tech house, minimal techno. Klimat jak na najlepszych afterach.',
  ARRAY['Deep House', 'Tech House', 'Minimal Techno', 'Progressive House'],
  3
),
(  
  'DJ Hip-Hop & R&B',
  'Old school i nowe szkoła hip-hopu. Klasyki Tupaca i Biggiego, trap, drill. Plus R&B dla chwil oddechu.',
  ARRAY['Hip-Hop', 'Trap', 'Drill', 'Old School Rap', 'R&B', 'Soul'],
  4
),
(
  'DJ Chart Hits',
  'Najnowsze przeboje z list przebojów. Top 100, viral TikTok, hity radiowe. Gwarantowany rozgrzany parkiet.',
  ARRAY['Pop', 'Dance', 'EDM', 'Chart Hits', 'Viral TikTok'],
  5
),
(
  'DJ Rock & Alternative',
  'Dla tych, którzy wolą gitarowe brzmienie. Classic rock, indie, punk rock, grunge. Od Led Zeppelin po Arctic Monkeys.',
  ARRAY['Classic Rock', 'Indie Rock', 'Alternative', 'Punk Rock', 'Grunge'],
  6
);

-- Sample Data - Benefits
INSERT INTO dj_benefits (title, description, order_index) VALUES
('Konsultacja repertuaru', 'Przed eventem spotykamy się (online/stacjonarnie) i omawiamy Wasze oczekiwania. Możecie przesłać playlistę życzeń.', 1),
('Adaptacja do nastroju', 'DJ czyta energię tańczących i dostosuje tempo - od powolnych ballad po energiczne hity.', 2),
('Obsługa ceremonii', 'Przywitanie gości, wejście VIP-ów, toast, tort - zapowiemy każdy ważny moment Waszej imprezy.', 3),
('Personalizacja pakietu', 'Nie pasuje Standard ani Premium? Stworzymy ofertę szytą na miarę - dodamy/odejmiemy elementy.', 4),
('Sprzęt zapasowy', 'W pakietach Premium i VIP zawsze mamy backup sprzętu. Zero stresu, zero niespodzianek.', 5),
('Doświadczenie eventowe', 'Pracowaliśmy z markami jak PZU, Orange, Coca-Cola. Wiemy jak obsłużyć wymagających klientów korporacyjnych.', 6);