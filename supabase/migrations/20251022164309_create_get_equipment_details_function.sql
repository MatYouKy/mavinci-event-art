/*
  # Funkcja RPC dla szczegółów sprzętu

  Tworzy funkcję która pobiera:
  - Szczegóły equipment_item z wszystkimi relacjami
  - Warehouse categories (do selecta)
  - Connector types (do selecta)
  - Equipment units (tylko gdy potrzebne)
  - Equipment unit events (historia)
  
  Zwraca wszystko w jednym JSON.
*/

CREATE OR REPLACE FUNCTION get_equipment_details(item_id uuid, include_units boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result jsonb;
  item_data jsonb;
BEGIN
  -- Pobierz podstawowe dane sprzętu
  SELECT to_jsonb(ei.*) INTO item_data
  FROM equipment_items ei
  WHERE ei.id = item_id;

  IF item_data IS NULL THEN
    RETURN jsonb_build_object('error', 'Equipment not found');
  END IF;

  -- Buduj wynik
  result := jsonb_build_object(
    'equipment', item_data,
    'warehouse_category', (
      SELECT to_jsonb(wc.*)
      FROM warehouse_categories wc
      WHERE wc.id = (item_data->>'warehouse_category_id')::uuid
    ),
    'equipment_stock', (
      SELECT COALESCE(jsonb_agg(to_jsonb(es.*)), '[]'::jsonb)
      FROM equipment_stock es
      WHERE es.equipment_id = item_id
    ),
    'equipment_components', (
      SELECT COALESCE(jsonb_agg(to_jsonb(ec.*) ORDER BY ec.component_name), '[]'::jsonb)
      FROM equipment_components ec
      WHERE ec.equipment_id = item_id
    ),
    'equipment_images', (
      SELECT COALESCE(jsonb_agg(to_jsonb(ei.*) ORDER BY ei.sort_order), '[]'::jsonb)
      FROM equipment_images ei
      WHERE ei.equipment_id = item_id
    ),
    'warehouse_categories', (
      SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
          'id', wc.id,
          'name', wc.name,
          'parent_id', wc.parent_id,
          'level', wc.level
        ) ORDER BY wc.level, wc.order_index
      ), '[]'::jsonb)
      FROM warehouse_categories wc
      WHERE wc.is_active = true
    ),
    'connector_types', (
      SELECT COALESCE(jsonb_agg(to_jsonb(ct.*) ORDER BY ct.name), '[]'::jsonb)
      FROM connector_types ct
      WHERE ct.is_active = true
    )
  );

  -- Dodaj jednostki jeśli potrzebne
  IF include_units THEN
    result := result || jsonb_build_object(
      'equipment_units', (
        SELECT COALESCE(jsonb_agg(
          jsonb_build_object(
            'id', eu.id,
            'equipment_id', eu.equipment_id,
            'unit_serial_number', eu.unit_serial_number,
            'status', eu.status,
            'location', eu.location,
            'location_id', eu.location_id,
            'condition_notes', eu.condition_notes,
            'purchase_date', eu.purchase_date,
            'last_service_date', eu.last_service_date,
            'estimated_repair_date', eu.estimated_repair_date,
            'thumbnail_url', eu.thumbnail_url,
            'created_at', eu.created_at,
            'updated_at', eu.updated_at,
            'storage_location', CASE 
              WHEN sl.id IS NOT NULL THEN jsonb_build_object('name', sl.name)
              ELSE NULL
            END
          ) ORDER BY eu.created_at DESC
        ), '[]'::jsonb)
        FROM equipment_units eu
        LEFT JOIN storage_locations sl ON sl.id = eu.location_id
        WHERE eu.equipment_id = item_id
      ),
      'unit_events', (
        SELECT COALESCE(jsonb_agg(
          jsonb_build_object(
            'id', eue.id,
            'unit_id', eue.unit_id,
            'event_type', eue.event_type,
            'description', eue.description,
            'image_url', eue.image_url,
            'old_status', eue.old_status,
            'new_status', eue.new_status,
            'employee_id', eue.employee_id,
            'event_date', eue.event_date,
            'created_at', eue.created_at,
            'unit_serial', eu.unit_serial_number,
            'employee_name', CASE
              WHEN e.id IS NOT NULL THEN e.name || ' ' || e.surname
              ELSE NULL
            END
          ) ORDER BY eue.event_date DESC
        ), '[]'::jsonb)
        FROM equipment_unit_events eue
        JOIN equipment_units eu ON eu.id = eue.unit_id
        LEFT JOIN employees e ON e.id = eue.employee_id
        WHERE eu.equipment_id = item_id
        LIMIT 50
      )
    );
  END IF;

  RETURN result;
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION get_equipment_details(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION get_equipment_details(uuid, boolean) TO service_role;
