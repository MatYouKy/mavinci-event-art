/*
  # System zarządzania funkcjami i zastosowaniami strony nagłośnienie

  1. Nowe tabele
    - `naglosnienie_features` - Zarządzalne cechy oferty nagłośnienia
      - `id` (uuid, primary key)
      - `title` (text) - tytuł cechy
      - `icon` (text) - nazwa ikony Lucide
      - `order_index` (integer) - kolejność wyświetlania
      - `is_active` (boolean) - czy cecha jest aktywna
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

    - `naglosnienie_applications` - Zarządzalne zastosowania nagłośnienia
      - `id` (uuid, primary key)
      - `title` (text) - tytuł zastosowania
      - `description` (text) - opis zastosowania
      - `image_url` (text) - URL obrazu
      - `image_metadata` (jsonb) - metadane pozycji obrazu
      - `order_index` (integer) - kolejność wyświetlania
      - `is_active` (boolean) - czy zastosowanie jest aktywne
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

  2. Bezpieczeństwo
    - Włączenie RLS dla wszystkich nowych tabel
    - Policy dla odczytu dla wszystkich użytkowników
    - Policy dla zapisu tylko dla uwierzytelnionych użytkowników

  3. Dane przykładowe
    - 8 przykładowych cech
    - 4 przykładowe zastosowania z obrazami
*/

CREATE TABLE IF NOT EXISTS naglosnienie_features (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  icon text DEFAULT 'CheckCircle2',
  order_index integer DEFAULT 0,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS naglosnienie_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text NOT NULL,
  image_url text NOT NULL,
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
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE naglosnienie_features ENABLE ROW LEVEL SECURITY;
ALTER TABLE naglosnienie_applications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Wszyscy mogą przeglądać cechy nagłośnienia"
  ON naglosnienie_features FOR SELECT
  TO public
  USING (true);

CREATE POLICY "Uwierzytelnieni mogą wstawiać cechy nagłośnienia"
  ON naglosnienie_features FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Uwierzytelnieni mogą aktualizować cechy nagłośnienia"
  ON naglosnienie_features FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Uwierzytelnieni mogą usuwać cechy nagłośnienia"
  ON naglosnienie_features FOR DELETE
  TO authenticated
  USING (true);

CREATE POLICY "Wszyscy mogą przeglądać zastosowania nagłośnienia"
  ON naglosnienie_applications FOR SELECT
  TO public
  USING (true);

CREATE POLICY "Uwierzytelnieni mogą wstawiać zastosowania nagłośnienia"
  ON naglosnienie_applications FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Uwierzytelnieni mogą aktualizować zastosowania nagłośnienia"
  ON naglosnienie_applications FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Uwierzytelnieni mogą usuwać zastosowania nagłośnienia"
  ON naglosnienie_applications FOR DELETE
  TO authenticated
  USING (true);

INSERT INTO naglosnienie_features (title, icon, order_index) VALUES
  ('Systemy line array najwyższej klasy', 'Music', 1),
  ('Monitory sceniczne i odsłuchy', 'Volume2', 2),
  ('Mikrofony bezprzewodowe i przewodowe', 'Radio', 3),
  ('Miksery cyfrowe z pełną kontrolą', 'Zap', 4),
  ('Procesory audio i equalizery', 'Settings', 5),
  ('Profesjonalna obsługa techniczna', 'Users', 6),
  ('Konfiguracja dostosowana do miejsca', 'MapPin', 7),
  ('Pomiary akustyczne i optymalizacja', 'Activity', 8)
ON CONFLICT DO NOTHING;

INSERT INTO naglosnienie_applications (title, description, image_url, order_index) VALUES
  ('Koncerty', 'Nagłośnienie scen koncertowych od 100 do 10000 osób. Systemy dostosowane do każdej wielkości wydarzenia.', 'https://images.pexels.com/photos/1105666/pexels-photo-1105666.jpeg?auto=compress&cs=tinysrgb&w=1920', 1),
  ('Konferencje', 'Wyraźny dźwięk dla prezentacji i wykładów. Zapewniamy doskonałą zrozumiałość mowy.', 'https://images.pexels.com/photos/2774556/pexels-photo-2774556.jpeg?auto=compress&cs=tinysrgb&w=1920', 2),
  ('Eventy Plenerowe', 'Systemy odporne na warunki atmosferyczne. Profesjonalne nagłośnienie pod chmurką.', 'https://images.pexels.com/photos/1190298/pexels-photo-1190298.jpeg?auto=compress&cs=tinysrgb&w=1920', 3),
  ('Imprezy Firmowe', 'Dyskretne nagłośnienie dla biznesu. Eleganckie rozwiązania audio dla eventów korporacyjnych.', 'https://images.pexels.com/photos/2608517/pexels-photo-2608517.jpeg?auto=compress&cs=tinysrgb&w=1920', 4)
ON CONFLICT DO NOTHING;
