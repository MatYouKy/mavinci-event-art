/*
  # Naprawa pustych stringów UUID w offer_product_equipment

  1. Problem
    - W tabelach offer_product_* mogą być puste stringi '' zamiast NULL w polach UUID
    - To powoduje błąd "invalid input syntax for type uuid: ''" przy dodawaniu ofert
  
  2. Rozwiązanie
    - Zamień wszystkie puste stringi na NULL w polach UUID
    - Dodaj constraint check żeby zapobiec wstawianiu pustych stringów w przyszłości
*/

-- Napraw istniejące dane w offer_product_equipment
UPDATE offer_product_equipment
SET equipment_item_id = NULL
WHERE equipment_item_id::text = '';

UPDATE offer_product_equipment
SET equipment_kit_id = NULL
WHERE equipment_kit_id::text = '';

-- Napraw w offer_product_kits jeśli istnieje
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'offer_product_kits') THEN
    UPDATE offer_product_kits
    SET kit_id = NULL
    WHERE kit_id::text = '';
  END IF;
END $$;

-- Napraw w offer_product_cables jeśli istnieje
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'offer_product_cables') THEN
    UPDATE offer_product_cables
    SET cable_id = NULL
    WHERE cable_id::text = '';
  END IF;
END $$;

-- Dodaj constraint check żeby zapobiec wstawianiu pustych stringów w przyszłości
-- Nie można dodać CHECK na UUID bezpośrednio, więc użyjemy triggera

CREATE OR REPLACE FUNCTION prevent_empty_uuid_strings()
RETURNS TRIGGER AS $$
BEGIN
  -- Sprawdź wszystkie kolumny UUID w NEW i zamień puste stringi na NULL
  IF TG_TABLE_NAME = 'offer_product_equipment' THEN
    IF NEW.equipment_item_id::text = '' THEN
      NEW.equipment_item_id = NULL;
    END IF;
    IF NEW.equipment_kit_id::text = '' THEN
      NEW.equipment_kit_id = NULL;
    END IF;
    IF NEW.product_id::text = '' THEN
      NEW.product_id = NULL;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_prevent_empty_uuid_strings ON offer_product_equipment;
CREATE TRIGGER trigger_prevent_empty_uuid_strings
  BEFORE INSERT OR UPDATE ON offer_product_equipment
  FOR EACH ROW
  EXECUTE FUNCTION prevent_empty_uuid_strings();