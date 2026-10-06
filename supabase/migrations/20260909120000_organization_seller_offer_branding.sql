BEGIN;

DO $$ BEGIN
 IF to_regclass('public.sales_partner_branding_profiles') IS NULL
   OR to_regprocedure('public.seller_workspace_staff_access(uuid,boolean)') IS NULL THEN
   RAISE EXCEPTION 'Najpierw zastosuj migracje portalu oraz 20260909090000_seller_workspace_and_chat.sql.';
 END IF;
END; $$;

ALTER TABLE public.sales_partner_branding_profiles ADD COLUMN IF NOT EXISTS offer_identity jsonb;
CREATE TABLE IF NOT EXISTS public.organization_offer_branding (
 organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
 my_company_id uuid NOT NULL REFERENCES public.my_companies(id) ON DELETE CASCADE,
 branding jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(branding)='object'),
 source_partner_id uuid REFERENCES public.sales_partner_profiles(id) ON DELETE SET NULL,
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(organization_id,my_company_id)
);
ALTER TABLE public.organization_offer_branding ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.organization_offer_branding FROM anon,authenticated;
GRANT SELECT ON public.organization_offer_branding TO authenticated;
GRANT ALL ON public.organization_offer_branding TO service_role;
DROP POLICY IF EXISTS organization_offer_branding_read ON public.organization_offer_branding;
CREATE POLICY organization_offer_branding_read ON public.organization_offer_branding FOR SELECT TO authenticated
 USING(public.seller_workspace_staff_access(my_company_id) OR EXISTS(
   SELECT 1 FROM public.sales_partner_profiles p JOIN public.sales_partner_brand_terms t ON t.sales_partner_id=p.id
   WHERE p.id=public.current_sales_partner_id() AND p.organization_id=organization_offer_branding.organization_id
     AND t.my_company_id=organization_offer_branding.my_company_id AND t.is_active));

-- Whitelist shared visuals: personal identity and compensation never propagate.
CREATE OR REPLACE FUNCTION public.seller_offer_visual_identity(p_data jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=public AS $$
DECLARE v jsonb; k text;
BEGIN
 IF COALESCE(jsonb_typeof(p_data),'object')<>'object' THEN RAISE EXCEPTION 'Nieprawidłowe ustawienia brandingu'; END IF;
 SELECT COALESCE(jsonb_object_agg(key,value),'{}'::jsonb) INTO v FROM jsonb_each(jsonb_strip_nulls(COALESCE(p_data,'{}'::jsonb)))
 WHERE key=ANY(ARRAY['hotel_logo_url','hotel_cover_image_url','venue_image_urls','brandbook_url','brandbook_notes',
   'brand_primary_color','brand_secondary_color','brand_surface_color','heading_font_family','heading_font_path','footer_text','disclosure_text']);
 v:=jsonb_build_object('brand_primary_color','#1c1f33','brand_secondary_color','#d3bb73','brand_surface_color','#faf7f2',
   'heading_font_family','Noto Sans','venue_image_urls','[]'::jsonb)||v;
 FOREACH k IN ARRAY ARRAY['brand_primary_color','brand_secondary_color','brand_surface_color'] LOOP
   IF COALESCE(v->>k,'') !~ '^#[0-9a-fA-F]{6}$' THEN RAISE EXCEPTION 'Podaj poprawny kolor HEX (#RRGGBB)'; END IF;
 END LOOP;
 IF jsonb_typeof(v->'venue_image_urls')<>'array' THEN RAISE EXCEPTION 'Nieprawidłowa galeria'; END IF;
 IF jsonb_array_length(v->'venue_image_urls')>24 OR EXISTS(SELECT 1 FROM jsonb_array_elements(v->'venue_image_urls') x WHERE jsonb_typeof(x.value)<>'string') THEN
   RAISE EXCEPTION 'Galeria może zawierać najwyżej 24 zdjęcia'; END IF;
 IF length(v::text)>20000 THEN RAISE EXCEPTION 'Ustawienia brandingu są zbyt obszerne'; END IF;
 RETURN v;
END; $$;

-- The most recently edited hotel profile provides the initial shared identity.
-- All original personal profiles and existing PDF/snapshot versions are retained.
INSERT INTO public.organization_offer_branding(organization_id,my_company_id,branding,source_partner_id)
SELECT DISTINCT ON(p.organization_id,b.my_company_id) p.organization_id,b.my_company_id,
 public.seller_offer_visual_identity(COALESCE(b.offer_identity,to_jsonb(b))),p.id
FROM public.sales_partner_branding_profiles b JOIN public.sales_partner_profiles p ON p.id=b.sales_partner_id
WHERE p.organization_id IS NOT NULL AND b.is_active
  AND b.brand_primary_color ~ '^#[0-9a-fA-F]{6}$' AND b.brand_secondary_color ~ '^#[0-9a-fA-F]{6}$'
ORDER BY p.organization_id,b.my_company_id,b.updated_at DESC,b.id
ON CONFLICT(organization_id,my_company_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.resolve_seller_offer_branding(p_partner uuid,p_company uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE p record; b jsonb; v jsonb; shared public.organization_offer_branding%ROWTYPE;
BEGIN
 SELECT s.*,c.full_name,c.email,c.mobile,c.phone,c.avatar_url,
   o.name AS organization_name,o.alias,o.website,o.address,o.city,
   (SELECT r.position FROM public.contact_organizations r WHERE r.contact_id=s.contact_id
     AND r.organization_id=s.organization_id AND r.is_current LIMIT 1) AS position
 INTO p FROM public.sales_partner_profiles s LEFT JOIN public.contacts c ON c.id=s.contact_id
 LEFT JOIN public.organizations o ON o.id=s.organization_id WHERE s.id=p_partner;
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT to_jsonb(x) INTO b FROM public.sales_partner_branding_profiles x WHERE sales_partner_id=p_partner AND my_company_id=p_company;
 b:=COALESCE(b,'{}'::jsonb);
 IF p.organization_id IS NOT NULL THEN
   SELECT * INTO shared FROM public.organization_offer_branding WHERE organization_id=p.organization_id AND my_company_id=p_company;
   v:=public.seller_offer_visual_identity(COALESCE(shared.branding,'{}'::jsonb));
 ELSE
   v:=public.seller_offer_visual_identity(COALESCE(NULLIF(b->'offer_identity','null'::jsonb),b));
 END IF;
 RETURN v||jsonb_build_object('identity_version',2,
   'id',b->'id','default_commercial_model',COALESCE(b->>'default_commercial_model','markup'),
   'display_name',COALESCE(NULLIF(b->>'display_name',''),p.full_name,''),
   'position_title',COALESCE(NULLIF(b->>'position_title',''),p.position,''),
   'contact_email',COALESCE(NULLIF(b->>'contact_email',''),p.email,''),
   'contact_phone',COALESCE(NULLIF(b->>'contact_phone',''),p.mobile,p.phone,''),
   'portrait_url',COALESCE(NULLIF(b->>'portrait_url',''),p.avatar_url,''),
   'portrait_source',CASE WHEN NULLIF(b->>'portrait_url','') IS NULL THEN 'contact' ELSE 'seller' END,
   'branding_source',CASE WHEN p.organization_id IS NULL THEN 'seller' ELSE 'organization' END,
   'organization_id',p.organization_id,'organization_name',COALESCE(NULLIF(p.alias,''),p.organization_name),
   'organization_website',p.website,'organization_address',concat_ws(', ',p.address,p.city),
   'organization_asset_partner_id',shared.source_partner_id,
   'organization_branding_configured',CASE WHEN p.organization_id IS NOT NULL THEN shared.organization_id IS NOT NULL ELSE true END);
END; $$;

CREATE OR REPLACE FUNCTION public.validate_seller_identity_assets(p_data jsonb,p_partner uuid,p_company uuid,p_organization uuid DEFAULT NULL,p_legacy_partner uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SET search_path=public AS $$
DECLARE path text;
BEGIN
 FOR path IN SELECT value FROM jsonb_each_text(p_data) WHERE key=ANY(ARRAY['hotel_logo_url','hotel_cover_image_url','brandbook_url','heading_font_path'])
   UNION ALL SELECT value FROM jsonb_array_elements_text(COALESCE(p_data->'venue_image_urls','[]'::jsonb)) LOOP
   IF COALESCE(path,'')='' THEN CONTINUE; END IF;
   IF path ~ '(^|/)[.][.]?(/|$)' OR NOT COALESCE((
     (p_organization IS NULL AND p_partner IS NOT NULL AND starts_with(path,p_partner::text||'/'||p_company::text||'/'))
     OR (p_organization IS NOT NULL AND starts_with(path,'organizations/'||p_organization::text||'/'||p_company::text||'/'))
     OR (p_organization IS NOT NULL AND p_legacy_partner IS NOT NULL AND starts_with(path,p_legacy_partner::text||'/'||p_company::text||'/'))
   ),false) THEN RAISE EXCEPTION 'Plik nie należy do właściwej organizacji, sprzedawcy lub marki'; END IF;
 END LOOP;
END; $$;

CREATE OR REPLACE FUNCTION public.get_crm_offer_branding(p_partner uuid DEFAULT NULL,p_organization uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE v_org uuid:=p_organization; rows jsonb;
BEGIN
 IF public.current_session_is_seller_portal() THEN RAISE EXCEPTION 'Brak dostępu do ustawień CRM'; END IF;
 IF p_partner IS NOT NULL THEN
   SELECT organization_id INTO v_org FROM public.sales_partner_profiles WHERE id=p_partner;
   IF NOT FOUND THEN RAISE EXCEPTION 'Nie znaleziono sprzedawcy'; END IF;
 ELSIF NOT EXISTS(SELECT 1 FROM public.organizations WHERE id=v_org) THEN RAISE EXCEPTION 'Nie znaleziono organizacji'; END IF;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,
   'can_manage',public.seller_workspace_staff_access(c.id,true),
   'branding',CASE WHEN p_partner IS NOT NULL THEN public.resolve_seller_offer_branding(p_partner,c.id)
     ELSE public.seller_offer_visual_identity(COALESCE(b.branding,'{}'::jsonb)) END)
   ORDER BY c.name),'[]'::jsonb) INTO rows
 FROM public.my_companies c LEFT JOIN public.organization_offer_branding b ON b.organization_id=v_org AND b.my_company_id=c.id
 WHERE c.is_active AND public.seller_workspace_staff_access(c.id)
   AND (p_partner IS NULL OR EXISTS(SELECT 1 FROM public.sales_partner_brand_terms t WHERE t.sales_partner_id=p_partner AND t.my_company_id=c.id));
 IF jsonb_array_length(rows)=0 THEN RAISE EXCEPTION 'Brak uprawnień do brandingu w przypisanych markach'; END IF;
 RETURN jsonb_build_object('organization_id',v_org,'organization_name',(SELECT COALESCE(NULLIF(alias,''),name) FROM public.organizations WHERE id=v_org),'brands',rows);
END; $$;

CREATE OR REPLACE FUNCTION public.save_crm_offer_branding(p_company uuid,p_branding jsonb,p_partner uuid DEFAULT NULL,p_organization uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_org uuid:=p_organization; v_visual jsonb; v_legacy uuid; v_portrait text:=NULLIF(btrim(p_branding->>'portrait_url'),'');
BEGIN
 IF NOT COALESCE(public.seller_workspace_staff_access(p_company,true),false) THEN RAISE EXCEPTION 'Brak uprawnień do edycji brandingu tej marki'; END IF;
 IF p_partner IS NOT NULL THEN
   SELECT organization_id INTO v_org FROM public.sales_partner_profiles WHERE id=p_partner FOR UPDATE;
   IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.sales_partner_brand_terms WHERE sales_partner_id=p_partner AND my_company_id=p_company) THEN RAISE EXCEPTION 'Sprzedawca nie należy do tej marki'; END IF;
 ELSIF NOT EXISTS(SELECT 1 FROM public.organizations WHERE id=v_org) THEN RAISE EXCEPTION 'Nie znaleziono organizacji'; END IF;
 IF p_organization IS DISTINCT FROM v_org THEN RAISE EXCEPTION 'Organizacja sprzedawcy zmieniła się. Wczytaj ponownie ustawienia.'; END IF;
 v_visual:=public.seller_offer_visual_identity(p_branding);
 SELECT source_partner_id INTO v_legacy FROM public.organization_offer_branding WHERE organization_id=v_org AND my_company_id=p_company;
 PERFORM public.validate_seller_identity_assets(v_visual,p_partner,p_company,v_org,v_legacy);
 IF p_partner IS NOT NULL THEN
   IF v_portrait IS NOT NULL AND v_portrait=(SELECT c.avatar_url FROM public.contacts c JOIN public.sales_partner_profiles p ON p.contact_id=c.id WHERE p.id=p_partner) THEN v_portrait:=NULL; END IF;
   IF v_portrait IS NOT NULL AND (NOT starts_with(v_portrait,p_partner::text||'/'||p_company::text||'/') OR v_portrait ~ '(^|/)[.][.]?(/|$)') THEN RAISE EXCEPTION 'Zdjęcie nie należy do sprzedawcy i marki'; END IF;
   INSERT INTO public.sales_partner_branding_profiles(sales_partner_id,my_company_id,display_name,position_title,contact_email,contact_phone,portrait_url,offer_identity)
   VALUES(p_partner,p_company,NULLIF(btrim(p_branding->>'display_name'),''),NULLIF(btrim(p_branding->>'position_title'),''),
     NULLIF(btrim(p_branding->>'contact_email'),''),NULLIF(btrim(p_branding->>'contact_phone'),''),v_portrait,CASE WHEN v_org IS NULL THEN v_visual END)
   ON CONFLICT(sales_partner_id,my_company_id) DO UPDATE SET display_name=EXCLUDED.display_name,position_title=EXCLUDED.position_title,
     contact_email=EXCLUDED.contact_email,contact_phone=EXCLUDED.contact_phone,portrait_url=EXCLUDED.portrait_url,
     offer_identity=CASE WHEN v_org IS NULL THEN v_visual ELSE public.sales_partner_branding_profiles.offer_identity END;
 END IF;
 IF v_org IS NOT NULL THEN
   INSERT INTO public.organization_offer_branding(organization_id,my_company_id,branding) VALUES(v_org,p_company,v_visual)
   ON CONFLICT(organization_id,my_company_id) DO UPDATE SET branding=EXCLUDED.branding,updated_at=now();
 END IF;
END; $$;

CREATE OR REPLACE FUNCTION public.save_seller_portal_settings(p_branding jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE p uuid:=public.current_sales_partner_id(); c uuid:=NULLIF(p_branding->>'my_company_id','')::uuid;
 org uuid; v jsonb; previous jsonb; payload jsonb; result uuid; portrait text:=NULLIF(btrim(p_branding->>'portrait_url'),'');
BEGIN
 SELECT organization_id INTO org FROM public.sales_partner_profiles WHERE id=p FOR UPDATE;
 IF NOT FOUND OR c IS NULL THEN RAISE EXCEPTION 'Brak dostępu do portalu lub marki'; END IF;
 SELECT to_jsonb(b) INTO previous FROM public.sales_partner_branding_profiles b WHERE sales_partner_id=p AND my_company_id=c;
 IF portrait IS NOT NULL AND portrait=(SELECT x.avatar_url FROM public.contacts x JOIN public.sales_partner_profiles s ON s.contact_id=x.id WHERE s.id=p) THEN portrait:=NULL; END IF;
 IF portrait IS NOT NULL AND (NOT starts_with(portrait,p::text||'/'||c::text||'/') OR portrait ~ '(^|/)[.][.]?(/|$)') THEN RAISE EXCEPTION 'Zdjęcie nie należy do sprzedawcy i marki'; END IF;
 payload:=p_branding||jsonb_build_object('portrait_url',portrait);
 IF org IS NULL THEN
   v:=public.seller_offer_visual_identity(p_branding);
   PERFORM public.validate_seller_identity_assets(v,p,c);
 ELSE
   -- Ignore visual changes from older clients. Organization branding is CRM-owned.
   payload:=payload||public.seller_offer_visual_identity(COALESCE(previous,'{}'::jsonb));
 END IF;
 result:=public.save_seller_portal_branding(payload);
 IF org IS NULL THEN UPDATE public.sales_partner_branding_profiles SET offer_identity=v WHERE id=result; END IF;
 RETURN result;
END; $$;
-- Close the old direct entry point; only the validated settings wrapper calls it.
REVOKE ALL ON FUNCTION public.save_seller_portal_branding(jsonb) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.get_seller_portal_context()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT jsonb_build_object('profile',jsonb_build_object('id',p.id,'partner_type',p.partner_type,'organization_id',p.organization_id,
   'person',jsonb_build_object('name',c.full_name,'email',c.email,'phone',COALESCE(c.mobile,c.phone),'photo_url',c.avatar_url,
     'position',(SELECT r.position FROM public.contact_organizations r WHERE r.contact_id=p.contact_id AND r.organization_id=p.organization_id AND r.is_current LIMIT 1)),
   'organization',jsonb_build_object('id',o.id,'name',o.name,'alias',o.alias,'email',o.email,'phone',o.phone,'website',o.website,'address',o.address,'city',o.city)),
   'brands',COALESCE((SELECT jsonb_agg(jsonb_build_object('my_company_id',t.my_company_id,'name',b.name,'legal_name',b.legal_name,'logo_url',b.logo_url,
     'commission_enabled',t.commission_enabled,'default_commission_rate',CASE WHEN t.commission_enabled THEN t.default_commission_rate ELSE 0 END,
     'default_payment_method',CASE WHEN t.commission_enabled THEN t.default_payment_method END,
     'branding',public.resolve_seller_offer_branding(p.id,t.my_company_id)) ORDER BY b.name)
   FROM public.sales_partner_brand_terms t JOIN public.my_companies b ON b.id=t.my_company_id
   WHERE t.sales_partner_id=p.id AND t.is_active AND b.is_active),'[]'::jsonb))
 FROM public.sales_partner_profiles p JOIN public.contacts c ON c.id=p.contact_id
 LEFT JOIN public.organizations o ON o.id=p.organization_id WHERE p.id=public.current_sales_partner_id();
$$;

CREATE OR REPLACE FUNCTION public.snapshot_seller_offer_identity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NEW.sales_channel='seller_portal' AND NEW.sales_partner_id IS NOT NULL THEN
   NEW.partner_branding_snapshot:=public.resolve_seller_offer_branding(NEW.sales_partner_id,NEW.my_company_id);
   NEW.partner_organization_id:=NULLIF(NEW.partner_branding_snapshot->>'organization_id','')::uuid;
 END IF;
 RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS snapshot_seller_offer_identity ON public.offers;
CREATE TRIGGER snapshot_seller_offer_identity BEFORE INSERT OR UPDATE OF partner_branding_snapshot,sales_partner_id,my_company_id,partner_organization_id
 ON public.offers FOR EACH ROW EXECUTE FUNCTION public.snapshot_seller_offer_identity();

CREATE OR REPLACE FUNCTION public.refresh_seller_offer_identity(p_offer uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE o record;
BEGIN
 SELECT * INTO o FROM public.offers WHERE id=p_offer AND sales_channel='seller_portal' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Nie znaleziono oferty sprzedawcy'; END IF;
 IF NOT COALESCE(public.seller_offer_can_manage(p_offer) OR (
   o.sales_partner_id=public.current_sales_partner_id() AND EXISTS(SELECT 1 FROM public.sales_partner_brand_terms t
     WHERE t.sales_partner_id=o.sales_partner_id AND t.my_company_id=o.my_company_id AND t.is_active)),false) THEN
   RAISE EXCEPTION 'Brak uprawnień do przygotowania brandingu tej oferty'; END IF;
 UPDATE public.offers SET partner_branding_snapshot=public.resolve_seller_offer_branding(o.sales_partner_id,o.my_company_id) WHERE id=p_offer;
END; $$;

CREATE OR REPLACE FUNCTION public.seller_brand_asset_access(p_name text,p_write boolean DEFAULT false)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT p_name !~ '(^|/)[.][.]?(/|$)' AND (
   EXISTS(SELECT 1 FROM public.my_companies c JOIN public.organizations o ON o.id::text=split_part(p_name,'/',2)
     WHERE split_part(p_name,'/',1)='organizations' AND c.id::text=split_part(p_name,'/',3)
     AND (public.seller_workspace_staff_access(c.id,p_write) OR (NOT p_write AND EXISTS(
       SELECT 1 FROM public.sales_partner_profiles p JOIN public.sales_partner_brand_terms t ON t.sales_partner_id=p.id
       WHERE p.id=public.current_sales_partner_id() AND p.organization_id=o.id AND t.my_company_id=c.id AND t.is_active))))
   OR EXISTS(SELECT 1 FROM public.sales_partner_profiles p JOIN public.sales_partner_brand_terms t ON t.sales_partner_id=p.id
     WHERE p.id::text=split_part(p_name,'/',1) AND t.my_company_id::text=split_part(p_name,'/',2)
     AND (public.seller_workspace_staff_access(t.my_company_id,p_write)
       OR (p.id=public.current_sales_partner_id() AND t.is_active AND
         (NOT p_write OR p.organization_id IS NULL OR split_part(p_name,'/',3) LIKE 'portrait-%'))))
   OR (NOT p_write AND EXISTS(SELECT 1 FROM public.organization_offer_branding b
     WHERE b.source_partner_id::text=split_part(p_name,'/',1) AND b.my_company_id::text=split_part(p_name,'/',2)
     AND (p_name IN(b.branding->>'hotel_logo_url',b.branding->>'hotel_cover_image_url',b.branding->>'brandbook_url',b.branding->>'heading_font_path')
       OR COALESCE(b.branding->'venue_image_urls','[]'::jsonb) ? p_name)
     AND (public.seller_workspace_staff_access(b.my_company_id) OR EXISTS(
       SELECT 1 FROM public.sales_partner_profiles p JOIN public.sales_partner_brand_terms t ON t.sales_partner_id=p.id
       WHERE p.id=public.current_sales_partner_id() AND p.organization_id=b.organization_id AND t.my_company_id=b.my_company_id AND t.is_active))))
 );
$$;
DROP POLICY IF EXISTS seller_brand_assets_select ON storage.objects;
DROP POLICY IF EXISTS seller_brand_assets_insert ON storage.objects;
DROP POLICY IF EXISTS seller_brand_assets_update ON storage.objects;
DROP POLICY IF EXISTS seller_brand_assets_delete ON storage.objects;
CREATE POLICY seller_brand_assets_select ON storage.objects FOR SELECT TO authenticated USING(bucket_id='seller-brand-assets' AND public.seller_brand_asset_access(name));
CREATE POLICY seller_brand_assets_insert ON storage.objects FOR INSERT TO authenticated WITH CHECK(bucket_id='seller-brand-assets' AND public.seller_brand_asset_access(name,true));
-- Append-only assets: a replacement has a new path, preserving shared assets and snapshots.

REVOKE ALL ON FUNCTION public.seller_offer_visual_identity(jsonb),public.resolve_seller_offer_branding(uuid,uuid),
 public.validate_seller_identity_assets(jsonb,uuid,uuid,uuid,uuid),public.snapshot_seller_offer_identity(),
 public.get_crm_offer_branding(uuid,uuid),public.save_crm_offer_branding(uuid,jsonb,uuid,uuid),
 public.save_seller_portal_settings(jsonb),public.get_seller_portal_context(),public.refresh_seller_offer_identity(uuid),
 public.seller_brand_asset_access(text,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_crm_offer_branding(uuid,uuid),public.save_crm_offer_branding(uuid,jsonb,uuid,uuid),
 public.save_seller_portal_settings(jsonb),public.get_seller_portal_context(),public.refresh_seller_offer_identity(uuid),
 public.seller_brand_asset_access(text,boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_seller_offer_branding(uuid,uuid) TO service_role;

NOTIFY pgrst,'reload schema';
COMMIT;
