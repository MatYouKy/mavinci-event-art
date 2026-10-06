/*
  # Portal ofertowy dla pracownikow hoteli

  Portal korzysta z tych samych tabel offers, offer_items i offer_products co CRM.
  Cena katalogowa Mavinci jest zapisywana jako snapshot, a cena hotelu lub prowizja
  sa przechowywane osobno. Niestandardowe pozycje nie blokuja pracy nad szkicem,
  ale automatycznie oznaczaja oferte do wewnetrznej akceptacji.
*/

ALTER TABLE public.offer_products
  ADD COLUMN IF NOT EXISTS partner_portal_visible boolean NOT NULL DEFAULT true;

ALTER TABLE public.offer_product_variants
  ADD COLUMN IF NOT EXISTS partner_portal_visible boolean NOT NULL DEFAULT true;

ALTER TABLE public.sales_partner_profiles
  DROP CONSTRAINT IF EXISTS sales_partner_portal_is_hotel_only,
  DROP CONSTRAINT IF EXISTS sales_partner_portal_requires_contact,
  ADD CONSTRAINT sales_partner_portal_requires_contact
    CHECK (NOT portal_enabled OR contact_id IS NOT NULL) NOT VALID;

CREATE TABLE IF NOT EXISTS public.sales_partner_branding_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sales_partner_id uuid NOT NULL REFERENCES public.sales_partner_profiles(id) ON DELETE CASCADE,
  my_company_id uuid NOT NULL REFERENCES public.my_companies(id) ON DELETE CASCADE,
  display_name text,
  position_title text,
  contact_email text,
  contact_phone text,
  portrait_url text,
  hotel_logo_url text,
  hotel_cover_image_url text,
  brandbook_url text,
  venue_image_urls text[] NOT NULL DEFAULT '{}',
  brand_primary_color text NOT NULL DEFAULT '#1c1f33',
  brand_secondary_color text NOT NULL DEFAULT '#d3bb73',
  brandbook_notes text,
  footer_text text,
  disclosure_text text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (sales_partner_id, my_company_id)
);

ALTER TABLE public.offers
  ADD COLUMN IF NOT EXISTS sales_channel text NOT NULL DEFAULT 'crm',
  ADD COLUMN IF NOT EXISTS sales_partner_id uuid REFERENCES public.sales_partner_profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS partner_organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS my_company_id uuid REFERENCES public.my_companies(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS commercial_model text,
  ADD COLUMN IF NOT EXISTS partner_base_net numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS client_total_net numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS partner_earnings_amount numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS partner_commission_rate numeric(8,3) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS partner_commission_amount numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS partner_branding_profile_id uuid REFERENCES public.sales_partner_branding_profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS partner_branding_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS portal_client_name text,
  ADD COLUMN IF NOT EXISTS portal_client_company text,
  ADD COLUMN IF NOT EXISTS portal_client_email text,
  ADD COLUMN IF NOT EXISTS portal_client_phone text,
  ADD COLUMN IF NOT EXISTS requires_internal_approval boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS partner_approval_status text NOT NULL DEFAULT 'not_required',
  ADD COLUMN IF NOT EXISTS partner_approved_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS partner_approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS partner_generated_at timestamptz,
  ADD COLUMN IF NOT EXISTS partner_last_activity_at timestamptz;

ALTER TABLE public.offers
  DROP CONSTRAINT IF EXISTS offers_sales_channel_check,
  ADD CONSTRAINT offers_sales_channel_check
    CHECK (sales_channel IN ('crm', 'seller_portal')),
  DROP CONSTRAINT IF EXISTS offers_commercial_model_check,
  ADD CONSTRAINT offers_commercial_model_check
    CHECK (commercial_model IS NULL OR commercial_model IN ('markup', 'commission')),
  DROP CONSTRAINT IF EXISTS offers_partner_approval_status_check,
  ADD CONSTRAINT offers_partner_approval_status_check
    CHECK (partner_approval_status IN ('not_required', 'required', 'approved', 'changes_requested', 'rejected'));

ALTER TABLE public.offer_items
  ADD COLUMN IF NOT EXISTS base_partner_unit_price numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS client_unit_price numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS partner_margin_amount numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_partner_custom boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS requires_internal_approval boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS partner_source_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS public.partner_offer_activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_id uuid NOT NULL REFERENCES public.offers(id) ON DELETE CASCADE,
  sales_partner_id uuid NOT NULL REFERENCES public.sales_partner_profiles(id) ON DELETE CASCADE,
  activity_type text NOT NULL CHECK (activity_type IN (
    'draft_created', 'draft_updated', 'generated', 'sent', 'viewed',
    'submitted_for_review', 'approved', 'changes_requested', 'accepted', 'rejected'
  )),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_partner_offers_partner_created
  ON public.offers(sales_partner_id, created_at DESC)
  WHERE sales_channel = 'seller_portal';
CREATE INDEX IF NOT EXISTS idx_partner_offer_activities_offer
  ON public.partner_offer_activities(offer_id, created_at DESC);

DROP TRIGGER IF EXISTS trg_sales_partner_branding_updated_at
  ON public.sales_partner_branding_profiles;
CREATE TRIGGER trg_sales_partner_branding_updated_at
BEFORE UPDATE ON public.sales_partner_branding_profiles
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.sales_partner_branding_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partner_offer_activities ENABLE ROW LEVEL SECURITY;

/* Dostep jest mozliwy wylacznie po jawnym przypisaniu UUID konta Auth przez
   administratora w sales_partner_profiles.portal_auth_user_id. */
CREATE OR REPLACE FUNCTION public.current_sales_partner_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT profile.id
  FROM public.sales_partner_profiles profile
  WHERE profile.portal_auth_user_id = auth.uid()
    AND profile.contact_id IS NOT NULL
    AND profile.portal_enabled = true
    AND profile.status = 'active'
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.current_sales_partner_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_sales_partner_id() TO authenticated;

CREATE OR REPLACE FUNCTION public.current_session_is_seller_portal()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.sales_partner_profiles profile
    WHERE profile.portal_auth_user_id = auth.uid()
      AND profile.contact_id IS NOT NULL
      AND profile.portal_enabled = true
  );
$$;

REVOKE ALL ON FUNCTION public.current_session_is_seller_portal() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_session_is_seller_portal() TO authenticated;

CREATE OR REPLACE FUNCTION public.seller_portal_offer_access_allowed(p_offer_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((
    SELECT CASE
      WHEN public.current_session_is_seller_portal() THEN
        offer_row.sales_channel = 'seller_portal'
        AND offer_row.sales_partner_id = public.current_sales_partner_id()
      WHEN offer_row.sales_channel <> 'seller_portal' THEN true
      WHEN offer_row.sales_partner_id = public.current_sales_partner_id() THEN true
      ELSE public.current_employee_can_access_company(offer_row.my_company_id)
    END
    FROM public.offers offer_row
    WHERE offer_row.id = p_offer_id
  ), false);
$$;

REVOKE ALL ON FUNCTION public.seller_portal_offer_access_allowed(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.seller_portal_offer_access_allowed(uuid) TO authenticated;

/* Prywatny bucket: pliki identyfikacji nie sa publiczne. Portal odczytuje je
   przez krotko wazne podpisane adresy i moze operowac tylko we wlasnym folderze. */
INSERT INTO storage.buckets (id, name, public)
VALUES ('seller-brand-assets', 'seller-brand-assets', false)
ON CONFLICT (id) DO UPDATE SET public = false;

DROP POLICY IF EXISTS "seller_brand_assets_select" ON storage.objects;
CREATE POLICY "seller_brand_assets_select"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'seller-brand-assets'
    AND split_part(name, '/', 1) = public.current_sales_partner_id()::text
  );

DROP POLICY IF EXISTS "seller_brand_assets_insert" ON storage.objects;
CREATE POLICY "seller_brand_assets_insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'seller-brand-assets'
    AND split_part(name, '/', 1) = public.current_sales_partner_id()::text
  );

DROP POLICY IF EXISTS "seller_brand_assets_update" ON storage.objects;
CREATE POLICY "seller_brand_assets_update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'seller-brand-assets'
    AND split_part(name, '/', 1) = public.current_sales_partner_id()::text
  )
  WITH CHECK (
    bucket_id = 'seller-brand-assets'
    AND split_part(name, '/', 1) = public.current_sales_partner_id()::text
  );

DROP POLICY IF EXISTS "seller_brand_assets_delete" ON storage.objects;
CREATE POLICY "seller_brand_assets_delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'seller-brand-assets'
    AND split_part(name, '/', 1) = public.current_sales_partner_id()::text
  );

DROP POLICY IF EXISTS "sales_partner_profiles_portal_self" ON public.sales_partner_profiles;
CREATE POLICY "sales_partner_profiles_portal_self"
  ON public.sales_partner_profiles FOR SELECT TO authenticated
  USING (id = public.current_sales_partner_id());

DROP POLICY IF EXISTS "sales_partner_brand_terms_portal_self" ON public.sales_partner_brand_terms;
CREATE POLICY "sales_partner_brand_terms_portal_self"
  ON public.sales_partner_brand_terms FOR SELECT TO authenticated
  USING (sales_partner_id = public.current_sales_partner_id() AND is_active = true);

DROP POLICY IF EXISTS "sales_partner_branding_portal_self" ON public.sales_partner_branding_profiles;
CREATE POLICY "sales_partner_branding_portal_self"
  ON public.sales_partner_branding_profiles FOR SELECT TO authenticated
  USING (sales_partner_id = public.current_sales_partner_id());

DROP POLICY IF EXISTS "sales_partner_branding_crm_select" ON public.sales_partner_branding_profiles;
CREATE POLICY "sales_partner_branding_crm_select"
  ON public.sales_partner_branding_profiles FOR SELECT TO authenticated
  USING (public.current_employee_can_access_company(my_company_id));

DROP POLICY IF EXISTS "seller_portal_offers_select" ON public.offers;
CREATE POLICY "seller_portal_offers_select"
  ON public.offers FOR SELECT TO authenticated
  USING (
    sales_channel = 'seller_portal'
    AND sales_partner_id = public.current_sales_partner_id()
  );

DROP POLICY IF EXISTS "seller_portal_offer_brand_guard" ON public.offers;
CREATE POLICY "seller_portal_offer_brand_guard"
  ON public.offers AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    (
      public.current_session_is_seller_portal()
      AND sales_channel = 'seller_portal'
      AND sales_partner_id = public.current_sales_partner_id()
    )
    OR (
      NOT public.current_session_is_seller_portal()
      AND (
        sales_channel <> 'seller_portal'
        OR public.current_employee_can_access_company(my_company_id)
      )
    )
  );

DROP POLICY IF EXISTS "seller_portal_offer_insert_guard" ON public.offers;
CREATE POLICY "seller_portal_offer_insert_guard"
  ON public.offers AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (NOT public.current_session_is_seller_portal());

DROP POLICY IF EXISTS "seller_portal_offer_update_guard" ON public.offers;
CREATE POLICY "seller_portal_offer_update_guard"
  ON public.offers AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (NOT public.current_session_is_seller_portal())
  WITH CHECK (NOT public.current_session_is_seller_portal());

DROP POLICY IF EXISTS "seller_portal_offer_delete_guard" ON public.offers;
CREATE POLICY "seller_portal_offer_delete_guard"
  ON public.offers AS RESTRICTIVE FOR DELETE TO authenticated
  USING (NOT public.current_session_is_seller_portal());

DROP POLICY IF EXISTS "seller_portal_offer_items_select" ON public.offer_items;
CREATE POLICY "seller_portal_offer_items_select"
  ON public.offer_items FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.offers offer_row
      WHERE offer_row.id = offer_items.offer_id
        AND offer_row.sales_channel = 'seller_portal'
        AND offer_row.sales_partner_id = public.current_sales_partner_id()
    )
  );

DROP POLICY IF EXISTS "seller_portal_offer_items_guard" ON public.offer_items;
CREATE POLICY "seller_portal_offer_items_guard"
  ON public.offer_items AS RESTRICTIVE FOR ALL TO authenticated
  USING (public.seller_portal_offer_access_allowed(offer_id))
  WITH CHECK (public.seller_portal_offer_access_allowed(offer_id));

/* Konta hotelowe nie dziedzicza starszych, szerokich polityk roli authenticated
   w podstawowych kartotekach CRM. Portal pobiera potrzebne minimum przez waskie RPC. */
DROP POLICY IF EXISTS "seller_portal_deny_employees" ON public.employees;
CREATE POLICY "seller_portal_deny_employees"
  ON public.employees AS RESTRICTIVE FOR ALL TO authenticated
  USING (NOT public.current_session_is_seller_portal())
  WITH CHECK (NOT public.current_session_is_seller_portal());

DROP POLICY IF EXISTS "seller_portal_deny_contacts" ON public.contacts;
CREATE POLICY "seller_portal_deny_contacts"
  ON public.contacts AS RESTRICTIVE FOR ALL TO authenticated
  USING (NOT public.current_session_is_seller_portal())
  WITH CHECK (NOT public.current_session_is_seller_portal());

DROP POLICY IF EXISTS "seller_portal_deny_organizations" ON public.organizations;
CREATE POLICY "seller_portal_deny_organizations"
  ON public.organizations AS RESTRICTIVE FOR ALL TO authenticated
  USING (NOT public.current_session_is_seller_portal())
  WITH CHECK (NOT public.current_session_is_seller_portal());

DROP POLICY IF EXISTS "seller_portal_deny_events" ON public.events;
CREATE POLICY "seller_portal_deny_events"
  ON public.events AS RESTRICTIVE FOR ALL TO authenticated
  USING (NOT public.current_session_is_seller_portal())
  WITH CHECK (NOT public.current_session_is_seller_portal());

DROP POLICY IF EXISTS "seller_portal_deny_contracts" ON public.contracts;
CREATE POLICY "seller_portal_deny_contracts"
  ON public.contracts AS RESTRICTIVE FOR ALL TO authenticated
  USING (NOT public.current_session_is_seller_portal())
  WITH CHECK (NOT public.current_session_is_seller_portal());

DROP POLICY IF EXISTS "seller_portal_deny_invoices" ON public.invoices;
CREATE POLICY "seller_portal_deny_invoices"
  ON public.invoices AS RESTRICTIVE FOR ALL TO authenticated
  USING (NOT public.current_session_is_seller_portal())
  WITH CHECK (NOT public.current_session_is_seller_portal());

DROP POLICY IF EXISTS "seller_portal_deny_tasks" ON public.tasks;
CREATE POLICY "seller_portal_deny_tasks"
  ON public.tasks AS RESTRICTIVE FOR ALL TO authenticated
  USING (NOT public.current_session_is_seller_portal())
  WITH CHECK (NOT public.current_session_is_seller_portal());

DROP POLICY IF EXISTS "seller_portal_deny_event_commissions" ON public.event_commissions;
CREATE POLICY "seller_portal_deny_event_commissions"
  ON public.event_commissions AS RESTRICTIVE FOR ALL TO authenticated
  USING (NOT public.current_session_is_seller_portal())
  WITH CHECK (NOT public.current_session_is_seller_portal());

DROP POLICY IF EXISTS "seller_portal_deny_bank_statements" ON public.bank_statements;
CREATE POLICY "seller_portal_deny_bank_statements"
  ON public.bank_statements AS RESTRICTIVE FOR ALL TO authenticated
  USING (NOT public.current_session_is_seller_portal())
  WITH CHECK (NOT public.current_session_is_seller_portal());

DROP POLICY IF EXISTS "seller_portal_deny_contact_messages" ON public.contact_messages;
CREATE POLICY "seller_portal_deny_contact_messages"
  ON public.contact_messages AS RESTRICTIVE FOR ALL TO authenticated
  USING (NOT public.current_session_is_seller_portal())
  WITH CHECK (NOT public.current_session_is_seller_portal());

DROP POLICY IF EXISTS "seller_portal_hide_product_staff" ON public.offer_product_staff;
CREATE POLICY "seller_portal_hide_product_staff"
  ON public.offer_product_staff AS RESTRICTIVE FOR SELECT TO authenticated
  USING (NOT public.current_session_is_seller_portal());

DROP POLICY IF EXISTS "seller_portal_hide_product_equipment" ON public.offer_product_equipment;
CREATE POLICY "seller_portal_hide_product_equipment"
  ON public.offer_product_equipment AS RESTRICTIVE FOR SELECT TO authenticated
  USING (NOT public.current_session_is_seller_portal());

DROP POLICY IF EXISTS "seller_portal_hide_equipment" ON public.equipment_items;
CREATE POLICY "seller_portal_hide_equipment"
  ON public.equipment_items AS RESTRICTIVE FOR SELECT TO authenticated
  USING (NOT public.current_session_is_seller_portal());

DO $$
BEGIN
  IF to_regclass('public.offer_price_audit') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS "seller_portal_hide_price_audit" ON public.offer_price_audit';
    EXECUTE $policy$
      CREATE POLICY "seller_portal_hide_price_audit"
        ON public.offer_price_audit AS RESTRICTIVE FOR ALL TO authenticated
        USING (NOT public.current_session_is_seller_portal())
        WITH CHECK (NOT public.current_session_is_seller_portal())
    $policy$;
  END IF;
END;
$$;

DROP POLICY IF EXISTS "seller_portal_hide_product_costs" ON public.offer_products;
CREATE POLICY "seller_portal_hide_product_costs"
  ON public.offer_products AS RESTRICTIVE FOR SELECT TO authenticated
  USING (NOT public.current_session_is_seller_portal());

DROP POLICY IF EXISTS "seller_portal_hide_variant_internals" ON public.offer_product_variants;
CREATE POLICY "seller_portal_hide_variant_internals"
  ON public.offer_product_variants AS RESTRICTIVE FOR SELECT TO authenticated
  USING (NOT public.current_session_is_seller_portal());

DROP POLICY IF EXISTS "partner_offer_activities_portal_select" ON public.partner_offer_activities;
CREATE POLICY "partner_offer_activities_portal_select"
  ON public.partner_offer_activities FOR SELECT TO authenticated
  USING (sales_partner_id = public.current_sales_partner_id());

DROP POLICY IF EXISTS "partner_offer_activities_crm_select" ON public.partner_offer_activities;
CREATE POLICY "partner_offer_activities_crm_select"
  ON public.partner_offer_activities FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.employees employee
      WHERE employee.id = public.current_employee_id()
        AND (
          employee.role = 'admin'
          OR 'offers_view' = ANY(COALESCE(employee.permissions, '{}'::text[]))
          OR 'offers_manage' = ANY(COALESCE(employee.permissions, '{}'::text[]))
        )
    )
  );

CREATE OR REPLACE FUNCTION public.get_seller_portal_context()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'profile', jsonb_build_object(
      'id', profile.id,
      'partner_type', profile.partner_type,
      'organization_id', profile.organization_id,
      'person', jsonb_build_object(
        'name', contact.full_name,
        'email', contact.email,
        'phone', COALESCE(contact.mobile, contact.phone),
        'photo_url', contact.avatar_url,
        'position', relation.position
      ),
      'organization', jsonb_build_object(
        'id', organization.id,
        'name', organization.name,
        'alias', organization.alias,
        'email', organization.email,
        'phone', organization.phone,
        'website', organization.website,
        'address', organization.address,
        'city', organization.city
      )
    ),
    'brands', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'my_company_id', term.my_company_id,
        'name', company.name,
        'legal_name', company.legal_name,
        'logo_url', company.logo_url,
        'default_commission_rate', term.default_commission_rate,
        'default_payment_method', term.default_payment_method,
        'branding', to_jsonb(branding)
      ) ORDER BY company.name)
      FROM public.sales_partner_brand_terms term
      JOIN public.my_companies company ON company.id = term.my_company_id
      LEFT JOIN public.sales_partner_branding_profiles branding
        ON branding.sales_partner_id = term.sales_partner_id
       AND branding.my_company_id = term.my_company_id
      WHERE term.sales_partner_id = profile.id
        AND term.is_active = true
        AND company.is_active = true
    ), '[]'::jsonb)
  )
  FROM public.sales_partner_profiles profile
  JOIN public.contacts contact ON contact.id = profile.contact_id
  LEFT JOIN public.organizations organization ON organization.id = profile.organization_id
  LEFT JOIN public.contact_organizations relation
    ON relation.contact_id = profile.contact_id
   AND relation.organization_id = profile.organization_id
   AND relation.is_current = true
  WHERE profile.id = public.current_sales_partner_id();
$$;

REVOKE ALL ON FUNCTION public.get_seller_portal_context() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_seller_portal_context() TO authenticated;

CREATE OR REPLACE FUNCTION public.get_seller_portal_catalog()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE WHEN public.current_sales_partner_id() IS NULL THEN NULL ELSE COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', product.id,
      'name', product.name,
      'description', product.description,
      'offer_short_description', product.offer_short_description,
      'offer_description', product.offer_description,
      'offer_image_path', product.offer_image_path,
      'base_price', product.base_price,
      'unit', product.unit,
      'category_id', product.category_id,
      'category', jsonb_build_object('id', category.id, 'name', category.name),
      'variants', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', variant.id,
          'name', variant.name,
          'description', variant.description,
          'short_description', variant.short_description,
          'price_net', variant.price_net,
          'offer_image_path', variant.offer_image_path
        ) ORDER BY variant.display_order)
        FROM public.offer_product_variants variant
        WHERE variant.product_id = product.id
          AND variant.is_active = true
          AND variant.partner_portal_visible = true
      ), '[]'::jsonb)
    ) ORDER BY product.display_order)
    FROM public.offer_products product
    LEFT JOIN public.event_categories category ON category.id = product.category_id
    WHERE product.is_active = true
      AND product.partner_portal_visible = true
  ), '[]'::jsonb) END;
$$;

REVOKE ALL ON FUNCTION public.get_seller_portal_catalog() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_seller_portal_catalog() TO authenticated;

/* Ograniczony wyciag prowizji: portal nie otrzymuje kosztu spolki, podatku,
   notatek finansowych ani danych innych beneficjentow. */
CREATE OR REPLACE FUNCTION public.get_seller_portal_commissions()
RETURNS TABLE (
  id uuid,
  event_id uuid,
  event_name text,
  event_date timestamptz,
  amount numeric,
  status text,
  due_date date,
  paid_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT commission.id, commission.event_id, event.name, event.event_date::timestamptz,
         commission.amount, commission.status, commission.due_date, commission.paid_at
  FROM public.event_commissions commission
  JOIN public.events event ON event.id = commission.event_id
  WHERE commission.sales_partner_id = public.current_sales_partner_id()
    AND commission.status <> 'cancelled'
  ORDER BY event.event_date DESC NULLS LAST, commission.created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.get_seller_portal_commissions() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_seller_portal_commissions() TO authenticated;

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

  INSERT INTO public.sales_partner_branding_profiles (
    sales_partner_id, my_company_id, display_name, position_title,
    contact_email, contact_phone, portrait_url, hotel_logo_url,
    hotel_cover_image_url, brandbook_url, venue_image_urls, brand_primary_color,
    brand_secondary_color, brandbook_notes, footer_text, disclosure_text
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
    NULLIF(btrim(p_branding ->> 'disclosure_text'), '')
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
    disclosure_text = EXCLUDED.disclosure_text
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

  SELECT term.default_commission_rate INTO v_default_commission
  FROM public.sales_partner_brand_terms term
  WHERE term.sales_partner_id = v_partner_id
    AND term.my_company_id = v_company_id
    AND term.is_active = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'Marka nie jest przypisana do sprzedawcy'; END IF;
  IF v_model = 'commission' AND v_commission_rate = 0 THEN v_commission_rate := v_default_commission; END IF;

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

CREATE OR REPLACE FUNCTION public.mark_seller_portal_offer_activity(
  p_offer_id uuid,
  p_activity_type text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_partner_id uuid := public.current_sales_partner_id();
BEGIN
  IF p_activity_type NOT IN ('generated', 'sent', 'submitted_for_review') THEN
    RAISE EXCEPTION 'Nieprawidlowe zdarzenie oferty';
  END IF;
  IF v_partner_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.offers
    WHERE id = p_offer_id
      AND sales_partner_id = v_partner_id
      AND sales_channel = 'seller_portal'
  ) THEN RAISE EXCEPTION 'Brak dostepu do oferty'; END IF;

  UPDATE public.offers SET
    status = CASE WHEN p_activity_type = 'sent' THEN 'sent' ELSE status END,
    sent_at = CASE WHEN p_activity_type = 'sent' THEN COALESCE(sent_at, now()) ELSE sent_at END,
    partner_generated_at = CASE WHEN p_activity_type = 'generated' THEN now() ELSE partner_generated_at END,
    partner_last_activity_at = now()
  WHERE id = p_offer_id;

  INSERT INTO public.partner_offer_activities(offer_id, sales_partner_id, activity_type)
  VALUES (p_offer_id, v_partner_id, p_activity_type);
END;
$$;

REVOKE ALL ON FUNCTION public.mark_seller_portal_offer_activity(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_seller_portal_offer_activity(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.review_seller_portal_offer(
  p_offer_id uuid,
  p_decision text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_employee_id uuid := public.current_employee_id();
  v_partner_id uuid;
  v_company_id uuid;
BEGIN
  IF p_decision NOT IN ('approved', 'changes_requested', 'rejected') THEN
    RAISE EXCEPTION 'Nieprawidlowa decyzja';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.employees employee
    WHERE employee.id = v_employee_id
      AND employee.is_active = true
      AND (
        employee.role = 'admin'
        OR 'offers_manage' = ANY(COALESCE(employee.permissions, '{}'::text[]))
      )
  ) THEN RAISE EXCEPTION 'Brak uprawnien do akceptowania ofert'; END IF;

  SELECT sales_partner_id, my_company_id INTO v_partner_id, v_company_id
  FROM public.offers
  WHERE id = p_offer_id AND sales_channel = 'seller_portal';
  IF NOT FOUND OR NOT public.current_employee_can_access_company(v_company_id) THEN
    RAISE EXCEPTION 'Oferta jest poza zakresem marek pracownika';
  END IF;

  UPDATE public.offers SET
    partner_approval_status = p_decision,
    partner_approved_by = CASE WHEN p_decision = 'approved' THEN v_employee_id ELSE NULL END,
    partner_approved_at = CASE WHEN p_decision = 'approved' THEN now() ELSE NULL END,
    partner_last_activity_at = now()
  WHERE id = p_offer_id;

  INSERT INTO public.partner_offer_activities(offer_id, sales_partner_id, activity_type)
  VALUES (p_offer_id, v_partner_id, p_decision);
END;
$$;

REVOKE ALL ON FUNCTION public.review_seller_portal_offer(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.review_seller_portal_offer(uuid, text) TO authenticated;

GRANT SELECT ON public.sales_partner_branding_profiles TO authenticated;
GRANT SELECT ON public.partner_offer_activities TO authenticated;

COMMENT ON COLUMN public.offers.partner_base_net IS
  'Suma katalogowych cen netto Mavinci zapisana w chwili utworzenia oferty partnerskiej.';
COMMENT ON COLUMN public.offers.client_total_net IS
  'Cena netto prezentowana klientowi przez hotel lub partnera.';
COMMENT ON COLUMN public.offers.partner_earnings_amount IS
  'Marza hotelu w modelu markup albo prowizja w modelu commission.';

NOTIFY pgrst, 'reload schema';
