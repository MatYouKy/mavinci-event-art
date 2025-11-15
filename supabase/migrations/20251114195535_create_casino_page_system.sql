/*
  # System strony Kasyno

  1. Nowe Tabele
    - `casino_legal_popup` - treść popup'u z informacją prawną
    - `casino_tables` - stoły kasynowe (ruletka, blackjack, poker)
    - `casino_gallery` - galeria zdjęć kasyna
    - `casino_game_rules` - zasady gier (Texas Hold'em, Ruletka, Blackjack)
    - `casino_features` - edytowalne kafelki "Co oferujemy"
    - `casino_content_blocks` - elastyczny BlockEditor z układami grid

  2. Bezpieczeństwo
    - Enable RLS na wszystkich tabelach
    - Public SELECT dla wszystkich (widoczność publiczna)
    - Admin/Website manage dla INSERT/UPDATE/DELETE

  3. Domyślne Dane
    - Popup z informacją prawną
    - 3 stoły: Ruletka, Blackjack, Poker
    - Zasady gier
    - Aktualne features (bez punktacji i nagród)
*/

-- 1. Popup z informacją prawną
CREATE TABLE IF NOT EXISTS casino_legal_popup (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL DEFAULT 'Informacja prawna',
  content text NOT NULL,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE casino_legal_popup ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view legal popup"
  ON casino_legal_popup FOR SELECT
  TO public
  USING (true);

CREATE POLICY "Admins can manage legal popup"
  ON casino_legal_popup FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND (employees.role = 'admin' OR 'website_manage' = ANY(employees.permissions))
    )
  );

-- 2. Stoły kasynowe
CREATE TABLE IF NOT EXISTS casino_tables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text UNIQUE NOT NULL,
  description text,
  image_url text,
  image_alt text,
  order_index integer DEFAULT 0,
  is_visible boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE casino_tables ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view visible casino tables"
  ON casino_tables FOR SELECT
  TO public
  USING (is_visible = true);

CREATE POLICY "Admins can manage casino tables"
  ON casino_tables FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND (employees.role = 'admin' OR 'website_manage' = ANY(employees.permissions))
    )
  );

-- 3. Galeria kasyna
CREATE TABLE IF NOT EXISTS casino_gallery (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  image_url text NOT NULL,
  alt_text text,
  caption text,
  order_index integer DEFAULT 0,
  is_visible boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE casino_gallery ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view visible gallery images"
  ON casino_gallery FOR SELECT
  TO public
  USING (is_visible = true);

CREATE POLICY "Admins can manage gallery"
  ON casino_gallery FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND (employees.role = 'admin' OR 'website_manage' = ANY(employees.permissions))
    )
  );

-- 4. Zasady gier
CREATE TABLE IF NOT EXISTS casino_game_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_name text NOT NULL,
  slug text UNIQUE NOT NULL,
  short_description text,
  rules_content text NOT NULL,
  order_index integer DEFAULT 0,
  is_visible boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE casino_game_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view visible game rules"
  ON casino_game_rules FOR SELECT
  TO public
  USING (is_visible = true);

CREATE POLICY "Admins can manage game rules"
  ON casino_game_rules FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND (employees.role = 'admin' OR 'website_manage' = ANY(employees.permissions))
    )
  );

-- 5. Features "Co oferujemy"
CREATE TABLE IF NOT EXISTS casino_features (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  icon_name text DEFAULT 'CheckCircle2',
  order_index integer DEFAULT 0,
  is_visible boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE casino_features ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view visible features"
  ON casino_features FOR SELECT
  TO public
  USING (is_visible = true);

CREATE POLICY "Admins can manage features"
  ON casino_features FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND (employees.role = 'admin' OR 'website_manage' = ANY(employees.permissions))
    )
  );

-- 6. Content Blocks (elastyczny BlockEditor)
CREATE TABLE IF NOT EXISTS casino_content_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  content text,
  layout_type text NOT NULL CHECK (layout_type IN ('grid-4', 'grid-3', 'grid-2', 'grid-1')),
  order_index integer DEFAULT 0,
  is_visible boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE casino_content_blocks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view visible content blocks"
  ON casino_content_blocks FOR SELECT
  TO public
  USING (is_visible = true);

CREATE POLICY "Admins can manage content blocks"
  ON casino_content_blocks FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND (employees.role = 'admin' OR 'website_manage' = ANY(employees.permissions))
    )
  );
