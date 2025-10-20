/*
  # System hierarchicznych kategorii i VAT dla produktów ofertowych

  1. Zmiany w tabelach
    - `offer_product_categories` - dodanie parent_id dla hierarchii
    - `offer_products` - dodanie vat_rate i pól netto/brutto
    - `offer_product_staff` - dodanie payment_type (invoice_no_vat, cash_no_receipt, invoice_with_vat)

  2. Nowe pola
    - Kategorie: parent_id, level, full_path
    - Produkty: vat_rate, price_net, price_gross, cost_net, cost_gross
    - Pracownicy: payment_type (faktura bez VAT, gotówka bez kwitu, faktura z VAT)

  3. Funkcje
    - Automatyczne przeliczanie cen netto/brutto
    - Funkcje pomocnicze do hierarchii kategorii
*/

-- Dodaj hierarchię do kategorii produktów
ALTER TABLE offer_product_categories
  ADD COLUMN IF NOT EXISTS parent_id uuid REFERENCES offer_product_categories(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS level integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS full_path text;

-- Dodaj VAT i ceny netto/brutto do produktów
ALTER TABLE offer_products
  ADD COLUMN IF NOT EXISTS vat_rate numeric(5, 2) DEFAULT 23.00,
  ADD COLUMN IF NOT EXISTS price_net numeric(10, 2),
  ADD COLUMN IF NOT EXISTS price_gross numeric(10, 2),
  ADD COLUMN IF NOT EXISTS cost_net numeric(10, 2),
  ADD COLUMN IF NOT EXISTS cost_gross numeric(10, 2),
  ADD COLUMN IF NOT EXISTS transport_cost_net numeric(10, 2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS transport_cost_gross numeric(10, 2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS logistics_cost_net numeric(10, 2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS logistics_cost_gross numeric(10, 2) DEFAULT 0;

-- Migruj istniejące dane (traktuj base_price jako netto, przelicz brutto)
UPDATE offer_products
SET
  price_net = base_price,
  price_gross = base_price * 1.23,
  cost_net = cost_price,
  cost_gross = cost_price * 1.23,
  transport_cost_net = transport_cost,
  transport_cost_gross = transport_cost * 1.23,
  logistics_cost_net = logistics_cost,
  logistics_cost_gross = logistics_cost * 1.23
WHERE price_net IS NULL;

-- Dodaj typ rozliczenia dla pracowników
ALTER TABLE offer_product_staff
  ADD COLUMN IF NOT EXISTS payment_type text DEFAULT 'invoice_with_vat'
    CHECK (payment_type IN ('invoice_with_vat', 'invoice_no_vat', 'cash_no_receipt'));

-- Dodaj komentarz do kolumny
COMMENT ON COLUMN offer_product_staff.payment_type IS
  'Typ rozliczenia: invoice_with_vat (faktura z VAT), invoice_no_vat (faktura bez VAT), cash_no_receipt (gotówka bez kwitu)';

-- Indeksy dla hierarchii
CREATE INDEX IF NOT EXISTS idx_offer_product_categories_parent
  ON offer_product_categories(parent_id);

CREATE INDEX IF NOT EXISTS idx_offer_product_categories_level
  ON offer_product_categories(level);

-- Funkcja do aktualizacji pełnej ścieżki kategorii
CREATE OR REPLACE FUNCTION update_category_path()
RETURNS TRIGGER AS $$
DECLARE
  parent_path text;
BEGIN
  IF NEW.parent_id IS NULL THEN
    NEW.level := 0;
    NEW.full_path := NEW.name;
  ELSE
    SELECT level + 1, full_path || ' > ' || NEW.name
    INTO NEW.level, NEW.full_path
    FROM offer_product_categories
    WHERE id = NEW.parent_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger do automatycznej aktualizacji ścieżki
DROP TRIGGER IF EXISTS trigger_update_category_path ON offer_product_categories;
CREATE TRIGGER trigger_update_category_path
  BEFORE INSERT OR UPDATE OF parent_id, name ON offer_product_categories
  FOR EACH ROW
  EXECUTE FUNCTION update_category_path();

-- Funkcja do przeliczania VAT dla produktu (z ceny netto na brutto)
CREATE OR REPLACE FUNCTION calculate_product_prices_from_net()
RETURNS TRIGGER AS $$
BEGIN
  -- Jeśli zmieniono cenę netto, przelicz brutto
  IF NEW.price_net IS NOT NULL AND (OLD.price_net IS NULL OR NEW.price_net != OLD.price_net OR NEW.vat_rate != OLD.vat_rate) THEN
    NEW.price_gross := NEW.price_net * (1 + NEW.vat_rate / 100);
    NEW.base_price := NEW.price_net;
  END IF;

  -- Przelicz koszty
  IF NEW.cost_net IS NOT NULL AND (OLD.cost_net IS NULL OR NEW.cost_net != OLD.cost_net OR NEW.vat_rate != OLD.vat_rate) THEN
    NEW.cost_gross := NEW.cost_net * (1 + NEW.vat_rate / 100);
    NEW.cost_price := NEW.cost_net;
  END IF;

  -- Przelicz transport
  IF NEW.transport_cost_net IS NOT NULL AND (OLD.transport_cost_net IS NULL OR NEW.transport_cost_net != OLD.transport_cost_net OR NEW.vat_rate != OLD.vat_rate) THEN
    NEW.transport_cost_gross := NEW.transport_cost_net * (1 + NEW.vat_rate / 100);
    NEW.transport_cost := NEW.transport_cost_net;
  END IF;

  -- Przelicz logistykę
  IF NEW.logistics_cost_net IS NOT NULL AND (OLD.logistics_cost_net IS NULL OR NEW.logistics_cost_net != OLD.logistics_cost_net OR NEW.vat_rate != OLD.vat_rate) THEN
    NEW.logistics_cost_gross := NEW.logistics_cost_net * (1 + NEW.vat_rate / 100);
    NEW.logistics_cost := NEW.logistics_cost_net;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger do automatycznego przeliczania cen
DROP TRIGGER IF EXISTS trigger_calculate_product_prices_net ON offer_products;
CREATE TRIGGER trigger_calculate_product_prices_net
  BEFORE INSERT OR UPDATE ON offer_products
  FOR EACH ROW
  EXECUTE FUNCTION calculate_product_prices_from_net();

-- Funkcja pomocnicza do pobierania wszystkich podkategorii
CREATE OR REPLACE FUNCTION get_category_children(category_uuid uuid)
RETURNS TABLE (
  id uuid,
  name text,
  parent_id uuid,
  level integer,
  full_path text
) AS $$
BEGIN
  RETURN QUERY
  WITH RECURSIVE category_tree AS (
    SELECT
      c.id,
      c.name,
      c.parent_id,
      c.level,
      c.full_path
    FROM offer_product_categories c
    WHERE c.id = category_uuid

    UNION ALL

    SELECT
      c.id,
      c.name,
      c.parent_id,
      c.level,
      c.full_path
    FROM offer_product_categories c
    INNER JOIN category_tree ct ON c.parent_id = ct.id
  )
  SELECT * FROM category_tree ORDER BY level, name;
END;
$$ LANGUAGE plpgsql;

-- Funkcja pomocnicza do pobierania ścieżki do korzenia
CREATE OR REPLACE FUNCTION get_category_path_to_root(category_uuid uuid)
RETURNS TABLE (
  id uuid,
  name text,
  parent_id uuid,
  level integer
) AS $$
BEGIN
  RETURN QUERY
  WITH RECURSIVE category_path AS (
    SELECT
      c.id,
      c.name,
      c.parent_id,
      c.level
    FROM offer_product_categories c
    WHERE c.id = category_uuid

    UNION ALL

    SELECT
      c.id,
      c.name,
      c.parent_id,
      c.level
    FROM offer_product_categories c
    INNER JOIN category_path cp ON c.id = cp.parent_id
  )
  SELECT * FROM category_path ORDER BY level;
END;
$$ LANGUAGE plpgsql;

-- View z hierarchią kategorii
CREATE OR REPLACE VIEW offer_product_categories_hierarchy AS
WITH RECURSIVE category_tree AS (
  SELECT
    id,
    name,
    description,
    parent_id,
    level,
    full_path,
    icon,
    display_order,
    is_active,
    ARRAY[id] as path,
    ARRAY[name] as name_path
  FROM offer_product_categories
  WHERE parent_id IS NULL

  UNION ALL

  SELECT
    c.id,
    c.name,
    c.description,
    c.parent_id,
    c.level,
    c.full_path,
    c.icon,
    c.display_order,
    c.is_active,
    ct.path || c.id,
    ct.name_path || c.name
  FROM offer_product_categories c
  INNER JOIN category_tree ct ON c.parent_id = ct.id
)
SELECT
  id,
  name,
  description,
  parent_id,
  level,
  full_path,
  icon,
  display_order,
  is_active,
  path,
  name_path,
  (SELECT COUNT(*) FROM offer_products WHERE category_id = category_tree.id) as products_count,
  (SELECT COUNT(*) FROM offer_product_categories WHERE parent_id = category_tree.id) as children_count
FROM category_tree
ORDER BY path;
