BEGIN;
ALTER TABLE public.offers ADD COLUMN IF NOT EXISTS recommended_items jsonb NOT NULL DEFAULT '[]'::jsonb
 CHECK(jsonb_typeof(recommended_items)='array');

-- A separate RPC makes missing deployments fail explicitly instead of silently dropping proposals.
CREATE OR REPLACE FUNCTION public.save_seller_portal_offer_with_recommendations(p_request_id uuid,p_offer jsonb,p_items jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
 v_partner uuid:=public.current_sales_partner_id();
 v_id uuid; v_hash text; v_payload text:=md5(p_offer::text||p_items::text);
 v_proposals jsonb:=COALESCE(p_offer->'recommended_items','[]'::jsonb);
 v_normalized jsonb:='[]'::jsonb; v_item jsonb; v_product uuid; v_variant uuid;
 v_company uuid; v_model text; v_rate record; v_catalog record;
 v_quantity numeric; v_price numeric; v_keys text[]:='{}'::text[]; v_key text;
BEGIN
 IF v_partner IS NULL OR p_request_id IS NULL THEN RAISE EXCEPTION 'Brak dostępu lub identyfikatora zapisu'; END IF;
 IF jsonb_typeof(v_proposals)<>'array' THEN RAISE EXCEPTION 'Nieprawidłowa lista propozycji'; END IF;
 IF jsonb_array_length(v_proposals)>24 THEN RAISE EXCEPTION 'Możesz dodać najwyżej 24 propozycje'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(v_partner::text||p_request_id::text,0));
 SELECT offer_id,request_hash INTO v_id,v_hash FROM public.seller_offer_save_requests
 WHERE sales_partner_id=v_partner AND request_id=p_request_id;
 IF FOUND THEN
   IF v_hash<>v_payload THEN RAISE EXCEPTION 'Poprzedni zapis już się zakończył. Otwórz zapisaną ofertę przed dalszymi zmianami.'; END IF;
   RETURN v_id;
 END IF;
 -- Existing owner, brand, pricing, approval and ordinary offer-item validations remain unchanged.
 v_id:=public.save_seller_portal_offer(p_offer,p_items);
 SELECT my_company_id,commercial_model INTO v_company,v_model FROM public.offers WHERE id=v_id;
 FOR v_item IN SELECT value FROM jsonb_array_elements(v_proposals)
 LOOP
   v_product:=NULLIF(v_item->>'product_id','')::uuid;
   v_variant:=NULLIF(v_item->>'product_variant_id','')::uuid;
   v_key:=COALESCE(v_product::text,'')||':'||COALESCE(v_variant::text,'base');
   IF v_key=ANY(v_keys) THEN RAISE EXCEPTION 'Nie dodawaj tej samej propozycji dwukrotnie'; END IF;
   v_keys:=array_append(v_keys,v_key);
   IF EXISTS(SELECT 1 FROM public.offer_items WHERE offer_id=v_id AND product_id=v_product
     AND product_variant_id IS NOT DISTINCT FROM v_variant)
   THEN RAISE EXCEPTION 'Proponowana usługa jest już w głównej wycenie'; END IF;
   SELECT p.name AS product_name,v.name AS variant_name,p.unit,
     COALESCE(v.offer_image_path,p.offer_image_path) AS image_path
   INTO v_catalog FROM public.offer_products p
   LEFT JOIN public.offer_product_variants v ON v.id=v_variant AND v.product_id=p.id
   WHERE p.id=v_product AND p.is_active=true AND p.partner_portal_visible=true
     AND (v_variant IS NULL OR (v.id IS NOT NULL AND v.is_active=true AND v.partner_portal_visible=true));
   IF NOT FOUND THEN RAISE EXCEPTION 'Produkt nie jest dostępny w katalogu propozycji'; END IF;
   SELECT * INTO v_rate FROM public.resolve_seller_product_price(v_partner,v_company,v_product,v_variant);
   IF NOT FOUND OR NOT COALESCE(v_rate.is_available,false) THEN
     RAISE EXCEPTION 'Produkt nie jest dostępny w cenniku tego sprzedawcy';
   END IF;
   v_quantity:=NULLIF(v_item->>'quantity','')::numeric;
   v_price:=CASE WHEN v_model='commission' THEN v_rate.price_net ELSE NULLIF(v_item->>'unit_price','')::numeric END;
   IF v_quantity IS NULL OR v_quantity::text IN('NaN','Infinity','-Infinity') OR v_quantity<=0 OR v_quantity>100000
     OR v_price IS NULL OR v_price::text IN('NaN','Infinity','-Infinity') OR v_price<0 OR v_price>1000000000
   THEN RAISE EXCEPTION 'Podaj poprawną ilość i cenę propozycji'; END IF;
   v_normalized:=v_normalized||jsonb_build_array(jsonb_build_object(
     'id',COALESCE(NULLIF(v_item->>'id','')::uuid,gen_random_uuid()),
     'product_id',v_product,'product_variant_id',v_variant,
     'name',left(v_catalog.product_name||CASE WHEN v_variant IS NOT NULL THEN ' — '||v_catalog.variant_name ELSE '' END,160),
     'description',left(COALESCE(v_item->>'description',''),500),
     'unit',COALESCE(v_catalog.unit,'szt.'),'quantity',v_quantity,'unit_price',round(v_price,2),
     'image_path',v_catalog.image_path));
 END LOOP;
 -- Separate JSON, never offer_items: no totals, margin or equipment reservations are added.
 UPDATE public.offers SET recommended_items=v_normalized WHERE id=v_id;
 INSERT INTO public.seller_offer_save_requests(sales_partner_id,request_id,request_hash,offer_id)
 VALUES(v_partner,p_request_id,v_payload,v_id);
 RETURN v_id;
END; $$;
REVOKE ALL ON FUNCTION public.save_seller_portal_offer_with_recommendations(uuid,jsonb,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_seller_portal_offer_with_recommendations(uuid,jsonb,jsonb) TO authenticated;

-- Proposals are part of the exact version sent to the client/reviewer.
-- Empty lists preserve existing fingerprints to avoid invalidating unrelated offers.
CREATE OR REPLACE FUNCTION public.seller_offer_source_key(p_offer_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT md5((jsonb_build_object(
    'title',o.title,'description',o.description,'event_date',o.event_date,
    'event_location',o.event_location,'valid_until',o.valid_until,
    'client_name',o.portal_client_name,'client_company',o.portal_client_company,
    'client_email',o.portal_client_email,'client_phone',o.portal_client_phone,
    'approval',o.partner_approval_status,'company',o.my_company_id,'branding',o.partner_branding_snapshot,'tax',o.tax_percent,
    'items',(SELECT jsonb_agg(jsonb_build_object('id',i.id,'name',i.name,'description',i.description,
      'unit',i.unit,'quantity',i.quantity,'price',i.client_unit_price,'image',i.partner_source_snapshot->'image_path')
      ORDER BY i.display_order,i.id) FROM public.offer_items i WHERE i.offer_id=o.id)
  ) || CASE WHEN COALESCE(jsonb_array_length(o.recommended_items),0)>0
    THEN jsonb_build_object('recommendations',o.recommended_items) ELSE '{}'::jsonb END)::text) FROM public.offers o WHERE o.id=p_offer_id AND o.sales_channel='seller_portal';
$$;
REVOKE ALL ON FUNCTION public.seller_offer_source_key(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.seller_offer_source_key(uuid) TO service_role;

NOTIFY pgrst,'reload schema';
COMMIT;
