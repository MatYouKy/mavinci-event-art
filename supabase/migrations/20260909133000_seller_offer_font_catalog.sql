BEGIN;

DO $$ BEGIN
 IF to_regprocedure('public.resolve_seller_offer_branding(uuid,uuid)') IS NULL
   OR to_regclass('public.company_brandbook_fonts') IS NULL THEN
   RAISE EXCEPTION 'Najpierw zastosuj migrację 20260909120000_organization_seller_offer_branding.sql oraz migracje brandbooka CRM.';
 END IF;
END; $$;

-- No new grants, storage policies or cross-brand font access. Catalog font ids
-- are constrained to the exact brand already authorized by the save RPCs.
CREATE OR REPLACE FUNCTION public.seller_offer_visual_identity(p_data jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=public AS $$
DECLARE v jsonb; k text; f jsonb;
BEGIN
 IF COALESCE(jsonb_typeof(p_data),'object')<>'object' THEN RAISE EXCEPTION 'Nieprawidłowe ustawienia brandingu'; END IF;
 SELECT COALESCE(jsonb_object_agg(key,value),'{}'::jsonb) INTO v
 FROM jsonb_each(jsonb_strip_nulls(COALESCE(p_data,'{}'::jsonb)))
 WHERE key=ANY(ARRAY['hotel_logo_url','hotel_cover_image_url','venue_image_urls','brandbook_url','brandbook_notes',
   'brand_primary_color','brand_secondary_color','brand_surface_color','heading_font_family','heading_font_path',
   'heading_font_catalog_id','heading_font_uploads','footer_text','disclosure_text']);
 v:=jsonb_build_object('brand_primary_color','#1c1f33','brand_secondary_color','#d3bb73','brand_surface_color','#faf7f2',
   'heading_font_family','Noto Sans','venue_image_urls','[]'::jsonb,'heading_font_uploads','[]'::jsonb,
   'heading_font_selection_version',1)||v;
 FOREACH k IN ARRAY ARRAY['brand_primary_color','brand_secondary_color','brand_surface_color'] LOOP
   IF COALESCE(v->>k,'') !~ '^#[0-9a-fA-F]{6}$' THEN RAISE EXCEPTION 'Podaj poprawny kolor HEX (#RRGGBB)'; END IF;
 END LOOP;
 IF jsonb_typeof(v->'venue_image_urls')<>'array' THEN RAISE EXCEPTION 'Nieprawidłowa galeria'; END IF;
 IF jsonb_array_length(v->'venue_image_urls')>24 OR EXISTS(SELECT 1 FROM jsonb_array_elements(v->'venue_image_urls') x WHERE jsonb_typeof(x.value)<>'string') THEN
   RAISE EXCEPTION 'Galeria może zawierać najwyżej 24 zdjęcia'; END IF;
 IF jsonb_typeof(v->'heading_font_uploads')<>'array' THEN RAISE EXCEPTION 'Nieprawidłowa lista czcionek'; END IF;
 IF jsonb_array_length(v->'heading_font_uploads')>24 THEN RAISE EXCEPTION 'Branding może zawierać najwyżej 24 własne czcionki'; END IF;
 FOR f IN SELECT value FROM jsonb_array_elements(v->'heading_font_uploads') LOOP
   IF jsonb_typeof(f)<>'object' OR COALESCE(jsonb_typeof(f->'path'),'null')<>'string'
     OR COALESCE(jsonb_typeof(f->'family'),'null')<>'string'
     OR length(btrim(COALESCE(f->>'path','')))=0 OR length(btrim(COALESCE(f->>'family',''))) NOT BETWEEN 1 AND 200 THEN
     RAISE EXCEPTION 'Każda czcionka musi mieć nazwę i ścieżkę pliku'; END IF;
 END LOOP;
 IF NULLIF(v->>'heading_font_catalog_id','') IS NOT NULL THEN
   IF v->>'heading_font_catalog_id' !~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' THEN RAISE EXCEPTION 'Nieprawidłowy wybór czcionki CRM'; END IF;
   IF NULLIF(v->>'heading_font_path','') IS NOT NULL THEN RAISE EXCEPTION 'Wybierz jedną czcionkę: z CRM albo z własnych plików'; END IF;
 END IF;
 IF length(v::text)>20000 THEN RAISE EXCEPTION 'Ustawienia brandingu są zbyt obszerne'; END IF;
 RETURN v;
END; $$;

CREATE OR REPLACE FUNCTION public.validate_seller_identity_assets(p_data jsonb,p_partner uuid,p_company uuid,p_organization uuid DEFAULT NULL,p_legacy_partner uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SET search_path=public AS $$
DECLARE path text;
BEGIN
 IF NULLIF(p_data->>'heading_font_catalog_id','') IS NOT NULL AND NOT EXISTS(
   SELECT 1 FROM public.company_brandbook_fonts WHERE id::text=p_data->>'heading_font_catalog_id' AND company_id=p_company
 ) THEN RAISE EXCEPTION 'Wybrana czcionka nie jest dostępna w bibliotece tej marki'; END IF;
 FOR path IN SELECT value FROM jsonb_each_text(p_data) WHERE key=ANY(ARRAY['hotel_logo_url','hotel_cover_image_url','brandbook_url','heading_font_path'])
   UNION ALL SELECT value FROM jsonb_array_elements_text(COALESCE(p_data->'venue_image_urls','[]'::jsonb))
   UNION ALL SELECT value->>'path' FROM jsonb_array_elements(COALESCE(p_data->'heading_font_uploads','[]'::jsonb)) LOOP
   IF COALESCE(path,'')='' THEN CONTINUE; END IF;
   IF path ~ '(^|/)[.][.]?(/|$)' OR NOT COALESCE((
     (p_organization IS NULL AND p_partner IS NOT NULL AND starts_with(path,p_partner::text||'/'||p_company::text||'/'))
     OR (p_organization IS NOT NULL AND starts_with(path,'organizations/'||p_organization::text||'/'||p_company::text||'/'))
     OR (p_organization IS NOT NULL AND p_legacy_partner IS NOT NULL AND starts_with(path,p_legacy_partner::text||'/'||p_company::text||'/'))
   ),false) THEN RAISE EXCEPTION 'Plik nie należy do właściwej organizacji, sprzedawcy lub marki'; END IF;
 END LOOP;
END; $$;

-- Preserve the existing trigger/authorization model. Only the font of this
-- offer's brand can be resolved; private seller assets still use owner paths.
CREATE OR REPLACE FUNCTION public.snapshot_seller_offer_identity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE f public.company_brandbook_fonts%ROWTYPE;
BEGIN
 IF NEW.sales_channel='seller_portal' AND NEW.sales_partner_id IS NOT NULL THEN
   NEW.partner_branding_snapshot:=public.resolve_seller_offer_branding(NEW.sales_partner_id,NEW.my_company_id);
   IF NULLIF(NEW.partner_branding_snapshot->>'heading_font_catalog_id','') IS NOT NULL THEN
     SELECT * INTO f FROM public.company_brandbook_fonts
     WHERE id::text=NEW.partner_branding_snapshot->>'heading_font_catalog_id' AND company_id=NEW.my_company_id;
     IF NOT FOUND THEN RAISE EXCEPTION 'Wybrana czcionka nie jest już dostępna w bibliotece tej marki. Wybierz inną w brandingu oferty.'; END IF;
     NEW.partner_branding_snapshot:=NEW.partner_branding_snapshot||jsonb_build_object('heading_font_family',f.family,
       'heading_font_catalog_snapshot',jsonb_build_object('id',f.id,'company_id',f.company_id,'family',f.family,
         'weight',f.weight,'storage_path',f.storage_path,'file_url',f.file_url));
   END IF;
   NEW.partner_organization_id:=NULLIF(NEW.partner_branding_snapshot->>'organization_id','')::uuid;
 END IF;
 RETURN NEW;
END; $$;

-- CREATE OR REPLACE preserves the existing restricted grants. No new RPCs.
NOTIFY pgrst,'reload schema';
COMMIT;
