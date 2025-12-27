/*
  # Remove kit expansion from event_equipment

  1. Changes
    - Kits are added as whole units (kit_id) to event_equipment
    - Kit items are NOT added as separate entries
    - Kit expansion happens only in bookings system and checklist printing
    - Removes duplicate entries in equipment tab

  2. Notes
    - Users can see kit contents by expanding the kit row
    - Checklist can optionally expand kits when printing
    - Booking system automatically expands kits for availability tracking
    - offer_product_equipment does NOT have cable_id column
*/

DROP FUNCTION IF EXISTS public.get_offer_equipment_final(uuid);

CREATE FUNCTION public.get_offer_equipment_final(p_offer_id uuid)
RETURNS TABLE(
  equipment_item_id uuid,
  equipment_kit_id uuid,
  qty bigint
)
LANGUAGE sql
STABLE
AS $function$
WITH 
-- Individual items from products
individual_items AS (
  SELECT
    ope.equipment_item_id,
    NULL::uuid as equipment_kit_id,
    SUM(oi.quantity * ope.quantity) as qty
  FROM offer_items oi
  JOIN offer_product_equipment ope ON ope.product_id = oi.product_id
  WHERE oi.offer_id = p_offer_id
    AND ope.equipment_item_id IS NOT NULL
    AND ope.is_optional = false
  GROUP BY ope.equipment_item_id
),

-- Kits from products (as whole units, NOT expanded)
kits AS (
  SELECT
    NULL::uuid as equipment_item_id,
    ope.equipment_kit_id,
    SUM(oi.quantity * ope.quantity) as qty
  FROM offer_items oi
  JOIN offer_product_equipment ope ON ope.product_id = oi.product_id
  WHERE oi.offer_id = p_offer_id
    AND ope.equipment_kit_id IS NOT NULL
    AND ope.is_optional = false
  GROUP BY ope.equipment_kit_id
),

-- Combine all
base AS (
  SELECT equipment_item_id, equipment_kit_id, qty FROM individual_items
  UNION ALL
  SELECT equipment_item_id, equipment_kit_id, qty FROM kits
),

-- Aggregate
aggregated AS (
  SELECT
    equipment_item_id,
    equipment_kit_id,
    SUM(qty) as qty
  FROM base
  GROUP BY equipment_item_id, equipment_kit_id
),

-- Substitutions: items to remove
sub_minus AS (
  SELECT
    oes.from_item_id as equipment_item_id,
    SUM(oes.qty) as qty
  FROM offer_equipment_substitutions oes
  WHERE oes.offer_id = p_offer_id
  GROUP BY oes.from_item_id
),

-- Substitutions: items to add
sub_plus AS (
  SELECT
    oes.to_item_id as equipment_item_id,
    SUM(oes.qty) as qty
  FROM offer_equipment_substitutions oes
  WHERE oes.offer_id = p_offer_id
  GROUP BY oes.to_item_id
),

-- Apply substitutions only to equipment_items (not kits)
final AS (
  SELECT
    COALESCE(a.equipment_item_id, sm.equipment_item_id, sp.equipment_item_id) as equipment_item_id,
    a.equipment_kit_id,
    CASE 
      WHEN a.equipment_kit_id IS NOT NULL THEN a.qty  -- Kits: no substitution
      ELSE COALESCE(a.qty, 0) - COALESCE(sm.qty, 0) + COALESCE(sp.qty, 0)  -- Items: apply substitutions
    END as qty
  FROM aggregated a
  FULL JOIN sub_minus sm ON sm.equipment_item_id = a.equipment_item_id AND a.equipment_kit_id IS NULL
  FULL JOIN sub_plus sp ON sp.equipment_item_id = COALESCE(a.equipment_item_id, sm.equipment_item_id) AND a.equipment_kit_id IS NULL
)

SELECT
  equipment_item_id,
  equipment_kit_id,
  qty
FROM final
WHERE qty > 0
ORDER BY 
  equipment_kit_id NULLS LAST,
  qty DESC;
$function$;

-- Update sync function
DROP FUNCTION IF EXISTS public.sync_offer_equipment_to_event(uuid);

CREATE FUNCTION public.sync_offer_equipment_to_event(p_offer_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_event_id uuid;
BEGIN
  SELECT event_id INTO v_event_id
  FROM public.offers
  WHERE id = p_offer_id;

  IF v_event_id IS NULL THEN
    RETURN;
  END IF;

  -- Delete equipment from this offer
  DELETE FROM public.event_equipment
  WHERE event_id = v_event_id
    AND offer_id = p_offer_id;

  -- Insert equipment items
  INSERT INTO public.event_equipment (
    event_id,
    equipment_id,
    quantity,
    status,
    offer_id,
    auto_added,
    auto_quantity,
    removed_from_offer,
    offer_quantity
  )
  SELECT
    v_event_id,
    x.equipment_item_id,
    x.qty::int,
    'reserved',
    p_offer_id,
    true,
    x.qty::int,
    false,
    x.qty::int
  FROM public.get_offer_equipment_final(p_offer_id) x
  WHERE x.equipment_item_id IS NOT NULL;

  -- Insert kits (as whole units, NOT expanded)
  INSERT INTO public.event_equipment (
    event_id,
    kit_id,
    quantity,
    status,
    offer_id,
    auto_added,
    auto_quantity,
    removed_from_offer,
    offer_quantity
  )
  SELECT
    v_event_id,
    x.equipment_kit_id,
    x.qty::int,
    'reserved',
    p_offer_id,
    true,
    x.qty::int,
    false,
    x.qty::int
  FROM public.get_offer_equipment_final(p_offer_id) x
  WHERE x.equipment_kit_id IS NOT NULL;
END;
$function$;

COMMENT ON FUNCTION get_offer_equipment_final IS 'Zwraca finalny sprzęt z oferty: pojedyncze elementy + kity jako całości (bez rozwijania), z uwzględnieniem substytucji';
COMMENT ON FUNCTION sync_offer_equipment_to_event IS 'Synchronizuje sprzęt i kity z oferty do eventu. Kity NIE są rozwijane - są dodawane jako całość.';
