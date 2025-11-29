/*
  # Fix event_equipment status in auto_assign trigger
  
  1. Problem
    - Funkcja `auto_assign_equipment_from_offer_product` używa statusu 'planned'
    - Ale constraint pozwala tylko na: 'reserved', 'in_use', 'returned', 'cancelled'
    
  2. Rozwiązanie
    - Zmień status z 'planned' na 'reserved' w funkcji triggera
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
  v_product_kit RECORD;
  v_kit_item RECORD;
  v_existing_count integer;
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
  IF NEW.product_id IS NOT NULL THEN
    
    -- 1. Dodaj sprzęt przypisany do produktu
    FOR v_product_equipment IN
      SELECT equipment_item_id, quantity
      FROM offer_product_equipment
      WHERE product_id = NEW.product_id
        AND equipment_item_id IS NOT NULL
    LOOP
      -- Sprawdź czy sprzęt już nie jest przypisany do tego eventu
      SELECT COUNT(*) INTO v_existing_count
      FROM event_equipment
      WHERE event_id = v_event_id
        AND equipment_id = v_product_equipment.equipment_item_id;

      -- Jeśli sprzęt nie jest jeszcze przypisany, dodaj go
      IF v_existing_count = 0 THEN
        INSERT INTO event_equipment (
          event_id,
          equipment_id,
          quantity,
          status,
          notes
        ) VALUES (
          v_event_id,
          v_product_equipment.equipment_item_id,
          v_product_equipment.quantity * NEW.quantity,
          'reserved',  -- Zmieniono z 'planned' na 'reserved'
          'Automatycznie dodane z produktu: ' || NEW.name
        );
      ELSE
        -- Jeśli sprzęt już istnieje, zwiększ ilość
        UPDATE event_equipment
        SET quantity = quantity + (v_product_equipment.quantity * NEW.quantity),
            notes = COALESCE(notes || E'\n', '') || 'Zwiększono ilość z produktu: ' || NEW.name
        WHERE event_id = v_event_id
          AND equipment_id = v_product_equipment.equipment_item_id;
      END IF;
    END LOOP;

    -- 2. Dodaj zestawy (kits) przypisane do produktu
    FOR v_product_kit IN
      SELECT kit_id, quantity
      FROM offer_product_kits
      WHERE product_id = NEW.product_id
    LOOP
      -- Sprawdź czy zestaw już nie jest przypisany do tego eventu
      SELECT COUNT(*) INTO v_existing_count
      FROM event_equipment
      WHERE event_id = v_event_id
        AND kit_id = v_product_kit.kit_id;

      -- Jeśli zestaw nie jest jeszcze przypisany, dodaj go
      IF v_existing_count = 0 THEN
        INSERT INTO event_equipment (
          event_id,
          kit_id,
          quantity,
          status,
          notes
        ) VALUES (
          v_event_id,
          v_product_kit.kit_id,
          v_product_kit.quantity * NEW.quantity,
          'reserved',  -- Zmieniono z 'planned' na 'reserved'
          'Automatycznie dodany zestaw z produktu: ' || NEW.name
        );
      ELSE
        -- Jeśli zestaw już istnieje, zwiększ ilość
        UPDATE event_equipment
        SET quantity = quantity + (v_product_kit.quantity * NEW.quantity),
            notes = COALESCE(notes || E'\n', '') || 'Zwiększono ilość zestawu z produktu: ' || NEW.name
        WHERE event_id = v_event_id
          AND kit_id = v_product_kit.kit_id;
      END IF;

      -- 2a. Dodaj sprzęt z zestawu do event_equipment
      FOR v_kit_item IN
        SELECT equipment_id, quantity
        FROM equipment_kit_items
        WHERE kit_id = v_product_kit.kit_id
      LOOP
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
            v_kit_item.quantity * v_product_kit.quantity * NEW.quantity,
            'reserved',  -- Zmieniono z 'planned' na 'reserved'
            'Automatycznie dodane z zestawu produktu: ' || NEW.name
          );
        ELSE
          UPDATE event_equipment
          SET quantity = quantity + (v_kit_item.quantity * v_product_kit.quantity * NEW.quantity),
              notes = COALESCE(notes || E'\n', '') || 'Zwiększono ilość z zestawu produktu: ' || NEW.name
          WHERE event_id = v_event_id
            AND equipment_id = v_kit_item.equipment_id;
        END IF;
      END LOOP;
    END LOOP;

    -- 3. Dodaj kable przypisane do produktu
    FOR v_product_equipment IN
      SELECT cable_id, quantity
      FROM offer_product_cables
      WHERE product_id = NEW.product_id
        AND cable_id IS NOT NULL
    LOOP
      -- Sprawdź czy kabel już nie jest przypisany do tego eventu
      SELECT COUNT(*) INTO v_existing_count
      FROM event_equipment
      WHERE event_id = v_event_id
        AND cable_id = v_product_equipment.cable_id;

      -- Jeśli kabel nie jest jeszcze przypisany, dodaj go
      IF v_existing_count = 0 THEN
        INSERT INTO event_equipment (
          event_id,
          cable_id,
          quantity,
          status,
          notes
        ) VALUES (
          v_event_id,
          v_product_equipment.cable_id,
          v_product_equipment.quantity * NEW.quantity,
          'reserved',  -- Zmieniono z 'planned' na 'reserved'
          'Automatycznie dodany kabel z produktu: ' || NEW.name
        );
      ELSE
        -- Jeśli kabel już istnieje, zwiększ ilość
        UPDATE event_equipment
        SET quantity = quantity + (v_product_equipment.quantity * NEW.quantity),
            notes = COALESCE(notes || E'\n', '') || 'Zwiększono ilość kabla z produktu: ' || NEW.name
        WHERE event_id = v_event_id
          AND cable_id = v_product_equipment.cable_id;
      END IF;
    END LOOP;

  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION auto_assign_equipment_from_offer_product() IS 
'Automatycznie dodaje sprzęt, zestawy i kable z produktu oferty do wydarzenia z poprawnym statusem "reserved"';
