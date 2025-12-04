/*
  # Automatyczne ustawianie tytułu umowy na podstawie nazwy eventu
  
  1. Zmiany
    - Dodanie triggera do automatycznego ustawiania `title` na podstawie nazwy eventu
    - Tytuł będzie w formacie: "Umowa [nazwa eventu]"
    - Jeśli title jest pusty lub zawiera UUID, zostanie zastąpiony
    
  2. Aktualizacje
    - Aktualizacja istniejących umów, gdzie title zawiera UUID lub jest pusty
*/

-- Funkcja do automatycznego ustawiania tytułu umowy
CREATE OR REPLACE FUNCTION set_contract_title()
RETURNS TRIGGER AS $$
DECLARE
  v_event_name text;
BEGIN
  -- Jeśli title nie jest podany lub jest pusty, ustaw na podstawie nazwy eventu
  IF NEW.title IS NULL OR NEW.title = '' OR NEW.title ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    IF NEW.event_id IS NOT NULL THEN
      -- Pobierz nazwę eventu
      SELECT name INTO v_event_name
      FROM events
      WHERE id = NEW.event_id;
      
      IF v_event_name IS NOT NULL THEN
        NEW.title := 'Umowa ' || v_event_name;
      ELSE
        NEW.title := 'Umowa';
      END IF;
    ELSE
      NEW.title := 'Umowa';
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Usuń stary trigger jeśli istnieje
DROP TRIGGER IF EXISTS contracts_set_title ON contracts;

-- Utwórz trigger dla nowych i aktualizowanych umów
CREATE TRIGGER contracts_set_title
  BEFORE INSERT OR UPDATE ON contracts
  FOR EACH ROW
  EXECUTE FUNCTION set_contract_title();

-- Zaktualizuj istniejące umowy, gdzie title zawiera UUID lub jest pusty
UPDATE contracts c
SET title = CASE
  WHEN e.name IS NOT NULL THEN 'Umowa ' || e.name
  ELSE 'Umowa'
END
FROM events e
WHERE c.event_id = e.id
AND (c.title IS NULL OR c.title = '' OR c.title ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');

-- Zaktualizuj umowy bez event_id, gdzie title zawiera UUID lub jest pusty
UPDATE contracts
SET title = 'Umowa'
WHERE event_id IS NULL
AND (title IS NULL OR title = '' OR title ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');

COMMENT ON FUNCTION set_contract_title() IS 'Automatycznie ustawia tytuł umowy na podstawie nazwy eventu w formacie "Umowa [nazwa eventu]"';
