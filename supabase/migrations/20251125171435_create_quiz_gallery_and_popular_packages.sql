/*
  # System galerii i popularnych pakietów dla quizów

  1. Nowe tabele
    - `quiz_show_gallery`
      - `id` (uuid, primary key)
      - `image_url` (text) - URL zdjęcia
      - `title` (text) - tytuł/opis zdjęcia
      - `order_index` (integer) - kolejność
      - `is_visible` (boolean)
      - `created_at`, `updated_at`
    
    - `quiz_popular_packages`
      - `id` (uuid, primary key)
      - `title` (text) - tytuł pakietu
      - `description` (text) - opis
      - `image_url` (text) - zdjęcie pakietu
      - `icon_id` (uuid) - FK do custom_icons
      - `order_index` (integer)
      - `is_visible` (boolean)
      - `created_at`, `updated_at`

  2. Security
    - Enable RLS
    - Public read access
    - Admin/website_edit write access
*/

-- Create quiz_show_gallery table
CREATE TABLE IF NOT EXISTS quiz_show_gallery (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  image_url text NOT NULL,
  title text,
  order_index integer NOT NULL DEFAULT 0,
  is_visible boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE quiz_show_gallery ENABLE ROW LEVEL SECURITY;

-- Public can read visible images
CREATE POLICY "Public can view visible quiz gallery images"
  ON quiz_show_gallery
  FOR SELECT
  USING (is_visible = true);

-- Admins have full access
CREATE POLICY "Admins have full access to quiz gallery"
  ON quiz_show_gallery
  FOR ALL
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

-- Website editors can manage
CREATE POLICY "Website editors can update quiz gallery"
  ON quiz_show_gallery
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

CREATE POLICY "Website editors can insert quiz gallery"
  ON quiz_show_gallery
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'website_edit' = ANY(employees.permissions)
    )
  );

CREATE POLICY "Website editors can delete quiz gallery"
  ON quiz_show_gallery
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'website_edit' = ANY(employees.permissions)
    )
  );

-- Create quiz_popular_packages table
CREATE TABLE IF NOT EXISTS quiz_popular_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text NOT NULL,
  image_url text,
  icon_id uuid REFERENCES custom_icons(id) ON DELETE SET NULL,
  order_index integer NOT NULL DEFAULT 0,
  is_visible boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE quiz_popular_packages ENABLE ROW LEVEL SECURITY;

-- Public can read visible packages
CREATE POLICY "Public can view visible quiz popular packages"
  ON quiz_popular_packages
  FOR SELECT
  USING (is_visible = true);

-- Admins have full access
CREATE POLICY "Admins have full access to quiz popular packages"
  ON quiz_popular_packages
  FOR ALL
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

-- Website editors can manage
CREATE POLICY "Website editors can update quiz popular packages"
  ON quiz_popular_packages
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

CREATE POLICY "Website editors can insert quiz popular packages"
  ON quiz_popular_packages
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'website_edit' = ANY(employees.permissions)
    )
  );

CREATE POLICY "Website editors can delete quiz popular packages"
  ON quiz_popular_packages
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'website_edit' = ANY(employees.permissions)
    )
  );

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_quiz_gallery_order ON quiz_show_gallery(order_index);
CREATE INDEX IF NOT EXISTS idx_quiz_gallery_visible ON quiz_show_gallery(is_visible);
CREATE INDEX IF NOT EXISTS idx_quiz_packages_order ON quiz_popular_packages(order_index);
CREATE INDEX IF NOT EXISTS idx_quiz_packages_visible ON quiz_popular_packages(is_visible);

-- Create updated_at triggers
CREATE OR REPLACE FUNCTION update_quiz_gallery_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER quiz_gallery_updated_at
  BEFORE UPDATE ON quiz_show_gallery
  FOR EACH ROW
  EXECUTE FUNCTION update_quiz_gallery_updated_at();

CREATE OR REPLACE FUNCTION update_quiz_packages_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER quiz_packages_updated_at
  BEFORE UPDATE ON quiz_popular_packages
  FOR EACH ROW
  EXECUTE FUNCTION update_quiz_packages_updated_at();

-- Insert sample data for gallery
INSERT INTO quiz_show_gallery (image_url, title, order_index) VALUES
('https://images.unsplash.com/photo-1528605105345-5344ea20e269?auto=format&fit=crop&w=800&q=80', 'Teleturniej z buzzerami na evencie firmowym', 1),
('https://images.unsplash.com/photo-1540575467063-178a50c2df87?auto=format&fit=crop&w=800&q=80', 'Profesjonalna scenografia studia telewizyjnego', 2),
('https://images.unsplash.com/photo-1511578314322-379afb476865?auto=format&fit=crop&w=800&q=80', 'Quiz z pilotami dla dużej grupy', 3);

-- Insert sample data for popular packages
INSERT INTO quiz_popular_packages (title, description, image_url, order_index) VALUES
(
  'QuizXpress - profesjonalne teleturnieje',
  'System quizowy używany w TVP i eventach korporacyjnych',
  'https://images.unsplash.com/photo-1543269664-76bc3997d9ea?auto=format&fit=crop&w=800&q=80',
  1
),
(
  'Ekrany LED do konferencji i gali',
  'Duże formaty LED do prezentacji i eventów premium',
  'https://images.unsplash.com/photo-1505373877841-8d25f7d46678?auto=format&fit=crop&w=800&q=80',
  2
),
(
  'Eventy zamknięte z hasłem',
  'Bezpieczne transmisje dla firm i instytucji',
  'https://images.unsplash.com/photo-1511795409834-ef04bbd61622?auto=format&fit=crop&w=800&q=80',
  3
);