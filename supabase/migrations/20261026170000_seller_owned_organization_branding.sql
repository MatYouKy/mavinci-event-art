BEGIN;

-- Shared visuals are owned by the organization's affiliated portal sellers.
-- Personal identity, commercial terms, hotel rooms and offer snapshots are not
-- changed by this migration. Asset replacement remains append-only.
ALTER TABLE public.organization_offer_branding
  ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  ADD COLUMN IF NOT EXISTS updated_by_partner_id uuid REFERENCES public.sales_partner_profiles(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.seller_can_edit_organization_branding(p_organization uuid, p_company uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.sales_partner_profiles p
    JOIN public.sales_partner_brand_terms t ON t.sales_partner_id=p.id
    JOIN public.my_companies c ON c.id=t.my_company_id
    WHERE p.id=public.current_sales_partner_id() AND p.portal_enabled AND p.status='active'
      AND t.my_company_id=p_company AND t.is_active AND c.is_active
      AND EXISTS (SELECT 1 FROM public.seller_partner_organization_ids(p.id) o WHERE o.organization_id=p_organization)
  );
$$;

DROP POLICY IF EXISTS organization_offer_branding_read ON public.organization_offer_branding;
CREATE POLICY organization_offer_branding_read ON public.organization_offer_branding FOR SELECT TO authenticated
  USING (public.seller_workspace_staff_access(my_company_id)
    OR public.seller_can_edit_organization_branding(organization_id,my_company_id));
REVOKE INSERT, UPDATE, DELETE ON public.organization_offer_branding,public.sales_partner_branding_profiles FROM anon,authenticated;

CREATE OR REPLACE FUNCTION public.get_seller_organization_branding(p_organization uuid, p_company uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE b public.organization_offer_branding%ROWTYPE; editor text;
BEGIN
  IF NOT public.seller_can_edit_organization_branding(p_organization,p_company) THEN
    RAISE EXCEPTION 'Brak dostępu do brandingu tej organizacji i marki. Sprawdź aktualne przypisania.' USING ERRCODE='42501';
  END IF;
  SELECT * INTO b FROM public.organization_offer_branding WHERE organization_id=p_organization AND my_company_id=p_company;
  SELECT c.full_name INTO editor FROM public.sales_partner_profiles p JOIN public.contacts c ON c.id=p.contact_id
    WHERE p.id=b.updated_by_partner_id;
  RETURN jsonb_build_object('branding',public.seller_offer_visual_identity(COALESCE(b.branding,'{}'::jsonb)),
    'revision',COALESCE(b.revision,0),'updated_at',b.updated_at,'updated_by',editor);
END; $$;

CREATE OR REPLACE FUNCTION public.save_seller_organization_branding(
  p_organization uuid,p_company uuid,p_branding jsonb,p_expected_revision integer
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE b public.organization_offer_branding%ROWTYPE; visual jsonb; asset text; old_assets text[]; partner uuid:=public.current_sales_partner_id();
BEGIN
  IF NOT public.seller_can_edit_organization_branding(p_organization,p_company) THEN
    RAISE EXCEPTION 'Brak dostępu do edycji brandingu tej organizacji i marki.' USING ERRCODE='42501';
  END IF;
  IF p_expected_revision IS NULL OR p_expected_revision < 0 THEN
    RAISE EXCEPTION 'Wczytaj aktualny branding przed zapisem.' USING ERRCODE='22023';
  END IF;
  -- Serialize first-time creation too; row locking alone cannot lock an absent row.
  PERFORM pg_advisory_xact_lock(hashtextextended('organization-branding:'||p_organization::text||':'||p_company::text,0));
  SELECT * INTO b FROM public.organization_offer_branding
    WHERE organization_id=p_organization AND my_company_id=p_company FOR UPDATE;
  IF COALESCE(b.revision,0) <> p_expected_revision THEN
    RAISE EXCEPTION 'Inny sprzedawca zmienił branding. Wczytaj aktualną wersję i ponownie wprowadź swoje zmiany. Niczego nie nadpisano.' USING ERRCODE='40001';
  END IF;
  visual:=public.seller_offer_visual_identity(p_branding);
  PERFORM public.validate_seller_identity_assets(visual,partner,p_company,p_organization,b.source_partner_id);
  -- Legacy shared files can stay, but knowing the original owner's path must not
  -- grant access to that seller's other private files (e.g. their portrait).
  SELECT COALESCE(array_agg(path),'{}'::text[]) INTO old_assets FROM (
    SELECT value AS path FROM jsonb_each_text(COALESCE(b.branding,'{}'::jsonb))
      WHERE key=ANY(ARRAY['hotel_logo_url','hotel_cover_image_url','brandbook_url','heading_font_path'])
    UNION ALL SELECT value FROM jsonb_array_elements_text(COALESCE(b.branding->'venue_image_urls','[]'::jsonb))
    UNION ALL SELECT value->>'path' FROM jsonb_array_elements(COALESCE(b.branding->'heading_font_uploads','[]'::jsonb))
  ) assets;
  FOR asset IN
    SELECT value FROM jsonb_each_text(visual) WHERE key=ANY(ARRAY['hotel_logo_url','hotel_cover_image_url','brandbook_url','heading_font_path'])
    UNION ALL SELECT value FROM jsonb_array_elements_text(visual->'venue_image_urls')
    UNION ALL SELECT value->>'path' FROM jsonb_array_elements(visual->'heading_font_uploads')
  LOOP
    IF COALESCE(asset,'')='' THEN CONTINUE; END IF;
    IF NOT starts_with(asset,'organizations/'||p_organization::text||'/'||p_company::text||'/')
      AND NOT COALESCE(asset=ANY(old_assets),false) THEN
      RAISE EXCEPTION 'Nowy plik wgraj do brandingu tej organizacji. Nie można użyć prywatnego pliku innego sprzedawcy.' USING ERRCODE='42501';
    END IF;
    IF NOT COALESCE(asset=ANY(old_assets),false) AND NOT EXISTS (
      SELECT 1 FROM storage.objects WHERE bucket_id='seller-brand-assets' AND name=asset
    ) THEN RAISE EXCEPTION 'Nie znaleziono wgranego pliku. Wybierz go ponownie przed zapisem.'; END IF;
  END LOOP;
  IF b.organization_id IS NULL OR visual IS DISTINCT FROM public.seller_offer_visual_identity(b.branding) THEN
    INSERT INTO public.organization_offer_branding(organization_id,my_company_id,branding,revision,updated_at,updated_by_partner_id)
    VALUES(p_organization,p_company,visual,1,clock_timestamp(),partner)
    ON CONFLICT(organization_id,my_company_id) DO UPDATE SET branding=EXCLUDED.branding,
      revision=public.organization_offer_branding.revision+1,updated_at=EXCLUDED.updated_at,updated_by_partner_id=partner;
  END IF;
  -- No offers, saved PDFs, commissions, personal cards or default organizations are updated.
  RETURN public.get_seller_organization_branding(p_organization,p_company);
END; $$;

-- Keep old clients from bypassing portal ownership through the CRM RPC.
CREATE OR REPLACE FUNCTION public.save_crm_offer_branding(p_company uuid,p_branding jsonb,p_partner uuid DEFAULT NULL,p_organization uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'Branding i wizytówkę edytuje sprzedawca w swoim portalu. CRM udostępnia wyłącznie podgląd.' USING ERRCODE='42501';
END; $$;
REVOKE ALL ON FUNCTION public.save_seller_portal_branding(jsonb) FROM PUBLIC,anon,authenticated;

-- CRM can preview every currently affiliated organization, not just the legacy
-- primary employer; its existing brand access checks remain in place.
CREATE OR REPLACE FUNCTION public.get_crm_offer_branding(p_partner uuid DEFAULT NULL,p_organization uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_org uuid:=p_organization; rows jsonb; organizations jsonb:='[]'::jsonb;
BEGIN
  IF public.current_session_is_seller_portal() THEN RAISE EXCEPTION 'Brak dostępu do ustawień CRM' USING ERRCODE='42501'; END IF;
  IF p_partner IS NOT NULL THEN
    IF NOT EXISTS(SELECT 1 FROM public.sales_partner_profiles WHERE id=p_partner) THEN RAISE EXCEPTION 'Nie znaleziono sprzedawcy'; END IF;
    IF p_organization IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.seller_partner_organization_ids(p_partner) h WHERE h.organization_id=p_organization) THEN
      RAISE EXCEPTION 'Organizacja nie jest aktualnie przypisana do sprzedawcy' USING ERRCODE='42501';
    END IF;
    SELECT COALESCE(jsonb_agg(jsonb_build_object('id',o.id,'name',COALESCE(NULLIF(o.alias,''),o.name))
      ORDER BY COALESCE(NULLIF(o.alias,''),o.name),o.id),'[]'::jsonb) INTO organizations
      FROM public.seller_partner_organization_ids(p_partner) h JOIN public.organizations o ON o.id=h.organization_id;
    v_org:=COALESCE(p_organization,public.seller_default_offer_organization(p_partner),(organizations->0->>'id')::uuid);
  ELSIF NOT EXISTS(SELECT 1 FROM public.organizations WHERE id=v_org) THEN RAISE EXCEPTION 'Nie znaleziono organizacji'; END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'can_manage',false,
    'branding',CASE WHEN p_partner IS NOT NULL THEN public.resolve_seller_offer_branding_for_organization(p_partner,c.id,v_org)
      ELSE public.seller_offer_visual_identity(COALESCE(b.branding,'{}'::jsonb)) END)
    ORDER BY c.name),'[]'::jsonb) INTO rows
    FROM public.my_companies c LEFT JOIN public.organization_offer_branding b ON b.organization_id=v_org AND b.my_company_id=c.id
    WHERE c.is_active AND public.seller_workspace_staff_access(c.id)
      AND (p_partner IS NULL OR EXISTS(SELECT 1 FROM public.sales_partner_brand_terms t WHERE t.sales_partner_id=p_partner AND t.my_company_id=c.id));
  IF jsonb_array_length(rows)=0 THEN RAISE EXCEPTION 'Brak uprawnień do brandingu w przypisanych markach' USING ERRCODE='42501'; END IF;
  RETURN jsonb_build_object('organization_id',v_org,'organization_name',(SELECT COALESCE(NULLIF(alias,''),name) FROM public.organizations WHERE id=v_org),
    'organizations',organizations,'brands',rows);
END; $$;

CREATE OR REPLACE FUNCTION public.seller_brand_asset_access(p_name text,p_write boolean DEFAULT false)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT auth.uid() IS NOT NULL AND p_name !~ '(^|/)[.][.]?(/|$)' AND (
    EXISTS(SELECT 1 FROM public.my_companies c JOIN public.organizations o ON o.id::text=split_part(p_name,'/',2)
      WHERE split_part(p_name,'/',1)='organizations' AND c.id::text=split_part(p_name,'/',3)
        AND ((NOT p_write AND public.seller_workspace_staff_access(c.id))
          OR public.seller_can_edit_organization_branding(o.id,c.id)))
    OR EXISTS(SELECT 1 FROM public.sales_partner_profiles p JOIN public.sales_partner_brand_terms t ON t.sales_partner_id=p.id
      JOIN public.my_companies c ON c.id=t.my_company_id
      WHERE p.id::text=split_part(p_name,'/',1) AND t.my_company_id::text=split_part(p_name,'/',2)
        AND ((NOT p_write AND public.seller_workspace_staff_access(t.my_company_id))
          OR (p.id=public.current_sales_partner_id() AND p.portal_enabled AND p.status='active' AND t.is_active AND c.is_active
            AND (NOT p_write OR split_part(p_name,'/',3) LIKE 'portrait-%'
              OR NOT EXISTS(SELECT 1 FROM public.seller_partner_organization_ids(p.id))))))
    OR (NOT p_write AND EXISTS(SELECT 1 FROM public.organization_offer_branding b
      WHERE b.source_partner_id::text=split_part(p_name,'/',1) AND b.my_company_id::text=split_part(p_name,'/',2)
        AND (p_name IN(b.branding->>'hotel_logo_url',b.branding->>'hotel_cover_image_url',b.branding->>'brandbook_url',b.branding->>'heading_font_path')
          OR COALESCE(b.branding->'venue_image_urls','[]'::jsonb) ? p_name
          OR EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(b.branding->'heading_font_uploads','[]'::jsonb)) f WHERE f->>'path'=p_name))
        AND (public.seller_workspace_staff_access(b.my_company_id)
          OR public.seller_can_edit_organization_branding(b.organization_id,b.my_company_id))))
  );
$$;

REVOKE ALL ON FUNCTION public.seller_can_edit_organization_branding(uuid,uuid),
  public.get_seller_organization_branding(uuid,uuid),public.save_seller_organization_branding(uuid,uuid,jsonb,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.seller_can_edit_organization_branding(uuid,uuid),
  public.get_seller_organization_branding(uuid,uuid),public.save_seller_organization_branding(uuid,uuid,jsonb,integer) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
