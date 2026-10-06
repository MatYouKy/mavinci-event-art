BEGIN;

-- Sales issuance is not permission to read the company's accounts. No invoice,
-- payment or historical event is modified by this migration.
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS finance_access_scope text NOT NULL DEFAULT 'inherit';
ALTER TABLE public.employees ADD CONSTRAINT employees_finance_access_scope_check
  CHECK (finance_access_scope IN ('inherit', 'sales', 'company'));
COMMENT ON COLUMN public.employees.finance_access_scope IS
  'inherit: zakres roli; sales: własne faktury i sprzedaż oraz sprzedawcy pod opieką; company: dotychczasowe uprawnienia finansowe. Zmienia administrator.';

UPDATE public.employees SET finance_access_scope = 'sales'
WHERE id = '5e1a3293-fda2-438c-963a-92f6116df82b';

-- Do not identify an employee by an editable email address. Ambiguous identity
-- mappings fail closed, including in existing invoice SECURITY DEFINER RPCs.
CREATE OR REPLACE FUNCTION public.current_invoice_employee_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT CASE WHEN count(*) = 1 THEN min(e.id::text)::uuid END
  FROM public.employees e
  WHERE e.is_active = true AND auth.uid() IS NOT NULL
    AND (e.id = auth.uid() OR e.auth_user_id = auth.uid());
$$;

CREATE OR REPLACE FUNCTION public.invoice_finance_is_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT EXISTS (SELECT 1 FROM public.employees e WHERE e.id = public.current_invoice_employee_id()
    AND (e.role::text = 'admin' OR e.access_level::text = 'admin'
      OR 'admin' = ANY(coalesce(e.permissions, '{}'::text[]))));
$$;

CREATE OR REPLACE FUNCTION public.invoice_finance_scope()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT coalesce((SELECT CASE
    WHEN public.current_session_is_seller_portal() THEN 'none'
    WHEN public.invoice_finance_is_admin() THEN 'company'
    WHEN e.finance_access_scope = 'sales'
      OR (e.finance_access_scope = 'inherit' AND a.slug = 'sales-specialist') THEN 'sales'
    WHEN coalesce(e.permissions, '{}'::text[]) && ARRAY[
      'finances_view','finances_manage','invoices_view','invoices_manage','ksef_manage'
    ]::text[] THEN 'company'
    ELSE 'none' END
  FROM public.employees e LEFT JOIN public.access_levels a ON a.id = e.access_level_id
  WHERE e.id = public.current_invoice_employee_id()), 'none');
$$;

CREATE OR REPLACE FUNCTION public.protect_employee_finance_access_scope()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF auth.uid() IS NULL OR auth.role() = 'service_role' OR public.invoice_finance_is_admin() THEN RETURN NEW; END IF;
  IF (TG_OP = 'INSERT' AND NEW.finance_access_scope <> 'inherit')
    OR (TG_OP = 'UPDATE' AND NEW.finance_access_scope IS DISTINCT FROM OLD.finance_access_scope) THEN
    RAISE EXCEPTION 'Zakres danych finansowych może zmienić wyłącznie administrator.' USING ERRCODE = '42501';
  END IF;
  IF public.invoice_finance_scope() = 'sales' AND (TG_OP = 'INSERT' OR
    ROW(NEW.role, NEW.access_level, NEW.access_level_id, NEW.permissions, NEW.auth_user_id,
      NEW.my_company_ids, NEW.company_access_mode, NEW.invoice_company_permissions)
    IS DISTINCT FROM ROW(OLD.role, OLD.access_level, OLD.access_level_id, OLD.permissions, OLD.auth_user_id,
      OLD.my_company_ids, OLD.company_access_mode, OLD.invoice_company_permissions)) THEN
    RAISE EXCEPTION 'Sprzedawca nie może zmieniać uprawnień ani przypisań kont pracowników.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER zzz_protect_employee_finance_access_scope BEFORE INSERT OR UPDATE ON public.employees
  FOR EACH ROW EXECUTE FUNCTION public.protect_employee_finance_access_scope();

CREATE OR REPLACE FUNCTION public.finance_can_view()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT public.invoice_finance_scope() = 'company';
$$;
CREATE OR REPLACE FUNCTION public.finance_can_manage()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT public.invoice_finance_scope() = 'company' AND EXISTS (
    SELECT 1 FROM public.employees e WHERE e.id = public.current_invoice_employee_id()
      AND (public.invoice_finance_is_admin()
        OR coalesce(e.permissions, '{}'::text[]) && ARRAY['finances_manage','invoices_manage']::text[]));
$$;
CREATE OR REPLACE FUNCTION public.finance_company_visible(p_company_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT public.finance_can_view() AND public.employee_can_access_company(public.current_invoice_employee_id(), p_company_id);
$$;

CREATE OR REPLACE FUNCTION public.can_view_invoices()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  -- Historical reporting RPCs use this as a company-wide capability.
  SELECT public.finance_can_view();
$$;
CREATE OR REPLACE FUNCTION public.can_manage_invoices()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT public.finance_can_manage();
$$;
CREATE OR REPLACE FUNCTION public.can_manage_invoice_company(p_company_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT (public.invoice_finance_scope() = 'sales' OR public.can_manage_invoices()) AND EXISTS (
    SELECT 1 FROM public.employees e WHERE e.id = public.current_invoice_employee_id()
      AND (public.invoice_finance_is_admin() OR (
        p_company_id IS NOT NULL AND public.employee_can_access_company(e.id, p_company_id)
        AND (coalesce(e.invoice_company_permissions, '{}'::jsonb) = '{}'::jsonb
          OR coalesce(e.invoice_company_permissions -> p_company_id::text, '[]'::jsonb) ?| ARRAY['issue','manage'])
      )));
$$;
CREATE OR REPLACE FUNCTION public.can_view_invoice_company(p_company_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT public.invoice_finance_scope() IN ('sales','company') AND EXISTS (
    SELECT 1 FROM public.employees e WHERE e.id = public.current_invoice_employee_id()
      AND (public.invoice_finance_is_admin() OR (
        p_company_id IS NOT NULL AND public.employee_can_access_company(e.id, p_company_id)
        AND (coalesce(e.invoice_company_permissions, '{}'::jsonb) = '{}'::jsonb
          OR coalesce(e.invoice_company_permissions -> p_company_id::text, '[]'::jsonb)
            ?| ARRAY['view','view_own','view_all','issue','manage'])
      )));
$$;
CREATE OR REPLACE FUNCTION public.can_view_invoice_row(p_company_id uuid, p_created_by uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT public.can_view_invoice_company(p_company_id) AND EXISTS (
    SELECT 1 FROM public.employees e WHERE e.id = public.current_invoice_employee_id()
      AND (public.invoice_finance_is_admin() OR CASE WHEN public.invoice_finance_scope() = 'sales'
        THEN p_created_by IN (e.id, e.auth_user_id)
        ELSE coalesce(e.invoice_company_permissions, '{}'::jsonb) = '{}'::jsonb
          OR coalesce(e.invoice_company_permissions -> p_company_id::text, '[]'::jsonb) ?| ARRAY['view_all','manage']
          OR (p_created_by IN (e.id, e.auth_user_id)
            AND coalesce(e.invoice_company_permissions -> p_company_id::text, '[]'::jsonb)
              ?| ARRAY['view','view_own','issue']) END));
$$;
CREATE OR REPLACE FUNCTION public.can_manage_invoice(p_invoice_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT EXISTS (SELECT 1 FROM public.invoices i WHERE i.id = p_invoice_id
    AND public.can_manage_invoice_company(i.my_company_id)
    AND public.can_view_invoice_row(i.my_company_id, i.created_by));
$$;

CREATE OR REPLACE FUNCTION public.get_related_invoices(p_invoice_id uuid)
RETURNS TABLE (id uuid, invoice_number text, invoice_type text, status text, issue_date date,
  total_gross numeric, relation_type text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT i.id, i.invoice_number::text, i.invoice_type::text, i.status::text, i.issue_date,
    i.total_gross, 'corrects_this'::text
  FROM public.invoices i WHERE i.related_invoice_id = p_invoice_id
    AND public.can_view_invoice(p_invoice_id) AND public.can_view_invoice(i.id)
  UNION ALL
  SELECT i.id, i.invoice_number::text, i.invoice_type::text, i.status::text, i.issue_date,
    i.total_gross, 'corrected_by_this'::text
  FROM public.invoices source JOIN public.invoices i ON i.id = source.related_invoice_id
  WHERE source.id = p_invoice_id AND public.can_view_invoice(p_invoice_id) AND public.can_view_invoice(i.id);
$$;
REVOKE ALL ON FUNCTION public.get_related_invoices(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_related_invoices(uuid) TO authenticated, service_role;

-- Accepted commercial sources, not an event's technical creator, establish
-- which sale belongs to the employee. No unrelated event creator fallback.
CREATE OR REPLACE FUNCTION public.invoice_sales_event_owned(p_event_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.events event JOIN public.employees actor
      ON actor.id = public.current_invoice_employee_id()
    WHERE event.id = p_event_id AND public.invoice_finance_scope() = 'sales'
      AND public.employee_can_access_company(actor.id, event.my_company_id)
      AND CASE WHEN event.financial_source = 'calculation' THEN EXISTS (
        SELECT 1 FROM public.event_calculations c WHERE c.id = event.accepted_calculation_id
          AND c.event_id = event.id AND c.is_accepted = true AND c.created_by IN (actor.id, actor.auth_user_id)
      ) ELSE EXISTS (
        SELECT 1 FROM public.offers o WHERE o.event_id = event.id AND o.status::text = 'accepted'
          AND o.my_company_id IS NOT DISTINCT FROM event.my_company_id
          AND (CASE WHEN o.sales_channel = 'seller_portal' THEN
            EXISTS (SELECT 1 FROM public.sales_partner_profiles p JOIN public.contacts c ON c.id = p.contact_id
              WHERE p.id = o.sales_partner_id AND c.owner_id = actor.id)
          ELSE o.created_by IN (actor.id, actor.auth_user_id) END)
      ) END);
$$;

-- Restrictive policies narrow historical permissive FOR ALL policies too.
CREATE POLICY invoices_sales_scope ON public.invoices AS RESTRICTIVE FOR ALL TO authenticated
  USING (public.can_view_invoice_row(my_company_id, created_by))
  WITH CHECK (public.can_view_invoice_row(my_company_id, created_by));
CREATE POLICY invoice_allocations_sales_scope ON public.invoice_event_allocations AS RESTRICTIVE FOR SELECT TO authenticated
  USING (public.invoice_finance_scope() <> 'sales' OR public.can_view_invoice(invoice_id));

CREATE OR REPLACE FUNCTION public.guard_sales_invoice_write()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF public.invoice_finance_scope() <> 'sales' OR auth.role() = 'service_role' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF; RETURN NEW;
  END IF;
  IF TG_OP <> 'INSERT' AND NOT public.can_view_invoice_row(OLD.my_company_id, OLD.created_by) THEN
    RAISE EXCEPTION 'Możesz zmieniać tylko faktury wystawione przez siebie.' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  IF NOT public.can_manage_invoice_company(NEW.my_company_id)
    OR NOT public.can_view_invoice_row(NEW.my_company_id, NEW.created_by)
    OR (TG_OP = 'UPDATE' AND NEW.created_by IS DISTINCT FROM OLD.created_by) THEN
    RAISE EXCEPTION 'Faktura musi zachować własnego wystawcę i dostępną działalność.' USING ERRCODE = '42501';
  END IF;
  IF NEW.related_invoice_id IS NOT NULL AND NOT public.can_manage_invoice(NEW.related_invoice_id) THEN
    RAISE EXCEPTION 'Brak dostępu do faktury źródłowej.' USING ERRCODE = '42501';
  END IF;
  IF NEW.event_id IS NOT NULL AND NOT public.invoice_sales_event_owned(NEW.event_id) THEN
    RAISE EXCEPTION 'Faktura może dotyczyć wyłącznie wydarzenia z Twojej sprzedaży.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER zzzz_guard_sales_invoice_write BEFORE INSERT OR UPDATE OR DELETE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.guard_sales_invoice_write();

CREATE OR REPLACE FUNCTION public.guard_sales_invoice_relation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE r jsonb; source_id uuid; target_id uuid;
BEGIN
  IF public.invoice_finance_scope() <> 'sales' OR auth.role() = 'service_role' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF; RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN r := to_jsonb(OLD); ELSE r := to_jsonb(NEW); END IF;
  source_id := coalesce((r->>'advance_invoice_id')::uuid, (r->>'source_invoice_id')::uuid, (r->>'invoice_id')::uuid);
  target_id := coalesce((r->>'final_invoice_id')::uuid, (r->>'target_invoice_id')::uuid, source_id);
  IF NOT public.can_manage_invoice(source_id) OR NOT public.can_manage_invoice(target_id)
    OR (r->>'event_id' IS NOT NULL AND NOT public.invoice_sales_event_owned((r->>'event_id')::uuid)) THEN
    RAISE EXCEPTION 'Nie można powiązać cudzego dokumentu ani sprzedaży.' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END; $$;
CREATE TRIGGER sales_invoice_settlement_guard BEFORE INSERT OR UPDATE OR DELETE ON public.invoice_settlements
  FOR EACH ROW EXECUTE FUNCTION public.guard_sales_invoice_relation();
CREATE TRIGGER sales_invoice_source_guard BEFORE INSERT OR UPDATE OR DELETE ON public.invoice_source_links
  FOR EACH ROW EXECUTE FUNCTION public.guard_sales_invoice_relation();
CREATE TRIGGER sales_invoice_allocation_guard BEFORE INSERT OR UPDATE OR DELETE ON public.invoice_event_allocations
  FOR EACH ROW EXECUTE FUNCTION public.guard_sales_invoice_relation();

CREATE POLICY ksef_sales_read_scope ON public.ksef_invoices AS RESTRICTIVE FOR SELECT TO authenticated
  USING (public.invoice_finance_scope() <> 'sales' OR (invoice_type::text = 'issued' AND public.can_view_invoice(invoice_id)));
CREATE POLICY ksef_own_issued_read ON public.ksef_invoices FOR SELECT TO authenticated
  USING (public.invoice_finance_scope() = 'sales' AND invoice_type::text = 'issued' AND public.can_view_invoice(invoice_id));
CREATE POLICY ksef_sales_insert_scope ON public.ksef_invoices AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (public.invoice_finance_scope() <> 'sales');
CREATE POLICY ksef_sales_update_scope ON public.ksef_invoices AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (public.invoice_finance_scope() <> 'sales') WITH CHECK (public.invoice_finance_scope() <> 'sales');
CREATE POLICY ksef_sales_delete_scope ON public.ksef_invoices AS RESTRICTIVE FOR DELETE TO authenticated
  USING (public.invoice_finance_scope() <> 'sales');

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'ksef_credentials','ksef_sync_log','ksef_invoice_payments','ksef_invoice_notification_events',
    'bank_statements','bank_transactions','bank_transaction_invoice_matches','bank_transaction_supporting_documents',
    'bank_counterparty_mapping_templates','bank_ai_reconciliation_reports','legacy_bank_transaction_match_audit',
    'financial_payment_review_issues','financial_entries','financial_source_categories','external_invoices',
    'monthly_financial_summaries','event_costs','event_cash_transactions','accounting_document_followups',
    'accounting_month_handoffs','saldeo_delivery_log','employee_compensation','compensation_settings',
    'personnel_contracts','personnel_contract_payments','personnel_people','personnel_contract_documents',
    'personnel_contract_rates','personnel_work_entries','personnel_settlements'
  ] LOOP
    IF to_regclass('public.' || table_name) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
      EXECUTE format('CREATE POLICY sales_finance_private ON public.%I AS RESTRICTIVE FOR ALL TO authenticated
        USING (public.invoice_finance_scope() <> ''sales'') WITH CHECK (public.invoice_finance_scope() <> ''sales'')', table_name);
    END IF;
  END LOOP;
END; $$;

-- These helpers are also called from privileged RPCs, so UI/RLS alone is not
-- enough. Sales cannot inherit payroll access from a historical finance flag.
CREATE OR REPLACE FUNCTION public.personnel_can_access(p_manage boolean DEFAULT false)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT public.invoice_finance_scope() <> 'sales' AND coalesce(NOT public.current_session_is_seller_portal()
    AND EXISTS (SELECT 1 FROM public.employees e WHERE e.id = public.current_invoice_employee_id()
      AND (public.invoice_finance_is_admin() OR 'personnel_manage' = ANY(coalesce(e.permissions, '{}'))
        OR (NOT p_manage AND 'personnel_view' = ANY(coalesce(e.permissions, '{}'))))), false);
$$;
CREATE OR REPLACE FUNCTION public.personnel_can_read_contract(p_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT public.invoice_finance_scope() <> 'sales' AND (public.personnel_can_access() OR public.personnel_owns_contract(p_id));
$$;
CREATE OR REPLACE FUNCTION public.compensation_can_access(manage boolean DEFAULT false, admin_only boolean DEFAULT false)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT public.invoice_finance_scope() <> 'sales' AND coalesce(NOT public.current_session_is_seller_portal()
    AND EXISTS (SELECT 1 FROM public.employees e WHERE e.id = public.current_invoice_employee_id()
      AND (public.invoice_finance_is_admin() OR (NOT admin_only
        AND (coalesce(e.permissions, '{}') && ARRAY['employees_manage','finances_manage']
          OR (NOT manage AND 'finances_view' = ANY(coalesce(e.permissions, '{}'))))))), false);
$$;
CREATE OR REPLACE FUNCTION public.commission_settlement_can_access(p_event_id uuid DEFAULT NULL, p_manage boolean DEFAULT false)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT coalesce(auth.uid() IS NOT NULL AND NOT public.current_session_is_seller_portal()
    AND CASE WHEN p_manage THEN public.finance_can_manage() ELSE public.finance_can_view() END
    AND (p_event_id IS NULL OR (public.current_employee_can_view_event(p_event_id)
      AND public.current_employee_can_access_event_company(p_event_id))), false);
$$;
CREATE OR REPLACE FUNCTION public.sales_commission_visible(p_commission_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT EXISTS (SELECT 1 FROM public.event_commissions commission
    JOIN public.events event ON event.id = commission.event_id
    LEFT JOIN public.sales_partner_profiles profile ON profile.id = commission.sales_partner_id
    JOIN public.contacts contact ON contact.id = coalesce(profile.contact_id, commission.contact_id)
    WHERE commission.id = p_commission_id AND public.invoice_finance_scope() = 'sales'
      AND contact.owner_id = public.current_invoice_employee_id()
      AND public.employee_can_access_company(public.current_invoice_employee_id(), event.my_company_id));
$$;
CREATE POLICY commissions_sales_read ON public.event_commissions FOR SELECT TO authenticated
  USING (public.sales_commission_visible(id));
CREATE POLICY commissions_sales_read_scope ON public.event_commissions AS RESTRICTIVE FOR SELECT TO authenticated
  USING (public.invoice_finance_scope() <> 'sales' OR public.sales_commission_visible(id));
CREATE POLICY commissions_sales_insert_scope ON public.event_commissions AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (public.invoice_finance_scope() <> 'sales');
CREATE POLICY commissions_sales_update_scope ON public.event_commissions AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (public.invoice_finance_scope() <> 'sales') WITH CHECK (public.invoice_finance_scope() <> 'sales');
CREATE POLICY commissions_sales_delete_scope ON public.event_commissions AS RESTRICTIVE FOR DELETE TO authenticated
  USING (public.invoice_finance_scope() <> 'sales');
CREATE POLICY commission_payouts_sales_read ON public.event_commission_payouts FOR SELECT TO authenticated
  USING (public.sales_commission_visible(commission_id));
CREATE POLICY commission_payouts_sales_scope ON public.event_commission_payouts AS RESTRICTIVE FOR SELECT TO authenticated
  USING (public.invoice_finance_scope() <> 'sales' OR public.sales_commission_visible(commission_id));

CREATE OR REPLACE FUNCTION public.get_invoice_finance_access()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE actor uuid := public.current_invoice_employee_id(); scope text := public.invoice_finance_scope();
  contacts jsonb := '[]'; partners jsonb := '[]'; events jsonb := '[]'; can_issue boolean;
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
    'canViewOwnInvoices', scope IN ('sales','company'), 'canIssueInvoices', can_issue,
    'canViewCompanyFinance', public.finance_can_view(), 'canManageCompanyFinance', public.finance_can_manage(),
    'managedSellerContactIds', contacts, 'managedSellerPartnerIds', partners, 'soldEventIds', events);
END; $$;

CREATE OR REPLACE FUNCTION public.get_commission_settlements(
  p_mode text DEFAULT 'crm', p_account_type text DEFAULT NULL, p_account_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE seller_id uuid; account_type text := p_account_type; account_id uuid := p_account_id;
  rows jsonb; sales_scope boolean := public.invoice_finance_scope() = 'sales';
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Wymagane logowanie.' USING ERRCODE = '42501'; END IF;
  IF p_mode = 'seller' THEN
    IF p_account_id IS NOT NULL OR p_account_type IS NOT NULL THEN
      RAISE EXCEPTION 'Portal udostępnia tylko własne konto.' USING ERRCODE = '42501';
    END IF;
    seller_id := public.current_sales_partner_id();
    IF seller_id IS NULL THEN RAISE EXCEPTION 'Brak dostępu do portalu sprzedawcy.' USING ERRCODE = '42501'; END IF;
    account_type := 'partner'; account_id := seller_id;
  ELSIF p_mode = 'crm' THEN
    IF account_type IS NULL OR account_type NOT IN ('contact','partner','employee','organization') OR account_id IS NULL THEN
      RAISE EXCEPTION 'Wybierz prawidłowe konto prowizji.';
    END IF;
    IF sales_scope THEN
      IF NOT EXISTS (SELECT 1 FROM public.contacts c WHERE c.owner_id = public.current_invoice_employee_id()
        AND ((account_type = 'contact' AND c.id = account_id)
          OR (account_type = 'partner' AND EXISTS (SELECT 1 FROM public.sales_partner_profiles p
            WHERE p.id = account_id AND p.contact_id = c.id)))) THEN
        RAISE EXCEPTION 'Możesz zobaczyć wyłącznie sprzedawców, których jesteś opiekunem.' USING ERRCODE = '42501';
      END IF;
    ELSIF NOT public.commission_settlement_can_access(NULL, false) THEN
      RAISE EXCEPTION 'Brak dostępu do finansów.' USING ERRCODE = '42501';
    END IF;
  ELSE RAISE EXCEPTION 'Nieprawidłowy widok rozliczeń.';
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', c.id, 'event_id', c.event_id, 'event_name', e.name, 'event_date', e.event_date,
    'my_company_id', e.my_company_id, 'company_name', company.name,
    'can_manage', p_mode = 'crm' AND public.commission_settlement_can_access(c.event_id, true),
    'beneficiary_name', c.beneficiary_name, 'amount', c.amount,
    'company_cost_amount', CASE WHEN p_mode = 'crm' AND NOT sales_scope THEN coalesce(c.company_cost_amount,c.amount) ELSE NULL END,
    'status', c.status, 'automatic_waiting_for_offer', c.automatic_waiting_for_offer,
    'created_at', c.created_at, 'due_date', c.due_date, 'payment_method', c.payment_method,
    'paid_amount', CASE WHEN payments.count = 0 AND c.status = 'paid' THEN c.amount ELSE payments.total END,
    'remaining_amount', CASE WHEN c.status IN ('cancelled','paid') THEN 0 ELSE greatest(0,c.amount-payments.total) END,
    'payments', CASE WHEN payments.count = 0 AND c.status = 'paid' THEN jsonb_build_array(jsonb_build_object(
      'id', 'legacy:' || c.id::text, 'commission_id', c.id, 'amount', c.amount,
      'payment_date', (c.paid_at AT TIME ZONE 'Europe/Warsaw')::date,
      'recorded_at', NULL, 'reference', NULL, 'note', NULL, 'source', 'legacy'
    )) ELSE payments.entries END
  ) ORDER BY e.event_date DESC NULLS LAST,c.created_at DESC,c.id), '[]'::jsonb) INTO rows
  FROM public.event_commissions c JOIN public.events e ON e.id = c.event_id
  LEFT JOIN public.my_companies company ON company.id = e.my_company_id
  LEFT JOIN public.sales_partner_profiles profile ON profile.id = c.sales_partner_id
  CROSS JOIN LATERAL (
    SELECT count(*) AS count, coalesce(sum(p.amount),0) AS total,
      coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'commission_id', p.commission_id, 'amount', p.amount,
        'payment_date', p.payment_date, 'recorded_at', p.recorded_at, 'reference', p.reference,
        'note', CASE WHEN p_mode = 'crm' AND NOT sales_scope THEN p.note ELSE NULL END, 'source', 'ledger'
      ) ORDER BY p.payment_date DESC,p.recorded_at DESC,p.id), '[]'::jsonb) AS entries
    FROM public.event_commission_payouts p WHERE p.commission_id = c.id
  ) payments
  WHERE (p_mode = 'seller' OR CASE WHEN sales_scope THEN public.sales_commission_visible(c.id)
    ELSE public.commission_settlement_can_access(c.event_id,false) END)
    AND CASE account_type
      WHEN 'contact' THEN c.contact_id = account_id OR profile.contact_id = account_id
      WHEN 'employee' THEN c.employee_id = account_id OR c.salesperson_id = account_id OR profile.employee_id = account_id
      WHEN 'organization' THEN c.organization_id = account_id
      WHEN 'partner' THEN c.sales_partner_id = account_id OR (c.sales_partner_id IS NULL AND EXISTS (
        SELECT 1 FROM public.sales_partner_profiles own_profile WHERE own_profile.id = account_id
          AND ((own_profile.contact_id IS NOT NULL AND c.contact_id = own_profile.contact_id)
            OR (own_profile.employee_id IS NOT NULL AND (c.employee_id = own_profile.employee_id OR c.salesperson_id = own_profile.employee_id)))))
      ELSE false END;
  RETURN jsonb_build_object('mode', p_mode, 'accountType', account_type, 'accountId', account_id,
    'canManage', p_mode = 'crm' AND public.commission_settlement_can_access(NULL,true),
    'currency','PLN','commissions',rows);
END; $$;

-- A separate aggregate RPC can include invoices issued by finance for an owned
-- event, without revealing those invoice records, PDFs, buyer details or costs.
CREATE OR REPLACE FUNCTION public.get_my_sales_financial_report(
  p_date_from date, p_date_to date, p_company_ids uuid[] DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE result jsonb;
BEGIN
  IF public.invoice_finance_scope() <> 'sales' OR auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Raport obejmuje wyłącznie własną sprzedaż aktywnego sprzedawcy.' USING ERRCODE = '42501';
  END IF;
  IF p_date_from IS NULL OR p_date_to IS NULL OR p_date_from > p_date_to THEN
    RAISE EXCEPTION 'Podaj prawidłowy zakres dat wydarzeń.';
  END IF;
  WITH owned_events AS MATERIALIZED (
    SELECT e.id, e.name, e.event_date, e.status FROM public.events e
    WHERE e.event_date::date BETWEEN p_date_from AND p_date_to
      AND public.invoice_sales_event_owned(e.id)
      AND (p_company_ids IS NULL OR cardinality(p_company_ids) = 0 OR e.my_company_id = ANY(p_company_ids))
  ), allocation AS MATERIALIZED (
    SELECT a.invoice_id, a.event_id,
      a.allocation_weight / nullif(sum(a.allocation_weight) OVER (PARTITION BY a.invoice_id), 0) AS ratio
    FROM public.invoice_event_allocations a
    UNION ALL
    SELECT i.id, i.event_id, 1::numeric FROM public.invoices i
    WHERE i.event_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.invoice_event_allocations a WHERE a.invoice_id = i.id)
  ), documents AS MATERIALIZED (
    SELECT i.id, a.event_id, a.ratio, upper(coalesce(i.currency_code, 'PLN')) AS currency,
      CASE WHEN i.invoice_type = 'final' THEN coalesce(nullif(i.settlement_summary->>'remainingGross', '')::numeric, i.total_gross)
        ELSE i.total_gross END AS gross,
      public.invoice_confirmed_received_amount(i.id) AS received, i.payment_due_date
    FROM public.invoices i JOIN allocation a ON a.invoice_id = i.id
    JOIN owned_events e ON e.id = a.event_id
    WHERE i.status::text IN ('issued','sent','paid','overdue') AND NOT coalesce(i.is_proforma, false)
      AND i.invoice_type IN ('vat','advance','final','corrective') AND a.ratio > 0
  ), amounts AS (
    SELECT d.*, round(gross * ratio, 2) AS invoiced,
      round(sign(gross) * least(abs(gross), greatest(0, received)) * ratio, 2) AS paid,
      round(greatest(0, gross - greatest(0, received)) * ratio, 2) AS outstanding
    FROM documents d
  ), event_currency AS (
    SELECT e.id, e.name, e.event_date, e.status, coalesce(a.currency, 'PLN') AS currency,
      count(a.id) > 0 AS invoiced_event, coalesce(sum(a.invoiced), 0) AS invoiced_gross,
      coalesce(sum(a.paid), 0) AS paid_gross, coalesce(sum(a.outstanding), 0) AS outstanding_gross,
      coalesce(sum(a.outstanding) FILTER (WHERE a.payment_due_date < current_date), 0) AS overdue_gross
    FROM owned_events e LEFT JOIN amounts a ON a.event_id = e.id
    GROUP BY e.id, e.name, e.event_date, e.status, a.currency
  ), currency_totals AS (
    SELECT currency, count(DISTINCT id) AS sold_events,
      count(DISTINCT id) FILTER (WHERE invoiced_event) AS invoiced_events,
      sum(invoiced_gross) AS invoiced_gross, sum(paid_gross) AS paid_gross,
      sum(outstanding_gross) AS outstanding_gross, sum(overdue_gross) AS overdue_gross
    FROM event_currency GROUP BY currency
  ), months AS (
    SELECT to_char(event_date, 'YYYY-MM') AS key, to_char(event_date, 'YYYY-MM') AS label, currency,
      count(DISTINCT id) AS events, sum(invoiced_gross) AS invoiced_gross, sum(paid_gross) AS paid_gross,
      sum(outstanding_gross) AS outstanding_gross
    FROM event_currency GROUP BY to_char(event_date, 'YYYY-MM'), currency
  )
  SELECT jsonb_build_object('scope', 'own_sales', 'basis', 'event_date', 'date_from', p_date_from, 'date_to', p_date_to,
    'totals', jsonb_build_object('currency', 'PLN', 'sold_events', (SELECT count(*) FROM owned_events),
      'invoiced_events', (SELECT count(DISTINCT event_id) FROM amounts),
      'invoiced_gross', coalesce((SELECT invoiced_gross FROM currency_totals WHERE currency = 'PLN'), 0),
      'paid_gross', coalesce((SELECT paid_gross FROM currency_totals WHERE currency = 'PLN'), 0),
      'outstanding_gross', coalesce((SELECT outstanding_gross FROM currency_totals WHERE currency = 'PLN'), 0),
      'overdue_gross', coalesce((SELECT overdue_gross FROM currency_totals WHERE currency = 'PLN'), 0)),
    'currency_totals', coalesce((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.currency) FROM currency_totals c), '[]'),
    'months', coalesce((SELECT jsonb_agg(to_jsonb(m) ORDER BY m.key, m.currency) FROM months m), '[]'),
    'events', coalesce((SELECT jsonb_agg(to_jsonb(e) ORDER BY e.event_date DESC, e.id, e.currency) FROM event_currency e), '[]'))
  INTO result;
  RETURN result;
END; $$;

REVOKE ALL ON FUNCTION public.invoice_finance_is_admin(), public.invoice_finance_scope(),
  public.invoice_sales_event_owned(uuid), public.sales_commission_visible(uuid),
  public.get_invoice_finance_access(), public.get_my_sales_financial_report(date,date,uuid[])
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.invoice_finance_is_admin(), public.invoice_finance_scope(),
  public.invoice_sales_event_owned(uuid), public.sales_commission_visible(uuid),
  public.get_invoice_finance_access(), public.get_my_sales_financial_report(date,date,uuid[])
  TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.protect_employee_finance_access_scope(), public.guard_sales_invoice_write(),
  public.guard_sales_invoice_relation() FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
