BEGIN;

CREATE OR REPLACE FUNCTION public.current_brochure_employee_id()
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT employee.id
  FROM public.employees employee
  WHERE employee.is_active = true
    AND (employee.id = auth.uid() OR employee.auth_user_id = auth.uid())
  ORDER BY (employee.id = auth.uid()) DESC
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.can_view_sales_brochures()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.employees employee
    WHERE employee.is_active = true
      AND (employee.id = auth.uid() OR employee.auth_user_id = auth.uid())
      AND (
        employee.role = 'admin'
        OR employee.access_level = 'admin'
        OR 'offers_view' = ANY(COALESCE(employee.permissions, '{}'::text[]))
        OR 'offers_manage' = ANY(COALESCE(employee.permissions, '{}'::text[]))
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.can_manage_sales_brochures()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.employees employee
    WHERE employee.is_active = true
      AND (employee.id = auth.uid() OR employee.auth_user_id = auth.uid())
      AND (
        employee.role = 'admin'
        OR employee.access_level = 'admin'
        OR 'offers_manage' = ANY(COALESCE(employee.permissions, '{}'::text[]))
      )
  );
$$;

CREATE TABLE IF NOT EXISTS public.sales_brochures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  title text NOT NULL DEFAULT 'Oferta współpracy',
  subtitle text,
  introduction text,
  closing_text text,
  audience_type text NOT NULL DEFAULT 'hotel'
    CHECK (audience_type IN ('hotel', 'venue', 'agency', 'corporate', 'wedding', 'general')),
  organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  my_company_id uuid NOT NULL REFERENCES public.my_companies(id) ON DELETE RESTRICT,
  contact_employee_id uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  cover_image_path text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'ready', 'archived')),
  brand_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  current_pdf_path text,
  current_pdf_version integer NOT NULL DEFAULT 0,
  generated_at timestamptz,
  modified_after_generation boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES public.employees(id) ON DELETE SET NULL DEFAULT public.current_brochure_employee_id(),
  updated_by uuid REFERENCES public.employees(id) ON DELETE SET NULL DEFAULT public.current_brochure_employee_id(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.sales_brochure_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brochure_id uuid NOT NULL REFERENCES public.sales_brochures(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.offer_products(id) ON DELETE RESTRICT,
  product_variant_id uuid REFERENCES public.offer_product_variants(id) ON DELETE SET NULL,
  display_order integer NOT NULL DEFAULT 0 CHECK (display_order >= 0),
  custom_title text,
  custom_short_description text,
  custom_description text,
  custom_benefits jsonb CHECK (custom_benefits IS NULL OR jsonb_typeof(custom_benefits) = 'array'),
  custom_image_path text,
  page_layout text NOT NULL DEFAULT 'visual' CHECK (page_layout IN ('visual', 'classic', 'compact')),
  is_visible boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_sales_brochure_base_product
  ON public.sales_brochure_items(brochure_id, product_id)
  WHERE product_variant_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_sales_brochure_variant_product
  ON public.sales_brochure_items(brochure_id, product_id, product_variant_id)
  WHERE product_variant_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sales_brochure_items_order
  ON public.sales_brochure_items(brochure_id, display_order, created_at);

CREATE TABLE IF NOT EXISTS public.sales_brochure_generations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brochure_id uuid NOT NULL REFERENCES public.sales_brochures(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version > 0),
  pdf_path text NOT NULL,
  file_name text NOT NULL,
  file_size bigint CHECK (file_size IS NULL OR file_size >= 0),
  generated_for_organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  snapshot jsonb NOT NULL,
  created_by uuid REFERENCES public.employees(id) ON DELETE SET NULL DEFAULT public.current_brochure_employee_id(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(brochure_id, version)
);

ALTER TABLE public.mailing_campaigns
  ADD COLUMN IF NOT EXISTS brochure_generation_id uuid
    REFERENCES public.sales_brochure_generations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_sales_brochures_company_status
  ON public.sales_brochures(my_company_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_sales_brochure_generations_brochure
  ON public.sales_brochure_generations(brochure_id, version DESC);
CREATE INDEX IF NOT EXISTS idx_mailing_campaigns_brochure_generation
  ON public.mailing_campaigns(brochure_generation_id)
  WHERE brochure_generation_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.prepare_sales_brochure_write()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  NEW.updated_by := COALESCE(public.current_brochure_employee_id(), NEW.updated_by);
  IF TG_OP = 'UPDATE' AND (
    NEW.name IS DISTINCT FROM OLD.name
    OR NEW.title IS DISTINCT FROM OLD.title
    OR NEW.subtitle IS DISTINCT FROM OLD.subtitle
    OR NEW.introduction IS DISTINCT FROM OLD.introduction
    OR NEW.closing_text IS DISTINCT FROM OLD.closing_text
    OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
    OR NEW.my_company_id IS DISTINCT FROM OLD.my_company_id
    OR NEW.contact_employee_id IS DISTINCT FROM OLD.contact_employee_id
    OR NEW.cover_image_path IS DISTINCT FROM OLD.cover_image_path
    OR NEW.brand_config IS DISTINCT FROM OLD.brand_config
  ) THEN
    NEW.modified_after_generation := NEW.current_pdf_path IS NOT NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prepare_sales_brochure_write ON public.sales_brochures;
CREATE TRIGGER trg_prepare_sales_brochure_write
BEFORE UPDATE ON public.sales_brochures
FOR EACH ROW EXECUTE FUNCTION public.prepare_sales_brochure_write();

CREATE OR REPLACE FUNCTION public.touch_sales_brochure_from_item()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_brochure_id uuid;
BEGIN
  v_brochure_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.brochure_id ELSE NEW.brochure_id END;
  UPDATE public.sales_brochures
  SET modified_after_generation = current_pdf_path IS NOT NULL,
      updated_at = now(),
      updated_by = COALESCE(public.current_brochure_employee_id(), updated_by)
  WHERE id = v_brochure_id;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_sales_brochure_from_item ON public.sales_brochure_items;
CREATE TRIGGER trg_touch_sales_brochure_from_item
AFTER INSERT OR UPDATE OR DELETE ON public.sales_brochure_items
FOR EACH ROW EXECUTE FUNCTION public.touch_sales_brochure_from_item();

CREATE OR REPLACE FUNCTION public.touch_sales_brochure_item_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_sales_brochure_item_updated_at ON public.sales_brochure_items;
CREATE TRIGGER trg_touch_sales_brochure_item_updated_at
BEFORE UPDATE ON public.sales_brochure_items
FOR EACH ROW EXECUTE FUNCTION public.touch_sales_brochure_item_updated_at();

ALTER TABLE public.sales_brochures ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_brochure_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_brochure_generations ENABLE ROW LEVEL SECURITY;

CREATE POLICY sales_brochures_read ON public.sales_brochures
  FOR SELECT TO authenticated USING (public.can_view_sales_brochures());
CREATE POLICY sales_brochures_manage ON public.sales_brochures
  FOR ALL TO authenticated
  USING (public.can_manage_sales_brochures())
  WITH CHECK (public.can_manage_sales_brochures());

CREATE POLICY sales_brochure_items_read ON public.sales_brochure_items
  FOR SELECT TO authenticated USING (public.can_view_sales_brochures());
CREATE POLICY sales_brochure_items_manage ON public.sales_brochure_items
  FOR ALL TO authenticated
  USING (public.can_manage_sales_brochures())
  WITH CHECK (public.can_manage_sales_brochures());

CREATE POLICY sales_brochure_generations_read ON public.sales_brochure_generations
  FOR SELECT TO authenticated USING (public.can_view_sales_brochures());
CREATE POLICY sales_brochure_generations_manage ON public.sales_brochure_generations
  FOR ALL TO authenticated
  USING (public.can_manage_sales_brochures())
  WITH CHECK (public.can_manage_sales_brochures());

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('generated-brochures', 'generated-brochures', false, 20971520, ARRAY['application/pdf'])
ON CONFLICT (id) DO UPDATE
SET public = false, file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS generated_brochures_read ON storage.objects;
CREATE POLICY generated_brochures_read ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'generated-brochures' AND public.can_view_sales_brochures());
DROP POLICY IF EXISTS generated_brochures_manage ON storage.objects;
CREATE POLICY generated_brochures_manage ON storage.objects
  FOR ALL TO authenticated
  USING (bucket_id = 'generated-brochures' AND public.can_manage_sales_brochures())
  WITH CHECK (bucket_id = 'generated-brochures' AND public.can_manage_sales_brochures());

CREATE OR REPLACE FUNCTION public.enforce_campaign_business_type_audience()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rules jsonb;
  v_business_type text;
BEGIN
  SELECT campaign.audience_rules INTO v_rules
  FROM public.mailing_campaigns campaign
  WHERE campaign.id = NEW.campaign_id;

  IF jsonb_typeof(v_rules -> 'business_types') = 'array'
     AND jsonb_array_length(v_rules -> 'business_types') > 0 THEN
    IF NEW.organization_id IS NOT NULL THEN
      SELECT organization.business_type::text INTO v_business_type
      FROM public.organizations organization
      WHERE organization.id = NEW.organization_id;
    END IF;

    IF v_business_type IS NULL OR NOT ((v_rules -> 'business_types') ? v_business_type) THEN
      NEW.status := 'excluded';
      NEW.exclusion_reason := 'audience_business_type';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_campaign_business_type_audience ON public.mailing_recipients;
CREATE TRIGGER trg_enforce_campaign_business_type_audience
BEFORE INSERT OR UPDATE OF campaign_id, organization_id ON public.mailing_recipients
FOR EACH ROW EXECUTE FUNCTION public.enforce_campaign_business_type_audience();

CREATE OR REPLACE FUNCTION public.protect_campaign_brochure_generation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.brochure_generation_id IS NOT NULL AND NEW.status NOT IN ('draft', 'cancelled') THEN
    RAISE EXCEPTION 'Wysyłka broszur jest przygotowana jako szkic. Przed uruchomieniem wymaga aktywacji kontrolowanej dystrybucji PDF.';
  END IF;
  IF OLD.status IN ('approved', 'scheduled', 'sending', 'paused', 'sent')
     AND NEW.brochure_generation_id IS DISTINCT FROM OLD.brochure_generation_id THEN
    RAISE EXCEPTION 'Nie można zmienić broszury w zatwierdzonej lub wysłanej kampanii';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_campaign_brochure_generation ON public.mailing_campaigns;
CREATE TRIGGER trg_protect_campaign_brochure_generation
BEFORE UPDATE OF brochure_generation_id, status ON public.mailing_campaigns
FOR EACH ROW EXECUTE FUNCTION public.protect_campaign_brochure_generation();

CREATE OR REPLACE FUNCTION public.create_hotel_brochure_campaign(
  p_brochure_id uuid,
  p_name text DEFAULT NULL,
  p_subject text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_brochure public.sales_brochures%ROWTYPE;
  v_generation_id uuid;
  v_campaign_id uuid;
BEGIN
  IF NOT public.can_manage_sales_brochures() OR NOT public.can_manage_marketing_campaigns() THEN
    RAISE EXCEPTION 'Brak uprawnień do utworzenia kampanii';
  END IF;

  SELECT * INTO v_brochure FROM public.sales_brochures WHERE id = p_brochure_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Nie znaleziono broszury'; END IF;
  IF v_brochure.current_pdf_version <= 0 OR v_brochure.current_pdf_path IS NULL
     OR v_brochure.modified_after_generation THEN
    RAISE EXCEPTION 'Najpierw wygeneruj aktualny PDF broszury';
  END IF;

  SELECT generation.id INTO v_generation_id
  FROM public.sales_brochure_generations generation
  WHERE generation.brochure_id = v_brochure.id
    AND generation.version = v_brochure.current_pdf_version;
  IF v_generation_id IS NULL THEN RAISE EXCEPTION 'Nie znaleziono aktualnej wersji PDF'; END IF;

  INSERT INTO public.mailing_campaigns (
    name, subject, content, preview_text, status, audience_rules,
    brochure_generation_id, created_by, updated_by
  ) VALUES (
    COALESCE(NULLIF(btrim(p_name), ''), 'Broszura dla hoteli — ' || v_brochure.name),
    COALESCE(NULLIF(btrim(p_subject), ''), 'Propozycja współpracy eventowej dla Państwa hotelu'),
    '<div style="font-family:Arial,sans-serif;line-height:1.65;color:#1c1f33">'
      || '<p>Dzień dobry,</p><p>przygotowaliśmy prezentację usług, które możemy realizować wspólnie z Państwa hotelem.</p>'
      || '<p><strong>Broszura PDF jest przypisana do tego szkicu.</strong> Kontrolowany link zostanie udostępniony po aktywacji dystrybucji i ponownej kwalifikacji odbiorców.</p>'
      || '<p>Chętnie porozmawiamy o stałej współpracy oraz obsłudze najbliższych wydarzeń.</p></div>',
    'Technika, produkcja i obsługa wydarzeń dla hoteli',
    'draft',
    jsonb_build_object('business_types', jsonb_build_array('hotel')),
    v_generation_id,
    public.current_marketing_employee_id(),
    public.current_marketing_employee_id()
  ) RETURNING id INTO v_campaign_id;

  RETURN v_campaign_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_hotel_brochure_campaign(uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_hotel_brochure_campaign(uuid,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.record_sales_brochure_generation(
  p_brochure_id uuid,
  p_pdf_path text,
  p_file_name text,
  p_file_size bigint,
  p_snapshot jsonb,
  p_created_by uuid DEFAULT NULL
)
RETURNS public.sales_brochure_generations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_brochure public.sales_brochures%ROWTYPE;
  v_generation public.sales_brochure_generations%ROWTYPE;
  v_version integer;
BEGIN
  IF auth.role() <> 'service_role' AND NOT public.can_manage_sales_brochures() THEN
    RAISE EXCEPTION 'Brak uprawnień do zapisania wersji broszury';
  END IF;

  SELECT * INTO v_brochure
  FROM public.sales_brochures
  WHERE id = p_brochure_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Nie znaleziono broszury'; END IF;

  v_version := v_brochure.current_pdf_version + 1;
  INSERT INTO public.sales_brochure_generations (
    brochure_id, version, pdf_path, file_name, file_size,
    generated_for_organization_id, snapshot, created_by
  ) VALUES (
    v_brochure.id, v_version, p_pdf_path, p_file_name, p_file_size,
    v_brochure.organization_id, COALESCE(p_snapshot, '{}'::jsonb),
    COALESCE(p_created_by, public.current_brochure_employee_id())
  ) RETURNING * INTO v_generation;

  UPDATE public.sales_brochures
  SET current_pdf_path = p_pdf_path,
      current_pdf_version = v_version,
      generated_at = now(),
      modified_after_generation = false,
      status = CASE WHEN status = 'draft' THEN 'ready' ELSE status END,
      updated_at = now(),
      updated_by = COALESCE(p_created_by, updated_by)
  WHERE id = v_brochure.id;

  RETURN v_generation;
END;
$$;

REVOKE ALL ON FUNCTION public.record_sales_brochure_generation(uuid,text,text,bigint,jsonb,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_sales_brochure_generation(uuid,text,text,bigint,jsonb,uuid) TO authenticated, service_role;

COMMENT ON TABLE public.sales_brochures IS
  'Edytowalne broszury sprzedażowe zasilane katalogiem offer_products, niezależne od ofert dla wydarzeń.';
COMMENT ON TABLE public.sales_brochure_generations IS
  'Niezmienne wersje PDF i migawki danych broszur używane w wysyłce pojedynczej i kampaniach.';
COMMENT ON COLUMN public.mailing_campaigns.brochure_generation_id IS
  'Wersja broszury zamrożona dla szkicu kampanii; dystrybucja pozostaje zablokowana do czasu aktywacji kontrolowanego linku.';

COMMIT;
