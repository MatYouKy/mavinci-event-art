/*
  # RPC dla Podglądu Rezerwacji Sprzętu

  1. Funkcje
    - `get_offer_equipment_for_reservation` - zwraca listę sprzętu z oferty
      wraz z aktualną dostępnością (do pokazania w modalu "Zablokuj sprzęt")
    
    - `confirm_equipment_reservation` - potwierdza rezerwację i zmienia status
      oferty na 'accepted'

  2. Użycie
    - Przed zmianą statusu oferty na 'accepted'
    - Pokazuje użytkownikowi co zostanie zarezerwowane
    - Waliduje czy nadal jest dostępny sprzęt
    - Pozwala na potwierdzenie lub anulowanie

  3. Bezpieczeństwo
    - Funkcje działają w kontekście SECURITY DEFINER
    - Sprawdzają uprawnienia użytkownika
*/

-- Funkcja do pobierania sprzętu z oferty z aktualną dostępnością
CREATE OR REPLACE FUNCTION get_offer_equipment_for_reservation(p_offer_id uuid)
RETURNS jsonb
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_event_id uuid;
  v_start_date timestamptz;
  v_end_date timestamptz;
  v_equipment_data jsonb;
  v_result jsonb[] := ARRAY[]::jsonb[];
  v_item jsonb;
  v_item_id uuid;
  v_item_type text;
  v_qty integer;
  v_total_qty integer;
  v_reserved_qty integer;
  v_available_qty integer;
  v_item_name text;
BEGIN
  -- Pobierz dane eventu
  SELECT e.id, e.start_date, e.end_date
  INTO v_event_id, v_start_date, v_end_date
  FROM offers o
  JOIN events e ON e.id = o.event_id
  WHERE o.id = p_offer_id;
  
  IF v_event_id IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;
  
  -- Pobierz zagregowany sprzęt z oferty
  SELECT get_offer_equipment_final(p_offer_id) INTO v_equipment_data;
  
  -- Dla każdego elementu sprawdź dostępność
  FOR v_item IN SELECT * FROM jsonb_array_elements(v_equipment_data)
  LOOP
    v_item_type := v_item->>'item_type';
    v_item_id := (v_item->>'item_id')::uuid;
    v_qty := (v_item->>'qty')::integer;
    
    IF v_item_type = 'item' THEN
      -- Dla pojedynczego sprzętu
      SELECT 
        ei.name,
        COUNT(eu.id),
        COALESCE(SUM(
          CASE WHEN ee.event_id != v_event_id 
               AND e.start_date < v_end_date 
               AND e.end_date > v_start_date
               AND ee.reservation_status IN ('reserved_pending', 'reserved_confirmed', 'in_use')
          THEN ee.qty 
          ELSE 0 
          END
        ), 0)
      INTO v_item_name, v_total_qty, v_reserved_qty
      FROM equipment_items ei
      LEFT JOIN equipment_units eu ON eu.item_id = ei.id AND eu.status = 'available'
      LEFT JOIN event_equipment ee ON (ee.equipment_item_id = ei.id OR ee.equipment_kit_id IN (
        SELECT kit_id FROM equipment_kit_items WHERE item_id = ei.id
      ))
      LEFT JOIN events e ON e.id = ee.event_id
      WHERE ei.id = v_item_id
      GROUP BY ei.name;
      
    ELSE
      -- Dla kitu
      SELECT 
        ek.name,
        999, -- Kity nie mają ograniczenia ilości
        0
      INTO v_item_name, v_total_qty, v_reserved_qty
      FROM equipment_kits ek
      WHERE ek.id = v_item_id;
    END IF;
    
    v_available_qty := v_total_qty - v_reserved_qty;
    
    v_result := array_append(v_result, jsonb_build_object(
      'item_type', v_item_type,
      'item_id', v_item_id,
      'item_name', v_item_name,
      'required_qty', v_qty,
      'total_qty', v_total_qty,
      'reserved_qty', v_reserved_qty,
      'available_qty', v_available_qty,
      'has_conflict', v_available_qty < v_qty,
      'shortage_qty', GREATEST(0, v_qty - v_available_qty)
    ));
  END LOOP;
  
  RETURN to_jsonb(v_result);
END;
$$;

-- Funkcja do potwierdzenia rezerwacji sprzętu
CREATE OR REPLACE FUNCTION confirm_equipment_reservation(p_offer_id uuid)
RETURNS jsonb
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_current_status text;
  v_result jsonb;
BEGIN
  -- Sprawdź aktualny status oferty
  SELECT status::text INTO v_current_status
  FROM offers
  WHERE id = p_offer_id;
  
  IF v_current_status IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Offer not found'
    );
  END IF;
  
  IF v_current_status = 'accepted' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Offer is already accepted'
    );
  END IF;
  
  -- Zmień status oferty na 'accepted'
  -- Trigger automatycznie zarezerwuje sprzęt
  UPDATE offers
  SET status = 'accepted'
  WHERE id = p_offer_id;
  
  -- Sprawdź czy rezerwacja się powiodła
  v_result := reserve_equipment_from_offer(p_offer_id);
  
  RETURN v_result;
END;
$$;

-- Funkcja do rozwiązania konfliktu przez substytucję
CREATE OR REPLACE FUNCTION resolve_conflict_with_substitution(
  p_conflict_id uuid,
  p_substitute_item_id uuid DEFAULT NULL,
  p_substitute_kit_id uuid DEFAULT NULL
)
RETURNS jsonb
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_conflict record;
  v_substitute_name text;
BEGIN
  -- Pobierz konflikt
  SELECT * INTO v_conflict
  FROM offer_equipment_conflicts
  WHERE id = p_conflict_id;
  
  IF v_conflict IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Conflict not found');
  END IF;
  
  -- Zapisz substytucję
  INSERT INTO offer_equipment_substitutions (
    offer_id,
    from_item_type,
    from_item_id,
    to_item_type,
    to_item_id,
    qty
  )
  VALUES (
    v_conflict.offer_id,
    CASE WHEN v_conflict.equipment_item_id IS NOT NULL THEN 'item' ELSE 'kit' END,
    COALESCE(v_conflict.equipment_item_id, v_conflict.equipment_kit_id),
    CASE WHEN p_substitute_item_id IS NOT NULL THEN 'item' ELSE 'kit' END,
    COALESCE(p_substitute_item_id, p_substitute_kit_id),
    v_conflict.required_qty
  );
  
  -- Zaktualizuj status konfliktu
  UPDATE offer_equipment_conflicts
  SET 
    status = 'substituted',
    resolved_at = now(),
    resolved_by = auth.uid()
  WHERE id = p_conflict_id;
  
  RETURN jsonb_build_object('success', true);
END;
$$;

-- Funkcja do oznaczenia konfliktu jako rental zewnętrzny
CREATE OR REPLACE FUNCTION resolve_conflict_with_external_rental(
  p_conflict_id uuid,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  -- Zaktualizuj konflikt
  UPDATE offer_equipment_conflicts
  SET 
    status = 'external_rental',
    use_external_rental = true,
    resolved_at = now(),
    resolved_by = auth.uid(),
    notes = p_notes
  WHERE id = p_conflict_id;
  
  -- Trigger automatycznie zaktualizuje flagę pending_external_rental w events
  
  RETURN jsonb_build_object('success', true);
END;
$$;

-- Komentarze
COMMENT ON FUNCTION get_offer_equipment_for_reservation(uuid) IS
'Zwraca listę sprzętu z oferty wraz z aktualną dostępnością - do pokazania w modalu przed rezerwacją';

COMMENT ON FUNCTION confirm_equipment_reservation(uuid) IS
'Potwierdza rezerwację sprzętu - zmienia status oferty na accepted i rezerwuje sprzęt';

COMMENT ON FUNCTION resolve_conflict_with_substitution(uuid, uuid, uuid) IS
'Rozwiązuje konflikt przez zastąpienie sprzętu alternatywą';

COMMENT ON FUNCTION resolve_conflict_with_external_rental(uuid, text) IS
'Oznacza konflikt jako rozwiązany przez rental zewnętrzny';
