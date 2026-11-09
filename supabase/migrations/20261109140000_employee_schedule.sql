-- Plan pracownika: oś czasu zespołu i widok dnia / tygodnia w profilu pracownika
-- ===============================================================================================================
-- Można uruchomić ponownie.
--
-- get_employee_schedule(p_employee_ids, p_from, p_to) — jedna lista pozycji planu pracowników w przedziale:
--   event        — wydarzenie, do którego jest przypisany (bez odrzuconych zaproszeń i anulowanych wydarzeń),
--   phase        — faza wydarzenia, do której jest przypisany,
--   meeting      — spotkanie (uczestnik albo autor),
--   inquiry      — następny kontakt w zapytaniu, które prowadzi (lejek: otwarte zapytania),
--   task         — zadanie przypisane, z terminem (bez zakończonych i anulowanych; prywatne tylko dla siebie),
--   call         — oddzwonienie zaplanowane po rozmowie,
--   absence      — nieobecność (zatwierdzona lub oczekująca).
-- Kto widzi: każdy swój plan; administrator i osoba z „Zarządzanie pracownikami” (employees_manage) — plan
-- każdego pracownika. Pozostałe identyfikatory są pomijane. Przedział najwyżej 400 dni.
-- Pozycje bez godziny (termin zadania o północy, nieobecność, wydarzenie wielodniowe) mają all_day = true.

CREATE OR REPLACE FUNCTION public.get_employee_schedule(p_employee_ids uuid[], p_from timestamptz, p_to timestamptz)
RETURNS TABLE(employee_id uuid, kind text, item_id uuid, title text, subtitle text, starts_at timestamptz,
              ends_at timestamptz, all_day boolean, status text, color text, url text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_viewer uuid := public.sales_employee_id();
  v_all boolean;
  v_ids uuid[];
BEGIN
  PERFORM private.require_crm_employee();
  IF p_from IS NULL OR p_to IS NULL OR p_to <= p_from THEN
    RAISE EXCEPTION 'Podaj poprawny przedział czasu.';
  END IF;
  IF p_to - p_from > interval '400 days' THEN
    RAISE EXCEPTION 'Przedział planu może mieć najwyżej 400 dni.';
  END IF;

  SELECT (e.role = 'admin' OR e.access_level = 'admin'
          OR coalesce(e.permissions, '{}'::text[]) && ARRAY['admin', 'employees_manage'])
    INTO v_all
    FROM public.employees e WHERE e.id = v_viewer AND e.is_active;

  SELECT array_agg(DISTINCT x) INTO v_ids
    FROM unnest(coalesce(p_employee_ids, '{}'::uuid[])) x
   WHERE x = v_viewer OR coalesce(v_all, false);
  IF v_ids IS NULL THEN RETURN; END IF;

  RETURN QUERY
  -- Wydarzenia (przypisanie do zespołu wydarzenia)
  SELECT ea.employee_id, 'event'::text, ev.id, ev.name::text,
         nullif(concat_ws(' · ', l.name, ec.name), '')::text,
         ev.event_date,
         greatest(coalesce(ev.event_end_date, ev.event_date + interval '4 hours'), ev.event_date + interval '30 minutes'),
         (coalesce(ev.event_end_date, ev.event_date) - ev.event_date) >= interval '20 hours',
         coalesce(ea.status, 'accepted')::text,
         coalesce(ec.color, '#3b82f6')::text,
         '/crm/events/' || ev.id::text
    FROM public.employee_assignments ea
    JOIN public.events ev ON ev.id = ea.event_id
    LEFT JOIN public.event_categories ec ON ec.id = ev.category_id
    LEFT JOIN public.locations l ON l.id = ev.location_id
   WHERE ea.employee_id = ANY (v_ids)
     AND coalesce(ea.status, 'accepted') <> 'rejected'
     AND ev.status::text <> 'cancelled'
     AND ev.event_date < p_to
     AND greatest(coalesce(ev.event_end_date, ev.event_date + interval '4 hours'), ev.event_date + interval '30 minutes') > p_from

  UNION ALL
  -- Fazy wydarzeń
  SELECT epa.employee_id, 'phase'::text, epa.id, (ep.name || ' — ' || ev.name)::text,
         nullif(l.name, '')::text,
         ep.start_time, greatest(ep.end_time, ep.start_time + interval '15 minutes'),
         (ep.end_time - ep.start_time) >= interval '20 hours',
         epa.invitation_status::text,
         coalesce(ep.color, ec.color, '#8b5cf6')::text,
         '/crm/events/' || ev.id::text || '?tab=phases'
    FROM public.event_phase_assignments epa
    JOIN public.event_phases ep ON ep.id = epa.phase_id
    JOIN public.events ev ON ev.id = ep.event_id
    LEFT JOIN public.event_categories ec ON ec.id = ev.category_id
    LEFT JOIN public.locations l ON l.id = ev.location_id
   WHERE epa.employee_id = ANY (v_ids)
     AND epa.invitation_status::text <> 'rejected'
     AND ev.status::text <> 'cancelled'
     AND ep.start_time < p_to AND ep.end_time > p_from

  UNION ALL
  -- Spotkania (uczestnik albo autor)
  SELECT who.emp, 'meeting'::text, m.id, coalesce(nullif(btrim(m.title), ''), 'Spotkanie')::text,
         nullif(coalesce(ml.name, m.location_text), '')::text,
         m.datetime_start,
         greatest(coalesce(m.datetime_end, m.datetime_start + interval '1 hour'), m.datetime_start + interval '15 minutes'),
         coalesce(m.is_all_day, false),
         'planned'::text,
         coalesce(nullif(m.color, ''), '#0ea5e9')::text,
         '/crm/meetings?meetingId=' || m.id::text
    FROM public.meetings m
    LEFT JOIN public.locations ml ON ml.id = m.location_id
    CROSS JOIN LATERAL (
      SELECT DISTINCT p.employee_id AS emp FROM public.meeting_participants p
       WHERE p.meeting_id = m.id AND p.employee_id = ANY (v_ids)
      UNION
      SELECT m.created_by WHERE m.created_by = ANY (v_ids)
    ) who
   WHERE m.deleted_at IS NULL
     AND m.datetime_start < p_to
     AND coalesce(m.datetime_end, m.datetime_start + interval '1 hour') > p_from

  UNION ALL
  -- Lejek: następny kontakt w otwartych zapytaniach prowadzonych przez pracownika
  SELECT t.inquiry_owner_id, 'inquiry'::text, t.id, ('Kontakt: ' || coalesce(nullif(btrim(t.title), ''), 'zapytanie'))::text,
         nullif(t.inquiry_stage, '')::text,
         CASE WHEN (t.next_action_at AT TIME ZONE 'Europe/Warsaw')::time = time '00:00'
              THEN (date_trunc('day', t.next_action_at AT TIME ZONE 'Europe/Warsaw')) AT TIME ZONE 'Europe/Warsaw'
              ELSE t.next_action_at END,
         CASE WHEN (t.next_action_at AT TIME ZONE 'Europe/Warsaw')::time = time '00:00'
              THEN (date_trunc('day', t.next_action_at AT TIME ZONE 'Europe/Warsaw') + interval '1 day') AT TIME ZONE 'Europe/Warsaw'
              ELSE t.next_action_at + interval '30 minutes' END,
         (t.next_action_at AT TIME ZONE 'Europe/Warsaw')::time = time '00:00',
         coalesce(t.inquiry_stage, 'new')::text,
         '#f59e0b'::text,
         '/crm/inquiries/' || t.id::text
    FROM public.tasks t
   WHERE t.is_inquiry AND t.inquiry_owner_id = ANY (v_ids)
     AND coalesce(t.inquiry_stage, 'new') NOT IN ('won', 'lost')
     AND t.deleted_at IS NULL AND t.archived_at IS NULL
     AND t.next_action_at IS NOT NULL
     AND t.next_action_at < p_to AND t.next_action_at + interval '30 minutes' > p_from

  UNION ALL
  -- Zadania z terminem (przypisane; prywatne tylko we własnym planie)
  SELECT who.emp, 'task'::text, t.id, coalesce(nullif(btrim(t.title), ''), 'Zadanie')::text,
         CASE t.priority::text WHEN 'urgent' THEN 'Pilne' WHEN 'high' THEN 'Wysoki priorytet' END,
         CASE WHEN (t.due_date AT TIME ZONE 'Europe/Warsaw')::time IN (time '00:00', time '23:59', time '23:59:59')
              THEN (date_trunc('day', t.due_date AT TIME ZONE 'Europe/Warsaw')) AT TIME ZONE 'Europe/Warsaw'
              ELSE t.due_date - interval '30 minutes' END,
         CASE WHEN (t.due_date AT TIME ZONE 'Europe/Warsaw')::time IN (time '00:00', time '23:59', time '23:59:59')
              THEN (date_trunc('day', t.due_date AT TIME ZONE 'Europe/Warsaw') + interval '1 day') AT TIME ZONE 'Europe/Warsaw'
              ELSE t.due_date END,
         (t.due_date AT TIME ZONE 'Europe/Warsaw')::time IN (time '00:00', time '23:59', time '23:59:59'),
         t.status::text,
         CASE t.priority::text WHEN 'urgent' THEN '#ef4444' WHEN 'high' THEN '#f97316' ELSE '#64748b' END,
         '/crm/tasks/' || t.id::text
    FROM public.tasks t
    CROSS JOIN LATERAL (
      SELECT t.assigned_to AS emp WHERE t.assigned_to = ANY (v_ids)
      UNION
      SELECT a.employee_id FROM public.task_assignees a WHERE a.task_id = t.id AND a.employee_id = ANY (v_ids)
      UNION
      SELECT t.owner_id WHERE coalesce(t.is_private, false) AND t.owner_id = ANY (v_ids)
    ) who
   WHERE NOT coalesce(t.is_inquiry, false)
     AND t.deleted_at IS NULL AND t.archived_at IS NULL
     AND t.status::text NOT IN ('completed', 'cancelled')
     AND t.due_date IS NOT NULL
     AND (NOT coalesce(t.is_private, false) OR who.emp = v_viewer)
     AND t.due_date - interval '1 day' < p_to AND t.due_date + interval '1 day' > p_from

  UNION ALL
  -- Oddzwonienia zaplanowane po rozmowie
  SELECT c.created_by, 'call'::text, c.id,
         ('Oddzwonić: ' || coalesce(nullif(btrim(concat_ws(' ', ct.first_name, ct.last_name)), ''), c.phone_number, 'kontakt'))::text,
         nullif(c.notes, '')::text,
         c.next_action_at, c.next_action_at + interval '15 minutes', false,
         coalesce(c.outcome, c.status)::text,
         '#22c55e'::text,
         CASE WHEN c.contact_id IS NOT NULL THEN '/crm/contacts/' || c.contact_id::text
              WHEN c.inquiry_id IS NOT NULL THEN '/crm/inquiries/' || c.inquiry_id::text END
    FROM public.crm_call_activities c
    LEFT JOIN public.contacts ct ON ct.id = c.contact_id
   WHERE c.created_by = ANY (v_ids)
     AND c.next_action_at IS NOT NULL
     AND c.next_action_at < p_to AND c.next_action_at + interval '15 minutes' > p_from

  UNION ALL
  -- Nieobecności
  SELECT ab.employee_id, 'absence'::text, ab.id,
         (CASE ab.absence_type WHEN 'vacation' THEN 'Urlop wypoczynkowy' WHEN 'sick_leave' THEN 'Zwolnienie lekarskie'
            WHEN 'unpaid_leave' THEN 'Urlop bezpłatny' WHEN 'training' THEN 'Szkolenie' WHEN 'remote_work' THEN 'Praca zdalna'
            ELSE 'Nieobecność' END)::text,
         CASE ab.approval_status::text WHEN 'pending' THEN 'Czeka na akceptację' END,
         ab.start_date, greatest(ab.end_date, ab.start_date + interval '1 hour'),
         coalesce(ab.all_day, true),
         ab.approval_status::text,
         (CASE ab.absence_type WHEN 'vacation' THEN '#10b981' WHEN 'sick_leave' THEN '#ef4444' WHEN 'unpaid_leave' THEN '#6b7280'
            WHEN 'training' THEN '#06b6d4' WHEN 'remote_work' THEN '#14b8a6' ELSE '#8b5cf6' END)::text,
         NULL::text
    FROM public.employee_absences ab
   WHERE ab.employee_id = ANY (v_ids)
     AND ab.approval_status::text IN ('approved', 'pending')
     AND ab.start_date < p_to AND ab.end_date > p_from;
END $$;

REVOKE ALL ON FUNCTION public.get_employee_schedule(uuid[], timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_employee_schedule(uuid[], timestamptz, timestamptz) TO authenticated;
