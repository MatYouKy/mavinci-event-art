/*
  # Automatyczna aktualizacja statusu eventu na podstawie ofert

  1. Funkcje
    - `update_event_status_on_offer_change` - automatycznie aktualizuje status eventu gdy:
      * Zostanie utworzona pierwsza oferta → status zmienia się na 'offer_to_send'
      * Zostanie usunięta ostatnia oferta → status wraca na 'inquiry'

  2. Triggery
    - Automatyczne wywołanie po INSERT lub DELETE na `offers`
    - Sprawdza liczbę ofert dla eventu i aktualizuje status accordingly

  3. Logika
    - Event bez ofert → status 'inquiry' (zapytanie)
    - Event z przynajmniej jedną ofertą → status 'offer_to_send' (oferta do wysłania)
    - Jeśli status to 'offer_sent' lub wyższy, nie jest zmieniany automatycznie

  4. Bezpieczeństwo
    - Funkcja działa w kontekście security definer (jako uprawniony użytkownik)
    - Nie wymaga dodatkowych uprawnień od użytkownika
*/

-- Funkcja do automatycznej aktualizacji statusu eventu na podstawie ofert
CREATE OR REPLACE FUNCTION update_event_status_on_offer_change()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_event_id uuid;
  v_offers_count integer;
  v_current_status event_status;
BEGIN
  -- Pobierz event_id (z NEW dla INSERT, z OLD dla DELETE)
  IF TG_OP = 'DELETE' THEN
    v_event_id := OLD.event_id;
  ELSE
    v_event_id := NEW.event_id;
  END IF;

  -- Pobierz obecny status eventu
  SELECT status INTO v_current_status
  FROM events
  WHERE id = v_event_id;

  -- Sprawdź liczbę ofert dla tego eventu
  SELECT COUNT(*) INTO v_offers_count
  FROM offers
  WHERE event_id = v_event_id;

  -- Logika aktualizacji statusu:
  -- 1. Jeśli nie ma ofert i status to 'offer_to_send' → zmień na 'inquiry'
  -- 2. Jeśli jest przynajmniej jedna oferta i status to 'inquiry' → zmień na 'offer_to_send'
  -- 3. Nie zmieniaj statusu jeśli jest 'offer_sent' lub wyższy

  IF v_offers_count = 0 THEN
    -- Brak ofert - zmień status na 'inquiry' jeśli był 'offer_to_send'
    IF v_current_status = 'offer_to_send' THEN
      UPDATE events
      SET status = 'inquiry'
      WHERE id = v_event_id;
    END IF;
  ELSIF v_offers_count > 0 THEN
    -- Jest przynajmniej jedna oferta - zmień status na 'offer_to_send' jeśli był 'inquiry'
    IF v_current_status = 'inquiry' THEN
      UPDATE events
      SET status = 'offer_to_send'
      WHERE id = v_event_id;
    END IF;
  END IF;

  -- Zwróć odpowiednią wartość w zależności od operacji
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$$;

-- Trigger po INSERT na offers
DROP TRIGGER IF EXISTS trigger_update_event_status_on_offer_insert ON offers;

CREATE TRIGGER trigger_update_event_status_on_offer_insert
  AFTER INSERT ON offers
  FOR EACH ROW
  EXECUTE FUNCTION update_event_status_on_offer_change();

-- Trigger po DELETE na offers
DROP TRIGGER IF EXISTS trigger_update_event_status_on_offer_delete ON offers;

CREATE TRIGGER trigger_update_event_status_on_offer_delete
  AFTER DELETE ON offers
  FOR EACH ROW
  EXECUTE FUNCTION update_event_status_on_offer_change();

-- Dodaj komentarze
COMMENT ON FUNCTION update_event_status_on_offer_change() IS
'Automatycznie aktualizuje status eventu na podstawie liczby ofert: inquiry (0 ofert) lub offer_to_send (>=1 oferta)';

COMMENT ON TRIGGER trigger_update_event_status_on_offer_insert ON offers IS
'Automatycznie zmienia status eventu na offer_to_send gdy dodamy pierwszą ofertę';

COMMENT ON TRIGGER trigger_update_event_status_on_offer_delete ON offers IS
'Automatycznie zmienia status eventu na inquiry gdy usuniemy ostatnią ofertę';
