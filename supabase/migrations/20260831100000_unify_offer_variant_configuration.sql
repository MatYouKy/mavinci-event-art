/*
  One source of truth for offer-product variant configuration.

  The base product remains the core configuration. Every variant explicitly
  decides whether it inherits a section or owns an override for that section.
  This avoids guessing from an empty list and makes an intentionally empty
  variant configuration possible.
*/

ALTER TABLE public.offer_product_variants
  ADD COLUMN IF NOT EXISTS overrides_equipment boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS overrides_staff boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS overrides_mavinci_live boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS overrides_contract_clauses boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS recommended_contract_clauses text,
  ADD COLUMN IF NOT EXISTS recommended_contract_clause_category text NOT NULL DEFAULT 'requirements';

ALTER TABLE public.offer_product_variants
  DROP CONSTRAINT IF EXISTS offer_product_variants_contract_clause_category_check;
ALTER TABLE public.offer_product_variants
  ADD CONSTRAINT offer_product_variants_contract_clause_category_check
  CHECK (recommended_contract_clause_category IN ('requirements', 'obligations', 'risks', 'general'));

ALTER TABLE public.offer_product_staff
  ADD COLUMN IF NOT EXISTS product_variant_id uuid
    REFERENCES public.offer_product_variants(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_offer_product_staff_variant
  ON public.offer_product_staff(product_variant_id)
  WHERE product_variant_id IS NOT NULL;

ALTER TABLE public.offer_product_mavinci_live_modules
  ADD COLUMN IF NOT EXISTS product_variant_id uuid
    REFERENCES public.offer_product_variants(id) ON DELETE CASCADE;

ALTER TABLE public.offer_product_mavinci_live_modules
  DROP CONSTRAINT IF EXISTS offer_product_mavinci_live_modules_product_id_module_key_key;

CREATE UNIQUE INDEX IF NOT EXISTS uq_offer_product_live_module_base
  ON public.offer_product_mavinci_live_modules(product_id, module_key)
  WHERE product_variant_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_offer_product_live_module_variant
  ON public.offer_product_mavinci_live_modules(product_id, product_variant_id, module_key)
  WHERE product_variant_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_offer_product_live_modules_variant
  ON public.offer_product_mavinci_live_modules(product_variant_id)
  WHERE product_variant_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.validate_offer_variant_configuration_owner()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.product_variant_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.offer_product_variants variant
    WHERE variant.id = NEW.product_variant_id
      AND variant.product_id = NEW.product_id
  ) THEN
    RAISE EXCEPTION 'Wariant konfiguracji nie należy do wskazanego produktu';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_offer_staff_variant
  ON public.offer_product_staff;
CREATE TRIGGER trg_validate_offer_staff_variant
  BEFORE INSERT OR UPDATE OF product_id, product_variant_id
  ON public.offer_product_staff
  FOR EACH ROW EXECUTE FUNCTION public.validate_offer_variant_configuration_owner();

DROP TRIGGER IF EXISTS trg_validate_offer_live_variant
  ON public.offer_product_mavinci_live_modules;
CREATE TRIGGER trg_validate_offer_live_variant
  BEFORE INSERT OR UPDATE OF product_id, product_variant_id
  ON public.offer_product_mavinci_live_modules
  FOR EACH ROW EXECUTE FUNCTION public.validate_offer_variant_configuration_owner();

-- Equipment selection follows the explicit override flag. A variant that does
-- not override equipment reads the base rows; an overridden empty scope stays empty.
CREATE OR REPLACE FUNCTION public.get_offer_selected_equipment(
  p_offer_id uuid,
  p_package_id uuid DEFAULT NULL
)
RETURNS TABLE(item_type text, item_id uuid, qty bigint)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
WITH source_lines AS (
  SELECT
    item.product_id,
    item.product_variant_id,
    item.quantity::numeric AS quantity
  FROM public.offer_items item
  WHERE item.offer_id = p_offer_id
    AND p_package_id IS NULL

  UNION ALL

  SELECT
    item.product_id,
    item.product_variant_id,
    item.quantity
  FROM public.offer_package_items item
  JOIN public.offer_packages package ON package.id = item.package_id
  WHERE package.offer_id = p_offer_id
    AND package.id = p_package_id
), selected_equipment AS (
  SELECT
    source.quantity AS source_quantity,
    equipment.quantity AS equipment_quantity,
    equipment.equipment_item_id,
    equipment.equipment_kit_id
  FROM source_lines source
  LEFT JOIN public.offer_product_variants variant
    ON variant.id = source.product_variant_id
   AND variant.product_id = source.product_id
  JOIN public.offer_product_equipment equipment
    ON equipment.product_id = source.product_id
   AND (
     (
       source.product_variant_id IS NOT NULL
       AND variant.overrides_equipment = true
       AND equipment.product_variant_id = source.product_variant_id
     )
     OR (
       equipment.product_variant_id IS NULL
       AND (
         source.product_variant_id IS NULL
         OR COALESCE(variant.overrides_equipment, false) = false
       )
     )
   )
  WHERE equipment.is_optional = false
    AND equipment.replaced_by_rental_id IS NULL
), base_equipment AS (
  SELECT 'item'::text AS item_type, equipment_item_id AS item_id,
    SUM(source_quantity * COALESCE(equipment_quantity, 1))::bigint AS qty
  FROM selected_equipment
  WHERE equipment_item_id IS NOT NULL
  GROUP BY equipment_item_id

  UNION ALL

  SELECT 'kit'::text AS item_type, equipment_kit_id AS item_id,
    SUM(source_quantity * COALESCE(equipment_quantity, 1))::bigint AS qty
  FROM selected_equipment
  WHERE equipment_kit_id IS NOT NULL
  GROUP BY equipment_kit_id
), adjusted_equipment AS (
  SELECT item_type, item_id, qty FROM base_equipment
  UNION ALL
  SELECT 'item'::text, substitution.from_item_id, -substitution.qty::bigint
  FROM public.offer_equipment_substitutions substitution
  WHERE substitution.offer_id = p_offer_id
  UNION ALL
  SELECT 'item'::text, substitution.to_item_id, substitution.qty::bigint
  FROM public.offer_equipment_substitutions substitution
  WHERE substitution.offer_id = p_offer_id
)
SELECT adjusted_equipment.item_type, adjusted_equipment.item_id, SUM(adjusted_equipment.qty)::bigint
FROM adjusted_equipment
GROUP BY adjusted_equipment.item_type, adjusted_equipment.item_id
HAVING SUM(adjusted_equipment.qty) > 0;
$$;

DROP FUNCTION IF EXISTS public.get_event_required_mavinci_live_modules(uuid);
CREATE FUNCTION public.get_event_required_mavinci_live_modules(p_event_id uuid)
RETURNS TABLE (
  module_key text,
  name text,
  description text,
  display_order integer,
  product_names text[]
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (
    public.can_access_mavinci_event(p_event_id)
    OR public.can_manage_mavinci_event(p_event_id)
  ) THEN
    RAISE EXCEPTION 'Brak dostępu do wydarzenia';
  END IF;

  RETURN QUERY
  WITH selected_offer AS (
    SELECT candidate.id
    FROM public.offers candidate
    WHERE candidate.event_id = p_event_id
      AND candidate.status::text NOT IN ('rejected', 'cancelled')
    ORDER BY CASE WHEN candidate.status::text = 'accepted' THEN 0 ELSE 1 END,
      candidate.created_at DESC
    LIMIT 1
  ), effective_links AS (
    SELECT item.product_id, link.module_key
    FROM selected_offer selected
    JOIN public.offer_items item ON item.offer_id = selected.id
    LEFT JOIN public.offer_product_variants variant ON variant.id = item.product_variant_id
    JOIN public.offer_product_mavinci_live_modules link
      ON link.product_id = item.product_id
     AND (
       (item.product_variant_id IS NOT NULL
        AND variant.overrides_mavinci_live = true
        AND link.product_variant_id = item.product_variant_id)
       OR
       (link.product_variant_id IS NULL
        AND (item.product_variant_id IS NULL OR COALESCE(variant.overrides_mavinci_live, false) = false))
     )
  )
  SELECT module.module_key, module.name, module.description, module.display_order,
    array_agg(DISTINCT product.name ORDER BY product.name) AS product_names
  FROM effective_links link
  JOIN public.offer_products product ON product.id = link.product_id
  JOIN public.mavinci_live_modules module ON module.module_key = link.module_key
  WHERE module.is_active = true
  GROUP BY module.module_key, module.name, module.description, module.display_order
  ORDER BY module.display_order, module.name;
END;
$$;

CREATE OR REPLACE FUNCTION public.refresh_event_mavinci_live_modules(p_event_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH selected_offer AS (
    SELECT candidate.id
    FROM public.offers candidate
    WHERE candidate.event_id = p_event_id
      AND candidate.status::text NOT IN ('rejected', 'cancelled')
    ORDER BY CASE WHEN candidate.status::text = 'accepted' THEN 0 ELSE 1 END,
      candidate.created_at DESC
    LIMIT 1
  ), effective_links AS (
    SELECT link.module_key
    FROM selected_offer selected
    JOIN public.offer_items item ON item.offer_id = selected.id
    LEFT JOIN public.offer_product_variants variant ON variant.id = item.product_variant_id
    JOIN public.offer_product_mavinci_live_modules link
      ON link.product_id = item.product_id
     AND (
       (item.product_variant_id IS NOT NULL
        AND variant.overrides_mavinci_live = true
        AND link.product_variant_id = item.product_variant_id)
       OR
       (link.product_variant_id IS NULL
        AND (item.product_variant_id IS NULL OR COALESCE(variant.overrides_mavinci_live, false) = false))
     )
    JOIN public.mavinci_live_modules module ON module.module_key = link.module_key
    WHERE module.is_active = true
  )
  UPDATE public.mavinci_event_projects project
  SET enabled_modules = COALESCE((
    SELECT array_agg(DISTINCT link.module_key ORDER BY link.module_key)
    FROM effective_links link
  ), '{}'::text[])
  WHERE project.event_id = p_event_id
$$;

DROP TRIGGER IF EXISTS trg_refresh_mavinci_modules_offer_item ON public.offer_items;
CREATE TRIGGER trg_refresh_mavinci_modules_offer_item
AFTER INSERT OR UPDATE OF offer_id, product_id, product_variant_id OR DELETE ON public.offer_items
FOR EACH ROW EXECUTE FUNCTION public.refresh_mavinci_modules_after_offer_item_change();

DROP TRIGGER IF EXISTS trg_refresh_mavinci_modules_product_link ON public.offer_product_mavinci_live_modules;
CREATE TRIGGER trg_refresh_mavinci_modules_product_link
AFTER INSERT OR UPDATE OF product_id, product_variant_id, module_key OR DELETE
ON public.offer_product_mavinci_live_modules
FOR EACH ROW EXECUTE FUNCTION public.refresh_mavinci_modules_after_product_link_change();

DROP TRIGGER IF EXISTS trg_refresh_mavinci_modules_variant_config ON public.offer_product_variants;
CREATE TRIGGER trg_refresh_mavinci_modules_variant_config
AFTER UPDATE OF overrides_mavinci_live ON public.offer_product_variants
FOR EACH ROW EXECUTE FUNCTION public.refresh_mavinci_modules_after_product_link_change();

COMMENT ON COLUMN public.offer_product_variants.overrides_equipment IS
  'True means the variant owns its equipment scope; false means it inherits the base product scope.';
COMMENT ON COLUMN public.offer_product_variants.overrides_staff IS
  'True means the variant owns its staff requirements; false means it inherits the base product requirements.';
COMMENT ON COLUMN public.offer_product_variants.overrides_mavinci_live IS
  'True means the variant owns its Mavinci LIVE module list; false means it inherits the base product modules.';
COMMENT ON COLUMN public.offer_product_variants.overrides_contract_clauses IS
  'True means the variant owns its contract clauses; false means it inherits the base product clauses.';

GRANT EXECUTE ON FUNCTION public.get_offer_selected_equipment(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_event_required_mavinci_live_modules(uuid) TO authenticated;
