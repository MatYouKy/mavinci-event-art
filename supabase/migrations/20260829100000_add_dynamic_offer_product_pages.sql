/*
  # Dynamiczne karty produktow w ofertach

  - rozszerza katalog produktow o dane prezentacyjne uzywane w PDF
  - dodaje powtarzalny typ szablonu `product`
  - zapisuje niezmienny snapshot danych dla kazdego wygenerowania oferty
*/

ALTER TABLE offer_products
  ADD COLUMN IF NOT EXISTS offer_short_description text,
  ADD COLUMN IF NOT EXISTS offer_description text,
  ADD COLUMN IF NOT EXISTS offer_benefits jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS offer_image_path text,
  ADD COLUMN IF NOT EXISTS offer_image_alt text,
  ADD COLUMN IF NOT EXISTS offer_page_variant text NOT NULL DEFAULT 'default',
  ADD COLUMN IF NOT EXISTS offer_page_enabled boolean NOT NULL DEFAULT true;

ALTER TABLE offer_products
  DROP CONSTRAINT IF EXISTS offer_products_offer_benefits_is_array;

ALTER TABLE offer_products
  ADD CONSTRAINT offer_products_offer_benefits_is_array
  CHECK (jsonb_typeof(offer_benefits) = 'array');

COMMENT ON COLUMN offer_products.offer_short_description IS
  'Krotki, zatwierdzony opis produktu wyswietlany w ofercie PDF';
COMMENT ON COLUMN offer_products.offer_description IS
  'Pelny, zatwierdzony opis produktu wyswietlany w ofercie PDF';
COMMENT ON COLUMN offer_products.offer_benefits IS
  'Lista zatwierdzonych korzysci produktu wyswietlanych w ofercie PDF';
COMMENT ON COLUMN offer_products.offer_image_path IS
  'Sciezka grafiki produktu w bucket offer-product-pages';
COMMENT ON COLUMN offer_products.offer_page_variant IS
  'Wariant karty produktu; przygotowany pod kolejne wersje layoutu';

ALTER TABLE offer_page_templates
  DROP CONSTRAINT IF EXISTS offer_page_templates_type_check;

ALTER TABLE offer_page_templates
  ADD CONSTRAINT offer_page_templates_type_check
  CHECK (type IN ('cover', 'about', 'product', 'pricing', 'final'));

ALTER TABLE offer_page_templates
  ADD COLUMN IF NOT EXISTS variant_key text NOT NULL DEFAULT 'default';

COMMENT ON COLUMN offer_page_templates.variant_key IS
  'Wariant layoutu; dla kart produktow: default, compact lub visual';

CREATE TABLE IF NOT EXISTS offer_generation_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_id uuid NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
  generation_number integer NOT NULL,
  snapshot_version integer NOT NULL DEFAULT 1,
  snapshot jsonb NOT NULL,
  generated_pdf_path text,
  generated_by uuid REFERENCES employees(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (offer_id, generation_number)
);

CREATE INDEX IF NOT EXISTS idx_offer_generation_snapshots_offer_created
  ON offer_generation_snapshots (offer_id, created_at DESC);

ALTER TABLE offer_generation_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Employees can view offer generation snapshots"
  ON offer_generation_snapshots;
CREATE POLICY "Employees can view offer generation snapshots"
  ON offer_generation_snapshots FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM employees
      WHERE employees.id = auth.uid()
        AND employees.is_active = true
        AND (
          employees.role = 'admin'
          OR 'offers_view' = ANY(COALESCE(employees.permissions, ARRAY[]::text[]))
          OR 'offers_manage' = ANY(COALESCE(employees.permissions, ARRAY[]::text[]))
        )
    )
  );

COMMENT ON TABLE offer_generation_snapshots IS
  'Niezmienny zapis danych z CRM uzytych do wygenerowania konkretnej wersji PDF';
