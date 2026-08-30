/*
  Variant equipment scopes, calculated package benefits and acceptance snapshot.

  A variant-specific equipment scope overrides the base product scope. When a
  variant has no own rows it inherits the base scope for backwards compatibility.
*/

ALTER TABLE public.offer_product_equipment
  ADD COLUMN IF NOT EXISTS product_variant_id uuid
    REFERENCES public.offer_product_variants(id) ON DELETE CASCADE;

ALTER TABLE public.offer_product_equipment
  DROP CONSTRAINT IF EXISTS offer_product_equipment_product_id_equipment_item_id_key;

CREATE INDEX IF NOT EXISTS idx_offer_product_equipment_variant
  ON public.offer_product_equipment(product_variant_id)
  WHERE product_variant_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_offer_product_equipment_base_item
  ON public.offer_product_equipment(product_id, equipment_item_id)
  WHERE product_variant_id IS NULL AND equipment_item_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_offer_product_equipment_variant_item
  ON public.offer_product_equipment(product_id, product_variant_id, equipment_item_id)
  WHERE product_variant_id IS NOT NULL AND equipment_item_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_offer_product_equipment_base_kit
  ON public.offer_product_equipment(product_id, equipment_kit_id)
  WHERE product_variant_id IS NULL AND equipment_kit_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_offer_product_equipment_variant_kit
  ON public.offer_product_equipment(product_id, product_variant_id, equipment_kit_id)
  WHERE product_variant_id IS NOT NULL AND equipment_kit_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.validate_offer_equipment_variant_product()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.product_variant_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.offer_product_variants variant
    WHERE variant.id = NEW.product_variant_id
      AND variant.product_id = NEW.product_id
  ) THEN
    RAISE EXCEPTION 'Wariant sprzętu nie należy do wskazanego produktu';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_offer_equipment_variant_product
  ON public.offer_product_equipment;
CREATE TRIGGER trg_validate_offer_equipment_variant_product
  BEFORE INSERT OR UPDATE OF product_id, product_variant_id
  ON public.offer_product_equipment
  FOR EACH ROW EXECUTE FUNCTION public.validate_offer_equipment_variant_product();

ALTER TABLE public.offer_packages
  ADD COLUMN IF NOT EXISTS list_price_net numeric(10, 2) NOT NULL DEFAULT 0 CHECK (list_price_net >= 0),
  ADD COLUMN IF NOT EXISTS discount_percent numeric(5, 2) NOT NULL DEFAULT 0 CHECK (discount_percent BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS discount_amount numeric(10, 2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0);

UPDATE public.offer_packages
SET list_price_net = price_net
WHERE list_price_net = 0 AND price_net > 0;

ALTER TABLE public.offer_package_items
  ADD COLUMN IF NOT EXISTS offer_item_id uuid REFERENCES public.offer_items(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_offer_package_items_offer_item
  ON public.offer_package_items(offer_item_id)
  WHERE offer_item_id IS NOT NULL;

ALTER TABLE public.offers
  ADD COLUMN IF NOT EXISTS accepted_package_id uuid REFERENCES public.offer_packages(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS accepted_variant_selections jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.offer_product_equipment.product_variant_id IS
  'Opcjonalny wariant produktu. Zakres wariantu zastępuje bazowy; pusty zakres wariantu dziedziczy bazowy.';
COMMENT ON COLUMN public.offer_packages.list_price_net IS
  'Automatyczna suma cen netto produktów i wariantów przed korzyścią pakietową.';
COMMENT ON COLUMN public.offer_packages.discount_amount IS
  'Kwotowa korzyść klienta, odejmowana od sumy produktów.';
COMMENT ON COLUMN public.offers.accepted_variant_selections IS
  'Migawka pakietu i wariantów wybranych podczas akceptacji oferty.';

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
    oi.product_id,
    oi.product_variant_id,
    oi.quantity::numeric AS quantity
  FROM public.offer_items oi
  WHERE oi.offer_id = p_offer_id
    AND p_package_id IS NULL

  UNION ALL

  SELECT
    opi.product_id,
    opi.product_variant_id,
    opi.quantity
  FROM public.offer_package_items opi
  JOIN public.offer_packages op ON op.id = opi.package_id
  WHERE op.offer_id = p_offer_id
    AND op.id = p_package_id
), selected_equipment AS (
  SELECT
    source.quantity AS source_quantity,
    equipment.quantity AS equipment_quantity,
    equipment.equipment_item_id,
    equipment.equipment_kit_id
  FROM source_lines source
  JOIN public.offer_product_equipment equipment
    ON equipment.product_id = source.product_id
   AND (
     (
       source.product_variant_id IS NOT NULL
       AND equipment.product_variant_id = source.product_variant_id
     )
     OR (
       equipment.product_variant_id IS NULL
       AND (
         source.product_variant_id IS NULL
         OR NOT EXISTS (
           SELECT 1
           FROM public.offer_product_equipment variant_equipment
           WHERE variant_equipment.product_id = source.product_id
             AND variant_equipment.product_variant_id = source.product_variant_id
             AND variant_equipment.is_optional = false
             AND (variant_equipment.equipment_item_id IS NOT NULL OR variant_equipment.equipment_kit_id IS NOT NULL)
         )
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

DROP FUNCTION IF EXISTS public.get_offer_equipment_for_reservation(uuid, uuid);
CREATE FUNCTION public.get_offer_equipment_for_reservation(
  p_offer_id uuid,
  p_package_id uuid DEFAULT NULL
)
RETURNS jsonb
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_event_id uuid;
  v_start_date timestamptz;
  v_end_date timestamptz;
  v_result jsonb := '[]'::jsonb;
  v_scope record;
  v_total_qty integer;
  v_reserved_qty integer;
  v_available_qty integer;
  v_item_name text;
BEGIN
  SELECT evt.id, evt.event_date, COALESCE(evt.event_end_date, evt.event_date + interval '1 day')
  INTO v_event_id, v_start_date, v_end_date
  FROM public.offers offer_row
  JOIN public.events evt ON evt.id = offer_row.event_id
  WHERE offer_row.id = p_offer_id;

  IF v_event_id IS NULL THEN RETURN '[]'::jsonb; END IF;

  FOR v_scope IN
    SELECT * FROM public.get_offer_selected_equipment(p_offer_id, p_package_id)
  LOOP
    IF v_scope.item_type = 'item' THEN
      SELECT item.name,
        (SELECT count(*) FROM public.equipment_units unit
          WHERE unit.equipment_id = item.id AND unit.status IN ('available', 'reserved', 'in_use')),
        COALESCE((SELECT sum(reservation.qty)
          FROM public.event_equipment reservation
          JOIN public.events reserved_event ON reserved_event.id = reservation.event_id
          WHERE reservation.equipment_item_id = item.id
            AND reservation.event_id <> v_event_id
            AND reserved_event.event_date < v_end_date
            AND COALESCE(reserved_event.event_end_date, reserved_event.event_date + interval '1 day') > v_start_date
            AND reservation.reservation_status IN ('reserved_pending', 'reserved_confirmed', 'in_use')), 0)
      INTO v_item_name, v_total_qty, v_reserved_qty
      FROM public.equipment_items item
      WHERE item.id = v_scope.item_id;
    ELSE
      SELECT kit.name,
        COALESCE((
          SELECT min(floor(component.stock_qty::numeric / component.required_qty))::integer
          FROM (
            SELECT kit_item.quantity AS required_qty,
              (SELECT count(*) FROM public.equipment_units unit
               WHERE unit.equipment_id = kit_item.equipment_id
                 AND unit.status IN ('available', 'reserved', 'in_use')) AS stock_qty
            FROM public.equipment_kit_items kit_item
            WHERE kit_item.kit_id = kit.id AND kit_item.equipment_id IS NOT NULL
          ) component
        ), 0),
        COALESCE((SELECT sum(reservation.qty)
          FROM public.event_equipment reservation
          JOIN public.events reserved_event ON reserved_event.id = reservation.event_id
          WHERE reservation.equipment_kit_id = kit.id
            AND reservation.event_id <> v_event_id
            AND reserved_event.event_date < v_end_date
            AND COALESCE(reserved_event.event_end_date, reserved_event.event_date + interval '1 day') > v_start_date
            AND reservation.reservation_status IN ('reserved_pending', 'reserved_confirmed', 'in_use')), 0)
      INTO v_item_name, v_total_qty, v_reserved_qty
      FROM public.equipment_kits kit
      WHERE kit.id = v_scope.item_id;
    END IF;

    v_available_qty := greatest(0, COALESCE(v_total_qty, 0) - COALESCE(v_reserved_qty, 0));
    v_result := v_result || jsonb_build_array(jsonb_build_object(
      'item_type', v_scope.item_type,
      'item_id', v_scope.item_id,
      'item_name', COALESCE(v_item_name, 'Sprzęt'),
      'required_qty', v_scope.qty,
      'total_qty', COALESCE(v_total_qty, 0),
      'reserved_qty', COALESCE(v_reserved_qty, 0),
      'available_qty', v_available_qty,
      'has_conflict', v_available_qty < v_scope.qty,
      'shortage_qty', greatest(0, v_scope.qty - v_available_qty)
    ));
  END LOOP;

  RETURN v_result;
END;
$$;

DROP FUNCTION IF EXISTS public.reserve_selected_equipment(uuid, jsonb, jsonb, uuid);
CREATE FUNCTION public.reserve_selected_equipment(
  p_offer_id uuid,
  p_items jsonb,
  p_accepted_shortages jsonb,
  p_package_id uuid DEFAULT NULL
)
RETURNS jsonb
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_event_id uuid;
  v_item jsonb;
  v_shortage jsonb;
  v_inserted_count integer := 0;
  v_shortage_count integer := 0;
  v_rejected_count integer := 0;
  v_snapshot jsonb;
BEGIN
  SELECT event_id INTO v_event_id FROM public.offers WHERE id = p_offer_id;
  IF v_event_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Nie znaleziono oferty');
  END IF;

  IF p_package_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.offer_packages WHERE id = p_package_id AND offer_id = p_offer_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Wybrany pakiet nie należy do oferty');
  END IF;

  IF p_package_id IS NOT NULL THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'package_id', package.id,
      'package_name', package.name,
      'product_id', item.product_id,
      'product_variant_id', item.product_variant_id,
      'variant_name', variant.name,
      'quantity', item.quantity
    ) ORDER BY item.display_order), '[]'::jsonb)
    INTO v_snapshot
    FROM public.offer_packages package
    JOIN public.offer_package_items item ON item.package_id = package.id
    LEFT JOIN public.offer_product_variants variant ON variant.id = item.product_variant_id
    WHERE package.id = p_package_id;
  ELSE
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'offer_item_id', item.id,
      'product_id', item.product_id,
      'product_variant_id', item.product_variant_id,
      'variant_name', variant.name,
      'quantity', item.quantity
    ) ORDER BY item.display_order), '[]'::jsonb)
    INTO v_snapshot
    FROM public.offer_items item
    LEFT JOIN public.offer_product_variants variant ON variant.id = item.product_variant_id
    WHERE item.offer_id = p_offer_id;
  END IF;

  DELETE FROM public.event_equipment WHERE event_id = v_event_id AND offer_id = p_offer_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    IF v_item->>'item_type' = 'item' THEN
      INSERT INTO public.event_equipment(event_id, offer_id, equipment_item_id, qty, reservation_status, auto_added)
      VALUES (v_event_id, p_offer_id, (v_item->>'item_id')::uuid, (v_item->>'qty')::integer, 'reserved_pending', true);
    ELSE
      INSERT INTO public.event_equipment(event_id, offer_id, equipment_kit_id, qty, reservation_status, auto_added)
      VALUES (v_event_id, p_offer_id, (v_item->>'item_id')::uuid, (v_item->>'qty')::integer, 'reserved_pending', true);
    END IF;
    v_inserted_count := v_inserted_count + 1;
  END LOOP;

  FOR v_shortage IN SELECT * FROM jsonb_array_elements(p_accepted_shortages)
  LOOP
    IF v_shortage->>'item_type' = 'item' THEN
      INSERT INTO public.event_equipment(event_id, offer_id, equipment_item_id, qty, reservation_status, is_optional, auto_added)
      VALUES (v_event_id, p_offer_id, (v_shortage->>'item_id')::uuid, (v_shortage->>'shortage_qty')::integer, 'planned', true, true);
    ELSE
      INSERT INTO public.event_equipment(event_id, offer_id, equipment_kit_id, qty, reservation_status, is_optional, auto_added)
      VALUES (v_event_id, p_offer_id, (v_shortage->>'item_id')::uuid, (v_shortage->>'shortage_qty')::integer, 'planned', true, true);
    END IF;
    v_shortage_count := v_shortage_count + 1;
  END LOOP;

  UPDATE public.offers
  SET status = 'accepted',
      accepted_at = now(),
      accepted_package_id = p_package_id,
      accepted_variant_selections = v_snapshot
  WHERE id = p_offer_id;

  UPDATE public.offers
  SET status = 'rejected'
  WHERE event_id = v_event_id AND id <> p_offer_id AND status <> 'rejected';
  GET DIAGNOSTICS v_rejected_count = ROW_COUNT;

  DELETE FROM public.event_equipment
  WHERE event_id = v_event_id
    AND offer_id IN (SELECT id FROM public.offers WHERE event_id = v_event_id AND status = 'rejected');

  UPDATE public.events SET equipment_shortage = (v_shortage_count > 0) WHERE id = v_event_id;

  RETURN jsonb_build_object(
    'success', true,
    'reserved_count', v_inserted_count,
    'shortage_count', v_shortage_count,
    'rejected_offers_count', v_rejected_count,
    'accepted_package_id', p_package_id,
    'variant_selections', v_snapshot
  );
END;
$$;

-- Akceptacja z UI przechodzi przez reserve_selected_equipment, ponieważ tylko
-- tam znamy wybrany pakiet. Trigger nie może ponownie nadpisać tej rezerwacji.
CREATE OR REPLACE FUNCTION public.handle_offer_status_change()
RETURNS trigger
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.unreserve_equipment_from_offer(OLD.id);
    RETURN OLD;
  END IF;

  IF OLD.status::text = 'accepted' AND NEW.status::text <> 'accepted' THEN
    PERFORM public.unreserve_equipment_from_offer(NEW.id);
  END IF;

  RETURN NEW;
END;
$$;

NOTIFY pgrst, 'reload schema';
