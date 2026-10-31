BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='60s';

-- No existing quotes, documents, rates or acceptances are rewritten.
-- LED package prices use the existing per-seller component price table.
CREATE OR REPLACE FUNCTION public.apply_offer_configuration()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE addons jsonb; channel text; extras numeric; v_offer record; v_quote public.seller_configuration_quotes; v_item jsonb; v_layout text; v_profile text;
BEGIN
 IF TG_OP='UPDATE' THEN
  IF (to_jsonb(NEW)-ARRAY['display_order','offer_page_variant_override','show_variant_prices_in_pdf','show_product_variants_in_pdf','updated_at'])
     IS NOT DISTINCT FROM
     (to_jsonb(OLD)-ARRAY['display_order','offer_page_variant_override','show_variant_prices_in_pdf','show_product_variants_in_pdf','updated_at']) THEN
   RETURN NEW;
  END IF;
 END IF;

 SELECT sales_channel INTO channel FROM public.offers WHERE id=NEW.offer_id;
 -- Seller prices are governed by an individual price list. Do not bypass that contract.
 IF channel='seller_portal' THEN
  SELECT sales_partner_id,my_company_id,commercial_model INTO v_offer FROM public.offers WHERE id=NEW.offer_id;
  IF TG_OP='INSERT' AND nullif(current_setting('app.seller_configuration_items',true),'') IS NOT NULL THEN
    SELECT value INTO v_item FROM jsonb_array_elements(current_setting('app.seller_configuration_items')::jsonb)
      WHERE (value->>'display_order')::integer=NEW.display_order;
    NEW.seller_configuration_quote_id:=nullif(v_item->>'configuration_quote_id','')::uuid;
    NEW.days:=coalesce(nullif(v_item->>'days','')::integer,1);
  END IF;
  IF NEW.seller_configuration_quote_id IS NOT NULL THEN
    IF TG_OP='UPDATE' AND NEW.seller_configuration_quote_id IS NOT DISTINCT FROM OLD.seller_configuration_quote_id
      AND NEW.pricing_configuration IS DISTINCT FROM OLD.pricing_configuration THEN
      RAISE EXCEPTION 'Zmień konfigurację w portalu sprzedawcy i zapisz nową wycenę. Zapisana konfiguracja nie może być nadpisana bez ponownej wyceny.';
    END IF;
    SELECT * INTO v_quote FROM public.seller_configuration_quotes WHERE id=NEW.seller_configuration_quote_id FOR UPDATE;
    IF NOT FOUND OR v_quote.sales_partner_id IS DISTINCT FROM v_offer.sales_partner_id
      OR v_quote.my_company_id IS DISTINCT FROM v_offer.my_company_id OR v_quote.product_id IS DISTINCT FROM NEW.product_id
      OR NEW.is_partner_custom OR NEW.product_variant_id IS NOT NULL
      OR (v_quote.offer_id IS NOT NULL AND v_quote.offer_id<>NEW.offer_id)
      OR (v_quote.offer_id IS NULL AND v_quote.expires_at<now()) THEN
      RAISE EXCEPTION 'Wycena konfiguracji jest niedostępna lub wygasła. Otwórz ponownie konfigurator produktu.';
    END IF;
    UPDATE public.seller_configuration_quotes SET offer_id=NEW.offer_id WHERE id=v_quote.id AND offer_id IS NULL;
    NEW.pricing_configuration:=v_quote.configuration;
    NEW.base_partner_unit_price:=v_quote.price_net;
    NEW.unit_cost:=v_quote.price_net;
    IF v_offer.commercial_model='commission' THEN NEW.client_unit_price:=v_quote.price_net; END IF;
    IF NEW.client_unit_price IS NULL OR NEW.client_unit_price<0 OR NEW.client_unit_price>999999999
       OR NEW.client_unit_price::text IN('NaN','Infinity','-Infinity') THEN RAISE EXCEPTION 'Nieprawidłowa cena klienta.'; END IF;
    NEW.unit_price:=NEW.client_unit_price;
    NEW.partner_margin_amount:=round((NEW.client_unit_price-v_quote.price_net)*NEW.quantity*NEW.days,2);
    NEW.requires_internal_approval:=NEW.client_unit_price<v_quote.price_net;
    NEW.name:=v_quote.name;
    NEW.description:=v_quote.description;
    NEW.unit:='zestaw';
    NEW.offer_page_variant_override:='default';
    NEW.show_product_variants_in_pdf:=false;
    NEW.show_variant_prices_in_pdf:=false;
    NEW.partner_source_snapshot:=coalesce(NEW.partner_source_snapshot,'{}')||jsonb_build_object(
      'seller_price_net',v_quote.price_net,'seller_price_source','configuration_snapshot',
      'configuration_quote_id',v_quote.id);
  ELSE
    IF NEW.pricing_configuration IS NOT NULL THEN RAISE EXCEPTION 'Zapisz konfigurację przez kalkulator sprzedawcy.'; END IF;
    IF TG_OP='INSERT' AND EXISTS(SELECT 1 FROM public.offer_products WHERE id=NEW.product_id
      AND (configuration_schema IS NOT NULL OR coalesce(jsonb_array_length(pricing_addons),0)>0)) THEN
      RAISE EXCEPTION 'Ta usługa wymaga konfiguracji produktu i indywidualnej wyceny.';
    END IF;
    NEW.pricing_configuration:=NULL;
  END IF;
  -- Only presentation is accepted from the browser. The price/configuration
  -- above still comes exclusively from the authenticated saved quote.
  IF TG_OP='INSERT' AND v_item ? 'page_layout' THEN
    v_layout:=v_item->>'page_layout';
    v_profile:=NEW.pricing_configuration#>>'{modular,profile}';
    IF v_layout IS NULL OR v_layout NOT IN ('compact','default','visual') THEN
      RAISE EXCEPTION 'Wybierz poprawny układ pozycji w PDF.';
    END IF;
    IF v_layout<>'default' AND NOT coalesce((
      (v_profile IS NULL AND coalesce(jsonb_array_length(NEW.pricing_configuration->'addons'),0)=0)
      OR (v_layout='compact' AND (v_profile IN ('stage','warehouse_stage')
        OR (v_profile='led' AND NEW.pricing_configuration#>'{modular,selection,led_sections}' IS NOT NULL)))
    ),false) THEN RAISE EXCEPTION 'Ten układ nie obsługuje pełnego zakresu konfiguracji. Wybierz osobną stronę.'; END IF;
    NEW.offer_page_variant_override:=v_layout;
    NEW.partner_source_snapshot:=coalesce(NEW.partner_source_snapshot,'{}'::jsonb)||jsonb_build_object('seller_presentation',1);
  END IF;
  RETURN NEW;
 END IF;
 IF TG_OP='INSERT' AND NEW.pricing_configuration IS NULL AND NEW.product_id IS NOT NULL THEN
  SELECT pricing_addons INTO addons FROM public.offer_products WHERE id=NEW.product_id;
  IF coalesce(jsonb_array_length(addons),0)>0 THEN
   NEW.pricing_configuration:=jsonb_build_object('version',1,'base_unit_price',NEW.unit_price,'addons',addons);
  END IF;
 END IF;
 IF TG_OP='INSERT' AND NOT coalesce(NEW.pricing_configuration ? 'modular',false) AND EXISTS(SELECT 1 FROM public.offer_products WHERE id=NEW.product_id AND configuration_schema IS NOT NULL) THEN
  RAISE EXCEPTION 'Ten produkt wymaga konfiguracji wymiarów lub składników w ofercie.';
 END IF;
 IF NEW.pricing_configuration ? 'modular' THEN
  NEW.unit_price:=public.offer_configuration_total(NEW.pricing_configuration);
  NEW.pricing_configuration:=jsonb_set(NEW.pricing_configuration,'{base_unit_price}',to_jsonb(NEW.unit_price));
  NEW.offer_page_variant_override:='default'; NEW.show_product_variants_in_pdf:=false; NEW.show_variant_prices_in_pdf:=false; NEW.product_variant_id:=NULL; NEW.unit:='zestaw';
 END IF;
 IF NEW.pricing_configuration IS NOT NULL THEN
  IF NOT (NEW.pricing_configuration ? 'modular') AND TG_OP='UPDATE' AND NEW.pricing_configuration IS NOT DISTINCT FROM OLD.pricing_configuration AND NEW.unit_price IS DISTINCT FROM OLD.unit_price THEN
   extras:=public.offer_configuration_total(NEW.pricing_configuration)-(NEW.pricing_configuration->>'base_unit_price')::numeric;
   NEW.pricing_configuration:=jsonb_set(NEW.pricing_configuration,'{base_unit_price}',to_jsonb(NEW.unit_price-extras));
  END IF;
  NEW.unit_price:=public.offer_configuration_total(NEW.pricing_configuration);
  IF jsonb_array_length(NEW.pricing_configuration->'addons')>0 THEN NEW.offer_page_variant_override:='default'; END IF;
 END IF;
 IF TG_OP='INSERT' OR NEW.unit_price IS DISTINCT FROM OLD.unit_price OR NEW.quantity IS DISTINCT FROM OLD.quantity OR NEW.discount_percent IS DISTINCT FROM OLD.discount_percent THEN
  IF NEW.quantity<=0 OR coalesce(NEW.discount_percent,0)<0 OR coalesce(NEW.discount_percent,0)>100 THEN RAISE EXCEPTION 'Nieprawidłowa ilość lub rabat pozycji.'; END IF;
  NEW.discount_amount:=round(NEW.unit_price*NEW.quantity*coalesce(NEW.discount_percent,0)/100,2);
 END IF;
 RETURN NEW;
END $function$;

-- Old fingerprints remain unchanged until the seller explicitly saves the
-- new presentation settings. Order is already part of the ordered item hash.
CREATE OR REPLACE FUNCTION public.seller_offer_source_key(p_offer_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT md5((jsonb_build_object(
    'title',o.title,'description',o.description,'event_date',o.event_date,
    'event_location',o.event_location,'valid_until',o.valid_until,
    'client_name',o.portal_client_name,'client_company',o.portal_client_company,
    'client_email',o.portal_client_email,'client_phone',o.portal_client_phone,
    'approval',o.partner_approval_status,'company',o.my_company_id,'branding',o.partner_branding_snapshot,'tax',o.tax_percent,
    'items',(SELECT jsonb_agg(jsonb_build_object('id',i.id,'name',i.name,'description',i.description,
      'unit',i.unit,'quantity',i.quantity,'price',i.client_unit_price,'image',i.partner_source_snapshot->'image_path') || CASE WHEN i.pricing_configuration IS NOT NULL OR i.days<>1 THEN jsonb_build_object('configuration',i.pricing_configuration,'days',i.days) ELSE '{}'::jsonb END
      || CASE WHEN i.partner_source_snapshot ? 'seller_presentation' THEN
        jsonb_build_object('page_layout',coalesce(i.offer_page_variant_override,'default')) ELSE '{}'::jsonb END
      ORDER BY i.display_order,i.id) FROM public.offer_items i WHERE i.offer_id=o.id)
  ) || CASE WHEN COALESCE(jsonb_array_length(o.recommended_items),0)>0
    THEN jsonb_build_object('recommendations',o.recommended_items) ELSE '{}'::jsonb END)::text) FROM public.offers o WHERE o.id=p_offer_id AND o.sales_channel='seller_portal';
$$;
REVOKE ALL ON FUNCTION public.seller_offer_source_key(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.seller_offer_source_key(uuid) TO service_role;

-- A versioned entry point prevents an older database silently dropping layout.
CREATE OR REPLACE FUNCTION public.save_seller_portal_offer_v5(p_request_id uuid,p_offer jsonb,p_items jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $save$
BEGIN
  RETURN public.save_seller_portal_offer_v4(p_request_id,p_offer,p_items);
END; $save$;
REVOKE ALL ON FUNCTION public.save_seller_portal_offer_v5(uuid,jsonb,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_seller_portal_offer_v5(uuid,jsonb,jsonb) TO authenticated;

NOTIFY pgrst,'reload schema';
COMMIT;
