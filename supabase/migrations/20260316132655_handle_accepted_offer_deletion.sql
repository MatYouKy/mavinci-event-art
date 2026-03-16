/*
  # Obsługa Usunięcia Zaakceptowanej Oferty

  1. Nowy Trigger
    - Uruchamia się PRZED usunięciem oferty
    - Jeśli oferta była zaakceptowana:
      - Usuwa powiązany sprzęt z event_equipment
      - Resetuje status eventu do 'pending'
      - Czyści flagę has_equipment_shortage
      - Opcjonalnie: czyści pola budżetu

  2. Bezpieczeństwo
    - Używa OLD record do dostępu do danych usuwanej oferty
    - Działa tylko dla ofert o statusie 'accepted'
*/

-- Funkcja do obsługi usunięcia zaakceptowanej oferty
CREATE OR REPLACE FUNCTION handle_accepted_offer_deletion()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_event_id uuid;
  v_other_accepted_offers_count integer;
BEGIN
  -- Sprawdź czy usuwana oferta była zaakceptowana
  IF OLD.status = 'accepted' THEN
    v_event_id := OLD.event_id;
    
    -- Usuń sprzęt powiązany z tą ofertą
    DELETE FROM event_equipment
    WHERE event_id = v_event_id
      AND offer_id = OLD.id;
    
    -- Sprawdź czy są inne zaakceptowane oferty dla tego eventu
    SELECT COUNT(*) INTO v_other_accepted_offers_count
    FROM offers
    WHERE event_id = v_event_id
      AND id != OLD.id
      AND status = 'accepted';
    
    -- Jeśli nie ma innych zaakceptowanych ofert, zresetuj event
    IF v_other_accepted_offers_count = 0 THEN
      UPDATE events
      SET 
        has_equipment_shortage = false,
        status = CASE 
          WHEN status = 'confirmed' THEN 'pending'
          ELSE status
        END
      WHERE id = v_event_id;
      
      -- Możesz też wyczyścić pola budżetu jeśli chcesz:
      -- UPDATE events
      -- SET 
      --   total_budget = NULL,
      --   deposit_amount = NULL,
      --   final_price = NULL
      -- WHERE id = v_event_id;
    END IF;
  END IF;
  
  RETURN OLD;
END;
$$;

-- Usuń stary trigger jeśli istnieje
DROP TRIGGER IF EXISTS trigger_handle_accepted_offer_deletion ON offers;

-- Utwórz nowy trigger
CREATE TRIGGER trigger_handle_accepted_offer_deletion
  BEFORE DELETE ON offers
  FOR EACH ROW
  EXECUTE FUNCTION handle_accepted_offer_deletion();

COMMENT ON FUNCTION handle_accepted_offer_deletion IS
'Automatycznie czyści sprzęt i resetuje event po usunięciu zaakceptowanej oferty';
