/*
  # Kartoteka sprzedawców i partnerów handlowych

  Profil sprzedawcy nie duplikuje osoby:
  - pracownik wewnętrzny pozostaje w public.employees,
  - pracownik hotelu lub zewnętrzny polecający pozostaje w public.contacts,
  - sales_partner_profiles przechowuje wyłącznie rolę handlową i kontekst współpracy,
  - sales_partner_brand_terms przechowuje osobne warunki dla każdej marki.

  Stara tabela public.salespeople pozostaje nietknięta, ponieważ obsługuje istniejący
  panel /seller. Nowy katalog jest przygotowany do jego późniejszej, kontrolowanej migracji.
*/

CREATE TABLE IF NOT EXISTS public.sales_partner_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid REFERENCES public.employees(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES public.contacts(id) ON DELETE CASCADE,
  partner_type text NOT NULL DEFAULT 'hotel_employee' CHECK (
    partner_type IN ('internal_employee', 'hotel_employee', 'agency_employee', 'independent_referrer')
  ),
  organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('onboarding', 'active', 'inactive')),
  portal_enabled boolean NOT NULL DEFAULT false,
  portal_auth_user_id uuid UNIQUE,
  notes text,
  created_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sales_partner_profile_has_one_person CHECK (
    (employee_id IS NOT NULL AND contact_id IS NULL)
    OR (employee_id IS NULL AND contact_id IS NOT NULL)
  ),
  CONSTRAINT sales_partner_hotel_requires_organization CHECK (
    partner_type <> 'hotel_employee' OR organization_id IS NOT NULL
  ),
  CONSTRAINT sales_partner_portal_is_hotel_only CHECK (
    NOT portal_enabled OR partner_type = 'hotel_employee'
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_sales_partner_employee
  ON public.sales_partner_profiles(employee_id)
  WHERE employee_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_sales_partner_contact
  ON public.sales_partner_profiles(contact_id)
  WHERE contact_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sales_partner_organization
  ON public.sales_partner_profiles(organization_id, status);

CREATE TABLE IF NOT EXISTS public.sales_partner_brand_terms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sales_partner_id uuid NOT NULL REFERENCES public.sales_partner_profiles(id) ON DELETE CASCADE,
  my_company_id uuid NOT NULL REFERENCES public.my_companies(id) ON DELETE CASCADE,
  default_commission_rate numeric(8,3) NOT NULL DEFAULT 0 CHECK (default_commission_rate >= 0),
  default_payment_method text NOT NULL DEFAULT 'invoice' CHECK (
    default_payment_method IN ('cash_dividend', 'invoice', 'payroll', 'other')
  ),
  dividend_tax_rate numeric(5,2) NOT NULL DEFAULT 19 CHECK (
    dividend_tax_rate >= 0 AND dividend_tax_rate < 100
  ),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (sales_partner_id, my_company_id)
);

CREATE INDEX IF NOT EXISTS idx_sales_partner_brand_terms_company
  ON public.sales_partner_brand_terms(my_company_id, is_active);

ALTER TABLE public.event_commissions
  ADD COLUMN IF NOT EXISTS sales_partner_id uuid
  REFERENCES public.sales_partner_profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_event_commissions_sales_partner
  ON public.event_commissions(sales_partner_id, status)
  WHERE sales_partner_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_sales_partner_profiles_updated_at
  ON public.sales_partner_profiles;
CREATE TRIGGER trg_sales_partner_profiles_updated_at
BEFORE UPDATE ON public.sales_partner_profiles
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_sales_partner_brand_terms_updated_at
  ON public.sales_partner_brand_terms;
CREATE TRIGGER trg_sales_partner_brand_terms_updated_at
BEFORE UPDATE ON public.sales_partner_brand_terms
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.sales_partner_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_partner_brand_terms ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sales_partner_profiles_select" ON public.sales_partner_profiles;
CREATE POLICY "sales_partner_profiles_select"
  ON public.sales_partner_profiles FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.employees employee
      WHERE employee.id = public.current_employee_id()
        AND (
          employee.role = 'admin'
          OR 'admin' = ANY(COALESCE(employee.permissions, '{}'::text[]))
          OR 'contacts_view' = ANY(COALESCE(employee.permissions, '{}'::text[]))
          OR 'contacts_manage' = ANY(COALESCE(employee.permissions, '{}'::text[]))
          OR 'finances_view' = ANY(COALESCE(employee.permissions, '{}'::text[]))
          OR 'finances_manage' = ANY(COALESCE(employee.permissions, '{}'::text[]))
        )
    )
  );

DROP POLICY IF EXISTS "sales_partner_profiles_manage" ON public.sales_partner_profiles;
CREATE POLICY "sales_partner_profiles_manage"
  ON public.sales_partner_profiles FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.employees employee
      WHERE employee.id = public.current_employee_id()
        AND (
          employee.role = 'admin'
          OR 'admin' = ANY(COALESCE(employee.permissions, '{}'::text[]))
          OR 'contacts_manage' = ANY(COALESCE(employee.permissions, '{}'::text[]))
          OR 'finances_manage' = ANY(COALESCE(employee.permissions, '{}'::text[]))
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.employees employee
      WHERE employee.id = public.current_employee_id()
        AND (
          employee.role = 'admin'
          OR 'admin' = ANY(COALESCE(employee.permissions, '{}'::text[]))
          OR 'contacts_manage' = ANY(COALESCE(employee.permissions, '{}'::text[]))
          OR 'finances_manage' = ANY(COALESCE(employee.permissions, '{}'::text[]))
        )
    )
  );

DROP POLICY IF EXISTS "sales_partner_brand_terms_select" ON public.sales_partner_brand_terms;
CREATE POLICY "sales_partner_brand_terms_select"
  ON public.sales_partner_brand_terms FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.sales_partner_profiles profile
      WHERE profile.id = sales_partner_brand_terms.sales_partner_id
    )
    AND public.current_employee_can_access_company(my_company_id)
  );

DROP POLICY IF EXISTS "sales_partner_brand_terms_manage" ON public.sales_partner_brand_terms;
CREATE POLICY "sales_partner_brand_terms_manage"
  ON public.sales_partner_brand_terms FOR ALL TO authenticated
  USING (
    public.current_employee_can_access_company(my_company_id)
    AND EXISTS (
      SELECT 1 FROM public.employees employee
      WHERE employee.id = public.current_employee_id()
        AND (
          employee.role = 'admin'
          OR 'admin' = ANY(COALESCE(employee.permissions, '{}'::text[]))
          OR 'contacts_manage' = ANY(COALESCE(employee.permissions, '{}'::text[]))
          OR 'finances_manage' = ANY(COALESCE(employee.permissions, '{}'::text[]))
        )
    )
  )
  WITH CHECK (
    public.current_employee_can_access_company(my_company_id)
    AND EXISTS (
      SELECT 1 FROM public.employees employee
      WHERE employee.id = public.current_employee_id()
        AND (
          employee.role = 'admin'
          OR 'admin' = ANY(COALESCE(employee.permissions, '{}'::text[]))
          OR 'contacts_manage' = ANY(COALESCE(employee.permissions, '{}'::text[]))
          OR 'finances_manage' = ANY(COALESCE(employee.permissions, '{}'::text[]))
        )
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.sales_partner_profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sales_partner_brand_terms TO authenticated;

COMMENT ON TABLE public.sales_partner_profiles IS
  'Handlowy profil istniejącego pracownika lub kontaktu; przygotowany także pod przyszłe konta pracowników hoteli.';
COMMENT ON COLUMN public.sales_partner_profiles.portal_enabled IS
  'Flaga gotowości profilu do przyszłego portalu hotelowego. Sama flaga nie nadaje dostępu.';

-- Tabela salespeople pochodzi ze starego, opcjonalnego modułu /seller i nie
-- występuje w każdej instalacji. Komentarz dodajemy tylko wtedy, gdy istnieje.
DO $$
BEGIN
  IF to_regclass('public.salespeople') IS NOT NULL THEN
    EXECUTE 'COMMENT ON TABLE public.salespeople IS '
      || quote_literal(
        'Starszy rejestr używany przez /seller. Nowe profile CRM należy tworzyć w sales_partner_profiles.'
      );
  END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';
