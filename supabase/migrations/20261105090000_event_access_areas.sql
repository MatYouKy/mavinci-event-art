-- Obszary danych wydarzenia: każdy widzi to, czego potrzebuje na swoim stanowisku — wymuszone w bazie, nie tylko w interfejsie.
-- Obszary (get_event_access / can_view_event_area):
--   operations      — dane operacyjne (termin, miejsce, sprzęt, logistyka, zespół, etapy, pliki operacyjne, kroki)
--   onsite_contact  — kontakt na miejscu (imię, telefon osoby od klienta i z obiektu) — get_event_onsite_contacts
--   client          — pełne dane klienta (organizacja, osoby, e-mail, historia)
--   values          — kwoty: budżet, przychód, koszty, kalkulacje, ceny
--   commercial_docs — oferta, umowa, ustalenia ze sprzedawcą, formalności, pliki dokumentacji
--   billing         — faktury i rozliczenie (jak can_view_event_commercials)
-- Zmiany:
--   * kontakty i organizacje: koniec odczytu „wszyscy widzą wszystko”;
--   * kalkulacje i ich pozycje: tylko obszar „kwoty” (magazyn dostaje pozycje sprzętowe bez cen przez RPC);
--   * pliki: foldery i pliki operacyjne widzi ekipa wydarzenia, dokumentacja i formalności — tylko obszar handlowy;
--   * kroki realizacji: etap „Formalności” (dane, umowa, zaliczka) i kroki zespół / agenda / transport / karta weselna
--     zastępują stary proces „Gotowość realizacji”; formalności i rozliczenie widzi tylko obszar handlowy.

-- 1. Kto może czytać bazę klientów -----------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.crm_can_read_client_directory()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT EXISTS (SELECT 1 FROM public.employees e
    WHERE e.id = public.sales_employee_id() AND e.is_active AND NOT public.current_session_is_seller_portal()
      AND (e.role IN ('admin','manager') OR e.access_level IN ('admin','manager')
        OR coalesce(e.permissions,'{}') && ARRAY[
          'admin','contacts_view','contacts_manage','contacts_create','clients_view','clients_manage','clients_create',
          'offers_view','offers_manage','offers_create','inquiries_view','inquiries_view_own','inquiries_view_team',
          'inquiries_view_all','inquiries_view_pool','inquiries_manage','inquiries_manage_own','inquiries_manage_team',
          'inquiries_manage_all','inquiries_assign','messages_view','messages_manage','messages_assign','tenders_view',
          'tenders_manage','invoices_view','invoices_manage','finances_view','finances_manage','contracts_view',
          'contracts_manage','contracts_create','events_manage','events_create','marketing_campaigns_view']));
$$;
GRANT EXECUTE ON FUNCTION public.crm_can_read_client_directory() TO authenticated;

-- 2. Obszary wydarzenia ------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_event_access(p_event_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  actor uuid := public.sales_employee_id(); emp record; ev record; perms text[];
  is_admin boolean; ops boolean; sells boolean; office boolean; manager boolean; warehouse boolean; driver boolean;
  team boolean; client boolean; vals boolean; docs boolean; billing boolean; onsite boolean;
BEGIN
  IF actor IS NULL OR p_event_id IS NULL OR public.current_session_is_seller_portal() THEN
    RETURN jsonb_build_object('event_id', p_event_id, 'areas', jsonb_build_object('operations', false, 'onsite_contact', false,
      'client', false, 'values', false, 'commercial_docs', false, 'billing', false), 'roles', '{}'::jsonb);
  END IF;
  SELECT e.id, e.role, e.access_level, e.auth_user_id, coalesce(e.permissions,'{}') AS permissions INTO emp
    FROM public.employees e WHERE e.id = actor AND e.is_active;
  SELECT v.id, v.created_by INTO ev FROM public.events v WHERE v.id = p_event_id;
  IF emp.id IS NULL OR ev.id IS NULL THEN
    RETURN jsonb_build_object('event_id', p_event_id, 'areas', jsonb_build_object('operations', false, 'onsite_contact', false,
      'client', false, 'values', false, 'commercial_docs', false, 'billing', false), 'roles', '{}'::jsonb);
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
    RETURN jsonb_build_object('event_id', p_event_id, 'areas', jsonb_build_object('operations', false, 'onsite_contact', false,
      'client', false, 'values', false, 'commercial_docs', false, 'billing', false), 'roles', '{}'::jsonb);
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
      'commercial_docs', docs, 'billing', billing),
    'roles', jsonb_build_object('admin', is_admin, 'seller', sells, 'office', office, 'manager', manager,
      'warehouse', warehouse, 'driver', driver, 'team', team));
END $$;

CREATE OR REPLACE FUNCTION public.can_view_event_area(p_event_id uuid, p_area text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT coalesce((public.get_event_access(p_event_id)->'areas'->>p_area)::boolean, false);
$$;
REVOKE ALL ON FUNCTION public.get_event_access(uuid), public.can_view_event_area(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_event_access(uuid), public.can_view_event_area(uuid, text) TO authenticated;

-- 3. Kontakty i organizacje -----------------------------------------------------------------------------------------
DROP POLICY IF EXISTS "Authenticated users can view all contacts" ON public.contacts;
DROP POLICY IF EXISTS "Authenticated users can create contacts" ON public.contacts;
DROP POLICY IF EXISTS "Authenticated users can update contacts" ON public.contacts;
DROP POLICY IF EXISTS "Authenticated users can delete contacts" ON public.contacts;
DROP POLICY IF EXISTS contacts_read_scope ON public.contacts;
DROP POLICY IF EXISTS contacts_write_scope ON public.contacts;
CREATE POLICY contacts_read_scope ON public.contacts FOR SELECT TO authenticated USING (
  (SELECT public.crm_can_read_client_directory())
  OR owner_id = (SELECT public.sales_employee_id())
  OR created_by IN ((SELECT public.sales_employee_id()), auth.uid())
  OR EXISTS (SELECT 1 FROM public.events e WHERE e.contact_person_id = contacts.id AND public.can_view_event_area(e.id, 'client'))
  OR EXISTS (SELECT 1 FROM public.event_contact_persons p WHERE p.contact_id = contacts.id AND public.can_view_event_area(p.event_id, 'client'))
);
CREATE POLICY contacts_write_scope ON public.contacts FOR ALL TO authenticated
  USING ((SELECT public.crm_can_read_client_directory()) OR owner_id = (SELECT public.sales_employee_id())
         OR created_by IN ((SELECT public.sales_employee_id()), auth.uid()))
  WITH CHECK ((SELECT public.crm_can_read_client_directory()) OR owner_id = (SELECT public.sales_employee_id())
         OR created_by IN ((SELECT public.sales_employee_id()), auth.uid()));

DROP POLICY IF EXISTS "Authenticated users can view organizations" ON public.organizations;
DROP POLICY IF EXISTS "Authenticated users can insert organizations" ON public.organizations;
DROP POLICY IF EXISTS "Authenticated users can update organizations" ON public.organizations;
DROP POLICY IF EXISTS "Authenticated users can delete organizations" ON public.organizations;
DROP POLICY IF EXISTS organizations_read_scope ON public.organizations;
DROP POLICY IF EXISTS organizations_write_scope ON public.organizations;
CREATE POLICY organizations_read_scope ON public.organizations FOR SELECT TO authenticated USING (
  (SELECT public.crm_can_read_client_directory())
  OR organization_type::text = 'subcontractor'
  OR EXISTS (SELECT 1 FROM public.events e WHERE e.organization_id = organizations.id AND public.can_view_event_area(e.id, 'client'))
);
CREATE POLICY organizations_write_scope ON public.organizations FOR ALL TO authenticated
  USING ((SELECT public.crm_can_read_client_directory()))
  WITH CHECK ((SELECT public.crm_can_read_client_directory()));

-- Kontakt na miejscu: imię, rola i telefon — bez karty klienta (kierownik realizacji, kierowca, prowadzący).
CREATE OR REPLACE FUNCTION public.get_event_onsite_contacts(p_event_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF NOT public.can_view_event_area(p_event_id, 'onsite_contact') THEN
    RAISE EXCEPTION 'Kontakt na miejscu nie należy do Twojego zakresu.' USING ERRCODE = '42501';
  END IF;
  RETURN coalesce((
    SELECT jsonb_agg(x.j ORDER BY x.sort, x.name)
      FROM (
        SELECT 0 AS sort, coalesce(nullif(btrim(c.full_name), ''), nullif(btrim(concat_ws(' ', c.first_name, c.last_name)), ''), 'Osoba kontaktowa') AS name,
               jsonb_build_object('source', 'client', 'name', coalesce(nullif(btrim(c.full_name), ''), nullif(btrim(concat_ws(' ', c.first_name, c.last_name)), ''), 'Osoba kontaktowa'),
                 'role', 'Osoba kontaktowa klienta', 'phone', coalesce(nullif(c.mobile, ''), nullif(c.business_phone, ''), nullif(c.phone, '')),
                 'is_primary', true) AS j
          FROM public.events e JOIN public.contacts c ON c.id = e.contact_person_id WHERE e.id = p_event_id
        UNION ALL
        SELECT 1, coalesce(nullif(btrim(c.full_name), ''), nullif(btrim(concat_ws(' ', c.first_name, c.last_name)), ''), 'Osoba kontaktowa'),
               jsonb_build_object('source', 'event', 'name', coalesce(nullif(btrim(c.full_name), ''), nullif(btrim(concat_ws(' ', c.first_name, c.last_name)), ''), 'Osoba kontaktowa'),
                 'role', coalesce(nullif(btrim(p.role), ''), nullif(btrim(c.position), ''), 'Kontakt wydarzenia'),
                 'phone', coalesce(nullif(c.mobile, ''), nullif(c.business_phone, ''), nullif(c.phone, '')),
                 'notes', nullif(btrim(p.notes), ''), 'is_primary', coalesce(p.is_primary, false))
          FROM public.event_contact_persons p JOIN public.contacts c ON c.id = p.contact_id
         WHERE p.event_id = p_event_id
           AND p.contact_id IS DISTINCT FROM (SELECT e.contact_person_id FROM public.events e WHERE e.id = p_event_id)
        UNION ALL
        SELECT 2, coalesce(nullif(btrim(l.contact_person_name), ''), l.name),
               jsonb_build_object('source', 'venue', 'name', coalesce(nullif(btrim(l.contact_person_name), ''), l.name),
                 'role', 'Obiekt: ' || l.name, 'phone', nullif(btrim(l.contact_phone), ''), 'is_primary', false)
          FROM public.events e JOIN public.locations l ON l.id = e.location_id
         WHERE e.id = p_event_id AND (nullif(btrim(l.contact_person_name), '') IS NOT NULL OR nullif(btrim(l.contact_phone), '') IS NOT NULL)
      ) x), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.get_event_onsite_contacts(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_event_onsite_contacts(uuid) TO authenticated;

-- 4. Kalkulacje: tylko obszar „kwoty”; magazyn dostaje pozycje sprzętowe bez cen -------------------------------------
DROP POLICY IF EXISTS event_calculations_select ON public.event_calculations;
CREATE POLICY event_calculations_select ON public.event_calculations FOR SELECT TO authenticated
  USING (event_id IS NOT NULL AND public.can_view_event_area(event_id, 'values'));
DROP POLICY IF EXISTS event_calculation_items_select ON public.event_calculation_items;
CREATE POLICY event_calculation_items_select ON public.event_calculation_items FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.event_calculations c WHERE c.id = event_calculation_items.calculation_id
                  AND c.event_id IS NOT NULL AND public.can_view_event_area(c.event_id, 'values')));

CREATE OR REPLACE FUNCTION public.get_event_calculation_equipment(p_event_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE calc uuid;
BEGIN
  IF NOT public.can_view_event_area(p_event_id, 'operations') THEN
    RAISE EXCEPTION 'Brak dostępu do wydarzenia.' USING ERRCODE = '42501';
  END IF;
  SELECT e.accepted_calculation_id INTO calc FROM public.events e
   WHERE e.id = p_event_id AND e.financial_source = 'calculation';
  IF calc IS NULL THEN RETURN jsonb_build_object('calculation_id', NULL, 'items', '[]'::jsonb); END IF;
  RETURN jsonb_build_object('calculation_id', calc, 'items', coalesce((
    SELECT jsonb_agg(jsonb_build_object('id', i.id, 'calculation_id', i.calculation_id, 'category', i.category, 'name', i.name,
             'description', i.description, 'unit', i.unit, 'quantity', i.quantity, 'days', i.days, 'source', i.source,
             'source_ref', i.source_ref, 'position', i.position, 'power_watts', i.power_watts, 'weight_kg', i.weight_kg)
             ORDER BY i.position)
      FROM public.event_calculation_items i WHERE i.calculation_id = calc AND i.category = 'equipment'), '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.get_event_calculation_equipment(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_event_calculation_equipment(uuid) TO authenticated;

-- 5. Pliki: operacyjne dla ekipy, dokumentacja i formalności dla obszaru handlowego ----------------------------------
ALTER TABLE public.event_folders ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'operational';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_folders_visibility_check') THEN
    ALTER TABLE public.event_folders ADD CONSTRAINT event_folders_visibility_check CHECK (visibility IN ('operational','formal'));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION private.event_folder_is_formal_name(p_name text, p_required_permission text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce(p_required_permission, '') IN ('finance:invoices','invoices_manage','invoices_view','contracts_manage',
           'contracts_view','offers_create','offers_manage','offers_view','finances_view','finances_manage')
      OR lower(coalesce(p_name, '')) ~ '(umow|faktur|ofert|kalkulac|rozlicz|płatno|platno|kosztorys|finans)';
$$;

CREATE OR REPLACE FUNCTION private.event_folder_visibility_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF private.event_folder_is_formal_name(NEW.name, NEW.required_permission)
     OR EXISTS (SELECT 1 FROM public.event_folders p WHERE p.id = NEW.parent_folder_id AND p.visibility = 'formal') THEN
    NEW.visibility := 'formal';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS event_folder_visibility_guard ON public.event_folders;
CREATE TRIGGER event_folder_visibility_guard BEFORE INSERT OR UPDATE OF name, required_permission, parent_folder_id, visibility
  ON public.event_folders FOR EACH ROW EXECUTE FUNCTION private.event_folder_visibility_guard();

-- Ustawienie dotychczasowych folderów (także podfolderów folderów dokumentacji).
UPDATE public.event_folders f SET visibility = 'formal'
 WHERE f.visibility <> 'formal' AND private.event_folder_is_formal_name(f.name, f.required_permission);
DO $$
DECLARE changed int := 1; guard int := 0;
BEGIN
  WHILE changed > 0 AND guard < 20 LOOP
    UPDATE public.event_folders c SET visibility = 'formal'
      FROM public.event_folders p WHERE p.id = c.parent_folder_id AND p.visibility = 'formal' AND c.visibility <> 'formal';
    GET DIAGNOSTICS changed = ROW_COUNT; guard := guard + 1;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.event_folder_is_operational(p_folder_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  WITH RECURSIVE chain AS (
    SELECT f.id, f.parent_folder_id, f.visibility, 1 AS depth FROM public.event_folders f WHERE f.id = p_folder_id
    UNION ALL
    SELECT p.id, p.parent_folder_id, p.visibility, c.depth + 1 FROM public.event_folders p JOIN chain c ON p.id = c.parent_folder_id
     WHERE c.depth < 20)
  SELECT coalesce(bool_and(c.visibility = 'operational'), true) FROM chain c;
$$;

DROP POLICY IF EXISTS "Private event folders for managers and author" ON public.event_folders;
DROP POLICY IF EXISTS event_folders_area_read ON public.event_folders;
CREATE POLICY event_folders_area_read ON public.event_folders FOR SELECT TO authenticated USING (
  public.can_view_private_event_content(event_id)
  OR (visibility = 'formal' AND public.can_view_event_area(event_id, 'commercial_docs'))
  OR (public.event_folder_is_operational(id) AND public.can_view_event_area(event_id, 'operations'))
);

DROP POLICY IF EXISTS "Private event files follow folder visibility" ON public.event_files;
DROP POLICY IF EXISTS event_files_area_read ON public.event_files;
CREATE POLICY event_files_area_read ON public.event_files FOR SELECT TO authenticated USING (
  public.can_view_private_event_content(event_id)
  OR public.can_view_event_area(event_id, 'commercial_docs')
  OR (NOT public.is_sensitive_event_document(document_type)
      AND (folder_id IS NULL OR public.event_folder_is_operational(folder_id))
      AND public.can_view_event_area(event_id, 'operations'))
);

-- 6. Stary proces „Gotowość realizacji” — przypomnienia zastąpione krokami realizacji ---------------------------------
CREATE OR REPLACE FUNCTION public.notify_overdue_event_workflows()
RETURNS integer LANGUAGE sql AS $$
  -- Zastąpione przez kroki realizacji (event_steps, run_event_steps_maintenance). Funkcja zostaje dla zgodności.
  SELECT 0;
$$;

-- 7. Kroki realizacji: formalności, zespół, agenda, transport, karta weselna; filtr obszarów ---------------------------
ALTER TABLE public.event_steps DROP CONSTRAINT IF EXISTS event_steps_stage_check;
ALTER TABLE public.event_steps ADD CONSTRAINT event_steps_stage_check
  CHECK (stage IN ('formalities','handoff','preparation','dispatch','realization','return','settlement'));

-- Kroki zamykane wyłącznie przez proces (bez ręcznego „Gotowe” i ponownego otwarcia).
CREATE OR REPLACE FUNCTION private.event_step_auto_keys()
RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT ARRAY['manager_appointed','settlement_invoice','settlement_paid','formal_details','formal_contract','formal_deposit',
               'wedding_card','team_ready','agenda_ready','transport_planned'];
$$;

-- Etapy widoczne tylko dla obszaru handlowego.
CREATE OR REPLACE FUNCTION public.event_step_stage_visible(p_event uuid, p_stage text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT p_stage NOT IN ('formalities','settlement') OR public.can_view_event_area(p_event, 'commercial_docs');
$$;
GRANT EXECUTE ON FUNCTION public.event_step_stage_visible(uuid, text) TO authenticated;

DROP POLICY IF EXISTS event_steps_select ON public.event_steps;
CREATE POLICY event_steps_select ON public.event_steps FOR SELECT TO authenticated
  USING (public.can_view_event_steps(event_id) AND public.event_step_stage_visible(event_id, stage));
DROP POLICY IF EXISTS event_step_activity_select ON public.event_step_activity;
CREATE POLICY event_step_activity_select ON public.event_step_activity FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.event_steps s WHERE s.id = event_step_activity.step_id));


CREATE OR REPLACE FUNCTION private.event_step_plan(p_event uuid)
RETURNS TABLE(step_key text, stage text, kind text, source text, source_id uuid, title text, details text,
  quantity numeric, unit text, supplier text, owner_role text, due_at timestamptz, blocks_ready boolean,
  sort_order integer, depends_on text[])
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  ev record;
  t_accept timestamptz; t_start timestamptz; t_end timestamptz; t_loading timestamptz; t_paid timestamptz;
  has_equipment boolean; has_driver boolean; requirements text; manual_blocking text[];
  is_wedding boolean; has_deposit boolean; t_deposit timestamptz;
BEGIN
  SELECT e.id, e.status::text AS status, e.event_date, e.event_end_date INTO ev FROM public.events e WHERE e.id = p_event;
  IF ev.id IS NULL OR ev.event_date IS NULL
     OR ev.status NOT IN ('offer_accepted','in_preparation','ready_for_live','in_progress','completed','invoiced','settled') THEN
    RETURN;
  END IF;

  t_start := ev.event_date;
  t_end := greatest(coalesce(ev.event_end_date, ev.event_date), ev.event_date);
  t_accept := coalesce(
    (SELECT h.requested_at FROM public.event_warehouse_handoffs h WHERE h.event_id = p_event),
    (SELECT max(o.updated_at) FROM public.offers o WHERE o.event_id = p_event AND o.status::text = 'accepted'),
    least(now(), t_start));
  SELECT min(p.start_time) INTO t_loading FROM public.event_phases p
    LEFT JOIN public.event_phase_types t ON t.id = p.phase_type_id
   WHERE p.event_id = p_event AND p.start_time IS NOT NULL AND coalesce(t.name, p.name) ILIKE 'za_adunek%';
  t_loading := least(coalesce(t_loading, t_start - interval '6 hours'), t_start);
  t_paid := (SELECT max(i.payment_due_date)::timestamptz + interval '12 hours' FROM public.invoices i
              WHERE i.event_id = p_event AND i.invoice_type IN ('vat','final','advance')
                AND i.status NOT IN ('draft','cancelled','proforma'));

  has_equipment := EXISTS (SELECT 1 FROM public.event_equipment x WHERE x.event_id = p_event
    AND NOT coalesce(x.removed_from_offer, false));
  has_driver := EXISTS (SELECT 1 FROM public.event_vehicles v WHERE v.event_id = p_event
    AND v.driver_id IS NOT NULL AND coalesce(v.status,'planned') <> 'cancelled');
  is_wedding := EXISTS (SELECT 1 FROM public.wedding_cards w WHERE w.event_id = p_event);
  SELECT min(m.due_date)::timestamptz + interval '12 hours', count(*) > 0 INTO t_deposit, has_deposit
    FROM public.event_payment_milestones m
   WHERE m.event_id = p_event AND m.milestone_type = 'deposit' AND m.status <> 'waived';
  SELECT coalesce(array_agg(s.step_key ORDER BY s.created_at), '{}') INTO manual_blocking FROM public.event_steps s
   WHERE s.event_id = p_event AND s.source = 'manual' AND s.blocks_ready AND s.status <> 'archived';

  -- Wymagania usług wobec klienta i obiektu (zgody, czujki, zasilanie).
  SELECT string_agg(DISTINCT '• ' || coalesce(nullif(btrim(oi.name),''), op.name) || ': ' || btrim(r->>'title')
           || CASE WHEN nullif(btrim(r->>'description'),'') IS NOT NULL THEN ' — ' || btrim(r->>'description') ELSE '' END, E'\n')
    INTO requirements
    FROM public.offers o
    JOIN public.offer_items oi ON oi.offer_id = o.id
    JOIN public.offer_products op ON op.id = oi.product_id
    CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(op.offer_additional_requirements) = 'array'
      THEN op.offer_additional_requirements ELSE '[]'::jsonb END) r
   WHERE o.event_id = p_event AND o.status::text = 'accepted' AND jsonb_typeof(r) = 'object'
     AND nullif(btrim(r->>'title'),'') IS NOT NULL;

  RETURN QUERY
  WITH prep AS (
    -- Zamówienia / sprawdzenia / potwierdzenia z konfiguracji usług zaakceptowanej oferty.
    SELECT 'product:' || tpl.id || ':' || oi.id AS step_key, 'preparation'::text AS stage, tpl.kind, 'product'::text AS source,
           tpl.id AS source_id, tpl.title,
           nullif(concat_ws(E'\n', nullif(btrim(tpl.details),''), 'Usługa: ' || coalesce(nullif(btrim(oi.name),''), op.name)), '') AS details,
           CASE WHEN tpl.quantity_per_unit IS NOT NULL THEN round(tpl.quantity_per_unit * greatest(coalesce(oi.quantity,1),1), 2) END AS quantity,
           tpl.unit, tpl.supplier, tpl.owner_role,
           (CASE WHEN tpl.anchor = 'loading' THEN t_loading ELSE t_start END) - make_interval(days => tpl.lead_days) AS due_at,
           tpl.blocks_ready, 100 + tpl.order_index AS sort_order,
           CASE WHEN tpl.owner_role = 'warehouse' THEN ARRAY['warehouse_accept'] ELSE '{}'::text[] END AS depends_on
      FROM public.offers o
      JOIN public.offer_items oi ON oi.offer_id = o.id
      JOIN public.offer_products op ON op.id = oi.product_id
      JOIN public.offer_product_preparation_items tpl ON tpl.product_id = oi.product_id AND tpl.is_active
     WHERE o.event_id = p_event AND o.status::text = 'accepted'
    UNION ALL
    -- Zaakceptowane braki w magazynie.
    SELECT 'shortage:' || x.id, 'preparation', 'order', 'shortage', x.id,
           'Zapewnij brakujący sprzęt: ' || coalesce(i.name, k.name, c.name, 'sprzęt') || ' × ' || coalesce(x.quantity, 1),
           'Brak w magazynie zaakceptowany przy rezerwacji — wynajem, zakup albo zamiana.',
           x.quantity::numeric, 'szt.', NULL, 'warehouse', t_loading - interval '2 days', true, 200, ARRAY['warehouse_accept']
      FROM public.event_equipment x
      LEFT JOIN public.equipment_items i ON i.id = x.equipment_id
      LEFT JOIN public.equipment_kits k ON k.id = x.kit_id
      LEFT JOIN public.cables c ON c.id = x.cable_id
     WHERE x.event_id = p_event AND coalesce(x.is_optional, false) AND x.reservation_status::text = 'planned'
       AND NOT coalesce(x.removed_from_offer, false)
    UNION ALL
    -- Wynajem zewnętrzny.
    SELECT 'rental:' || x.id, 'preparation', 'order', 'rental', x.id,
           'Potwierdź wynajem zewnętrzny: ' || coalesce(i.name, k.name, c.name, 'sprzęt') || ' × ' || coalesce(x.quantity, 1),
           'Ustal odbiór i zwrot u wynajmującego.', x.quantity::numeric, 'szt.', NULL, 'warehouse', t_loading - interval '2 days', true, 210,
           ARRAY['warehouse_accept']
      FROM public.event_equipment x
      LEFT JOIN public.equipment_items i ON i.id = x.equipment_id
      LEFT JOIN public.equipment_kits k ON k.id = x.kit_id
      LEFT JOIN public.cables c ON c.id = x.cable_id
     WHERE x.event_id = p_event AND coalesce(x.use_external_rental, false)
       AND NOT coalesce(x.is_optional, false) AND NOT coalesce(x.removed_from_offer, false)
    UNION ALL
    -- Sprzęt ze sprawdzeniem stanu przed wydaniem (pozycje i składniki zestawów).
    SELECT 'check:' || i.id, 'preparation', 'stock_check', 'equipment', i.id,
           'Sprawdź stan: ' || i.name, nullif(btrim(i.pre_check_instructions), ''), NULL::numeric, NULL, NULL, 'warehouse',
           t_loading - interval '2 days', true, 220, ARRAY['warehouse_accept']
      FROM public.equipment_items i
     WHERE i.requires_pre_check AND i.deleted_at IS NULL
       AND i.id IN (
         SELECT x.equipment_id FROM public.event_equipment x
          WHERE x.event_id = p_event AND x.equipment_id IS NOT NULL
            AND NOT coalesce(x.is_optional, false) AND NOT coalesce(x.removed_from_offer, false)
         UNION
         SELECT ki.equipment_id FROM public.event_equipment x JOIN public.equipment_kit_items ki ON ki.kit_id = x.kit_id
          WHERE x.event_id = p_event AND ki.equipment_id IS NOT NULL
            AND NOT coalesce(x.is_optional, false) AND NOT coalesce(x.removed_from_offer, false))
  ), flags AS (
    SELECT coalesce(array_agg(p.step_key ORDER BY p.sort_order, p.step_key) FILTER (WHERE p.blocks_ready), '{}') AS blocking_keys,
           coalesce(bool_or(p.owner_role = 'warehouse'), false) AS warehouse_prep
      FROM prep p
  ), sys AS (
    SELECT v.* FROM flags f CROSS JOIN LATERAL (VALUES
      ('formal_details','formalities','approval','Uzupełnij kluczowe dane wydarzenia',
       'Data, miejsce i klient (organizacja albo osoba kontaktowa). Krok zamyka się sam po uzupełnieniu danych.',
       'sales', t_accept + interval '1 day', false, 1, '{}'::text[], true),
      ('formal_contract','formalities','approval','Podpisana umowa z klientem',
       'Wyślij umowę i zapisz ją jako podpisaną w zakładce Umowa. Krok zamyka się sam (także gdy ustalenia z partnerem nie wymagają umowy).',
       'sales', greatest(t_accept, least(t_start - interval '1 day', greatest(t_start - interval '14 days', t_accept + interval '3 days'))),
       false, 2, '{}'::text[], true),
      ('formal_deposit','formalities','approval','Zaliczka lub zadatek wpłacone',
       'Krok zamyka się sam po zaksięgowaniu wpłaty z harmonogramu płatności (zakładka Finanse).',
       'sales', greatest(t_accept, coalesce(t_deposit, t_start - interval '7 days')), false, 3, '{}'::text[], has_deposit),
      ('sales_handoff','handoff','handoff','Przekaż realizację do magazynu',
       'Sprawdź, że sprzęt jest zarezerwowany (braki oznaczone), miejsce, kontakt i godziny są uzupełnione, a klient zna wymagania usług. Krok zamyka się też sam, gdy magazyn przyjmie realizację.',
       'sales', t_accept + interval '1 day', false, 10, '{}'::text[], true),
      ('warehouse_accept','handoff','handoff','Przyjmij realizację do przygotowania',
       'Przyjęcie oznacza, że magazyn odpowiada za przygotowanie sprzętu, zamówienia i sprawdzenia stanu tego wydarzenia. Przyjmująca osoba zostaje opiekunem wydarzenia w magazynie.',
       'warehouse', greatest(t_accept, least(t_accept + interval '2 days', t_start - interval '1 day')), false, 20, '{}'::text[],
       has_equipment OR f.warehouse_prep),
      ('manager_appointed','handoff','approval','Wyznacz kierownika realizacji',
       'Kierownik realizacji prowadzi wydarzenie na miejscu: odbiera sprzęt, startuje i kończy realizację, oddaje sprzęt do magazynu. Wyznaczasz go w zakładce Zespół — krok zamknie się sam.',
       'author', greatest(t_accept, least(t_start - interval '1 day', greatest(t_start - interval '14 days', t_accept + interval '1 day'))),
       false, 30, '{}'::text[], true),
      ('client_requirements','preparation','venue_confirmation','Potwierdź z klientem i obiektem wymagania usług',
       coalesce(requirements, ''), 'sales',
       greatest(t_accept, least(t_start - interval '1 day', greatest(t_start - interval '7 days', t_accept + interval '2 days'))),
       false, 40, '{}'::text[], requirements IS NOT NULL),
      ('wedding_card','preparation','venue_confirmation','Karta weselna wysłana do akceptacji',
       'Uzupełnij kartę weselną z parą młodą i wyślij ją do akceptacji. Krok zamyka się sam.',
       'sales', greatest(t_accept, t_start - interval '21 days'), false, 45, '{}'::text[], is_wedding),
      ('team_ready','preparation','approval','Zespół przypisany i potwierdzony',
       'Przypisz osoby w zakładce Zespół. Krok zamyka się sam, gdy wszyscy zaproszeni potwierdzą udział.',
       'author', greatest(t_accept, t_start - interval '7 days'), false, 50, '{}'::text[], true),
      ('agenda_ready','preparation','approval','Agenda realizacji gotowa',
       'Przygotuj agendę (harmonogram dnia) w zakładce Agenda. Krok zamyka się sam.',
       'author', greatest(t_accept, t_start - interval '5 days'), false, 52, '{}'::text[], true),
      ('transport_planned','preparation','approval','Transport zaplanowany',
       'Dodaj auta i kierowców w zakładce Logistyka. Krok zamyka się sam, gdy każde auto ma kierowcę.',
       'author', greatest(t_accept, t_loading - interval '2 days'), false, 54, '{}'::text[], has_equipment),
      ('warehouse_ready','preparation','approval','Oznacz przygotowanie jako gotowe',
       'Możliwe dopiero, gdy zamówienia, sprawdzenia stanu, braki i wynajmy są zamknięte, a kierownik realizacji wyznaczony.',
       'warehouse', greatest(t_accept, t_loading - interval '1 day'), false, 300,
       ARRAY['warehouse_accept','manager_appointed'] || f.blocking_keys || manual_blocking,
       has_equipment OR f.warehouse_prep),
      ('dispatch_out','dispatch','handoff','Wydaj sprzęt — załadunek zgodny z listą',
       'Odhacz załadowane pozycje i potwierdź wydanie. Rozbieżności opisz w notatce. Potwierdzenie blokuje listę załadunku.',
       'warehouse', t_loading, false, 400, ARRAY['warehouse_ready'], has_equipment),
      ('dispatch_receive','dispatch','handoff','Odbierz sprzęt i auto',
       'Odbierający potwierdza zgodność załadunku z listą (albo zgłasza problem). Od tej chwili odpowiada za sprzęt w drodze i na miejscu. Krok zamyka się też sam po odbiorze auta z licznikiem.',
       CASE WHEN has_driver THEN 'driver' ELSE 'manager' END, t_loading, false, 410, ARRAY['dispatch_out'], has_equipment),
      ('realization_start','realization','approval','Przejmij realizację na miejscu',
       'Kierownik realizacji potwierdza start na miejscu.', 'manager', t_start, false, 500,
       CASE WHEN has_equipment OR f.warehouse_prep THEN ARRAY['warehouse_ready']
            ELSE ARRAY['manager_appointed'] || f.blocking_keys || manual_blocking END, true),
      ('realization_complete','realization','approval','Zakończ realizację z raportem',
       'Raport: przebieg, dodatkowe godziny, uwagi klienta, szkody.', 'manager', t_end + interval '12 hours', false, 510,
       ARRAY['realization_start'], true),
      ('return_handover','return','handoff','Oddaj sprzęt do magazynu',
       'Kierownik (albo kierowca) przekazuje sprzęt magazynowi. Braki i uszkodzenia opisz w notatce albo zgłoś jako problem.', 'manager',
       t_end + interval '1 day', false, 600, ARRAY['realization_complete'], has_equipment),
      ('return_check','return','handoff','Przyjmij zwrot i sprawdź sprzęt',
       'Magazyn sprawdza zwrot z listą. Braki i uszkodzenia zgłoś jako problem z opisem.', 'warehouse',
       t_end + interval '2 days', false, 610, ARRAY['return_handover'], has_equipment),
      ('settlement_invoice','settlement','approval','Wystaw fakturę za wydarzenie',
       'Krok zamyka się sam po wystawieniu faktury powiązanej z wydarzeniem.', 'admin',
       t_end + interval '7 days', false, 700, '{}'::text[], true),
      ('settlement_paid','settlement','approval','Potwierdź wpłatę za wydarzenie',
       'Krok zamyka się sam, gdy faktury wydarzenia są opłacone.', 'admin',
       coalesce(t_paid, t_end + interval '21 days'), false, 710, ARRAY['settlement_invoice'], true)
    ) AS v(step_key, stage, kind, title, details, owner_role, due_at, blocks_ready, sort_order, depends_on, include)
  )
  SELECT s.step_key, s.stage, s.kind, 'system'::text, NULL::uuid, s.title, nullif(s.details,''), NULL::numeric, NULL::text, NULL::text,
         s.owner_role, s.due_at, s.blocks_ready, s.sort_order, s.depends_on
    FROM sys s WHERE s.include
  UNION ALL
  SELECT p.step_key, p.stage, p.kind, p.source, p.source_id, p.title, p.details, p.quantity, p.unit, p.supplier,
         p.owner_role, p.due_at, p.blocks_ready, p.sort_order, p.depends_on
    FROM prep p;
END $$;

CREATE OR REPLACE FUNCTION public.sync_event_steps(p_event uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE ev record; planned text[]; h record; r record; invoiced boolean; paid boolean; picked_up boolean;
  details_ok boolean; contract_ok boolean; deposit_ok boolean; wedding_ok boolean; team_ok boolean; agenda_ok boolean; transport_ok boolean;
BEGIN
  IF p_event IS NULL THEN RETURN; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('event_steps:' || p_event::text));
  SELECT e.id, e.status::text AS status, coalesce(e.loading_confirmed, false) AS loading_ok, e.loading_confirmed_at, e.loading_confirmed_by
    INTO ev FROM public.events e WHERE e.id = p_event;
  IF ev.id IS NULL THEN RETURN; END IF;

  IF ev.status = 'cancelled' THEN
    UPDATE public.event_steps s SET status = 'archived', updated_at = now(),
           status_note = CASE WHEN s.status = 'problem' THEN 'Problem: ' || s.status_note || ' · wydarzenie anulowane.' ELSE 'Wydarzenie anulowane.' END
     WHERE s.event_id = p_event AND s.status IN ('open','in_progress','problem');
    RETURN;
  END IF;

  IF ev.status <> 'settled' THEN
    SELECT coalesce(array_agg(p.step_key), '{}') INTO planned FROM private.event_step_plan(p_event) p;

    INSERT INTO public.event_steps AS s (event_id, step_key, stage, kind, source, source_id, title, details, quantity, unit,
        supplier, owner_role, assignee_id, due_at, blocks_ready, sort_order, depends_on)
    SELECT p_event, p.step_key, p.stage, p.kind, p.source, p.source_id, p.title, p.details, p.quantity, p.unit,
           p.supplier, p.owner_role, public.event_step_assignee(p_event, p.owner_role), p.due_at, p.blocks_ready,
           p.sort_order, p.depends_on
      FROM private.event_step_plan(p_event) p
    ON CONFLICT (event_id, step_key) DO UPDATE SET
      stage = excluded.stage, kind = excluded.kind, source = excluded.source, source_id = excluded.source_id,
      title = excluded.title, details = excluded.details, quantity = excluded.quantity, unit = excluded.unit,
      supplier = coalesce(s.supplier, excluded.supplier), owner_role = excluded.owner_role,
      assignee_id = CASE WHEN s.assigned_manually AND s.owner_role = excluded.owner_role THEN s.assignee_id
                         ELSE coalesce(excluded.assignee_id, CASE WHEN s.owner_role = excluded.owner_role THEN s.assignee_id END) END,
      assigned_manually = s.assigned_manually AND s.owner_role = excluded.owner_role,
      due_at = CASE WHEN s.status IN ('done','skipped') THEN s.due_at ELSE excluded.due_at END,
      blocks_ready = excluded.blocks_ready, sort_order = excluded.sort_order, depends_on = excluded.depends_on,
      status = CASE WHEN s.status = 'archived' THEN 'open' ELSE s.status END,
      status_note = CASE WHEN s.status = 'archived' THEN NULL ELSE s.status_note END,
      updated_at = now()
    WHERE (s.stage, s.kind, s.source, s.source_id, s.title, s.details, s.quantity, s.unit, s.owner_role,
           s.due_at, s.blocks_ready, s.sort_order, s.depends_on, s.status)
          IS DISTINCT FROM
          (excluded.stage, excluded.kind, excluded.source, excluded.source_id, excluded.title, excluded.details,
           excluded.quantity, excluded.unit, excluded.owner_role,
           CASE WHEN s.status IN ('done','skipped') THEN s.due_at ELSE excluded.due_at END,
           excluded.blocks_ready, excluded.sort_order, excluded.depends_on,
           CASE WHEN s.status = 'archived' THEN 'open' ELSE s.status END)
       OR (NOT s.assigned_manually AND excluded.assignee_id IS NOT NULL AND s.assignee_id IS DISTINCT FROM excluded.assignee_id);

    -- Braki rozwiązane w rezerwacji zamykamy; pozostałe kroki spoza planu archiwizujemy.
    UPDATE public.event_steps s SET status = 'done', completed_at = now(), completed_by = NULL,
           completed_by_name = 'Rezerwacja sprzętu', status_note = 'Brak rozwiązany w rezerwacji sprzętu.', updated_at = now()
     WHERE s.event_id = p_event AND s.status IN ('open','in_progress','problem') AND s.source = 'shortage'
       AND NOT (s.step_key = ANY(planned))
       AND EXISTS (SELECT 1 FROM public.event_equipment x WHERE x.id = s.source_id AND NOT coalesce(x.removed_from_offer, false));
    UPDATE public.event_steps s SET status = 'archived', updated_at = now(),
           status_note = CASE WHEN s.status = 'problem' THEN 'Problem: ' || s.status_note || ' · poza zakresem wydarzenia.' ELSE 'Poza zakresem wydarzenia.' END
     WHERE s.event_id = p_event AND s.status IN ('open','in_progress','problem') AND s.source <> 'manual'
       AND NOT (s.step_key = ANY(planned));
  END IF;

  -- Prawda procesu → kroki systemowe. Dwukierunkowo (zamknij / otwórz ponownie) tam, gdzie proces jest źródłem prawdy.
  SELECT hh.accepted_at, hh.accepted_by, hh.accepted_by_name, hh.ready_at, hh.ready_by, hh.ready_by_name INTO h
    FROM public.event_warehouse_handoffs hh WHERE hh.event_id = p_event;
  SELECT rr.manager_id, rr.started_at, rr.started_by, rr.completed_at, rr.completed_by INTO r
    FROM public.event_realizations rr JOIN public.employees e ON e.id = rr.manager_id AND e.is_active WHERE rr.event_id = p_event;
  invoiced := EXISTS (SELECT 1 FROM public.invoices i WHERE i.event_id = p_event AND i.invoice_type IN ('vat','final','advance')
                AND i.status NOT IN ('draft','cancelled','proforma'));
  paid := ev.status = 'settled' OR (invoiced AND NOT EXISTS (SELECT 1 FROM public.invoices i WHERE i.event_id = p_event
                AND i.invoice_type IN ('vat','final','advance') AND i.status NOT IN ('draft','cancelled','proforma')
                AND coalesce(i.payment_status, 'unpaid') IN ('unpaid','partially_paid','overdue')));
  picked_up := EXISTS (SELECT 1 FROM public.event_vehicles v WHERE v.event_id = p_event AND v.pickup_timestamp IS NOT NULL
                AND coalesce(v.status,'planned') <> 'cancelled');

  details_ok := EXISTS (SELECT 1 FROM public.events e WHERE e.id = p_event AND e.event_date IS NOT NULL
                  AND nullif(btrim(coalesce(e.location, '')), '') IS NOT NULL
                  AND (e.contact_person_id IS NOT NULL OR e.organization_id IS NOT NULL));
  contract_ok := EXISTS (SELECT 1 FROM public.event_partner_arrangements a WHERE a.event_id = p_event AND a.enabled AND NOT a.include_contract)
              OR EXISTS (SELECT 1 FROM public.contracts c WHERE c.event_id = p_event
                          AND c.status::text IN ('signed_by_client','signed_returned','completed'));
  deposit_ok := NOT EXISTS (SELECT 1 FROM public.event_payment_milestones m WHERE m.event_id = p_event
                  AND m.milestone_type = 'deposit' AND m.status NOT IN ('paid','waived'));
  wedding_ok := EXISTS (SELECT 1 FROM public.wedding_cards w WHERE w.event_id = p_event AND w.status IN ('submitted','approved'));
  team_ok := EXISTS (SELECT 1 FROM public.employee_assignments a WHERE a.event_id = p_event AND a.status = 'accepted')
         AND NOT EXISTS (SELECT 1 FROM public.employee_assignments a WHERE a.event_id = p_event AND coalesce(a.status, 'pending') = 'pending');
  agenda_ok := EXISTS (SELECT 1 FROM public.event_agendas g WHERE g.event_id = p_event);
  transport_ok := EXISTS (SELECT 1 FROM public.event_vehicles v WHERE v.event_id = p_event AND coalesce(v.status, 'planned') <> 'cancelled')
              AND NOT EXISTS (SELECT 1 FROM public.event_vehicles v WHERE v.event_id = p_event AND coalesce(v.status, 'planned') <> 'cancelled'
                               AND v.driver_id IS NULL AND NOT coalesce(v.is_external, false));

  WITH truth(step_key, met, at, who, who_name, two_way) AS (VALUES
      ('formal_details', details_ok, NULL::timestamptz, NULL::uuid, 'Dane wydarzenia'::text, true),
      ('formal_contract', contract_ok, NULL::timestamptz, NULL::uuid, 'Umowa'::text, true),
      ('formal_deposit', deposit_ok, NULL::timestamptz, NULL::uuid, 'Płatność'::text, true),
      ('wedding_card', wedding_ok, NULL::timestamptz, NULL::uuid, 'Karta weselna'::text, true),
      ('team_ready', team_ok, NULL::timestamptz, NULL::uuid, 'Zespół'::text, true),
      ('agenda_ready', agenda_ok, NULL::timestamptz, NULL::uuid, 'Agenda'::text, true),
      ('transport_planned', transport_ok, NULL::timestamptz, NULL::uuid, 'Logistyka'::text, true),
      ('warehouse_accept', h.accepted_at IS NOT NULL, h.accepted_at, h.accepted_by, h.accepted_by_name, true),
      ('sales_handoff', h.accepted_at IS NOT NULL, h.accepted_at, NULL::uuid, 'Przyjęte przez magazyn'::text, false),
      ('warehouse_ready', h.ready_at IS NOT NULL, h.ready_at, h.ready_by, h.ready_by_name, true),
      ('manager_appointed', r.manager_id IS NOT NULL, NULL::timestamptz, NULL::uuid,
        (SELECT coalesce(nullif(concat_ws(' ', e.name, e.surname), ''), e.nickname) FROM public.employees e WHERE e.id = r.manager_id), true),
      ('dispatch_out', ev.loading_ok, ev.loading_confirmed_at, ev.loading_confirmed_by, NULL::text, true),
      ('dispatch_receive', picked_up, NULL::timestamptz, NULL::uuid, 'Odbiór auta'::text, false),
      ('realization_start', r.started_at IS NOT NULL, r.started_at, r.started_by, NULL::text, true),
      ('realization_complete', r.completed_at IS NOT NULL, r.completed_at, r.completed_by, NULL::text, true),
      ('settlement_invoice', invoiced OR ev.status = 'settled', NULL::timestamptz, NULL::uuid, 'Faktura'::text, true),
      ('settlement_paid', paid, NULL::timestamptz, NULL::uuid, 'Rozliczenie'::text, true)
  ), changes AS (
    SELECT s.id, s.status AS old_status, t.met, t.at, t.who, t.who_name
      FROM public.event_steps s JOIN truth t ON t.step_key = s.step_key
     WHERE s.event_id = p_event AND s.status <> 'archived'
       AND ((t.met AND s.status NOT IN ('done','skipped')) OR (t.two_way AND NOT t.met AND s.status = 'done'))
  ), applied AS (
    UPDATE public.event_steps s SET
      status = CASE WHEN c.met THEN 'done' ELSE 'open' END,
      completed_at = CASE WHEN c.met THEN coalesce(c.at, now()) END,
      completed_by = CASE WHEN c.met THEN c.who END,
      completed_by_name = CASE WHEN c.met THEN coalesce(c.who_name,
        (SELECT coalesce(nullif(concat_ws(' ', e.name, e.surname), ''), e.nickname) FROM public.employees e WHERE e.id = c.who)) END,
      status_note = CASE WHEN c.met THEN s.status_note ELSE 'Cofnięto w procesie wydarzenia.' END,
      updated_at = now()
    FROM changes c WHERE s.id = c.id
    RETURNING s.id, s.event_id, c.old_status, s.status
  )
  INSERT INTO public.event_step_activity(step_id, event_id, action, from_status, to_status, performed_by_name)
  SELECT a.id, a.event_id, CASE WHEN a.status = 'done' THEN 'auto_done' ELSE 'auto_reopen' END, a.old_status, a.status, 'System'
    FROM applied a
   -- Krok zamykany właśnie przez update_event_step ma własny wpis w historii.
   WHERE a.id::text IS DISTINCT FROM nullif(current_setting('mavinci.event_step_in_action', true), '');

  -- Wydarzenie rozliczone = zamknięte: pozostałe otwarte kroki archiwizujemy.
  IF ev.status = 'settled' THEN
    UPDATE public.event_steps s SET status = 'archived', updated_at = now(),
           status_note = CASE WHEN s.status = 'problem' THEN 'Problem: ' || s.status_note || ' · wydarzenie rozliczone.' ELSE 'Wydarzenie rozliczone.' END
     WHERE s.event_id = p_event AND s.status IN ('open','in_progress','problem');
  END IF;
END $$;

CREATE OR REPLACE FUNCTION private.event_step_json(s public.event_steps, p_can_act boolean, p_can_override boolean)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT jsonb_build_object(
    'id', s.id, 'event_id', s.event_id, 'key', s.step_key, 'stage', s.stage, 'kind', s.kind, 'source', s.source,
    'title', s.title, 'details', s.details, 'quantity', s.quantity, 'unit', s.unit, 'supplier', s.supplier,
    'owner_role', s.owner_role, 'due_at', s.due_at, 'status', s.status, 'status_note', s.status_note,
    'ordered_at', s.ordered_at, 'expected_at', s.expected_at, 'completed_at', s.completed_at,
    'completed_by_name', s.completed_by_name, 'blocks_ready', s.blocks_ready, 'sort_order', s.sort_order,
    'is_mine', s.assignee_id IS NOT NULL AND s.assignee_id = public.sales_employee_id(),
    'completed_by_me', s.completed_by IS NOT NULL AND s.completed_by = public.sales_employee_id(),
    'assignee', (SELECT jsonb_build_object('id', e.id, 'name', coalesce(nullif(concat_ws(' ', e.name, e.surname), ''), e.nickname),
                   'phone', e.phone_number) FROM public.employees e WHERE e.id = s.assignee_id),
    'blocked_by', coalesce((SELECT jsonb_agg(jsonb_build_object('key', d.step_key, 'title', d.title, 'owner_role', d.owner_role)
                   ORDER BY d.sort_order) FROM public.event_steps d WHERE d.event_id = s.event_id AND d.step_key = ANY(s.depends_on)
                    AND d.status NOT IN ('done','skipped','archived')), '[]'::jsonb),
    'overdue', s.status IN ('open','in_progress','problem') AND s.due_at IS NOT NULL AND s.due_at < now(),
    'can_act', p_can_act AND s.status IN ('open','in_progress','problem'),
    'can_override', p_can_override,
    'system_managed', s.step_key = ANY(private.event_step_auto_keys()),
    'history', coalesce((SELECT jsonb_agg(jsonb_build_object('action', a.action, 'to_status', a.to_status, 'note', a.note,
                   'by', a.performed_by_name, 'at', a.created_at) ORDER BY a.created_at DESC)
                   FROM (SELECT x.* FROM public.event_step_activity x WHERE x.step_id = s.id ORDER BY x.created_at DESC LIMIT 5) a), '[]'::jsonb)
  );
$$;

CREATE OR REPLACE FUNCTION public.get_event_steps(p_event_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE override boolean; roles jsonb; steps jsonb; docs boolean;
BEGIN
  IF NOT public.can_view_event_steps(p_event_id) THEN
    RAISE EXCEPTION 'Brak dostępu do kroków tego wydarzenia.' USING ERRCODE = '42501';
  END IF;
  override := private.event_step_can_override(p_event_id);
  docs := public.can_view_event_area(p_event_id, 'commercial_docs');
  SELECT jsonb_object_agg(role, private.event_step_can_act(p_event_id, role)) INTO roles
    FROM unnest(ARRAY['sales','warehouse','manager','driver','admin','author']) role;
  SELECT coalesce(jsonb_agg(private.event_step_json(s, coalesce((roles->>s.owner_role)::boolean, false), override)
                  ORDER BY s.sort_order, s.created_at), '[]'::jsonb)
    INTO steps FROM public.event_steps s WHERE s.event_id = p_event_id AND s.status <> 'archived'
     AND (docs OR s.stage NOT IN ('formalities','settlement'));
  RETURN jsonb_build_object(
    'event_id', p_event_id,
    'my_roles', roles,
    'can_override', override,
    'can_add', EXISTS (SELECT 1 FROM public.events e WHERE e.id = p_event_id
                 AND e.status::text IN ('offer_accepted','in_preparation','ready_for_live','in_progress','completed','invoiced'))
               AND (override OR public.is_realization_manager(p_event_id) OR public.can_prepare_warehouse_event(p_event_id)
                    OR public.can_direct_realization(p_event_id) OR coalesce((roles->>'sales')::boolean, false)),
    'steps', steps,
    -- Na kogo czekamy: otwarte kroki bez niezamkniętych poprzedników, według terminu.
    'waiting_for', coalesce((SELECT jsonb_agg(w ORDER BY (w->>'due_at')::timestamptz NULLS LAST, (w->>'sort_order')::int)
       FROM jsonb_array_elements(steps) w
       WHERE w->>'status' IN ('open','in_progress','problem') AND jsonb_array_length(w->'blocked_by') = 0), '[]'::jsonb),
    'progress', coalesce((SELECT jsonb_object_agg(x.stage, jsonb_build_object('total', x.total, 'done', x.done)) FROM (
       SELECT s.stage, count(*) total, count(*) FILTER (WHERE s.status IN ('done','skipped')) done
         FROM public.event_steps s WHERE s.event_id = p_event_id AND s.status <> 'archived'
          AND (docs OR s.stage NOT IN ('formalities','settlement')) GROUP BY s.stage) x), '{}'::jsonb),
    'show_commercial', docs
  );
END $$;

CREATE OR REPLACE FUNCTION public.get_my_event_steps()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE actor uuid := public.sales_employee_id();
BEGIN
  IF actor IS NULL OR public.current_session_is_seller_portal() THEN
    RAISE EXCEPTION 'Wymagane konto pracownika CRM.' USING ERRCODE = '42501';
  END IF;
  RETURN coalesce((
    SELECT jsonb_agg(x.j || jsonb_build_object('event', jsonb_build_object('id', ev.id, 'name', ev.name,
             'event_date', ev.event_date, 'location', ev.location))
           ORDER BY x.due NULLS LAST, ev.event_date, x.sort_order)
      FROM (
        SELECT s.event_id, s.due_at AS due, s.sort_order,
               private.event_step_json(s, true, private.event_step_can_override(s.event_id)) AS j
          FROM public.event_steps s
          JOIN public.events v ON v.id = s.event_id AND v.status::text NOT IN ('cancelled','settled')
         WHERE s.status IN ('open','in_progress','problem')
           AND (s.due_at IS NULL OR s.due_at < now() + interval '60 days')
           AND public.employee_can_access_company(actor, v.my_company_id)
           AND NOT EXISTS (SELECT 1 FROM public.event_steps d WHERE d.event_id = s.event_id AND d.step_key = ANY(s.depends_on)
                            AND d.status NOT IN ('done','skipped','archived'))
           AND private.event_step_in_my_queue(s)
           AND public.event_step_stage_visible(s.event_id, s.stage)
         ORDER BY s.due_at NULLS LAST
         LIMIT 300
      ) x JOIN public.events ev ON ev.id = x.event_id), '[]'::jsonb);
END $$;

CREATE OR REPLACE FUNCTION private.notify_event_step(p_step uuid, p_key text, p_title text, p_message text,
  p_type text DEFAULT 'info', p_include_leads boolean DEFAULT false, p_include_admins boolean DEFAULT false)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE s public.event_steps%ROWTYPE; ev public.events%ROWTYPE; nid uuid; actor uuid := public.sales_employee_id();
BEGIN
  SELECT * INTO s FROM public.event_steps WHERE id = p_step;
  SELECT * INTO ev FROM public.events WHERE id = s.event_id;
  IF s.id IS NULL OR ev.id IS NULL THEN RETURN false; END IF;
  INSERT INTO public.notifications(category, title, message, type, related_entity_type, related_entity_id, action_url, metadata)
  VALUES ('event', p_title, format('Wydarzenie „%s”: %s', ev.name, p_message), p_type, 'event', ev.id::text,
          '/crm/events/' || ev.id || '?tab=overview',
          jsonb_build_object('event_step_key', p_key, 'event_id', ev.id, 'step_id', s.id, 'initial_tab', 'overview'))
  ON CONFLICT DO NOTHING RETURNING id INTO nid;
  IF nid IS NULL THEN RETURN false; END IF;
  INSERT INTO public.notification_recipients(notification_id, user_id)
  SELECT DISTINCT nid, e.id FROM public.employees e
   WHERE e.is_active AND e.id IS DISTINCT FROM actor AND public.employee_can_access_company(e.id, ev.my_company_id) AND (
     e.id = s.assignee_id
     OR (s.assignee_id IS NULL AND (
          (s.owner_role = 'warehouse' AND public.employee_can_prepare_event(e.id, ev.id))
       OR (s.owner_role = 'admin' AND (e.role = 'admin' OR e.access_level = 'admin'))
       OR (s.owner_role IN ('manager','author','sales') AND ev.created_by IN (e.id, e.auth_user_id))
       OR (s.owner_role = 'driver' AND e.id = public.event_step_assignee(ev.id, 'manager'))))
     OR (p_include_leads AND ((s.stage NOT IN ('formalities','settlement') AND e.id = public.event_step_assignee(ev.id, 'manager'))
                              OR ev.created_by IN (e.id, e.auth_user_id)))
     OR (p_include_admins AND (e.role = 'admin' OR e.access_level = 'admin')))
  ON CONFLICT DO NOTHING;
  RETURN true;
END $$;

CREATE OR REPLACE FUNCTION public.update_event_step(p_step_id uuid, p_action text, p_note text DEFAULT NULL, p_payload jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  actor uuid := public.sales_employee_id(); actor_name text; target_event uuid;
  s public.event_steps%ROWTYPE; can_act boolean; can_override boolean; blocked text; note text := nullif(btrim(p_note), '');
  new_status text; expected timestamptz; unloaded int;
BEGIN
  IF actor IS NULL OR public.current_session_is_seller_portal() THEN
    RAISE EXCEPTION 'Wymagane konto pracownika CRM.' USING ERRCODE = '42501';
  END IF;
  IF p_action IS NULL OR p_action NOT IN ('take','start','done','problem','reopen','skip') THEN
    RAISE EXCEPTION 'Nieprawidłowa czynność kroku.' USING ERRCODE = '22023';
  END IF;
  IF note IS NOT NULL AND length(note) > 2000 THEN
    RAISE EXCEPTION 'Notatka może mieć najwyżej 2000 znaków.' USING ERRCODE = '22023';
  END IF;
  SELECT st.event_id INTO target_event FROM public.event_steps st WHERE st.id = p_step_id;
  IF target_event IS NULL OR NOT public.can_view_event_steps(target_event) THEN
    RAISE EXCEPTION 'Nie znaleziono kroku.' USING ERRCODE = 'P0002';
  END IF;
  -- Kolejność blokad jak w całym procesie: wydarzenie → blokada doradcza → krok.
  PERFORM 1 FROM public.events WHERE id = target_event FOR UPDATE;
  PERFORM pg_advisory_xact_lock(hashtext('event_steps:' || target_event::text));
  SELECT * INTO s FROM public.event_steps WHERE id = p_step_id FOR UPDATE;
  PERFORM set_config('mavinci.event_step_in_action', s.id::text, true);
  IF NOT public.event_step_stage_visible(s.event_id, s.stage) THEN
    RAISE EXCEPTION 'Nie znaleziono kroku.' USING ERRCODE = 'P0002';
  END IF;
  IF s.status = 'archived' THEN RAISE EXCEPTION 'Ten krok jest zamknięty (archiwum).' USING ERRCODE = '22023'; END IF;
  can_act := private.event_step_can_act(s.event_id, s.owner_role);
  can_override := private.event_step_can_override(s.event_id);
  SELECT coalesce(nullif(concat_ws(' ', e.name, e.surname), ''), e.nickname) INTO actor_name FROM public.employees e WHERE e.id = actor;
  SELECT string_agg(d.title, '; ' ORDER BY d.sort_order) INTO blocked FROM public.event_steps d
   WHERE d.event_id = s.event_id AND d.step_key = ANY(s.depends_on) AND d.status NOT IN ('done','skipped','archived');

  IF p_action IN ('take','start','done','problem') AND NOT can_act THEN
    RAISE EXCEPTION 'Ten krok należy do innej roli. Poproś właściciela kroku albo kierownika o jego wykonanie.' USING ERRCODE = '42501';
  END IF;
  IF p_action IN ('take','start','done','problem','skip') AND s.status NOT IN ('open','in_progress','problem') THEN
    RAISE EXCEPTION 'Krok jest już zamknięty.' USING ERRCODE = '22023';
  END IF;
  IF p_action IN ('done','start') AND blocked IS NOT NULL THEN
    RAISE EXCEPTION 'Najpierw muszą być zamknięte: %', blocked USING ERRCODE = '22023';
  END IF;

  IF p_action = 'take' THEN
    UPDATE public.event_steps SET assignee_id = actor, assigned_manually = true, updated_at = now() WHERE id = s.id;
    new_status := s.status;

  ELSIF p_action = 'start' THEN
    IF s.status NOT IN ('open','problem') THEN RAISE EXCEPTION 'Krok jest już w toku.' USING ERRCODE = '22023'; END IF;
    IF s.source = 'system' THEN RAISE EXCEPTION 'Ten krok potwierdza się przyciskiem „Gotowe”.' USING ERRCODE = '22023'; END IF;
    BEGIN expected := nullif(p_payload->>'expected_at', '')::timestamptz;
    EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'Nieprawidłowa data dostawy.' USING ERRCODE = '22023'; END;
    UPDATE public.event_steps SET status = 'in_progress', status_note = coalesce(note, status_note),
           ordered_at = CASE WHEN kind = 'order' THEN coalesce(ordered_at, now()) ELSE ordered_at END,
           supplier = coalesce(nullif(left(btrim(p_payload->>'supplier'), 300), ''), supplier),
           expected_at = coalesce(expected, expected_at),
           assignee_id = coalesce(assignee_id, actor), updated_at = now()
     WHERE id = s.id;
    new_status := 'in_progress';

  ELSIF p_action = 'done' THEN
    IF s.step_key = 'manager_appointed' THEN
      RAISE EXCEPTION 'Kierownika realizacji wyznacza się w zakładce Zespół — krok zamknie się sam.' USING ERRCODE = '22023';
    ELSIF s.step_key IN ('settlement_invoice','settlement_paid') THEN
      RAISE EXCEPTION 'Ten krok zamyka się sam po wystawieniu faktury lub zaksięgowaniu wpłaty.' USING ERRCODE = '22023';
    ELSIF s.step_key = ANY(private.event_step_auto_keys()) THEN
      RAISE EXCEPTION 'Ten krok zamyka się sam, gdy dane w wydarzeniu są uzupełnione — przejdź do zakładki opisanej w kroku.' USING ERRCODE = '22023';
    ELSIF s.step_key = 'warehouse_accept' THEN
      PERFORM public.accept_warehouse_event(s.event_id);
    ELSIF s.step_key = 'warehouse_ready' THEN
      PERFORM public.advance_warehouse_event(s.event_id, 'ready');
    ELSIF s.step_key = 'realization_start' THEN
      PERFORM public.advance_realization(s.event_id, 'start', note);
    ELSIF s.step_key = 'realization_complete' THEN
      IF note IS NULL OR length(note) < 5 THEN RAISE EXCEPTION 'Dodaj krótki raport z realizacji.' USING ERRCODE = '22023'; END IF;
      PERFORM public.advance_realization(s.event_id, 'complete', note);
    ELSIF s.step_key = 'dispatch_out' THEN
      SELECT count(*) INTO unloaded FROM public.event_equipment x WHERE x.event_id = s.event_id
         AND NOT coalesce(x.is_loaded, false) AND NOT coalesce(x.removed_from_offer, false) AND NOT coalesce(x.is_optional, false);
      IF unloaded > 0 AND (note IS NULL OR length(note) < 5) THEN
        RAISE EXCEPTION 'Nieodhaczone pozycje załadunku: %. Odhacz je albo opisz rozbieżność w notatce.', unloaded USING ERRCODE = '22023';
      END IF;
      UPDATE public.events SET loading_confirmed = true, loading_confirmed_at = now(), loading_confirmed_by = actor,
             loading_locked = true, loading_notes = coalesce(note, loading_notes)
       WHERE id = s.event_id;
    END IF;
    UPDATE public.event_steps SET status = 'done', completed_at = coalesce(completed_at, now()), completed_by = coalesce(completed_by, actor),
           completed_by_name = coalesce(completed_by_name, actor_name), status_note = coalesce(note, status_note),
           assignee_id = coalesce(assignee_id, actor), updated_at = now()
     WHERE id = s.id;
    new_status := 'done';

  ELSIF p_action = 'problem' THEN
    IF note IS NULL OR length(note) < 5 THEN RAISE EXCEPTION 'Opisz problem (co, ile, co proponujesz).' USING ERRCODE = '22023'; END IF;
    UPDATE public.event_steps SET status = 'problem', status_note = note, updated_at = now() WHERE id = s.id;
    new_status := 'problem';

  ELSIF p_action = 'reopen' THEN
    IF s.status NOT IN ('done','skipped') THEN RAISE EXCEPTION 'Krok jest otwarty.' USING ERRCODE = '22023'; END IF;
    IF s.status = 'done' AND (s.step_key IN ('warehouse_accept','warehouse_ready','dispatch_out','realization_start',
         'realization_complete') OR s.step_key = ANY(private.event_step_auto_keys())) THEN
      RAISE EXCEPTION 'Ten krok wynika z procesu wydarzenia — cofnij go tam, gdzie został potwierdzony.' USING ERRCODE = '22023';
    END IF;
    IF NOT can_override AND NOT (can_act AND s.completed_by = actor) THEN
      RAISE EXCEPTION 'Cofnąć krok może osoba, która go zamknęła, administrator albo osoba z uprawnieniem do zarządzania wydarzeniami.' USING ERRCODE = '42501';
    END IF;
    IF NOT can_override AND EXISTS (SELECT 1 FROM public.event_steps d WHERE d.event_id = s.event_id
               AND s.step_key = ANY(d.depends_on) AND d.status = 'done') THEN
      RAISE EXCEPTION 'Kolejny krok jest już potwierdzony — cofnięcie wymaga administratora.' USING ERRCODE = '42501';
    END IF;
    IF note IS NULL THEN RAISE EXCEPTION 'Podaj powód cofnięcia.' USING ERRCODE = '22023'; END IF;
    UPDATE public.event_steps SET status = 'open', completed_at = NULL, completed_by = NULL, completed_by_name = NULL,
           status_note = note, updated_at = now() WHERE id = s.id;
    new_status := 'open';

  ELSIF p_action = 'skip' THEN
    IF NOT can_override THEN
      RAISE EXCEPTION 'Pominąć krok może administrator albo osoba z uprawnieniem do zarządzania wydarzeniami.' USING ERRCODE = '42501';
    END IF;
    IF note IS NULL OR length(note) < 5 THEN RAISE EXCEPTION 'Podaj powód pominięcia.' USING ERRCODE = '22023'; END IF;
    UPDATE public.event_steps SET status = 'skipped', status_note = note, completed_at = now(), completed_by = actor,
           completed_by_name = actor_name, updated_at = now() WHERE id = s.id;
    new_status := 'skipped';
  END IF;

  INSERT INTO public.event_step_activity(step_id, event_id, action, from_status, to_status, note, performed_by, performed_by_name)
  VALUES (s.id, s.event_id, p_action, s.status, new_status, note, actor, actor_name);

  IF p_action = 'problem' THEN
    PERFORM private.notify_event_step(s.id, 'problem:' || s.id || ':' || floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint,
      'Problem w kroku realizacji', s.title || ' — ' || note, 'warning', true, false);
  END IF;

  PERFORM public.sync_event_steps(s.event_id);
  PERFORM set_config('mavinci.event_step_in_action', '', true);
  RETURN public.get_event_steps(s.event_id);
END $$;

-- Pulpit realizacji: e-mail klienta tylko z obszarem „Dane klienta” (kierownik dostaje imię i telefon).
CREATE OR REPLACE FUNCTION public.get_realization_workspace(p_event_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE result jsonb;
BEGIN
 IF NOT public.is_realization_manager(p_event_id) AND NOT public.can_direct_realization(p_event_id) THEN RETURN NULL; END IF;
 SELECT jsonb_build_object(
 'id',e.id,'name',e.name,'description',e.description,'event_date',e.event_date,'event_end_date',e.event_end_date,
 'status',(SELECT s.status FROM public.get_event_operational_states(ARRAY[e.id]) s),
 'operational_only',public.realization_operational_only(e.id),
 'is_manager',public.is_realization_manager(e.id),
 'realization',(SELECT to_jsonb(r) FROM public.event_realizations r WHERE r.event_id=e.id),
 'location',jsonb_build_object('name',l.name,'address',coalesce(l.formatted_address,l.address),'city',l.city,'notes',l.notes,'technical_details',l.technical_details,'rooms',l.rooms,'selected_rooms',e.location_room_ids,'stage_room_id',e.stage_room_id,'contact_name',l.contact_person_name,'phone',l.contact_phone),
 'contact',jsonb_build_object('name',c.full_name,'phone',coalesce(c.phone,c.business_phone),'email',CASE WHEN public.can_view_event_area(e.id,'client') THEN c.email END),
 'phases',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'description',p.description,'start',p.start_time,'end',p.end_time) ORDER BY p.sequence_order),'[]') FROM public.event_phases p WHERE p.event_id=e.id),
 'agenda',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',i.id,'time',i.time,'title',i.title,'description',i.description) ORDER BY i.order_index),'[]') FROM public.event_agendas a JOIN public.event_agenda_items i ON i.agenda_id=a.id WHERE a.event_id=e.id),
 'agenda_notes',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',n.id,'content',n.content) ORDER BY n.order_index),'[]') FROM public.event_agendas a JOIN public.event_agenda_notes n ON n.agenda_id=a.id WHERE a.event_id=e.id),
 'vehicles',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',v.id,'name',coalesce(f.name,v.external_company_name),'role',v.role,'departure',v.departure_time,'arrival',v.arrival_time,'return',v.return_arrival_time,'origin',v.departure_location,'driver',concat_ws(' ',d.name,d.surname),'notes',v.notes)),'[]') FROM public.event_vehicles v LEFT JOIN public.vehicles f ON f.id=v.vehicle_id LEFT JOIN public.employees d ON d.id=v.driver_id WHERE v.event_id=e.id),
 'subcontractors',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',s.id,'name',s.task_name,'scope',s.scope_of_work,'deliverables',s.deliverables,'guidelines',s.guidelines,'notes',s.operational_notes,'start',s.scheduled_start,'end',s.scheduled_end,'contact_name',coalesce(s.contact_name_snapshot,sub.contact_person,sub.company_name),'phone',coalesce(s.contact_phone_snapshot,sub.phone),'email',coalesce(s.contact_email_snapshot,sub.email))),'[]') FROM public.subcontractor_tasks s LEFT JOIN public.subcontractors sub ON sub.id=s.subcontractor_id WHERE s.event_id=e.id),
 
 'team',(SELECT coalesce(jsonb_agg(jsonb_build_object(
 'id',a.id,'employee_id',employee.id,'name',concat_ws(' ',employee.name,employee.surname),
 'role',a.role,'responsibilities',a.responsibilities,'status',a.status,
 'phone',employee.phone_number,'email',employee.email
 ) ORDER BY employee.surname,employee.name),'[]'::jsonb)
 FROM public.employee_assignments a JOIN public.employees employee ON employee.id=a.employee_id
 WHERE a.event_id=e.id AND employee.is_active AND a.status IN ('accepted','pending')),
 'equipment',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',x.id,'name',coalesce(i.name,k.name,cable.name,'Sprzęt'),'quantity',x.quantity,'notes',x.notes,'loaded',x.is_loaded)),'[]') FROM public.event_equipment x LEFT JOIN public.equipment_items i ON i.id=x.equipment_id LEFT JOIN public.equipment_kits k ON k.id=x.kit_id LEFT JOIN public.cables cable ON cable.id=x.cable_id WHERE x.event_id=e.id AND NOT coalesce(x.is_optional,false) AND NOT coalesce(x.removed_from_offer,false)),
 'files',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',f.id,'name',coalesce(f.name,f.original_name,f.file_name),'path',f.file_path,'url',f.file_url)),'[]') FROM public.event_files f WHERE f.event_id=e.id AND f.folder_id IS NULL AND NOT public.is_sensitive_event_document(f.document_type))
 ) INTO result FROM public.events e LEFT JOIN public.locations l ON l.id=e.location_id LEFT JOIN public.contacts c ON c.id=e.contact_person_id WHERE e.id=p_event_id;
 RETURN result;
END $function$;

-- Historia zmian wydarzenia (zawiera m.in. zmiany budżetu): tylko obszar „oferta, umowa i formalności”.
DROP POLICY IF EXISTS "Authenticated users can view audit logs" ON public.event_audit_log;
DROP POLICY IF EXISTS "Users with events_manage can view audit log" ON public.event_audit_log;
DROP POLICY IF EXISTS event_audit_log_area_read ON public.event_audit_log;
CREATE POLICY event_audit_log_area_read ON public.event_audit_log FOR SELECT TO authenticated
  USING (public.can_view_event_area(event_id, 'commercial_docs'));

-- Wyzwalacze: formalności, zespół, agenda, transport, karta weselna przeliczają kroki.
DROP TRIGGER IF EXISTS event_steps_sync_events ON public.events;
CREATE TRIGGER event_steps_sync_events AFTER INSERT OR UPDATE OF status, event_date, event_end_date, loading_confirmed, created_by,
  location, location_id, contact_person_id, organization_id ON public.events FOR EACH ROW EXECUTE FUNCTION private.event_steps_after_row();
DROP TRIGGER IF EXISTS event_steps_sync_contracts ON public.contracts;
CREATE TRIGGER event_steps_sync_contracts AFTER INSERT OR UPDATE OF status, event_id OR DELETE ON public.contracts
  FOR EACH ROW EXECUTE FUNCTION private.event_steps_after_row();
DROP TRIGGER IF EXISTS event_steps_sync_milestones ON public.event_payment_milestones;
CREATE TRIGGER event_steps_sync_milestones AFTER INSERT OR UPDATE OF status, due_date, milestone_type, event_id OR DELETE
  ON public.event_payment_milestones FOR EACH ROW EXECUTE FUNCTION private.event_steps_after_row();
DROP TRIGGER IF EXISTS event_steps_sync_wedding_cards ON public.wedding_cards;
CREATE TRIGGER event_steps_sync_wedding_cards AFTER INSERT OR UPDATE OF status OR DELETE ON public.wedding_cards
  FOR EACH ROW EXECUTE FUNCTION private.event_steps_after_row();
DROP TRIGGER IF EXISTS event_steps_sync_assignments ON public.employee_assignments;
CREATE TRIGGER event_steps_sync_assignments AFTER INSERT OR UPDATE OF status, event_id OR DELETE ON public.employee_assignments
  FOR EACH ROW EXECUTE FUNCTION private.event_steps_after_row();
DROP TRIGGER IF EXISTS event_steps_sync_agendas ON public.event_agendas;
CREATE TRIGGER event_steps_sync_agendas AFTER INSERT OR DELETE ON public.event_agendas
  FOR EACH ROW EXECUTE FUNCTION private.event_steps_after_row();
DROP TRIGGER IF EXISTS event_steps_sync_arrangements ON public.event_partner_arrangements;
CREATE TRIGGER event_steps_sync_arrangements AFTER INSERT OR UPDATE OF enabled, include_contract OR DELETE ON public.event_partner_arrangements
  FOR EACH ROW EXECUTE FUNCTION private.event_steps_after_row();

-- Przeliczenie bieżących wydarzeń (nowe kroki), bez powiadomień „Nowy krok” dla kroków już aktywnych.
DO $$
DECLARE target uuid;
BEGIN
  FOR target IN
    SELECT e.id FROM public.events e
     WHERE e.status::text IN ('offer_accepted','in_preparation','ready_for_live','in_progress','completed','invoiced')
       AND coalesce(e.event_end_date, e.event_date) >= now() - interval '2 days'
  LOOP
    PERFORM private.safe_sync_event_steps(target);
  END LOOP;
END $$;
UPDATE public.event_steps s SET activation_notified_at = now()
 WHERE s.activation_notified_at IS NULL AND s.status IN ('open','in_progress','problem')
   AND s.created_at > now() - interval '10 minutes'
   AND NOT EXISTS (SELECT 1 FROM public.event_steps d WHERE d.event_id = s.event_id AND d.step_key = ANY(s.depends_on)
                    AND d.status NOT IN ('done','skipped','archived'));
