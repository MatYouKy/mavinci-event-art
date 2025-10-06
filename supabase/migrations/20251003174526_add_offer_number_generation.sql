-- Dodaj pole event_type do events
ALTER TABLE events ADD COLUMN IF NOT EXISTS event_type text DEFAULT 'general' 
  CHECK (event_type IN ('conference', 'integration', 'wedding', 'corporate', 'private', 'festival', 'general'));

-- Funkcja do generowania numeru oferty
CREATE OR REPLACE FUNCTION generate_offer_number(p_event_id uuid)
RETURNS text AS $$
DECLARE
  v_event_type text;
  v_year text;
  v_month text;
  v_count integer;
  v_prefix text;
  v_offer_number text;
BEGIN
  -- Pobierz typ eventu
  SELECT event_type INTO v_event_type
  FROM events
  WHERE id = p_event_id;

  -- Jeśli brak event_id, użyj ogólnego
  IF v_event_type IS NULL THEN
    v_event_type := 'general';
  END IF;

  -- Ustaw prefix na podstawie typu
  CASE v_event_type
    WHEN 'conference' THEN v_prefix := 'KONF';
    WHEN 'integration' THEN v_prefix := 'INT';
    WHEN 'wedding' THEN v_prefix := 'WESL';
    WHEN 'corporate' THEN v_prefix := 'FIRM';
    WHEN 'private' THEN v_prefix := 'PRYW';
    WHEN 'festival' THEN v_prefix := 'FEST';
    ELSE v_prefix := 'OFF';
  END CASE;

  -- Pobierz rok i miesiąc
  v_year := TO_CHAR(CURRENT_DATE, 'YYYY');
  v_month := TO_CHAR(CURRENT_DATE, 'MM');

  -- Policz oferty z tym samym prefixem w tym miesiącu
  SELECT COUNT(*) + 1 INTO v_count
  FROM offers
  WHERE offer_number LIKE v_prefix || '/' || v_year || '/' || v_month || '%';

  -- Wygeneruj numer
  v_offer_number := v_prefix || '/' || v_year || '/' || v_month || '/' || LPAD(v_count::text, 3, '0');

  RETURN v_offer_number;
END;
$$ LANGUAGE plpgsql;

-- Trigger do automatycznego generowania numeru oferty
CREATE OR REPLACE FUNCTION auto_generate_offer_number()
RETURNS TRIGGER AS $$
BEGIN
  -- Jeśli numer oferty nie jest podany lub jest pusty
  IF NEW.offer_number IS NULL OR NEW.offer_number = '' THEN
    NEW.offer_number := generate_offer_number(NEW.event_id);
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Usuń trigger jeśli istnieje i stwórz nowy
DROP TRIGGER IF EXISTS trigger_auto_generate_offer_number ON offers;
CREATE TRIGGER trigger_auto_generate_offer_number
  BEFORE INSERT ON offers
  FOR EACH ROW
  EXECUTE FUNCTION auto_generate_offer_number();