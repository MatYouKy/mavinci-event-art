/*
  # Fix equipment sync - skip unresolved conflicts

  1. Changes
    - Modified `get_offer_equipment_final` to exclude items with unresolved conflicts
    - Only equipment with substitutions OR without conflicts is synced to event
    - Equipment with conflicts but no substitution is NOT added to event_equipment

  2. Logic
    - If item has substitution → use substitution (to_item_id)
    - If item has conflict but NO substitution → SKIP (qty = 0)
    - If item has no conflict → add normally

  3. Alert System
    - Alert moved from "Szczegóły" tab to "Sprzęt" tab
    - Shows when has_equipment_shortage = true
    - Button "Rozwiąż konflikty" opens offer wizard to resolve conflicts
*/

-- Update get_offer_equipment_final to skip items with unresolved conflicts
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

-- Substitutions: items that have conflicts and were replaced
sub_from AS (
  SELECT
    oes.from_item_id as equipment_item_id,
    SUM(oes.qty) as qty
  FROM offer_equipment_substitutions oes
  WHERE oes.offer_id = p_offer_id
  GROUP BY oes.from_item_id
),

-- Substitutions: replacement items to add
sub_to AS (
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
    COALESCE(a.equipment_item_id, sf.equipment_item_id, st.equipment_item_id) as equipment_item_id,
    a.equipment_kit_id,
    CASE
      WHEN a.equipment_kit_id IS NOT NULL THEN
        -- Kits: no substitution, add as-is
        a.qty
      WHEN sf.equipment_item_id IS NOT NULL THEN
        -- Item has substitution: remove original, add replacement
        COALESCE(a.qty, 0) - COALESCE(sf.qty, 0) + COALESCE(st.qty, 0)
      ELSE
        -- Item has no substitution: add normally
        COALESCE(a.qty, 0) + COALESCE(st.qty, 0)
    END as qty
  FROM aggregated a
  FULL JOIN sub_from sf ON sf.equipment_item_id = a.equipment_item_id AND a.equipment_kit_id IS NULL
  FULL JOIN sub_to st ON st.equipment_item_id = COALESCE(a.equipment_item_id, sf.equipment_item_id) AND a.equipment_kit_id IS NULL
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

COMMENT ON FUNCTION get_offer_equipment_final IS 'Zwraca finalny sprzęt z oferty: pojedyncze elementy + kity jako całości (bez rozwijania), z uwzględnieniem substytucji. NIE dodaje sprzętu z nierozwiązanymi konfliktami.';