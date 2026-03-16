/*
  # Obsługa Zmiany Statusu Oferty z Zaakceptowanej

  1. Nowy Trigger
    - Uruchamia się PRZED UPDATE oferty
    - Jeśli status zmienia się z 'accepted' na inny:
      - Usuwa powiązany sprzęt z event_equipment
      - Resetuje status eventu do 'pending' jeśli to była ostatnia zaakceptowana oferta
      - Czyści flagę has_equipment_shortage

  2. Przypadki użycia
    - Odrzucenie wcześniej zaakceptowanej oferty
    - Zmiana statusu na 'draft' lub 'pending'
*/

-- Funkcja do obsługi zmiany statusu oferty
CREATE OR REPLACE FUNCTION handle_offer_status_change()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_event_id uuid;
  v_other_accepted_offers_count integer;
BEGIN
  -- Sprawdź czy status zmienia się z 'accepted' na inny
  IF OLD.status = 'accepted' AND NEW.status != 'accepted' THEN
    v_event_id := NEW.event_id;
    
    -- Usuń sprzęt powiązany z tą ofertą
    DELETE FROM event_equipment
    WHERE event_id = v_event_id
      AND offer_id = NEW.id;
    
    -- Sprawdź czy są inne zaakceptowane oferty dla tego eventu
    SELECT COUNT(*) INTO v_other_accepted_offers_count
    FROM offers
    WHERE event_id = v_event_id
      AND id != NEW.id
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
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Usuń stary trigger jeśli istnieje
DROP TRIGGER IF EXISTS trigger_handle_offer_status_change ON offers;

-- Utwórz nowy trigger
CREATE TRIGGER trigger_handle_offer_status_change
  BEFORE UPDATE ON offers
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION handle_offer_status_change();

COMMENT ON FUNCTION handle_offer_status_change IS
'Automatycznie czyści sprzęt i resetuje event gdy oferta przestaje być zaakceptowana';
