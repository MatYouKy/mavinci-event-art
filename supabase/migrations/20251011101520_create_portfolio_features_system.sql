/*
  # System zarządzania cechami (features) projektów portfolio z ikonami

  1. Nowe Tabele
    - `available_icons` - globalna lista dostępnych ikon z lucide-react
    - `portfolio_project_features` - cechy/mocne strony przypisane do konkretnych projektów
  
  2. Funkcjonalność
    - Administrator może wybierać ikony z listy dostępnych
    - Każdy projekt może mieć dowolne ikony z własnymi opisami
    - Ikony są zapisywane jako nazwa komponentu z lucide-react (np. "Users", "Clock")
  
  3. Bezpieczeństwo
    - RLS włączone dla obu tabel
    - Publiczny dostęp do odczytu (projekty są publiczne)
    - Tylko autoryzowani użytkownicy mogą modyfikować
*/

-- Tabela z dostępnymi ikonami
CREATE TABLE IF NOT EXISTS available_icons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'general',
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE available_icons IS 'Globalna lista dostępnych ikon z lucide-react do wyboru w projektach';
COMMENT ON COLUMN available_icons.name IS 'Nazwa ikony z lucide-react (np. "Users", "Clock", "Award")';
COMMENT ON COLUMN available_icons.label IS 'Przyjazna nazwa po polsku (np. "Użytkownicy", "Czas", "Nagroda")';
COMMENT ON COLUMN available_icons.category IS 'Kategoria ikony (np. "ludzie", "czas", "jakość", "technologia")';

-- Tabela z cechami projektów
CREATE TABLE IF NOT EXISTS portfolio_project_features (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES portfolio_projects(id) ON DELETE CASCADE,
  icon_name TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  order_index INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE portfolio_project_features IS 'Cechy/mocne strony projektów portfolio z ikonami';
COMMENT ON COLUMN portfolio_project_features.icon_name IS 'Nazwa ikony z lucide-react';
COMMENT ON COLUMN portfolio_project_features.title IS 'Tytuł cechy (np. "Profesjonalna Obsługa")';
COMMENT ON COLUMN portfolio_project_features.description IS 'Opcjonalny opis cechy';

-- Indeksy dla wydajności
CREATE INDEX IF NOT EXISTS idx_portfolio_features_project 
  ON portfolio_project_features(project_id);

CREATE INDEX IF NOT EXISTS idx_available_icons_category 
  ON available_icons(category);

-- RLS dla available_icons
ALTER TABLE available_icons ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read available icons"
  ON available_icons FOR SELECT
  TO public
  USING (true);

CREATE POLICY "Authenticated users can insert icons"
  ON available_icons FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update icons"
  ON available_icons FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can delete icons"
  ON available_icons FOR DELETE
  TO authenticated
  USING (true);

-- RLS dla portfolio_project_features
ALTER TABLE portfolio_project_features ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read project features"
  ON portfolio_project_features FOR SELECT
  TO public
  USING (true);

CREATE POLICY "Authenticated users can insert project features"
  ON portfolio_project_features FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update project features"
  ON portfolio_project_features FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can delete project features"
  ON portfolio_project_features FOR DELETE
  TO authenticated
  USING (true);

-- Wstaw popularną bazę ikon
INSERT INTO available_icons (name, label, category, description) VALUES
  -- Ludzie
  ('Users', 'Zespół', 'ludzie', 'Profesjonalny zespół'),
  ('UserCheck', 'Ekspert', 'ludzie', 'Eksperci w swojej dziedzinie'),
  ('UsersRound', 'Grupa', 'ludzie', 'Duża grupa uczestników'),
  
  -- Czas
  ('Clock', 'Terminowość', 'czas', 'Dotrzymanie terminów'),
  ('Timer', 'Szybkość', 'czas', 'Szybka realizacja'),
  ('Calendar', 'Planowanie', 'czas', 'Dobre planowanie'),
  
  -- Jakość
  ('Award', 'Jakość', 'jakość', 'Najwyższa jakość'),
  ('Star', 'Wyróżnienie', 'jakość', 'Nagradzana realizacja'),
  ('BadgeCheck', 'Certyfikat', 'jakość', 'Certyfikowana jakość'),
  ('Target', 'Precyzja', 'jakość', 'Precyzyjna realizacja'),
  
  -- Technologia
  ('Lightbulb', 'Innowacyjność', 'technologia', 'Innowacyjne rozwiązania'),
  ('Zap', 'Energia', 'technologia', 'Pełna energii'),
  ('Radio', 'Sprzęt', 'technologia', 'Profesjonalny sprzęt'),
  ('Settings', 'Konfiguracja', 'technologia', 'Dopasowana konfiguracja'),
  ('Mic', 'Audio', 'technologia', 'Profesjonalne audio'),
  
  -- Realizacja
  ('CheckCircle2', 'Kompleksowość', 'realizacja', 'Kompleksowa realizacja'),
  ('Package', 'Kompletność', 'realizacja', 'Kompletne wyposażenie'),
  ('Truck', 'Logistyka', 'realizacja', 'Sprawna logistyka'),
  ('Wrench', 'Serwis', 'realizacja', 'Pełen serwis'),
  
  -- Sukces
  ('TrendingUp', 'Wzrost', 'sukces', 'Rosnące wyniki'),
  ('ThumbsUp', 'Zadowolenie', 'sukces', 'Zadowolony klient'),
  ('Heart', 'Pasja', 'sukces', 'Z pasją i zaangażowaniem'),
  ('Sparkles', 'Wyjątkowość', 'sukces', 'Wyjątkowe wydarzenie')
ON CONFLICT (name) DO NOTHING;
