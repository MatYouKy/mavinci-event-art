/*
  # Dodaj flagę auto_added do event_equipment

  1. Zmiany
    - Dodaj kolumnę auto_added (boolean) do event_equipment
    - Domyślnie false - dla ręcznie dodanego sprzętu
    - Zaktualizuj trigger auto_assign aby ustawiał auto_added = true
    
  2. Cel
    - Umożliwienie grupowania automatycznie dodanego sprzętu
    - Oddzielenie sprzętu dodanego z oferty od ręcznie dodanego
*/

-- Dodaj kolumnę auto_added
ALTER TABLE event_equipment
ADD COLUMN IF NOT EXISTS auto_added boolean DEFAULT false NOT NULL;

-- Dodaj komentarz
COMMENT ON COLUMN event_equipment.auto_added IS 
'Czy sprzęt został automatycznie dodany z produktu oferty (true) czy ręcznie (false)';

-- Zaktualizuj istniejące rekordy z notatkami "Automatycznie dodane" jako auto_added = true
UPDATE event_equipment
SET auto_added = true
WHERE notes LIKE '%Automatycznie dodane%' 
   OR notes LIKE '%Automatycznie dodany%';

-- Zaktualizuj funkcję auto_assign aby ustawiała flagę auto_added
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
          -- Dodaj nowy sprzęt Z FLAGĄ auto_added = true
          INSERT INTO event_equipment (
            event_id,
            equipment_id,
            quantity,
            status,
            notes,
            auto_added
          ) VALUES (
            v_event_id,
            v_clean_equipment_id,
            v_product_equipment.quantity * NEW.quantity,
            'reserved',
            'Z produktu: ' || NEW.name,
            true  -- AUTOMATYCZNIE DODANE
          );
        ELSE
          -- Zwiększ ilość istniejącego
          UPDATE event_equipment
          SET quantity = quantity + (v_product_equipment.quantity * NEW.quantity),
              notes = COALESCE(notes || E'\n', '') || 'Zwiększono z produktu: ' || NEW.name
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
          -- Dodaj nowy zestaw Z FLAGĄ auto_added = true
          INSERT INTO event_equipment (
            event_id,
            kit_id,
            quantity,
            status,
            notes,
            auto_added
          ) VALUES (
            v_event_id,
            v_clean_kit_id,
            v_product_equipment.quantity * NEW.quantity,
            'reserved',
            'Zestaw z produktu: ' || NEW.name,
            true  -- AUTOMATYCZNIE DODANE
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
                notes,
                auto_added
              ) VALUES (
                v_event_id,
                v_kit_item.equipment_id,
                v_kit_item.quantity * v_product_equipment.quantity * NEW.quantity,
                'reserved',
                'Z zestawu produktu: ' || NEW.name,
                true  -- AUTOMATYCZNIE DODANE
              );
            ELSE
              UPDATE event_equipment
              SET quantity = quantity + (v_kit_item.quantity * v_product_equipment.quantity * NEW.quantity),
                  notes = COALESCE(notes || E'\n', '') || 'Zwiększono z zestawu: ' || NEW.name
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

COMMENT ON COLUMN event_equipment.auto_added IS 
'Flaga określająca czy sprzęt został automatycznie dodany z produktu oferty (true) czy ręcznie przez użytkownika (false)';