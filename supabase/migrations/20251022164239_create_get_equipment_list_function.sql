/*
  # Funkcja RPC dla listy sprzętu w magazynie

  Tworzy funkcję która pobiera:
  - Wszystkie equipment_items z kategoriami i jednostkami
  - Wszystkie equipment_kits z kategoriami
  - Wszystkie warehouse_categories
  
  Zwraca wszystko w jednym JSON, zmniejszając 3 zapytania do 1.
*/

CREATE OR REPLACE FUNCTION get_equipment_list()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result jsonb;
BEGIN
  result := jsonb_build_object(
    'equipment_items', (
      SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
          'id', ei.id,
          'name', ei.name,
          'brand', ei.brand,
          'model', ei.model,
          'description', ei.description,
          'thumbnail_url', ei.thumbnail_url,
          'warehouse_category_id', ei.warehouse_category_id,
          'is_kit', false,
          'warehouse_categories', CASE 
            WHEN wc.id IS NOT NULL THEN jsonb_build_object(
              'id', wc.id,
              'name', wc.name,
              'parent_id', wc.parent_id,
              'level', wc.level,
              'color', wc.color,
              'icon', wc.icon
            )
            ELSE NULL
          END,
          'equipment_units', (
            SELECT COALESCE(jsonb_agg(
              jsonb_build_object(
                'id', eu.id,
                'status', eu.status
              )
            ), '[]'::jsonb)
            FROM equipment_units eu
            WHERE eu.equipment_id = ei.id
          )
        ) ORDER BY ei.name
      ), '[]'::jsonb)
      FROM equipment_items ei
      LEFT JOIN warehouse_categories wc ON wc.id = ei.warehouse_category_id
      WHERE ei.is_active = true
    ),
    'equipment_kits', (
      SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
          'id', ek.id,
          'name', ek.name,
          'description', ek.description,
          'thumbnail_url', ek.thumbnail_url,
          'warehouse_category_id', ek.warehouse_category_id,
          'is_kit', true,
          'brand', NULL,
          'model', NULL,
          'equipment_units', '[]'::jsonb,
          'warehouse_categories', CASE 
            WHEN wc.id IS NOT NULL THEN jsonb_build_object(
              'id', wc.id,
              'name', wc.name,
              'parent_id', wc.parent_id,
              'level', wc.level,
              'color', wc.color,
              'icon', wc.icon
            )
            ELSE NULL
          END
        ) ORDER BY ek.name
      ), '[]'::jsonb)
      FROM equipment_kits ek
      LEFT JOIN warehouse_categories wc ON wc.id = ek.warehouse_category_id
      WHERE ek.is_active = true
    ),
    'warehouse_categories', (
      SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
          'id', wc.id,
          'name', wc.name,
          'description', wc.description,
          'parent_id', wc.parent_id,
          'level', wc.level,
          'icon', wc.icon,
          'color', wc.color,
          'order_index', wc.order_index
        ) ORDER BY wc.level, wc.order_index
      ), '[]'::jsonb)
      FROM warehouse_categories wc
      WHERE wc.is_active = true
    )
  );

  RETURN result;
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION get_equipment_list() TO authenticated;
GRANT EXECUTE ON FUNCTION get_equipment_list() TO service_role;
