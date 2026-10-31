BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='30s';
ALTER TABLE public.offers ADD COLUMN IF NOT EXISTS guest_count integer CHECK (guest_count BETWEEN 1 AND 100000);
ALTER TABLE public.offers ADD COLUMN IF NOT EXISTS guests_per_table integer NOT NULL DEFAULT 10 CHECK (guests_per_table BETWEEN 1 AND 100);
ALTER TABLE public.offers ADD COLUMN IF NOT EXISTS table_count integer CHECK (table_count BETWEEN 1 AND 100000);
ALTER TABLE public.offer_products ADD COLUMN IF NOT EXISTS quantity_source text NOT NULL DEFAULT 'manual' CHECK (quantity_source IN ('manual','guests','tables'));
ALTER TABLE public.offer_product_variants ADD COLUMN IF NOT EXISTS quantity_source text NOT NULL DEFAULT 'manual' CHECK (quantity_source IN ('manual','guests','tables'));

CREATE OR REPLACE FUNCTION public.offer_audience_package_price(p jsonb, guests integer, tables integer)
RETURNS numeric LANGUAGE plpgsql IMMUTABLE SET search_path=public,pg_temp AS $$
DECLARE f numeric; g numeric; t numeric; result numeric;
BEGIN
 IF guests IS NULL OR guests<1 OR guests>100000 OR tables IS NULL OR tables<1 OR tables>100000 THEN RAISE EXCEPTION 'Uzupełnij liczbę osób i stołów w szczegółach oferty.'; END IF;
 f:=(p->>'fixed_net')::numeric; g:=(p->>'per_guest_net')::numeric; t:=(p->>'per_table_net')::numeric;
 IF f IS NULL OR g IS NULL OR t IS NULL OR f<0 OR g<0 OR t<0 OR f>99999999 OR g>99999999 OR t>99999999 OR f<>round(f,2) OR g<>round(g,2) OR t<>round(t,2) THEN RAISE EXCEPTION 'Nieprawidłowe stawki kalkulatora pakietu.'; END IF;
 result:=round(f+g*guests+t*tables,2);
 IF result>999999999 THEN RAISE EXCEPTION 'Cena pakietu przekracza dopuszczalny zakres.'; END IF;
 RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.resolve_offer_audience_configuration(c jsonb, guests integer, capacity integer, table_override integer)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=public,pg_temp AS $$
DECLARE opts jsonb:='[]'; adds jsonb:='[]'; row jsonb; selected text; needed boolean; tables integer; price numeric;
BEGIN
 IF c IS NULL THEN RETURN NULL; END IF;
 selected:=c#>>'{product_package,selected_id}';
 needed:=coalesce(c->>'quantity_source','manual') IN ('guests','tables')
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(c#>'{product_package,options}','[]')) x WHERE x->>'id'=selected AND nullif(x->'audience_pricing','null') IS NOT NULL)
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(c->'addons','[]')) x WHERE x->>'quantity_source' IN ('guests','tables'));
 IF coalesce(c->>'quantity_source','manual') NOT IN ('manual','guests','tables') THEN RAISE EXCEPTION 'Nieprawidłowy sposób wyliczania ilości.'; END IF;
 IF NOT needed THEN c:=c-'audience_snapshot'; END IF;
 IF needed AND (guests IS NULL OR guests<1 OR guests>100000 OR capacity IS NULL OR capacity<1 OR capacity>100) THEN RAISE EXCEPTION 'Uzupełnij liczbę osób w szczegółach oferty.'; END IF;
 tables:=coalesce(table_override,ceil(guests::numeric/capacity)::integer);
 FOR row IN SELECT value FROM jsonb_array_elements(coalesce(c#>'{product_package,options}','[]')) LOOP
  IF nullif(row->'audience_pricing','null') IS NOT NULL AND guests IS NOT NULL THEN
   price:=public.offer_audience_package_price(row->'audience_pricing',guests,tables);
   row:=jsonb_set(row,'{price_net}',to_jsonb(price));
   IF row->>'id'=selected THEN c:=jsonb_set(c,'{base_unit_price}',to_jsonb(price)); END IF;
  END IF;
  opts:=opts||jsonb_build_array(row);
 END LOOP;
 IF c ? 'product_package' THEN c:=jsonb_set(c,'{product_package,options}',opts); END IF;
 FOR row IN SELECT value FROM jsonb_array_elements(coalesce(c->'addons','[]')) LOOP
  IF coalesce(row->>'quantity_source','manual') NOT IN ('manual','guests','tables') THEN RAISE EXCEPTION 'Nieprawidłowy przelicznik dodatku.'; END IF;
  IF row->>'quantity_source' IN ('guests','tables') THEN
   IF row->>'kind'='optional' THEN RAISE EXCEPTION 'Dodatek na osobę lub stół musi być rozliczany ilościowo.'; END IF;
   row:=jsonb_set(row,'{quantity}',to_jsonb(CASE row->>'quantity_source' WHEN 'guests' THEN guests ELSE tables END));
  END IF;
  adds:=adds||jsonb_build_array(row);
 END LOOP;
 c:=jsonb_set(c,'{addons}',adds);
 IF needed THEN c:=jsonb_set(c,'{audience_snapshot}',jsonb_build_object('guest_count',guests,'guests_per_table',capacity,'table_count',tables)); END IF;
 RETURN c;
END $$;

CREATE OR REPLACE FUNCTION public.apply_offer_audience_item()
RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE o public.offers; source text; c jsonb; selected jsonb; fresh boolean; extras numeric;
BEGIN
 SELECT * INTO STRICT o FROM public.offers WHERE id=NEW.offer_id FOR UPDATE;
 IF o.sales_channel='seller_portal' THEN RETURN NEW; END IF;
 c:=NEW.pricing_configuration;
 fresh:=TG_OP='INSERT';
 IF TG_OP='UPDATE' THEN fresh:=NEW.product_id IS DISTINCT FROM OLD.product_id OR NEW.product_variant_id IS DISTINCT FROM OLD.product_variant_id; END IF;
 IF coalesce(c#>>'{product_package,selected_id}','')<>'' THEN source:='manual';
 ELSIF c ? 'quantity_source' THEN source:=c->>'quantity_source';
 ELSIF fresh THEN
  IF NEW.product_variant_id IS NOT NULL THEN SELECT quantity_source INTO source FROM public.offer_product_variants WHERE id=NEW.product_variant_id AND product_id=NEW.product_id;
  ELSE SELECT quantity_source INTO source FROM public.offer_products WHERE id=NEW.product_id; END IF;
 ELSE source:=coalesce(OLD.pricing_configuration->>'quantity_source','manual'); END IF;
 source:=coalesce(source,'manual');
 IF source<>'manual' OR c IS NOT NULL THEN
  IF c IS NULL THEN c:=jsonb_build_object('version',1,'base_unit_price',NEW.unit_price,'addons','[]'::jsonb); END IF;
  c:=jsonb_set(c,'{quantity_source}',to_jsonb(source));
  c:=public.resolve_offer_audience_configuration(c,o.guest_count,o.guests_per_table,o.table_count);
  IF (c ? 'audience_snapshot') AND o.pricing_source='calculation' THEN RAISE EXCEPTION 'Przeliczniki osób wymagają źródła wyceny: Pozycje oferty. Zmień źródło zamiast nadpisywać zaakceptowaną kalkulację.'; END IF;
  IF TG_OP='UPDATE' AND NOT(c ? 'audience_snapshot') AND NEW.pricing_configuration IS NOT DISTINCT FROM OLD.pricing_configuration AND NEW.unit_price IS DISTINCT FROM OLD.unit_price THEN
   extras:=public.offer_configuration_total(c)-(c->>'base_unit_price')::numeric;
   c:=jsonb_set(c,'{base_unit_price}',to_jsonb(NEW.unit_price-extras));
  END IF;
  NEW.pricing_configuration:=c;
  IF source='guests' THEN NEW.quantity:=o.guest_count; NEW.unit:='osoba';
  ELSIF source='tables' THEN NEW.quantity:=coalesce(o.table_count,ceil(o.guest_count::numeric/o.guests_per_table)); NEW.unit:='stół'; END IF;
  NEW.unit_price:=public.offer_configuration_total(c);
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS zy_offer_audience_item ON public.offer_items;
CREATE TRIGGER zy_offer_audience_item BEFORE INSERT OR UPDATE ON public.offer_items FOR EACH ROW EXECUTE FUNCTION public.apply_offer_audience_item();

CREATE OR REPLACE FUNCTION public.prepare_offer_audience_change()
RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE r jsonb; c jsonb; result jsonb:='[]'; qty numeric; price numeric;
BEGIN
 IF TG_OP='UPDATE' AND (NEW.guest_count,NEW.guests_per_table,NEW.table_count) IS DISTINCT FROM (OLD.guest_count,OLD.guests_per_table,OLD.table_count) THEN
  IF NEW.status='accepted' AND current_setting('mavinci.updating_accepted_offer',true) IS DISTINCT FROM NEW.id::text THEN RAISE EXCEPTION 'Otwórz edycję zaakceptowanej oferty przed zmianą liczby gości.'; END IF;
  IF NEW.pricing_source='calculation' THEN RAISE EXCEPTION 'Liczbę osób zmień razem z kalkulacją źródłową albo wybierz źródło: Pozycje oferty.'; END IF;
  NEW.modified_after_generation:=true; NEW.content_revision:=OLD.content_revision+1;
 END IF;
 FOR r IN SELECT value FROM jsonb_array_elements(coalesce(NEW.recommended_items,'[]')) LOOP
  c:=public.resolve_offer_audience_configuration(r->'pricing_configuration',NEW.guest_count,NEW.guests_per_table,NEW.table_count);
  IF c IS NOT NULL THEN
   r:=jsonb_set(r,'{pricing_configuration}',c);
   qty:=CASE c->>'quantity_source' WHEN 'guests' THEN NEW.guest_count WHEN 'tables' THEN coalesce(NEW.table_count,ceil(NEW.guest_count::numeric/NEW.guests_per_table)) ELSE (r->>'quantity')::numeric END;
   IF c ? 'audience_snapshot' THEN
    price:=round(public.offer_configuration_total(c)*(1-coalesce((r->>'discount_percent')::numeric,0)/100),2);
    r:=r||jsonb_build_object('quantity',qty,'unit_price',price);
   END IF;
  END IF;
  result:=result||jsonb_build_array(r);
 END LOOP;
 NEW.recommended_items:=result;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS zz_offer_audience_header ON public.offers;
CREATE TRIGGER zz_offer_audience_header BEFORE INSERT OR UPDATE OF guest_count,guests_per_table,table_count,recommended_items ON public.offers FOR EACH ROW EXECUTE FUNCTION public.prepare_offer_audience_change();

CREATE OR REPLACE FUNCTION public.reprice_offer_audience_items()
RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF (NEW.guest_count,NEW.guests_per_table,NEW.table_count) IS NOT DISTINCT FROM (OLD.guest_count,OLD.guests_per_table,OLD.table_count) THEN RETURN NEW; END IF;
 UPDATE public.offer_items SET pricing_configuration=pricing_configuration WHERE offer_id=NEW.id
  AND (pricing_configuration->>'quantity_source' IN ('guests','tables') OR pricing_configuration ? 'audience_snapshot'
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(pricing_configuration#>'{product_package,options}','[]')) x WHERE nullif(x->'audience_pricing','null') IS NOT NULL)
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(pricing_configuration->'addons','[]')) x WHERE x->>'quantity_source' IN ('guests','tables')));
 -- Alternative offer packages inherit automatic quantities from their source items.
 UPDATE public.offer_package_items pi SET quantity=i.quantity
 FROM public.offer_items i, public.offer_packages p
 WHERE pi.offer_item_id=i.id AND pi.package_id=p.id AND p.offer_id=NEW.id
 AND i.pricing_configuration->>'quantity_source' IN ('guests','tables')
 AND pi.quantity IS DISTINCT FROM i.quantity;
 -- Preserve the existing absolute package discount, matching the package editor.
 WITH totals AS (
  SELECT p.id, round(sum(i.unit_price*coalesce(i.days,1)*pi.quantity),2) AS list,
   p.discount_amount
  FROM public.offer_packages p
  JOIN public.offer_package_items pi ON pi.package_id=p.id
  JOIN public.offer_items i ON i.id=pi.offer_item_id
  WHERE p.offer_id=NEW.id AND EXISTS (
   SELECT 1 FROM public.offer_package_items related
   JOIN public.offer_items src ON src.id=related.offer_item_id
   WHERE related.package_id=p.id AND src.pricing_configuration ? 'audience_snapshot'
  ) GROUP BY p.id,p.discount_amount
 ), priced AS (
  SELECT id,list,least(list,greatest(0,coalesce(discount_amount,0))) AS discount FROM totals
 )
 UPDATE public.offer_packages p SET list_price_net=t.list,discount_amount=t.discount,
  discount_percent=CASE WHEN t.list>0 THEN round(t.discount/t.list*100,2) ELSE 0 END,
  price_net=t.list-t.discount FROM priced t WHERE p.id=t.id;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS zzz_offer_audience_reprice ON public.offers;
CREATE TRIGGER zzz_offer_audience_reprice AFTER UPDATE OF guest_count,guests_per_table,table_count ON public.offers FOR EACH ROW EXECUTE FUNCTION public.reprice_offer_audience_items();
NOTIFY pgrst,'reload schema';
COMMIT;
