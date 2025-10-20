/*
  # System katalogu produktów i usług dla ofert

  1. Nowe tabele
    - `offer_product_categories` - kategorie produktów (DJ, Nagłośnienie, Oświetlenie, itp.)
    - `offer_products` - katalog produktów/usług (DJ Standard, DJ Premium, itp.)
    - `offer_product_equipment` - wymagany sprzęt dla produktu
    - `offer_product_staff` - wymagani pracownicy dla produktu
    - `offer_product_costs` - koszty produktu (baza, transport, logistyka)
    - `offer_items` - pozycje w ofercie (konkretne produkty dodane do oferty)
    - `offer_templates` - szablony ofert PDF

  2. Security
    - RLS dla wszystkich tabel
    - Pracownicy z uprawnieniami offers_manage mogą zarządzać
    - Katalog produktów widoczny dla wszystkich pracowników
*/

-- Kategorie produktów
CREATE TABLE IF NOT EXISTS offer_product_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  icon text,
  display_order integer DEFAULT 0,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Katalog produktów/usług
CREATE TABLE IF NOT EXISTS offer_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id uuid REFERENCES offer_product_categories(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,

  -- Ceny
  base_price numeric(10, 2) NOT NULL DEFAULT 0,
  cost_price numeric(10, 2) DEFAULT 0,

  -- Transport i logistyka
  transport_cost numeric(10, 2) DEFAULT 0,
  logistics_cost numeric(10, 2) DEFAULT 0,
  setup_time_hours numeric(4, 2) DEFAULT 0,
  teardown_time_hours numeric(4, 2) DEFAULT 0,

  -- Dodatkowe informacje
  unit text DEFAULT 'szt',
  min_quantity integer DEFAULT 1,
  max_quantity integer,

  -- Wymagania
  requires_vehicle boolean DEFAULT false,
  requires_driver boolean DEFAULT false,

  -- Metadane
  tags text[],
  is_active boolean DEFAULT true,
  display_order integer DEFAULT 0,

  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Wymagany sprzęt dla produktu
CREATE TABLE IF NOT EXISTS offer_product_equipment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid REFERENCES offer_products(id) ON DELETE CASCADE,
  equipment_item_id uuid REFERENCES equipment_items(id) ON DELETE CASCADE,
  quantity integer DEFAULT 1,
  is_optional boolean DEFAULT false,
  notes text,
  created_at timestamptz DEFAULT now(),
  UNIQUE(product_id, equipment_item_id)
);

-- Wymagani pracownicy dla produktu
CREATE TABLE IF NOT EXISTS offer_product_staff (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid REFERENCES offer_products(id) ON DELETE CASCADE,
  role text NOT NULL,
  quantity integer DEFAULT 1,
  hourly_rate numeric(10, 2),
  estimated_hours numeric(4, 2),
  required_skills text[],
  is_optional boolean DEFAULT false,
  notes text,
  created_at timestamptz DEFAULT now()
);

-- Pozycje w ofercie
CREATE TABLE IF NOT EXISTS offer_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_id uuid REFERENCES offers(id) ON DELETE CASCADE,
  product_id uuid REFERENCES offer_products(id) ON DELETE SET NULL,

  -- Szczegóły pozycji
  name text NOT NULL,
  description text,
  quantity integer DEFAULT 1,
  unit text DEFAULT 'szt',

  -- Ceny
  unit_price numeric(10, 2) NOT NULL,
  unit_cost numeric(10, 2),
  discount_percent numeric(5, 2) DEFAULT 0,
  discount_amount numeric(10, 2) DEFAULT 0,

  -- Dodatkowe koszty
  transport_cost numeric(10, 2) DEFAULT 0,
  logistics_cost numeric(10, 2) DEFAULT 0,

  -- Wyliczenia (computed)
  subtotal numeric(10, 2) GENERATED ALWAYS AS (
    (unit_price * quantity) - discount_amount
  ) STORED,
  total numeric(10, 2) GENERATED ALWAYS AS (
    ((unit_price * quantity) - discount_amount) + transport_cost + logistics_cost
  ) STORED,

  -- Metadane
  display_order integer DEFAULT 0,
  notes text,

  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Szablony ofert PDF
CREATE TABLE IF NOT EXISTS offer_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,

  -- Szablon HTML
  header_html text,
  footer_html text,
  styles_css text,

  -- Ustawienia
  show_logo boolean DEFAULT true,
  show_company_details boolean DEFAULT true,
  show_client_details boolean DEFAULT true,
  show_terms boolean DEFAULT true,
  show_payment_info boolean DEFAULT true,

  -- Treści
  terms_text text,
  payment_info_text text,
  footer_text text,

  -- Metadane
  is_default boolean DEFAULT false,
  is_active boolean DEFAULT true,

  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Rozszerz tabelę offers o nowe pola
ALTER TABLE offers ADD COLUMN IF NOT EXISTS template_id uuid REFERENCES offer_templates(id) ON DELETE SET NULL;
ALTER TABLE offers ADD COLUMN IF NOT EXISTS subtotal numeric(10, 2) DEFAULT 0;
ALTER TABLE offers ADD COLUMN IF NOT EXISTS discount_percent numeric(5, 2) DEFAULT 0;
ALTER TABLE offers ADD COLUMN IF NOT EXISTS discount_amount numeric(10, 2) DEFAULT 0;
ALTER TABLE offers ADD COLUMN IF NOT EXISTS tax_percent numeric(5, 2) DEFAULT 23;
ALTER TABLE offers ADD COLUMN IF NOT EXISTS tax_amount numeric(10, 2) DEFAULT 0;
ALTER TABLE offers ADD COLUMN IF NOT EXISTS total_cost numeric(10, 2) DEFAULT 0;
ALTER TABLE offers ADD COLUMN IF NOT EXISTS margin_amount numeric(10, 2) DEFAULT 0;
ALTER TABLE offers ADD COLUMN IF NOT EXISTS margin_percent numeric(5, 2) DEFAULT 0;

-- Indeksy
CREATE INDEX IF NOT EXISTS idx_offer_products_category ON offer_products(category_id);
CREATE INDEX IF NOT EXISTS idx_offer_product_equipment_product ON offer_product_equipment(product_id);
CREATE INDEX IF NOT EXISTS idx_offer_product_staff_product ON offer_product_staff(product_id);
CREATE INDEX IF NOT EXISTS idx_offer_items_offer ON offer_items(offer_id);
CREATE INDEX IF NOT EXISTS idx_offer_items_product ON offer_items(product_id);

-- Enable RLS
ALTER TABLE offer_product_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE offer_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE offer_product_equipment ENABLE ROW LEVEL SECURITY;
ALTER TABLE offer_product_staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE offer_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE offer_templates ENABLE ROW LEVEL SECURITY;

-- RLS Policies: Kategorie produktów (wszyscy mogą czytać, tylko z uprawnieniami mogą edytować)
CREATE POLICY "Everyone can view product categories"
  ON offer_product_categories FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Managers can manage product categories"
  ON offer_product_categories FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND (employees.role = 'admin' OR 'offers_manage' = ANY(employees.permissions))
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND (employees.role = 'admin' OR 'offers_manage' = ANY(employees.permissions))
    )
  );

-- RLS Policies: Produkty (wszyscy mogą czytać, tylko z uprawnieniami mogą edytować)
CREATE POLICY "Everyone can view products"
  ON offer_products FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Managers can manage products"
  ON offer_products FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND (employees.role = 'admin' OR 'offers_manage' = ANY(employees.permissions))
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND (employees.role = 'admin' OR 'offers_manage' = ANY(employees.permissions))
    )
  );

-- RLS Policies: Wymagany sprzęt (wszyscy mogą czytać, tylko z uprawnieniami mogą edytować)
CREATE POLICY "Everyone can view product equipment"
  ON offer_product_equipment FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Managers can manage product equipment"
  ON offer_product_equipment FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND (employees.role = 'admin' OR 'offers_manage' = ANY(employees.permissions))
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND (employees.role = 'admin' OR 'offers_manage' = ANY(employees.permissions))
    )
  );

-- RLS Policies: Wymagani pracownicy (wszyscy mogą czytać, tylko z uprawnieniami mogą edytować)
CREATE POLICY "Everyone can view product staff"
  ON offer_product_staff FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Managers can manage product staff"
  ON offer_product_staff FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND (employees.role = 'admin' OR 'offers_manage' = ANY(employees.permissions))
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND (employees.role = 'admin' OR 'offers_manage' = ANY(employees.permissions))
    )
  );

-- RLS Policies: Pozycje ofert (dostęp jak do ofert)
CREATE POLICY "Employees can view offer items"
  ON offer_items FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM offers o
      JOIN employees e ON e.id = auth.uid()
      WHERE o.id = offer_items.offer_id
      AND (
        e.role = 'admin'
        OR 'offers_manage' = ANY(e.permissions)
        OR o.created_by = e.id
      )
    )
  );

CREATE POLICY "Employees can manage offer items"
  ON offer_items FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM offers o
      JOIN employees e ON e.id = auth.uid()
      WHERE o.id = offer_items.offer_id
      AND (
        e.role = 'admin'
        OR 'offers_manage' = ANY(e.permissions)
        OR (o.created_by = e.id AND o.status = 'draft')
      )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM offers o
      JOIN employees e ON e.id = auth.uid()
      WHERE o.id = offer_items.offer_id
      AND (
        e.role = 'admin'
        OR 'offers_manage' = ANY(e.permissions)
        OR (o.created_by = e.id AND o.status = 'draft')
      )
    )
  );

-- RLS Policies: Szablony ofert (wszyscy mogą czytać, tylko z uprawnieniami mogą edytować)
CREATE POLICY "Everyone can view offer templates"
  ON offer_templates FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Managers can manage offer templates"
  ON offer_templates FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND (employees.role = 'admin' OR 'offers_manage' = ANY(employees.permissions))
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND (employees.role = 'admin' OR 'offers_manage' = ANY(employees.permissions))
    )
  );

-- Triggery updated_at
CREATE TRIGGER update_offer_product_categories_updated_at
  BEFORE UPDATE ON offer_product_categories
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_offer_products_updated_at
  BEFORE UPDATE ON offer_products
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_offer_items_updated_at
  BEFORE UPDATE ON offer_items
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_offer_templates_updated_at
  BEFORE UPDATE ON offer_templates
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Funkcja do obliczania sum w ofercie
CREATE OR REPLACE FUNCTION calculate_offer_totals(offer_uuid uuid)
RETURNS void AS $$
DECLARE
  v_subtotal numeric(10, 2);
  v_total_cost numeric(10, 2);
  v_discount_amount numeric(10, 2);
  v_tax_amount numeric(10, 2);
  v_total_amount numeric(10, 2);
  v_discount_percent numeric(5, 2);
  v_tax_percent numeric(5, 2);
BEGIN
  -- Pobierz procent rabatu i VAT z oferty
  SELECT discount_percent, tax_percent INTO v_discount_percent, v_tax_percent
  FROM offers WHERE id = offer_uuid;

  -- Suma wartości pozycji (przed rabatem)
  SELECT COALESCE(SUM((unit_price * quantity) + transport_cost + logistics_cost), 0)
  INTO v_subtotal
  FROM offer_items
  WHERE offer_id = offer_uuid;

  -- Suma kosztów pozycji
  SELECT COALESCE(SUM(COALESCE(unit_cost, 0) * quantity), 0)
  INTO v_total_cost
  FROM offer_items
  WHERE offer_id = offer_uuid;

  -- Oblicz rabat
  v_discount_amount := (v_subtotal * COALESCE(v_discount_percent, 0)) / 100;

  -- Oblicz VAT (od wartości po rabacie)
  v_tax_amount := ((v_subtotal - v_discount_amount) * COALESCE(v_tax_percent, 23)) / 100;

  -- Oblicz kwotę końcową
  v_total_amount := v_subtotal - v_discount_amount + v_tax_amount;

  -- Zaktualizuj ofertę
  UPDATE offers SET
    subtotal = v_subtotal,
    discount_amount = v_discount_amount,
    tax_amount = v_tax_amount,
    total_amount = v_total_amount,
    total_cost = v_total_cost,
    margin_amount = v_total_amount - v_total_cost,
    margin_percent = CASE
      WHEN v_total_amount > 0 THEN ((v_total_amount - v_total_cost) / v_total_amount) * 100
      ELSE 0
    END
  WHERE id = offer_uuid;
END;
$$ LANGUAGE plpgsql;

-- Trigger do automatycznego przeliczania sum przy zmianach w pozycjach
CREATE OR REPLACE FUNCTION trigger_recalculate_offer_totals()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM calculate_offer_totals(OLD.offer_id);
    RETURN OLD;
  ELSE
    PERFORM calculate_offer_totals(NEW.offer_id);
    RETURN NEW;
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER recalculate_offer_totals_on_items_change
  AFTER INSERT OR UPDATE OR DELETE ON offer_items
  FOR EACH ROW
  EXECUTE FUNCTION trigger_recalculate_offer_totals();
