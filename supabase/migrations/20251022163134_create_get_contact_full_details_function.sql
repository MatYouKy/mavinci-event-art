/*
  # Funkcja do pobierania pełnych szczegółów kontaktu/organizacji

  Tworzy funkcję RPC która pobiera WSZYSTKIE dane w jednym zapytaniu:
  - Podstawowe dane (organizacja LUB kontakt)
  - Powiązane osoby/organizacje
  - Notatki
  - Historia kontaktów
  
  Zwraca JSON z wszystkimi danymi, zmniejszając liczbę zapytań z ~10 do 1.
*/

CREATE OR REPLACE FUNCTION get_contact_full_details(entity_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result jsonb;
  entity_data jsonb;
  entity_type text;
BEGIN
  -- Sprawdź czy to organizacja
  SELECT to_jsonb(o.*) INTO entity_data
  FROM organizations o
  WHERE o.id = entity_id;

  IF entity_data IS NOT NULL THEN
    entity_type := 'organization';
  ELSE
    -- Sprawdź czy to kontakt
    SELECT to_jsonb(c.*) INTO entity_data
    FROM contacts c
    WHERE c.id = entity_id;

    IF entity_data IS NOT NULL THEN
      entity_type := 'contact';
    ELSE
      RETURN jsonb_build_object('error', 'Entity not found');
    END IF;
  END IF;

  -- Buduj wynik
  result := jsonb_build_object(
    'entity_type', entity_type,
    'entity_data', entity_data
  );

  -- Dla organizacji pobierz kontakty
  IF entity_type = 'organization' THEN
    result := result || jsonb_build_object(
      'contacts', (
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'id', co.id,
          'contact_id', c.id,
          'first_name', c.first_name,
          'last_name', c.last_name,
          'full_name', c.full_name,
          'email', c.email,
          'phone', c.phone,
          'mobile', c.mobile,
          'position', co.position,
          'is_primary', co.is_primary
        )), '[]'::jsonb)
        FROM contact_organizations co
        JOIN contacts c ON c.id = co.contact_id
        WHERE co.organization_id = entity_id AND co.is_current = true
      ),
      'notes', (
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'id', n.id,
          'note', n.note,
          'created_at', n.created_at,
          'created_by', n.created_by,
          'employee_name', COALESCE(e.name || ' ' || e.surname, 'System')
        ) ORDER BY n.created_at DESC), '[]'::jsonb)
        FROM organization_notes n
        LEFT JOIN employees e ON e.user_id = n.created_by
        WHERE n.organization_id = entity_id
      ),
      'history', (
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'id', h.id,
          'contact_type', h.contact_type,
          'subject', h.subject,
          'description', h.description,
          'contact_date', h.contact_date,
          'outcome', h.outcome,
          'next_action', h.next_action,
          'contacted_by', h.contacted_by
        ) ORDER BY h.contact_date DESC), '[]'::jsonb)
        FROM contact_history h
        WHERE h.organization_id = entity_id
        LIMIT 50
      )
    );
  END IF;

  -- Dla kontaktu pobierz organizacje
  IF entity_type = 'contact' THEN
    result := result || jsonb_build_object(
      'organizations', (
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'id', o.id,
          'name', COALESCE(o.alias, o.name),
          'email', o.email,
          'phone', o.phone,
          'city', o.city,
          'position', co.position,
          'is_primary', co.is_primary
        )), '[]'::jsonb)
        FROM contact_organizations co
        JOIN organizations o ON o.id = co.organization_id
        WHERE co.contact_id = entity_id AND co.is_current = true
      )
    );
  END IF;

  RETURN result;
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION get_contact_full_details(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION get_contact_full_details(uuid) TO service_role;
