BEGIN;
ALTER TABLE public.sales_partner_branding_profiles
  ADD COLUMN IF NOT EXISTS default_commercial_model text NOT NULL DEFAULT 'markup'
  CHECK (default_commercial_model IN ('markup', 'commission'));

-- New assignments do not opt in to commission payments automatically.
ALTER TABLE public.sales_partner_brand_terms ALTER COLUMN commission_enabled SET DEFAULT false;

CREATE OR REPLACE FUNCTION public.save_seller_portal_branding(p_branding jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_partner_id uuid := public.current_sales_partner_id();
  v_company_id uuid := NULLIF(p_branding ->> 'my_company_id', '')::uuid;
  v_branding_id uuid;
  v_model text := COALESCE(NULLIF(p_branding ->> 'default_commercial_model', ''), 'markup');
BEGIN
  IF v_partner_id IS NULL THEN
    RAISE EXCEPTION 'Brak dostepu do portalu sprzedawcy';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.sales_partner_brand_terms
    WHERE sales_partner_id = v_partner_id
      AND my_company_id = v_company_id
      AND is_active = true
  ) THEN
    RAISE EXCEPTION 'Marka nie jest przypisana do sprzedawcy';
  END IF;

  IF v_model NOT IN ('markup', 'commission') THEN
    RAISE EXCEPTION 'Nieprawidłowy sposób rozliczenia';
  END IF;
  IF v_model = 'commission' AND NOT EXISTS (
    SELECT 1 FROM public.sales_partner_brand_terms
    WHERE sales_partner_id = v_partner_id AND my_company_id = v_company_id
      AND is_active = true AND commission_enabled = true
  ) THEN
    RAISE EXCEPTION 'Wybrany sposób rozliczenia nie jest dostępny dla tej marki';
  END IF;

  INSERT INTO public.sales_partner_branding_profiles (
    sales_partner_id, my_company_id, display_name, position_title,
    contact_email, contact_phone, portrait_url, hotel_logo_url,
    hotel_cover_image_url, brandbook_url, venue_image_urls, brand_primary_color,
    brand_secondary_color, brandbook_notes, footer_text, disclosure_text, default_commercial_model
  ) VALUES (
    v_partner_id, v_company_id,
    NULLIF(btrim(p_branding ->> 'display_name'), ''),
    NULLIF(btrim(p_branding ->> 'position_title'), ''),
    NULLIF(btrim(p_branding ->> 'contact_email'), ''),
    NULLIF(btrim(p_branding ->> 'contact_phone'), ''),
    NULLIF(btrim(p_branding ->> 'portrait_url'), ''),
    NULLIF(btrim(p_branding ->> 'hotel_logo_url'), ''),
    NULLIF(btrim(p_branding ->> 'hotel_cover_image_url'), ''),
    NULLIF(btrim(p_branding ->> 'brandbook_url'), ''),
    COALESCE(
      ARRAY(
        SELECT value
        FROM jsonb_array_elements_text(COALESCE(p_branding -> 'venue_image_urls', '[]'::jsonb)) AS value
        WHERE btrim(value) <> ''
      ),
      '{}'::text[]
    ),
    COALESCE(NULLIF(p_branding ->> 'brand_primary_color', ''), '#1c1f33'),
    COALESCE(NULLIF(p_branding ->> 'brand_secondary_color', ''), '#d3bb73'),
    NULLIF(btrim(p_branding ->> 'brandbook_notes'), ''),
    NULLIF(btrim(p_branding ->> 'footer_text'), ''),
    NULLIF(btrim(p_branding ->> 'disclosure_text'), ''),
    v_model
  )
  ON CONFLICT (sales_partner_id, my_company_id) DO UPDATE SET
    display_name = EXCLUDED.display_name,
    position_title = EXCLUDED.position_title,
    contact_email = EXCLUDED.contact_email,
    contact_phone = EXCLUDED.contact_phone,
    portrait_url = EXCLUDED.portrait_url,
    hotel_logo_url = EXCLUDED.hotel_logo_url,
    hotel_cover_image_url = EXCLUDED.hotel_cover_image_url,
    brandbook_url = EXCLUDED.brandbook_url,
    venue_image_urls = EXCLUDED.venue_image_urls,
    brand_primary_color = EXCLUDED.brand_primary_color,
    brand_secondary_color = EXCLUDED.brand_secondary_color,
    brandbook_notes = EXCLUDED.brandbook_notes,
    footer_text = EXCLUDED.footer_text,
    disclosure_text = EXCLUDED.disclosure_text,
    default_commercial_model = EXCLUDED.default_commercial_model
  RETURNING id INTO v_branding_id;

  RETURN v_branding_id;
END;
$$;

REVOKE ALL ON FUNCTION public.save_seller_portal_branding(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_seller_portal_branding(jsonb) TO authenticated;

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
BEGIN
  IF v_partner_id IS NULL THEN RAISE EXCEPTION 'Brak dostepu do portalu sprzedawcy'; END IF;
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
      'seller_portal', v_partner_id, profile.organization_id, v_company_id,
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

REVOKE ALL ON FUNCTION public.save_seller_portal_offer(jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_seller_portal_offer(jsonb, jsonb) TO authenticated;

-- New entry point makes a missing migration a visible error, not a silent
-- save that discards the chosen settlement model.
CREATE OR REPLACE FUNCTION public.save_seller_portal_settings(p_branding jsonb)
RETURNS uuid LANGUAGE sql SECURITY INVOKER SET search_path = public
AS $$ SELECT public.save_seller_portal_branding(p_branding); $$;
REVOKE ALL ON FUNCTION public.save_seller_portal_settings(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_seller_portal_settings(jsonb) TO authenticated;

CREATE TABLE IF NOT EXISTS public.sales_partner_clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sales_partner_id uuid NOT NULL REFERENCES public.sales_partner_profiles(id) ON DELETE CASCADE,
  my_company_id uuid NOT NULL REFERENCES public.my_companies(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT '' CHECK (length(name) <= 300),
  company text NOT NULL DEFAULT '' CHECK (length(company) <= 300),
  email text NOT NULL DEFAULT '' CHECK (length(email) <= 320),
  phone text NOT NULL DEFAULT '' CHECK (length(phone) <= 80),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (btrim(name) <> '' OR btrim(company) <> ''),
  UNIQUE (sales_partner_id, my_company_id, name, company, email, phone)
);

ALTER TABLE public.sales_partner_clients ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sales_partner_clients FROM anon, authenticated;
GRANT SELECT ON public.sales_partner_clients TO authenticated;

CREATE POLICY "seller_clients_private_read" ON public.sales_partner_clients
  FOR SELECT TO authenticated
  USING (
    sales_partner_id = public.current_sales_partner_id()
    AND EXISTS (
      SELECT 1 FROM public.sales_partner_brand_terms term
      WHERE term.sales_partner_id = sales_partner_clients.sales_partner_id
        AND term.my_company_id = sales_partner_clients.my_company_id
        AND term.is_active = true
    )
  );

CREATE OR REPLACE FUNCTION public.search_seller_portal_clients(p_company_id uuid, p_query text DEFAULT '')
RETURNS TABLE (id uuid, name text, company text, email text, phone text)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public
AS $$
  SELECT client.id, client.name, client.company, client.email, client.phone
  FROM public.sales_partner_clients client
  WHERE client.sales_partner_id = public.current_sales_partner_id()
    AND client.my_company_id = p_company_id
    AND (COALESCE(btrim(p_query), '') = ''
      OR strpos(lower(concat_ws(' ', client.name, client.company, client.email, client.phone)), lower(btrim(p_query))) > 0)
  ORDER BY client.name, client.company, client.id
  LIMIT 30;
$$;
REVOKE ALL ON FUNCTION public.search_seller_portal_clients(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_seller_portal_clients(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.save_seller_portal_client(p_company_id uuid, p_client jsonb)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_partner uuid := public.current_sales_partner_id();
  v_id uuid;
  v_name text := COALESCE(btrim(p_client ->> 'name'), '');
  v_company text := COALESCE(btrim(p_client ->> 'company'), '');
  v_email text := lower(COALESCE(btrim(p_client ->> 'email'), ''));
  v_phone text := COALESCE(btrim(p_client ->> 'phone'), '');
BEGIN
  IF v_partner IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.sales_partner_brand_terms term
    WHERE term.sales_partner_id = v_partner AND term.my_company_id = p_company_id AND term.is_active = true
  ) THEN RAISE EXCEPTION 'Brak dostępu do bazy klientów tej marki'; END IF;
  IF v_name = '' AND v_company = '' THEN RAISE EXCEPTION 'Podaj nazwę klienta lub firmy'; END IF;
  INSERT INTO public.sales_partner_clients(sales_partner_id, my_company_id, name, company, email, phone)
  VALUES (v_partner, p_company_id, v_name, v_company, v_email, v_phone)
  ON CONFLICT (sales_partner_id, my_company_id, name, company, email, phone)
  DO UPDATE SET name = EXCLUDED.name
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.save_seller_portal_client(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_seller_portal_client(uuid, jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
