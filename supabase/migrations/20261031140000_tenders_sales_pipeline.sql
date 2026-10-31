BEGIN;

-- Przetargi jako źródło sprzedaży:
--  * dostęp tylko dla pracowników z tenders_view (wcześniej: każdy zalogowany, także portal sprzedawcy),
--  * opiekun przetargu, przypomnienia o terminie składania (7 dni i 2 dni),
--  * „Utwórz zapytanie z przetargu” z powiązaniem w obie strony,
--  * status przetargu wynika z etapu zapytania (oferta wysłana → złożona, wygrana, przegrana).

CREATE OR REPLACE FUNCTION public.current_employee_can_view_tenders()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT coalesce((
    SELECT NOT public.current_session_is_seller_portal() AND (
      e.role::text = 'admin' OR e.access_level::text = 'admin'
      OR coalesce(e.permissions, '{}'::text[]) && ARRAY['admin', 'tenders_view']::text[])
    FROM public.employees e WHERE e.id = public.current_crm_employee_id()
  ), false);
$$;

CREATE OR REPLACE FUNCTION public.current_employee_is_crm_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT coalesce((
    SELECT NOT public.current_session_is_seller_portal() AND (
      e.role::text = 'admin' OR e.access_level::text = 'admin'
      OR 'admin' = ANY(coalesce(e.permissions, '{}'::text[])))
    FROM public.employees e WHERE e.id = public.current_crm_employee_id()
  ), false);
$$;

-- RLS: przetargi -----------------------------------------------------------------------
DROP POLICY IF EXISTS "Authenticated users can view tenders" ON public.tenders;
DROP POLICY IF EXISTS "Authenticated users can insert tenders" ON public.tenders;
DROP POLICY IF EXISTS "Authenticated users can update tenders" ON public.tenders;
DROP POLICY IF EXISTS "Authenticated users can delete tenders" ON public.tenders;

CREATE POLICY tenders_view ON public.tenders FOR SELECT TO authenticated
  USING (public.current_employee_can_view_tenders());
CREATE POLICY tenders_work ON public.tenders FOR UPDATE TO authenticated
  USING (public.current_employee_can_view_tenders())
  WITH CHECK (public.current_employee_can_view_tenders());
CREATE POLICY tenders_admin_insert ON public.tenders FOR INSERT TO authenticated
  WITH CHECK (public.current_employee_is_crm_admin());
CREATE POLICY tenders_admin_delete ON public.tenders FOR DELETE TO authenticated
  USING (public.current_employee_is_crm_admin());

DROP POLICY IF EXISTS "Authenticated users can view filter configs" ON public.tender_filter_config;
DROP POLICY IF EXISTS "Authenticated users can manage filter configs" ON public.tender_filter_config;
DROP POLICY IF EXISTS "Authenticated users can update filter configs" ON public.tender_filter_config;
DROP POLICY IF EXISTS "Authenticated users can delete filter configs" ON public.tender_filter_config;

CREATE POLICY tender_filter_config_view ON public.tender_filter_config FOR SELECT TO authenticated
  USING (public.current_employee_can_view_tenders());
CREATE POLICY tender_filter_config_admin ON public.tender_filter_config FOR ALL TO authenticated
  USING (public.current_employee_is_crm_admin())
  WITH CHECK (public.current_employee_is_crm_admin());

DROP POLICY IF EXISTS "Authenticated users can view import logs" ON public.tender_import_logs;
CREATE POLICY tender_import_logs_view ON public.tender_import_logs FOR SELECT TO authenticated
  USING (public.current_employee_can_view_tenders());

-- Powiązania -------------------------------------------------------------------------
ALTER TABLE public.tenders
  ADD COLUMN IF NOT EXISTS inquiry_id uuid REFERENCES public.tasks(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assigned_at timestamptz,
  ADD COLUMN IF NOT EXISTS deadline_reminders_sent text[] NOT NULL DEFAULT '{}';
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS tender_id uuid REFERENCES public.tenders(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_tenders_assigned_to ON public.tenders(assigned_to) WHERE assigned_to IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_tender_id ON public.tasks(tender_id) WHERE tender_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_tasks_inquiry_per_tender ON public.tasks(tender_id)
  WHERE tender_id IS NOT NULL AND is_inquiry = true;

-- Opiekun i powiązane zapytanie zmieniają się wyłącznie przez assign_tender / create_inquiry_from_tender
-- (albo przez administratora), mimo że polityka UPDATE pozwala edytować notatki i status.
CREATE OR REPLACE FUNCTION public.guard_tender_assignment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF auth.uid() IS NULL OR auth.role() = 'service_role'
    OR coalesce(current_setting('mavinci.tender_assignment', true), '') = 'yes'
    OR public.current_employee_is_crm_admin() THEN
    RETURN NEW;
  END IF;
  IF NEW.assigned_to IS DISTINCT FROM OLD.assigned_to OR NEW.assigned_at IS DISTINCT FROM OLD.assigned_at
    OR NEW.inquiry_id IS DISTINCT FROM OLD.inquiry_id
    OR NEW.deadline_reminders_sent IS DISTINCT FROM OLD.deadline_reminders_sent THEN
    RAISE EXCEPTION 'Opiekuna przetargu zmień przyciskiem „Przypisz do mnie” lub poproś administratora.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS guard_tender_assignment ON public.tenders;
CREATE TRIGGER guard_tender_assignment BEFORE UPDATE ON public.tenders
  FOR EACH ROW EXECUTE FUNCTION public.guard_tender_assignment();

-- Opiekun przetargu: sprzedawca przypisuje siebie; administrator lub kierownik zespołu — dowolną osobę z dostępem.
CREATE OR REPLACE FUNCTION public.assign_tender(p_tender_id uuid, p_employee_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE actor public.employees%ROWTYPE; target public.employees%ROWTYPE; tender public.tenders%ROWTYPE;
BEGIN
  IF NOT public.current_employee_can_view_tenders() THEN
    RAISE EXCEPTION 'Brak dostępu do przetargów.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO actor FROM public.employees WHERE id = public.current_crm_employee_id();
  SELECT * INTO tender FROM public.tenders WHERE id = p_tender_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Nie znaleziono przetargu.'; END IF;

  IF p_employee_id IS NULL THEN
    IF tender.assigned_to IS DISTINCT FROM actor.id AND NOT public.current_employee_is_crm_admin() THEN
      RAISE EXCEPTION 'Zwolnić przetarg może jego opiekun albo administrator.' USING ERRCODE = '42501';
    END IF;
    PERFORM set_config('mavinci.tender_assignment', 'yes', true);
    UPDATE public.tenders SET assigned_to = NULL, assigned_at = NULL, updated_at = now() WHERE id = p_tender_id;
    RETURN;
  END IF;

  SELECT * INTO target FROM public.employees WHERE id = p_employee_id AND is_active = true;
  IF NOT FOUND OR NOT (target.role::text = 'admin' OR target.access_level::text = 'admin'
      OR coalesce(target.permissions, '{}'::text[]) && ARRAY['admin', 'tenders_view']::text[]) THEN
    RAISE EXCEPTION 'Wybrana osoba nie ma dostępu do przetargów.' USING ERRCODE = '22023';
  END IF;
  IF target.id <> actor.id AND NOT public.current_employee_is_crm_admin()
    AND NOT (actor.is_sales_team_manager AND actor.sales_team_id IS NOT NULL
      AND actor.sales_team_id = target.sales_team_id) THEN
    RAISE EXCEPTION 'Możesz przypisać przetarg sobie. Innym osobom przydziela administrator lub kierownik zespołu.'
      USING ERRCODE = '42501';
  END IF;
  IF tender.assigned_to IS NOT NULL AND tender.assigned_to <> target.id AND tender.assigned_to <> actor.id
    AND NOT public.current_employee_is_crm_admin()
    AND NOT (actor.is_sales_team_manager AND actor.sales_team_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Przetarg ma już opiekuna.' USING ERRCODE = '42501';
  END IF;

  PERFORM set_config('mavinci.tender_assignment', 'yes', true);
  UPDATE public.tenders
  SET assigned_to = target.id, assigned_at = now(), is_watched = true,
      status = CASE WHEN status IN ('new', 'reviewing') THEN 'interested' ELSE status END,
      updated_at = now()
  WHERE id = p_tender_id;

  IF target.id <> actor.id THEN
    PERFORM public.enqueue_crm_business_notification(
      'tender-assigned:' || p_tender_id::text || ':' || target.id::text,
      'tender_assigned', 'Przypisano Ci przetarg', left(tender.title, 200), 'info', 'system',
      '/crm/tenders?tender=' || p_tender_id::text, NULL, NULL,
      jsonb_build_object('tender_id', p_tender_id, 'assigned_by', actor.id),
      ARRAY[coalesce(target.auth_user_id, target.id)]);
  END IF;
END;
$$;

-- Przetarg → zapytanie (idempotentne: drugie wywołanie zwraca istniejące zapytanie).
CREATE OR REPLACE FUNCTION public.create_inquiry_from_tender(p_tender_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE actor public.employees%ROWTYPE; tender public.tenders%ROWTYPE; inquiry_id_value uuid;
  follow_up timestamptz;
BEGIN
  IF NOT public.current_employee_can_view_tenders() THEN
    RAISE EXCEPTION 'Brak dostępu do przetargów.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO actor FROM public.employees WHERE id = public.current_crm_employee_id();
  IF NOT (public.current_employee_is_crm_admin()
      OR coalesce(actor.permissions, '{}'::text[]) && ARRAY['inquiries_manage', 'inquiries_manage_own', 'inquiries_manage_all']::text[]) THEN
    RAISE EXCEPTION 'Brak uprawnień do tworzenia zapytań.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO tender FROM public.tenders WHERE id = p_tender_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Nie znaleziono przetargu.'; END IF;

  SELECT id INTO inquiry_id_value FROM public.tasks
  WHERE tender_id = p_tender_id AND is_inquiry = true LIMIT 1;
  PERFORM set_config('mavinci.tender_assignment', 'yes', true);
  IF inquiry_id_value IS NOT NULL THEN
    UPDATE public.tenders SET inquiry_id = inquiry_id_value WHERE id = p_tender_id AND inquiry_id IS NULL;
    RETURN inquiry_id_value;
  END IF;

  IF tender.submission_deadline IS NOT NULL AND tender.submission_deadline < now() THEN
    RAISE EXCEPTION 'Termin składania ofert minął.' USING ERRCODE = '22023';
  END IF;

  follow_up := least(now() + interval '1 day',
    coalesce(tender.submission_deadline - interval '3 days', now() + interval '1 day'));
  IF follow_up < now() THEN follow_up := now() + interval '2 hours'; END IF;

  INSERT INTO public.tasks(
    title, description, priority, status, board_column, order_index, due_date, created_by,
    is_inquiry, is_private, inquiry_stage, inquiry_owner_id, win_probability, estimated_value,
    next_action_at, tender_id, inquiry_details
  ) VALUES (
    left('Przetarg: ' || coalesce(nullif(btrim(tender.title), ''), 'bez tytułu'), 250),
    concat_ws(E'\n',
      'Zamawiający: ' || nullif(btrim(tender.contracting_authority), ''),
      'Termin składania ofert: ' || to_char(tender.submission_deadline AT TIME ZONE 'Europe/Warsaw', 'DD.MM.YYYY HH24:MI'),
      'Wartość szacunkowa: ' || CASE WHEN coalesce(tender.estimated_value, 0) > 0
        THEN to_char(tender.estimated_value, 'FM999G999G999D00') || ' ' || coalesce(tender.currency, 'PLN') END,
      'Ogłoszenie: ' || nullif(btrim(tender.source_url), ''),
      nullif(left(btrim(tender.description), 4000), '')),
    'high', 'todo', 'todo', 0, tender.submission_deadline, actor.id,
    true, false, 'qualified', actor.id, 25, nullif(tender.estimated_value, 0),
    follow_up, tender.id,
    jsonb_build_object(
      'source_kind', 'tender', 'source_name', 'Przetarg', 'source_channel', 'tender',
      'tender_id', tender.id, 'tender_source', tender.source, 'tender_external_id', tender.external_id,
      'tender_url', nullif(tender.source_url, ''),
      'submission_deadline', tender.submission_deadline,
      'client_text', nullif(btrim(tender.contracting_authority), ''),
      'location_text', nullif(btrim(tender.location), ''),
      'scope', nullif(left(btrim(tender.description), 2000), ''),
      'budget', CASE WHEN coalesce(tender.estimated_value, 0) > 0 THEN tender.estimated_value::text END,
      'source_message_content', nullif(left(btrim(tender.title), 500), '')
    )
  ) RETURNING id INTO inquiry_id_value;

  UPDATE public.tenders
  SET inquiry_id = inquiry_id_value,
      assigned_to = coalesce(assigned_to, actor.id),
      assigned_at = coalesce(assigned_at, now()),
      is_watched = true,
      status = CASE WHEN status IN ('new', 'reviewing', 'interested') THEN 'preparing' ELSE status END,
      updated_at = now()
  WHERE id = p_tender_id;

  RETURN inquiry_id_value;
END;
$$;

-- Etap zapytania → status przetargu.
CREATE OR REPLACE FUNCTION public.sync_tender_status_from_inquiry()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE next_status text;
BEGIN
  IF NEW.tender_id IS NULL OR NEW.is_inquiry IS DISTINCT FROM true THEN RETURN NEW; END IF;
  next_status := CASE
    WHEN NEW.inquiry_stage = 'won' THEN 'won'
    WHEN NEW.inquiry_stage = 'lost' THEN 'lost'
    WHEN NEW.inquiry_stage IN ('proposal', 'negotiation') THEN 'submitted'
    WHEN NEW.archived_at IS NOT NULL AND OLD.archived_at IS NULL THEN 'lost'
    ELSE NULL END;
  IF next_status IS NOT NULL THEN
    UPDATE public.tenders SET status = next_status, updated_at = now()
    WHERE id = NEW.tender_id AND status IS DISTINCT FROM next_status
      AND NOT (status IN ('won', 'lost') AND next_status = 'submitted');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_tender_status_from_inquiry ON public.tasks;
CREATE TRIGGER sync_tender_status_from_inquiry
  AFTER UPDATE OF inquiry_stage, archived_at ON public.tasks
  FOR EACH ROW WHEN (NEW.tender_id IS NOT NULL)
  EXECUTE FUNCTION public.sync_tender_status_from_inquiry();

-- Przypomnienia o terminie składania (codziennie, okno powiadomień 08:00–15:00).
CREATE OR REPLACE FUNCTION public.process_tender_deadline_reminders()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE tender record; kind text; recipients uuid[]; sent integer := 0;
BEGIN
  FOR tender IN
    SELECT t.* FROM public.tenders t
    WHERE t.submission_deadline > now()
      AND t.submission_deadline <= now() + interval '7 days'
      AND t.status IN ('interested', 'preparing', 'reviewing', 'new')
      AND (t.assigned_to IS NOT NULL OR t.is_watched OR t.inquiry_id IS NOT NULL)
      AND NOT coalesce(t.is_hidden, false)
  LOOP
    kind := CASE WHEN tender.submission_deadline <= now() + interval '2 days' THEN 'deadline_2d' ELSE 'deadline_7d' END;
    CONTINUE WHEN kind = ANY(tender.deadline_reminders_sent);

    IF tender.assigned_to IS NOT NULL THEN
      SELECT array_agg(coalesce(e.auth_user_id, e.id)) INTO recipients
      FROM public.employees e WHERE e.id = tender.assigned_to AND e.is_active;
    ELSE
      SELECT array_agg(coalesce(e.auth_user_id, e.id)) INTO recipients
      FROM public.employees e
      WHERE e.is_active AND (e.role::text = 'admin' OR e.access_level::text = 'admin'
        OR coalesce(e.permissions, '{}'::text[]) && ARRAY['admin', 'tenders_view']::text[]);
    END IF;

    IF coalesce(cardinality(recipients), 0) > 0 THEN
      PERFORM public.enqueue_crm_business_notification(
        'tender-' || kind || ':' || tender.id::text, 'tender_deadline',
        CASE kind WHEN 'deadline_2d' THEN 'Przetarg: termin za mniej niż 2 dni' ELSE 'Przetarg: termin za tydzień' END,
        left(tender.title, 160) || ' — termin ' ||
          to_char(tender.submission_deadline AT TIME ZONE 'Europe/Warsaw', 'DD.MM.YYYY HH24:MI'),
        CASE kind WHEN 'deadline_2d' THEN 'warning' ELSE 'info' END, 'system',
        coalesce('/crm/inquiries/' || tender.inquiry_id::text, '/crm/tenders?tender=' || tender.id::text),
        NULL, NULL,
        jsonb_build_object('tender_id', tender.id, 'reminder', kind),
        recipients);
      sent := sent + 1;
    END IF;

    UPDATE public.tenders
    SET deadline_reminders_sent = array_append(deadline_reminders_sent, kind)
    WHERE id = tender.id;
  END LOOP;
  RETURN sent;
END;
$$;

REVOKE ALL ON FUNCTION public.current_employee_can_view_tenders(), public.current_employee_is_crm_admin(),
  public.assign_tender(uuid, uuid), public.create_inquiry_from_tender(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_employee_can_view_tenders(), public.current_employee_is_crm_admin(),
  public.assign_tender(uuid, uuid), public.create_inquiry_from_tender(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.process_tender_deadline_reminders(), public.sync_tender_status_from_inquiry(),
  public.guard_tender_assignment() FROM PUBLIC, anon, authenticated;

DO $schedule$
DECLARE job_id bigint;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    FOR job_id IN EXECUTE 'SELECT jobid FROM cron.job WHERE jobname = $1' USING 'tender-deadline-reminders' LOOP
      EXECUTE 'SELECT cron.unschedule($1)' USING job_id;
    END LOOP;
    -- 06:41 UTC = 07:41 (zima) / 08:41 (lato) czasu polskiego; okno powiadomień i tak dostarcza od 08:00.
    EXECUTE 'SELECT cron.schedule($1, $2, $3)'
      USING 'tender-deadline-reminders', '41 6 * * *', 'SELECT public.process_tender_deadline_reminders();';
  ELSE
    RAISE WARNING 'pg_cron niedostępny: przypomnienia o przetargach nie zostały zaplanowane.';
  END IF;
END $schedule$;

NOTIFY pgrst, 'reload schema';
COMMIT;
