/*
  # Create function to check equipment availability for event dates

  1. New Function
    - `check_equipment_availability_for_event` - Returns available quantity for each equipment item/kit in event date range
    
  2. Logic
    - Takes event_id, start_date, end_date as parameters
    - For each equipment item/kit, calculates:
      * Total units available
      * Units already assigned to OTHER events in the same date range
      * Returns net available quantity
    
  3. Returns
    - Table with columns: item_id, item_type ('item' or 'kit'), available_count
*/

-- Drop function if exists
DROP FUNCTION IF EXISTS check_equipment_availability_for_event(uuid, timestamptz, timestamptz);

-- Create function to check equipment availability
CREATE OR REPLACE FUNCTION check_equipment_availability_for_event(
  p_event_id uuid,
  p_start_date timestamptz,
  p_end_date timestamptz
)
RETURNS TABLE (
  item_id uuid,
  item_type text,
  item_name text,
  total_quantity integer,
  reserved_quantity integer,
  available_quantity integer
) AS $$
BEGIN
  RETURN QUERY
  WITH overlapping_events AS (
    SELECT id
    FROM events
    WHERE id != p_event_id
    AND status NOT IN ('cancelled', 'rejected')
    AND (
      (start_date, end_date) OVERLAPS (p_start_date, p_end_date)
    )
  ),
  reserved_items AS (
    SELECT 
      equipment_item_id as item_id,
      'item' as item_type,
      SUM(quantity) as reserved_qty
    FROM event_equipment
    WHERE event_id IN (SELECT id FROM overlapping_events)
    AND equipment_item_id IS NOT NULL
    GROUP BY equipment_item_id
  ),
  reserved_kits AS (
    SELECT 
      kit_id as item_id,
      'kit' as item_type,
      SUM(quantity) as reserved_qty
    FROM event_equipment
    WHERE event_id IN (SELECT id FROM overlapping_events)
    AND kit_id IS NOT NULL
    GROUP BY kit_id
  )
  -- Equipment items
  SELECT 
    ei.id as item_id,
    'item'::text as item_type,
    ei.name as item_name,
    COALESCE(
      (SELECT COUNT(*) FROM equipment_units WHERE equipment_item_id = ei.id AND status IN ('available', 'in_use')),
      0
    )::integer as total_quantity,
    COALESCE(ri.reserved_qty, 0)::integer as reserved_quantity,
    GREATEST(
      COALESCE(
        (SELECT COUNT(*) FROM equipment_units WHERE equipment_item_id = ei.id AND status IN ('available', 'in_use')),
        0
      ) - COALESCE(ri.reserved_qty, 0),
      0
    )::integer as available_quantity
  FROM equipment_items ei
  LEFT JOIN reserved_items ri ON ri.item_id = ei.id
  
  UNION ALL
  
  -- Equipment kits
  SELECT 
    ek.id as item_id,
    'kit'::text as item_type,
    ek.name as item_name,
    1::integer as total_quantity,
    COALESCE(rk.reserved_qty, 0)::integer as reserved_quantity,
    GREATEST(1 - COALESCE(rk.reserved_qty, 0), 0)::integer as available_quantity
  FROM equipment_kits ek
  LEFT JOIN reserved_kits rk ON rk.item_id = ek.id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION check_equipment_availability_for_event TO authenticated;
