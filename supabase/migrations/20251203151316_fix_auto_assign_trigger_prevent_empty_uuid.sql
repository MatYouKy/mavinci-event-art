/*
  # Napraw trigger auto_assign - zapobiegaj pustym UUID

  1. Problem
    - Trigger auto_assign_equipment_from_offer_product może próbować wstawić puste stringi UUID
    - Warunek IS NOT NULL zwraca TRUE dla pustych stringów ''
    - To powoduje błąd "invalid input syntax for type uuid: ''"
  
  2. Rozwiązanie
    - Dodaj sprawdzanie czy UUID nie jest pustym stringiem
    - Używaj NULLIF do zamiany pustych stringów na NULL
*/

CREATE OR REPLACE FUNCTION auto_assign_equipment_from_offer_product()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_event_id uuid;
  v_product_equipment RECORD;
  v_kit_item RECORD;
  v_existing_count integer;
  v_clean_equipment_id uuid;
  v_clean_kit_id uuid;
BEGIN
  -- Pobierz event_id z oferty
  SELECT event_id INTO v_event_id
  FROM offers
  WHERE id = NEW.offer_id;

  -- Jeśli nie ma powiązanego eventu, zakończ
  IF v_event_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Tylko jeśli offer_item ma product_id
  IF NEW.product_id IS NOT NULL AND NEW.product_id::text != '' THEN
    
    -- Iteruj przez wszystkie pozycje sprzętu przypisane do produktu
    FOR v_product_equipment IN
      SELECT 
        equipment_item_id, 
        equipment_kit_id,
        quantity,
        is_optional,
        notes
      FROM offer_product_equipment
      WHERE product_id = NEW.product_id
    LOOP
      
      -- Wyczyść puste stringi do NULL
      v_clean_equipment_id := NULLIF(v_product_equipment.equipment_item_id::text, '')::uuid;
      v_clean_kit_id := NULLIF(v_product_equipment.equipment_kit_id::text, '')::uuid;
      
      -- 1. OBSŁUGA POJEDYNCZEGO SPRZĘTU (equipment_item_id)
      IF v_clean_equipment_id IS NOT NULL THEN
        -- Sprawdź czy sprzęt już nie jest przypisany do tego eventu
        SELECT COUNT(*) INTO v_existing_count
        FROM event_equipment
        WHERE event_id = v_event_id
          AND equipment_id = v_clean_equipment_id;

        IF v_existing_count = 0 THEN
          -- Dodaj nowy sprzęt
          INSERT INTO event_equipment (
            event_id,
            equipment_id,
            quantity,
            status,
            notes
          ) VALUES (
            v_event_id,
            v_clean_equipment_id,
            v_product_equipment.quantity * NEW.quantity,
            'reserved',
            'Automatycznie dodane z produktu: ' || NEW.name
          );
        ELSE
          -- Zwiększ ilość istniejącego
          UPDATE event_equipment
          SET quantity = quantity + (v_product_equipment.quantity * NEW.quantity),
              notes = COALESCE(notes || E'\n', '') || 'Zwiększono ilość z produktu: ' || NEW.name
          WHERE event_id = v_event_id
            AND equipment_id = v_clean_equipment_id;
        END IF;
      END IF;

      -- 2. OBSŁUGA ZESTAWU (equipment_kit_id)
      IF v_clean_kit_id IS NOT NULL THEN
        -- Sprawdź czy zestaw już nie jest przypisany do tego eventu
        SELECT COUNT(*) INTO v_existing_count
        FROM event_equipment
        WHERE event_id = v_event_id
          AND kit_id = v_clean_kit_id;

        IF v_existing_count = 0 THEN
          -- Dodaj nowy zestaw
          INSERT INTO event_equipment (
            event_id,
            kit_id,
            quantity,
            status,
            notes
          ) VALUES (
            v_event_id,
            v_clean_kit_id,
            v_product_equipment.quantity * NEW.quantity,
            'reserved',
            'Automatycznie dodany zestaw z produktu: ' || NEW.name
          );
        ELSE
          -- Zwiększ ilość istniejącego zestawu
          UPDATE event_equipment
          SET quantity = quantity + (v_product_equipment.quantity * NEW.quantity),
              notes = COALESCE(notes || E'\n', '') || 'Zwiększono ilość zestawu z produktu: ' || NEW.name
          WHERE event_id = v_event_id
            AND kit_id = v_clean_kit_id;
        END IF;

        -- 2a. Dodaj sprzęt z zestawu do event_equipment
        FOR v_kit_item IN
          SELECT equipment_id, quantity
          FROM equipment_kit_items
          WHERE kit_id = v_clean_kit_id
        LOOP
          -- Sprawdź czy equipment_id z zestawu nie jest pusty
          IF v_kit_item.equipment_id IS NOT NULL AND v_kit_item.equipment_id::text != '' THEN
            -- Sprawdź czy sprzęt z zestawu już nie jest przypisany
            SELECT COUNT(*) INTO v_existing_count
            FROM event_equipment
            WHERE event_id = v_event_id
              AND equipment_id = v_kit_item.equipment_id;

            IF v_existing_count = 0 THEN
              INSERT INTO event_equipment (
                event_id,
                equipment_id,
                quantity,
                status,
                notes
              ) VALUES (
                v_event_id,
                v_kit_item.equipment_id,
                v_kit_item.quantity * v_product_equipment.quantity * NEW.quantity,
                'reserved',
                'Automatycznie dodane z zestawu produktu: ' || NEW.name
              );
            ELSE
              UPDATE event_equipment
              SET quantity = quantity + (v_kit_item.quantity * v_product_equipment.quantity * NEW.quantity),
                  notes = COALESCE(notes || E'\n', '') || 'Zwiększono ilość z zestawu produktu: ' || NEW.name
              WHERE event_id = v_event_id
                AND equipment_id = v_kit_item.equipment_id;
            END IF;
          END IF;
        END LOOP;
      END IF;

    END LOOP;

  END IF;

  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    -- Loguj błąd ale nie blokuj operacji
    RAISE WARNING 'Error in auto_assign_equipment_from_offer_product: % %', SQLERRM, SQLSTATE;
    RETURN NEW;
END;
$$;

-- Upewnij się że trigger istnieje
DROP TRIGGER IF EXISTS trigger_auto_assign_equipment_from_offer_product ON offer_items;
CREATE TRIGGER trigger_auto_assign_equipment_from_offer_product
  AFTER INSERT ON offer_items
  FOR EACH ROW
  EXECUTE FUNCTION auto_assign_equipment_from_offer_product();

COMMENT ON FUNCTION auto_assign_equipment_from_offer_product() IS 
'Automatycznie dodaje sprzęt i zestawy z produktu oferty do wydarzenia - z walidacją pustych UUID';