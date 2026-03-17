/*
  # Powiązanie offer_products z usługami podwykonawców

  1. Zmiany w tabeli offer_products
    - Dodanie pola subcontractor_service_catalog_id
    - Dodanie flagi is_subcontractor_service

  2. Logika biznesowa
    - Gdy produkt jest powiązany z usługą podwykonawcy, ceny są kopiowane
    - Produkt może być albo wewnętrzny albo od podwykonawcy
    - Pozwala na import usług z katalogu podwykonawcy do ofert

  3. Security
    - RLS działa normalnie - wszyscy mogą czytać, tylko z uprawnieniami mogą edytować
*/

-- Dodaj pola do offer_products
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'offer_products' AND column_name = 'subcontractor_service_catalog_id'
  ) THEN
    ALTER TABLE offer_products 
      ADD COLUMN subcontractor_service_catalog_id uuid 
      REFERENCES subcontractor_service_catalog(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'offer_products' AND column_name = 'is_subcontractor_service'
  ) THEN
    ALTER TABLE offer_products 
      ADD COLUMN is_subcontractor_service boolean DEFAULT false;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'offer_products' AND column_name = 'subcontractor_id'
  ) THEN
    ALTER TABLE offer_products 
      ADD COLUMN subcontractor_id uuid 
      REFERENCES subcontractors(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Indeks dla szybszego wyszukiwania usług podwykonawców
CREATE INDEX IF NOT EXISTS idx_offer_products_subcontractor_service 
  ON offer_products(subcontractor_service_catalog_id) 
  WHERE subcontractor_service_catalog_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_offer_products_subcontractor 
  ON offer_products(subcontractor_id) 
  WHERE subcontractor_id IS NOT NULL;

-- Funkcja pomocnicza do tworzenia produktu z usługi podwykonawcy
CREATE OR REPLACE FUNCTION create_product_from_subcontractor_service(
  p_service_catalog_id uuid,
  p_category_id uuid DEFAULT NULL
)
RETURNS uuid AS $$
DECLARE
  v_service RECORD;
  v_subcontractor RECORD;
  v_product_id uuid;
BEGIN
  -- Pobierz usługę z katalogu
  SELECT * INTO v_service
  FROM subcontractor_service_catalog
  WHERE id = p_service_catalog_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Service not found';
  END IF;

  -- Pobierz info o podwykonawcy
  SELECT * INTO v_subcontractor
  FROM subcontractors
  WHERE id = v_service.subcontractor_id;

  -- Utwórz produkt w katalogu offer_products
  INSERT INTO offer_products (
    category_id,
    name,
    description,
    base_price,
    cost_price,
    unit,
    is_subcontractor_service,
    subcontractor_service_catalog_id,
    subcontractor_id,
    tags,
    is_active
  ) VALUES (
    p_category_id,
    v_service.name || ' (' || v_subcontractor.company_name || ')',
    v_service.description,
    COALESCE(v_service.unit_price, 0),
    COALESCE(v_service.unit_price, 0), -- koszt = cena dla usług podwykonawcy
    COALESCE(v_service.unit, 'szt'),
    true,
    p_service_catalog_id,
    v_service.subcontractor_id,
    ARRAY['podwykonawca', v_subcontractor.company_name],
    v_service.is_active
  )
  RETURNING id INTO v_product_id;

  RETURN v_product_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Widok rozszerzony produktów z informacją o podwykonawcach
CREATE OR REPLACE VIEW offer_products_with_subcontractor AS
SELECT 
  op.*,
  s.company_name as subcontractor_name,
  s.email as subcontractor_email,
  s.phone as subcontractor_phone,
  ssc.name as original_service_name,
  ssc.unit_price as original_service_price
FROM offer_products op
LEFT JOIN subcontractors s ON s.id = op.subcontractor_id
LEFT JOIN subcontractor_service_catalog ssc ON ssc.id = op.subcontractor_service_catalog_id;

COMMENT ON COLUMN offer_products.subcontractor_service_catalog_id IS 'Powiązanie z usługą z katalogu podwykonawcy';
COMMENT ON COLUMN offer_products.is_subcontractor_service IS 'Flaga określająca czy produkt pochodzi od podwykonawcy';
COMMENT ON COLUMN offer_products.subcontractor_id IS 'ID podwykonawcy świadczącego usługę';
COMMENT ON FUNCTION create_product_from_subcontractor_service IS 'Tworzy produkt w katalogu offer_products na podstawie usługi podwykonawcy';
COMMENT ON VIEW offer_products_with_subcontractor IS 'Widok produktów z rozszerzonymi informacjami o podwykonawcach';