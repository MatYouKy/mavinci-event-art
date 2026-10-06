BEGIN;

ALTER TABLE public.sales_partner_profiles ADD COLUMN IF NOT EXISTS default_offer_organization_id uuid
  REFERENCES public.organizations(id) ON DELETE SET NULL;

-- Membership is read from current contact relationships. A legacy primary
-- organization is a fallback only if there is no relationship row (including
-- an explicitly ended one). This helper is never exposed as a public RPC.
CREATE OR REPLACE FUNCTION public.seller_partner_organization_ids(p_partner uuid)
RETURNS TABLE(organization_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT org.id FROM public.sales_partner_profiles p JOIN public.organizations org ON (
    EXISTS(SELECT 1 FROM public.contact_organizations r WHERE r.contact_id=p.contact_id
      AND r.organization_id=org.id AND r.is_current)
    OR (org.id=p.organization_id AND NOT EXISTS(SELECT 1 FROM public.contact_organizations r
      WHERE r.contact_id=p.contact_id AND r.organization_id=org.id))
  ) WHERE p.id=p_partner;
$$;

CREATE OR REPLACE FUNCTION public.seller_default_offer_organization(p_partner uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT CASE WHEN count(*)=1 THEN (array_agg(h.organization_id))[1]
    ELSE (array_agg(h.organization_id) FILTER(WHERE h.organization_id=p.default_offer_organization_id))[1] END
  FROM public.sales_partner_profiles p
  JOIN public.seller_partner_organization_ids(p_partner) h ON true WHERE p.id=p_partner;
$$;

CREATE OR REPLACE FUNCTION public.save_seller_default_offer_organization(p_organization uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_partner uuid:=public.current_sales_partner_id();
BEGIN
  PERFORM 1 FROM public.sales_partner_profiles WHERE id=v_partner AND status='active' AND portal_enabled FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Brak dostępu do portalu sprzedawcy' USING ERRCODE='42501'; END IF;
  IF p_organization IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM public.seller_partner_organization_ids(v_partner) h WHERE h.organization_id=p_organization
  ) THEN RAISE EXCEPTION 'Organizacja nie jest aktualnie powiązana ze sprzedawcą' USING ERRCODE='42501'; END IF;
  UPDATE public.sales_partner_profiles SET default_offer_organization_id=p_organization WHERE id=v_partner;
  -- Deliberately do not modify the primary employer, any offer or shared branding.
  RETURN public.seller_default_offer_organization(v_partner);
END; $$;

CREATE OR REPLACE FUNCTION public.resolve_seller_offer_branding_for_organization(p_partner uuid,p_company uuid,p_organization uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE p record; b jsonb; v jsonb; shared public.organization_offer_branding%ROWTYPE;
BEGIN
  SELECT s.*,c.full_name,c.email,c.mobile,c.phone,c.avatar_url,
    o.name AS organization_name,o.alias,o.website,o.address,o.city,
    (SELECT r.position FROM public.contact_organizations r WHERE r.contact_id=s.contact_id
      AND r.organization_id=p_organization AND r.is_current LIMIT 1) AS position
  INTO p FROM public.sales_partner_profiles s LEFT JOIN public.contacts c ON c.id=s.contact_id
  LEFT JOIN public.organizations o ON o.id=p_organization WHERE s.id=p_partner;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT to_jsonb(x) INTO b FROM public.sales_partner_branding_profiles x WHERE sales_partner_id=p_partner AND my_company_id=p_company;
  b:=COALESCE(b,'{}'::jsonb);
  IF p_organization IS NOT NULL THEN
    SELECT * INTO shared FROM public.organization_offer_branding WHERE organization_id=p_organization AND my_company_id=p_company;
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
    'branding_source',CASE WHEN p_organization IS NULL THEN 'seller' ELSE 'organization' END,
    'organization_id',p_organization,'organization_name',COALESCE(NULLIF(p.alias,''),p.organization_name),
    'organization_website',p.website,'organization_address',concat_ws(', ',p.address,p.city),
    'organization_asset_partner_id',shared.source_partner_id,
    'organization_branding_configured',CASE WHEN p_organization IS NOT NULL THEN shared.organization_id IS NOT NULL ELSE true END);
END; $$;

CREATE OR REPLACE FUNCTION public.get_seller_portal_context()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT jsonb_build_object(
    'default_offer_organization_id',public.seller_default_offer_organization(p.id),
    'organizations',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',org.id,
      'name',COALESCE(NULLIF(org.alias,''),org.name),'business_type',org.business_type)
      ORDER BY COALESCE(NULLIF(org.alias,''),org.name),org.id)
      FROM public.seller_partner_organization_ids(p.id) h JOIN public.organizations org ON org.id=h.organization_id),'[]'::jsonb),
    'profile',jsonb_build_object('id',p.id,'partner_type',p.partner_type,'organization_id',p.organization_id,
      'person',jsonb_build_object('name',c.full_name,'email',c.email,'phone',COALESCE(c.mobile,c.phone),'photo_url',c.avatar_url,
        'position',(SELECT r.position FROM public.contact_organizations r WHERE r.contact_id=p.contact_id AND r.organization_id=p.organization_id AND r.is_current LIMIT 1)),
      'organization',jsonb_build_object('id',o.id,'name',o.name,'alias',o.alias,'email',o.email,'phone',o.phone,'website',o.website,'address',o.address,'city',o.city)),
    'brands',COALESCE((SELECT jsonb_agg(jsonb_build_object('my_company_id',t.my_company_id,'name',b.name,'legal_name',b.legal_name,'logo_url',b.logo_url,
      'commission_enabled',t.commission_enabled,'default_commission_rate',CASE WHEN t.commission_enabled THEN t.default_commission_rate ELSE 0 END,
      'default_payment_method',CASE WHEN t.commission_enabled THEN t.default_payment_method END,
      'branding',public.resolve_seller_offer_branding_for_organization(p.id,t.my_company_id,public.seller_default_offer_organization(p.id))) ORDER BY b.name)
      FROM public.sales_partner_brand_terms t JOIN public.my_companies b ON b.id=t.my_company_id
      WHERE t.sales_partner_id=p.id AND t.is_active AND b.is_active),'[]'::jsonb))
  FROM public.sales_partner_profiles p JOIN public.contacts c ON c.id=p.contact_id
  LEFT JOIN public.organizations o ON o.id=p.organization_id
  WHERE p.id=public.current_sales_partner_id() AND p.portal_enabled AND p.status='active';
$$;

-- Shared visual settings stay CRM-owned even when the primary employer is NULL
-- and affiliations exist solely in contact_organizations.
CREATE OR REPLACE FUNCTION public.save_seller_portal_settings(p_branding jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE p uuid:=public.current_sales_partner_id(); c uuid:=NULLIF(p_branding->>'my_company_id','')::uuid;
  has_org boolean; v jsonb; previous jsonb; payload jsonb; result uuid; portrait text:=NULLIF(btrim(p_branding->>'portrait_url'),'');
BEGIN
  PERFORM 1 FROM public.sales_partner_profiles WHERE id=p AND portal_enabled AND status='active' FOR UPDATE;
  IF NOT FOUND OR c IS NULL THEN RAISE EXCEPTION 'Brak dostępu do portalu lub marki'; END IF;
  SELECT EXISTS(SELECT 1 FROM public.seller_partner_organization_ids(p)) INTO has_org;
  SELECT to_jsonb(b) INTO previous FROM public.sales_partner_branding_profiles b WHERE sales_partner_id=p AND my_company_id=c;
  IF portrait IS NOT NULL AND portrait=(SELECT x.avatar_url FROM public.contacts x JOIN public.sales_partner_profiles s ON s.contact_id=x.id WHERE s.id=p) THEN portrait:=NULL; END IF;
  IF portrait IS NOT NULL AND (NOT starts_with(portrait,p::text||'/'||c::text||'/') OR portrait ~ '(^|/)[.][.]?(/|$)') THEN RAISE EXCEPTION 'Zdjęcie nie należy do sprzedawcy i marki'; END IF;
  payload:=p_branding||jsonb_build_object('portrait_url',portrait);
  IF NOT has_org THEN
    v:=public.seller_offer_visual_identity(p_branding);
    PERFORM public.validate_seller_identity_assets(v,p,c);
  ELSE
    payload:=payload||public.seller_offer_visual_identity(COALESCE(previous,'{}'::jsonb));
  END IF;
  result:=public.save_seller_portal_branding(payload);
  IF NOT has_org THEN UPDATE public.sales_partner_branding_profiles SET offer_identity=v WHERE id=result; END IF;
  RETURN result;
END; $$;

CREATE OR REPLACE FUNCTION public.seller_offer_organization_for_save(p_partner uuid,p_id uuid,p_values jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_org uuid; v_old_org uuid;
BEGIN
  IF p_partner IS DISTINCT FROM public.current_sales_partner_id() OR p_partner IS NULL THEN
    RAISE EXCEPTION 'Brak dostępu do sprzedawcy' USING ERRCODE='42501';
  END IF;
  IF p_id IS NOT NULL THEN
    SELECT partner_organization_id INTO v_old_org FROM public.offers
      WHERE id=p_id AND sales_channel='seller_portal' AND sales_partner_id=p_partner FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Brak dostępu do oferty' USING ERRCODE='42501'; END IF;
  END IF;
  IF p_values ? 'organization_id' THEN v_org:=NULLIF(p_values->>'organization_id','')::uuid;
  ELSIF p_id IS NOT NULL THEN v_org:=v_old_org;
  ELSE v_org:=public.seller_default_offer_organization(p_partner); END IF;
  IF v_org IS NULL AND EXISTS(SELECT 1 FROM public.seller_partner_organization_ids(p_partner)) THEN
    RAISE EXCEPTION 'Wybierz organizację, w imieniu której tworzysz ofertę. Domyślną organizację ustawisz w Ustawieniach.';
  END IF;
  IF v_org IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.seller_partner_organization_ids(p_partner) h WHERE h.organization_id=v_org) THEN
    RAISE EXCEPTION 'Wybrana organizacja nie jest już przypisana do sprzedawcy. Wybierz aktualną organizację.';
  END IF;
  IF p_id IS NOT NULL AND v_old_org IS DISTINCT FROM v_org AND EXISTS(
    SELECT 1 FROM public.seller_offer_arrangements a WHERE a.offer_id=p_id
      AND (a.venue_snapshot IS NOT NULL OR NULLIF(btrim(a.room),'') IS NOT NULL OR jsonb_array_length(a.contacts)>0)
  ) THEN
    RAISE EXCEPTION 'Najpierw usuń salę i kontakty organizacyjne z ustaleń oferty. Po zmianie organizacji wybierz dane nowego obiektu.';
  END IF;
  RETURN v_org;
END; $$;

CREATE OR REPLACE FUNCTION public.snapshot_seller_offer_identity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE f public.company_brandbook_fonts%ROWTYPE;
BEGIN
  IF NEW.sales_channel='seller_portal' AND NEW.sales_partner_id IS NOT NULL THEN
    IF TG_OP='INSERT' OR NEW.partner_organization_id IS DISTINCT FROM OLD.partner_organization_id
      OR NEW.sales_partner_id IS DISTINCT FROM OLD.sales_partner_id THEN
      IF NEW.partner_organization_id IS NOT NULL AND NOT EXISTS(
        SELECT 1 FROM public.seller_partner_organization_ids(NEW.sales_partner_id) h WHERE h.organization_id=NEW.partner_organization_id
      ) THEN RAISE EXCEPTION 'Organizacja nie jest przypisana do sprzedawcy'; END IF;
    END IF;
    -- Never take the current preference/primary employer when regenerating an
    -- existing offer. Its organization is stored on the offer itself.
    NEW.partner_branding_snapshot:=public.resolve_seller_offer_branding_for_organization(
      NEW.sales_partner_id,NEW.my_company_id,NEW.partner_organization_id);
    IF NULLIF(NEW.partner_branding_snapshot->>'heading_font_catalog_id','') IS NOT NULL THEN
      SELECT * INTO f FROM public.company_brandbook_fonts
        WHERE id::text=NEW.partner_branding_snapshot->>'heading_font_catalog_id' AND company_id=NEW.my_company_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'Wybrana czcionka nie jest już dostępna w bibliotece tej marki. Wybierz inną w brandingu oferty.'; END IF;
      NEW.partner_branding_snapshot:=NEW.partner_branding_snapshot||jsonb_build_object('heading_font_family',f.family,
        'heading_font_catalog_snapshot',jsonb_build_object('id',f.id,'company_id',f.company_id,'family',f.family,
          'weight',f.weight,'storage_path',f.storage_path,'file_url',f.file_url));
    END IF;
  END IF;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public.refresh_seller_offer_identity(p_offer uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE o public.offers%ROWTYPE; v_staff boolean;
BEGIN
  SELECT * INTO o FROM public.offers WHERE id=p_offer AND sales_channel='seller_portal' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Nie znaleziono oferty sprzedawcy'; END IF;
  v_staff:=COALESCE(public.seller_offer_can_manage(p_offer),false);
  IF NOT v_staff AND NOT COALESCE(o.sales_partner_id=public.current_sales_partner_id()
    AND EXISTS(SELECT 1 FROM public.sales_partner_brand_terms t
      WHERE t.sales_partner_id=o.sales_partner_id AND t.my_company_id=o.my_company_id AND t.is_active),false) THEN
    RAISE EXCEPTION 'Brak uprawnień do przygotowania brandingu tej oferty'; END IF;
  IF NOT v_staff AND o.partner_organization_id IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM public.seller_partner_organization_ids(o.sales_partner_id) h WHERE h.organization_id=o.partner_organization_id
  ) THEN RAISE EXCEPTION 'Organizacja oferty nie jest już przypisana. Pobierz zapisaną wersję PDF lub skontaktuj się z opiekunem.'; END IF;
  UPDATE public.offers SET partner_branding_snapshot=public.resolve_seller_offer_branding_for_organization(
    o.sales_partner_id,o.my_company_id,o.partner_organization_id) WHERE id=p_offer;
END; $$;

CREATE OR REPLACE FUNCTION public.save_seller_portal_offer(p_offer jsonb, p_items jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_partner_id uuid := public.current_sales_partner_id();
  v_offer_id uuid := NULLIF(p_offer ->> 'id', '')::uuid;
  v_company_id uuid := NULLIF(p_offer ->> 'my_company_id', '')::uuid;
  v_branding_id uuid := NULLIF(p_offer ->> 'branding_profile_id', '')::uuid;
  v_model text := COALESCE(NULLIF(p_offer ->> 'commercial_model', ''), 'markup');
  v_commission_rate numeric := GREATEST(COALESCE(NULLIF(p_offer ->> 'commission_rate', '')::numeric, 0), 0);
  v_default_commission numeric := 0;
  v_commission_enabled boolean := false;
  v_base_total numeric := 0;
  v_client_total numeric := 0;
  v_earnings numeric := 0;
  v_requires_approval boolean := false;
  v_item jsonb;
  v_product_id uuid;
  v_product_name text;
  v_product_description text;
  v_product_unit text;
  v_product_base numeric;
  v_product_image text;
  v_variant_id uuid;
  v_variant_name text;
  v_variant_description text;
  v_variant_price numeric;
  v_variant_image text;
  v_base_unit numeric;
  v_client_unit numeric;
  v_quantity integer;
  v_name text;
  v_description text;
  v_is_custom boolean;
  v_activity text;
  v_branding_snapshot jsonb := '{}'::jsonb;
  v_organization_id uuid;
BEGIN
  IF v_partner_id IS NULL THEN RAISE EXCEPTION 'Brak dostepu do portalu sprzedawcy'; END IF;
  v_organization_id := public.seller_offer_organization_for_save(v_partner_id,v_offer_id,p_offer);
  IF v_model NOT IN ('markup', 'commission') THEN RAISE EXCEPTION 'Nieprawidlowy model handlowy'; END IF;
  IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Oferta musi zawierac co najmniej jedna pozycje';
  END IF;

  SELECT term.default_commission_rate, term.commission_enabled INTO v_default_commission, v_commission_enabled
  FROM public.sales_partner_brand_terms term
  WHERE term.sales_partner_id = v_partner_id
    AND term.my_company_id = v_company_id
    AND term.is_active = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'Marka nie jest przypisana do sprzedawcy'; END IF;
  -- New offers use saved settings; editing does not silently adopt new defaults.
  IF v_offer_id IS NULL THEN
    SELECT branding.default_commercial_model INTO v_model
    FROM public.sales_partner_branding_profiles branding
    WHERE branding.sales_partner_id = v_partner_id AND branding.my_company_id = v_company_id;
  ELSE
    SELECT existing.commercial_model INTO v_model FROM public.offers existing
    WHERE existing.id = v_offer_id AND existing.sales_partner_id = v_partner_id
      AND existing.sales_channel = 'seller_portal';
    IF NOT FOUND THEN RAISE EXCEPTION 'Oferta nie istnieje albo nie można jej edytować'; END IF;
  END IF;
  v_model := COALESCE(v_model, 'markup');
  IF NOT COALESCE(v_commission_enabled, false) THEN v_model := 'markup'; END IF;
  -- The seller cannot enable commissions or supply a different rate in the request.
  v_commission_rate := CASE WHEN v_model = 'commission' THEN v_default_commission ELSE 0 END;

  IF v_branding_id IS NOT NULL THEN
    SELECT to_jsonb(branding) INTO v_branding_snapshot
    FROM public.sales_partner_branding_profiles branding
    WHERE branding.id = v_branding_id
      AND branding.sales_partner_id = v_partner_id
      AND branding.my_company_id = v_company_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Nieprawidlowy profil identyfikacji hotelu'; END IF;
  END IF;

  IF v_offer_id IS NULL THEN
    INSERT INTO public.offers (
      sales_channel, sales_partner_id, partner_organization_id, my_company_id,
      commercial_model, partner_branding_profile_id, partner_branding_snapshot,
      title, description, event_date, event_location, valid_until, status,
      portal_client_name, portal_client_company, portal_client_email, portal_client_phone,
      partner_commission_rate, partner_last_activity_at
    )
    SELECT
      'seller_portal', v_partner_id, v_organization_id, v_company_id,
      v_model, v_branding_id, v_branding_snapshot,
      COALESCE(NULLIF(btrim(p_offer ->> 'title'), ''), 'Oferta wydarzenia'),
      NULLIF(btrim(p_offer ->> 'description'), ''),
      NULLIF(p_offer ->> 'event_date', '')::timestamptz,
      NULLIF(btrim(p_offer ->> 'event_location'), ''),
      NULLIF(p_offer ->> 'valid_until', '')::timestamptz,
      'draft',
      NULLIF(btrim(p_offer ->> 'client_name'), ''),
      NULLIF(btrim(p_offer ->> 'client_company'), ''),
      NULLIF(btrim(p_offer ->> 'client_email'), ''),
      NULLIF(btrim(p_offer ->> 'client_phone'), ''),
      v_commission_rate, now()
    FROM public.sales_partner_profiles profile WHERE profile.id = v_partner_id
    RETURNING id INTO v_offer_id;
    v_activity := 'draft_created';
  ELSE
    IF NOT EXISTS (
      SELECT 1 FROM public.offers offer_row
      WHERE offer_row.id = v_offer_id
        AND offer_row.sales_channel = 'seller_portal'
        AND offer_row.sales_partner_id = v_partner_id
        AND offer_row.status IN ('draft', 'sent')
    ) THEN RAISE EXCEPTION 'Oferta nie istnieje albo nie mozna jej edytowac'; END IF;

    UPDATE public.offers SET
      my_company_id = v_company_id,
      partner_organization_id = v_organization_id,
      commercial_model = v_model,
      partner_branding_profile_id = v_branding_id,
      partner_branding_snapshot = v_branding_snapshot,
      title = COALESCE(NULLIF(btrim(p_offer ->> 'title'), ''), 'Oferta wydarzenia'),
      description = NULLIF(btrim(p_offer ->> 'description'), ''),
      event_date = NULLIF(p_offer ->> 'event_date', '')::timestamptz,
      event_location = NULLIF(btrim(p_offer ->> 'event_location'), ''),
      valid_until = NULLIF(p_offer ->> 'valid_until', '')::timestamptz,
      portal_client_name = NULLIF(btrim(p_offer ->> 'client_name'), ''),
      portal_client_company = NULLIF(btrim(p_offer ->> 'client_company'), ''),
      portal_client_email = NULLIF(btrim(p_offer ->> 'client_email'), ''),
      portal_client_phone = NULLIF(btrim(p_offer ->> 'client_phone'), ''),
      partner_commission_rate = v_commission_rate,
      status = 'draft',
      sent_at = NULL,
      viewed_at = NULL,
      partner_last_activity_at = now()
    WHERE id = v_offer_id;
    DELETE FROM public.offer_items WHERE offer_id = v_offer_id;
    v_activity := 'draft_updated';
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    v_product_id := NULL;
    v_product_name := NULL;
    v_product_description := NULL;
    v_product_unit := NULL;
    v_product_base := 0;
    v_product_image := NULL;
    v_variant_id := NULL;
    v_variant_name := NULL;
    v_variant_description := NULL;
    v_variant_price := NULL;
    v_variant_image := NULL;
    v_quantity := GREATEST(COALESCE(NULLIF(v_item ->> 'quantity', '')::integer, 1), 1);
    v_is_custom := COALESCE((v_item ->> 'is_custom')::boolean, false)
      OR NULLIF(v_item ->> 'product_id', '') IS NULL;

    IF v_is_custom THEN
      v_base_unit := 0;
      v_client_unit := GREATEST(COALESCE(NULLIF(v_item ->> 'client_unit_price', '')::numeric, 0), 0);
      v_name := COALESCE(NULLIF(btrim(v_item ->> 'name'), ''), 'Pozycja niestandardowa');
      v_description := NULLIF(btrim(v_item ->> 'description'), '');
      v_requires_approval := true;
    ELSE
      SELECT product.id, product.name,
             COALESCE(product.offer_description, product.description),
             product.unit, product.base_price, product.offer_image_path
      INTO v_product_id, v_product_name, v_product_description, v_product_unit, v_product_base, v_product_image
      FROM public.offer_products product
      WHERE product.id = (v_item ->> 'product_id')::uuid
        AND product.is_active = true
        AND product.partner_portal_visible = true;
      IF NOT FOUND THEN RAISE EXCEPTION 'Produkt nie jest dostepny w portalu'; END IF;

      IF NULLIF(v_item ->> 'product_variant_id', '') IS NOT NULL THEN
        SELECT variant.id, variant.name, COALESCE(variant.description, variant.short_description), variant.price_net, variant.offer_image_path
        INTO v_variant_id, v_variant_name, v_variant_description, v_variant_price, v_variant_image
        FROM public.offer_product_variants variant
        WHERE variant.id = (v_item ->> 'product_variant_id')::uuid
          AND variant.product_id = v_product_id
          AND variant.is_active = true
          AND variant.partner_portal_visible = true;
        IF NOT FOUND THEN RAISE EXCEPTION 'Wariant nie jest dostepny w portalu'; END IF;
      END IF;

      v_base_unit := COALESCE(v_variant_price, v_product_base, 0);
      v_client_unit := CASE
        WHEN v_model = 'commission' THEN v_base_unit
        ELSE GREATEST(COALESCE(NULLIF(v_item ->> 'client_unit_price', '')::numeric, v_base_unit), 0)
      END;
      v_name := COALESCE(v_variant_name, v_product_name);
      v_description := COALESCE(v_variant_description, v_product_description);
      IF v_client_unit < v_base_unit THEN v_requires_approval := true; END IF;
    END IF;

    v_base_total := v_base_total + (v_base_unit * v_quantity);
    v_client_total := v_client_total + (v_client_unit * v_quantity);

    INSERT INTO public.offer_items (
      offer_id, product_id, product_variant_id, name, description, quantity, unit,
      unit_price, unit_cost, discount_percent, discount_amount, transport_cost,
      logistics_cost, display_order, base_partner_unit_price, client_unit_price,
      partner_margin_amount, is_partner_custom, requires_internal_approval,
      partner_source_snapshot
    ) VALUES (
      v_offer_id, v_product_id, v_variant_id, v_name, v_description, v_quantity,
      COALESCE(NULLIF(v_item ->> 'unit', ''), v_product_unit, 'szt.'),
      v_client_unit, v_base_unit, 0, 0, 0, 0,
      COALESCE(NULLIF(v_item ->> 'display_order', '')::integer, 0),
      v_base_unit, v_client_unit, (v_client_unit - v_base_unit) * v_quantity,
      v_is_custom, v_is_custom OR v_client_unit < v_base_unit,
      jsonb_build_object(
        'product_id', v_product_id,
        'product_name', v_product_name,
        'variant_id', v_variant_id,
        'variant_name', v_variant_name,
        'image_path', COALESCE(v_variant_image, v_product_image),
        'catalog_base_net', v_base_unit,
        'captured_at', now()
      )
    );
  END LOOP;

  v_earnings := CASE
    WHEN v_model = 'commission' THEN round(v_client_total * v_commission_rate / 100, 2)
    ELSE v_client_total - v_base_total
  END;

  UPDATE public.offers SET
    partner_base_net = v_base_total,
    client_total_net = v_client_total,
    partner_earnings_amount = v_earnings,
    partner_commission_amount = CASE WHEN v_model = 'commission' THEN v_earnings ELSE 0 END,
    total_base_price = v_base_total,
    subtotal = v_client_total,
    tax_percent = 23,
    tax_amount = round(v_client_total * 0.23, 2),
    total_amount = round(v_client_total * 1.23, 2),
    total_final_price = round(v_client_total * 1.23, 2),
    requires_internal_approval = v_requires_approval,
    partner_approval_status = CASE WHEN v_requires_approval THEN 'required' ELSE 'not_required' END,
    partner_last_activity_at = now()
  WHERE id = v_offer_id;

  INSERT INTO public.partner_offer_activities(offer_id, sales_partner_id, activity_type, metadata)
  VALUES (v_offer_id, v_partner_id, v_activity, jsonb_build_object(
    'commercial_model', v_model,
    'base_net', v_base_total,
    'client_net', v_client_total,
    'partner_earnings', v_earnings,
    'requires_approval', v_requires_approval
  ));

  RETURN v_offer_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_seller_hotel_context(p_offer uuid DEFAULT NULL,p_organization uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  v_org uuid:=p_organization;
  v_partner uuid;
  v_offer_org uuid;
  v_hotels jsonb:='[]'::jsonb;
  v_result jsonb;
  v_portal boolean:=COALESCE(public.current_session_is_seller_portal(),false);
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Zaloguj się ponownie' USING ERRCODE='42501'; END IF;
  IF p_offer IS NOT NULL THEN
    IF NOT COALESCE(public.seller_arrangements_access(p_offer),false) THEN RAISE EXCEPTION 'Brak dostępu do oferty' USING ERRCODE='42501'; END IF;
    SELECT sales_partner_id,partner_organization_id INTO v_partner,v_offer_org FROM public.offers WHERE id=p_offer;
    IF p_organization IS NOT NULL AND p_organization IS DISTINCT FROM v_offer_org THEN
      RAISE EXCEPTION 'Wybierz organizację w edycji oferty, aby zmienić jej branding, sale i kontakty.' USING ERRCODE='42501';
    END IF;
    v_org:=v_offer_org;
    IF v_partner IS NULL THEN RAISE EXCEPTION 'Oferta nie ma przypisanego sprzedawcy' USING ERRCODE='42501'; END IF;
  ELSIF v_portal THEN
    v_partner:=public.current_sales_partner_id();
    IF NOT EXISTS(SELECT 1 FROM public.sales_partner_profiles p WHERE p.id=v_partner
      AND p.portal_enabled AND p.status='active'
      AND EXISTS(SELECT 1 FROM public.sales_partner_brand_terms t WHERE t.sales_partner_id=p.id AND t.is_active)) THEN
      RAISE EXCEPTION 'Brak dostępu do portalu sprzedawcy' USING ERRCODE='42501';
    END IF;
  END IF;

  IF v_partner IS NOT NULL THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object('id',org.id,'name',COALESCE(NULLIF(org.alias,''),org.name))
      ORDER BY COALESCE(NULLIF(org.alias,''),org.name),org.id),'[]'::jsonb)
    INTO v_hotels FROM public.seller_partner_hotel_ids(v_partner) h
      JOIN public.organizations org ON org.id=h.organization_id
      WHERE p_offer IS NULL OR org.id=v_offer_org;
    IF p_offer IS NOT NULL AND jsonb_array_length(v_hotels)=0 THEN
      RETURN jsonb_build_object('available',false,'can_edit',false,'organizations',v_hotels,'organization',NULL,'location',NULL,'contacts','[]'::jsonb);
    END IF;
    IF v_org IS NOT NULL AND NOT EXISTS(
      SELECT 1 FROM jsonb_array_elements(v_hotels) h WHERE h->>'id'=v_org::text) THEN
      RAISE EXCEPTION 'Ten hotel nie jest aktualnie powiązany ze sprzedawcą' USING ERRCODE='42501';
    END IF;
    IF v_org IS NULL AND jsonb_array_length(v_hotels)=1 THEN v_org:=(v_hotels->0->>'id')::uuid; END IF;
  ELSIF v_org IS NOT NULL THEN
    IF NOT EXISTS(SELECT 1 FROM public.organizations org WHERE org.id=v_org
      AND (org.business_type='hotel' OR EXISTS(SELECT 1 FROM public.sales_partner_profiles hp
        WHERE hp.organization_id=org.id AND hp.partner_type='hotel_employee'))) THEN
      RETURN jsonb_build_object('available',false,'can_edit',false,'organizations',v_hotels,'organization',NULL,'location',NULL,'contacts','[]'::jsonb);
    END IF;
    IF NOT COALESCE(public.seller_hotel_read_access(v_org),false) THEN
      RAISE EXCEPTION 'Brak dostępu do danych tego hotelu' USING ERRCODE='42501';
    END IF;
    SELECT jsonb_build_array(jsonb_build_object('id',org.id,'name',COALESCE(NULLIF(org.alias,''),org.name)))
      INTO v_hotels FROM public.organizations org WHERE org.id=v_org;
  END IF;

  IF v_org IS NULL THEN
    RETURN jsonb_build_object('available',jsonb_array_length(v_hotels)>0,'can_edit',false,
      'organizations',v_hotels,'organization',NULL,'location',NULL,'contacts','[]'::jsonb);
  END IF;
  -- An authorized CRM offer reader may view the hotels of that offer's seller,
  -- never an arbitrary hotel supplied in p_organization.
  IF NOT COALESCE(public.seller_hotel_read_access(v_org),false) AND NOT (p_offer IS NOT NULL AND NOT v_portal) THEN
    RAISE EXCEPTION 'Brak dostępu do danych tego hotelu' USING ERRCODE='42501';
  END IF;
  SELECT jsonb_build_object('available',true,
    'can_edit',NOT v_portal AND EXISTS(SELECT 1 FROM public.employees e
      WHERE e.id=auth.uid() AND e.is_active AND ('admin'=ANY(e.permissions) OR 'locations_manage'=ANY(e.permissions))),
    'organizations',v_hotels,
    'organization',jsonb_build_object('id',org.id,'name',COALESCE(NULLIF(org.alias,''),org.name)),
    'location',CASE WHEN l.id IS NULL THEN NULL ELSE jsonb_build_object('id',l.id,'name',l.name,
      'updated_at',l.updated_at,'rooms',l.rooms,'technical_details',l.technical_details) END,
    'contacts',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',c.id,'name',c.full_name,
      'role',COALESCE(r.position,r.department,''),'email',COALESCE(c.email,''),'phone',COALESCE(c.phone,'')) ORDER BY c.full_name,c.id)
      FROM public.contact_organizations r JOIN public.contacts c ON c.id=r.contact_id
      WHERE r.organization_id=org.id AND r.is_current AND c.status='active'),'[]'::jsonb))
  INTO v_result FROM public.organizations org LEFT JOIN public.locations l ON l.id=org.location_id WHERE org.id=v_org;
  RETURN v_result;
END; $$;


-- Explicit RPC so older deployments cannot silently discard organization_id.
CREATE OR REPLACE FUNCTION public.save_seller_portal_offer_for_organization(p_request_id uuid,p_offer jsonb,p_items jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF jsonb_typeof(p_offer) IS DISTINCT FROM 'object' OR NOT (p_offer ? 'organization_id') THEN
    RAISE EXCEPTION 'Wczytaj ponownie kreator i wybierz organizację oferty';
  END IF;
  RETURN public.save_seller_portal_offer_with_recommendations(p_request_id,p_offer,p_items);
END; $$;

-- Broaden only READ access to the current affiliations. Shared brand files
-- remain writable only by CRM. Sellers may upload their own portrait.
CREATE OR REPLACE FUNCTION public.seller_brand_asset_access(p_name text,p_write boolean DEFAULT false)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT auth.uid() IS NOT NULL AND p_name !~ '(^|/)[.][.]?(/|$)' AND (
    EXISTS(SELECT 1 FROM public.my_companies c JOIN public.organizations o ON o.id::text=split_part(p_name,'/',2)
      WHERE split_part(p_name,'/',1)='organizations' AND c.id::text=split_part(p_name,'/',3)
      AND (public.seller_workspace_staff_access(c.id,p_write) OR (NOT p_write AND EXISTS(
        SELECT 1 FROM public.sales_partner_profiles p JOIN public.sales_partner_brand_terms t ON t.sales_partner_id=p.id
        WHERE p.id=public.current_sales_partner_id() AND p.portal_enabled AND p.status='active'
          AND t.my_company_id=c.id AND t.is_active
          AND EXISTS(SELECT 1 FROM public.seller_partner_organization_ids(p.id) h WHERE h.organization_id=o.id)))))
    OR EXISTS(SELECT 1 FROM public.sales_partner_profiles p JOIN public.sales_partner_brand_terms t ON t.sales_partner_id=p.id
      WHERE p.id::text=split_part(p_name,'/',1) AND t.my_company_id::text=split_part(p_name,'/',2)
      AND (public.seller_workspace_staff_access(t.my_company_id,p_write)
        OR (p.id=public.current_sales_partner_id() AND p.portal_enabled AND p.status='active' AND t.is_active
          AND (NOT p_write OR split_part(p_name,'/',3) LIKE 'portrait-%'
            OR NOT EXISTS(SELECT 1 FROM public.seller_partner_organization_ids(p.id))))))
    OR (NOT p_write AND EXISTS(SELECT 1 FROM public.organization_offer_branding b
      WHERE b.source_partner_id::text=split_part(p_name,'/',1) AND b.my_company_id::text=split_part(p_name,'/',2)
      AND (p_name IN(b.branding->>'hotel_logo_url',b.branding->>'hotel_cover_image_url',b.branding->>'brandbook_url',b.branding->>'heading_font_path')
        OR COALESCE(b.branding->'venue_image_urls','[]'::jsonb) ? p_name
        OR EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(b.branding->'heading_font_uploads','[]'::jsonb)) f WHERE f->>'path'=p_name))
      AND (public.seller_workspace_staff_access(b.my_company_id) OR EXISTS(
        SELECT 1 FROM public.sales_partner_profiles p JOIN public.sales_partner_brand_terms t ON t.sales_partner_id=p.id
        WHERE p.id=public.current_sales_partner_id() AND p.portal_enabled AND p.status='active'
          AND t.my_company_id=b.my_company_id AND t.is_active
          AND EXISTS(SELECT 1 FROM public.seller_partner_organization_ids(p.id) h WHERE h.organization_id=b.organization_id)))))
  );
$$;

REVOKE ALL ON FUNCTION public.seller_partner_organization_ids(uuid),public.seller_default_offer_organization(uuid),
  public.seller_offer_organization_for_save(uuid,uuid,jsonb),
  public.resolve_seller_offer_branding_for_organization(uuid,uuid,uuid),
  public.snapshot_seller_offer_identity() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.save_seller_default_offer_organization(uuid),
  public.save_seller_portal_offer_for_organization(uuid,jsonb,jsonb),
  public.get_seller_portal_context(),public.save_seller_portal_settings(jsonb),
  public.save_seller_portal_offer(jsonb,jsonb),public.refresh_seller_offer_identity(uuid),
  public.get_seller_hotel_context(uuid,uuid),public.seller_brand_asset_access(text,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_seller_default_offer_organization(uuid),
  public.save_seller_portal_offer_for_organization(uuid,jsonb,jsonb),
  public.get_seller_portal_context(),public.save_seller_portal_settings(jsonb),
  public.save_seller_portal_offer(jsonb,jsonb),public.refresh_seller_offer_identity(uuid),
  public.get_seller_hotel_context(uuid,uuid),public.seller_brand_asset_access(text,boolean) TO authenticated;

NOTIFY pgrst,'reload schema';
COMMIT;

