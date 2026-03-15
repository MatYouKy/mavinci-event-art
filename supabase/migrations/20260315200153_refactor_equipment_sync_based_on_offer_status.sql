/*
  # Refaktoryzacja Synchronizacji Sprzętu - Bazowanie na Statusie Oferty

  1. Problem
    - Obecnie sprzęt jest synchronizowany NATYCHMIAST po utworzeniu oferty
    - Oferta draft blokuje sprzęt, co jest nieprawidłowe
    - Klient może otrzymać 3 oferty → wszystkie rezerwują sprzęt

  2. Nowa Logika
    - Status 'draft' / 'sent' → NIE synchronizuje sprzętu do event_equipment
    - Status 'accepted' → synchronizuje z reservation_status = 'reserved_pending'
    - Po podpisaniu umowy → zmiana na 'reserved_confirmed'
    - Synchronizacja tylko dla ofert bez nierozwiązanych konfliktów

  3. Zmiany
    - Wyłączenie automatycznego triggera sync_offer_equipment_items
    - Nowa funkcja reserve_equipment_from_offer(offer_id)
    - Trigger na zmianę statusu oferty na 'accepted'
    - Czyszczenie sprzętu gdy oferta jest odrzucona/wygasła

  4. Bezpieczeństwo
    - Funkcje działają w kontekście SECURITY DEFINER
    - Walidacja statusów oferty
    - Obsługa konfliktów
*/

-- Wyłącz stary trigger automatycznej synchronizacji
DROP TRIGGER IF EXISTS trg_sync_offer_equipment_items ON offer_items;

-- Funkcja do rezerwacji sprzętu z oferty (wywoływana przy zmianie statusu na 'accepted')
CREATE OR REPLACE FUNCTION reserve_equipment_from_offer(p_offer_id uuid)
RETURNS jsonb
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_event_id uuid;
  v_offer_status text;
  v_unresolved_conflicts integer;
  v_equipment_data jsonb;
  v_result jsonb;
BEGIN
  -- Pobierz dane oferty
  SELECT event_id, status::text INTO v_event_id, v_offer_status
  FROM offers
  WHERE id = p_offer_id;
  
  IF v_event_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Offer not found'
    );
  END IF;
  
  -- Sprawdź czy są nierozwiązane konflikty
  SELECT COUNT(*) INTO v_unresolved_conflicts
  FROM offer_equipment_conflicts
  WHERE offer_id = p_offer_id
    AND status = 'unresolved'
    AND use_external_rental = false;
  
  IF v_unresolved_conflicts > 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Cannot reserve equipment - unresolved conflicts exist',
      'unresolved_conflicts', v_unresolved_conflicts
    );
  END IF;
  
  -- Pobierz zagregowany sprzęt z oferty (z uwzględnieniem substytucji)
  SELECT get_offer_equipment_final(p_offer_id) INTO v_equipment_data;
  
  -- Usuń istniejący sprzęt z tej oferty (jeśli był)
  DELETE FROM event_equipment
  WHERE event_id = v_event_id
    AND offer_id = p_offer_id;
  
  -- Dodaj sprzęt z odpowiednim statusem rezerwacji
  INSERT INTO event_equipment (
    event_id,
    offer_id,
    equipment_item_id,
    equipment_kit_id,
    qty,
    reservation_status,
    status,
    auto_added,
    expand_kit_in_checklist
  )
  SELECT
    v_event_id,
    p_offer_id,
    CASE WHEN (item->>'item_type')::text = 'item' 
      THEN (item->>'item_id')::uuid 
      ELSE NULL 
    END,
    CASE WHEN (item->>'item_type')::text = 'kit' 
      THEN (item->>'item_id')::uuid 
      ELSE NULL 
    END,
    (item->>'qty')::integer,
    'reserved_pending'::equipment_reservation_status,
    'planned'::text,
    true,
    COALESCE((item->>'expand_kit_in_checklist')::boolean, false)
  FROM jsonb_array_elements(v_equipment_data) AS item
  WHERE (item->>'qty')::integer > 0; -- Pomijamy sprzęt z qty=0 (nierozwiązane konflikty)
  
  RETURN jsonb_build_object(
    'success', true,
    'event_id', v_event_id,
    'equipment_added', jsonb_array_length(v_equipment_data)
  );
END;
$$;

-- Funkcja do usunięcia rezerwacji sprzętu z oferty
CREATE OR REPLACE FUNCTION unreserve_equipment_from_offer(p_offer_id uuid)
RETURNS void
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_event_id uuid;
BEGIN
  -- Pobierz event_id
  SELECT event_id INTO v_event_id
  FROM offers
  WHERE id = p_offer_id;
  
  IF v_event_id IS NOT NULL THEN
    -- Usuń sprzęt z tej oferty
    DELETE FROM event_equipment
    WHERE event_id = v_event_id
      AND offer_id = p_offer_id;
  END IF;
END;
$$;

-- Trigger na zmianę statusu oferty
CREATE OR REPLACE FUNCTION handle_offer_status_change()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_result jsonb;
BEGIN
  -- Jeśli status zmienił się na 'accepted'
  IF NEW.status::text = 'accepted' AND (OLD.status IS NULL OR OLD.status::text != 'accepted') THEN
    -- Zarezerwuj sprzęt
    v_result := reserve_equipment_from_offer(NEW.id);
    
    -- Jeśli są nierozwiązane konflikty, ustaw flagę w evencie
    IF (v_result->>'success')::boolean = false THEN
      UPDATE events
      SET has_equipment_shortage = true
      WHERE id = NEW.event_id;
    END IF;
  END IF;
  
  -- Jeśli status zmienił się z 'accepted' na inny (rejected, expired)
  IF OLD.status::text = 'accepted' AND NEW.status::text != 'accepted' THEN
    -- Usuń rezerwację sprzętu
    PERFORM unreserve_equipment_from_offer(NEW.id);
  END IF;
  
  -- Jeśli oferta została usunięta
  IF TG_OP = 'DELETE' THEN
    PERFORM unreserve_equipment_from_offer(OLD.id);
    RETURN OLD;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Dodaj trigger do offers
DROP TRIGGER IF EXISTS trigger_handle_offer_status_change ON offers;
CREATE TRIGGER trigger_handle_offer_status_change
  AFTER UPDATE OF status ON offers
  FOR EACH ROW
  EXECUTE FUNCTION handle_offer_status_change();

-- Trigger na usunięcie oferty
DROP TRIGGER IF EXISTS trigger_cleanup_equipment_on_offer_delete ON offers;
CREATE TRIGGER trigger_cleanup_equipment_on_offer_delete
  BEFORE DELETE ON offers
  FOR EACH ROW
  EXECUTE FUNCTION handle_offer_status_change();

-- Funkcja do zapisywania konfliktów przy tworzeniu oferty
CREATE OR REPLACE FUNCTION save_offer_conflicts(
  p_offer_id uuid,
  p_conflicts jsonb
)
RETURNS void
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_conflict jsonb;
BEGIN
  -- Usuń stare konflikty dla tej oferty
  DELETE FROM offer_equipment_conflicts
  WHERE offer_id = p_offer_id;
  
  -- Zapisz nowe konflikty
  FOR v_conflict IN SELECT * FROM jsonb_array_elements(p_conflicts)
  LOOP
    INSERT INTO offer_equipment_conflicts (
      offer_id,
      equipment_item_id,
      equipment_kit_id,
      required_qty,
      available_qty,
      shortage_qty,
      status,
      conflict_details,
      conflict_until
    )
    VALUES (
      p_offer_id,
      CASE WHEN (v_conflict->>'item_type')::text = 'item' 
        THEN (v_conflict->>'item_id')::uuid 
        ELSE NULL 
      END,
      CASE WHEN (v_conflict->>'item_type')::text = 'kit' 
        THEN (v_conflict->>'item_id')::uuid 
        ELSE NULL 
      END,
      (v_conflict->>'required_qty')::integer,
      (v_conflict->>'available_qty')::integer,
      (v_conflict->>'shortage_qty')::integer,
      'unresolved'::conflict_status,
      v_conflict->'conflict_details',
      (v_conflict->>'conflict_until')::timestamptz
    );
  END LOOP;
END;
$$;

-- Komentarze
COMMENT ON FUNCTION reserve_equipment_from_offer(uuid) IS
'Rezerwuje sprzęt z oferty do eventu - wywoływane przy zmianie statusu na accepted';

COMMENT ON FUNCTION unreserve_equipment_from_offer(uuid) IS
'Usuwa rezerwację sprzętu z oferty - wywoływane gdy oferta jest odrzucona lub usunięta';

COMMENT ON FUNCTION save_offer_conflicts(uuid, jsonb) IS
'Zapisuje wykryte konflikty sprzętowe do tabeli offer_equipment_conflicts';

COMMENT ON TRIGGER trigger_handle_offer_status_change ON offers IS
'Automatycznie zarządza rezerwacją sprzętu na podstawie statusu oferty';
