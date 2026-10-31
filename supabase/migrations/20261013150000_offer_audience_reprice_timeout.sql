BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='20s';

-- Avoid cross-joining RLS-protected items/packages. Even an empty offer previously
-- reached a multi-table UPDATE whose policy expansion timed out during planning.
CREATE OR REPLACE FUNCTION public.reprice_offer_audience_items()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE
 affected_ids uuid[];
 items_by_id jsonb;
 package_row record;
 part record;
 source_item jsonb;
 part_quantity numeric;
 list_price numeric;
 discount numeric;
 affected boolean;
BEGIN
 IF (NEW.guest_count,NEW.guests_per_table,NEW.table_count)
    IS NOT DISTINCT FROM (OLD.guest_count,OLD.guests_per_table,OLD.table_count) THEN RETURN NEW; END IF;

 -- Read only this offer first. An empty/manual-only offer has nothing to reprice.
 SELECT array_agg(i.id) INTO affected_ids FROM public.offer_items i
 WHERE i.offer_id=NEW.id AND (
  i.pricing_configuration->>'quantity_source' IN ('guests','tables')
  OR i.pricing_configuration ? 'audience_snapshot'
  OR EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(i.pricing_configuration#>'{product_package,options}','[]')) x
    WHERE nullif(x->'audience_pricing','null') IS NOT NULL)
  OR EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(i.pricing_configuration->'addons','[]')) x
    WHERE x->>'quantity_source' IN ('guests','tables'))
 );
 IF coalesce(cardinality(affected_ids),0)=0 THEN RETURN NEW; END IF;

 UPDATE public.offer_items SET pricing_configuration=pricing_configuration
 WHERE offer_id=NEW.id AND id=ANY(affected_ids);

 -- One protected table per statement keeps permission checks bounded. Permissions,
 -- accepted-offer guards and existing item total/discount triggers stay in force.
 SELECT jsonb_object_agg(i.id::text,jsonb_build_object(
  'quantity',i.quantity,'unit_price',i.unit_price,'days',coalesce(i.days,1),
  'quantity_source',i.pricing_configuration->>'quantity_source'
 )) INTO items_by_id FROM public.offer_items i WHERE i.offer_id=NEW.id;

 FOR package_row IN SELECT id,discount_amount FROM public.offer_packages WHERE offer_id=NEW.id LOOP
  list_price:=0; affected:=false;
  FOR part IN SELECT id,offer_item_id,quantity FROM public.offer_package_items WHERE package_id=package_row.id LOOP
   source_item:=items_by_id->part.offer_item_id::text;
   IF source_item IS NULL THEN
    RAISE EXCEPTION 'Pakiet zawiera pozycję spoza tej oferty lub pozycję niedostępną. Popraw jego skład przed przeliczeniem.';
   END IF;
   part_quantity:=part.quantity;
   IF source_item->>'quantity_source' IN ('guests','tables') THEN
    part_quantity:=(source_item->>'quantity')::numeric;
    IF part.quantity IS DISTINCT FROM part_quantity THEN
     UPDATE public.offer_package_items SET quantity=part_quantity WHERE id=part.id AND package_id=package_row.id;
    END IF;
   END IF;
   affected:=affected OR part.offer_item_id=ANY(affected_ids);
   list_price:=list_price+(source_item->>'unit_price')::numeric*(source_item->>'days')::numeric*part_quantity;
  END LOOP;
  IF affected THEN
   list_price:=round(list_price,2);
   -- Keep the absolute package discount, as in the existing package editor.
   discount:=least(list_price,greatest(0,coalesce(package_row.discount_amount,0)));
   UPDATE public.offer_packages SET list_price_net=list_price,discount_amount=discount,
    discount_percent=CASE WHEN list_price>0 THEN round(discount/list_price*100,2) ELSE 0 END,
    price_net=list_price-discount
   WHERE id=package_row.id AND offer_id=NEW.id
    AND (list_price_net,discount_amount,discount_percent,price_net) IS DISTINCT FROM
      (list_price,discount,CASE WHEN list_price>0 THEN round(discount/list_price*100,2) ELSE 0 END,list_price-discount);
  END IF;
 END LOOP;
 RETURN NEW;
END $$;
COMMIT;
