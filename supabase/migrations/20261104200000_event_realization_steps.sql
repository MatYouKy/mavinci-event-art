-- Kroki realizacji wydarzenia: kto, co i do kiedy — od przekazania sprzedaży do magazynu, przez zamówienia
-- z wyprzedzeniem i sprawdzenia stanu, wydanie i zwrot sprzętu, po rozliczenie.
-- Zasady:
--   * każdy krok ma rolę-właściciela (sprzedawca, magazyn, kierownik realizacji, kierowca, administrator) i termin;
--   * stan kroku zmienia wyłącznie RPC (update_event_step) albo prawda z procesu (przyjęcie przez magazyn, kierownik,
--     załadunek, start/koniec realizacji, faktura, wpłata) — bez edycji wprost z przeglądarki;
--   * każda zmiana trafia do historii (event_step_activity);
--   * pominięcie kroku: administrator albo osoba z events_manage, zawsze z powodem;
--   * synchronizacja kroków nigdy nie blokuje operacji biznesowej (błąd → ostrzeżenie, cron domyka stan co 15 min).
-- Kolejność blokad (bez zakleszczeń): wiersz events → blokada doradcza wydarzenia → wiersze event_steps.

-- 1. Przygotowanie i zamówienia przy usłudze (szablony) -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.offer_product_preparation_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.offer_products(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'order' CHECK (kind IN ('order','stock_check','venue_confirmation','task')),
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 2 AND 200),
  details text CHECK (details IS NULL OR length(details) <= 2000),
  lead_days integer NOT NULL DEFAULT 0 CHECK (lead_days BETWEEN 0 AND 90),
  anchor text NOT NULL DEFAULT 'event' CHECK (anchor IN ('event','loading')),
  owner_role text NOT NULL DEFAULT 'warehouse' CHECK (owner_role IN ('warehouse','sales','manager')),
  supplier text CHECK (supplier IS NULL OR length(supplier) <= 300),
  quantity_per_unit numeric(12,2) CHECK (quantity_per_unit IS NULL OR quantity_per_unit > 0),
  unit text CHECK (unit IS NULL OR length(unit) <= 30),
  blocks_ready boolean NOT NULL DEFAULT true,
  order_index integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_offer_product_preparation_items_product
  ON public.offer_product_preparation_items(product_id) WHERE is_active;
ALTER TABLE public.offer_product_preparation_items ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.can_manage_product_preparation()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT EXISTS (SELECT 1 FROM public.employees e WHERE e.id = public.sales_employee_id() AND e.is_active
    AND NOT public.current_session_is_seller_portal()
    AND (e.role = 'admin' OR e.access_level = 'admin'
      OR 'offers_manage' = ANY(coalesce(e.permissions,'{}')) OR 'equipment_manage' = ANY(coalesce(e.permissions,'{}'))));
$$;
GRANT EXECUTE ON FUNCTION public.can_manage_product_preparation() TO authenticated;

DROP POLICY IF EXISTS offer_product_preparation_items_select ON public.offer_product_preparation_items;
CREATE POLICY offer_product_preparation_items_select ON public.offer_product_preparation_items
  FOR SELECT TO authenticated
  USING (public.sales_employee_id() IS NOT NULL AND NOT public.current_session_is_seller_portal());
DROP POLICY IF EXISTS offer_product_preparation_items_manage ON public.offer_product_preparation_items;
CREATE POLICY offer_product_preparation_items_manage ON public.offer_product_preparation_items
  FOR ALL TO authenticated
  USING (public.can_manage_product_preparation())
  WITH CHECK (public.can_manage_product_preparation());
REVOKE ALL ON public.offer_product_preparation_items FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.offer_product_preparation_items TO authenticated;

CREATE OR REPLACE FUNCTION private.touch_offer_product_preparation_item()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  NEW.updated_at := now();
  IF TG_OP = 'INSERT' THEN NEW.created_by := coalesce(NEW.created_by, public.sales_employee_id()); END IF;
  NEW.title := btrim(NEW.title);
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS touch_offer_product_preparation_item ON public.offer_product_preparation_items;
CREATE TRIGGER touch_offer_product_preparation_item BEFORE INSERT OR UPDATE ON public.offer_product_preparation_items
  FOR EACH ROW EXECUTE FUNCTION private.touch_offer_product_preparation_item();

-- 2. Sprzęt wymagający sprawdzenia stanu przed każdym wydaniem ------------------------------------------------------
ALTER TABLE public.equipment_items
  ADD COLUMN IF NOT EXISTS requires_pre_check boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pre_check_instructions text;

-- 3. Kroki wydarzenia i historia -----------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.event_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  step_key text NOT NULL,
  stage text NOT NULL CHECK (stage IN ('handoff','preparation','dispatch','realization','return','settlement')),
  kind text NOT NULL CHECK (kind IN ('handoff','order','stock_check','venue_confirmation','task','approval')),
  source text NOT NULL CHECK (source IN ('system','product','equipment','shortage','rental','manual')),
  source_id uuid,
  title text NOT NULL,
  details text,
  quantity numeric(12,2),
  unit text,
  supplier text,
  owner_role text NOT NULL CHECK (owner_role IN ('sales','warehouse','manager','driver','admin','author')),
  assignee_id uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  assigned_manually boolean NOT NULL DEFAULT false,
  due_at timestamptz,
  blocks_ready boolean NOT NULL DEFAULT false,
  depends_on text[] NOT NULL DEFAULT '{}',
  sort_order integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','done','problem','skipped','archived')),
  status_note text,
  ordered_at timestamptz,
  expected_at timestamptz,
  completed_at timestamptz,
  completed_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  completed_by_name text,
  activation_notified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, step_key)
);
CREATE INDEX IF NOT EXISTS idx_event_steps_event ON public.event_steps(event_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_event_steps_open ON public.event_steps(due_at)
  WHERE status IN ('open','in_progress','problem');
CREATE INDEX IF NOT EXISTS idx_event_steps_assignee ON public.event_steps(assignee_id)
  WHERE status IN ('open','in_progress','problem');

CREATE TABLE IF NOT EXISTS public.event_step_activity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  step_id uuid NOT NULL REFERENCES public.event_steps(id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  action text NOT NULL,
  from_status text,
  to_status text,
  note text,
  performed_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  performed_by_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_event_step_activity_step ON public.event_step_activity(step_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_event_step_activity_event ON public.event_step_activity(event_id, created_at DESC);

ALTER TABLE public.event_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_step_activity ENABLE ROW LEVEL SECURITY;

-- Kto widzi kroki wydarzenia: kto widzi wydarzenie, kierownik realizacji, magazyn przygotowujący, kierowca.
CREATE OR REPLACE FUNCTION public.can_view_event_steps(p_event uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT public.sales_employee_id() IS NOT NULL AND NOT public.current_session_is_seller_portal() AND (
    public.current_employee_can_view_event(p_event)
    OR public.is_realization_manager(p_event)
    OR public.can_prepare_warehouse_event(p_event)
    OR EXISTS (SELECT 1 FROM public.event_vehicles v WHERE v.event_id = p_event
      AND v.driver_id = public.sales_employee_id() AND coalesce(v.status,'planned') <> 'cancelled'));
$$;

DROP POLICY IF EXISTS event_steps_select ON public.event_steps;
CREATE POLICY event_steps_select ON public.event_steps FOR SELECT TO authenticated
  USING (public.can_view_event_steps(event_id));
DROP POLICY IF EXISTS event_step_activity_select ON public.event_step_activity;
CREATE POLICY event_step_activity_select ON public.event_step_activity FOR SELECT TO authenticated
  USING (public.can_view_event_steps(event_id));
-- Brak polityk INSERT/UPDATE/DELETE: kroki zmieniają wyłącznie funkcje poniżej.
REVOKE ALL ON public.event_steps, public.event_step_activity FROM anon, authenticated;
GRANT SELECT ON public.event_steps, public.event_step_activity TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_view_event_steps(uuid) TO authenticated;

-- Odświeżanie paneli na żywo (Realtime filtruje wiersze przez RLS powyżej).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime'
                     AND schemaname = 'public' AND tablename = 'event_steps') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.event_steps;
  END IF;
END $$;

-- Jednorazowe powiadomienia kroków (aktywny, termin, po terminie, eskalacja, problem).
CREATE UNIQUE INDEX IF NOT EXISTS event_step_notification_once
  ON public.notifications ((metadata->>'event_step_key')) WHERE metadata ? 'event_step_key';

-- 4. Kto jest właścicielem roli na wydarzeniu ----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.event_step_assignee(p_event uuid, p_role text)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT CASE p_role
    WHEN 'warehouse' THEN (SELECT h.accepted_by FROM public.event_warehouse_handoffs h
      JOIN public.employees e ON e.id = h.accepted_by AND e.is_active WHERE h.event_id = p_event)
    WHEN 'manager' THEN (SELECT r.manager_id FROM public.event_realizations r
      JOIN public.employees e ON e.id = r.manager_id AND e.is_active WHERE r.event_id = p_event)
    WHEN 'driver' THEN (SELECT v.driver_id FROM public.event_vehicles v
      JOIN public.employees e ON e.id = v.driver_id AND e.is_active
      WHERE v.event_id = p_event AND coalesce(v.status,'planned') <> 'cancelled'
      ORDER BY v.departure_time NULLS LAST, v.created_at LIMIT 1)
    WHEN 'sales' THEN coalesce(
      (SELECT o.created_by FROM public.offers o JOIN public.employees e ON e.id = o.created_by AND e.is_active
        WHERE o.event_id = p_event AND o.status::text = 'accepted' ORDER BY o.updated_at DESC LIMIT 1),
      (SELECT e.id FROM public.events ev JOIN public.employees e ON ev.created_by IN (e.id, e.auth_user_id) AND e.is_active
        WHERE ev.id = p_event LIMIT 1))
    WHEN 'author' THEN (SELECT e.id FROM public.events ev JOIN public.employees e ON ev.created_by IN (e.id, e.auth_user_id) AND e.is_active
        WHERE ev.id = p_event LIMIT 1)
    ELSE NULL
  END;
$$;
REVOKE ALL ON FUNCTION public.event_step_assignee(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.event_step_assignee(uuid, text) TO authenticated;

-- Czy bieżący pracownik może wykonać krok danej roli.
CREATE OR REPLACE FUNCTION private.event_step_can_act(p_event uuid, p_role text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE actor uuid := public.sales_employee_id(); emp record; ev record;
BEGIN
  IF actor IS NULL OR public.current_session_is_seller_portal() THEN RETURN false; END IF;
  SELECT e.id, e.role, e.access_level, e.is_active, e.auth_user_id, coalesce(e.permissions,'{}') AS permissions
    INTO emp FROM public.employees e WHERE e.id = actor;
  SELECT v.id, v.created_by, v.my_company_id INTO ev FROM public.events v WHERE v.id = p_event;
  IF emp.id IS NULL OR NOT emp.is_active OR ev.id IS NULL OR NOT public.employee_can_access_company(actor, ev.my_company_id) THEN
    RETURN false;
  END IF;
  IF emp.role = 'admin' OR emp.access_level = 'admin' THEN RETURN true; END IF;
  RETURN CASE p_role
    WHEN 'warehouse' THEN public.employee_can_prepare_event(actor, p_event)
    WHEN 'sales' THEN actor = public.event_step_assignee(p_event, 'sales')
      OR ev.created_by IN (emp.id, emp.auth_user_id) OR 'events_manage' = ANY(emp.permissions)
    WHEN 'author' THEN ev.created_by IN (emp.id, emp.auth_user_id) OR 'events_manage' = ANY(emp.permissions)
    WHEN 'manager' THEN public.is_realization_manager(p_event)
      OR (public.event_step_assignee(p_event, 'manager') IS NULL AND public.can_direct_realization(p_event))
    WHEN 'driver' THEN public.is_realization_manager(p_event) OR EXISTS (SELECT 1 FROM public.event_vehicles v
      WHERE v.event_id = p_event AND v.driver_id = actor AND coalesce(v.status,'planned') <> 'cancelled')
    WHEN 'admin' THEN public.can_manage_invoices()
    ELSE false
  END;
END $$;

-- Pominięcie kroku: administrator albo events_manage (sprzedawca nie pomija kroków magazynu i odwrotnie).
CREATE OR REPLACE FUNCTION private.event_step_can_override(p_event uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT EXISTS (SELECT 1 FROM public.employees e JOIN public.events v ON v.id = p_event
    WHERE e.id = public.sales_employee_id() AND e.is_active AND NOT public.current_session_is_seller_portal()
      AND public.employee_can_access_company(e.id, v.my_company_id)
      AND (e.role = 'admin' OR e.access_level = 'admin' OR 'events_manage' = ANY(coalesce(e.permissions,'{}'))));
$$;

-- Czy krok jest w kolejce bieżącego pracownika („Moje kroki”): przypisany do niego albo nieprzypisany w jego puli.
CREATE OR REPLACE FUNCTION private.event_step_in_my_queue(p_step public.event_steps)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE actor uuid := public.sales_employee_id();
BEGIN
  IF actor IS NULL THEN RETURN false; END IF;
  IF p_step.assignee_id IS NOT NULL THEN
    RETURN p_step.assignee_id = actor AND private.event_step_can_act(p_step.event_id, p_step.owner_role);
  END IF;
  RETURN CASE p_step.owner_role
    WHEN 'warehouse' THEN public.employee_can_prepare_event(actor, p_step.event_id)
    WHEN 'admin' THEN public.can_manage_invoices()
    WHEN 'manager' THEN public.can_direct_realization(p_step.event_id)
    WHEN 'driver' THEN public.is_realization_manager(p_step.event_id)
    ELSE EXISTS (SELECT 1 FROM public.events v JOIN public.employees e ON e.id = actor
                  WHERE v.id = p_step.event_id AND v.created_by IN (e.id, e.auth_user_id))
  END;
END $$;

-- 5. Plan kroków wydarzenia (czysto obliczeniowy) ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.event_step_plan(p_event uuid)
RETURNS TABLE(step_key text, stage text, kind text, source text, source_id uuid, title text, details text,
  quantity numeric, unit text, supplier text, owner_role text, due_at timestamptz, blocks_ready boolean,
  sort_order integer, depends_on text[])
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  ev record;
  t_accept timestamptz; t_start timestamptz; t_end timestamptz; t_loading timestamptz; t_paid timestamptz;
  has_equipment boolean; has_driver boolean; requirements text; manual_blocking text[];
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

-- 6. Synchronizacja kroków z planem i z prawdą procesu -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_event_steps(p_event uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE ev record; planned text[]; h record; r record; invoiced boolean; paid boolean; picked_up boolean;
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

  WITH truth(step_key, met, at, who, who_name, two_way) AS (VALUES
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

-- Wywołanie z wyzwalaczy i crona: błąd synchronizacji nie może zablokować operacji (cron domknie stan).
CREATE OR REPLACE FUNCTION private.safe_sync_event_steps(p_event uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  PERFORM public.sync_event_steps(p_event);
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'sync_event_steps(%) failed: % (%)', p_event, SQLERRM, SQLSTATE;
END $$;

REVOKE ALL ON FUNCTION public.sync_event_steps(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.safe_sync_event_steps(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.event_step_plan(uuid) FROM PUBLIC, anon, authenticated;

-- 7. Wyzwalacze ----------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.event_steps_after_row()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE n jsonb; o jsonb; target uuid; previous uuid;
BEGIN
  BEGIN
    n := CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END;
    o := CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END;
    IF TG_TABLE_NAME = 'events' THEN
      target := coalesce(n->>'id', o->>'id')::uuid;
    ELSE
      target := (n->>'event_id')::uuid;
      previous := (o->>'event_id')::uuid;
    END IF;
    IF TG_TABLE_NAME = 'offers' AND coalesce(n->>'status','') <> 'accepted' AND coalesce(o->>'status','') <> 'accepted' THEN
      RETURN NULL;
    END IF;
    IF target IS NOT NULL THEN PERFORM private.safe_sync_event_steps(target); END IF;
    IF previous IS NOT NULL AND previous IS DISTINCT FROM target THEN PERFORM private.safe_sync_event_steps(previous); END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'event_steps trigger on % failed: % (%)', TG_TABLE_NAME, SQLERRM, SQLSTATE;
  END;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS event_steps_sync_events ON public.events;
CREATE TRIGGER event_steps_sync_events AFTER INSERT OR UPDATE OF status, event_date, event_end_date, loading_confirmed, created_by
  ON public.events FOR EACH ROW EXECUTE FUNCTION private.event_steps_after_row();
DROP TRIGGER IF EXISTS event_steps_sync_handoffs ON public.event_warehouse_handoffs;
CREATE TRIGGER event_steps_sync_handoffs AFTER INSERT OR UPDATE ON public.event_warehouse_handoffs
  FOR EACH ROW EXECUTE FUNCTION private.event_steps_after_row();
DROP TRIGGER IF EXISTS event_steps_sync_realizations ON public.event_realizations;
CREATE TRIGGER event_steps_sync_realizations AFTER INSERT OR UPDATE OR DELETE ON public.event_realizations
  FOR EACH ROW EXECUTE FUNCTION private.event_steps_after_row();
DROP TRIGGER IF EXISTS event_steps_sync_offers ON public.offers;
CREATE TRIGGER event_steps_sync_offers AFTER UPDATE OF status, event_id ON public.offers
  FOR EACH ROW EXECUTE FUNCTION private.event_steps_after_row();
DROP TRIGGER IF EXISTS event_steps_sync_vehicles ON public.event_vehicles;
CREATE TRIGGER event_steps_sync_vehicles AFTER INSERT OR UPDATE OF driver_id, status, pickup_timestamp, departure_time OR DELETE ON public.event_vehicles
  FOR EACH ROW EXECUTE FUNCTION private.event_steps_after_row();
DROP TRIGGER IF EXISTS event_steps_sync_phases ON public.event_phases;
CREATE TRIGGER event_steps_sync_phases AFTER INSERT OR UPDATE OF start_time, phase_type_id, name OR DELETE ON public.event_phases
  FOR EACH ROW EXECUTE FUNCTION private.event_steps_after_row();
DROP TRIGGER IF EXISTS event_steps_sync_invoices ON public.invoices;
CREATE TRIGGER event_steps_sync_invoices AFTER INSERT OR UPDATE OF status, payment_status, event_id, payment_due_date, invoice_type ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION private.event_steps_after_row();

-- Sprzęt i pozycje oferty zmieniają się seriami (rezerwacja wstawia wiele wierszy) — jedna synchronizacja na wydarzenie.
-- Każda gałąź czyta tylko tabele przejściowe, które istnieją dla danej operacji.
CREATE OR REPLACE FUNCTION private.event_steps_after_statement()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE targets uuid[] := '{}'; keys uuid[] := '{}'; target uuid;
BEGIN
  BEGIN
    IF TG_TABLE_NAME = 'equipment_items' THEN
      SELECT array_agg(n.id) INTO keys FROM new_rows n JOIN old_rows d ON d.id = n.id
       WHERE n.requires_pre_check IS DISTINCT FROM d.requires_pre_check
          OR n.pre_check_instructions IS DISTINCT FROM d.pre_check_instructions
          OR (n.requires_pre_check AND n.name IS DISTINCT FROM d.name);
      IF keys IS NOT NULL THEN
        SELECT array_agg(DISTINCT x.event_id) INTO targets FROM public.event_equipment x JOIN public.events e ON e.id = x.event_id
         WHERE x.equipment_id = ANY(keys) AND coalesce(e.event_end_date, e.event_date) >= now() - interval '2 days';
      END IF;
    ELSE
      IF TG_OP = 'INSERT' THEN
        SELECT array_agg(DISTINCT j.v) INTO keys FROM (SELECT (to_jsonb(n)->>TG_ARGV[0])::uuid v FROM new_rows n) j;
      ELSIF TG_OP = 'DELETE' THEN
        SELECT array_agg(DISTINCT j.v) INTO keys FROM (SELECT (to_jsonb(d)->>TG_ARGV[0])::uuid v FROM old_rows d) j;
      ELSE
        SELECT array_agg(DISTINCT j.v) INTO keys FROM (
          SELECT (to_jsonb(n)->>TG_ARGV[0])::uuid v FROM new_rows n
          UNION SELECT (to_jsonb(d)->>TG_ARGV[0])::uuid FROM old_rows d) j;
      END IF;
      keys := array_remove(coalesce(keys, '{}'), NULL);
      IF TG_TABLE_NAME = 'event_equipment' THEN
        targets := keys;
      ELSIF TG_TABLE_NAME = 'offer_items' THEN
        SELECT array_agg(DISTINCT o.event_id) INTO targets FROM public.offers o
         WHERE o.id = ANY(keys) AND o.status::text = 'accepted' AND o.event_id IS NOT NULL;
      ELSIF TG_TABLE_NAME = 'offer_product_preparation_items' THEN
        SELECT array_agg(DISTINCT o.event_id) INTO targets FROM public.offers o
          JOIN public.offer_items oi ON oi.offer_id = o.id JOIN public.events e ON e.id = o.event_id
         WHERE o.status::text = 'accepted' AND oi.product_id = ANY(keys)
           AND coalesce(e.event_end_date, e.event_date) >= now() - interval '2 days';
      END IF;
    END IF;
    FOREACH target IN ARRAY coalesce(targets, '{}') LOOP
      IF target IS NOT NULL THEN PERFORM private.safe_sync_event_steps(target); END IF;
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'event_steps statement trigger on % failed: % (%)', TG_TABLE_NAME, SQLERRM, SQLSTATE;
  END;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS event_steps_sync_equipment_ins ON public.event_equipment;
CREATE TRIGGER event_steps_sync_equipment_ins AFTER INSERT ON public.event_equipment
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION private.event_steps_after_statement('event_id');
DROP TRIGGER IF EXISTS event_steps_sync_equipment_upd ON public.event_equipment;
CREATE TRIGGER event_steps_sync_equipment_upd AFTER UPDATE ON public.event_equipment
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION private.event_steps_after_statement('event_id');
DROP TRIGGER IF EXISTS event_steps_sync_equipment_del ON public.event_equipment;
CREATE TRIGGER event_steps_sync_equipment_del AFTER DELETE ON public.event_equipment
  REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION private.event_steps_after_statement('event_id');
DROP TRIGGER IF EXISTS event_steps_sync_offer_items_ins ON public.offer_items;
CREATE TRIGGER event_steps_sync_offer_items_ins AFTER INSERT ON public.offer_items
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION private.event_steps_after_statement('offer_id');
DROP TRIGGER IF EXISTS event_steps_sync_offer_items_upd ON public.offer_items;
CREATE TRIGGER event_steps_sync_offer_items_upd AFTER UPDATE ON public.offer_items
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION private.event_steps_after_statement('offer_id');
DROP TRIGGER IF EXISTS event_steps_sync_offer_items_del ON public.offer_items;
CREATE TRIGGER event_steps_sync_offer_items_del AFTER DELETE ON public.offer_items
  REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION private.event_steps_after_statement('offer_id');
DROP TRIGGER IF EXISTS event_steps_sync_prep_ins ON public.offer_product_preparation_items;
CREATE TRIGGER event_steps_sync_prep_ins AFTER INSERT ON public.offer_product_preparation_items
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION private.event_steps_after_statement('product_id');
DROP TRIGGER IF EXISTS event_steps_sync_prep_upd ON public.offer_product_preparation_items;
CREATE TRIGGER event_steps_sync_prep_upd AFTER UPDATE ON public.offer_product_preparation_items
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION private.event_steps_after_statement('product_id');
DROP TRIGGER IF EXISTS event_steps_sync_prep_del ON public.offer_product_preparation_items;
CREATE TRIGGER event_steps_sync_prep_del AFTER DELETE ON public.offer_product_preparation_items
  REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION private.event_steps_after_statement('product_id');
DROP TRIGGER IF EXISTS event_steps_sync_equipment_items ON public.equipment_items;
CREATE TRIGGER event_steps_sync_equipment_items AFTER UPDATE ON public.equipment_items
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION private.event_steps_after_statement('id');

-- 8. Odczyt: kroki wydarzenia i „Moje kroki” ---------------------------------------------------------------------
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
    'system_managed', s.step_key IN ('manager_appointed','settlement_invoice','settlement_paid'),
    'history', coalesce((SELECT jsonb_agg(jsonb_build_object('action', a.action, 'to_status', a.to_status, 'note', a.note,
                   'by', a.performed_by_name, 'at', a.created_at) ORDER BY a.created_at DESC)
                   FROM (SELECT x.* FROM public.event_step_activity x WHERE x.step_id = s.id ORDER BY x.created_at DESC LIMIT 5) a), '[]'::jsonb)
  );
$$;

CREATE OR REPLACE FUNCTION public.get_event_steps(p_event_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE override boolean; roles jsonb; steps jsonb;
BEGIN
  IF NOT public.can_view_event_steps(p_event_id) THEN
    RAISE EXCEPTION 'Brak dostępu do kroków tego wydarzenia.' USING ERRCODE = '42501';
  END IF;
  override := private.event_step_can_override(p_event_id);
  SELECT jsonb_object_agg(role, private.event_step_can_act(p_event_id, role)) INTO roles
    FROM unnest(ARRAY['sales','warehouse','manager','driver','admin','author']) role;
  SELECT coalesce(jsonb_agg(private.event_step_json(s, coalesce((roles->>s.owner_role)::boolean, false), override)
                  ORDER BY s.sort_order, s.created_at), '[]'::jsonb)
    INTO steps FROM public.event_steps s WHERE s.event_id = p_event_id AND s.status <> 'archived';
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
         FROM public.event_steps s WHERE s.event_id = p_event_id AND s.status <> 'archived' GROUP BY s.stage) x), '{}'::jsonb)
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
         ORDER BY s.due_at NULLS LAST
         LIMIT 300
      ) x JOIN public.events ev ON ev.id = x.event_id), '[]'::jsonb);
END $$;

GRANT EXECUTE ON FUNCTION public.get_event_steps(uuid), public.get_my_event_steps() TO authenticated;
REVOKE ALL ON FUNCTION public.get_event_steps(uuid), public.get_my_event_steps() FROM anon;

-- 9. Powiadomienia kroków -------------------------------------------------------------------------------------------
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
     OR (p_include_leads AND (e.id = public.event_step_assignee(ev.id, 'manager') OR ev.created_by IN (e.id, e.auth_user_id)))
     OR (p_include_admins AND (e.role = 'admin' OR e.access_level = 'admin')))
  ON CONFLICT DO NOTHING;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION private.notify_event_step(uuid, text, text, text, text, boolean, boolean) FROM PUBLIC, anon, authenticated;

-- 10. Zmiana stanu kroku ------------------------------------------------------------------------------------------
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
    IF s.status = 'done' AND s.step_key IN ('warehouse_accept','warehouse_ready','manager_appointed','dispatch_out',
         'realization_start','realization_complete','settlement_invoice','settlement_paid') THEN
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
GRANT EXECUTE ON FUNCTION public.update_event_step(uuid, text, text, jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.update_event_step(uuid, text, text, jsonb) FROM anon;

-- Ręcznie dodany krok (np. „Sprawdź stan maszyny”, dodatkowe zamówienie, potwierdzenie z obiektem).
CREATE OR REPLACE FUNCTION public.add_event_step(p_event_id uuid, p_title text, p_kind text, p_owner_role text,
  p_due_at timestamptz, p_details text DEFAULT NULL, p_blocks_ready boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE actor uuid := public.sales_employee_id(); actor_name text; new_id uuid; ev record;
BEGIN
  IF actor IS NULL OR NOT public.can_view_event_steps(p_event_id) THEN
    RAISE EXCEPTION 'Brak dostępu do kroków tego wydarzenia.' USING ERRCODE = '42501';
  END IF;
  IF NOT (private.event_step_can_override(p_event_id) OR public.is_realization_manager(p_event_id)
          OR public.can_prepare_warehouse_event(p_event_id) OR public.can_direct_realization(p_event_id)
          OR private.event_step_can_act(p_event_id, 'sales')) THEN
    RAISE EXCEPTION 'Kroki dodaje magazyn, kierownik realizacji, sprzedawca albo prowadzący wydarzenie.' USING ERRCODE = '42501';
  END IF;
  SELECT e.id, e.status::text AS status INTO ev FROM public.events e WHERE e.id = p_event_id FOR UPDATE;
  IF ev.status NOT IN ('offer_accepted','in_preparation','ready_for_live','in_progress','completed','invoiced') THEN
    RAISE EXCEPTION 'Kroki dodaje się do wydarzeń od zaakceptowanej oferty do rozliczenia.' USING ERRCODE = '22023';
  END IF;
  IF p_title IS NULL OR length(btrim(p_title)) < 3 OR length(p_title) > 200 THEN
    RAISE EXCEPTION 'Podaj nazwę kroku (3–200 znaków).' USING ERRCODE = '22023';
  END IF;
  IF p_details IS NOT NULL AND length(p_details) > 2000 THEN
    RAISE EXCEPTION 'Opis może mieć najwyżej 2000 znaków.' USING ERRCODE = '22023';
  END IF;
  IF p_kind IS NULL OR p_kind NOT IN ('order','stock_check','venue_confirmation','task')
     OR p_owner_role IS NULL OR p_owner_role NOT IN ('sales','warehouse','manager','driver','admin') THEN
    RAISE EXCEPTION 'Nieprawidłowy rodzaj kroku albo rola.' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('event_steps:' || p_event_id::text));
  SELECT coalesce(nullif(concat_ws(' ', e.name, e.surname), ''), e.nickname) INTO actor_name FROM public.employees e WHERE e.id = actor;
  INSERT INTO public.event_steps(event_id, step_key, stage, kind, source, title, details, owner_role, assignee_id, due_at,
                                 blocks_ready, sort_order, depends_on)
  VALUES (p_event_id, 'manual:' || gen_random_uuid(),
          CASE WHEN p_owner_role = 'admin' THEN 'settlement' WHEN p_owner_role = 'driver' THEN 'dispatch' ELSE 'preparation' END,
          p_kind, 'manual', btrim(p_title), nullif(btrim(p_details), ''),
          p_owner_role, public.event_step_assignee(p_event_id, p_owner_role), p_due_at,
          coalesce(p_blocks_ready, false) AND p_owner_role IN ('warehouse','sales','manager'), 250,
          CASE WHEN p_owner_role = 'warehouse' AND EXISTS (SELECT 1 FROM public.event_steps w WHERE w.event_id = p_event_id
                 AND w.step_key = 'warehouse_accept' AND w.status <> 'archived') THEN ARRAY['warehouse_accept'] ELSE '{}'::text[] END)
  RETURNING id INTO new_id;
  INSERT INTO public.event_step_activity(step_id, event_id, action, to_status, note, performed_by, performed_by_name)
  VALUES (new_id, p_event_id, 'add', 'open', nullif(btrim(p_details), ''), actor, actor_name);
  PERFORM public.sync_event_steps(p_event_id);
  RETURN public.get_event_steps(p_event_id);
END $$;
GRANT EXECUTE ON FUNCTION public.add_event_step(uuid, text, text, text, timestamptz, text, boolean) TO authenticated;
REVOKE ALL ON FUNCTION public.add_event_step(uuid, text, text, text, timestamptz, text, boolean) FROM anon;

-- 11. „Gotowe” w magazynie tylko po zamknięciu przygotowania ----------------------------------------------------
CREATE OR REPLACE FUNCTION public.advance_warehouse_event(p_event_id uuid, p_action text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $function$
DECLARE actor uuid:=public.sales_employee_id(); actor_name text; h public.event_warehouse_handoffs%ROWTYPE; stage text; missing text;
BEGIN
 IF actor IS NULL OR NOT public.can_prepare_warehouse_event(p_event_id) THEN
 RAISE EXCEPTION 'Nie masz uprawnień do przygotowania tej realizacji.' USING ERRCODE='42501'; END IF;
 IF p_action <> 'ready' OR p_action IS NULL THEN
 RAISE EXCEPTION 'Nieprawidłowa czynność magazynu.' USING ERRCODE='22023'; END IF;
 PERFORM 1 FROM public.events WHERE id=p_event_id FOR UPDATE;
 INSERT INTO public.event_warehouse_handoffs(event_id) VALUES(p_event_id) ON CONFLICT DO NOTHING;
 SELECT * INTO h FROM public.event_warehouse_handoffs WHERE event_id=p_event_id FOR UPDATE;
 IF h.ready_at IS NOT NULL THEN RETURN to_jsonb(h); END IF;
 SELECT s.status INTO stage FROM public.get_event_operational_states(ARRAY[p_event_id]) s;
 SELECT coalesce(nullif(concat_ws(' ',name,surname),''),nickname,'Pracownik magazynu') INTO actor_name FROM public.employees WHERE id=actor;
 IF p_action='ready' THEN
   IF stage<>'in_preparation' THEN RAISE EXCEPTION 'Najpierw przyjmij realizację do przygotowania.' USING ERRCODE='22023'; END IF;
   IF NOT EXISTS(SELECT 1 FROM public.event_realizations r JOIN public.employees employee ON employee.id=r.manager_id AND employee.is_active WHERE r.event_id=p_event_id) THEN RAISE EXCEPTION 'Autor musi wyznaczyć kierownika realizacji w zakładce Zespół.' USING ERRCODE='22023'; END IF;
   -- Kroki przygotowania (zamówienia z wyprzedzeniem, sprawdzenia stanu, braki, wynajmy, ręczne kroki z blokadą).
   PERFORM private.safe_sync_event_steps(p_event_id);
   SELECT string_agg(s.title, '; ' ORDER BY s.sort_order) INTO missing FROM public.event_steps s
    WHERE s.event_id = p_event_id AND s.blocks_ready AND s.status NOT IN ('done','skipped','archived');
   IF missing IS NOT NULL THEN
     RAISE EXCEPTION 'Przed oznaczeniem gotowości zamknij kroki przygotowania: %', missing USING ERRCODE='22023';
   END IF;
   UPDATE public.event_warehouse_handoffs SET ready_at=clock_timestamp(),ready_by=actor,ready_by_name=actor_name WHERE event_id=p_event_id RETURNING * INTO h;
 END IF;
 RETURN to_jsonb(h);
END $function$;

-- 12. Przypomnienia, terminy i eskalacja (co 15 minut) ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.run_event_steps_maintenance()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE target uuid; synced int := 0; sent int := 0; s record; local_hour int; due_label text;
BEGIN
  -- Siatka bezpieczeństwa: resynchronizacja bieżących wydarzeń i tych, które mają otwarte kroki.
  FOR target IN
    SELECT e.id FROM public.events e
     WHERE (e.status::text IN ('offer_accepted','in_preparation','ready_for_live','in_progress','completed','invoiced')
            AND coalesce(e.event_end_date, e.event_date) >= now() - interval '2 days'
            AND e.event_date <= now() + interval '365 days')
        OR EXISTS (SELECT 1 FROM public.event_steps st WHERE st.event_id = e.id AND st.status IN ('open','in_progress','problem'))
     ORDER BY e.event_date LIMIT 300
  LOOP
    PERFORM private.safe_sync_event_steps(target);
    synced := synced + 1;
  END LOOP;

  local_hour := extract(hour FROM now() AT TIME ZONE 'Europe/Warsaw');
  IF local_hour < 7 OR local_hour >= 20 THEN
    RETURN jsonb_build_object('synced', synced, 'notified', 0, 'quiet_hours', true);
  END IF;

  FOR s IN
    SELECT st.id, st.title, st.due_at, st.activation_notified_at, st.step_key, st.created_at
      FROM public.event_steps st JOIN public.events e ON e.id = st.event_id AND e.status::text NOT IN ('cancelled','settled')
     WHERE st.status IN ('open','in_progress','problem')
       AND NOT EXISTS (SELECT 1 FROM public.event_steps d WHERE d.event_id = st.event_id AND d.step_key = ANY(st.depends_on)
                        AND d.status NOT IN ('done','skipped','archived'))
       AND (st.due_at IS NULL OR st.due_at > now() - interval '14 days')
       AND (st.due_at IS NULL OR st.due_at < now() + interval '7 days')
     ORDER BY st.due_at NULLS LAST LIMIT 1000
  LOOP
    due_label := CASE WHEN s.due_at IS NOT NULL THEN to_char(s.due_at AT TIME ZONE 'Europe/Warsaw', 'DD.MM.YYYY HH24:MI') END;
    -- Jedno powiadomienie na poziom (aktywny → termin w ciągu doby → po terminie → eskalacja); wysyłamy tylko najwyższy
    -- osiągnięty poziom. Eskalacja do administratorów tylko dla kroków, które powstały przed swoim terminem.
    IF s.due_at IS NOT NULL AND s.due_at < now() - interval '2 days' AND s.created_at < s.due_at THEN
      IF private.notify_event_step(s.id, 'escalated:' || s.id || ':' || to_char(s.due_at, 'YYYYMMDDHH24MI'), 'Eskalacja: krok 2 dni po terminie',
           s.title || ' — termin minął ' || due_label, 'error', true, true) THEN sent := sent + 1; END IF;
    ELSIF s.due_at IS NOT NULL AND s.due_at < now() THEN
      IF private.notify_event_step(s.id, 'overdue:' || s.id || ':' || to_char(s.due_at, 'YYYYMMDDHH24MI'), 'Krok po terminie',
           s.title || ' — termin minął ' || due_label, 'warning', true, false) THEN sent := sent + 1; END IF;
    ELSIF s.due_at IS NOT NULL AND s.due_at < now() + interval '24 hours' THEN
      IF private.notify_event_step(s.id, 'due:' || s.id || ':' || to_char(s.due_at, 'YYYYMMDDHH24MI'), 'Termin kroku mija w ciągu doby',
           s.title || ' — termin ' || due_label) THEN sent := sent + 1; END IF;
    ELSIF s.activation_notified_at IS NULL THEN
      IF private.notify_event_step(s.id, 'active:' || s.id, 'Nowy krok do wykonania',
           s.title || coalesce(' (termin: ' || due_label || ')', '')) THEN sent := sent + 1; END IF;
    END IF;
    IF s.activation_notified_at IS NULL THEN
      UPDATE public.event_steps SET activation_notified_at = now() WHERE id = s.id;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('synced', synced, 'notified', sent);
END $$;
REVOKE ALL ON FUNCTION public.run_event_steps_maintenance() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(j.jobid) FROM cron.job j WHERE j.jobname = 'event-steps-maintenance';
    PERFORM cron.schedule('event-steps-maintenance', '*/15 * * * *', 'SELECT public.run_event_steps_maintenance();');
  END IF;
END $$;

-- 13. Start: kroki dla bieżących wydarzeń, porządek w przypomnieniach starego procesu -------------------------------
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

-- Kroki, które już są aktywne w chwili wdrożenia, nie wysyłają „Nowy krok” (zostają przypomnienia o terminach).
UPDATE public.event_steps s SET activation_notified_at = now()
 WHERE s.activation_notified_at IS NULL AND s.status IN ('open','in_progress','problem')
   AND NOT EXISTS (SELECT 1 FROM public.event_steps d WHERE d.event_id = s.event_id AND d.step_key = ANY(s.depends_on)
                    AND d.status NOT IN ('done','skipped','archived'));

-- Rozliczone wydarzenia, które odbyły się ponad tydzień temu, zamykamy w starym procesie (koniec przypomnień-szumu).
UPDATE public.event_workflow_instances i SET status = 'completed', completed_at = coalesce(i.completed_at, now()), updated_at = now()
 WHERE i.status = 'active' AND i.event_id IN (
   SELECT e.id FROM public.events e WHERE e.status::text = 'settled'
      AND coalesce(e.event_end_date, e.event_date) < now() - interval '7 days');
