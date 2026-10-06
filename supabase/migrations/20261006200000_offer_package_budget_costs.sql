BEGIN;
-- A package owns its costs. Do not add the legacy unit_cost to the same scope.
CREATE OR REPLACE FUNCTION public.offer_item_planned_cost_net(
 p_unit_cost numeric, p_quantity numeric, p_configuration jsonb, p_staff_snapshot jsonb
) RETURNS numeric LANGUAGE plpgsql IMMUTABLE SET search_path=public,pg_temp AS $body$
DECLARE selection jsonb; chosen jsonb; rows jsonb; row_cost jsonb; cost numeric:=0;
BEGIN
 selection:=nullif(p_configuration->'product_package','null'::jsonb);
 IF selection IS NOT NULL THEN
  SELECT value INTO chosen FROM jsonb_array_elements(coalesce(selection->'options','[]'::jsonb))
   WHERE value->>'id'=selection->>'selected_id' LIMIT 1;
  rows:=public.package_staff_cost_items(chosen->'resources');
  IF jsonb_typeof(chosen->'cost_items')='array' OR jsonb_array_length(rows)>0 THEN
   rows:=coalesce(nullif(chosen->'cost_items','null'::jsonb),'[]'::jsonb)||rows;
   FOR row_cost IN SELECT value FROM jsonb_array_elements(rows) LOOP
    cost:=cost+public.package_cost_line_net(row_cost);
   END LOOP;
  ELSE cost:=coalesce(p_unit_cost,0);
  END IF;
 ELSE
  cost:=coalesce(p_unit_cost,0)+public.staff_cost_snapshot_total(p_staff_snapshot);
 END IF;
 RETURN round(cost*coalesce(p_quantity,0),2);
END;
$body$;
REVOKE ALL ON FUNCTION public.offer_item_planned_cost_net(numeric,numeric,jsonb,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.offer_item_planned_cost_net(numeric,numeric,jsonb,jsonb) TO authenticated,service_role;
CREATE OR REPLACE FUNCTION public.calculate_offer_totals(offer_uuid uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_subtotal numeric(12, 2) := 0;
  v_total_cost numeric(12, 2) := 0;
  v_saved_discount_amount numeric(12, 2) := 0;
  v_saved_discount_percent numeric(7, 4) := 0;
  v_discount_amount numeric(12, 2) := 0;
  v_discount_percent numeric(7, 4) := 0;
  v_tax_percent numeric(5, 2) := 23;
  v_tax_amount numeric(12, 2) := 0;
  v_total_amount numeric(12, 2) := 0;
BEGIN
  SELECT
    COALESCE(discount_amount, 0),
    COALESCE(discount_percent, 0),
    COALESCE(tax_percent, 23)
  INTO
    v_saved_discount_amount,
    v_saved_discount_percent,
    v_tax_percent
  FROM public.offers
  WHERE id = offer_uuid;

  SELECT
    COALESCE(SUM(COALESCE(total, 0)), 0),
    COALESCE(SUM(public.offer_item_planned_cost_net(unit_cost, quantity, pricing_configuration, staff_cost_snapshot)), 0)
  INTO v_subtotal, v_total_cost
  FROM public.offer_items
  WHERE offer_id = offer_uuid;

  v_total_cost := v_total_cost + coalesce((SELECT logistics_cost_net FROM public.offers WHERE id=offer_uuid),0);
  v_subtotal := v_subtotal + coalesce((SELECT CASE WHEN logistics_enabled THEN logistics_price_net ELSE 0 END FROM public.offers WHERE id=offer_uuid),0);
  IF v_saved_discount_amount > 0 THEN
    v_discount_amount := LEAST(v_subtotal, v_saved_discount_amount);
  ELSE
    v_discount_amount := LEAST(
      v_subtotal,
      ROUND(v_subtotal * v_saved_discount_percent / 100, 2)
    );
  END IF;

  v_discount_percent := CASE
    WHEN v_subtotal > 0 THEN v_discount_amount / v_subtotal * 100
    ELSE 0
  END;
  v_tax_amount := ROUND((v_subtotal - v_discount_amount) * v_tax_percent / 100, 2);
  v_total_amount := ROUND(v_subtotal - v_discount_amount + v_tax_amount, 2);

  UPDATE public.offers
  SET
    subtotal = v_subtotal,
    totals_include_logistics = true,
    discount_percent = v_discount_percent,
    discount_amount = v_discount_amount,
    tax_amount = v_tax_amount,
    total_amount = v_total_amount,
    total_cost = v_total_cost,
    margin_amount = v_subtotal - v_discount_amount - v_total_cost,
    margin_percent = CASE
      WHEN v_subtotal - v_discount_amount > 0
        THEN (v_subtotal - v_discount_amount - v_total_cost) / (v_subtotal - v_discount_amount) * 100
      ELSE 0
    END
  WHERE id = offer_uuid;
END;
$function$
;
-- Repair only the reported offer's internal costs; preserve its accepted prices,
-- discount, VAT, scope, status and the event's actual cost ledger.
WITH costs AS (
 SELECT o.id,coalesce(o.logistics_cost_net,0)+coalesce((
  SELECT sum(public.offer_item_planned_cost_net(i.unit_cost,i.quantity,i.pricing_configuration,i.staff_cost_snapshot))
  FROM public.offer_items i WHERE i.offer_id=o.id
 ),0) AS amount
 FROM public.offers o WHERE o.id='fc990ca8-5526-42bd-b041-b32c1cc74ff8'
)
UPDATE public.offers o SET total_cost=c.amount,
 margin_amount=o.subtotal-coalesce(o.discount_amount,0)-c.amount,
 margin_percent=CASE WHEN o.subtotal-coalesce(o.discount_amount,0)>0
 THEN (o.subtotal-coalesce(o.discount_amount,0)-c.amount)/(o.subtotal-coalesce(o.discount_amount,0))*100 ELSE 0 END
FROM costs c WHERE o.id=c.id;
NOTIFY pgrst,'reload schema';
COMMIT;
