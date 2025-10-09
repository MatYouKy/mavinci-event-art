/*
  # Rozszerzenie systemu obrazów dla strony nagłośnienie

  1. Nowe tabele
    - `naglosnienie_gallery_images` - Galeria zdjęć sprzętu nagłaśniającego
      - `id` (uuid, primary key)
      - `section` (text) - identyfikator sekcji (np. 'naglosnienie-gallery-1', 'naglosnienie-gallery-2')
      - `name` (text) - nazwa obrazu
      - `description` (text) - opis obrazu
      - `image_url` (text) - URL obrazu
      - `alt_text` (text) - tekst alternatywny
      - `image_metadata` (jsonb) - metadane pozycji i skalowania
      - `opacity` (numeric) - przezroczystość
      - `order_index` (integer) - kolejność wyświetlania
      - `is_active` (boolean) - czy obraz jest aktywny
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

    - `naglosnienie_content` - Edytowalna treść tekstowa dla strony nagłośnienie
      - `id` (uuid, primary key)
      - `section` (text) - identyfikator sekcji treści
      - `title` (text) - tytuł sekcji
      - `content` (text) - treść sekcji
      - `order_index` (integer) - kolejność wyświetlania
      - `is_active` (boolean) - czy treść jest aktywna
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

  2. Bezpieczeństwo
    - Włączenie RLS dla wszystkich nowych tabel
    - Policy dla odczytu dla wszystkich użytkowników
    - Policy dla zapisu tylko dla uwierzytelnionych użytkowników (administratorów)

  3. Dane przykładowe
    - 3 przykładowe obrazy w galerii
    - 2 sekcje edytowalnej treści tekstowej
*/

CREATE TABLE IF NOT EXISTS naglosnienie_gallery_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  section text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  image_url text NOT NULL,
  alt_text text,
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
  opacity numeric DEFAULT 1.0 CHECK (opacity >= 0 AND opacity <= 1),
  order_index integer DEFAULT 0,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS naglosnienie_content (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  section text NOT NULL UNIQUE,
  title text NOT NULL,
  content text NOT NULL,
  order_index integer DEFAULT 0,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE naglosnienie_gallery_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE naglosnienie_content ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Wszyscy mogą przeglądać obrazy galerii nagłośnienia"
  ON naglosnienie_gallery_images FOR SELECT
  TO public
  USING (true);

CREATE POLICY "Uwierzytelnieni mogą wstawiać obrazy galerii nagłośnienia"
  ON naglosnienie_gallery_images FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Uwierzytelnieni mogą aktualizować obrazy galerii nagłośnienia"
  ON naglosnienie_gallery_images FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Uwierzytelnieni mogą usuwać obrazy galerii nagłośnienia"
  ON naglosnienie_gallery_images FOR DELETE
  TO authenticated
  USING (true);

CREATE POLICY "Wszyscy mogą przeglądać treść nagłośnienia"
  ON naglosnienie_content FOR SELECT
  TO public
  USING (true);

CREATE POLICY "Uwierzytelnieni mogą wstawiać treść nagłośnienia"
  ON naglosnienie_content FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Uwierzytelnieni mogą aktualizować treść nagłośnienia"
  ON naglosnienie_content FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Uwierzytelnieni mogą usuwać treść nagłośnienia"
  ON naglosnienie_content FOR DELETE
  TO authenticated
  USING (true);

INSERT INTO naglosnienie_gallery_images (section, name, description, image_url, alt_text, order_index) VALUES
  ('naglosnienie-gallery-1', 'Sprzęt audio 1', 'Profesjonalne systemy nagłaśniające', 'https://images.pexels.com/photos/164936/pexels-photo-164936.jpeg?auto=compress&cs=tinysrgb&w=1920', 'Profesjonalne głośniki na evencie', 1),
  ('naglosnienie-gallery-2', 'Sprzęt audio 2', 'Miksery i kontrolery audio', 'https://images.pexels.com/photos/1763075/pexels-photo-1763075.jpeg?auto=compress&cs=tinysrgb&w=1920', 'Mikser audio DJ', 2),
  ('naglosnienie-gallery-3', 'Sprzęt audio 3', 'Mikrofony i akcesoria', 'https://images.pexels.com/photos/1679618/pexels-photo-1679618.jpeg?auto=compress&cs=tinysrgb&w=1920', 'Mikrofony na scenie', 3)
ON CONFLICT (section) DO NOTHING;

INSERT INTO naglosnienie_content (section, title, content, order_index) VALUES
  ('naglosnienie-intro', 'Dlaczego my?', 'Posiadamy wieloletnie doświadczenie w zapewnianiu profesjonalnego nagłośnienia dla największych wydarzeń w Polsce. Nasz zespół techników audio gwarantuje najwyższą jakość dźwięku i bezawaryjną obsługę.', 1),
  ('naglosnienie-tech', 'Technologia', 'Wykorzystujemy najnowsze systemy audio line array od renomowanych producentów takich jak L-Acoustics, d&b audiotechnik i Meyer Sound. Każdy event poprzedzamy dokładnymi pomiarami akustycznymi i konfiguracją systemu.', 2)
ON CONFLICT (section) DO NOTHING;
