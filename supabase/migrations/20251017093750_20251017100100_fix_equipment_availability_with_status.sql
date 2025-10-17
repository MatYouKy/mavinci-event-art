/*
  # Poprawa funkcji sprawdzania dostępności sprzętu

  1. Zmiany
    - Uwzględnia nowy status w event_equipment
    - Liczy tylko rezerwacje ze statusem 'reserved' lub 'in_use'
    - Poprawia odniesienia do equipment_id zamiast equipment_item_id
    - Liczy całkowitą ilość jednostek (equipment_units)

  2. Logika
    - total_quantity = wszystkie jednostki danego sprzętu
    - reserved_quantity = jednostki zarezerwowane w nakładających się wydarzeniach
    - available_quantity = total - reserved

  3. Notatki
    - Statusy 'returned' i 'cancelled' nie blokują dostępności
    - Sprawdza nakładanie się dat wydarzeń
*/

-- Drop old function
DROP FUNCTION IF EXISTS check_equipment_availability_for_event(uuid, timestamptz, timestamptz);

-- Create improved function
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
      equipment_id as item_id,
      'item' as item_type,
      SUM(quantity) as reserved_qty
    FROM event_equipment
    WHERE event_id IN (SELECT id FROM overlapping_events)
    AND equipment_id IS NOT NULL
    AND status IN ('reserved', 'in_use')
    GROUP BY equipment_id
  ),
  reserved_kits AS (
    SELECT
      kit_id as item_id,
      'kit' as item_type,
      SUM(quantity) as reserved_qty
    FROM event_equipment
    WHERE event_id IN (SELECT id FROM overlapping_events)
    AND kit_id IS NOT NULL
    AND status IN ('reserved', 'in_use')
    GROUP BY kit_id
  )
  -- Equipment items
  SELECT
    ei.id as item_id,
    'item'::text as item_type,
    ei.name as item_name,
    COALESCE(
      (SELECT COUNT(*) FROM equipment_units WHERE equipment_id = ei.id AND status IN ('available', 'reserved', 'in_use')),
      0
    )::integer as total_quantity,
    COALESCE(ri.reserved_qty, 0)::integer as reserved_quantity,
    GREATEST(
      COALESCE(
        (SELECT COUNT(*) FROM equipment_units WHERE equipment_id = ei.id AND status IN ('available', 'reserved', 'in_use')),
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

COMMENT ON FUNCTION check_equipment_availability_for_event IS 'Sprawdza dostępność sprzętu i zestawów w danym terminie, uwzględniając tylko aktywne rezerwacje (reserved, in_use)';
