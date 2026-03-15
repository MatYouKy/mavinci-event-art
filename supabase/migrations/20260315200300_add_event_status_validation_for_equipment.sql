/*
  # Walidacja Statusu Eventu - Blokada przy Brakach Sprzętowych

  1. Logika
    - Event nie może być oznaczony jako 'ready_for_execution' gdy:
      * pending_external_rental = true (są nierozwiązane braki sprzętowe)
      * has_equipment_shortage = true (są konflikty w ofertach)

  2. Implementacja
    - Trigger na zmianę statusu eventu
    - Walidacja przed zapisem
    - Komunikat błędu dla użytkownika

  3. Bezpieczeństwo
    - Trigger działa w kontekście użytkownika
    - Blokuje nieprawidłowe zmiany statusu
*/

-- Funkcja walidująca zmianę statusu eventu
CREATE OR REPLACE FUNCTION validate_event_status_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_has_unresolved_conflicts boolean;
BEGIN
  -- Jeśli status zmienia się na 'ready_for_execution'
  IF NEW.status::text = 'ready_for_execution' AND (OLD.status IS NULL OR OLD.status::text != 'ready_for_execution') THEN
    
    -- Sprawdź czy są nierozwiązane braki sprzętowe
    IF NEW.pending_external_rental = true THEN
      RAISE EXCEPTION 'Nie można zmienić statusu na "Gotowy do realizacji" - oczekuje na rental zewnętrzny. Rozwiąż braki sprzętowe w zakładce Konflikty oferty.'
        USING ERRCODE = 'P0001';
    END IF;
    
    -- Sprawdź czy są nierozwiązane konflikty w ofertach
    SELECT EXISTS (
      SELECT 1
      FROM offer_equipment_conflicts c
      JOIN offers o ON o.id = c.offer_id
      WHERE o.event_id = NEW.id
        AND o.status::text = 'accepted'
        AND c.status = 'unresolved'
        AND c.use_external_rental = false
    ) INTO v_has_unresolved_conflicts;
    
    IF v_has_unresolved_conflicts THEN
      RAISE EXCEPTION 'Nie można zmienić statusu na "Gotowy do realizacji" - są nierozwiązane konflikty sprzętowe w zaakceptowanej ofercie.'
        USING ERRCODE = 'P0001';
    END IF;
    
  END IF;
  
  RETURN NEW;
END;
$$;

-- Dodaj trigger walidujący
DROP TRIGGER IF EXISTS trigger_validate_event_status ON events;
CREATE TRIGGER trigger_validate_event_status
  BEFORE UPDATE OF status ON events
  FOR EACH ROW
  EXECUTE FUNCTION validate_event_status_change();

-- Funkcja pomocnicza do sprawdzenia czy event może być oznaczony jako gotowy
CREATE OR REPLACE FUNCTION can_event_be_ready_for_execution(p_event_id uuid)
RETURNS jsonb
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_pending_rental boolean;
  v_has_unresolved_conflicts boolean;
  v_conflicts jsonb[] := ARRAY[]::jsonb[];
  v_conflict record;
BEGIN
  -- Sprawdź flagę rentalu
  SELECT pending_external_rental INTO v_pending_rental
  FROM events
  WHERE id = p_event_id;
  
  -- Sprawdź konflikty
  SELECT EXISTS (
    SELECT 1
    FROM offer_equipment_conflicts c
    JOIN offers o ON o.id = c.offer_id
    WHERE o.event_id = p_event_id
      AND o.status::text = 'accepted'
      AND c.status = 'unresolved'
      AND c.use_external_rental = false
  ) INTO v_has_unresolved_conflicts;
  
  -- Pobierz szczegóły konfliktów
  IF v_has_unresolved_conflicts THEN
    FOR v_conflict IN
      SELECT 
        c.*,
        COALESCE(ei.name, ek.name) as equipment_name,
        o.offer_number
      FROM offer_equipment_conflicts c
      JOIN offers o ON o.id = c.offer_id
      LEFT JOIN equipment_items ei ON ei.id = c.equipment_item_id
      LEFT JOIN equipment_kits ek ON ek.id = c.equipment_kit_id
      WHERE o.event_id = p_event_id
        AND o.status::text = 'accepted'
        AND c.status = 'unresolved'
        AND c.use_external_rental = false
    LOOP
      v_conflicts := array_append(v_conflicts, to_jsonb(v_conflict));
    END LOOP;
  END IF;
  
  RETURN jsonb_build_object(
    'can_proceed', NOT (v_pending_rental OR v_has_unresolved_conflicts),
    'pending_external_rental', v_pending_rental,
    'has_unresolved_conflicts', v_has_unresolved_conflicts,
    'conflicts', to_jsonb(v_conflicts),
    'message', CASE
      WHEN v_pending_rental THEN 'Oczekuje na potwierdzenie rentalu zewnętrznego'
      WHEN v_has_unresolved_conflicts THEN 'Są nierozwiązane konflikty sprzętowe w zaakceptowanej ofercie'
      ELSE 'Event może być oznaczony jako gotowy do realizacji'
    END
  );
END;
$$;

-- Komentarze
COMMENT ON FUNCTION validate_event_status_change() IS
'Waliduje zmianę statusu eventu - blokuje oznaczenie jako "gotowy do realizacji" gdy są braki sprzętowe';

COMMENT ON FUNCTION can_event_be_ready_for_execution(uuid) IS
'Sprawdza czy event może być oznaczony jako gotowy do realizacji - zwraca szczegóły problemów jeśli nie';

COMMENT ON TRIGGER trigger_validate_event_status ON events IS
'Blokuje nieprawidłową zmianę statusu eventu gdy są nierozwiązane braki sprzętowe';
