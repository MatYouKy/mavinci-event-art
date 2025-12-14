/*
  # Naprawa auto_assign aby używał substytucji sprzętu

  1. Zmiany
    - Trigger sprawdza offer_equipment_substitutions
    - Jeśli jest substytucja - używa to_item_id
    - Jeśli nie ma - używa oryginalnego equipment_item_id
    - Zapisuje offer_id dla łatwiejszego usuwania
    
  2. Flow
    - User wybiera alternatywę w Offer Wizard
    - Alternatywa jest zapisana w offer_equipment_substitutions
    - Trigger używa alternatywy zamiast oryginalnego sprzętu
*/

CREATE OR REPLACE FUNCTION auto_assign_equipment_from_offer_product()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_event_id uuid;
  v_offer_id uuid;
  v_product_equipment RECORD;
  v_kit_item RECORD;
  v_existing_count integer;
  v_clean_equipment_id uuid;
  v_clean_kit_id uuid;
  v_final_equipment_id uuid;
  v_substitution RECORD;
BEGIN
  -- Pobierz offer_id i event_id
  v_offer_id := NEW.offer_id;
  
  SELECT event_id INTO v_event_id
  FROM offers
  WHERE id = v_offer_id;

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
        cable_id,
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
        
        -- SPRAWDŹ CZY JEST SUBSTYTUCJA
        v_final_equipment_id := v_clean_equipment_id; -- domyślnie oryginał
        
        SELECT * INTO v_substitution
        FROM offer_equipment_substitutions
        WHERE offer_id = v_offer_id
          AND from_item_id = v_clean_equipment_id
        LIMIT 1;
        
        -- Jeśli znaleziono substytucję, użyj alternatywy
        IF v_substitution.to_item_id IS NOT NULL THEN
          v_final_equipment_id := v_substitution.to_item_id;
          RAISE NOTICE 'Używam substytucji: % -> %', v_clean_equipment_id, v_final_equipment_id;
        END IF;
        
        -- Sprawdź czy sprzęt już nie jest przypisany do tego eventu
        SELECT COUNT(*) INTO v_existing_count
        FROM event_equipment
        WHERE event_id = v_event_id
          AND equipment_id = v_final_equipment_id;

        IF v_existing_count = 0 THEN
          -- Dodaj nowy sprzęt
          INSERT INTO event_equipment (
            event_id,
            equipment_id,
            quantity,
            status,
            notes,
            auto_added,
            offer_id
          ) VALUES (
            v_event_id,
            v_final_equipment_id,
            v_product_equipment.quantity * NEW.quantity,
            'reserved',
            CASE 
              WHEN v_substitution.to_item_id IS NOT NULL 
              THEN 'Alternatywa z oferty dla: ' || NEW.name
              ELSE 'Z produktu: ' || NEW.name
            END,
            true,
            v_offer_id
          );
        ELSE
          -- Zwiększ ilość istniejącego
          UPDATE event_equipment
          SET quantity = quantity + (v_product_equipment.quantity * NEW.quantity),
              notes = COALESCE(notes || E'\n', '') || 'Zwiększono z produktu: ' || NEW.name
          WHERE event_id = v_event_id
            AND equipment_id = v_final_equipment_id;
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
            notes,
            auto_added,
            offer_id
          ) VALUES (
            v_event_id,
            v_clean_kit_id,
            v_product_equipment.quantity * NEW.quantity,
            'reserved',
            'Zestaw z produktu: ' || NEW.name,
            true,
            v_offer_id
          );
        ELSE
          -- Zwiększ ilość istniejącego zestawu
          UPDATE event_equipment
          SET quantity = quantity + (v_product_equipment.quantity * NEW.quantity),
              notes = COALESCE(notes || E'\n', '') || 'Zwiększono zestaw z produktu: ' || NEW.name
          WHERE event_id = v_event_id
            AND kit_id = v_clean_kit_id;
        END IF;

        -- 2a. Dodaj sprzęt z zestawu do event_equipment
        FOR v_kit_item IN
          SELECT equipment_id, quantity
          FROM equipment_kit_items
          WHERE kit_id = v_clean_kit_id
        LOOP
          IF v_kit_item.equipment_id IS NOT NULL AND v_kit_item.equipment_id::text != '' THEN
            
            -- SPRAWDŹ SUBSTYTUCJĘ DLA SPRZĘTU Z ZESTAWU
            v_final_equipment_id := v_kit_item.equipment_id;
            
            SELECT * INTO v_substitution
            FROM offer_equipment_substitutions
            WHERE offer_id = v_offer_id
              AND from_item_id = v_kit_item.equipment_id
            LIMIT 1;
            
            IF v_substitution.to_item_id IS NOT NULL THEN
              v_final_equipment_id := v_substitution.to_item_id;
            END IF;
            
            -- Sprawdź czy sprzęt z zestawu już nie jest przypisany
            SELECT COUNT(*) INTO v_existing_count
            FROM event_equipment
            WHERE event_id = v_event_id
              AND equipment_id = v_final_equipment_id;

            IF v_existing_count = 0 THEN
              INSERT INTO event_equipment (
                event_id,
                equipment_id,
                quantity,
                status,
                notes,
                auto_added,
                offer_id
              ) VALUES (
                v_event_id,
                v_final_equipment_id,
                v_kit_item.quantity * v_product_equipment.quantity * NEW.quantity,
                'reserved',
                CASE 
                  WHEN v_substitution.to_item_id IS NOT NULL 
                  THEN 'Alternatywa z zestawu: ' || NEW.name
                  ELSE 'Z zestawu produktu: ' || NEW.name
                END,
                true,
                v_offer_id
              );
            ELSE
              UPDATE event_equipment
              SET quantity = quantity + (v_kit_item.quantity * v_product_equipment.quantity * NEW.quantity),
                  notes = COALESCE(notes || E'\n', '') || 'Zwiększono z zestawu: ' || NEW.name
              WHERE event_id = v_event_id
                AND equipment_id = v_final_equipment_id;
            END IF;
          END IF;
        END LOOP;
      END IF;

      -- 3. OBSŁUGA KABLI
      IF v_product_equipment.cable_id IS NOT NULL THEN
        SELECT COUNT(*) INTO v_existing_count
        FROM event_equipment
        WHERE event_id = v_event_id
          AND cable_id = v_product_equipment.cable_id;

        IF v_existing_count = 0 THEN
          INSERT INTO event_equipment (
            event_id,
            cable_id,
            quantity,
            status,
            notes,
            auto_added,
            offer_id
          ) VALUES (
            v_event_id,
            v_product_equipment.cable_id,
            v_product_equipment.quantity * NEW.quantity,
            'reserved',
            'Kabel z produktu: ' || NEW.name,
            true,
            v_offer_id
          );
        ELSE
          UPDATE event_equipment
          SET quantity = quantity + (v_product_equipment.quantity * NEW.quantity),
              notes = COALESCE(notes || E'\n', '') || 'Zwiększono kabel: ' || NEW.name
          WHERE event_id = v_event_id
            AND cable_id = v_product_equipment.cable_id;
        END IF;
      END IF;

    END LOOP;

  END IF;

  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'Error in auto_assign_equipment_from_offer_product: % %', SQLERRM, SQLSTATE;
    RETURN NEW;
END;
$$;

-- Odtwórz trigger
DROP TRIGGER IF EXISTS trigger_auto_assign_equipment_from_offer_product ON offer_items;

CREATE TRIGGER trigger_auto_assign_equipment_from_offer_product
  AFTER INSERT ON offer_items
  FOR EACH ROW
  EXECUTE FUNCTION auto_assign_equipment_from_offer_product();

COMMENT ON FUNCTION auto_assign_equipment_from_offer_product() IS
'Automatycznie dodaje sprzęt z produktu oferty do eventu, używając substytucji jeśli są dostępne';
