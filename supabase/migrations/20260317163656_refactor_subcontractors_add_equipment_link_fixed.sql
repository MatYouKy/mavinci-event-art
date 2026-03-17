/*
  # Refaktoryzacja systemu podwykonawców - powiązanie z equipment_items

  1. Zmiany w tabeli subcontractor_equipment_catalog
    - Dodanie equipment_item_id dla powiązania z naszym katalogiem sprzętu
    - To pozwoli na wyszukiwanie alternatyw z rentalu dla danego sprzętu
    - Możliwość powiązania z kategorią lub konkretnym itemem

  2. Dodanie pola do identyfikacji typu podwykonawcy
    - subcontractor_type: 'services', 'rental', 'transport' lub kombinacja

  3. Bezpieczeństwo
    - Zachowanie istniejących polityk RLS
    - Dodanie indeksów dla nowych pól
*/

-- Dodaj pole equipment_item_id do subcontractor_equipment_catalog
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'subcontractor_equipment_catalog' AND column_name = 'equipment_item_id'
  ) THEN
    ALTER TABLE subcontractor_equipment_catalog 
    ADD COLUMN equipment_item_id uuid REFERENCES equipment_items(id) ON DELETE SET NULL;
    
    COMMENT ON COLUMN subcontractor_equipment_catalog.equipment_item_id IS 
      'Opcjonalne powiązanie z itemem z naszego katalogu - pozwala na wyszukiwanie alternatyw z rentalu';
  END IF;

  -- Nie dodajemy equipment_category_id - użyjemy relacji przez equipment_item_id
END $$;

-- Dodaj pole subcontractor_type do głównej tabeli subcontractors
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'subcontractors' AND column_name = 'subcontractor_type'
  ) THEN
    ALTER TABLE subcontractors 
    ADD COLUMN subcontractor_type text[] DEFAULT ARRAY[]::text[];
    
    COMMENT ON COLUMN subcontractors.subcontractor_type IS 
      'Typy usług podwykonawcy: services, rental, transport (może być więcej niż jeden)';
  END IF;
END $$;

-- Dodaj indeksy dla szybszego wyszukiwania
CREATE INDEX IF NOT EXISTS idx_subcontractor_equipment_equipment_item 
  ON subcontractor_equipment_catalog(equipment_item_id) 
  WHERE equipment_item_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_subcontractors_type 
  ON subcontractors USING gin(subcontractor_type);

-- Funkcja pomocnicza do wyszukiwania alternatywnego sprzętu z rentalu
CREATE OR REPLACE FUNCTION find_rental_alternatives(
  p_equipment_item_id uuid,
  p_event_start_date timestamptz DEFAULT NULL,
  p_event_end_date timestamptz DEFAULT NULL
)
RETURNS TABLE (
  subcontractor_id uuid,
  subcontractor_name text,
  catalog_item_id uuid,
  item_name text,
  daily_rental_price numeric,
  quantity_available integer,
  thumbnail_url text,
  subcontractor_rating integer,
  subcontractor_status text
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    s.id as subcontractor_id,
    s.company_name as subcontractor_name,
    sec.id as catalog_item_id,
    sec.name as item_name,
    sec.daily_rental_price,
    sec.quantity_available,
    sec.thumbnail_url,
    s.rating as subcontractor_rating,
    s.status as subcontractor_status
  FROM subcontractor_equipment_catalog sec
  JOIN subcontractors s ON s.id = sec.subcontractor_id
  WHERE sec.equipment_item_id = p_equipment_item_id
    AND sec.is_active = true
    AND s.status = 'active'
    AND 'rental' = ANY(s.subcontractor_type)
  ORDER BY s.rating DESC NULLS LAST, sec.daily_rental_price ASC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Funkcja do synchronizacji subcontractor_type na podstawie subcontractor_services
CREATE OR REPLACE FUNCTION sync_subcontractor_types()
RETURNS trigger AS $$
DECLARE
  v_types text[];
BEGIN
  -- Określ które ID subcontractora użyć (dla INSERT/UPDATE to NEW, dla DELETE to OLD)
  IF TG_OP = 'DELETE' THEN
    -- Aktualizuj dla OLD.subcontractor_id
    SELECT ARRAY_AGG(DISTINCT service_type)
    INTO v_types
    FROM subcontractor_services
    WHERE subcontractor_id = OLD.subcontractor_id
      AND is_active = true;
    
    UPDATE subcontractors
    SET subcontractor_type = COALESCE(v_types, ARRAY[]::text[])
    WHERE id = OLD.subcontractor_id;
    
    RETURN OLD;
  ELSE
    -- Aktualizuj dla NEW.subcontractor_id
    SELECT ARRAY_AGG(DISTINCT service_type)
    INTO v_types
    FROM subcontractor_services
    WHERE subcontractor_id = NEW.subcontractor_id
      AND is_active = true;
    
    UPDATE subcontractors
    SET subcontractor_type = COALESCE(v_types, ARRAY[]::text[])
    WHERE id = NEW.subcontractor_id;
    
    RETURN NEW;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger do automatycznej synchronizacji typów
DROP TRIGGER IF EXISTS trigger_sync_subcontractor_types ON subcontractor_services;
CREATE TRIGGER trigger_sync_subcontractor_types
  AFTER INSERT OR UPDATE OR DELETE ON subcontractor_services
  FOR EACH ROW
  EXECUTE FUNCTION sync_subcontractor_types();

-- Zsynchronizuj istniejące dane
UPDATE subcontractors s
SET subcontractor_type = COALESCE((
  SELECT ARRAY_AGG(DISTINCT ss.service_type)
  FROM subcontractor_services ss
  WHERE ss.subcontractor_id = s.id
    AND ss.is_active = true
), ARRAY[]::text[]);

COMMENT ON FUNCTION find_rental_alternatives IS 
  'Znajduje alternatywny sprzęt dostępny do wynajęcia od podwykonawców dla danego equipment_item_id';

COMMENT ON FUNCTION sync_subcontractor_types IS 
  'Automatycznie synchronizuje pole subcontractor_type na podstawie aktywnych usług';