/*
  # Fix auto_assign function - remove kit item duplication

  1. Problem
    - When kit is added to event_equipment, function also adds individual items from kit
    - This creates duplicates in event_equipment
    - Equipment bookings handle kit contents automatically

  2. Solution
    - Remove section 2a that unpacks kit contents into event_equipment
    - Keep only kit as single entry
    - Bookings will handle reservations from kit contents via sync function
*/

CREATE OR REPLACE FUNCTION public.auto_assign_equipment_from_offer_product()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_event_id uuid;
  v_offer_id uuid;
  v_product_equipment RECORD;
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
    
    -- Iteruj przez wszystkie pozycje sprzętu przypisane do produktu (INCLUDING OPTIONAL)
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
        
        -- SPRAWDŹ CZY JEST SUBSTYTUCJA
        v_final_equipment_id := v_clean_equipment_id;
        
        SELECT * INTO v_substitution
        FROM offer_equipment_substitutions
        WHERE offer_id = v_offer_id
          AND from_item_id = v_clean_equipment_id
        LIMIT 1;
        
        IF v_substitution.to_item_id IS NOT NULL THEN
          v_final_equipment_id := v_substitution.to_item_id;
        END IF;
        
        -- Sprawdź czy sprzęt już nie jest przypisany do tego eventu
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
            offer_id,
            is_optional
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
            v_offer_id,
            v_product_equipment.is_optional
          );
        ELSE
          UPDATE event_equipment
          SET quantity = quantity + (v_product_equipment.quantity * NEW.quantity),
              notes = COALESCE(notes || E'\n', '') || 'Zwiększono z produktu: ' || NEW.name,
              is_optional = v_product_equipment.is_optional
          WHERE event_id = v_event_id
            AND equipment_id = v_final_equipment_id;
        END IF;
      END IF;
      
      -- 2. OBSŁUGA ZESTAWU (equipment_kit_id)
      -- Dodajemy tylko zestaw jako całość, bez rozpakowywania zawartości
      -- Rezerwacje zawartości zestawu obsługuje funkcja sync_equipment_bookings_for_event
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
            offer_id,
            is_optional
          ) VALUES (
            v_event_id,
            v_clean_kit_id,
            v_product_equipment.quantity * NEW.quantity,
            'reserved',
            'Zestaw z produktu: ' || NEW.name,
            true,
            v_offer_id,
            v_product_equipment.is_optional
          );
        ELSE
          -- Zwiększ ilość istniejącego zestawu
          UPDATE event_equipment
          SET quantity = quantity + (v_product_equipment.quantity * NEW.quantity),
              notes = COALESCE(notes || E'\n', '') || 'Zwiększono zestaw z produktu: ' || NEW.name,
              is_optional = v_product_equipment.is_optional
          WHERE event_id = v_event_id
            AND kit_id = v_clean_kit_id;
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
$function$;

COMMENT ON FUNCTION auto_assign_equipment_from_offer_product IS 'Przypisuje sprzęt z produktów do eventu. Zestawy są dodawane jako całość (bez rozpakowywania zawartości). Rezerwacje zawartości zestawów obsługuje funkcja sync_equipment_bookings_for_event.';
