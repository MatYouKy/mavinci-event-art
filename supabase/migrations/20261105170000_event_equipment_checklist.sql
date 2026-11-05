-- =====================================================================================================================
-- Checklista sprzętu wydarzenia w trzech etapach:
--   1. Wydanie (magazyn): ilość spakowana na pozycję; brak = czerwony, z powodem i zgodą sprzedawcy / administratora.
--   2. Załadunek powrotny (kierownik realizacji): ile z wydanego wraca z obiektu, rozbieżności z opisem.
--   3. Zwrot (magazyn): ile wróciło sprawne / uszkodzone / brak, opis i zdjęcia; rozbieżności przyjmuje sprzedawca / administrator.
-- Kroki realizacji „Wydaj sprzęt”, „Oddaj sprzęt do magazynu” i „Przyjmij zwrot” zamykają się same po zatwierdzeniu etapu.
-- Wymaga: 20261104200000_event_realization_steps.sql. Dokumentacja: docs/equipment-checklist.md. Migrację można uruchomić ponownie.
-- =====================================================================================================================

-- ---------------------------------------------------------------------------------------------------------------
-- 1. Stan pozycji sprzętu (jedna pozycja wydarzenia = jeden wiersz; NULL = jeszcze nie sprawdzono na danym etapie)
-- ---------------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.event_equipment_checks (
  event_equipment_id uuid PRIMARY KEY REFERENCES public.event_equipment(id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  -- Etap 1: wydanie
  packed_qty integer CHECK (packed_qty >= 0),
  packed_at timestamptz,
  packed_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  packed_by_name text,
  shortage_reason text CHECK (shortage_reason IS NULL OR length(shortage_reason) <= 1000),
  shortage_decision text CHECK (shortage_decision IS NULL OR shortage_decision IN ('approved', 'rejected')),
  shortage_decided_qty integer,
  shortage_decided_at timestamptz,
  shortage_decided_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  shortage_decided_name text,
  shortage_decision_note text,
  -- Etap 2: załadunek powrotny (kierownik)
  loadback_qty integer CHECK (loadback_qty >= 0),
  loadback_note text CHECK (loadback_note IS NULL OR length(loadback_note) <= 1000),
  loadback_at timestamptz,
  loadback_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  loadback_by_name text,
  -- Etap 3: zwrot na magazyn
  returned_ok_qty integer CHECK (returned_ok_qty >= 0),
  returned_damaged_qty integer CHECK (returned_damaged_qty >= 0),
  return_note text CHECK (return_note IS NULL OR length(return_note) <= 2000),
  return_photos text[] NOT NULL DEFAULT '{}',
  returned_at timestamptz,
  returned_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  returned_by_name text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_event_equipment_checks_event ON public.event_equipment_checks(event_id);

-- ---------------------------------------------------------------------------------------------------------------
-- 2. Stan etapów wydarzenia
-- ---------------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.event_equipment_checklists (
  event_id uuid PRIMARY KEY REFERENCES public.events(id) ON DELETE CASCADE,
  shortage_requested_at timestamptz,
  shortage_requested_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  shortage_requested_name text,
  shortage_request_note text,
  dispatch_confirmed_at timestamptz,
  dispatch_confirmed_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  dispatch_confirmed_name text,
  dispatch_note text,
  loadback_confirmed_at timestamptz,
  loadback_confirmed_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  loadback_confirmed_name text,
  loadback_note text,
  return_confirmed_at timestamptz,
  return_confirmed_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  return_confirmed_name text,
  return_note text,
  return_issue_count integer NOT NULL DEFAULT 0,
  issues_ack_at timestamptz,
  issues_ack_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  issues_ack_name text,
  issues_ack_note text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------------------------------------------
-- 3. Historia checklisty (tylko dopisywanie)
-- ---------------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.event_equipment_check_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  event_equipment_id uuid,
  stage text NOT NULL CHECK (stage IN ('dispatch', 'loadback', 'return')),
  action text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  note text,
  actor_id uuid,
  actor_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_event_equipment_check_log_event ON public.event_equipment_check_log(event_id, created_at DESC);

-- Przeniesienie stanu checklisty przy ponownej synchronizacji sprzętu z oferty (usuń + wstaw te same pozycje
-- w jednej transakcji, sync_offer_equipment_to_event): stan wraca do nowej pozycji tego samego sprzętu.
CREATE TABLE IF NOT EXISTS private.equipment_check_carry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL,
  item_key text NOT NULL,
  tx bigint NOT NULL,
  shipped_out boolean NOT NULL DEFAULT false,
  data jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS idx_equipment_check_carry_key ON private.equipment_check_carry(event_id, item_key, tx);
ALTER TABLE private.equipment_check_carry ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.equipment_check_carry FROM PUBLIC, anon, authenticated;

-- Odczyt: obszar „Realizacja” wydarzenia (docs/event-access.md). Zapis wyłącznie przez funkcje poniżej.
ALTER TABLE public.event_equipment_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_equipment_checklists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_equipment_check_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.event_equipment_checks, public.event_equipment_checklists, public.event_equipment_check_log FROM anon, authenticated;
GRANT SELECT ON public.event_equipment_checks, public.event_equipment_checklists, public.event_equipment_check_log TO authenticated;
DROP POLICY IF EXISTS event_equipment_checks_read ON public.event_equipment_checks;
CREATE POLICY event_equipment_checks_read ON public.event_equipment_checks FOR SELECT TO authenticated
  USING (NOT coalesce(public.current_session_is_seller_portal(), false) AND public.can_view_event_area(event_id, 'operations'));
DROP POLICY IF EXISTS event_equipment_checklists_read ON public.event_equipment_checklists;
CREATE POLICY event_equipment_checklists_read ON public.event_equipment_checklists FOR SELECT TO authenticated
  USING (NOT coalesce(public.current_session_is_seller_portal(), false) AND public.can_view_event_area(event_id, 'operations'));
DROP POLICY IF EXISTS event_equipment_check_log_read ON public.event_equipment_check_log;
CREATE POLICY event_equipment_check_log_read ON public.event_equipment_check_log FOR SELECT TO authenticated
  USING (NOT coalesce(public.current_session_is_seller_portal(), false) AND public.can_view_event_area(event_id, 'operations'));

-- Odświeżanie na żywo (CRM i aplikacja: zmiana na innym urządzeniu od razu widoczna).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'event_equipment_checks') THEN
      EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.event_equipment_checks';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'event_equipment_checklists') THEN
      EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.event_equipment_checklists';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'event_equipment_check_log') THEN
      EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.event_equipment_check_log';
    END IF;
  END IF;
END $$;
-- ---------------------------------------------------------------------------------------------------------------
-- 4. Funkcje pomocnicze
-- ---------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.equipment_actor_name(p_employee uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT coalesce(nullif(btrim(concat_ws(' ', e.name, e.surname)), ''), e.nickname, 'Pracownik') FROM public.employees e WHERE e.id = p_employee;
$$;

-- Nazwa pozycji jak na liście załadunku (sprzęt, zestaw albo kabel).
CREATE OR REPLACE FUNCTION private.equipment_line_name(p_line uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT coalesce(i.name, k.name, c.name, 'Sprzęt')
    FROM public.event_equipment x
    LEFT JOIN public.equipment_items i ON i.id = x.equipment_id
    LEFT JOIN public.equipment_kits k ON k.id = x.kit_id
    LEFT JOIN public.cables c ON c.id = x.cable_id
   WHERE x.id = p_line;
$$;

-- Kto może co na checkliście (rola kroku realizacji jak w event_step_can_act; administrator zawsze).
CREATE OR REPLACE FUNCTION private.equipment_checklist_can(p_event uuid, p_what text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  WITH me AS (
    SELECT e.id, e.auth_user_id, e.role, e.access_level, coalesce(e.permissions, '{}'::text[]) AS permissions, v.created_by, v.my_company_id,
           v.status::text AS event_status
      FROM public.employees e JOIN public.events v ON v.id = p_event
     WHERE e.id = public.sales_employee_id() AND e.is_active AND NOT coalesce(public.current_session_is_seller_portal(), true)
       AND public.employee_can_access_company(e.id, v.my_company_id)
  )
  SELECT coalesce((SELECT CASE p_what
    WHEN 'warehouse' THEN private.event_step_can_act(p_event, 'warehouse')
      -- wydarzenie anulowane po wydaniu: zwrot przyjmuje magazyn
      OR (me.event_status = 'cancelled' AND 'equipment_manage' = ANY (me.permissions))
    WHEN 'manager' THEN private.event_step_can_act(p_event, 'manager')
    -- Zgoda na braki i przyjęcie rozbieżności zwrotu: sprzedawca wydarzenia albo administrator (nie samo events_manage).
    WHEN 'sales' THEN me.role = 'admin' OR me.access_level = 'admin'
      OR me.id = public.event_step_assignee(p_event, 'sales') OR me.created_by IN (me.id, me.auth_user_id)
      OR EXISTS (SELECT 1 FROM public.event_sales_shares s WHERE s.event_id = p_event AND s.employee_id = me.id)
      OR coalesce(public.current_employee_sells_event(p_event), false)
    WHEN 'admin' THEN me.role = 'admin' OR me.access_level = 'admin'
    WHEN 'override' THEN private.event_step_can_override(p_event)
    ELSE false END FROM me), false);
$$;

-- Osoby do powiadomień: sprzedawcy wydarzenia, magazyn, kierownik, administratorzy (identyfikatory pracowników).
CREATE OR REPLACE FUNCTION private.equipment_checklist_people(p_event uuid, p_roles text[])
RETURNS uuid[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  WITH ev AS (SELECT v.id, v.created_by, v.my_company_id FROM public.events v WHERE v.id = p_event),
  people AS (
    SELECT public.event_step_assignee(p_event, 'sales') AS id WHERE 'sales' = ANY (p_roles)
    UNION SELECT s.employee_id FROM public.event_sales_shares s WHERE s.event_id = p_event AND 'sales' = ANY (p_roles)
    UNION SELECT e.id FROM public.employees e, ev WHERE 'sales' = ANY (p_roles) AND ev.created_by IN (e.id, e.auth_user_id)
    UNION SELECT public.event_step_assignee(p_event, 'manager') WHERE 'manager' = ANY (p_roles)
    -- bez kierownika: prowadzący (autor wydarzenia)
    UNION SELECT e.id FROM public.employees e, ev WHERE 'manager' = ANY (p_roles)
      AND public.event_step_assignee(p_event, 'manager') IS NULL AND ev.created_by IN (e.id, e.auth_user_id)
    UNION SELECT public.event_step_assignee(p_event, 'warehouse') WHERE 'warehouse' = ANY (p_roles)
    UNION SELECT e.id FROM public.employees e, ev WHERE 'warehouse' = ANY (p_roles)
      AND public.event_step_assignee(p_event, 'warehouse') IS NULL AND public.employee_can_prepare_event(e.id, ev.id)
    UNION SELECT e.id FROM public.employees e, ev WHERE 'admins' = ANY (p_roles)
      AND (e.role = 'admin' OR e.access_level = 'admin') AND public.employee_can_access_company(e.id, ev.my_company_id)
  )
  SELECT coalesce(array_agg(DISTINCT p.id) FILTER (WHERE p.id IS NOT NULL), '{}'::uuid[])
    FROM people p JOIN public.employees e ON e.id = p.id AND e.is_active;
$$;

CREATE OR REPLACE FUNCTION private.notify_event_equipment(p_event uuid, p_title text, p_message text, p_type text, p_recipients uuid[])
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE ev public.events%ROWTYPE; v_notice uuid; v_actor uuid := public.sales_employee_id();
BEGIN
  SELECT * INTO ev FROM public.events WHERE id = p_event;
  IF ev.id IS NULL OR coalesce(cardinality(p_recipients), 0) = 0 THEN RETURN; END IF;
  BEGIN
    INSERT INTO public.notifications(category, title, message, type, related_entity_type, related_entity_id, action_url, metadata)
    VALUES ('event', left(p_title, 200), left(format('Wydarzenie „%s”: %s', ev.name, p_message), 1000),
            CASE WHEN p_type IN ('info', 'success', 'warning', 'error') THEN p_type ELSE 'info' END, 'event', ev.id::text,
            '/crm/events/' || ev.id || '?tab=equipment',
            jsonb_build_object('event_id', ev.id, 'initial_tab', 'checklist', 'workflow', 'equipment_checklist'))
    RETURNING id INTO v_notice;
    INSERT INTO public.notification_recipients(notification_id, user_id, is_read)
    SELECT DISTINCT v_notice, r, false FROM unnest(p_recipients) r WHERE r IS NOT NULL AND r IS DISTINCT FROM v_actor ON CONFLICT DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Powiadomienie checklisty sprzętu nie zostało zapisane: %', SQLERRM;
  END;
END $$;

CREATE OR REPLACE FUNCTION private.equipment_check_log(p_event uuid, p_line uuid, p_stage text, p_action text, p_details jsonb, p_note text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  INSERT INTO public.event_equipment_check_log(event_id, event_equipment_id, stage, action, details, note, actor_id, actor_name)
  VALUES (p_event, p_line, p_stage, p_action,
          coalesce(p_details, '{}'::jsonb) || CASE WHEN p_line IS NOT NULL THEN jsonb_build_object('line_name', private.equipment_line_name(p_line)) ELSE '{}'::jsonb END,
          nullif(btrim(p_note), ''), public.sales_employee_id(), private.equipment_actor_name(public.sales_employee_id()));
$$;

-- Wiersz etapów wydarzenia (tworzony przy pierwszej zmianie) — z blokadą wydarzenia jak w krokach realizacji.
CREATE OR REPLACE FUNCTION private.equipment_checklist_lock(p_event uuid)
RETURNS public.event_equipment_checklists LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE r public.event_equipment_checklists%ROWTYPE;
BEGIN
  PERFORM 1 FROM public.events WHERE id = p_event FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Nie znaleziono wydarzenia.' USING ERRCODE = 'P0002'; END IF;
  INSERT INTO public.event_equipment_checklists(event_id) VALUES (p_event) ON CONFLICT (event_id) DO NOTHING;
  SELECT * INTO r FROM public.event_equipment_checklists WHERE event_id = p_event FOR UPDATE;
  RETURN r;
END $$;

-- Pozycje checklisty: bez usuniętych z oferty, chyba że zostały już wydane.
CREATE OR REPLACE FUNCTION private.equipment_checklist_lines(p_event uuid)
RETURNS TABLE (line_id uuid, quantity integer, required boolean, optional boolean, external_rental boolean, removed boolean,
               packed_qty integer, shortage_reason text, shortage_decision text, shortage_decided_qty integer,
               loadback_qty integer, returned_ok_qty integer, returned_damaged_qty integer, return_note text, loadback_note text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT x.id, greatest(coalesce(x.quantity, 1), 0),
         NOT coalesce(x.is_optional, false) AND NOT coalesce(x.use_external_rental, false) AND NOT coalesce(x.removed_from_offer, false),
         coalesce(x.is_optional, false), coalesce(x.use_external_rental, false), coalesce(x.removed_from_offer, false),
         c.packed_qty, c.shortage_reason, c.shortage_decision, c.shortage_decided_qty,
         c.loadback_qty, c.returned_ok_qty, c.returned_damaged_qty, c.return_note, c.loadback_note
    FROM public.event_equipment x
    LEFT JOIN public.event_equipment_checks c ON c.event_equipment_id = x.id
   WHERE x.event_id = p_event AND (NOT coalesce(x.removed_from_offer, false) OR coalesce(c.packed_qty, 0) > 0);
$$;

-- Brak przy wydaniu: none | pending (czeka na zgodę) | approved | rejected. Zgoda dotyczy konkretnej ilości braku.
CREATE OR REPLACE FUNCTION private.equipment_shortage_status(p_required boolean, p_quantity integer, p_packed integer,
  p_decision text, p_decided_qty integer)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_packed IS NULL OR NOT p_required OR p_packed >= p_quantity THEN 'none'
    WHEN p_decision IS NOT NULL AND p_decided_qty = p_quantity - p_packed THEN p_decision
    ELSE 'pending' END;
$$;

-- Etap 1: zapis ilości spakowanej (wspólny dla nowego RPC i dawnego set_event_equipment_loaded).
CREATE OR REPLACE FUNCTION private.equipment_apply_packed(p_line uuid, p_qty integer, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE x public.event_equipment%ROWTYPE; c public.event_equipment_checks%ROWTYPE; v_actor uuid := public.sales_employee_id();
  v_required boolean; v_qty integer; v_reason text := nullif(btrim(p_reason), ''); v_old_shortage integer; v_new_shortage integer;
BEGIN
  SELECT * INTO x FROM public.event_equipment WHERE id = p_line;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pozycja sprzętu została usunięta. Odśwież checklistę.' USING ERRCODE = 'P0002'; END IF;
  v_qty := greatest(coalesce(x.quantity, 1), 0);
  v_required := NOT coalesce(x.is_optional, false) AND NOT coalesce(x.use_external_rental, false) AND NOT coalesce(x.removed_from_offer, false);
  IF p_qty IS NOT NULL AND (p_qty < 0 OR p_qty > v_qty) THEN
    RAISE EXCEPTION 'Spakowana ilość musi być od 0 do %.', v_qty USING ERRCODE = '22023';
  END IF;
  IF p_qty IS NOT NULL AND p_qty < v_qty AND v_required AND (v_reason IS NULL OR length(v_reason) < 3) THEN
    RAISE EXCEPTION 'Brakuje % szt. — opisz powód braku (np. „uszkodzony, wypożyczony gdzie indziej”).', v_qty - p_qty USING ERRCODE = '22023';
  END IF;
  IF v_reason IS NOT NULL AND length(v_reason) > 1000 THEN RAISE EXCEPTION 'Powód braku może mieć najwyżej 1000 znaków.' USING ERRCODE = '22023'; END IF;
  SELECT * INTO c FROM public.event_equipment_checks WHERE event_equipment_id = p_line FOR UPDATE;
  v_old_shortage := CASE WHEN c.packed_qty IS NULL THEN NULL ELSE greatest(v_qty - c.packed_qty, 0) END;
  v_new_shortage := CASE WHEN p_qty IS NULL THEN NULL ELSE greatest(v_qty - p_qty, 0) END;
  INSERT INTO public.event_equipment_checks AS t (event_equipment_id, event_id, packed_qty, packed_at, packed_by, packed_by_name, shortage_reason, updated_at)
  VALUES (p_line, x.event_id, p_qty, CASE WHEN p_qty IS NOT NULL THEN now() END, CASE WHEN p_qty IS NOT NULL THEN v_actor END,
          CASE WHEN p_qty IS NOT NULL THEN private.equipment_actor_name(v_actor) END,
          CASE WHEN p_qty IS NOT NULL AND p_qty < v_qty THEN v_reason END, now())
  ON CONFLICT (event_equipment_id) DO UPDATE SET
    packed_qty = excluded.packed_qty, packed_at = excluded.packed_at, packed_by = excluded.packed_by, packed_by_name = excluded.packed_by_name,
    shortage_reason = excluded.shortage_reason,
    -- inna ilość braku = nowa decyzja
    shortage_decision = CASE WHEN v_new_shortage IS NOT DISTINCT FROM v_old_shortage THEN t.shortage_decision END,
    shortage_decided_qty = CASE WHEN v_new_shortage IS NOT DISTINCT FROM v_old_shortage THEN t.shortage_decided_qty END,
    shortage_decided_at = CASE WHEN v_new_shortage IS NOT DISTINCT FROM v_old_shortage THEN t.shortage_decided_at END,
    shortage_decided_by = CASE WHEN v_new_shortage IS NOT DISTINCT FROM v_old_shortage THEN t.shortage_decided_by END,
    shortage_decided_name = CASE WHEN v_new_shortage IS NOT DISTINCT FROM v_old_shortage THEN t.shortage_decided_name END,
    shortage_decision_note = CASE WHEN v_new_shortage IS NOT DISTINCT FROM v_old_shortage THEN t.shortage_decision_note END,
    updated_at = now();
  -- Zgodność ze starszą listą (PDF, licznik w CRM, starsze wersje aplikacji): „załadowane” = cała ilość.
  UPDATE public.event_equipment SET is_loaded = coalesce(p_qty >= v_qty AND p_qty > 0, false),
         loaded_at = CASE WHEN p_qty >= v_qty AND p_qty > 0 THEN coalesce(loaded_at, now()) END,
         loaded_by = CASE WHEN p_qty >= v_qty AND p_qty > 0 THEN coalesce(loaded_by, auth.uid()) END
   WHERE id = p_line AND is_loaded IS DISTINCT FROM coalesce(p_qty >= v_qty AND p_qty > 0, false);
  PERFORM private.equipment_check_log(x.event_id, p_line, 'dispatch', 'packed',
    jsonb_build_object('quantity', v_qty, 'packed_qty', p_qty, 'previous', c.packed_qty), v_reason);
END $$;

-- Etap 1: potwierdzenie wydania (RPC i dawne kroki). Ustawia też dotychczasowe pola events.loading_*.
CREATE OR REPLACE FUNCTION private.equipment_confirm_dispatch(p_event uuid, p_note text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE st public.event_equipment_checklists%ROWTYPE; v_actor uuid := public.sales_employee_id(); v_note text := nullif(btrim(p_note), '');
  v_unchecked integer; v_pending integer; v_rejected integer; v_shortages text; v_manager uuid[];
BEGIN
  st := private.equipment_checklist_lock(p_event);
  IF st.dispatch_confirmed_at IS NOT NULL THEN RAISE EXCEPTION 'Wydanie jest już potwierdzone.' USING ERRCODE = '22023'; END IF;
  IF v_note IS NOT NULL AND length(v_note) > 2000 THEN RAISE EXCEPTION 'Notatka może mieć najwyżej 2000 znaków.' USING ERRCODE = '22023'; END IF;
  SELECT count(*) FILTER (WHERE l.required AND l.packed_qty IS NULL),
         count(*) FILTER (WHERE private.equipment_shortage_status(l.required, l.quantity, l.packed_qty, l.shortage_decision, l.shortage_decided_qty) = 'pending'),
         count(*) FILTER (WHERE private.equipment_shortage_status(l.required, l.quantity, l.packed_qty, l.shortage_decision, l.shortage_decided_qty) = 'rejected'),
         string_agg(private.equipment_line_name(l.line_id) || ' ' || l.packed_qty || '/' || l.quantity, ', ')
           FILTER (WHERE l.required AND l.packed_qty IS NOT NULL AND l.packed_qty < l.quantity)
    INTO v_unchecked, v_pending, v_rejected, v_shortages
    FROM private.equipment_checklist_lines(p_event) l;
  IF NOT EXISTS (SELECT 1 FROM private.equipment_checklist_lines(p_event)) THEN
    RAISE EXCEPTION 'Wydarzenie nie ma sprzętu do wydania.' USING ERRCODE = '22023';
  END IF;
  IF v_unchecked > 0 THEN
    RAISE EXCEPTION 'Nieodhaczone pozycje: %. Odhacz spakowane albo wpisz mniejszą ilość z powodem braku.', v_unchecked USING ERRCODE = '22023';
  END IF;
  IF v_rejected > 0 THEN
    RAISE EXCEPTION 'Sprzedawca lub administrator nie zgodził się na braki (%). Uzupełnij sprzęt albo zmień ilość i poproś ponownie.', v_rejected USING ERRCODE = '22023';
  END IF;
  IF v_pending > 0 THEN
    RAISE EXCEPTION 'Braki (%) czekają na zgodę sprzedawcy wydarzenia lub administratora.', v_pending USING ERRCODE = '22023';
  END IF;
  UPDATE public.event_equipment_checklists SET dispatch_confirmed_at = now(), dispatch_confirmed_by = v_actor,
         dispatch_confirmed_name = private.equipment_actor_name(v_actor), dispatch_note = v_note, updated_at = now()
   WHERE event_id = p_event;
  PERFORM set_config('mavinci.equipment_checklist', 'on', true);
  UPDATE public.events SET loading_confirmed = true, loading_confirmed_at = now(), loading_confirmed_by = v_actor, loading_locked = true,
         loading_notes = coalesce(nullif(concat_ws(E'\n', v_note, CASE WHEN v_shortages IS NOT NULL THEN 'Braki (zgoda): ' || v_shortages END), ''), loading_notes),
         loading_unlock_requested = false, loading_unlock_requested_at = NULL, loading_unlock_requested_by = NULL, loading_unlock_reason = NULL
   WHERE id = p_event;
  PERFORM set_config('mavinci.equipment_checklist', '', true);
  PERFORM private.equipment_check_log(p_event, NULL, 'dispatch', 'dispatch_confirmed', jsonb_build_object('shortages', v_shortages), v_note);
  -- Nic nie wydano (tylko wynajem zewnętrzny / pozycje opcjonalne / same braki): załadunek i zwrot nie dotyczą.
  IF NOT EXISTS (SELECT 1 FROM private.equipment_checklist_lines(p_event) l WHERE coalesce(l.packed_qty, 0) > 0) THEN
    UPDATE public.event_equipment_checklists SET loadback_confirmed_at = now(), loadback_confirmed_name = 'Nic nie wydano z magazynu',
           return_confirmed_at = now(), return_confirmed_name = 'Nic nie wydano z magazynu', return_issue_count = 0, updated_at = now()
     WHERE event_id = p_event;
    PERFORM private.equipment_check_log(p_event, NULL, 'return', 'nothing_shipped', '{}'::jsonb, NULL);
    RETURN;
  END IF;
  v_manager := private.equipment_checklist_people(p_event, ARRAY['manager']);
  PERFORM private.notify_event_equipment(p_event, 'Sprzęt wydany z magazynu',
    'lista wydanego sprzętu czeka na sprawdzenie przy załadunku powrotnym' || coalesce('. Braki: ' || v_shortages, '') || '.', 'info', v_manager);
END $$;

-- Strażnik: pól wydania (events.loading_*) nie zmienia się bezpośrednim zapisem — tylko przez checklistę.
CREATE OR REPLACE FUNCTION private.guard_event_loading_fields()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF auth.uid() IS NULL OR coalesce(current_setting('mavinci.equipment_checklist', true), '') = 'on' THEN RETURN NEW; END IF;
  IF NEW.loading_confirmed IS DISTINCT FROM OLD.loading_confirmed OR NEW.loading_confirmed_at IS DISTINCT FROM OLD.loading_confirmed_at
     OR NEW.loading_confirmed_by IS DISTINCT FROM OLD.loading_confirmed_by OR NEW.loading_locked IS DISTINCT FROM OLD.loading_locked
     OR NEW.loading_unlock_requested IS DISTINCT FROM OLD.loading_unlock_requested
     OR NEW.loading_unlock_requested_at IS DISTINCT FROM OLD.loading_unlock_requested_at
     OR NEW.loading_unlock_requested_by IS DISTINCT FROM OLD.loading_unlock_requested_by
     OR NEW.loading_unlock_reason IS DISTINCT FROM OLD.loading_unlock_reason OR NEW.loading_notes IS DISTINCT FROM OLD.loading_notes THEN
    RAISE EXCEPTION 'Wydanie sprzętu potwierdza się na checkliście sprzętu (zaktualizuj aplikację MAVINCI, jeśli widzisz ten komunikat w telefonie).'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS a_guard_event_loading_fields ON public.events;
CREATE TRIGGER a_guard_event_loading_fields BEFORE UPDATE OF loading_confirmed, loading_confirmed_at, loading_confirmed_by, loading_locked,
  loading_unlock_requested, loading_unlock_requested_at, loading_unlock_requested_by, loading_unlock_reason, loading_notes ON public.events
  FOR EACH ROW EXECUTE FUNCTION private.guard_event_loading_fields();

-- Ponowna synchronizacja sprzętu z oferty usuwa i wstawia pozycje w jednej transakcji: stan checklisty przechodzi
-- na nową pozycję tego samego sprzętu. Wydanej (będącej poza magazynem) pozycji nie da się usunąć na stałe.
DROP TRIGGER IF EXISTS a_guard_shipped_equipment_delete ON public.event_equipment;
DROP FUNCTION IF EXISTS private.guard_shipped_equipment_delete();

CREATE OR REPLACE FUNCTION private.equipment_item_key(p_equipment uuid, p_kit uuid, p_cable uuid, p_line uuid)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce('e:' || p_equipment::text, 'k:' || p_kit::text, 'c:' || p_cable::text, 'x:' || p_line::text);
$$;

CREATE OR REPLACE FUNCTION private.equipment_check_carry_out()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE c public.event_equipment_checks%ROWTYPE; st public.event_equipment_checklists%ROWTYPE;
BEGIN
  SELECT * INTO c FROM public.event_equipment_checks WHERE event_equipment_id = OLD.id;
  IF c.event_equipment_id IS NULL THEN RETURN OLD; END IF;
  SELECT * INTO st FROM public.event_equipment_checklists WHERE event_id = OLD.event_id;
  INSERT INTO private.equipment_check_carry(event_id, item_key, tx, shipped_out, data)
  VALUES (OLD.event_id, private.equipment_item_key(OLD.equipment_id, OLD.kit_id, OLD.cable_id, OLD.id), txid_current(),
          coalesce(c.packed_qty, 0) > 0 AND st.dispatch_confirmed_at IS NOT NULL AND st.return_confirmed_at IS NULL,
          to_jsonb(c) || jsonb_build_object('line_name', private.equipment_line_name(OLD.id)));
  RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS a_equipment_check_carry_out ON public.event_equipment;
CREATE TRIGGER a_equipment_check_carry_out BEFORE DELETE ON public.event_equipment
  FOR EACH ROW EXECUTE FUNCTION private.equipment_check_carry_out();

CREATE OR REPLACE FUNCTION private.equipment_check_carry_in()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE r private.equipment_check_carry%ROWTYPE; c public.event_equipment_checks%ROWTYPE;
BEGIN
  SELECT * INTO r FROM private.equipment_check_carry
   WHERE event_id = NEW.event_id AND tx = txid_current()
     AND item_key = private.equipment_item_key(NEW.equipment_id, NEW.kit_id, NEW.cable_id, NEW.id)
   ORDER BY created_at LIMIT 1 FOR UPDATE;
  IF r.id IS NULL THEN RETURN NEW; END IF;
  c := jsonb_populate_record(NULL::public.event_equipment_checks,
         (r.data - 'line_name') || jsonb_build_object('event_equipment_id', NEW.id, 'event_id', NEW.event_id, 'updated_at', now()));
  INSERT INTO public.event_equipment_checks SELECT c.* ON CONFLICT (event_equipment_id) DO NOTHING;
  DELETE FROM private.equipment_check_carry WHERE id = r.id;
  -- Zgodność z dawną listą: „załadowane” = spakowana pełna ilość.
  UPDATE public.event_equipment SET is_loaded = true, loaded_at = coalesce(loaded_at, now())
   WHERE id = NEW.id AND coalesce(c.packed_qty, 0) >= greatest(coalesce(NEW.quantity, 1), 1) AND NOT coalesce(is_loaded, false);
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS zz_equipment_check_carry_in ON public.event_equipment;
CREATE TRIGGER zz_equipment_check_carry_in AFTER INSERT ON public.event_equipment
  FOR EACH ROW EXECUTE FUNCTION private.equipment_check_carry_in();

-- Na koniec transakcji: nieprzeniesiona pozycja wydana na wydarzenie (sprzęt poza magazynem) = błąd; reszta znika.
CREATE OR REPLACE FUNCTION private.equipment_check_carry_finish()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE r private.equipment_check_carry%ROWTYPE;
BEGIN
  SELECT * INTO r FROM private.equipment_check_carry WHERE id = NEW.id;
  IF r.id IS NULL THEN RETURN NULL; END IF;
  IF r.shipped_out THEN
    RAISE EXCEPTION 'Sprzęt „%” jest wydany na wydarzenie — nie można go usunąć z listy, dopóki nie wróci (zwrot na magazyn). Zmniejsz ilość w ofercie po zwrocie albo poproś administratora o cofnięcie wydania.',
      coalesce(r.data->>'line_name', 'pozycja') USING ERRCODE = '22023';
  END IF;
  DELETE FROM private.equipment_check_carry WHERE id = r.id;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS equipment_check_carry_finish ON private.equipment_check_carry;
CREATE CONSTRAINT TRIGGER equipment_check_carry_finish AFTER INSERT ON private.equipment_check_carry
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION private.equipment_check_carry_finish();
-- ---------------------------------------------------------------------------------------------------------------
-- 5. Odczyt checklisty (CRM zakładka „Sprzęt”, aplikacja zakładka „Checklista”)
-- ---------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_event_equipment_checklist(p_event uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE ev public.events%ROWTYPE; st public.event_equipment_checklists%ROWTYPE; v_lines jsonb; v_sum record; v_stage text;
  can_wh boolean; can_mg boolean; can_sales boolean; can_ovr boolean; v_blockers jsonb := '[]'::jsonb;
BEGIN
  IF auth.uid() IS NULL OR coalesce(public.current_session_is_seller_portal(), true) OR NOT public.can_view_event_area(p_event, 'operations') THEN
    RAISE EXCEPTION 'Brak dostępu do sprzętu wydarzenia.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO ev FROM public.events WHERE id = p_event;
  SELECT * INTO st FROM public.event_equipment_checklists WHERE event_id = p_event;
  can_wh := private.equipment_checklist_can(p_event, 'warehouse');
  can_mg := private.equipment_checklist_can(p_event, 'manager');
  can_sales := private.equipment_checklist_can(p_event, 'sales');
  can_ovr := private.equipment_checklist_can(p_event, 'override');

  WITH l AS (
    SELECT l.*, x.notes, x.equipment_id, x.kit_id, x.cable_id,
           private.equipment_shortage_status(l.required, l.quantity, l.packed_qty, l.shortage_decision, l.shortage_decided_qty) AS shortage_status,
           c.packed_at, c.packed_by_name, c.shortage_decided_name, c.shortage_decided_at, c.shortage_decision_note,
           c.loadback_at, c.loadback_by_name, c.returned_at, c.returned_by_name, c.return_photos,
           coalesce(i.name, k.name, cb.name, 'Sprzęt') AS name,
           CASE WHEN x.kit_id IS NOT NULL THEN 'kit' WHEN x.cable_id IS NOT NULL THEN 'cable' ELSE 'equipment' END AS kind,
           coalesce(i.thumbnail_url, k.thumbnail_url, cb.thumbnail_url) AS thumbnail_url,
           wc.name AS category
      FROM private.equipment_checklist_lines(p_event) l
      JOIN public.event_equipment x ON x.id = l.line_id
      LEFT JOIN public.event_equipment_checks c ON c.event_equipment_id = l.line_id
      LEFT JOIN public.equipment_items i ON i.id = x.equipment_id
      LEFT JOIN public.equipment_kits k ON k.id = x.kit_id
      LEFT JOIN public.cables cb ON cb.id = x.cable_id
      LEFT JOIN public.warehouse_categories wc ON wc.id = coalesce(i.warehouse_category_id, k.warehouse_category_id, cb.warehouse_category_id)
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', l.line_id, 'name', l.name, 'kind', l.kind, 'category', l.category, 'thumbnail_url', l.thumbnail_url, 'notes', nullif(l.notes, ''),
           'quantity', l.quantity, 'required', l.required, 'optional', l.optional, 'external_rental', l.external_rental, 'removed', l.removed,
           'packed_qty', l.packed_qty, 'packed_at', l.packed_at, 'packed_by_name', l.packed_by_name,
           'shortage_qty', CASE WHEN l.packed_qty IS NULL THEN 0 ELSE greatest(l.quantity - l.packed_qty, 0) END,
           'shortage_reason', l.shortage_reason, 'shortage_status', l.shortage_status,
           'shortage_decided_name', l.shortage_decided_name, 'shortage_decided_at', l.shortage_decided_at, 'shortage_decision_note', l.shortage_decision_note,
           'shipped_qty', coalesce(l.packed_qty, 0),
           'loadback_qty', l.loadback_qty, 'loadback_note', l.loadback_note, 'loadback_at', l.loadback_at, 'loadback_by_name', l.loadback_by_name,
           'return_ok_qty', l.returned_ok_qty, 'return_damaged_qty', l.returned_damaged_qty,
           'return_missing_qty', CASE WHEN l.returned_ok_qty IS NULL THEN NULL
                                      ELSE greatest(coalesce(l.packed_qty, 0) - l.returned_ok_qty - coalesce(l.returned_damaged_qty, 0), 0) END,
           'return_note', l.return_note, 'return_photos', to_jsonb(coalesce(l.return_photos, '{}'::text[])),
           'returned_at', l.returned_at, 'returned_by_name', l.returned_by_name)
         ORDER BY l.category NULLS LAST, l.name, l.line_id), '[]'::jsonb)
    INTO v_lines FROM l;

  SELECT count(*) AS lines,
         count(*) FILTER (WHERE l.required) AS required,
         count(*) FILTER (WHERE l.required AND l.packed_qty IS NULL) AS unchecked_dispatch,
         count(*) FILTER (WHERE l.packed_qty IS NOT NULL AND l.packed_qty >= l.quantity) AS packed_full,
         count(*) FILTER (WHERE l.required AND l.packed_qty IS NOT NULL AND l.packed_qty < l.quantity) AS shortages,
         count(*) FILTER (WHERE private.equipment_shortage_status(l.required, l.quantity, l.packed_qty, l.shortage_decision, l.shortage_decided_qty) = 'pending') AS shortages_pending,
         count(*) FILTER (WHERE private.equipment_shortage_status(l.required, l.quantity, l.packed_qty, l.shortage_decision, l.shortage_decided_qty) = 'approved') AS shortages_approved,
         count(*) FILTER (WHERE private.equipment_shortage_status(l.required, l.quantity, l.packed_qty, l.shortage_decision, l.shortage_decided_qty) = 'rejected') AS shortages_rejected,
         count(*) FILTER (WHERE coalesce(l.packed_qty, 0) > 0) AS shipped,
         count(*) FILTER (WHERE coalesce(l.packed_qty, 0) > 0 AND l.loadback_qty IS NULL) AS loadback_unchecked,
         count(*) FILTER (WHERE coalesce(l.packed_qty, 0) > 0 AND l.loadback_qty < l.packed_qty) AS loadback_missing,
         count(*) FILTER (WHERE coalesce(l.packed_qty, 0) > 0 AND l.returned_ok_qty IS NULL) AS return_unchecked,
         count(*) FILTER (WHERE coalesce(l.returned_damaged_qty, 0) > 0) AS return_damaged,
         count(*) FILTER (WHERE l.returned_ok_qty IS NOT NULL AND l.returned_ok_qty + coalesce(l.returned_damaged_qty, 0) < coalesce(l.packed_qty, 0)) AS return_missing
    INTO v_sum FROM private.equipment_checklist_lines(p_event) l;

  v_stage := CASE WHEN v_sum.lines = 0 THEN 'empty'
                  WHEN st.dispatch_confirmed_at IS NULL THEN 'dispatch'
                  WHEN st.loadback_confirmed_at IS NULL AND st.return_confirmed_at IS NULL THEN 'loadback'
                  WHEN st.return_confirmed_at IS NULL THEN 'return'
                  WHEN st.return_issue_count > 0 AND st.issues_ack_at IS NULL THEN 'issues'
                  ELSE 'done' END;
  IF v_stage = 'dispatch' THEN
    IF v_sum.unchecked_dispatch > 0 THEN v_blockers := v_blockers || to_jsonb(format('Nieodhaczone pozycje: %s', v_sum.unchecked_dispatch)); END IF;
    IF v_sum.shortages_pending > 0 THEN v_blockers := v_blockers || to_jsonb(format('Braki czekają na zgodę sprzedawcy lub administratora: %s', v_sum.shortages_pending)); END IF;
    IF v_sum.shortages_rejected > 0 THEN v_blockers := v_blockers || to_jsonb(format('Braki bez zgody — uzupełnij sprzęt: %s', v_sum.shortages_rejected)); END IF;
  ELSIF v_stage = 'loadback' AND v_sum.loadback_unchecked > 0 THEN
    v_blockers := v_blockers || to_jsonb(format('Niesprawdzone przy załadunku: %s', v_sum.loadback_unchecked));
  ELSIF v_stage = 'return' AND v_sum.return_unchecked > 0 THEN
    v_blockers := v_blockers || to_jsonb(format('Niesprawdzone przy zwrocie: %s', v_sum.return_unchecked));
  END IF;

  RETURN jsonb_build_object(
    'event_id', p_event, 'stage', v_stage,
    'dispatch', jsonb_build_object('confirmed_at', st.dispatch_confirmed_at, 'confirmed_by_name', st.dispatch_confirmed_name, 'note', st.dispatch_note,
      'locked', coalesce(ev.loading_locked, false), 'unlock_requested', coalesce(ev.loading_unlock_requested, false),
      'unlock_requested_at', ev.loading_unlock_requested_at, 'unlock_reason', ev.loading_unlock_reason,
      'shortage_requested_at', st.shortage_requested_at, 'shortage_requested_name', st.shortage_requested_name,
      'shortage_request_note', st.shortage_request_note),
    'loadback', jsonb_build_object('confirmed_at', st.loadback_confirmed_at, 'confirmed_by_name', st.loadback_confirmed_name, 'note', st.loadback_note),
    'return', jsonb_build_object('confirmed_at', st.return_confirmed_at, 'confirmed_by_name', st.return_confirmed_name, 'note', st.return_note,
      'issue_count', coalesce(st.return_issue_count, 0), 'issues_ack_at', st.issues_ack_at, 'issues_ack_name', st.issues_ack_name,
      'issues_ack_note', st.issues_ack_note),
    'can', jsonb_build_object(
      'pack', can_wh AND v_stage = 'dispatch',
      'request_approval', can_wh AND v_stage = 'dispatch' AND v_sum.shortages_pending + v_sum.shortages_rejected > 0,
      'approve_shortages', can_sales AND v_stage = 'dispatch' AND v_sum.shortages_pending + v_sum.shortages_rejected > 0,
      'confirm_dispatch', can_wh AND v_stage = 'dispatch' AND v_sum.unchecked_dispatch = 0 AND v_sum.shortages_pending = 0 AND v_sum.shortages_rejected = 0,
      'request_unlock', (can_wh OR can_mg) AND st.dispatch_confirmed_at IS NOT NULL AND st.loadback_confirmed_at IS NULL
                        AND st.return_confirmed_at IS NULL AND NOT coalesce(ev.loading_unlock_requested, false),
      'loadback', can_mg AND v_stage = 'loadback',
      'confirm_loadback', can_mg AND v_stage = 'loadback' AND v_sum.loadback_unchecked = 0 AND v_sum.shipped > 0,
      'return', can_wh AND v_stage IN ('loadback', 'return'),
      'confirm_return', can_wh AND v_stage IN ('loadback', 'return') AND v_sum.return_unchecked = 0 AND v_sum.shipped > 0,
      'ack_issues', can_sales AND v_stage = 'issues',
      'reopen', can_ovr AND st.dispatch_confirmed_at IS NOT NULL),
    'blockers', v_blockers,
    'summary', to_jsonb(v_sum),
    'lines', v_lines,
    'log', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', g.id, 'stage', g.stage, 'action', g.action, 'line_id', g.event_equipment_id,
              'line_name', g.details->>'line_name', 'details', g.details, 'note', g.note, 'actor_name', g.actor_name, 'created_at', g.created_at)
              ORDER BY g.created_at DESC), '[]'::jsonb)
              FROM (SELECT * FROM public.event_equipment_check_log g WHERE g.event_id = p_event ORDER BY g.created_at DESC LIMIT 60) g));
END $$;

-- ---------------------------------------------------------------------------------------------------------------
-- 6. Etap 1 — wydanie z magazynu
-- ---------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_event_equipment_packed(p_line uuid, p_qty integer, p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_event uuid; st public.event_equipment_checklists%ROWTYPE;
BEGIN
  SELECT event_id INTO v_event FROM public.event_equipment WHERE id = p_line;
  IF v_event IS NULL THEN RAISE EXCEPTION 'Pozycja sprzętu została usunięta. Odśwież checklistę.' USING ERRCODE = 'P0002'; END IF;
  IF NOT private.equipment_checklist_can(v_event, 'warehouse') THEN
    RAISE EXCEPTION 'Sprzęt do wydania odhacza magazyn.' USING ERRCODE = '42501';
  END IF;
  st := private.equipment_checklist_lock(v_event);
  IF st.dispatch_confirmed_at IS NOT NULL THEN
    RAISE EXCEPTION 'Wydanie jest zatwierdzone. Zmiana wymaga cofnięcia wydania (prośba do administratora).' USING ERRCODE = '22023';
  END IF;
  PERFORM private.equipment_apply_packed(p_line, p_qty, p_reason);
  RETURN public.get_event_equipment_checklist(v_event);
END $$;

-- „Wszystko zgodne”: uzupełnia niesprawdzone pozycje pełną ilością na danym etapie (bez zmiany już wpisanych).
CREATE OR REPLACE FUNCTION public.fill_event_equipment_stage(p_event uuid, p_stage text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE st public.event_equipment_checklists%ROWTYPE; r record; v_actor uuid := public.sales_employee_id(); v_name text; v_count integer := 0;
BEGIN
  IF p_stage NOT IN ('dispatch', 'loadback', 'return') THEN RAISE EXCEPTION 'Nieznany etap checklisty.' USING ERRCODE = '22023'; END IF;
  IF NOT private.equipment_checklist_can(p_event, CASE WHEN p_stage = 'loadback' THEN 'manager' ELSE 'warehouse' END) THEN
    RAISE EXCEPTION 'Ten etap checklisty należy do innej roli.' USING ERRCODE = '42501';
  END IF;
  st := private.equipment_checklist_lock(p_event);
  v_name := private.equipment_actor_name(v_actor);
  IF p_stage = 'dispatch' THEN
    IF st.dispatch_confirmed_at IS NOT NULL THEN RAISE EXCEPTION 'Wydanie jest już zatwierdzone.' USING ERRCODE = '22023'; END IF;
    FOR r IN SELECT l.line_id, l.quantity FROM private.equipment_checklist_lines(p_event) l WHERE l.required AND l.packed_qty IS NULL LOOP
      PERFORM private.equipment_apply_packed(r.line_id, r.quantity, NULL); v_count := v_count + 1;
    END LOOP;
  ELSIF p_stage = 'loadback' THEN
    IF st.dispatch_confirmed_at IS NULL OR st.loadback_confirmed_at IS NOT NULL OR st.return_confirmed_at IS NOT NULL THEN
      RAISE EXCEPTION 'Załadunek powrotny nie jest teraz otwarty.' USING ERRCODE = '22023';
    END IF;
    UPDATE public.event_equipment_checks SET loadback_qty = packed_qty, loadback_note = NULL, loadback_at = now(), loadback_by = v_actor,
           loadback_by_name = v_name, updated_at = now()
     WHERE event_id = p_event AND coalesce(packed_qty, 0) > 0 AND loadback_qty IS NULL;
    GET DIAGNOSTICS v_count = ROW_COUNT;
  ELSE
    IF st.dispatch_confirmed_at IS NULL OR st.return_confirmed_at IS NOT NULL THEN
      RAISE EXCEPTION 'Zwrot nie jest teraz otwarty.' USING ERRCODE = '22023';
    END IF;
    UPDATE public.event_equipment_checks SET returned_ok_qty = packed_qty, returned_damaged_qty = 0, returned_at = now(), returned_by = v_actor,
           returned_by_name = v_name, updated_at = now()
     WHERE event_id = p_event AND coalesce(packed_qty, 0) > 0 AND returned_ok_qty IS NULL
       -- pozycje z brakiem zgłoszonym przy załadunku powrotnym magazyn sprawdza ręcznie (z opisem)
       AND (loadback_qty IS NULL OR loadback_qty >= packed_qty);
    GET DIAGNOSTICS v_count = ROW_COUNT;
  END IF;
  IF v_count > 0 THEN
    PERFORM private.equipment_check_log(p_event, NULL, p_stage, 'filled', jsonb_build_object('count', v_count), NULL);
  END IF;
  RETURN public.get_event_equipment_checklist(p_event);
END $$;

CREATE OR REPLACE FUNCTION public.request_event_equipment_shortage_approval(p_event uuid, p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE st public.event_equipment_checklists%ROWTYPE; v_actor uuid := public.sales_employee_id(); v_list text; v_note text := nullif(btrim(p_note), '');
BEGIN
  IF NOT private.equipment_checklist_can(p_event, 'warehouse') THEN
    RAISE EXCEPTION 'O zgodę na braki prosi magazyn.' USING ERRCODE = '42501';
  END IF;
  st := private.equipment_checklist_lock(p_event);
  IF st.dispatch_confirmed_at IS NOT NULL THEN RAISE EXCEPTION 'Wydanie jest już zatwierdzone.' USING ERRCODE = '22023'; END IF;
  IF v_note IS NOT NULL AND length(v_note) > 1000 THEN RAISE EXCEPTION 'Notatka może mieć najwyżej 1000 znaków.' USING ERRCODE = '22023'; END IF;
  SELECT string_agg(format('%s: %s z %s (%s)', private.equipment_line_name(l.line_id), l.packed_qty, l.quantity, coalesce(l.shortage_reason, 'bez opisu')), '; ')
    INTO v_list FROM private.equipment_checklist_lines(p_event) l
   WHERE private.equipment_shortage_status(l.required, l.quantity, l.packed_qty, l.shortage_decision, l.shortage_decided_qty) IN ('pending', 'rejected');
  IF v_list IS NULL THEN RAISE EXCEPTION 'Nie ma braków czekających na zgodę.' USING ERRCODE = '22023'; END IF;
  -- Bez zmian od ostatniej prośby (i bez nowej notatki) — nie wysyłamy jej ponownie.
  IF st.shortage_requested_at IS NOT NULL AND v_note IS NULL AND NOT EXISTS (
       SELECT 1 FROM public.event_equipment_checks c WHERE c.event_id = p_event
          AND greatest(c.packed_at, c.shortage_decided_at) > st.shortage_requested_at) THEN
    RAISE EXCEPTION 'Prośba o zgodę została już wysłana (%). Dopisz notatkę, jeśli chcesz przypomnieć.',
      to_char(st.shortage_requested_at AT TIME ZONE 'Europe/Warsaw', 'DD.MM HH24:MI') USING ERRCODE = '22023';
  END IF;
  UPDATE public.event_equipment_checklists SET shortage_requested_at = now(), shortage_requested_by = v_actor,
         shortage_requested_name = private.equipment_actor_name(v_actor), shortage_request_note = v_note, updated_at = now()
   WHERE event_id = p_event;
  PERFORM private.equipment_check_log(p_event, NULL, 'dispatch', 'shortage_requested', jsonb_build_object('shortages', v_list), v_note);
  PERFORM private.notify_event_equipment(p_event, 'Braki w wydaniu sprzętu — potrzebna zgoda',
    v_list || coalesce('. Magazyn: ' || v_note, '') || '. Zaakceptuj albo odrzuć braki w zakładce Sprzęt.', 'warning',
    private.equipment_checklist_people(p_event, ARRAY['sales', 'admins']));
  RETURN public.get_event_equipment_checklist(p_event);
END $$;

DROP FUNCTION IF EXISTS public.decide_event_equipment_shortages(uuid, boolean, text);
-- p_lines: braki, które sprzedawca widzi ([{"id", "shortage_qty"}]) — decyzja tylko dla nich i tylko przy tej samej ilości.
CREATE OR REPLACE FUNCTION public.decide_event_equipment_shortages(p_event uuid, p_approve boolean, p_note text DEFAULT NULL, p_lines jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE st public.event_equipment_checklists%ROWTYPE; v_actor uuid := public.sales_employee_id(); v_name text; v_note text := nullif(btrim(p_note), '');
  v_count integer; v_list text; v_open jsonb; v_ids uuid[];
BEGIN
  IF NOT private.equipment_checklist_can(p_event, 'sales') THEN
    RAISE EXCEPTION 'Zgodę na braki daje sprzedawca wydarzenia albo administrator.' USING ERRCODE = '42501';
  END IF;
  IF p_approve IS NULL THEN RAISE EXCEPTION 'Wybierz: zgoda albo odmowa.' USING ERRCODE = '22023'; END IF;
  IF NOT p_approve AND (v_note IS NULL OR length(v_note) < 3) THEN
    RAISE EXCEPTION 'Napisz, co magazyn ma zrobić (np. dowieźć, wynająć, zamienić).' USING ERRCODE = '22023';
  END IF;
  IF v_note IS NOT NULL AND length(v_note) > 1000 THEN RAISE EXCEPTION 'Notatka może mieć najwyżej 1000 znaków.' USING ERRCODE = '22023'; END IF;
  IF p_lines IS NOT NULL AND jsonb_typeof(p_lines) <> 'array' THEN RAISE EXCEPTION 'Nieprawidłowa lista braków.' USING ERRCODE = '22023'; END IF;
  st := private.equipment_checklist_lock(p_event);
  IF st.dispatch_confirmed_at IS NOT NULL THEN RAISE EXCEPTION 'Wydanie jest już zatwierdzone.' USING ERRCODE = '22023'; END IF;
  v_name := private.equipment_actor_name(v_actor);
  -- Braki otwarte: czekające albo odrzucone (odrzucenie można zmienić na zgodę).
  SELECT coalesce(jsonb_object_agg(l.line_id::text, jsonb_build_object('shortage', l.quantity - l.packed_qty, 'packed_by', c.packed_by)), '{}'::jsonb)
    INTO v_open
    FROM private.equipment_checklist_lines(p_event) l JOIN public.event_equipment_checks c ON c.event_equipment_id = l.line_id
   WHERE private.equipment_shortage_status(l.required, l.quantity, l.packed_qty, l.shortage_decision, l.shortage_decided_qty) IN ('pending', 'rejected');
  IF p_lines IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_lines) x
                WHERE NOT (v_open ? (x->>'id'))
                   OR (x->>'shortage_qty')::numeric IS DISTINCT FROM (v_open->(x->>'id')->>'shortage')::numeric) THEN
      RAISE EXCEPTION 'Lista braków zmieniła się — odśwież i sprawdź ponownie.' USING ERRCODE = '22023';
    END IF;
    SELECT array_agg(DISTINCT (x->>'id')::uuid) INTO v_ids FROM jsonb_array_elements(p_lines) x;
  ELSE
    SELECT array_agg(k::uuid) INTO v_ids FROM jsonb_object_keys(v_open) k;
  END IF;
  IF coalesce(cardinality(v_ids), 0) = 0 THEN RAISE EXCEPTION 'Nie ma braków czekających na decyzję.' USING ERRCODE = '22023'; END IF;
  -- Kto pakował, nie zatwierdza swoich braków (chyba że administrator).
  IF NOT private.equipment_checklist_can(p_event, 'admin')
     AND EXISTS (SELECT 1 FROM unnest(v_ids) i WHERE (v_open->(i::text)->>'packed_by')::uuid = v_actor) THEN
    RAISE EXCEPTION 'Nie zatwierdzasz braków, które sam(a) oznaczyłeś(-aś) przy pakowaniu — decyzję podejmuje sprzedawca wydarzenia albo administrator.'
      USING ERRCODE = '42501';
  END IF;
  SELECT string_agg(format('%s: %s z %s', private.equipment_line_name(x.id), x.quantity - (v_open->(x.id::text)->>'shortage')::integer, x.quantity), '; ')
    INTO v_list FROM public.event_equipment x WHERE x.id = ANY (v_ids);
  UPDATE public.event_equipment_checks c SET shortage_decision = CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,
         shortage_decided_qty = (v_open->(c.event_equipment_id::text)->>'shortage')::integer, shortage_decided_at = now(),
         shortage_decided_by = v_actor, shortage_decided_name = v_name, shortage_decision_note = v_note, updated_at = now()
   WHERE c.event_equipment_id = ANY (v_ids) AND c.event_id = p_event;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  PERFORM private.equipment_check_log(p_event, NULL, 'dispatch', CASE WHEN p_approve THEN 'shortage_approved' ELSE 'shortage_rejected' END,
    jsonb_build_object('count', v_count, 'shortages', v_list), v_note);
  PERFORM private.notify_event_equipment(p_event,
    CASE WHEN p_approve THEN 'Zgoda na braki w wydaniu sprzętu' ELSE 'Brak zgody na braki w wydaniu sprzętu' END,
    v_name || CASE WHEN p_approve THEN ' zaakceptował(a) braki: ' ELSE ' nie zgodził(a) się na braki: ' END || v_list || coalesce('. ' || v_note, '') ||
      CASE WHEN p_approve THEN '. Możesz potwierdzić wydanie.' ELSE '.' END,
    CASE WHEN p_approve THEN 'success' ELSE 'warning' END,
    private.equipment_checklist_people(p_event, ARRAY['warehouse']) || coalesce(ARRAY[st.shortage_requested_by], '{}'::uuid[]));
  RETURN public.get_event_equipment_checklist(p_event);
END $$;

CREATE OR REPLACE FUNCTION public.confirm_event_equipment_dispatch(p_event uuid, p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF NOT private.equipment_checklist_can(p_event, 'warehouse') THEN
    RAISE EXCEPTION 'Wydanie sprzętu potwierdza magazyn.' USING ERRCODE = '42501';
  END IF;
  PERFORM private.equipment_confirm_dispatch(p_event, p_note);
  PERFORM public.sync_event_steps(p_event);
  RETURN public.get_event_equipment_checklist(p_event);
END $$;

CREATE OR REPLACE FUNCTION public.request_event_equipment_unlock(p_event uuid, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE st public.event_equipment_checklists%ROWTYPE; v_reason text := nullif(btrim(p_reason), ''); v_actor uuid := public.sales_employee_id();
BEGIN
  IF NOT (private.equipment_checklist_can(p_event, 'warehouse') OR private.equipment_checklist_can(p_event, 'manager')) THEN
    RAISE EXCEPTION 'O odblokowanie wydania prosi magazyn albo kierownik realizacji.' USING ERRCODE = '42501';
  END IF;
  IF v_reason IS NULL OR length(v_reason) < 5 OR length(v_reason) > 1000 THEN
    RAISE EXCEPTION 'Opisz, co trzeba zmienić w wydaniu (5–1000 znaków).' USING ERRCODE = '22023';
  END IF;
  st := private.equipment_checklist_lock(p_event);
  IF st.dispatch_confirmed_at IS NULL THEN RAISE EXCEPTION 'Wydanie nie jest zatwierdzone — możesz je poprawić.' USING ERRCODE = '22023'; END IF;
  IF st.loadback_confirmed_at IS NOT NULL OR st.return_confirmed_at IS NOT NULL THEN
    RAISE EXCEPTION 'Sprzęt wrócił już z wydarzenia — wydania nie da się odblokować.' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.events WHERE id = p_event AND coalesce(loading_unlock_requested, false)) THEN
    RAISE EXCEPTION 'Prośba o odblokowanie już czeka na administratora.' USING ERRCODE = '22023';
  END IF;
  PERFORM set_config('mavinci.equipment_checklist', 'on', true);
  UPDATE public.events SET loading_unlock_requested = true, loading_unlock_requested_at = now(), loading_unlock_requested_by = v_actor,
         loading_unlock_reason = v_reason WHERE id = p_event;
  PERFORM set_config('mavinci.equipment_checklist', '', true);
  PERFORM private.equipment_check_log(p_event, NULL, 'dispatch', 'unlock_requested', '{}'::jsonb, v_reason);
  PERFORM private.notify_event_equipment(p_event, 'Prośba o odblokowanie wydania sprzętu',
    private.equipment_actor_name(v_actor) || ': ' || v_reason, 'warning', private.equipment_checklist_people(p_event, ARRAY['admins']));
  RETURN public.get_event_equipment_checklist(p_event);
END $$;

-- Administrator (albo zarządzanie wydarzeniami) cofa zatwierdzony etap — z powodem; późniejsze etapy muszą być otwarte.
CREATE OR REPLACE FUNCTION public.reopen_event_equipment_stage(p_event uuid, p_stage text, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE st public.event_equipment_checklists%ROWTYPE; v_reason text := nullif(btrim(p_reason), ''); v_keys text[];
BEGIN
  IF NOT private.equipment_checklist_can(p_event, 'override') THEN
    RAISE EXCEPTION 'Zatwierdzony etap cofa administrator albo osoba z uprawnieniem do zarządzania wydarzeniami.' USING ERRCODE = '42501';
  END IF;
  IF p_stage NOT IN ('dispatch', 'loadback', 'return') THEN RAISE EXCEPTION 'Nieznany etap checklisty.' USING ERRCODE = '22023'; END IF;
  IF v_reason IS NULL OR length(v_reason) < 5 OR length(v_reason) > 1000 THEN RAISE EXCEPTION 'Podaj powód (5–1000 znaków).' USING ERRCODE = '22023'; END IF;
  st := private.equipment_checklist_lock(p_event);
  IF p_stage = 'dispatch' THEN
    IF st.dispatch_confirmed_at IS NULL THEN RAISE EXCEPTION 'Wydanie nie jest zatwierdzone.' USING ERRCODE = '22023'; END IF;
    IF st.loadback_confirmed_at IS NOT NULL OR st.return_confirmed_at IS NOT NULL THEN
      RAISE EXCEPTION 'Najpierw cofnij zwrot i załadunek powrotny.' USING ERRCODE = '22023';
    END IF;
    UPDATE public.event_equipment_checklists SET dispatch_confirmed_at = NULL, dispatch_confirmed_by = NULL, dispatch_confirmed_name = NULL,
           dispatch_note = NULL, updated_at = now() WHERE event_id = p_event;
    PERFORM set_config('mavinci.equipment_checklist', 'on', true);
    UPDATE public.events SET loading_confirmed = false, loading_confirmed_at = NULL, loading_confirmed_by = NULL, loading_locked = false,
           loading_unlock_requested = false, loading_unlock_requested_at = NULL, loading_unlock_requested_by = NULL, loading_unlock_reason = NULL
     WHERE id = p_event;
    PERFORM set_config('mavinci.equipment_checklist', '', true);
    -- Wpisy załadunku powrotnego i zwrotu dotyczyły poprzedniego wydania — po ponownym wydaniu sprawdza się od nowa.
    UPDATE public.event_equipment_checks SET loadback_qty = NULL, loadback_note = NULL, loadback_at = NULL, loadback_by = NULL,
           loadback_by_name = NULL, returned_ok_qty = NULL, returned_damaged_qty = NULL, return_note = NULL, returned_at = NULL,
           returned_by = NULL, returned_by_name = NULL, updated_at = now()
     WHERE event_id = p_event AND (loadback_qty IS NOT NULL OR returned_ok_qty IS NOT NULL);
    v_keys := '{}';
  ELSIF p_stage = 'loadback' THEN
    IF st.loadback_confirmed_at IS NULL THEN RAISE EXCEPTION 'Załadunek powrotny nie jest zatwierdzony.' USING ERRCODE = '22023'; END IF;
    IF st.return_confirmed_at IS NOT NULL THEN RAISE EXCEPTION 'Najpierw cofnij zwrot.' USING ERRCODE = '22023'; END IF;
    UPDATE public.event_equipment_checklists SET loadback_confirmed_at = NULL, loadback_confirmed_by = NULL, loadback_confirmed_name = NULL,
           loadback_note = NULL, updated_at = now() WHERE event_id = p_event;
    v_keys := ARRAY['return_handover'];
  ELSE
    IF st.return_confirmed_at IS NULL THEN RAISE EXCEPTION 'Zwrot nie jest zatwierdzony.' USING ERRCODE = '22023'; END IF;
    UPDATE public.event_equipment_checklists SET return_confirmed_at = NULL, return_confirmed_by = NULL, return_confirmed_name = NULL,
           return_note = NULL, return_issue_count = 0, issues_ack_at = NULL, issues_ack_by = NULL, issues_ack_name = NULL, issues_ack_note = NULL,
           updated_at = now() WHERE event_id = p_event;
    v_keys := ARRAY['return_check'];
  END IF;
  -- Kroki zwrotu zamykane przez checklistę wracają do otwartych (wydanie cofa się samo — krok dwukierunkowy).
  WITH old AS (
    SELECT s.id, s.status AS old_status FROM public.event_steps s
     WHERE s.event_id = p_event AND s.step_key = ANY (v_keys) AND s.status IN ('done', 'problem')
  ), reopened AS (
    UPDATE public.event_steps s SET status = 'open', completed_at = NULL, completed_by = NULL, completed_by_name = NULL,
           status_note = 'Cofnięto na checkliście sprzętu: ' || v_reason, updated_at = now()
      FROM old WHERE s.id = old.id
    RETURNING s.id, s.event_id, old.old_status
  )
  INSERT INTO public.event_step_activity(step_id, event_id, action, from_status, to_status, note, performed_by, performed_by_name)
  SELECT r.id, r.event_id, 'reopen', r.old_status, 'open', v_reason, public.sales_employee_id(), private.equipment_actor_name(public.sales_employee_id())
    FROM reopened r;
  PERFORM private.equipment_check_log(p_event, NULL, p_stage, 'reopened', '{}'::jsonb, v_reason);
  PERFORM private.notify_event_equipment(p_event, 'Cofnięto etap checklisty sprzętu',
    CASE p_stage WHEN 'dispatch' THEN 'wydanie' WHEN 'loadback' THEN 'załadunek powrotny' ELSE 'zwrot' END || ' — ' || v_reason, 'warning',
    private.equipment_checklist_people(p_event, CASE p_stage WHEN 'loadback' THEN ARRAY['manager'] ELSE ARRAY['warehouse'] END));
  PERFORM public.sync_event_steps(p_event);
  RETURN public.get_event_equipment_checklist(p_event);
END $$;

-- ---------------------------------------------------------------------------------------------------------------
-- 7. Etap 2 — załadunek powrotny (kierownik realizacji)
-- ---------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_event_equipment_loadback(p_line uuid, p_qty integer, p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE c public.event_equipment_checks%ROWTYPE; st public.event_equipment_checklists%ROWTYPE; v_actor uuid := public.sales_employee_id();
  v_note text := nullif(btrim(p_note), ''); v_event uuid;
BEGIN
  SELECT event_id INTO v_event FROM public.event_equipment_checks WHERE event_equipment_id = p_line;
  IF v_event IS NULL THEN RAISE EXCEPTION 'Ta pozycja nie została wydana z magazynu.' USING ERRCODE = '22023'; END IF;
  IF NOT private.equipment_checklist_can(v_event, 'manager') THEN
    RAISE EXCEPTION 'Załadunek powrotny sprawdza kierownik realizacji.' USING ERRCODE = '42501';
  END IF;
  st := private.equipment_checklist_lock(v_event);
  SELECT * INTO c FROM public.event_equipment_checks WHERE event_equipment_id = p_line FOR UPDATE;
  IF coalesce(c.packed_qty, 0) = 0 THEN RAISE EXCEPTION 'Ta pozycja nie została wydana z magazynu.' USING ERRCODE = '22023'; END IF;
  IF st.dispatch_confirmed_at IS NULL THEN RAISE EXCEPTION 'Sprzęt nie został jeszcze wydany.' USING ERRCODE = '22023'; END IF;
  IF st.return_confirmed_at IS NOT NULL THEN RAISE EXCEPTION 'Magazyn zatwierdził już zwrot — załadunku powrotnego nie zmienia się.' USING ERRCODE = '22023'; END IF;
  IF st.loadback_confirmed_at IS NOT NULL THEN RAISE EXCEPTION 'Załadunek powrotny jest już zatwierdzony.' USING ERRCODE = '22023'; END IF;
  IF p_qty IS NOT NULL AND (p_qty < 0 OR p_qty > c.packed_qty) THEN
    RAISE EXCEPTION 'Ilość musi być od 0 do % (tyle wydano).', c.packed_qty USING ERRCODE = '22023';
  END IF;
  IF p_qty IS NOT NULL AND p_qty < c.packed_qty AND (v_note IS NULL OR length(v_note) < 3) THEN
    RAISE EXCEPTION 'Brakuje % szt. — opisz, co się stało (zostało na obiekcie, zaginęło, uszkodzone).', c.packed_qty - p_qty USING ERRCODE = '22023';
  END IF;
  IF v_note IS NOT NULL AND length(v_note) > 1000 THEN RAISE EXCEPTION 'Notatka może mieć najwyżej 1000 znaków.' USING ERRCODE = '22023'; END IF;
  UPDATE public.event_equipment_checks SET loadback_qty = p_qty, loadback_note = CASE WHEN p_qty IS NOT NULL THEN v_note END,
         loadback_at = CASE WHEN p_qty IS NOT NULL THEN now() END, loadback_by = CASE WHEN p_qty IS NOT NULL THEN v_actor END,
         loadback_by_name = CASE WHEN p_qty IS NOT NULL THEN private.equipment_actor_name(v_actor) END, updated_at = now()
   WHERE event_equipment_id = p_line;
  PERFORM private.equipment_check_log(c.event_id, p_line, 'loadback', 'loadback_set',
    jsonb_build_object('shipped_qty', c.packed_qty, 'loadback_qty', p_qty, 'previous', c.loadback_qty), v_note);
  RETURN public.get_event_equipment_checklist(c.event_id);
END $$;

CREATE OR REPLACE FUNCTION public.confirm_event_equipment_loadback(p_event uuid, p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE st public.event_equipment_checklists%ROWTYPE; v_actor uuid := public.sales_employee_id(); v_note text := nullif(btrim(p_note), '');
  v_unchecked integer; v_shipped integer; v_missing text;
BEGIN
  IF NOT private.equipment_checklist_can(p_event, 'manager') THEN
    RAISE EXCEPTION 'Załadunek powrotny zatwierdza kierownik realizacji.' USING ERRCODE = '42501';
  END IF;
  st := private.equipment_checklist_lock(p_event);
  IF st.dispatch_confirmed_at IS NULL THEN RAISE EXCEPTION 'Sprzęt nie został jeszcze wydany.' USING ERRCODE = '22023'; END IF;
  IF st.return_confirmed_at IS NOT NULL THEN RAISE EXCEPTION 'Magazyn zatwierdził już zwrot — załadunek powrotny nie jest potrzebny.' USING ERRCODE = '22023'; END IF;
  IF st.loadback_confirmed_at IS NOT NULL THEN RAISE EXCEPTION 'Załadunek powrotny jest już zatwierdzony.' USING ERRCODE = '22023'; END IF;
  IF v_note IS NOT NULL AND length(v_note) > 2000 THEN RAISE EXCEPTION 'Notatka może mieć najwyżej 2000 znaków.' USING ERRCODE = '22023'; END IF;
  SELECT count(*) FILTER (WHERE coalesce(packed_qty, 0) > 0),
         count(*) FILTER (WHERE coalesce(packed_qty, 0) > 0 AND loadback_qty IS NULL),
         string_agg(format('%s: %s z %s (%s)', private.equipment_line_name(line_id), loadback_qty, packed_qty, coalesce(loadback_note, 'bez opisu')), '; ')
           FILTER (WHERE loadback_qty < packed_qty)
    INTO v_shipped, v_unchecked, v_missing FROM private.equipment_checklist_lines(p_event);
  IF v_shipped = 0 THEN RAISE EXCEPTION 'Na tym wydarzeniu nie wydano sprzętu.' USING ERRCODE = '22023'; END IF;
  IF v_unchecked > 0 THEN
    RAISE EXCEPTION 'Niesprawdzone pozycje: %. Odhacz załadowane albo wpisz mniejszą ilość z opisem.', v_unchecked USING ERRCODE = '22023';
  END IF;
  UPDATE public.event_equipment_checklists SET loadback_confirmed_at = now(), loadback_confirmed_by = v_actor,
         loadback_confirmed_name = private.equipment_actor_name(v_actor), loadback_note = v_note, updated_at = now()
   WHERE event_id = p_event;
  PERFORM private.equipment_check_log(p_event, NULL, 'loadback', 'loadback_confirmed', jsonb_build_object('missing', v_missing), v_note);
  PERFORM private.notify_event_equipment(p_event, CASE WHEN v_missing IS NULL THEN 'Sprzęt wraca na magazyn' ELSE 'Sprzęt wraca — rozbieżności przy załadunku' END,
    CASE WHEN v_missing IS NULL THEN 'kierownik potwierdził komplet przy załadunku powrotnym' ELSE 'braki przy załadunku: ' || v_missing END ||
      coalesce('. ' || v_note, '') || '. Sprawdź zwrot w zakładce Sprzęt.',
    CASE WHEN v_missing IS NULL THEN 'info' ELSE 'warning' END,
    private.equipment_checklist_people(p_event, CASE WHEN v_missing IS NULL THEN ARRAY['warehouse'] ELSE ARRAY['warehouse', 'sales', 'admins'] END));
  PERFORM public.sync_event_steps(p_event);
  RETURN public.get_event_equipment_checklist(p_event);
END $$;

-- ---------------------------------------------------------------------------------------------------------------
-- 8. Etap 3 — zwrot na magazyn
-- ---------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_event_equipment_return(p_line uuid, p_ok integer, p_damaged integer DEFAULT 0, p_note text DEFAULT NULL,
  p_photos text[] DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE c public.event_equipment_checks%ROWTYPE; st public.event_equipment_checklists%ROWTYPE; v_actor uuid := public.sales_employee_id();
  v_note text := nullif(btrim(p_note), ''); v_damaged integer := coalesce(p_damaged, 0); v_photos text[]; v_event uuid;
BEGIN
  SELECT event_id INTO v_event FROM public.event_equipment_checks WHERE event_equipment_id = p_line;
  IF v_event IS NULL THEN RAISE EXCEPTION 'Ta pozycja nie została wydana z magazynu.' USING ERRCODE = '22023'; END IF;
  IF NOT private.equipment_checklist_can(v_event, 'warehouse') THEN
    RAISE EXCEPTION 'Zwrot sprzętu sprawdza magazyn.' USING ERRCODE = '42501';
  END IF;
  st := private.equipment_checklist_lock(v_event);
  SELECT * INTO c FROM public.event_equipment_checks WHERE event_equipment_id = p_line FOR UPDATE;
  IF coalesce(c.packed_qty, 0) = 0 THEN RAISE EXCEPTION 'Ta pozycja nie została wydana z magazynu.' USING ERRCODE = '22023'; END IF;
  IF st.dispatch_confirmed_at IS NULL THEN RAISE EXCEPTION 'Sprzęt nie został jeszcze wydany.' USING ERRCODE = '22023'; END IF;
  IF st.return_confirmed_at IS NOT NULL THEN RAISE EXCEPTION 'Zwrot jest już zatwierdzony.' USING ERRCODE = '22023'; END IF;
  IF p_ok IS NOT NULL AND (p_ok < 0 OR v_damaged < 0 OR p_ok + v_damaged > c.packed_qty) THEN
    RAISE EXCEPTION 'Sprawne i uszkodzone razem mogą dać najwyżej % szt. (tyle wydano).', c.packed_qty USING ERRCODE = '22023';
  END IF;
  IF p_ok IS NOT NULL AND (v_damaged > 0 OR p_ok + v_damaged < c.packed_qty) AND (v_note IS NULL OR length(v_note) < 3) THEN
    RAISE EXCEPTION 'Opisz uszkodzenia lub brak (co, ile, co się stało).' USING ERRCODE = '22023';
  END IF;
  IF v_note IS NOT NULL AND length(v_note) > 2000 THEN RAISE EXCEPTION 'Opis może mieć najwyżej 2000 znaków.' USING ERRCODE = '22023'; END IF;
  -- Zdjęcia w buckecie event-files: <wydarzenie>/equipment-return/…, do 10 na pozycję.
  v_photos := coalesce(p_photos, c.return_photos, '{}'::text[]);
  IF cardinality(v_photos) > 10 THEN RAISE EXCEPTION 'Najwyżej 10 zdjęć na pozycję.' USING ERRCODE = '22023'; END IF;
  IF EXISTS (SELECT 1 FROM unnest(v_photos) ph WHERE ph IS NULL OR ph NOT LIKE c.event_id::text || '/equipment-return/' || p_line::text || '/%' OR ph LIKE '%..%') THEN
    RAISE EXCEPTION 'Nieprawidłowa ścieżka zdjęcia zwrotu.' USING ERRCODE = '22023';
  END IF;
  UPDATE public.event_equipment_checks SET returned_ok_qty = p_ok, returned_damaged_qty = CASE WHEN p_ok IS NOT NULL THEN v_damaged END,
         return_note = CASE WHEN p_ok IS NOT NULL THEN v_note END, return_photos = v_photos,
         returned_at = CASE WHEN p_ok IS NOT NULL THEN now() END, returned_by = CASE WHEN p_ok IS NOT NULL THEN v_actor END,
         returned_by_name = CASE WHEN p_ok IS NOT NULL THEN private.equipment_actor_name(v_actor) END, updated_at = now()
   WHERE event_equipment_id = p_line;
  PERFORM private.equipment_check_log(c.event_id, p_line, 'return', 'return_set',
    jsonb_build_object('shipped_qty', c.packed_qty, 'ok', p_ok, 'damaged', CASE WHEN p_ok IS NOT NULL THEN v_damaged END,
      'missing', CASE WHEN p_ok IS NOT NULL THEN c.packed_qty - p_ok - v_damaged END, 'photos', cardinality(v_photos)), v_note);
  RETURN public.get_event_equipment_checklist(c.event_id);
END $$;

CREATE OR REPLACE FUNCTION public.confirm_event_equipment_return(p_event uuid, p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE st public.event_equipment_checklists%ROWTYPE; v_actor uuid := public.sales_employee_id(); v_note text := nullif(btrim(p_note), '');
  v_unchecked integer; v_shipped integer; v_issues integer; v_list text; v_step uuid;
BEGIN
  IF NOT private.equipment_checklist_can(p_event, 'warehouse') THEN
    RAISE EXCEPTION 'Zwrot sprzętu zatwierdza magazyn.' USING ERRCODE = '42501';
  END IF;
  st := private.equipment_checklist_lock(p_event);
  IF st.dispatch_confirmed_at IS NULL THEN RAISE EXCEPTION 'Sprzęt nie został jeszcze wydany.' USING ERRCODE = '22023'; END IF;
  IF st.return_confirmed_at IS NOT NULL THEN RAISE EXCEPTION 'Zwrot jest już zatwierdzony.' USING ERRCODE = '22023'; END IF;
  IF v_note IS NOT NULL AND length(v_note) > 2000 THEN RAISE EXCEPTION 'Notatka może mieć najwyżej 2000 znaków.' USING ERRCODE = '22023'; END IF;
  SELECT count(*) FILTER (WHERE coalesce(packed_qty, 0) > 0),
         count(*) FILTER (WHERE coalesce(packed_qty, 0) > 0 AND returned_ok_qty IS NULL),
         count(*) FILTER (WHERE coalesce(returned_damaged_qty, 0) > 0 OR returned_ok_qty + coalesce(returned_damaged_qty, 0) < coalesce(packed_qty, 0)),
         string_agg(format('%s: %s', private.equipment_line_name(line_id), concat_ws(', ',
             CASE WHEN coalesce(returned_damaged_qty, 0) > 0 THEN returned_damaged_qty || ' uszk.' END,
             CASE WHEN returned_ok_qty + coalesce(returned_damaged_qty, 0) < packed_qty
                  THEN (packed_qty - returned_ok_qty - coalesce(returned_damaged_qty, 0)) || ' brak' END)), '; ')
           FILTER (WHERE coalesce(returned_damaged_qty, 0) > 0 OR returned_ok_qty + coalesce(returned_damaged_qty, 0) < coalesce(packed_qty, 0))
    INTO v_shipped, v_unchecked, v_issues, v_list FROM private.equipment_checklist_lines(p_event);
  IF v_shipped = 0 THEN RAISE EXCEPTION 'Na tym wydarzeniu nie wydano sprzętu.' USING ERRCODE = '22023'; END IF;
  IF v_unchecked > 0 THEN
    RAISE EXCEPTION 'Niesprawdzone pozycje: %. Wpisz, ile wróciło sprawne, uszkodzone albo czego brakuje.', v_unchecked USING ERRCODE = '22023';
  END IF;
  UPDATE public.event_equipment_checklists SET return_confirmed_at = now(), return_confirmed_by = v_actor,
         return_confirmed_name = private.equipment_actor_name(v_actor), return_note = v_note, return_issue_count = v_issues,
         issues_ack_at = NULL, issues_ack_by = NULL, issues_ack_name = NULL, issues_ack_note = NULL, updated_at = now()
   WHERE event_id = p_event;
  PERFORM private.equipment_check_log(p_event, NULL, 'return', 'return_confirmed', jsonb_build_object('issues', v_issues, 'list', v_list), v_note);
  PERFORM public.sync_event_steps(p_event);
  IF v_issues > 0 THEN
    -- Krok „Przyjmij zwrot” jako problem do czasu przyjęcia rozbieżności przez sprzedawcę / administratora.
    UPDATE public.event_steps SET status = 'problem', status_note = left('Rozbieżności w zwrocie: ' || v_list, 2000), updated_at = now()
     WHERE event_id = p_event AND step_key = 'return_check' AND status IN ('open', 'in_progress') RETURNING id INTO v_step;
    IF v_step IS NOT NULL THEN
      INSERT INTO public.event_step_activity(step_id, event_id, action, from_status, to_status, note, performed_by, performed_by_name)
      VALUES (v_step, p_event, 'problem', 'open', 'problem', left('Rozbieżności w zwrocie: ' || v_list, 2000), v_actor, private.equipment_actor_name(v_actor));
    END IF;
    PERFORM private.notify_event_equipment(p_event, 'Rozbieżności w zwrocie sprzętu',
      v_list || coalesce('. ' || v_note, '') || '. Przyjmij rozbieżności w zakładce Sprzęt (np. obciążenie klienta, naprawa).', 'warning',
      private.equipment_checklist_people(p_event, ARRAY['sales', 'admins', 'manager']));
  END IF;
  RETURN public.get_event_equipment_checklist(p_event);
END $$;

CREATE OR REPLACE FUNCTION public.acknowledge_event_equipment_return_issues(p_event uuid, p_note text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE st public.event_equipment_checklists%ROWTYPE; v_actor uuid := public.sales_employee_id(); v_note text := nullif(btrim(p_note), '');
BEGIN
  IF NOT private.equipment_checklist_can(p_event, 'sales') THEN
    RAISE EXCEPTION 'Rozbieżności w zwrocie przyjmuje sprzedawca wydarzenia albo administrator.' USING ERRCODE = '42501';
  END IF;
  IF v_note IS NULL OR length(v_note) < 5 OR length(v_note) > 1000 THEN
    RAISE EXCEPTION 'Napisz, co dalej (np. obciążamy klienta, naprawa na nasz koszt, sprzęt odnaleziony) — 5–1000 znaków.' USING ERRCODE = '22023';
  END IF;
  st := private.equipment_checklist_lock(p_event);
  IF st.return_confirmed_at IS NULL OR st.return_issue_count = 0 THEN RAISE EXCEPTION 'Nie ma rozbieżności do przyjęcia.' USING ERRCODE = '22023'; END IF;
  IF st.issues_ack_at IS NOT NULL THEN RAISE EXCEPTION 'Rozbieżności są już przyjęte.' USING ERRCODE = '22023'; END IF;
  UPDATE public.event_equipment_checklists SET issues_ack_at = now(), issues_ack_by = v_actor, issues_ack_name = private.equipment_actor_name(v_actor),
         issues_ack_note = v_note, updated_at = now() WHERE event_id = p_event;
  PERFORM private.equipment_check_log(p_event, NULL, 'return', 'issues_acknowledged', '{}'::jsonb, v_note);
  PERFORM public.sync_event_steps(p_event);
  PERFORM private.notify_event_equipment(p_event, 'Rozbieżności w zwrocie przyjęte',
    private.equipment_actor_name(v_actor) || ': ' || v_note, 'info', private.equipment_checklist_people(p_event, ARRAY['warehouse']));
  RETURN public.get_event_equipment_checklist(p_event);
END $$;

-- ---------------------------------------------------------------------------------------------------------------
-- 9. Zgodność: dawne odhaczanie „załadowane” (starsze wersje aplikacji) = pełna ilość spakowana / odznaczenie
-- ---------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_event_equipment_loaded(p_equipment_id uuid, p_loaded boolean)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_event public.events%ROWTYPE; v_employee public.employees%ROWTYPE; v_event_id uuid; v_qty integer;
  st public.event_equipment_checklists%ROWTYPE;
BEGIN
 IF auth.uid() IS NULL OR p_loaded IS NULL THEN RAISE EXCEPTION 'Wymagane jest zalogowanie i stan załadunku.' USING ERRCODE='42501'; END IF;
 SELECT * INTO v_employee FROM public.employees WHERE id=public.current_employee_id() AND is_active;
 IF NOT FOUND THEN RAISE EXCEPTION 'Brak aktywnego konta pracownika.' USING ERRCODE='42501'; END IF;
 SELECT event_id, greatest(coalesce(quantity, 1), 0) INTO v_event_id, v_qty FROM public.event_equipment WHERE id=p_equipment_id;
 SELECT * INTO v_event FROM public.events WHERE id=v_event_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Nie znaleziono pozycji sprzętu.' USING ERRCODE='P0002'; END IF;
 -- Wydanie odhacza magazyn (checklista sprzętu); kierownik sprawdza załadunek powrotny na osobnym etapie.
 IF NOT private.equipment_checklist_can(v_event.id, 'warehouse') THEN
   RAISE EXCEPTION 'Sprzęt do wydania odhacza magazyn.' USING ERRCODE='42501';
 END IF;
 st := private.equipment_checklist_lock(v_event.id);
 IF coalesce(v_event.loading_locked,false) OR st.dispatch_confirmed_at IS NOT NULL THEN
   RAISE EXCEPTION 'Załadunek jest zatwierdzony. Najpierw odblokuj checklistę.';
 END IF;
 PERFORM private.equipment_apply_packed(p_equipment_id, CASE WHEN p_loaded THEN v_qty END, NULL);
END; $function$;
-- ---------------------------------------------------------------------------------------------------------------
-- 10. Kroki realizacji: wydanie, oddanie i przyjęcie zwrotu zamyka checklista sprzętu
-- ---------------------------------------------------------------------------------------------------------------
-- Kroki zamykane danymi (przycisk „Gotowe” w krokach prowadzi do checklisty).
CREATE OR REPLACE FUNCTION private.event_step_auto_keys()
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT ARRAY['manager_appointed','settlement_invoice','settlement_paid','formal_details','formal_contract','formal_deposit',
               'wedding_card','team_ready','agenda_ready','transport_planned',
               'settlement_summary','settlement_summary_approval',
               'dispatch_out','return_handover','return_check'];
$function$;

CREATE OR REPLACE FUNCTION public.sync_event_steps(p_event uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE ev record; planned text[]; h record; r record; invoiced boolean; paid boolean; picked_up boolean;
  details_ok boolean; contract_ok boolean; deposit_ok boolean; wedding_ok boolean; team_ok boolean; agenda_ok boolean; transport_ok boolean;
  st record; ck record;
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

  SELECT s.status, s.submitted_at, s.submitted_by, s.approved_at, s.approved_by INTO st
    FROM public.event_settlements s WHERE s.event_id = p_event;
  -- Checklista sprzętu: załadunek powrotny (kierownik) i zwrot (magazyn, rozbieżności przyjęte przez sprzedawcę / administratora).
  SELECT c.loadback_confirmed_at, c.loadback_confirmed_by, c.loadback_confirmed_name, c.return_confirmed_at, c.return_confirmed_by,
         c.return_confirmed_name, c.return_issue_count, c.issues_ack_at, c.issues_ack_by, c.issues_ack_name
    INTO ck FROM public.event_equipment_checklists c WHERE c.event_id = p_event;

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
      -- Jednokierunkowe: wcześniejsze wydarzenia z ręcznie zamkniętym krokiem zostają zamknięte (cofanie: reopen_event_equipment_stage).
      -- „Oddaj sprzęt” zamyka też zwrot zatwierdzony przez magazyn (kierownik nie zdążył zatwierdzić załadunku).
      ('return_handover', ck.loadback_confirmed_at IS NOT NULL OR ck.return_confirmed_at IS NOT NULL,
        coalesce(ck.loadback_confirmed_at, ck.return_confirmed_at), coalesce(ck.loadback_confirmed_by, ck.return_confirmed_by),
        coalesce(ck.loadback_confirmed_name, ck.return_confirmed_name), false),
      ('return_check', ck.return_confirmed_at IS NOT NULL AND (coalesce(ck.return_issue_count, 0) = 0 OR ck.issues_ack_at IS NOT NULL),
        coalesce(ck.issues_ack_at, ck.return_confirmed_at), coalesce(ck.issues_ack_by, ck.return_confirmed_by),
        coalesce(ck.issues_ack_name, ck.return_confirmed_name), false),
      ('realization_start', r.started_at IS NOT NULL, r.started_at, r.started_by, NULL::text, true),
      ('realization_complete', r.completed_at IS NOT NULL, r.completed_at, r.completed_by, NULL::text, true),
      ('settlement_invoice', invoiced OR ev.status = 'settled', NULL::timestamptz, NULL::uuid, 'Faktura'::text, true),
      ('settlement_paid', paid, NULL::timestamptz, NULL::uuid, 'Rozliczenie'::text, true),
      ('settlement_summary', coalesce(st.status IN ('submitted','approved'), false), st.submitted_at, st.submitted_by, NULL::text, true),
      ('settlement_summary_approval', coalesce(st.status = 'approved', false), st.approved_at, st.approved_by, NULL::text, true)
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
END $function$;

CREATE OR REPLACE FUNCTION private.event_step_plan(p_event uuid)
 RETURNS TABLE(step_key text, stage text, kind text, source text, source_id uuid, title text, details text, quantity numeric, unit text, supplier text, owner_role text, due_at timestamp with time zone, blocks_ready boolean, sort_order integer, depends_on text[])
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
       'Checklista sprzętu → Wydanie: odhacz spakowane ilości, braki oznacz z powodem i poproś o zgodę sprzedawcę lub administratora, potem potwierdź wydanie. Krok zamyka się sam; potwierdzenie blokuje listę.',
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
       'Checklista sprzętu → Załadunek powrotny: kierownik odhacza przy załadunku po wydarzeniu, co wraca z wydanego sprzętu, braki opisuje i zatwierdza listę. Krok zamyka się sam.', 'manager',
       t_end + interval '1 day', false, 600, ARRAY['realization_complete'], has_equipment),
      ('return_check','return','handoff','Przyjmij zwrot i sprawdź sprzęt',
       'Checklista sprzętu → Zwrot: magazyn wpisuje, ile wróciło sprawne, uszkodzone i czego brakuje (opis, zdjęcia), i zatwierdza zwrot. Rozbieżności przyjmuje sprzedawca lub administrator — wtedy krok się zamyka.', 'warehouse',
       t_end + interval '2 days', false, 610, ARRAY['return_handover'], has_equipment),
      ('settlement_invoice','settlement','approval','Wystaw fakturę za wydarzenie',
       'Krok zamyka się sam po wystawieniu faktury powiązanej z wydarzeniem.', 'admin',
       t_end + interval '7 days', false, 700, '{}'::text[], true),
      ('settlement_paid','settlement','approval','Potwierdź wpłatę za wydarzenie',
       'Krok zamyka się sam, gdy faktury wydarzenia są opłacone.', 'admin',
       coalesce(t_paid, t_end + interval '21 days'), false, 710, ARRAY['settlement_invoice'], true),
      ('settlement_summary','settlement','task','Wyślij podsumowanie wydarzenia',
       'W zakładce Podsumowanie potwierdź koszty netto i wyślij do zatwierdzenia — z podsumowania liczą się prowizje. Krok zamyka się sam po wysłaniu.',
       'sales', t_end + interval '5 days', false, 720, '{}'::text[], true),
      ('settlement_summary_approval','settlement','approval','Zatwierdź podsumowanie wydarzenia',
       'Sprawdź przychody, koszty i prowizje. Zatwierdzenie zamraża prowizje do wypłaty. Krok zamyka się sam po zatwierdzeniu.',
       'admin', t_end + interval '10 days', false, 730, ARRAY['settlement_summary'], true)
    ) AS v(step_key, stage, kind, title, details, owner_role, due_at, blocks_ready, sort_order, depends_on, include)
  )
  SELECT s.step_key, s.stage, s.kind, 'system'::text, NULL::uuid, s.title, nullif(s.details,''), NULL::numeric, NULL::text, NULL::text,
         s.owner_role, s.due_at, s.blocks_ready, s.sort_order, s.depends_on
    FROM sys s WHERE s.include
  UNION ALL
  SELECT p.step_key, p.stage, p.kind, p.source, p.source_id, p.title, p.details, p.quantity, p.unit, p.supplier,
         p.owner_role, p.due_at, p.blocks_ready, p.sort_order, p.depends_on
    FROM prep p;
END $function$;
-- ---------------------------------------------------------------------------------------------------------------
-- 12. Start: wydarzenia wydane dotychczasowym potwierdzeniem załadunku (events.loading_confirmed) dostają stan checklisty
--     — pozycje odhaczone = wydana pełna ilość, nieodhaczone = 0 (brak przyjęty przed wdrożeniem). Kroki zwrotu już
--     zamknięte (albo wydarzenie rozliczone / anulowane) = etapy zakończone. Jednorazowo: tylko wydarzenia bez stanu.
-- ---------------------------------------------------------------------------------------------------------------
DO $$
DECLARE ev record; v_by uuid; v_name text := 'Przed wdrożeniem checklisty'; v_lb timestamptz; v_rt timestamptz;
BEGIN
  FOR ev IN SELECT e.* FROM public.events e
             WHERE coalesce(e.loading_confirmed, false)
               AND NOT EXISTS (SELECT 1 FROM public.event_equipment_checklists c WHERE c.event_id = e.id)
  LOOP
    SELECT x.id INTO v_by FROM public.employees x WHERE x.id = ev.loading_confirmed_by OR x.auth_user_id = ev.loading_confirmed_by
     ORDER BY (x.id = ev.loading_confirmed_by) DESC LIMIT 1;
    SELECT coalesce(s.completed_at, now()) INTO v_lb FROM public.event_steps s
     WHERE s.event_id = ev.id AND s.step_key = 'return_handover' AND s.status IN ('done', 'skipped', 'archived');
    SELECT coalesce(s.completed_at, now()) INTO v_rt FROM public.event_steps s
     WHERE s.event_id = ev.id AND s.step_key = 'return_check' AND s.status IN ('done', 'skipped', 'archived');
    IF ev.status::text IN ('settled', 'cancelled') THEN
      v_lb := coalesce(v_lb, ev.updated_at, now()); v_rt := coalesce(v_rt, ev.updated_at, now());
    END IF;
    INSERT INTO public.event_equipment_checklists(event_id, dispatch_confirmed_at, dispatch_confirmed_by, dispatch_confirmed_name, dispatch_note,
        loadback_confirmed_at, loadback_confirmed_name, return_confirmed_at, return_confirmed_name, return_issue_count)
    VALUES (ev.id, coalesce(ev.loading_confirmed_at, now()), v_by, coalesce(private.equipment_actor_name(v_by), v_name), ev.loading_notes,
        coalesce(v_lb, v_rt), CASE WHEN coalesce(v_lb, v_rt) IS NOT NULL THEN v_name END, v_rt, CASE WHEN v_rt IS NOT NULL THEN v_name END, 0)
    ON CONFLICT (event_id) DO NOTHING;
    INSERT INTO public.event_equipment_checks(event_equipment_id, event_id, packed_qty, packed_at, packed_by_name,
        shortage_reason, shortage_decision, shortage_decided_qty, shortage_decided_at, shortage_decided_name)
    SELECT x.id, ev.id, CASE WHEN coalesce(x.is_loaded, false) THEN greatest(coalesce(x.quantity, 1), 0) ELSE 0 END,
           coalesce(x.loaded_at, ev.loading_confirmed_at, now()), v_name,
           CASE WHEN NOT coalesce(x.is_loaded, false) THEN 'Nieodhaczone przy wydaniu (przed wdrożeniem checklisty)' END,
           CASE WHEN NOT coalesce(x.is_loaded, false) THEN 'approved' END,
           CASE WHEN NOT coalesce(x.is_loaded, false) THEN greatest(coalesce(x.quantity, 1), 0) END,
           CASE WHEN NOT coalesce(x.is_loaded, false) THEN coalesce(ev.loading_confirmed_at, now()) END,
           CASE WHEN NOT coalesce(x.is_loaded, false) THEN v_name END
      FROM public.event_equipment x
     WHERE x.event_id = ev.id AND NOT coalesce(x.removed_from_offer, false)
    ON CONFLICT (event_equipment_id) DO NOTHING;
    INSERT INTO public.event_equipment_check_log(event_id, stage, action, details, note, actor_name)
    VALUES (ev.id, 'dispatch', 'dispatch_confirmed', jsonb_build_object('backfill', true), ev.loading_notes, v_name);
  END LOOP;
END $$;
-- ---------------------------------------------------------------------------------------------------------------
-- 11. Uprawnienia
-- ---------------------------------------------------------------------------------------------------------------
DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.get_event_equipment_checklist(uuid)', 'public.set_event_equipment_packed(uuid, integer, text)',
    'public.fill_event_equipment_stage(uuid, text)', 'public.request_event_equipment_shortage_approval(uuid, text)',
    'public.decide_event_equipment_shortages(uuid, boolean, text, jsonb)', 'public.confirm_event_equipment_dispatch(uuid, text)',
    'public.request_event_equipment_unlock(uuid, text)', 'public.reopen_event_equipment_stage(uuid, text, text)',
    'public.set_event_equipment_loadback(uuid, integer, text)', 'public.confirm_event_equipment_loadback(uuid, text)',
    'public.set_event_equipment_return(uuid, integer, integer, text, text[])', 'public.confirm_event_equipment_return(uuid, text)',
    'public.acknowledge_event_equipment_return_issues(uuid, text)', 'public.set_event_equipment_loaded(uuid, boolean)']
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f);
  END LOOP;
  FOR f IN SELECT p.oid::regprocedure::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'private' AND p.proname IN ('equipment_actor_name', 'equipment_line_name', 'equipment_checklist_can',
              'equipment_checklist_people', 'notify_event_equipment', 'equipment_check_log', 'equipment_checklist_lock',
              'equipment_checklist_lines', 'equipment_shortage_status', 'equipment_apply_packed', 'equipment_confirm_dispatch',
              'guard_event_loading_fields', 'equipment_item_key', 'equipment_check_carry_out', 'equipment_check_carry_in',
              'equipment_check_carry_finish')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
  END LOOP;
END $$;
