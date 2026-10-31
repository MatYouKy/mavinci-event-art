BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '25s';

-- Future-only assignment. Never rewrite the company on historical offers,
-- calculations, payments or invoices, and never backfill existing events.
CREATE TABLE public.event_invoice_company_sources (
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  invoice_id uuid NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  source_kind text NOT NULL CHECK (source_kind IN ('offer', 'calculation')),
  source_id uuid NOT NULL,
  source_company_id uuid REFERENCES public.my_companies(id),
  previous_company_id uuid REFERENCES public.my_companies(id),
  assigned_company_id uuid NOT NULL REFERENCES public.my_companies(id),
  changed_by uuid REFERENCES public.employees(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, invoice_id, source_kind, source_id)
);
ALTER TABLE public.event_invoice_company_sources ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.event_invoice_company_sources FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.event_invoice_company_sources TO service_role;
COMMENT ON TABLE public.event_invoice_company_sources IS
  'Dokładne zaakceptowane źródła cen zachowane przy zmianie firmy wydarzenia przez wystawioną fakturę. Zapisy wyłącznie przez trigger.';

CREATE FUNCTION public.event_invoice_source_company_matches(
  p_event_id uuid, p_kind text, p_source_id uuid, p_source_company_id uuid
) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.event_invoice_company_sources s
    JOIN public.events e ON e.id = s.event_id AND e.my_company_id = s.assigned_company_id
    JOIN public.invoices i ON i.id = s.invoice_id AND i.my_company_id = s.assigned_company_id
    WHERE s.event_id = p_event_id AND s.source_kind = p_kind AND s.source_id = p_source_id
      AND s.source_company_id IS NOT DISTINCT FROM p_source_company_id
      -- Provenance records a completed authorized reassignment; changing payment
      -- status or cancelling an invoice does not rewrite that historical fact.
      AND (EXISTS (SELECT 1 FROM public.invoice_event_allocations a
        WHERE a.invoice_id = i.id AND a.event_id = e.id AND a.allocation_weight > 0)
        OR (i.event_id = e.id AND NOT EXISTS (
          SELECT 1 FROM public.invoice_event_allocations a WHERE a.invoice_id = i.id)))
  );
$function$;
REVOKE ALL ON FUNCTION public.event_invoice_source_company_matches(uuid,text,uuid,uuid)
  FROM PUBLIC, anon, authenticated;

-- Read-only, scoped check used by the final-invoice form. It does not expose
-- source rows or permit arbitrary cross-company source selection.
CREATE FUNCTION public.can_use_event_invoice_source(p_event_id uuid, p_source_kind text, p_source_id uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public AS $function$
DECLARE source_company uuid; event_company uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT (public.can_view_event_commercials(p_event_id, false)
    OR public.invoice_sales_event_owned(p_event_id)) THEN
    RAISE EXCEPTION 'Brak dostępu do źródła cen wydarzenia.' USING ERRCODE = '42501';
  END IF;
  SELECT my_company_id INTO event_company FROM public.events WHERE id = p_event_id;
  IF p_source_kind = 'offer' THEN
    SELECT o.my_company_id INTO source_company FROM public.offers o
    WHERE o.id = p_source_id AND o.event_id = p_event_id AND o.status::text = 'accepted'
      AND public.crm_record_id_scope_allows('offers', o.id);
  ELSIF p_source_kind = 'calculation' THEN
    SELECT c.my_company_id INTO source_company FROM public.event_calculations c
    JOIN public.events e ON e.id = c.event_id AND e.accepted_calculation_id = c.id
    WHERE c.id = p_source_id AND c.event_id = p_event_id AND c.is_accepted;
  ELSE RETURN false;
  END IF;
  IF NOT FOUND THEN RETURN false; END IF;
  RETURN source_company IS NOT DISTINCT FROM event_company
    OR public.event_invoice_source_company_matches(p_event_id, p_source_kind, p_source_id, source_company);
END;
$function$;
REVOKE ALL ON FUNCTION public.can_use_event_invoice_source(uuid,text,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_use_event_invoice_source(uuid,text,uuid) TO authenticated;

-- Extend only the existing source-company predicates, preserving ownership,
-- company permissions and all other rules in the deployed function versions.
DO $migration$
DECLARE original text; replacement text;
BEGIN
  SELECT pg_get_functiondef('public.invoice_sales_event_owned(uuid)'::regprocedure) INTO original;
  replacement := replace(original,
    'AND o.my_company_id IS NOT DISTINCT FROM event.my_company_id',
    'AND (o.my_company_id IS NOT DISTINCT FROM event.my_company_id OR public.event_invoice_source_company_matches(event.id, ''offer'', o.id, o.my_company_id))');
  IF replacement = original THEN RAISE EXCEPTION 'Nie rozpoznano reguły własności sprzedaży; przerwano migrację.'; END IF;
  EXECUTE replacement;

  SELECT pg_get_functiondef('public.sync_event_billing_seller_commissions(uuid)'::regprocedure) INTO original;
  replacement := replace(original,
    '(o.my_company_id IS NULL OR o.my_company_id = e.my_company_id)',
    '(o.my_company_id IS NULL OR o.my_company_id = e.my_company_id OR public.event_invoice_source_company_matches(e.id, ''offer'', o.id, o.my_company_id))');
  IF replacement = original THEN RAISE EXCEPTION 'Nie rozpoznano reguły źródła prowizji; przerwano migrację.'; END IF;
  EXECUTE replacement;
END;
$migration$;

CREATE FUNCTION public.apply_invoice_event_company(p_invoice_id uuid, p_apply boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public AS $function$
DECLARE
  i public.invoices%ROWTYPE;
  e public.events%ROWTYPE;
  v_event_id uuid;
  actor uuid := public.current_invoice_employee_id();
BEGIN
  SELECT * INTO i FROM public.invoices WHERE id = p_invoice_id;
  IF NOT FOUND OR i.my_company_id IS NULL OR i.is_proforma IS TRUE
    OR i.invoice_type NOT IN ('vat','advance','final') OR i.status IN ('cancelled','proforma') THEN RETURN; END IF;
  IF p_apply AND i.status NOT IN ('issued','sent','paid','overdue') THEN RETURN; END IF;

  -- The same order is used for validation and deferred assignment. Row locks
  -- serialize competing invoices for the same event, including KSeF send claims.
  FOR v_event_id IN
    SELECT a.event_id FROM public.invoice_event_allocations a
      WHERE a.invoice_id = i.id AND a.allocation_weight > 0
    UNION
    SELECT i.event_id WHERE i.event_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.invoice_event_allocations a WHERE a.invoice_id = i.id)
    ORDER BY 1
  LOOP
    SELECT * INTO e FROM public.events WHERE id = v_event_id FOR UPDATE;
    IF NOT FOUND THEN CONTINUE; END IF;

    IF EXISTS (
      SELECT 1 FROM public.invoices other
      WHERE other.id <> i.id AND other.is_proforma IS NOT TRUE
        AND other.invoice_type IN ('vat','advance','final') AND other.status <> 'cancelled'
        AND other.my_company_id IS NOT NULL AND other.my_company_id <> i.my_company_id
        AND (other.status IN ('issued','sent','paid','overdue')
          OR other.ksef_status IN ('pending','sent','accepted') OR other.ksef_reference_number IS NOT NULL)
        AND (EXISTS (SELECT 1 FROM public.invoice_event_allocations a
          WHERE a.invoice_id = other.id AND a.event_id = e.id AND a.allocation_weight > 0)
          OR (other.event_id = e.id AND NOT EXISTS (
            SELECT 1 FROM public.invoice_event_allocations a WHERE a.invoice_id = other.id)))
    ) THEN
      RAISE EXCEPTION 'Wydarzenie „%” ma już wystawioną lub wysyłaną fakturę innej firmy. Najpierw wyjaśnij rozliczenie; przypisanie wydarzenia nie zostało zmienione.', e.name;
    END IF;

    IF e.my_company_id IS NOT DISTINCT FROM i.my_company_id THEN CONTINUE; END IF;
    IF auth.uid() IS NOT NULL THEN
      IF NOT public.can_manage_invoice(i.id)
        OR NOT (public.can_view_event_commercials(e.id, true) OR public.invoice_sales_event_owned(e.id))
        OR (e.my_company_id IS NOT NULL AND NOT public.invoice_finance_is_admin()
          AND NOT public.employee_can_access_company(actor, e.my_company_id)) THEN
        RAISE EXCEPTION 'Brak uprawnień do zmiany firmy tego wydarzenia przez fakturę.' USING ERRCODE = '42501';
      END IF;
    ELSIF coalesce(auth.role(), '') NOT IN ('service_role', '') THEN
      RAISE EXCEPTION 'Wymagane logowanie.' USING ERRCODE = '42501';
    END IF;

    IF EXISTS (SELECT 1 FROM public.event_commission_payouts p WHERE p.event_id = e.id) THEN
      RAISE EXCEPTION 'Wydarzenie „%” ma zapisane wypłaty prowizji. Zmiana firmy wymaga wcześniejszego wyjaśnienia tych rozliczeń.', e.name;
    END IF;
    IF NOT p_apply THEN CONTINUE; END IF;

    INSERT INTO public.event_invoice_company_sources (
      event_id, invoice_id, source_kind, source_id, source_company_id,
      previous_company_id, assigned_company_id, changed_by
    )
    SELECT e.id, i.id, source.kind, source.id, source.company_id, e.my_company_id, i.my_company_id, actor
    FROM (
      SELECT 'offer'::text AS kind, o.id, o.my_company_id AS company_id
      FROM public.offers o WHERE o.id = (
        SELECT accepted.id FROM public.offers accepted
        WHERE accepted.event_id = e.id AND accepted.status::text = 'accepted'
          AND (auth.uid() IS NULL OR public.crm_record_id_scope_allows('offers', accepted.id))
        ORDER BY accepted.created_at DESC LIMIT 1
      )
      UNION ALL
      SELECT 'calculation'::text, c.id, c.my_company_id FROM public.event_calculations c
      WHERE c.id = e.accepted_calculation_id AND c.event_id = e.id AND c.is_accepted
    ) source
    WHERE source.company_id IS NOT DISTINCT FROM e.my_company_id
      OR public.event_invoice_source_company_matches(e.id, source.kind, source.id, source.company_id)
    ON CONFLICT (event_id, invoice_id, source_kind, source_id) DO NOTHING;

    UPDATE public.events SET my_company_id = i.my_company_id, updated_at = now() WHERE id = e.id;
    INSERT INTO public.invoice_history(invoice_id, action, changed_by, changes)
    VALUES (i.id, 'event_company_assigned', actor, jsonb_build_object(
      'event_id', e.id, 'previous_company_id', e.my_company_id, 'my_company_id', i.my_company_id));
    INSERT INTO public.event_audit_log(event_id,user_name,action,field_name,old_value,new_value,description)
    VALUES (e.id, 'System — faktura ' || i.invoice_number, 'updated', 'my_company_id',
      to_jsonb(e.my_company_id), to_jsonb(i.my_company_id),
      'Firmę wydarzenia ustawiono na podstawie wystawionej faktury ' || i.invoice_number);
  END LOOP;
END;
$function$;
REVOKE ALL ON FUNCTION public.apply_invoice_event_company(uuid,boolean) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.refresh_invoice_event_company()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public AS $function$
DECLARE should_apply boolean := TG_ARGV[0] = 'apply';
BEGIN
  IF TG_TABLE_NAME = 'invoices' THEN
    IF TG_OP = 'UPDATE' THEN
      -- Paying, refreshing PDF or re-saving an old issued invoice must not
      -- silently reassign historical events. Only actual issuance/new binding.
      IF ROW(NEW.event_id, NEW.my_company_id, NEW.invoice_type, NEW.is_proforma)
        IS NOT DISTINCT FROM ROW(OLD.event_id, OLD.my_company_id, OLD.invoice_type, OLD.is_proforma)
        AND NOT (NEW.status IN ('issued','sent','paid','overdue')
          AND OLD.status NOT IN ('issued','sent','paid','overdue')) THEN
        IF should_apply OR NEW.ksef_status IS DISTINCT FROM 'pending'
          OR NEW.ksef_status IS NOT DISTINCT FROM OLD.ksef_status THEN
          RETURN NULL;
        END IF;
      END IF;
    END IF;
    PERFORM public.apply_invoice_event_company(NEW.id, should_apply);
  ELSE
    IF NEW.allocation_weight <= 0 THEN RETURN NULL; END IF;
    IF TG_OP = 'UPDATE' AND NEW.invoice_id = OLD.invoice_id AND NEW.event_id = OLD.event_id
      AND OLD.allocation_weight > 0 THEN RETURN NULL; END IF;
    PERFORM public.apply_invoice_event_company(NEW.invoice_id, should_apply);
  END IF;
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public.refresh_invoice_event_company() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER invoice_event_company_preflight
AFTER INSERT OR UPDATE ON public.invoices FOR EACH ROW
EXECUTE FUNCTION public.refresh_invoice_event_company('check');
CREATE CONSTRAINT TRIGGER invoice_event_company_assignment
AFTER INSERT OR UPDATE ON public.invoices DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
EXECUTE FUNCTION public.refresh_invoice_event_company('apply');
CREATE TRIGGER invoice_allocation_company_preflight
AFTER INSERT OR UPDATE ON public.invoice_event_allocations FOR EACH ROW
EXECUTE FUNCTION public.refresh_invoice_event_company('check');
CREATE CONSTRAINT TRIGGER invoice_allocation_company_assignment
AFTER INSERT OR UPDATE ON public.invoice_event_allocations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
EXECUTE FUNCTION public.refresh_invoice_event_company('apply');

NOTIFY pgrst, 'reload schema';
COMMIT;
