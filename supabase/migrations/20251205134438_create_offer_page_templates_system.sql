/*
  # System szablonów stron ofert PDF

  1. Nowe tabele
    - `offer_page_templates` - szablony stron ofert (pierwsza strona, o nas, wycena, ostatnia strona)
      - `id` (uuid, primary key)
      - `type` (text) - typ strony: 'cover', 'about', 'pricing', 'final'
      - `name` (text) - nazwa szablonu
      - `description` (text) - opis szablonu
      - `is_default` (boolean) - czy domyślny dla typu
      - `is_active` (boolean) - czy aktywny
      - `created_by` (uuid) - kto stworzył
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)
    
    - `offer_page_template_content` - zawartość szablonów stron
      - `id` (uuid, primary key)
      - `template_id` (uuid, foreign key)
      - `section_type` (text) - typ sekcji: 'header', 'body', 'footer', 'logo', 'company_details', 'seller_details'
      - `content_html` (text) - treść HTML/WYSIWYG
      - `content_json` (jsonb) - treść w formacie JSON dla edytora
      - `display_order` (integer) - kolejność wyświetlania
      - `styles` (jsonb) - style CSS
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

  2. Security
    - Enable RLS on all tables
    - Add policies for admin and website_edit permissions
*/

-- Tabela szablonów stron ofert
CREATE TABLE IF NOT EXISTS offer_page_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL CHECK (type IN ('cover', 'about', 'pricing', 'final')),
  name text NOT NULL,
  description text,
  is_default boolean DEFAULT false,
  is_active boolean DEFAULT true,
  created_by uuid REFERENCES employees(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Tabela zawartości szablonów
CREATE TABLE IF NOT EXISTS offer_page_template_content (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid REFERENCES offer_page_templates(id) ON DELETE CASCADE,
  section_type text NOT NULL,
  content_html text,
  content_json jsonb,
  display_order integer DEFAULT 0,
  styles jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Indeksy
CREATE INDEX IF NOT EXISTS idx_offer_page_templates_type ON offer_page_templates(type);
CREATE INDEX IF NOT EXISTS idx_offer_page_templates_is_default ON offer_page_templates(is_default) WHERE is_default = true;
CREATE INDEX IF NOT EXISTS idx_offer_page_template_content_template_id ON offer_page_template_content(template_id);
CREATE INDEX IF NOT EXISTS idx_offer_page_template_content_order ON offer_page_template_content(template_id, display_order);

-- Enable RLS
ALTER TABLE offer_page_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE offer_page_template_content ENABLE ROW LEVEL SECURITY;

-- RLS Policies dla offer_page_templates
CREATE POLICY "Allow read for authenticated users"
  ON offer_page_templates FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Allow insert for admin and website_edit"
  ON offer_page_templates FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees
      WHERE id = auth.uid()
      AND (permissions @> ARRAY['admin'] OR permissions @> ARRAY['website_edit'])
    )
  );

CREATE POLICY "Allow update for admin and website_edit"
  ON offer_page_templates FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE id = auth.uid()
      AND (permissions @> ARRAY['admin'] OR permissions @> ARRAY['website_edit'])
    )
  );

CREATE POLICY "Allow delete for admin"
  ON offer_page_templates FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE id = auth.uid()
      AND permissions @> ARRAY['admin']
    )
  );

-- RLS Policies dla offer_page_template_content
CREATE POLICY "Allow read for authenticated users"
  ON offer_page_template_content FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Allow insert for admin and website_edit"
  ON offer_page_template_content FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees
      WHERE id = auth.uid()
      AND (permissions @> ARRAY['admin'] OR permissions @> ARRAY['website_edit'])
    )
  );

CREATE POLICY "Allow update for admin and website_edit"
  ON offer_page_template_content FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE id = auth.uid()
      AND (permissions @> ARRAY['admin'] OR permissions @> ARRAY['website_edit'])
    )
  );

CREATE POLICY "Allow delete for admin and website_edit"
  ON offer_page_template_content FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE id = auth.uid()
      AND (permissions @> ARRAY['admin'] OR permissions @> ARRAY['website_edit'])
    )
  );

-- Trigger do aktualizacji updated_at
CREATE OR REPLACE FUNCTION update_offer_page_templates_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_offer_page_templates_updated_at
  BEFORE UPDATE ON offer_page_templates
  FOR EACH ROW
  EXECUTE FUNCTION update_offer_page_templates_updated_at();

CREATE TRIGGER update_offer_page_template_content_updated_at
  BEFORE UPDATE ON offer_page_template_content
  FOR EACH ROW
  EXECUTE FUNCTION update_offer_page_templates_updated_at();
