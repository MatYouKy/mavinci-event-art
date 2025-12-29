/*
  # Add is_optional column to event_equipment

  1. Changes
    - Add is_optional column to event_equipment table
    - Default is false (required equipment)
    - Update auto_assign function to import optional equipment and mark it as such

  2. Purpose
    - Allow importing optional equipment from offer products
    - Enable visual differentiation in UI between required and optional equipment
    - Support categorization and filtering by optional status
*/

-- Add is_optional column to event_equipment
ALTER TABLE event_equipment 
ADD COLUMN IF NOT EXISTS is_optional boolean DEFAULT false;

COMMENT ON COLUMN event_equipment.is_optional IS 'Czy sprzęt jest opcjonalny (z offer_product_equipment)';

-- Update the auto_assign function to import all equipment (including optional)
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
                offer_id,
                is_optional
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
                v_offer_id,
                v_product_equipment.is_optional
              );
            ELSE
              UPDATE event_equipment
              SET quantity = quantity + (v_kit_item.quantity * v_product_equipment.quantity * NEW.quantity),
                  notes = COALESCE(notes || E'\n', '') || 'Zwiększono z zestawu: ' || NEW.name,
                  is_optional = v_product_equipment.is_optional
              WHERE event_id = v_event_id
                AND equipment_id = v_final_equipment_id;
            END IF;
          END IF;
        END LOOP;
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

COMMENT ON FUNCTION auto_assign_equipment_from_offer_product IS 'Automatycznie przypisuje sprzęt z produktów oferty do eventu. Importuje wszystkie pozycje (w tym opcjonalne) i oznacza je flagą is_optional.';
