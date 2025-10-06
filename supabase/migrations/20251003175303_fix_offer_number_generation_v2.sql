-- Ulepszona funkcja do generowania numeru oferty z sprawdzaniem unikalności
CREATE OR REPLACE FUNCTION generate_offer_number(p_event_id uuid)
RETURNS text AS $$
DECLARE
  v_event_type text;
  v_year text;
  v_month text;
  v_count integer;
  v_prefix text;
  v_offer_number text;
  v_exists boolean;
BEGIN
  -- Pobierz typ eventu
  SELECT event_type INTO v_event_type
  FROM events
  WHERE id = p_event_id;

  -- Jeśli brak event_id, użyj ogólnego
  IF v_event_type IS NULL THEN
    v_event_type := 'general';
  END IF;

  -- Zawsze używaj prefiksu OF
  v_prefix := 'OF';

  -- Pobierz rok i miesiąc
  v_year := TO_CHAR(CURRENT_DATE, 'YYYY');
  v_month := TO_CHAR(CURRENT_DATE, 'MM');

  -- Znajdź następny wolny numer
  v_count := 1;
  LOOP
    -- Wygeneruj numer
    v_offer_number := v_prefix || '/' || v_year || '/' || v_month || '/' || LPAD(v_count::text, 3, '0');
    
    -- Sprawdź czy numer już istnieje
    SELECT EXISTS(
      SELECT 1 FROM offers WHERE offer_number = v_offer_number
    ) INTO v_exists;
    
    -- Jeśli numer nie istnieje, zwróć go
    IF NOT v_exists THEN
      RETURN v_offer_number;
    END IF;
    
    -- Zwiększ licznik i spróbuj ponownie
    v_count := v_count + 1;
    
    -- Zabezpieczenie przed nieskończoną pętlą (max 9999 ofert w miesiącu)
    IF v_count > 9999 THEN
      RAISE EXCEPTION 'Przekroczono limit ofert dla miesiąca %/%', v_year, v_month;
    END IF;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Funkcja do walidacji unikalności numeru oferty
CREATE OR REPLACE FUNCTION validate_offer_number_unique()
RETURNS TRIGGER AS $$
BEGIN
  -- Sprawdź czy numer oferty już istnieje (pomijając obecny rekord przy UPDATE)
  IF EXISTS (
    SELECT 1 FROM offers 
    WHERE offer_number = NEW.offer_number 
    AND id != NEW.id
  ) THEN
    RAISE EXCEPTION 'Numer oferty % już istnieje. Proszę wybrać inny numer.', NEW.offer_number;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Usuń stary trigger i stwórz nowy dla unikalności
DROP TRIGGER IF EXISTS trigger_validate_offer_number_unique ON offers;
CREATE TRIGGER trigger_validate_offer_number_unique
  BEFORE INSERT OR UPDATE ON offers
  FOR EACH ROW
  EXECUTE FUNCTION validate_offer_number_unique();

-- Trigger do automatycznego generowania numeru oferty (pozostaje bez zmian)
DROP TRIGGER IF EXISTS trigger_auto_generate_offer_number ON offers;
CREATE TRIGGER trigger_auto_generate_offer_number
  BEFORE INSERT ON offers
  FOR EACH ROW
  EXECUTE FUNCTION auto_generate_offer_number();