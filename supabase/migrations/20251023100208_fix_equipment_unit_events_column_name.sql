/*
  # Fix get_equipment_details RPC - use correct column name
  
  Changes:
  - Replace `event_date` with `created_at` in equipment_unit_events queries
  - This fixes the 42703 error when fetching equipment details
*/

CREATE OR REPLACE FUNCTION get_equipment_details(equipment_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'id', ei.id,
    'name', ei.name,
    'category_id', ei.category_id,
    'description', ei.description,
    'thumbnail_url', ei.thumbnail_url,
    'manufacturer', ei.manufacturer,
    'model', ei.model,
    'cable_length', ei.cable_length,
    'cable_type', ei.cable_type,
    'cable_stock_quantity', ei.cable_stock_quantity,
    'created_at', ei.created_at,
    'updated_at', ei.updated_at,
    'uses_simple_quantity', COALESCE(
      CASE 
        WHEN wc.parent_id IS NOT NULL THEN parent_cat.uses_simple_quantity
        ELSE wc.uses_simple_quantity
      END,
      false
    ),
    'warehouse_categories', jsonb_build_object(
      'id', wc.id,
      'name', wc.name,
      'parent_id', wc.parent_id,
      'uses_simple_quantity', wc.uses_simple_quantity
    ),
    'connector_type_a', CASE 
      WHEN ei.connector_type_a_id IS NOT NULL THEN
        jsonb_build_object(
          'id', ct_a.id,
          'name', ct_a.name,
          'thumbnail_url', ct_a.thumbnail_url
        )
      ELSE NULL
    END,
    'connector_type_b', CASE 
      WHEN ei.connector_type_b_id IS NOT NULL THEN
        jsonb_build_object(
          'id', ct_b.id,
          'name', ct_b.name,
          'thumbnail_url', ct_b.thumbnail_url
        )
      ELSE NULL
    END,
    'units', COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', eu.id,
            'unit_serial_number', eu.unit_serial_number,
            'status', eu.status,
            'condition_notes', eu.condition_notes,
            'purchase_date', eu.purchase_date,
            'last_service_date', eu.last_service_date,
            'estimated_repair_date', eu.estimated_repair_date,
            'thumbnail_url', eu.thumbnail_url,
            'storage_location_id', eu.storage_location_id,
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
          )
        )
        FROM equipment_units eu
        LEFT JOIN storage_locations sl ON sl.id = eu.storage_location_id
        WHERE eu.equipment_item_id = ei.id
      ),
      '[]'::jsonb
    ),
    'images', COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', eqi.id,
            'image_url', eqi.image_url,
            'is_primary', eqi.is_primary,
            'display_order', eqi.display_order,
            'created_at', eqi.created_at
          ) ORDER BY eqi.display_order
        )
        FROM equipment_images eqi
        WHERE eqi.equipment_item_id = ei.id
      ),
      '[]'::jsonb
    ),
    'unit_events', COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', eue.id,
            'unit_id', eue.unit_id,
            'event_type', eue.event_type,
            'description', eue.description,
            'created_at', eue.created_at,
            'employee', CASE 
              WHEN e.user_id IS NOT NULL THEN
                jsonb_build_object(
                  'user_id', e.user_id,
                  'full_name', e.full_name
                )
              ELSE NULL
            END
          ) ORDER BY eue.created_at DESC
        )
        FROM equipment_unit_events eue
        LEFT JOIN employees e ON e.user_id = eue.employee_id
        JOIN equipment_units eu ON eu.id = eue.unit_id
        WHERE eu.equipment_item_id = ei.id
      ),
      '[]'::jsonb
    )
  ) INTO result
  FROM equipment_items ei
  LEFT JOIN warehouse_categories wc ON wc.id = ei.category_id
  LEFT JOIN warehouse_categories parent_cat ON parent_cat.id = wc.parent_id
  LEFT JOIN connector_types ct_a ON ct_a.id = ei.connector_type_a_id
  LEFT JOIN connector_types ct_b ON ct_b.id = ei.connector_type_b_id
  WHERE ei.id = equipment_id;

  RETURN result;
END;
$$;
