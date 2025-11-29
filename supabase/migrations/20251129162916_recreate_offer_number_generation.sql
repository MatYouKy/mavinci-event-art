/*
  # Odtwórz system auto-generowania numerów ofert
  
  1. Funkcje
    - `generate_offer_number()` - generuje unikalny numer oferty w formacie OF/YYYY/MM/XXX
    - `auto_generate_offer_number()` - trigger function która wywołuje generate_offer_number
    - `validate_offer_number_unique()` - waliduje unikalność numeru
    
  2. Triggery
    - `trigger_auto_generate_offer_number` - automatycznie generuje numer przy INSERT jeśli NULL
    - `trigger_validate_offer_number_unique` - sprawdza unikalność przed INSERT/UPDATE
    
  3. Format numeru
    - OF/2025/11/001 - pierwszy numer w listopadzie 2025
    - OF/2025/11/002 - drugi numer w listopadzie 2025
*/

-- Funkcja do generowania unikalnego numeru oferty
CREATE OR REPLACE FUNCTION generate_offer_number(p_event_id uuid DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  v_year text;
  v_month text;
  v_count integer;
  v_prefix text;
  v_offer_number text;
  v_exists boolean;
BEGIN
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
$$;

-- Funkcja triggera do automatycznego generowania numeru
CREATE OR REPLACE FUNCTION auto_generate_offer_number()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Jeśli numer oferty nie jest podany lub jest pusty, wygeneruj automatycznie
  IF NEW.offer_number IS NULL OR NEW.offer_number = '' THEN
    NEW.offer_number := generate_offer_number(NEW.event_id);
  END IF;
  
  RETURN NEW;
END;
$$;

-- Funkcja do walidacji unikalności numeru oferty
CREATE OR REPLACE FUNCTION validate_offer_number_unique()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Sprawdź czy numer oferty już istnieje (pomijając obecny rekord przy UPDATE)
  IF NEW.offer_number IS NOT NULL AND EXISTS (
    SELECT 1 FROM offers 
    WHERE offer_number = NEW.offer_number 
    AND id != COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid)
  ) THEN
    RAISE EXCEPTION 'Numer oferty % już istnieje. Proszę wybrać inny numer.', NEW.offer_number;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Usuń stare triggery jeśli istnieją
DROP TRIGGER IF EXISTS trigger_auto_generate_offer_number ON offers;
DROP TRIGGER IF EXISTS trigger_validate_offer_number_unique ON offers;

-- Utwórz trigger do automatycznego generowania numeru (BEFORE INSERT)
CREATE TRIGGER trigger_auto_generate_offer_number
  BEFORE INSERT ON offers
  FOR EACH ROW
  EXECUTE FUNCTION auto_generate_offer_number();

-- Utwórz trigger do walidacji unikalności (BEFORE INSERT/UPDATE)
CREATE TRIGGER trigger_validate_offer_number_unique
  BEFORE INSERT OR UPDATE ON offers
  FOR EACH ROW
  EXECUTE FUNCTION validate_offer_number_unique();

-- Dodaj komentarze
COMMENT ON FUNCTION generate_offer_number(uuid) IS 
'Generuje unikalny numer oferty w formacie OF/YYYY/MM/XXX';

COMMENT ON FUNCTION auto_generate_offer_number() IS 
'Automatycznie generuje numer oferty jeśli nie został podany';

COMMENT ON FUNCTION validate_offer_number_unique() IS 
'Sprawdza czy numer oferty jest unikalny przed zapisem';
