/*
  # System formatów quizów i teleturniejów

  1. Nowe tabele
    - `quiz_show_formats`
      - `id` (uuid, primary key)
      - `title` (text) - tytuł formatu
      - `level` (text) - poziom zaawansowania
      - `description` (text) - opis
      - `features` (text[]) - lista cech
      - `image_url` (text) - URL zdjęcia
      - `icon_id` (uuid) - FK do custom_icons
      - `layout_direction` (text) - 'left' lub 'right' (zdjęcie po lewej/prawej)
      - `order_index` (integer) - kolejność wyświetlania
      - `is_visible` (boolean) - czy widoczny
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

  2. Security
    - Enable RLS
    - Public read access
    - Admin-only write access
*/

-- Create quiz_show_formats table
CREATE TABLE IF NOT EXISTS quiz_show_formats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  level text NOT NULL,
  description text NOT NULL,
  features text[] NOT NULL DEFAULT '{}',
  image_url text,
  icon_id uuid REFERENCES custom_icons(id) ON DELETE SET NULL,
  layout_direction text NOT NULL DEFAULT 'left' CHECK (layout_direction IN ('left', 'right')),
  order_index integer NOT NULL DEFAULT 0,
  is_visible boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE quiz_show_formats ENABLE ROW LEVEL SECURITY;

-- Public can read visible formats
CREATE POLICY "Anyone can view visible quiz show formats"
  ON quiz_show_formats
  FOR SELECT
  USING (is_visible = true);

-- Admins can view all formats
CREATE POLICY "Admins can view all quiz show formats"
  ON quiz_show_formats
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'admin' = ANY(employees.permissions)
    )
  );

-- Admins can insert formats
CREATE POLICY "Admins can insert quiz show formats"
  ON quiz_show_formats
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'admin' = ANY(employees.permissions)
    )
  );

-- Admins can update formats
CREATE POLICY "Admins can update quiz show formats"
  ON quiz_show_formats
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'admin' = ANY(employees.permissions)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'admin' = ANY(employees.permissions)
    )
  );

-- Admins can delete formats
CREATE POLICY "Admins can delete quiz show formats"
  ON quiz_show_formats
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'admin' = ANY(employees.permissions)
    )
  );

-- Users with website_edit permission can update formats
CREATE POLICY "Website editors can update quiz show formats"
  ON quiz_show_formats
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'website_edit' = ANY(employees.permissions)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'website_edit' = ANY(employees.permissions)
    )
  );

-- Create index for order
CREATE INDEX IF NOT EXISTS idx_quiz_show_formats_order ON quiz_show_formats(order_index);
CREATE INDEX IF NOT EXISTS idx_quiz_show_formats_visible ON quiz_show_formats(is_visible);

-- Create updated_at trigger
CREATE OR REPLACE FUNCTION update_quiz_show_formats_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER quiz_show_formats_updated_at
  BEFORE UPDATE ON quiz_show_formats
  FOR EACH ROW
  EXECUTE FUNCTION update_quiz_show_formats_updated_at();

-- Insert default data
INSERT INTO quiz_show_formats (title, level, description, features, image_url, layout_direction, order_index) VALUES
(
  'Klasyczne quizy wiedzy',
  'Proste',
  'Idealne na szybką integrację i pierwsze lodołamacze. Format 1 z 10 pytań, prostota i dynamika.',
  ARRAY['Pytania wielokrotnego wyboru', 'Szybka rozgrywka 15-30 min', 'Bez zaawansowanego sprzętu', 'Do 100 uczestników'],
  'https://images.unsplash.com/photo-1543269664-76bc3997d9ea?auto=format&fit=crop&w=800&q=80',
  'left',
  1
),
(
  'Quizy z buzzerami',
  'Średnio zaawansowane',
  'Dynamiczne teleturnieje z systemem buzzerów – kto pierwszy naciśnie, ten odpowiada. Emocje i rywalizacja.',
  ARRAY['Profesjonalne buzzery', 'System wykrywania pierwszeństwa', 'Wyniki na żywo na ekranie', 'Tryb drużynowy lub indywidualny'],
  'https://images.unsplash.com/photo-1505373877841-8d25f7d46678?auto=format&fit=crop&w=800&q=80',
  'right',
  2
),
(
  'Teleturnieje z pilotami',
  'Zaawansowane',
  'Każdy uczestnik otrzymuje bezprzewodowy pilot do głosowania. System zlicza odpowiedzi w czasie rzeczywistym.',
  ARRAY['Indywidualne piloty bezprzewodowe', 'Statystyki na żywo', 'Ranking uczestników', 'Do 500 osób jednocześnie'],
  'https://images.unsplash.com/photo-1511578314322-379afb476865?auto=format&fit=crop&w=800&q=80',
  'left',
  3
),
(
  'Multimedialne teleturnieje',
  'Premium',
  'Pełna produkcja z materiałami wideo, dźwiękiem, grafiką na ekranach LED. Format godny studia telewizyjnego.',
  ARRAY['Pytania wideo i audio', 'Profesjonalna scenografia', 'Konferansjer i realizator', 'Nagranie relacji wideo'],
  'https://images.unsplash.com/photo-1540575467063-178a50c2df87?auto=format&fit=crop&w=800&q=80',
  'right',
  4
),
(
  'Teleturnieje tematyczne',
  'Spersonalizowane',
  'Scenariusz dopasowany do branży, historii firmy lub tematyki wydarzenia. Pytania szyte na miarę.',
  ARRAY['Pytania o firmę/branżę', 'Personalizowana grafika', 'Wideo i zdjęcia klienta', 'Unikalna scenografia'],
  'https://images.unsplash.com/photo-1522202176988-66273c2fd55f?auto=format&fit=crop&w=800&q=80',
  'left',
  5
),
(
  'Teleturnieje dla VIP',
  'Ekskluzywne',
  'Najwyższa jakość realizacji na gale, jubileusze, uroczystości premium. Pełna obsługa produkcyjna.',
  ARRAY['Dedykowany scenariusz', 'Operator kamery i realizator', 'Nagrody luksusowe', 'Transmisja live opcjonalnie'],
  'https://images.unsplash.com/photo-1511795409834-ef04bbd61622?auto=format&fit=crop&w=800&q=80',
  'right',
  6
);