-- Sprzedawcy widzą sprzedane wydarzenia innych sprzedawców (świadomość zajętych terminów):
-- termin, miejsce, klient (nazwa), sprzedane usługi i kto sprzedał — bez kwot, oferty, umowy, plików, notatek i kontaktów.
-- Dostęp wyłącznie przez funkcje zwracające wybrane pola (bez polityki SELECT na events).
-- Administrator widzi wszystko (bez zmian). Nowy obszar: sales_overview (get_event_access, get_event_sales_overview).

CREATE OR REPLACE FUNCTION public.event_visible_to_sales_colleague(p_event_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.employees e JOIN public.events v ON v.id = p_event_id
     WHERE e.id = public.sales_employee_id() AND e.is_active AND NOT public.current_session_is_seller_portal()
       AND coalesce(e.permissions, '{}') && ARRAY['offers_view','offers_create','offers_manage','offers_own_only',
             'inquiries_view','inquiries_view_own','inquiries_view_team','inquiries_view_all','inquiries_view_pool',
             'inquiries_manage','inquiries_manage_own','inquiries_manage_team','inquiries_manage_all','events_create']
       AND public.employee_can_access_company(e.id, v.my_company_id)
       AND v.status::text IN ('offer_accepted','in_preparation','ready_for_live','in_progress','completed','invoiced','settled'));
$$;
REVOKE ALL ON FUNCTION public.event_visible_to_sales_colleague(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.event_visible_to_sales_colleague(uuid) TO authenticated;

-- Inny sprzedawca NIE czyta wiersza `events` (opis, notatki, rozliczenie) — tylko wybrane pola przez funkcje:
-- get_event_sales_overview (jedno wydarzenie), get_sales_colleague_events (lista / kalendarz), get_events_list.
DROP POLICY IF EXISTS events_sales_colleague_read ON public.events;

-- Obszary: sales_overview (podgląd sprzedaży) — każdy z dostępem do realizacji oraz sprzedawcy przy wydarzeniach kolegów.
CREATE OR REPLACE FUNCTION public.get_event_access(p_event_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  actor uuid := public.sales_employee_id(); emp record; ev record; perms text[];
  is_admin boolean; ops boolean; sells boolean; office boolean; manager boolean; warehouse boolean; driver boolean;
  team boolean; client boolean; vals boolean; docs boolean; billing boolean; onsite boolean; colleague boolean;
BEGIN
  IF actor IS NULL OR p_event_id IS NULL OR public.current_session_is_seller_portal() THEN
    RETURN jsonb_build_object('event_id', p_event_id, 'areas', jsonb_build_object('operations', false, 'onsite_contact', false,
      'client', false, 'values', false, 'commercial_docs', false, 'billing', false, 'sales_overview', false), 'roles', '{}'::jsonb);
  END IF;
  SELECT e.id, e.role, e.access_level, e.auth_user_id, coalesce(e.permissions,'{}') AS permissions INTO emp
    FROM public.employees e WHERE e.id = actor AND e.is_active;
  SELECT v.id, v.created_by INTO ev FROM public.events v WHERE v.id = p_event_id;
  IF emp.id IS NULL OR ev.id IS NULL THEN
    RETURN jsonb_build_object('event_id', p_event_id, 'areas', jsonb_build_object('operations', false, 'onsite_contact', false,
      'client', false, 'values', false, 'commercial_docs', false, 'billing', false, 'sales_overview', false), 'roles', '{}'::jsonb);
  END IF;
  perms := emp.permissions;
  is_admin := emp.role = 'admin' OR emp.access_level = 'admin' OR 'admin' = ANY(perms);
  manager := public.is_realization_manager(p_event_id);
  warehouse := public.can_receive_warehouse_event(p_event_id);
  driver := EXISTS (SELECT 1 FROM public.event_vehicles v WHERE v.event_id = p_event_id AND v.driver_id = actor
                     AND coalesce(v.status,'planned') <> 'cancelled');
  team := EXISTS (SELECT 1 FROM public.employee_assignments a WHERE a.event_id = p_event_id AND a.employee_id = actor
                   AND a.status = 'accepted');
  ops := public.current_employee_can_view_event(p_event_id) OR manager OR warehouse OR driver;
  IF NOT ops THEN
    -- Inny sprzedawca: sprzedane wydarzenie kolegi — termin, miejsce, klient, sprzedane usługi, bez kwot i dokumentów.
    colleague := public.event_visible_to_sales_colleague(p_event_id);
    IF colleague THEN
      RETURN jsonb_build_object('event_id', p_event_id, 'areas', jsonb_build_object('operations', false, 'onsite_contact', false,
        'client', false, 'values', false, 'commercial_docs', false, 'billing', false, 'sales_overview', true),
        'roles', jsonb_build_object('colleague', true));
    END IF;
    RETURN jsonb_build_object('event_id', p_event_id, 'areas', jsonb_build_object('operations', false, 'onsite_contact', false,
      'client', false, 'values', false, 'commercial_docs', false, 'billing', false, 'sales_overview', false), 'roles', '{}'::jsonb);
  END IF;
  sells := ev.created_by IN (emp.id, emp.auth_user_id) OR public.current_employee_sells_event(p_event_id);
  office := emp.role = 'manager' OR emp.access_level = 'manager';
  client := is_admin OR sells OR office OR perms && ARRAY['contacts_view','contacts_manage','contacts_create','clients_view',
    'clients_manage','clients_create','offers_view','offers_manage','events_manage'];
  billing := is_admin OR public.can_view_event_commercials(p_event_id);
  vals := billing OR sells OR office OR perms && ARRAY['offers_view','offers_manage','finances_view','finances_manage'];
  docs := is_admin OR sells OR office OR perms && ARRAY['offers_view','offers_manage','contracts_view','contracts_manage',
    'finances_view','finances_manage','invoices_view','invoices_manage'];
  onsite := client OR manager OR driver
    OR (public.event_step_assignee(p_event_id, 'manager') IS NULL AND public.can_direct_realization(p_event_id));
  RETURN jsonb_build_object(
    'event_id', p_event_id,
    'areas', jsonb_build_object('operations', true, 'onsite_contact', onsite, 'client', client, 'values', vals,
      'commercial_docs', docs, 'billing', billing, 'sales_overview', true),
    'roles', jsonb_build_object('admin', is_admin, 'seller', sells, 'office', office, 'manager', manager,
      'warehouse', warehouse, 'driver', driver, 'team', team));
END $$;

CREATE OR REPLACE FUNCTION public.get_event_sales_overview(p_event_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE ev record;
BEGIN
  IF NOT public.can_view_event_area(p_event_id, 'sales_overview') THEN
    RAISE EXCEPTION 'Brak dostępu do tego wydarzenia.' USING ERRCODE = '42501';
  END IF;
  SELECT e.id, e.name, e.event_date, e.event_end_date, e.location, e.status::text AS status, c.name AS category,
         coalesce(nullif(btrim(o.alias), ''), nullif(btrim(o.name), ''),
                  nullif(btrim(p.full_name), ''), nullif(btrim(concat_ws(' ', p.first_name, p.last_name)), '')) AS client_name
    INTO ev
    FROM public.events e
    LEFT JOIN public.event_categories c ON c.id = e.category_id
    LEFT JOIN public.organizations o ON o.id = e.organization_id
    LEFT JOIN public.contacts p ON p.id = e.contact_person_id
   WHERE e.id = p_event_id;
  RETURN jsonb_build_object(
    'event', jsonb_build_object('id', ev.id, 'name', ev.name, 'event_date', ev.event_date, 'event_end_date', ev.event_end_date,
      'location', ev.location, 'status', ev.status, 'category', ev.category),
    'client_name', ev.client_name,
    'sold_by', coalesce((
      SELECT jsonb_agg(DISTINCT coalesce(nullif(concat_ws(' ', emp.name, emp.surname), ''), emp.nickname))
        FROM public.employees emp
       WHERE emp.id IN (SELECT o.created_by FROM public.offers o WHERE o.event_id = p_event_id AND o.status::text = 'accepted')
          OR emp.id = (SELECT e.created_by FROM public.events e WHERE e.id = p_event_id)
          OR emp.auth_user_id = (SELECT e.created_by FROM public.events e WHERE e.id = p_event_id)), '[]'::jsonb),
    'products', coalesce((
      SELECT jsonb_agg(jsonb_build_object('name', coalesce(nullif(btrim(i.name), ''), pr.name), 'quantity', i.quantity, 'unit', i.unit)
               ORDER BY o.created_at, i.display_order NULLS LAST)
        FROM public.offers o
        JOIN public.offer_items i ON i.offer_id = o.id
        LEFT JOIN public.offer_products pr ON pr.id = i.product_id
       WHERE o.event_id = p_event_id AND o.status::text = 'accepted'), '[]'::jsonb)
  );
END $$;
REVOKE ALL ON FUNCTION public.get_event_sales_overview(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_event_sales_overview(uuid) TO authenticated;

-- Kalendarz / lista: sprzedane wydarzenia kolegów (bez kwot i notatek, z oznaczeniem sales_colleague).
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
'notes', CASE WHEN public.realization_operational_only(e.id) OR NOT public.can_view_event_area(e.id, 'operations') THEN NULL ELSE e.notes END,
'sales_colleague', NOT public.can_view_event_area(e.id, 'operations'),
'category_id', e.category_id,
'organization_id', CASE WHEN public.can_view_event_area(e.id, 'client') THEN e.organization_id END,
'contact_person_id', CASE WHEN public.can_view_event_area(e.id, 'client') THEN e.contact_person_id END,
'created_by', e.created_by,
'created_at', e.created_at,
'is_meeting', false,
'organization', CASE 
WHEN o.id IS NOT NULL AND (public.can_view_event_area(e.id, 'client') OR public.can_view_event_area(e.id, 'sales_overview')) THEN jsonb_build_object(
'id', o.id,
'name', o.name,
'alias', o.alias
)
ELSE NULL
END,
'contact_person', CASE 
WHEN c.id IS NOT NULL AND (public.can_view_event_area(e.id, 'client') OR public.can_view_event_area(e.id, 'sales_overview')) THEN jsonb_build_object(
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
(public.crm_record_id_scope_allows('events',e.id) OR public.is_realization_manager(e.id) OR public.event_visible_to_sales_colleague(e.id))
AND (start_date IS NULL OR e.event_date >= start_date)
AND (end_date IS NULL OR e.event_date <= end_date)
AND (status_filter IS NULL OR e.status::text = ANY(status_filter))
-- Security filter: admins see all, others see only their events or assigned events
AND (public.current_employee_can_view_event(e.id) OR public.is_realization_manager(e.id) OR public.event_visible_to_sales_colleague(e.id))

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

-- Lista / kalendarz: sprzedane wydarzenia innych sprzedawców, których osoba nie widzi w pełnym zakresie.
CREATE OR REPLACE FUNCTION public.get_sales_colleague_events(p_from timestamptz DEFAULT NULL, p_to timestamptz DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF public.sales_employee_id() IS NULL OR public.current_session_is_seller_portal() THEN RETURN '[]'::jsonb; END IF;
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object(
             'id', e.id, 'name', e.name, 'event_date', e.event_date, 'event_end_date', e.event_end_date,
             'location', e.location, 'status', e.status::text,
             'category', CASE WHEN c.id IS NOT NULL THEN jsonb_build_object('id', c.id, 'name', c.name, 'color', c.color) END,
             'client_name', coalesce(nullif(btrim(o.alias), ''), nullif(btrim(o.name), ''),
                              nullif(btrim(p.full_name), ''), nullif(btrim(concat_ws(' ', p.first_name, p.last_name)), '')),
             'sold_by', (SELECT coalesce(jsonb_agg(DISTINCT coalesce(nullif(concat_ws(' ', emp.name, emp.surname), ''), emp.nickname)), '[]'::jsonb)
                           FROM public.employees emp
                          WHERE emp.id IN (SELECT ofr.created_by FROM public.offers ofr WHERE ofr.event_id = e.id AND ofr.status::text = 'accepted')
                             OR e.created_by IN (emp.id, emp.auth_user_id)),
             'sales_colleague', true)
           ORDER BY e.event_date)
      FROM public.events e
      LEFT JOIN public.event_categories c ON c.id = e.category_id
      LEFT JOIN public.organizations o ON o.id = e.organization_id
      LEFT JOIN public.contacts p ON p.id = e.contact_person_id
     WHERE e.status::text IN ('offer_accepted','in_preparation','ready_for_live','in_progress','completed','invoiced','settled')
       AND (p_from IS NULL OR coalesce(e.event_end_date, e.event_date) >= p_from)
       AND (p_to IS NULL OR e.event_date <= p_to)
       AND public.event_visible_to_sales_colleague(e.id)
       AND NOT public.current_employee_can_view_event(e.id)
       AND NOT public.is_realization_manager(e.id)), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.get_sales_colleague_events(timestamptz, timestamptz) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_sales_colleague_events(timestamptz, timestamptz) TO authenticated;
