BEGIN;

-- Zakres finansów „sales_lead”: opiekun sprzedaży odpowiada za kalkulacje i rentowność
-- własnych wydarzeń, ale NIE wystawia faktur (robi to administrator / księgowość).
--   * dziedziczy wszystkie ograniczenia zakresu „sales” (bank, płace, KSeF, cudze faktury),
--   * widzi i planuje koszty własnych wydarzeń (event_costs: tylko status „pending”),
--   * widzi gotówkę własnych wydarzeń (event_cash_transactions: tylko odczyt),
--   * planuje prowizje własnych wydarzeń (event_commissions: tylko „planned”/„cancelled”),
--   * nie może wystawiać ani zmieniać faktur.
-- Wymaga: 20260926195000_scope_sales_finance.sql, 20261031100000_event_commercial_owner_access.sql.

ALTER TABLE public.employees DROP CONSTRAINT IF EXISTS employees_finance_access_scope_check;
ALTER TABLE public.employees ADD CONSTRAINT employees_finance_access_scope_check
  CHECK (finance_access_scope IN ('inherit', 'sales', 'sales_lead', 'company'));
COMMENT ON COLUMN public.employees.finance_access_scope IS
  'inherit: zakres roli; sales: własne faktury i sprzedaż oraz sprzedawcy pod opieką; sales_lead: jak sales, plus koszty, marża i prowizje własnych wydarzeń, bez wystawiania faktur; company: pełne finanse. Zmienia administrator.';

CREATE OR REPLACE FUNCTION public.sales_finance_is_lead()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT coalesce((
    SELECT e.finance_access_scope = 'sales_lead' AND NOT public.invoice_finance_is_admin()
      AND NOT public.current_session_is_seller_portal()
    FROM public.employees e WHERE e.id = public.current_invoice_employee_id()
  ), false);
$$;

-- Ta sama definicja co w 20260926195000, plus sales_lead w gałęzi sprzedaży.
CREATE OR REPLACE FUNCTION public.invoice_finance_scope()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT coalesce((SELECT CASE
    WHEN public.current_session_is_seller_portal() THEN 'none'
    WHEN public.invoice_finance_is_admin() THEN 'company'
    WHEN e.finance_access_scope IN ('sales', 'sales_lead')
      OR (e.finance_access_scope = 'inherit' AND a.slug = 'sales-specialist') THEN 'sales'
    WHEN coalesce(e.permissions, '{}'::text[]) && ARRAY[
      'finances_view','finances_manage','invoices_view','invoices_manage','ksef_manage'
    ]::text[] THEN 'company'
    ELSE 'none' END
  FROM public.employees e LEFT JOIN public.access_levels a ON a.id = e.access_level_id
  WHERE e.id = public.current_invoice_employee_id()), 'none');
$$;

-- Ta sama definicja co w 20260926195000; sales_lead nie wystawia faktur.
CREATE OR REPLACE FUNCTION public.can_manage_invoice_company(p_company_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT ((public.invoice_finance_scope() = 'sales' AND NOT public.sales_finance_is_lead())
      OR public.can_manage_invoices()) AND EXISTS (
    SELECT 1 FROM public.employees e WHERE e.id = public.current_invoice_employee_id()
      AND (public.invoice_finance_is_admin() OR (
        p_company_id IS NOT NULL AND public.employee_can_access_company(e.id, p_company_id)
        AND (coalesce(e.invoice_company_permissions, '{}'::jsonb) = '{}'::jsonb
          OR coalesce(e.invoice_company_permissions -> p_company_id::text, '[]'::jsonb) ?| ARRAY['issue','manage'])
      )));
$$;

-- Wydarzenie należące do sprzedaży opiekuna, który ma do niego dostęp i markę.
CREATE OR REPLACE FUNCTION public.sales_lead_owns_event(p_event_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT public.sales_finance_is_lead()
    AND public.current_employee_sells_event(p_event_id)
    AND public.current_employee_can_view_event(p_event_id)
    AND public.current_employee_can_access_event_company(p_event_id);
$$;

-- Koszty wydarzenia -------------------------------------------------------------------
-- Ograniczenia RESTRICTIVE osobno dla każdej operacji: polityki permisywne są łączone przez OR,
-- więc reguła „tylko oczekujące” musi być w polityce restrykcyjnej, a nie tylko w permisywnej.
DROP POLICY IF EXISTS sales_finance_private ON public.event_costs;
DROP POLICY IF EXISTS sales_finance_private_select ON public.event_costs;
CREATE POLICY sales_finance_private_select ON public.event_costs AS RESTRICTIVE FOR SELECT TO authenticated
  USING (public.invoice_finance_scope() <> 'sales' OR public.sales_lead_owns_event(event_id));
DROP POLICY IF EXISTS sales_finance_private_insert ON public.event_costs;
CREATE POLICY sales_finance_private_insert ON public.event_costs AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (public.invoice_finance_scope() <> 'sales'
    OR (public.sales_lead_owns_event(event_id) AND coalesce(status, 'pending') = 'pending'));
DROP POLICY IF EXISTS sales_finance_private_update ON public.event_costs;
CREATE POLICY sales_finance_private_update ON public.event_costs AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (public.invoice_finance_scope() <> 'sales'
    OR (public.sales_lead_owns_event(event_id) AND coalesce(status, 'pending') = 'pending'))
  WITH CHECK (public.invoice_finance_scope() <> 'sales'
    OR (public.sales_lead_owns_event(event_id) AND coalesce(status, 'pending') = 'pending'));
DROP POLICY IF EXISTS sales_finance_private_delete ON public.event_costs;
CREATE POLICY sales_finance_private_delete ON public.event_costs AS RESTRICTIVE FOR DELETE TO authenticated
  USING (public.invoice_finance_scope() <> 'sales'
    OR (public.sales_lead_owns_event(event_id) AND coalesce(status, 'pending') = 'pending'));

DROP POLICY IF EXISTS sales_lead_event_costs_read ON public.event_costs;
CREATE POLICY sales_lead_event_costs_read ON public.event_costs FOR SELECT TO authenticated
  USING (public.sales_lead_owns_event(event_id));
DROP POLICY IF EXISTS sales_lead_event_costs_insert ON public.event_costs;
CREATE POLICY sales_lead_event_costs_insert ON public.event_costs FOR INSERT TO authenticated
  WITH CHECK (public.sales_lead_owns_event(event_id) AND coalesce(status, 'pending') = 'pending');
DROP POLICY IF EXISTS sales_lead_event_costs_update ON public.event_costs;
CREATE POLICY sales_lead_event_costs_update ON public.event_costs FOR UPDATE TO authenticated
  USING (public.sales_lead_owns_event(event_id) AND coalesce(status, 'pending') = 'pending')
  WITH CHECK (public.sales_lead_owns_event(event_id) AND coalesce(status, 'pending') = 'pending');
DROP POLICY IF EXISTS sales_lead_event_costs_delete ON public.event_costs;
CREATE POLICY sales_lead_event_costs_delete ON public.event_costs FOR DELETE TO authenticated
  USING (public.sales_lead_owns_event(event_id) AND coalesce(status, 'pending') = 'pending');

-- Gotówka wydarzenia: opiekun sprzedaży tylko odczytuje ------------------------------------
DROP POLICY IF EXISTS sales_finance_private ON public.event_cash_transactions;
DROP POLICY IF EXISTS sales_finance_private_select ON public.event_cash_transactions;
CREATE POLICY sales_finance_private_select ON public.event_cash_transactions AS RESTRICTIVE FOR SELECT TO authenticated
  USING (public.invoice_finance_scope() <> 'sales' OR public.sales_lead_owns_event(event_id));
DROP POLICY IF EXISTS sales_finance_private_insert ON public.event_cash_transactions;
CREATE POLICY sales_finance_private_insert ON public.event_cash_transactions AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (public.invoice_finance_scope() <> 'sales');
DROP POLICY IF EXISTS sales_finance_private_update ON public.event_cash_transactions;
CREATE POLICY sales_finance_private_update ON public.event_cash_transactions AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (public.invoice_finance_scope() <> 'sales') WITH CHECK (public.invoice_finance_scope() <> 'sales');
DROP POLICY IF EXISTS sales_finance_private_delete ON public.event_cash_transactions;
CREATE POLICY sales_finance_private_delete ON public.event_cash_transactions AS RESTRICTIVE FOR DELETE TO authenticated
  USING (public.invoice_finance_scope() <> 'sales');
DROP POLICY IF EXISTS sales_lead_cash_read ON public.event_cash_transactions;
CREATE POLICY sales_lead_cash_read ON public.event_cash_transactions FOR SELECT TO authenticated
  USING (public.sales_lead_owns_event(event_id));

-- Faktury: opiekun bez fakturowania nie usuwa także faktur wystawionych wcześniej ------------
DROP POLICY IF EXISTS invoices_sales_lead_no_delete ON public.invoices;
CREATE POLICY invoices_sales_lead_no_delete ON public.invoices AS RESTRICTIVE FOR DELETE TO authenticated
  USING (NOT public.sales_finance_is_lead());

-- Prowizje wydarzenia ----------------------------------------------------------------
DROP POLICY IF EXISTS commissions_sales_read_scope ON public.event_commissions;
CREATE POLICY commissions_sales_read_scope ON public.event_commissions AS RESTRICTIVE FOR SELECT TO authenticated
  USING (public.invoice_finance_scope() <> 'sales' OR public.sales_commission_visible(id)
    OR public.sales_lead_owns_event(event_id));
DROP POLICY IF EXISTS commissions_sales_insert_scope ON public.event_commissions;
CREATE POLICY commissions_sales_insert_scope ON public.event_commissions AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (public.invoice_finance_scope() <> 'sales'
    OR (public.sales_lead_owns_event(event_id) AND status = 'planned'));
DROP POLICY IF EXISTS commissions_sales_update_scope ON public.event_commissions;
CREATE POLICY commissions_sales_update_scope ON public.event_commissions AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (public.invoice_finance_scope() <> 'sales'
    OR (public.sales_lead_owns_event(event_id) AND status = 'planned'))
  WITH CHECK (public.invoice_finance_scope() <> 'sales'
    OR (public.sales_lead_owns_event(event_id) AND status IN ('planned', 'cancelled')));
DROP POLICY IF EXISTS commissions_sales_delete_scope ON public.event_commissions;
CREATE POLICY commissions_sales_delete_scope ON public.event_commissions AS RESTRICTIVE FOR DELETE TO authenticated
  USING (public.invoice_finance_scope() <> 'sales'
    OR (public.sales_lead_owns_event(event_id) AND status = 'planned'));

DROP POLICY IF EXISTS sales_lead_commissions_read ON public.event_commissions;
CREATE POLICY sales_lead_commissions_read ON public.event_commissions FOR SELECT TO authenticated
  USING (public.sales_lead_owns_event(event_id));
DROP POLICY IF EXISTS sales_lead_commissions_write ON public.event_commissions;
CREATE POLICY sales_lead_commissions_write ON public.event_commissions FOR ALL TO authenticated
  USING (public.sales_lead_owns_event(event_id) AND status = 'planned')
  WITH CHECK (public.sales_lead_owns_event(event_id) AND status IN ('planned', 'cancelled'));

-- Odczyt uprawnień przez interfejs ------------------------------------------------------
-- Ta sama definicja co w 20260926195000, plus tier i prawa do kosztów.
CREATE OR REPLACE FUNCTION public.get_invoice_finance_access()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE actor uuid := public.current_invoice_employee_id(); scope text := public.invoice_finance_scope();
  contacts jsonb := '[]'; partners jsonb := '[]'; events jsonb := '[]'; can_issue boolean;
  is_lead boolean := public.sales_finance_is_lead();
BEGIN
  IF actor IS NULL OR auth.uid() IS NULL THEN RAISE EXCEPTION 'Wymagane aktywne konto pracownika.' USING ERRCODE = '42501'; END IF;
  IF scope = 'sales' THEN
    SELECT coalesce(jsonb_agg(c.id ORDER BY c.id), '[]') INTO contacts FROM public.contacts c
      WHERE c.owner_id = actor;
    SELECT coalesce(jsonb_agg(p.id ORDER BY p.id), '[]') INTO partners FROM public.sales_partner_profiles p
      JOIN public.contacts c ON c.id = p.contact_id WHERE c.owner_id = actor;
    SELECT coalesce(jsonb_agg(e.id ORDER BY e.id), '[]') INTO events FROM public.events e
      WHERE public.invoice_sales_event_owned(e.id);
  END IF;
  SELECT EXISTS (SELECT 1 FROM public.my_companies c WHERE public.can_manage_invoice_company(c.id)) INTO can_issue;
  RETURN jsonb_build_object('employeeId', actor, 'authUserId', auth.uid(), 'scope', scope,
    'tier', CASE WHEN scope = 'sales' AND is_lead THEN 'sales_lead' ELSE scope END,
    'canViewOwnInvoices', scope IN ('sales','company'), 'canIssueInvoices', can_issue,
    'canViewCompanyFinance', public.finance_can_view(), 'canManageCompanyFinance', public.finance_can_manage(),
    'canPlanOwnEventCosts', scope = 'sales' AND is_lead,
    'managedSellerContactIds', contacts, 'managedSellerPartnerIds', partners, 'soldEventIds', events);
END; $$;

-- Uprawnienia do kosztów konkretnego wydarzenia, dla interfejsu (ta sama decyzja co RLS).
CREATE OR REPLACE FUNCTION public.get_event_finance_access(p_event_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT jsonb_build_object(
    'scope', public.invoice_finance_scope(),
    'canViewCosts', public.invoice_finance_scope() = 'company' OR public.sales_lead_owns_event(p_event_id),
    'canManageCosts', public.finance_can_manage() OR public.sales_lead_owns_event(p_event_id),
    'canApproveCosts', public.finance_can_manage(),
    'canPlanCommissions', public.finance_can_manage() OR public.sales_lead_owns_event(p_event_id),
    'canApproveCommissions', public.finance_can_manage(),
    'canIssueInvoices', EXISTS (SELECT 1 FROM public.events e
      WHERE e.id = p_event_id AND public.can_manage_invoice_company(e.my_company_id))
  );
$$;

REVOKE ALL ON FUNCTION public.sales_finance_is_lead(), public.sales_lead_owns_event(uuid),
  public.get_event_finance_access(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sales_finance_is_lead(), public.sales_lead_owns_event(uuid),
  public.get_event_finance_access(uuid) TO authenticated, service_role;

-- Nowy sprzedawca (rekrutacja 11/2026): kalkulacje i rentowność po jego stronie, faktury u administratora.
-- Pozostali pracownicy: zakres zmienia administrator w zakładce Uprawnienia pracownika.
UPDATE public.employees SET finance_access_scope = 'sales_lead'
WHERE id = '5e1a3293-fda2-438c-963a-92f6116df82b' AND finance_access_scope = 'sales';

NOTIFY pgrst, 'reload schema';
COMMIT;
