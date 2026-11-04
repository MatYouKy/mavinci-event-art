-- Kwoty wydarzenia w osobnej tabeli z własnymi regułami dostępu.
-- Kolumny z kwotami w `events` (budżet, przychód, koszty, gotówka) czytał każdy, kto widział wydarzenie — także magazyn
-- i ekipa (przez API i aplikację mobilną). Kwoty trafiają do `event_financials` (odczyt: obszar „kwoty”, can_view_event_area).
-- Zgodność wstecz: zapis do events.budget / expected_revenue / … nadal działa — wyzwalacz przenosi wartość do
-- event_financials i zostawia w events NULL. Funkcje raportowe czytają już z event_financials.

CREATE TABLE IF NOT EXISTS public.event_financials (
  event_id uuid PRIMARY KEY REFERENCES public.events(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
  budget numeric(10,2),
  final_cost numeric(10,2),
  expected_revenue numeric(12,2),
  actual_revenue numeric(12,2),
  estimated_costs numeric(12,2),
  actual_costs numeric(12,2),
  cash_budget numeric,
  actual_cash_revenue numeric,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.event_financials ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS event_financials_values_read ON public.event_financials;
CREATE POLICY event_financials_values_read ON public.event_financials FOR SELECT TO authenticated
  USING (public.can_view_event_area(event_id, 'values'));
-- Zapis wyłącznie przez wyzwalacz na events i funkcje serwera.
REVOKE ALL ON public.event_financials FROM anon, authenticated;
GRANT SELECT ON public.event_financials TO authenticated;

CREATE OR REPLACE FUNCTION private.event_financials_redirect()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE old_budget numeric;
BEGIN
  IF NEW.budget IS NOT NULL OR NEW.final_cost IS NOT NULL OR NEW.expected_revenue IS NOT NULL OR NEW.actual_revenue IS NOT NULL
     OR NEW.estimated_costs IS NOT NULL OR NEW.actual_costs IS NOT NULL OR NEW.cash_budget IS NOT NULL
     OR NEW.actual_cash_revenue IS NOT NULL THEN
    SELECT f.budget INTO old_budget FROM public.event_financials f WHERE f.event_id = NEW.id;
    INSERT INTO public.event_financials AS f (event_id, budget, final_cost, expected_revenue, actual_revenue, estimated_costs,
        actual_costs, cash_budget, actual_cash_revenue)
    VALUES (NEW.id, NEW.budget, NEW.final_cost, NEW.expected_revenue, NEW.actual_revenue, NEW.estimated_costs,
        NEW.actual_costs, NEW.cash_budget, NEW.actual_cash_revenue)
    ON CONFLICT (event_id) DO UPDATE SET
      budget = coalesce(excluded.budget, f.budget),
      final_cost = coalesce(excluded.final_cost, f.final_cost),
      expected_revenue = coalesce(excluded.expected_revenue, f.expected_revenue),
      actual_revenue = coalesce(excluded.actual_revenue, f.actual_revenue),
      estimated_costs = coalesce(excluded.estimated_costs, f.estimated_costs),
      actual_costs = coalesce(excluded.actual_costs, f.actual_costs),
      cash_budget = coalesce(excluded.cash_budget, f.cash_budget),
      actual_cash_revenue = coalesce(excluded.actual_cash_revenue, f.actual_cash_revenue),
      updated_at = now();
    -- Historia zmian budżetu (wcześniej robił to audit_event_changes na kolumnie events.budget).
    IF TG_OP = 'UPDATE' AND NEW.budget IS NOT NULL AND NEW.budget IS DISTINCT FROM old_budget THEN
      INSERT INTO public.event_audit_log(event_id, user_name, action, field_name, old_value, new_value, description)
      VALUES (NEW.id, 'System', 'updated', 'budget', to_jsonb(old_budget), to_jsonb(NEW.budget), 'Zmieniono budżet eventu');
    END IF;
  END IF;
  NEW.budget := NULL; NEW.final_cost := NULL; NEW.expected_revenue := NULL; NEW.actual_revenue := NULL;
  NEW.estimated_costs := NULL; NEW.actual_costs := NULL; NEW.cash_budget := NULL; NEW.actual_cash_revenue := NULL;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.event_financials_redirect() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS aa_event_financials_redirect ON public.events;
CREATE TRIGGER aa_event_financials_redirect BEFORE INSERT OR UPDATE OF budget, final_cost, expected_revenue, actual_revenue,
  estimated_costs, actual_costs, cash_budget, actual_cash_revenue ON public.events
  FOR EACH ROW EXECUTE FUNCTION private.event_financials_redirect();

-- Przeniesienie istniejących kwot.
INSERT INTO public.event_financials (event_id, budget, final_cost, expected_revenue, actual_revenue, estimated_costs,
    actual_costs, cash_budget, actual_cash_revenue)
SELECT e.id, e.budget, e.final_cost, e.expected_revenue, e.actual_revenue, e.estimated_costs, e.actual_costs, e.cash_budget,
       e.actual_cash_revenue
  FROM public.events e
 WHERE e.budget IS NOT NULL OR e.final_cost IS NOT NULL OR e.expected_revenue IS NOT NULL OR e.actual_revenue IS NOT NULL
    OR e.estimated_costs IS NOT NULL OR e.actual_costs IS NOT NULL OR e.cash_budget IS NOT NULL OR e.actual_cash_revenue IS NOT NULL
ON CONFLICT (event_id) DO UPDATE SET
  budget = coalesce(excluded.budget, public.event_financials.budget),
  final_cost = coalesce(excluded.final_cost, public.event_financials.final_cost),
  expected_revenue = coalesce(excluded.expected_revenue, public.event_financials.expected_revenue),
  actual_revenue = coalesce(excluded.actual_revenue, public.event_financials.actual_revenue),
  estimated_costs = coalesce(excluded.estimated_costs, public.event_financials.estimated_costs),
  actual_costs = coalesce(excluded.actual_costs, public.event_financials.actual_costs),
  cash_budget = coalesce(excluded.cash_budget, public.event_financials.cash_budget),
  actual_cash_revenue = coalesce(excluded.actual_cash_revenue, public.event_financials.actual_cash_revenue);

-- Czyszczenie kolumn w events bez uruchamiania wyzwalaczy biznesowych (historia, kroki, powiadomienia).
ALTER TABLE public.events DISABLE TRIGGER USER;
UPDATE public.events e SET budget = NULL, final_cost = NULL, expected_revenue = NULL, actual_revenue = NULL,
       estimated_costs = NULL, actual_costs = NULL, cash_budget = NULL, actual_cash_revenue = NULL
 WHERE e.budget IS NOT NULL OR e.final_cost IS NOT NULL OR e.expected_revenue IS NOT NULL OR e.actual_revenue IS NOT NULL
    OR e.estimated_costs IS NOT NULL OR e.actual_costs IS NOT NULL OR e.cash_budget IS NOT NULL OR e.actual_cash_revenue IS NOT NULL;
ALTER TABLE public.events ENABLE TRIGGER USER;
ALTER TABLE public.events ALTER COLUMN budget DROP DEFAULT, ALTER COLUMN final_cost DROP DEFAULT,
  ALTER COLUMN expected_revenue DROP DEFAULT, ALTER COLUMN actual_revenue DROP DEFAULT, ALTER COLUMN estimated_costs DROP DEFAULT,
  ALTER COLUMN actual_costs DROP DEFAULT, ALTER COLUMN cash_budget DROP DEFAULT, ALTER COLUMN actual_cash_revenue DROP DEFAULT;
COMMENT ON COLUMN public.events.budget IS 'Przestarzałe — kwoty są w event_financials (zapis tutaj przenosi wartość wyzwalaczem).';

-- Funkcje raportowe czytają kwoty z event_financials; lista wydarzeń maskuje kwoty i klienta według obszarów.
CREATE OR REPLACE FUNCTION public.get_event_financial_info(p_event_id uuid)
 RETURNS TABLE(event_name text, client_type text, is_business boolean, can_invoice boolean, expected_revenue numeric, actual_revenue numeric, actual_cash_revenue numeric, total_revenue numeric, estimated_costs numeric, actual_costs numeric, estimated_profit numeric, actual_profit numeric, accepted_offer_id uuid, accepted_offer_number text, accepted_offer_total numeric, accepted_offer_costs numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
 IF public.realization_operational_only(p_event_id) THEN RAISE EXCEPTION 'Dane rozliczeniowe nie należą do zakresu kierownika realizacji.' USING ERRCODE='42501'; END IF;
RETURN QUERY
SELECT 
e.name as event_name,
e.client_type::text,
CASE 
WHEN o.id IS NOT NULL THEN true
WHEN c.is_business_client THEN true
ELSE false
END as is_business,
CASE 
WHEN o.id IS NOT NULL AND o.nip IS NOT NULL THEN true
WHEN c.is_business_client AND c.nip IS NOT NULL THEN true
ELSE false
END as can_invoice,
coalesce(f.expected_revenue,0),
coalesce(f.actual_revenue,0),
coalesce(f.actual_cash_revenue,0),
(coalesce(f.actual_revenue,0) + coalesce(f.actual_cash_revenue,0)) as total_revenue,
coalesce(f.estimated_costs,0),
coalesce(f.actual_costs,0),
(coalesce(f.expected_revenue,0) - coalesce(f.estimated_costs,0)) as estimated_profit,
((coalesce(f.actual_revenue,0) + coalesce(f.actual_cash_revenue,0)) - coalesce(f.actual_costs,0)) as actual_profit,
off.id as accepted_offer_id,
off.offer_number as accepted_offer_number,
off.total_amount as accepted_offer_total,
off.total_cost as accepted_offer_costs
FROM events e
LEFT JOIN public.event_financials f ON f.event_id = e.id
LEFT JOIN organizations o ON e.organization_id = o.id
LEFT JOIN contacts c ON e.contact_person_id = c.id
LEFT JOIN LATERAL (
SELECT off2.id, off2.offer_number, off2.total_amount, off2.total_cost
FROM offers off2
WHERE public.crm_record_id_scope_allows('offers',off2.id) AND off2.event_id = e.id AND off2.status = 'accepted'
ORDER BY off2.created_at DESC
LIMIT 1
) off ON true
WHERE e.id = p_event_id AND public.crm_record_id_scope_allows('events',e.id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_event_financial_summary(p_event_id uuid)
 RETURNS TABLE(expected_revenue numeric, actual_revenue numeric, estimated_costs numeric, actual_costs numeric, expected_profit numeric, actual_profit numeric, profit_margin_expected numeric, profit_margin_actual numeric, invoices_count bigint, invoices_paid_count bigint, invoices_total numeric, costs_count bigint, costs_paid_count bigint, costs_total numeric, cash_budget numeric, actual_cash_revenue numeric, total_revenue numeric, client_type text, is_cash_only boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
 IF coalesce(auth.role(), '') IN ('anon', 'authenticated') AND NOT public.can_view_event_commercials(p_event_id, false) THEN
  RAISE EXCEPTION 'Brak dostępu do finansów tego wydarzenia.' USING ERRCODE = '42501';  -- P0: EVC(v), jak zakładka Finanse
 END IF;
 IF public.realization_operational_only(p_event_id) THEN RAISE EXCEPTION 'Dane rozliczeniowe nie należą do zakresu kierownika realizacji.' USING ERRCODE='42501'; END IF;
RETURN QUERY
SELECT 
coalesce(f.expected_revenue,0),
coalesce(f.actual_revenue,0),
coalesce(f.estimated_costs,0),
coalesce(f.actual_costs,0),
(coalesce(f.expected_revenue,0) - coalesce(f.estimated_costs,0)) as expected_profit,
(coalesce(f.actual_revenue,0) + coalesce(f.actual_cash_revenue,0) - coalesce(f.actual_costs,0)) as actual_profit,
CASE 
WHEN coalesce(f.expected_revenue,0) > 0 
THEN ((coalesce(f.expected_revenue,0) - coalesce(f.estimated_costs,0)) / coalesce(f.expected_revenue,0) * 100)
ELSE 0 
END as profit_margin_expected,
CASE 
WHEN (coalesce(f.actual_revenue,0) + coalesce(f.actual_cash_revenue,0)) > 0 
THEN ((coalesce(f.actual_revenue,0) + coalesce(f.actual_cash_revenue,0) - coalesce(f.actual_costs,0)) / (coalesce(f.actual_revenue,0) + coalesce(f.actual_cash_revenue,0)) * 100)
ELSE 0 
END as profit_margin_actual,
(SELECT COUNT(*) FROM invoices WHERE event_id = e.id)::bigint as invoices_count,
(SELECT COUNT(*) FROM invoices WHERE event_id = e.id AND status IN ('paid', 'partially_paid'))::bigint as invoices_paid_count,
COALESCE((SELECT SUM(total_gross) FROM invoices WHERE event_id = e.id), 0) as invoices_total,
(SELECT COUNT(*) FROM event_costs WHERE event_id = e.id)::bigint as costs_count,
(SELECT COUNT(*) FROM event_costs WHERE event_id = e.id AND status = 'paid')::bigint as costs_paid_count,
COALESCE((SELECT SUM(amount) FROM event_costs WHERE event_id = e.id), 0) as costs_total,
coalesce(f.cash_budget,0),
coalesce(f.actual_cash_revenue,0),
(coalesce(f.actual_revenue,0) + coalesce(f.actual_cash_revenue,0)) as total_revenue,
e.client_type::text,
(e.client_type = 'individual')::boolean as is_cash_only
FROM events e
LEFT JOIN public.event_financials f ON f.event_id = e.id
WHERE e.id = p_event_id AND public.crm_record_id_scope_allows('events',e.id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_events_list(start_date timestamp with time zone DEFAULT NULL::timestamp with time zone, end_date timestamp with time zone DEFAULT NULL::timestamp with time zone, status_filter text[] DEFAULT NULL::text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
result jsonb;
current_user_id uuid;
has_full_access boolean;
BEGIN
-- Get current user ID
current_user_id := auth.uid();

-- If no user, return empty array
IF current_user_id IS NULL THEN
RETURN '[]'::jsonb;
END IF;

-- Check if user has full access (admin or calendar_manage)
SELECT EXISTS (
SELECT 1
FROM employees emp
WHERE emp.id = current_user_id
AND (
emp.role = 'admin'
OR 'admin' = ANY(emp.permissions)
OR 'events_manage' = ANY(emp.permissions)
OR 'calendar_manage' = ANY(emp.permissions)
)
) INTO has_full_access;

result := (
SELECT COALESCE(jsonb_agg(event_data ORDER BY event_date), '[]'::jsonb)
FROM (
-- Events from events table
SELECT
jsonb_build_object(
'id', e.id,
'name', e.name,
'description', e.description,
'event_date', e.event_date,
'event_end_date', e.event_end_date,
'location', e.location,
'status', e.status,
'budget', CASE WHEN public.can_view_event_area(e.id, 'values') THEN f.budget END,
'final_cost', CASE WHEN public.can_view_event_area(e.id, 'values') THEN f.final_cost END,
'notes', CASE WHEN public.realization_operational_only(e.id) THEN NULL ELSE e.notes END,
'category_id', e.category_id,
'organization_id', CASE WHEN public.can_view_event_area(e.id, 'client') THEN e.organization_id END,
'contact_person_id', CASE WHEN public.can_view_event_area(e.id, 'client') THEN e.contact_person_id END,
'created_by', e.created_by,
'created_at', e.created_at,
'is_meeting', false,
'organization', CASE 
WHEN o.id IS NOT NULL AND public.can_view_event_area(e.id, 'client') THEN jsonb_build_object(
'id', o.id,
'name', o.name,
'alias', o.alias
)
ELSE NULL
END,
'contact_person', CASE 
WHEN c.id IS NOT NULL AND public.can_view_event_area(e.id, 'client') THEN jsonb_build_object(
'id', c.id,
'first_name', c.first_name,
'last_name', c.last_name,
'full_name', c.full_name
)
ELSE NULL
END,
'category', CASE 
WHEN ec.id IS NOT NULL THEN jsonb_build_object(
'id', ec.id,
'name', ec.name,
'color', ec.color,
'custom_icon', CASE
WHEN ci.id IS NOT NULL THEN jsonb_build_object(
'id', ci.id,
'name', ci.name,
'svg_code', ci.svg_code
)
ELSE NULL
END
)
ELSE NULL
END,
'assigned_employees', (
SELECT COALESCE(jsonb_agg(
jsonb_build_object(
'id', emp.id,
'name', emp.name,
'surname', emp.surname
)
), '[]'::jsonb)
FROM employee_assignments ea
JOIN employees emp ON emp.id = ea.employee_id
WHERE ea.event_id = e.id
AND ea.status = 'accepted'
)
) as event_data,
e.event_date
FROM events e
LEFT JOIN public.event_financials f ON f.event_id = e.id
LEFT JOIN organizations o ON o.id = e.organization_id
LEFT JOIN contacts c ON c.id = e.contact_person_id
LEFT JOIN event_categories ec ON ec.id = e.category_id
LEFT JOIN custom_icons ci ON ci.id = ec.icon_id
WHERE 
(public.crm_record_id_scope_allows('events',e.id) OR public.is_realization_manager(e.id))
AND (start_date IS NULL OR e.event_date >= start_date)
AND (end_date IS NULL OR e.event_date <= end_date)
AND (status_filter IS NULL OR e.status::text = ANY(status_filter))
-- Security filter: admins see all, others see only their events or assigned events
AND (public.current_employee_can_view_event(e.id) OR public.is_realization_manager(e.id))

UNION ALL

-- Meetings from meetings table
SELECT
jsonb_build_object(
'id', m.id,
'name', m.title,
'description', m.notes,
'event_date', m.datetime_start,
'event_end_date', m.datetime_end,
'location', COALESCE(loc.name, m.location_text, ''),
'status', 'scheduled',
'budget', NULL,
'final_cost', NULL,
'notes', m.notes,
'category_id', NULL,
'organization_id', NULL,
'contact_person_id', NULL,
'created_by', m.created_by,
'created_at', m.created_at,
'is_meeting', true,
'organization', NULL,
'contact_person', NULL,
'category', NULL,
'meeting_data', jsonb_build_object(
'notes', m.notes,
'meeting_participants', (
SELECT COALESCE(jsonb_agg(
jsonb_build_object(
'employee_id', mp.employee_id,
'name', emp.name,
'surname', emp.surname
)
), '[]'::jsonb)
FROM meeting_participants mp
LEFT JOIN employees emp ON emp.id = mp.employee_id
WHERE mp.meeting_id = m.id
)
),
'assigned_employees', (
SELECT COALESCE(jsonb_agg(
jsonb_build_object(
'id', emp.id,
'name', emp.name,
'surname', emp.surname
)
), '[]'::jsonb)
FROM meeting_participants mp
JOIN employees emp ON emp.id = mp.employee_id
WHERE mp.meeting_id = m.id
)
) as event_data,
m.datetime_start as event_date
FROM meetings m
LEFT JOIN locations loc ON loc.id = m.location_id
WHERE 
(start_date IS NULL OR m.datetime_start >= start_date)
AND (end_date IS NULL OR m.datetime_start <= end_date)
AND m.deleted_at IS NULL AND public.is_current_meeting_participant(m.id)
-- Security filter: admins see all, others see only their meetings or where they are participants

) combined_events
);

RETURN result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.refresh_invoice_settlement_allocations(p_invoice_id uuid, p_group_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_primary_event_id uuid;
  v_total_weight numeric;
  v_member_count integer;
BEGIN
  SELECT settlement_group.primary_event_id
  INTO v_primary_event_id
  FROM public.event_settlement_groups settlement_group
  WHERE settlement_group.id = p_group_id;

  IF v_primary_event_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.invoices WHERE id = p_invoice_id) THEN
    RETURN;
  END IF;

  WITH weights AS (
    SELECT member.event_id,
           GREATEST(COALESCE(
             NULLIF(latest_offer.total_amount, 0),
             NULLIF(fin.expected_revenue, 0),
             0
           ), 0) AS weight
    FROM public.event_settlement_group_members member
    JOIN public.events event ON event.id = member.event_id
    LEFT JOIN public.event_financials fin ON fin.event_id = event.id
    LEFT JOIN LATERAL (
      SELECT offer.total_amount
      FROM public.offers offer
      WHERE offer.event_id = member.event_id
        AND offer.status = 'accepted'
      ORDER BY offer.created_at DESC
      LIMIT 1
    ) latest_offer ON true
    WHERE member.group_id = p_group_id
  )
  SELECT COALESCE(SUM(weight), 0), COUNT(*)
  INTO v_total_weight, v_member_count
  FROM weights;

  DELETE FROM public.invoice_event_allocations
  WHERE invoice_id = p_invoice_id;

  INSERT INTO public.invoice_event_allocations (
    invoice_id,
    event_id,
    settlement_group_id,
    is_primary,
    allocation_method,
    allocation_weight
  )
  SELECT
    p_invoice_id,
    member.event_id,
    p_group_id,
    member.event_id = v_primary_event_id,
    CASE
      WHEN v_total_weight > 0 AND latest_offer.total_amount > 0 THEN 'automatic_offer'
      WHEN v_total_weight > 0 THEN 'automatic_expected'
      ELSE 'equal'
    END,
    CASE
      WHEN v_total_weight > 0 THEN GREATEST(COALESCE(
        NULLIF(latest_offer.total_amount, 0),
        NULLIF(fin.expected_revenue, 0),
        0
      ), 0) / v_total_weight
      ELSE 1::numeric / NULLIF(v_member_count, 0)
    END
  FROM public.event_settlement_group_members member
  JOIN public.events event ON event.id = member.event_id
  LEFT JOIN public.event_financials fin ON fin.event_id = event.id
  LEFT JOIN LATERAL (
    SELECT offer.total_amount
    FROM public.offers offer
    WHERE offer.event_id = member.event_id
      AND offer.status = 'accepted'
    ORDER BY offer.created_at DESC
    LIMIT 1
  ) latest_offer ON true
  WHERE member.group_id = p_group_id;
END;
$function$;
