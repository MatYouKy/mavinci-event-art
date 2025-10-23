/*
  # Fix get_equipment_details - use location_id instead of storage_location_id
  
  Changes:
  - equipment_units.storage_location_id -> equipment_units.location_id
*/

DROP FUNCTION IF EXISTS get_equipment_details(uuid, boolean);

CREATE FUNCTION get_equipment_details(
  item_id uuid,
  include_units boolean DEFAULT false
)
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

  -- Buduj końcowy obiekt JSON
  SELECT jsonb_build_object(
    'equipment', item_data,
    'warehouse_category', (
      SELECT jsonb_build_object(
        'id', wc.id,
        'name', wc.name,
        'parent_id', wc.parent_id,
        'uses_simple_quantity', wc.uses_simple_quantity
      )
      FROM warehouse_categories wc
      WHERE wc.id = (item_data->>'category_id')::uuid
    ),
    'warehouse_categories', (
      SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
          'id', wc.id,
          'name', wc.name,
          'parent_id', wc.parent_id,
          'uses_simple_quantity', wc.uses_simple_quantity
        ) ORDER BY wc.name
      ), '[]'::jsonb)
      FROM warehouse_categories wc
    ),
    'equipment_stock', (
      SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
          'id', es.id,
          'equipment_id', es.equipment_id,
          'storage_location', es.storage_location,
          'total_quantity', es.total_quantity,
          'available_quantity', es.available_quantity,
          'reserved_quantity', es.reserved_quantity,
          'in_use_quantity', es.in_use_quantity,
          'damaged_quantity', es.damaged_quantity,
          'in_service_quantity', es.in_service_quantity,
          'min_stock_level', es.min_stock_level,
          'company_stock_quantity', es.company_stock_quantity,
          'last_inventory_date', es.last_inventory_date,
          'updated_at', es.updated_at
        )
      ), '[]'::jsonb)
      FROM equipment_stock es
      WHERE es.equipment_id = item_id
    ),
    'equipment_components', (
      SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
          'id', ec.id,
          'equipment_id', ec.equipment_id,
          'component_name', ec.component_name,
          'quantity', ec.quantity,
          'description', ec.description,
          'is_included', ec.is_included,
          'created_at', ec.created_at
        ) ORDER BY ec.component_name
      ), '[]'::jsonb)
      FROM equipment_components ec
      WHERE ec.equipment_id = item_id
    ),
    'equipment_images', (
      SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
          'id', ei_img.id,
          'equipment_id', ei_img.equipment_id,
          'image_url', ei_img.image_url,
          'title', ei_img.title,
          'is_primary', ei_img.is_primary,
          'sort_order', ei_img.sort_order,
          'uploaded_by', ei_img.uploaded_by,
          'created_at', ei_img.created_at,
          'updated_at', ei_img.updated_at
        ) ORDER BY ei_img.sort_order
      ), '[]'::jsonb)
      FROM equipment_images ei_img
      WHERE ei_img.equipment_id = item_id
    ),
    'units', CASE WHEN include_units THEN
      (
        SELECT COALESCE(jsonb_agg(
          jsonb_build_object(
            'id', eu.id,
            'equipment_id', eu.equipment_id,
            'unit_serial_number', eu.unit_serial_number,
            'status', eu.status,
            'condition_notes', eu.condition_notes,
            'purchase_date', eu.purchase_date,
            'last_service_date', eu.last_service_date,
            'estimated_repair_date', eu.estimated_repair_date,
            'thumbnail_url', eu.thumbnail_url,
            'location_id', eu.location_id,
            'storage_location', CASE 
              WHEN sl.id IS NOT NULL THEN
                jsonb_build_object(
                  'id', sl.id,
                  'name', sl.name,
                  'description', sl.description
                )
              ELSE NULL
            END,
            'created_at', eu.created_at,
            'updated_at', eu.updated_at
          ) ORDER BY eu.created_at DESC
        ), '[]'::jsonb)
        FROM equipment_units eu
        LEFT JOIN storage_locations sl ON sl.id = eu.location_id
        WHERE eu.equipment_id = item_id
      )
    ELSE '[]'::jsonb
    END,
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
          'created_at', eue.created_at,
          'unit_serial', eu.unit_serial_number,
          'employee_name', CASE
            WHEN e.user_id IS NOT NULL THEN e.full_name
            ELSE NULL
          END
        ) ORDER BY eue.created_at DESC
      ), '[]'::jsonb)
      FROM equipment_unit_events eue
      JOIN equipment_units eu ON eu.id = eue.unit_id
      LEFT JOIN employees e ON e.user_id = eue.employee_id
      WHERE eu.equipment_id = item_id
    )
  ) INTO result;

  RETURN result;
END;
$$;
