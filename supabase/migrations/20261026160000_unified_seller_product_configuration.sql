BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='60s';

-- Individual prices never inherit internal rental rates. NULL means quotation
-- required; zero is an explicit included component. No existing offers are rewritten.
CREATE TABLE public.sales_partner_component_prices (
 sales_partner_id uuid NOT NULL REFERENCES public.sales_partner_profiles(id) ON DELETE CASCADE,
 my_company_id uuid NOT NULL REFERENCES public.my_companies(id) ON DELETE CASCADE,
 product_id uuid NOT NULL REFERENCES public.offer_products(id) ON DELETE CASCADE,
 component_key text NOT NULL CHECK(length(component_key) BETWEEN 1 AND 160),
 price_net numeric(12,2) CHECK(price_net>=0 AND price_net<=9999999),
 PRIMARY KEY(sales_partner_id,my_company_id,product_id,component_key)
);
ALTER TABLE public.sales_partner_component_prices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sales_partner_component_prices FROM anon,authenticated;
GRANT ALL ON public.sales_partner_component_prices TO service_role;

CREATE TABLE public.seller_configuration_quotes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 sales_partner_id uuid NOT NULL REFERENCES public.sales_partner_profiles(id),
 my_company_id uuid NOT NULL REFERENCES public.my_companies(id),
 product_id uuid NOT NULL REFERENCES public.offer_products(id),
 offer_id uuid REFERENCES public.offers(id) ON DELETE SET NULL,
 configuration jsonb NOT NULL,
 price_net numeric(12,2) NOT NULL CHECK(price_net>=0 AND price_net<=999999999),
 name text NOT NULL,
 description text NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL DEFAULT now()+interval '24 hours',
 CHECK(price_net=public.offer_configuration_total(configuration))
);
ALTER TABLE public.seller_configuration_quotes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.seller_configuration_quotes FROM anon,authenticated;
GRANT ALL ON public.seller_configuration_quotes TO service_role;
CREATE INDEX seller_configuration_quotes_offer ON public.seller_configuration_quotes(offer_id);
ALTER TABLE public.offer_items ADD COLUMN seller_configuration_quote_id uuid REFERENCES public.seller_configuration_quotes(id);

-- The existing portal authorization and catalog grants remain authoritative.
CREATE OR REPLACE FUNCTION public.get_seller_portal_catalog_v2(p_company_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT coalesce(jsonb_agg(entry || jsonb_build_object(
   'configurable',p.configuration_schema IS NOT NULL OR coalesce(jsonb_array_length(p.pricing_addons),0)>0,
   'variants',CASE WHEN p.configuration_schema IS NOT NULL OR coalesce(jsonb_array_length(p.pricing_addons),0)>0 THEN '[]'::jsonb ELSE entry->'variants' END
 ) ORDER BY ord),'[]'::jsonb)
 FROM jsonb_array_elements(public.get_seller_portal_catalog(p_company_id)) WITH ORDINALITY AS c(entry,ord)
 JOIN public.offer_products p ON p.id=(entry->>'id')::uuid
 WHERE (p.configuration_schema IS NULL AND coalesce(jsonb_array_length(p.pricing_addons),0)=0) OR nullif(entry->>'base_price','') IS NOT NULL;
$$;
REVOKE ALL ON FUNCTION public.get_seller_portal_catalog_v2(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_seller_portal_catalog_v2(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.apply_offer_configuration()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE addons jsonb; channel text; extras numeric; v_offer record; v_quote public.seller_configuration_quotes; v_item jsonb;
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


CREATE OR REPLACE FUNCTION public.recalculate_individual_seller_offer_totals()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_offer_id uuid := COALESCE(NEW.offer_id, OLD.offer_id);
  v_offer record;
  v_base numeric := 0;
  v_client numeric := 0;
  v_requires_approval boolean := false;
  v_earnings numeric := 0;
BEGIN
 IF TG_OP='UPDATE' THEN
  IF (to_jsonb(NEW)-ARRAY['display_order','offer_page_variant_override','show_variant_prices_in_pdf','show_product_variants_in_pdf','updated_at'])
     IS NOT DISTINCT FROM
     (to_jsonb(OLD)-ARRAY['display_order','offer_page_variant_override','show_variant_prices_in_pdf','show_product_variants_in_pdf','updated_at']) THEN
   RETURN NEW;
  END IF;
 END IF;

  SELECT sales_channel, commercial_model, partner_commission_rate
  INTO v_offer
  FROM public.offers
  WHERE id = v_offer_id;

  IF v_offer.sales_channel <> 'seller_portal' THEN RETURN NULL; END IF;

  SELECT
    COALESCE(sum(item.base_partner_unit_price * item.quantity * item.days), 0),
    COALESCE(sum(item.client_unit_price * item.quantity * item.days), 0),
    COALESCE(bool_or(item.requires_internal_approval), false)
  INTO v_base, v_client, v_requires_approval
  FROM public.offer_items item
  WHERE item.offer_id = v_offer_id;

  v_earnings := CASE
    WHEN v_offer.commercial_model = 'commission'
      THEN round(v_client * COALESCE(v_offer.partner_commission_rate, 0) / 100, 2)
    ELSE v_client - v_base
  END;

  UPDATE public.offers SET
    partner_base_net = v_base,
    client_total_net = v_client,
    partner_earnings_amount = v_earnings,
    partner_commission_amount = CASE
      WHEN v_offer.commercial_model = 'commission' THEN v_earnings ELSE 0
    END,
    total_base_price = v_base,
    subtotal = v_client,
    tax_percent = 23,
    tax_amount = round(v_client * 0.23, 2),
    total_amount = round(v_client * 1.23, 2),
    total_final_price = round(v_client * 1.23, 2),
    requires_internal_approval = v_requires_approval,
    partner_approval_status = CASE WHEN v_requires_approval THEN 'required' ELSE 'not_required' END
  WHERE id = v_offer_id;

  RETURN NULL;
END;
$function$;


-- Same transaction and idempotency key as the existing save. No parallel offers,
-- conversations or event records are created by configuration.
CREATE OR REPLACE FUNCTION public.save_seller_portal_offer_v2(p_request_id uuid,p_offer jsonb,p_items jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_partner uuid:=public.current_sales_partner_id(); v_id uuid; v_hash text; v_item jsonb;
BEGIN
 IF v_partner IS NULL OR p_request_id IS NULL THEN RAISE EXCEPTION 'Brak dostępu lub identyfikatora zapisu'; END IF;
 IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Dodaj od 1 do 100 pozycji oferty.'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(v_partner::text||p_request_id::text,0));
 SELECT offer_id,request_hash INTO v_id,v_hash FROM public.seller_offer_save_requests WHERE sales_partner_id=v_partner AND request_id=p_request_id;
 IF FOUND THEN
   IF v_hash<>md5(p_offer::text||p_items::text) THEN RAISE EXCEPTION 'Poprzedni zapis się zakończył. Otwórz zapisaną ofertę.'; END IF;
   RETURN v_id;
 END IF;
 IF (SELECT count(DISTINCT (value->>'display_order')::integer) FROM jsonb_array_elements(p_items))<>jsonb_array_length(p_items) THEN RAISE EXCEPTION 'Nieprawidłowa kolejność pozycji.'; END IF;
 FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
  IF coalesce((v_item->>'days')::integer,1) NOT BETWEEN 1 AND 3650 THEN RAISE EXCEPTION 'Podaj liczbę dni od 1 do 3650.'; END IF;
 END LOOP;
 PERFORM set_config('app.seller_configuration_items',p_items::text,true);
 v_id:=public.save_seller_portal_offer_for_organization(p_request_id,p_offer,p_items);
 PERFORM set_config('app.seller_configuration_items','',true);
 RETURN v_id;
END; $$;
REVOKE ALL ON FUNCTION public.save_seller_portal_offer_v2(uuid,jsonb,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_seller_portal_offer_v2(uuid,jsonb,jsonb) TO authenticated;

-- Preserve fingerprints of legacy one-day, nonconfigured offers exactly.
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
      ORDER BY i.display_order,i.id) FROM public.offer_items i WHERE i.offer_id=o.id)
  ) || CASE WHEN COALESCE(jsonb_array_length(o.recommended_items),0)>0
    THEN jsonb_build_object('recommendations',o.recommended_items) ELSE '{}'::jsonb END)::text) FROM public.offers o WHERE o.id=p_offer_id AND o.sales_channel='seller_portal';
$$;
REVOKE ALL ON FUNCTION public.seller_offer_source_key(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.seller_offer_source_key(uuid) TO service_role;


CREATE OR REPLACE FUNCTION public.get_seller_delivery_progress(p_offer uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $delivery_progress$
DECLARE o public.offers%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NOT COALESCE(public.seller_portal_offer_access_allowed(p_offer),false) THEN
    RAISE EXCEPTION 'Brak dostępu do tej oferty.';
  END IF;
  SELECT * INTO STRICT o FROM public.offers WHERE id=p_offer AND sales_channel='seller_portal';
  RETURN jsonb_build_object(
    'my_company_id',o.my_company_id,
    'commission_enabled',EXISTS(SELECT 1 FROM public.sales_partner_brand_terms t
      WHERE t.sales_partner_id=o.sales_partner_id AND t.my_company_id=o.my_company_id AND t.is_active AND t.commission_enabled),
    'acceptances',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',a.id,'document_id',a.document_id,
      'source_key',a.source_key,'seller_name',a.seller_name,'confirmed_at',a.confirmed_at) ORDER BY a.confirmed_at DESC,a.id)
      FROM public.seller_offer_client_acceptances a WHERE a.offer_id=o.id),'[]'::jsonb),
    -- Explicit allowlist: never expose internal costs, margins or CRM notes.
    'items',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',i.id,'name',i.name,'quantity',i.quantity,'unit',i.unit,'days',i.days,
      'configuration_scope',CASE WHEN i.seller_configuration_quote_id IS NOT NULL THEN i.description END,
      'requirements',i.partner_source_snapshot->>'additional_requirements',
      'accommodation',CASE WHEN i.partner_source_snapshot->>'requires_accommodation'='true'
        THEN COALESCE(NULLIF(i.partner_source_snapshot->>'accommodation_note',''),'Wymagany nocleg') END,
      'logistics',i.partner_source_snapshot->>'logistics_note') ORDER BY i.display_order,i.id)
      FROM public.offer_items i WHERE i.offer_id=o.id),'[]'::jsonb),
    'submissions',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',s.id,'task_key',s.task_key,
      'arrangement_revision',s.arrangement_revision,'submitted_at',s.submitted_at) ORDER BY s.submitted_at DESC,s.id)
      FROM public.seller_realization_submissions s WHERE s.offer_id=o.id),'[]'::jsonb));
END;
$delivery_progress$;
-- Price calculation and event resources follow the same selected LED tree.
-- Quantities are per set; the existing reservation engine multiplies sets,
-- never rental days. No existing reservations are changed here.
CREATE OR REPLACE FUNCTION public.led_warehouse_visit(s jsonb,equipment_id text,q numeric,path text,ancestors text[],state jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=public,pg_temp AS $led_visit$
DECLARE n jsonb:=s->'equipment'->equipment_id;p jsonb:=s->'selection';links jsonb;g record;l jsonb;chosen jsonb;selected_id text;required boolean;k text;rate numeric;amount numeric;h numeric;seen jsonb:=state->'seen';total numeric:=(state->>'total')::numeric;visits integer:=(state->>'visits')::integer;resources jsonb:=coalesce(state->'resources','{}'::jsonb);
BEGIN
 visits:=visits+1;
 IF visits>300 OR coalesce(array_length(ancestors,1),0)>=8 OR equipment_id=ANY(ancestors) THEN RAISE EXCEPTION 'Pętla lub zbyt głębokie zależności sprzętu.'; END IF;
 IF n IS NULL THEN RAISE EXCEPTION 'Brakuje sprzętu w kopii konfiguracji. Pobierz dane ponownie.'; END IF;
 IF q<=0 OR q>100000 OR q<>round(q,2) THEN RAISE EXCEPTION 'Podaj poprawną ilość: %.',n->>'name'; END IF;
 rate:=public.modular_numeric(n->'rate',n->>'name',true);
 rate:=coalesce(rate,0);
 resources:=jsonb_set(resources,ARRAY[equipment_id],to_jsonb(coalesce((resources->>equipment_id)::numeric,0)+q));
 total:=total+round(q*rate,2);h:=(p->>'height')::numeric;
 SELECT coalesce(jsonb_agg(x),'[]'::jsonb) INTO links FROM jsonb_array_elements(n->'links') x WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(s#>'{catalog,roots}') root WHERE root->>'equipment_id'=x->>'equipment_id');
 FOR g IN SELECT CASE WHEN x->>'group' IS NOT NULL THEN 'group:'||(x->>'group') ELSE 'item:'||(x->>'id') END AS key,jsonb_agg(x ORDER BY ord) AS options,bool_or(x->>'type'='required') AS required,bool_or(x->>'group' IS NOT NULL) AS choice FROM jsonb_array_elements(links) WITH ORDINALITY a(x,ord) GROUP BY 1 ORDER BY min(ord) LOOP
  k:=path||'/'||g.key;chosen:='[]'::jsonb;
  IF g.choice THEN
   selected_id:=p->'choices'->>k;
   IF coalesce(selected_id,'')<>'' THEN
    SELECT x INTO l FROM jsonb_array_elements(g.options) x WHERE x->>'id'=selected_id;
    IF l IS NULL THEN RAISE EXCEPTION 'Wybierz aktualny wariant w grupie: %.',substring(g.key from 7); END IF;
    chosen:=jsonb_build_array(l);
   ELSIF g.required THEN RAISE EXCEPTION 'Wybierz jeden wariant: % (%).',substring(g.key from 7),n->>'name'; END IF;
  ELSIF g.required OR p->'enabled'->k='true'::jsonb THEN chosen:=g.options;END IF;
  FOR l IN SELECT value FROM jsonb_array_elements(chosen) LOOP
   amount:=(l->>'quantity')::numeric;
   IF l->>'mode'='fixed' THEN
    IF seen ? (l->>'id') THEN
     IF (seen->>(l->>'id'))::numeric<>amount THEN RAISE EXCEPTION 'Niespójna stała ilość zależności.'; END IF;
     CONTINUE;
    END IF;
    seen:=seen||jsonb_build_object(l->>'id',amount);
   ELSIF l->>'mode'='per_batch' THEN amount:=amount*ceil(q/public.modular_numeric(l->'per_quantity','liczba sztuk w grupie',false,100000,true));
   ELSE amount:=amount*q;END IF;
   state:=public.led_warehouse_visit(s,l->>'equipment_id',amount,path||'/'||(l->>'id'),array_append(ancestors,equipment_id),jsonb_build_object('seen',seen,'total',total,'visits',visits,'resources',resources));
   resources:=state->'resources';
   seen:=state->'seen';total:=(state->>'total')::numeric;visits:=(state->>'visits')::integer;
  END LOOP;
 END LOOP;
 RETURN jsonb_build_object('seen',seen,'total',total,'visits',visits,'resources',resources);
END $led_visit$;
CREATE OR REPLACE FUNCTION public.led_warehouse_state(s jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=public,pg_temp AS $led_state$
DECLARE c jsonb:=s#>'{catalog,led_tree}';p jsonb;graph jsonb:=s#>'{selection,led_equipment}';original jsonb:=s;section jsonb;section_ids text[]:='{}';modules numeric:=0;cables numeric:=1;cols numeric;rows_count numeric;cable_id text:=s#>>'{catalog,led_cable_root_id}';r jsonb;l jsonb;n record;ids text[];q numeric;w numeric;d numeric;h numeric;edge numeric;sides numeric;state jsonb:='{"total":0,"visits":0,"seen":{}}';result numeric;
BEGIN
 PERFORM public.validate_led_warehouse_catalog(original->'catalog');
 IF jsonb_typeof(original#>'{selection,led_sections}') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Dodaj sekcje LED.'; END IF;
 IF jsonb_array_length(original#>'{selection,led_sections}') NOT BETWEEN 1 AND 30 THEN RAISE EXCEPTION 'Dodaj od 1 do 30 sekcji LED.'; END IF;
 FOR section IN SELECT value FROM jsonb_array_elements(original#>'{selection,led_sections}') LOOP
  IF jsonb_typeof(section->'id') IS DISTINCT FROM 'string' OR coalesce(section->>'id','')='' OR section->>'id'=ANY(section_ids) OR jsonb_typeof(section->'name') IS DISTINCT FROM 'string' OR length(trim(section->>'name')) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Uzupełnij nazwy i unikalne identyfikatory sekcji LED.'; END IF;
  section_ids:=array_append(section_ids,section->>'id');
  cols:=public.modular_numeric(section->'columns','kolumny LED',false,200,true);
  rows_count:=public.modular_numeric(section->'rows','wiersze LED',false,200,true);
  IF cols<1 OR rows_count<1 THEN RAISE EXCEPTION 'Sekcja LED wymaga dodatniej liczby kolumn i wierszy.'; END IF;
  modules:=modules+cols*rows_count;cables:=cables+ceil(cols*rows_count/16);
 END LOOP;
 IF modules>40000 OR public.modular_numeric(original#>'{selection,area}','powierzchnia LED',false,10000)<>modules/4 THEN RAISE EXCEPTION 'Powierzchnia nie odpowiada sekcjom LED.'; END IF;
 p:=jsonb_build_object('quantities',original#>'{selection,quantities}','choices',original#>'{selection,led_choices}','enabled',original#>'{selection,led_enabled}','height',1);
 IF jsonb_typeof(p->'quantities') IS DISTINCT FROM 'object' OR jsonb_typeof(p->'choices') IS DISTINCT FROM 'object' OR jsonb_typeof(p->'enabled') IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Uzupełnij wybór komponentów LED.'; END IF;
 s:=jsonb_build_object('catalog',c,'selection',p,'equipment',graph,'loaded_at',original#>'{selection,led_loaded_at}');
 IF jsonb_typeof(graph) IS DISTINCT FROM 'object' OR jsonb_typeof(s->'loaded_at') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'Pobierz sprzęt i ceny rentalne.';END IF;
 IF (SELECT count(*) FROM jsonb_object_keys(graph))>200 THEN RAISE EXCEPTION 'Zbyt wiele elementów sprzętu.';END IF;
 FOR n IN SELECT key,value FROM jsonb_each(graph) LOOP
  r:=n.value;ids:='{}';
  IF n.key!~*'^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
 OR r->>'id' IS DISTINCT FROM n.key OR jsonb_typeof(r->'name') IS DISTINCT FROM 'string' OR length(trim(r->>'name')) NOT BETWEEN 1 AND 300 OR jsonb_typeof(r->'name_en') IS DISTINCT FROM 'string' OR length(r->>'name_en')>300 OR jsonb_typeof(r->'links') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Nieprawidłowe dane sprzętu.'; END IF;
  PERFORM public.modular_numeric(r->'rate',r->>'name',true);
  IF jsonb_array_length(r->'links')>50 THEN RAISE EXCEPTION 'Zbyt wiele zależności sprzętu.';END IF;
  FOR l IN SELECT value FROM jsonb_array_elements(r->'links') LOOP
   IF coalesce(l->>'id','')!~*'^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
 OR coalesce(l->>'equipment_id','')!~*'^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
 OR (l->>'id')=ANY(ids) OR coalesce(l->>'type','') NOT IN ('required','recommended','optional') OR coalesce(l->>'mode','') NOT IN ('per_item','fixed','per_batch') OR (l->'group' IS DISTINCT FROM 'null'::jsonb AND (jsonb_typeof(l->'group') IS DISTINCT FROM 'string' OR length(trim(l->>'group')) NOT BETWEEN 1 AND 100)) THEN RAISE EXCEPTION 'Nieprawidłowe powiązanie sprzętu.';END IF;
   IF l->>'mode'='per_batch' AND public.modular_numeric(l->'per_quantity','liczba sztuk w grupie',false,100000,true)<1 THEN RAISE EXCEPTION 'Podaj dodatnią liczbę sztuk w grupie.'; END IF;
   ids:=array_append(ids,l->>'id');q:=public.modular_numeric(l->'quantity','ilość zależności',false,1000);IF q<=0 THEN RAISE EXCEPTION 'Ilość zależności musi być dodatnia.';END IF;
   q:=public.modular_numeric(l->'min_height','minimalna wysokość',true,200);IF q IS NOT NULL AND q<1 THEN RAISE EXCEPTION 'Minimalna wysokość musi być dodatnia.';END IF;
   q:=public.modular_numeric(l->'max_height','maksymalna wysokość',true,200);IF q IS NOT NULL AND q<1 THEN RAISE EXCEPTION 'Maksymalna wysokość musi być dodatnia.';END IF;
   IF (l->>'min_height')::numeric>(l->>'max_height')::numeric THEN RAISE EXCEPTION 'Nieprawidłowy zakres wysokości.';END IF;
  END LOOP;
 END LOOP;

 IF c ? 'component_groups' THEN
  FOR n IN SELECT key,value FROM jsonb_each(c->'component_groups') LOOP
   IF graph ? n.key THEN
    SELECT coalesce(jsonb_agg(i||jsonb_build_object('type',g->>'requirement','group',trim(g->>'name')) ORDER BY gn,inum),'[]'::jsonb) INTO l
    FROM jsonb_array_elements(n.value) WITH ORDINALITY gg(g,gn)
    CROSS JOIN LATERAL jsonb_array_elements(g->'items') WITH ORDINALITY ii(i,inum);
    IF graph->n.key->'links' IS DISTINCT FROM l THEN RAISE EXCEPTION 'Zmieniono zagnieżdżenia. Pobierz sprzęt ponownie przed zapisem.'; END IF;
   END IF;
  END LOOP;
 END IF;
 FOR r IN SELECT value FROM jsonb_array_elements(c->'roots') LOOP
  IF r->'required'='true'::jsonb OR p->'enabled'->('root:'||(r->>'id'))='true'::jsonb THEN
   q:=CASE WHEN r->>'id'=cable_id THEN cables WHEN r->>'basis'='decks' THEN modules WHEN r->>'basis'='manual' THEN public.modular_numeric(p->'quantities'->(r->>'id'),'ilość dodatku',false,100000) WHEN r->>'basis'='area' THEN (r->>'quantity')::numeric*modules/4 ELSE (r->>'quantity')::numeric END;
   state:=public.led_warehouse_visit(s,r->>'equipment_id',q,r->>'id','{}',state);
  END IF;
 END LOOP;
 result:=round((state->>'total')::numeric*(c->>'multiplier')::numeric,2);IF result>999999999 THEN RAISE EXCEPTION 'Wartość konfiguracji jest zbyt wysoka.';END IF;
 RETURN jsonb_set(state,'{total}',to_jsonb(result));
END $led_state$;
CREATE OR REPLACE FUNCTION public.led_warehouse_total(s jsonb)
RETURNS numeric LANGUAGE sql IMMUTABLE SET search_path=public,pg_temp AS $led_total$
 SELECT round((public.led_warehouse_state(s)->>'total')::numeric,2);
$led_total$;

NOTIFY pgrst,'reload schema';
COMMIT;
