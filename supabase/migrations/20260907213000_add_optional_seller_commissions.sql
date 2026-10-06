/*
  # Prowizja jako opcjonalny model współpracy

  Sam procent 0 nie określa już dostępu do rozliczeń. Osobna flaga per
  sprzedawca i marka steruje portalem, kreatorem ofert oraz zakresem danych.
*/

ALTER TABLE public.sales_partner_brand_terms
  ADD COLUMN IF NOT EXISTS commission_enabled boolean NOT NULL DEFAULT true;

UPDATE public.sales_partner_brand_terms
SET commission_enabled = false
WHERE default_commission_rate = 0;

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
        'commission_enabled', term.commission_enabled,
        'default_commission_rate', CASE WHEN term.commission_enabled THEN term.default_commission_rate ELSE 0 END,
        'default_payment_method', CASE WHEN term.commission_enabled THEN term.default_payment_method ELSE NULL END,
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

CREATE OR REPLACE FUNCTION public.enforce_seller_commission_availability()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.sales_channel = 'seller_portal'
     AND NEW.sales_partner_id IS NOT NULL
     AND NEW.my_company_id IS NOT NULL
     AND NEW.commercial_model = 'commission'
     AND NOT EXISTS (
       SELECT 1
       FROM public.sales_partner_brand_terms term
       WHERE term.sales_partner_id = NEW.sales_partner_id
         AND term.my_company_id = NEW.my_company_id
         AND term.is_active = true
         AND term.commission_enabled = true
     ) THEN
    NEW.commercial_model := 'markup';
    NEW.partner_commission_rate := 0;
    NEW.partner_commission_amount := 0;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_seller_commission_availability ON public.offers;
CREATE TRIGGER trg_enforce_seller_commission_availability
BEFORE INSERT OR UPDATE OF sales_channel, sales_partner_id, my_company_id, commercial_model
ON public.offers
FOR EACH ROW EXECUTE FUNCTION public.enforce_seller_commission_availability();

CREATE OR REPLACE FUNCTION public.enforce_sales_partner_event_commission()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id uuid;
BEGIN
  IF NEW.sales_partner_id IS NULL THEN RETURN NEW; END IF;
  SELECT event.my_company_id INTO v_company_id
  FROM public.events event
  WHERE event.id = NEW.event_id;

  IF NOT EXISTS (
    SELECT 1
    FROM public.sales_partner_brand_terms term
    WHERE term.sales_partner_id = NEW.sales_partner_id
      AND term.my_company_id = v_company_id
      AND term.is_active = true
      AND term.commission_enabled = true
  ) THEN
    RAISE EXCEPTION 'Ten sprzedawca nie ma włączonego rozliczenia prowizyjnego dla marki wydarzenia';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_sales_partner_event_commission ON public.event_commissions;
CREATE TRIGGER trg_enforce_sales_partner_event_commission
BEFORE INSERT OR UPDATE OF event_id, sales_partner_id
ON public.event_commissions
FOR EACH ROW EXECUTE FUNCTION public.enforce_sales_partner_event_commission();

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
    AND EXISTS (
      SELECT 1
      FROM public.sales_partner_brand_terms term
      WHERE term.sales_partner_id = commission.sales_partner_id
        AND term.my_company_id = event.my_company_id
        AND term.is_active = true
        AND term.commission_enabled = true
    )
  ORDER BY event.event_date DESC NULLS LAST, commission.created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.get_seller_portal_commissions() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_seller_portal_commissions() TO authenticated;

COMMENT ON COLUMN public.sales_partner_brand_terms.commission_enabled IS
  'Czy dla tego sprzedawcy i marki istnieje model prowizyjny oraz widok wynagrodzeń w portalu.';

NOTIFY pgrst, 'reload schema';
