/*
  # System Kategorii Szablonów Ofert

  ## Opis
  Ten system pozwala na tworzenie różnych kategorii szablonów ofert (np. Wesela, Eventy, Konferencje),
  gdzie każda kategoria może mieć własny zestaw stron (tytułowa, wyceny, końcowa).

  ## Nowe Tabele
  
  ### `offer_template_categories`
  Przechowuje kategorie szablonów ofert
  - `id` (uuid, primary key)
  - `name` (text) - Nazwa kategorii (np. "Wesela", "Eventy firmowe")
  - `description` (text) - Opis kategorii
  - `is_default` (boolean) - Czy jest to domyślna kategoria
  - `color` (text) - Kolor dla UI
  - `created_at` (timestamptz)
  - `updated_at` (timestamptz)

  ## Modyfikacje

  ### Tabela `offer_page_templates`
  - Dodano `template_category_id` (uuid) - Powiązanie z kategorią szablonu
  - Dodano constraint aby zapewnić unikalność nazwy w obrębie kategorii

  ### Tabela `event_categories`
  - Dodano `default_offer_template_category_id` (uuid) - Domyślna kategoria szablonu dla tej kategorii wydarzeń

  ## Bezpieczeństwo
  - RLS włączone dla wszystkich tabel
  - Administratorzy i użytkownicy z uprawnieniem 'offers_manage' mogą zarządzać kategoriami
  - Publiczny dostęp tylko do odczytu

  ## Dane Przykładowe
  - Kategoria "Domyślna" (is_default = true)
  - Kategoria "Wesela"
  - Kategoria "Eventy firmowe"
  - Kategoria "Konferencje"
*/

-- =====================================================
-- 1. TWORZENIE TABELI KATEGORII SZABLONÓW
-- =====================================================

CREATE TABLE IF NOT EXISTS offer_template_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  description text,
  is_default boolean DEFAULT false,
  color text DEFAULT '#d3bb73',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Trigger do automatycznego ustawiania updated_at
CREATE OR REPLACE FUNCTION update_offer_template_categories_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS offer_template_categories_updated_at ON offer_template_categories;
CREATE TRIGGER offer_template_categories_updated_at
  BEFORE UPDATE ON offer_template_categories
  FOR EACH ROW
  EXECUTE FUNCTION update_offer_template_categories_updated_at();

-- Constraint: tylko jedna kategoria może być domyślna
CREATE UNIQUE INDEX IF NOT EXISTS idx_offer_template_categories_default
  ON offer_template_categories (is_default)
  WHERE is_default = true;

-- =====================================================
-- 2. MODYFIKACJA TABELI offer_page_templates
-- =====================================================

-- Dodanie kolumny template_category_id
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'offer_page_templates' AND column_name = 'template_category_id'
  ) THEN
    ALTER TABLE offer_page_templates
    ADD COLUMN template_category_id uuid REFERENCES offer_template_categories(id) ON DELETE CASCADE;
  END IF;
END $$;

-- Constraint: unikalna nazwa w obrębie kategorii i typu strony
DROP INDEX IF EXISTS idx_offer_page_templates_unique_name_per_category;
CREATE UNIQUE INDEX idx_offer_page_templates_unique_name_per_category
  ON offer_page_templates (template_category_id, type, name)
  WHERE template_category_id IS NOT NULL;

-- =====================================================
-- 3. MODYFIKACJA TABELI event_categories
-- =====================================================

-- Dodanie kolumny default_offer_template_category_id
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'event_categories' AND column_name = 'default_offer_template_category_id'
  ) THEN
    ALTER TABLE event_categories
    ADD COLUMN default_offer_template_category_id uuid REFERENCES offer_template_categories(id) ON DELETE SET NULL;
  END IF;
END $$;

-- =====================================================
-- 4. DANE PRZYKŁADOWE
-- =====================================================

-- Wstawianie kategorii szablonów (tylko jeśli nie istnieją)
INSERT INTO offer_template_categories (name, description, is_default, color)
VALUES 
  ('Domyślna', 'Uniwersalny szablon ofert', true, '#d3bb73'),
  ('Wesela', 'Szablony dedykowane dla wesel i eventów okolicznościowych', false, '#e91e63'),
  ('Eventy firmowe', 'Szablony dla eventów korporacyjnych i integracji', false, '#2196f3'),
  ('Konferencje', 'Szablony dla konferencji i szkoleń', false, '#4caf50')
ON CONFLICT (name) DO NOTHING;

-- Aktualizacja istniejących szablonów - przypisanie do kategorii domyślnej
DO $$
DECLARE
  default_category_id uuid;
BEGIN
  -- Pobierz ID kategorii domyślnej
  SELECT id INTO default_category_id
  FROM offer_template_categories
  WHERE is_default = true
  LIMIT 1;

  -- Przypisz istniejące szablony do kategorii domyślnej (jeśli nie mają przypisanej)
  IF default_category_id IS NOT NULL THEN
    UPDATE offer_page_templates
    SET template_category_id = default_category_id
    WHERE template_category_id IS NULL;
  END IF;
END $$;

-- =====================================================
-- 5. RLS POLICIES
-- =====================================================

-- Włączenie RLS
ALTER TABLE offer_template_categories ENABLE ROW LEVEL SECURITY;

-- Policy: Wszyscy mogą odczytywać kategorie szablonów
DROP POLICY IF EXISTS "Everyone can view offer template categories" ON offer_template_categories;
CREATE POLICY "Everyone can view offer template categories"
  ON offer_template_categories
  FOR SELECT
  USING (true);

-- Policy: Tylko admini i użytkownicy z 'offers_manage' lub 'website_edit' mogą zarządzać
DROP POLICY IF EXISTS "Admins can insert categories" ON offer_template_categories;
CREATE POLICY "Admins can insert categories"
  ON offer_template_categories
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees
      WHERE id = auth.uid()
      AND (permissions @> ARRAY['admin'] OR permissions @> ARRAY['website_edit'] OR permissions @> ARRAY['offers_manage'])
    )
  );

DROP POLICY IF EXISTS "Admins can update categories" ON offer_template_categories;
CREATE POLICY "Admins can update categories"
  ON offer_template_categories
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE id = auth.uid()
      AND (permissions @> ARRAY['admin'] OR permissions @> ARRAY['website_edit'] OR permissions @> ARRAY['offers_manage'])
    )
  );

DROP POLICY IF EXISTS "Admins can delete categories" ON offer_template_categories;
CREATE POLICY "Admins can delete categories"
  ON offer_template_categories
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE id = auth.uid()
      AND (permissions @> ARRAY['admin'] OR permissions @> ARRAY['website_edit'] OR permissions @> ARRAY['offers_manage'])
    )
  );

-- =====================================================
-- 6. INDEKSY
-- =====================================================

CREATE INDEX IF NOT EXISTS idx_offer_page_templates_category
  ON offer_page_templates(template_category_id);

CREATE INDEX IF NOT EXISTS idx_event_categories_template_category
  ON event_categories(default_offer_template_category_id);

-- =====================================================
-- 7. KOMENTARZE
-- =====================================================

COMMENT ON TABLE offer_template_categories IS 'Kategorie szablonów ofert (np. Wesela, Eventy, Konferencje)';
COMMENT ON COLUMN offer_template_categories.is_default IS 'Czy jest to domyślna kategoria używana gdy nie wybrano innej';
COMMENT ON COLUMN offer_page_templates.template_category_id IS 'Kategoria szablonu do której należy ta strona';
COMMENT ON COLUMN event_categories.default_offer_template_category_id IS 'Domyślna kategoria szablonu ofert dla tej kategorii wydarzeń';
