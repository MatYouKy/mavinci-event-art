/*
  # Dodaj trigger do usuwania sprzętu przy usunięciu oferty

  1. Problem
    - Po usunięciu oferty, sprzęty automatycznie dodane z tej oferty pozostają w event_equipment
    - Chociaż jest ON DELETE CASCADE na offer_id, nie działa poprawnie

  2. Rozwiązanie
    - Dodaj trigger BEFORE DELETE na tabeli offers
    - Trigger ręcznie usuwa wszystkie sprzęty z event_equipment gdzie offer_id = OLD.id
    - Trigger usuwa tylko sprzęty z auto_added = true dla bezpieczeństwa

  3. Bezpieczeństwo
    - Trigger działa tylko na sprzętach automatycznie dodanych (auto_added = true)
    - Nie usuwa sprzętów dodanych ręcznie przez użytkownika
*/

-- Funkcja do usuwania sprzętu przy usunięciu oferty
CREATE OR REPLACE FUNCTION delete_equipment_on_offer_delete()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  -- Usuń wszystkie sprzęty automatycznie dodane z tej oferty
  DELETE FROM event_equipment
  WHERE offer_id = OLD.id
    AND auto_added = true;

  RAISE NOTICE 'Usunięto sprzęty automatycznie dodane z oferty: %', OLD.id;

  RETURN OLD;
END;
$$;

-- Trigger na DELETE offers
DROP TRIGGER IF EXISTS trigger_delete_equipment_on_offer_delete ON offers;

CREATE TRIGGER trigger_delete_equipment_on_offer_delete
  BEFORE DELETE ON offers
  FOR EACH ROW
  EXECUTE FUNCTION delete_equipment_on_offer_delete();

-- Komentarze
COMMENT ON FUNCTION delete_equipment_on_offer_delete() IS
'Automatycznie usuwa sprzęty z event_equipment które zostały dodane z usuwanej oferty (auto_added = true)';

COMMENT ON TRIGGER trigger_delete_equipment_on_offer_delete ON offers IS
'Usuwa automatycznie dodany sprzęt z eventu gdy usuwamy ofertę';
