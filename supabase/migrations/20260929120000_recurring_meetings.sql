-- Recurring meetings are real occurrences, so existing calendars and privacy
-- policies continue to work. Only these RPCs can change a series template.
BEGIN;
-- Preserve the existing notification categories/types while allowing meetings.
DO $$ DECLARE expression text; BEGIN
  SELECT pg_get_expr(conbin,conrelid) INTO expression FROM pg_constraint
    WHERE conrelid='public.notifications'::regclass AND conname='notifications_category_check';
  IF expression IS NOT NULL THEN
    ALTER TABLE public.notifications DROP CONSTRAINT notifications_category_check;
    EXECUTE 'ALTER TABLE public.notifications ADD CONSTRAINT notifications_category_check CHECK (('||expression||') OR category IN (''meeting'',''meeting_invitation''))';
  END IF;
  SELECT pg_get_expr(conbin,conrelid) INTO expression FROM pg_constraint
    WHERE conrelid='public.notifications'::regclass AND conname='notifications_related_entity_type_check';
  IF expression IS NOT NULL THEN
    ALTER TABLE public.notifications DROP CONSTRAINT notifications_related_entity_type_check;
    EXECUTE 'ALTER TABLE public.notifications ADD CONSTRAINT notifications_related_entity_type_check CHECK (('||expression||') OR related_entity_type=''meeting'')';
  END IF;
END $$;

CREATE TABLE public.meeting_series (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template jsonb NOT NULL,
  participants jsonb NOT NULL,
  interval_days integer NOT NULL CHECK (interval_days IN (1,7,14)),
  timezone text NOT NULL DEFAULT 'Europe/Warsaw' CHECK (timezone = 'Europe/Warsaw'),
  starts_at timestamptz NOT NULL,
  ends_before timestamptz,
  generated_through integer NOT NULL DEFAULT 0,
  created_by uuid NOT NULL REFERENCES public.employees(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.meeting_series ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.meeting_series FROM anon, authenticated;

ALTER TABLE public.meetings
  ADD COLUMN series_id uuid REFERENCES public.meeting_series(id),
  ADD COLUMN recurrence_index integer,
  ADD COLUMN recurrence_days integer NOT NULL DEFAULT 0 CHECK (recurrence_days IN (0,1,7,14)),
  ADD COLUMN server_reminders boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT meeting_series_occurrence_unique UNIQUE (series_id, recurrence_index),
  ADD CONSTRAINT meeting_series_reference_check CHECK (
    (series_id IS NULL AND recurrence_index IS NULL AND recurrence_days = 0)
    OR (series_id IS NOT NULL AND recurrence_index IS NOT NULL AND recurrence_index >= 0 AND recurrence_days > 0)
  );
CREATE INDEX meetings_series_active ON public.meetings(series_id,datetime_start) WHERE deleted_at IS NULL;

-- Internal insert: explicit columns prevent mass assignment of protected fields.
CREATE FUNCTION public.insert_meeting_occurrence(p_data jsonb,p_participants jsonb,p_owner uuid,p_series uuid,p_index integer,p_days integer)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE m public.meetings; mid uuid; participant jsonb;
BEGIN
  m := jsonb_populate_record(NULL::public.meetings,p_data);
  INSERT INTO public.meetings(title,datetime_start,datetime_end,is_all_day,color,notes,location_id,location_text,related_event_ids,alert_1_minutes,alert_2_minutes,alert_critical_minutes,created_by,series_id,recurrence_index,recurrence_days,server_reminders)
  VALUES(m.title,m.datetime_start,m.datetime_end,coalesce(m.is_all_day,false),coalesce(m.color,'#d3bb73'),m.notes,m.location_id,m.location_text,m.related_event_ids,m.alert_1_minutes,m.alert_2_minutes,m.alert_critical_minutes,p_owner,p_series,p_index,p_days,true)
  RETURNING id INTO mid;
  FOR participant IN SELECT DISTINCT value FROM jsonb_array_elements(p_participants) LOOP
    INSERT INTO public.meeting_participants(meeting_id,employee_id,contact_id)
    VALUES(mid,nullif(participant->>'employee_id','')::uuid,nullif(participant->>'contact_id','')::uuid);
  END LOOP;
  RETURN mid;
END $$;
REVOKE ALL ON FUNCTION public.insert_meeting_occurrence(jsonb,jsonb,uuid,uuid,integer,integer) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.materialize_meeting_series(p_series uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE s public.meeting_series; n integer; last_index integer; first_index integer;
  local_start timestamp; local_end timestamp; occurrence_start timestamptz; occurrence_end timestamptz; payload jsonb; roster jsonb;
BEGIN
  PERFORM pg_advisory_xact_lock(84719231);
  SELECT * INTO s FROM public.meeting_series WHERE id=p_series FOR UPDATE;
  IF NOT FOUND OR s.ends_before <= now() THEN RETURN; END IF;
  local_start := s.starts_at AT TIME ZONE s.timezone;
  local_end := (s.template->>'datetime_end')::timestamptz AT TIME ZONE s.timezone;
  -- A removed contact/employee must not prevent other series from advancing.
  SELECT coalesce(jsonb_agg(p),'[]'::jsonb) INTO roster FROM jsonb_array_elements(s.participants) p
    WHERE EXISTS(SELECT 1 FROM public.employees WHERE id=nullif(p->>'employee_id','')::uuid)
       OR EXISTS(SELECT 1 FROM public.contacts WHERE id=nullif(p->>'contact_id','')::uuid);
  -- A rolling six-month window is replenished daily. Skip missed historical dates
  -- after downtime; their reminders must never be replayed.
  first_index := greatest(s.generated_through+1, ((now() AT TIME ZONE s.timezone)::date-local_start::date)/s.interval_days);
  last_index := greatest(0, (((now() AT TIME ZONE s.timezone)::date+180)-local_start::date)/s.interval_days);
  IF first_index > last_index THEN RETURN; END IF;
  FOR n IN first_index..last_index LOOP
    occurrence_start := (local_start + make_interval(days=>n*s.interval_days)) AT TIME ZONE s.timezone;
    IF s.ends_before IS NOT NULL AND occurrence_start >= s.ends_before THEN EXIT; END IF;
    occurrence_end := (local_end + make_interval(days=>n*s.interval_days)) AT TIME ZONE s.timezone;
    -- A start in the spring DST gap moves forward; never produce an end before it.
    IF occurrence_end < occurrence_start THEN
      occurrence_end := occurrence_start + ((s.template->>'datetime_end')::timestamptz-s.starts_at);
    END IF;
    -- Also covers soft-deleted exceptions: a deleted occurrence stays deleted.
    IF NOT EXISTS(SELECT 1 FROM public.meetings WHERE series_id=s.id AND recurrence_index=n) THEN
      payload := s.template || jsonb_build_object('datetime_start',occurrence_start,'datetime_end',occurrence_end);
      IF NOT EXISTS(SELECT 1 FROM public.locations WHERE id=nullif(payload->>'location_id','')::uuid) THEN
        payload := payload || jsonb_build_object('location_id',NULL);
      END IF;
      PERFORM public.insert_meeting_occurrence(payload,roster,s.created_by,s.id,n,s.interval_days);
    END IF;
  END LOOP;
  UPDATE public.meeting_series SET generated_through=last_index WHERE id=s.id;
END $$;
REVOKE ALL ON FUNCTION public.materialize_meeting_series(uuid) FROM PUBLIC,anon,authenticated;

-- Do not send six months of invitations while generating a series. Reminders
-- remain per occurrence; the initial occurrence carries the invitation.
DO $$ DECLARE definition text; BEGIN
  SELECT pg_get_functiondef('public.notify_meeting_participant_assignment()'::regprocedure) INTO definition;
  IF position('IF NEW.employee_id IS NULL THEN' IN definition)=0 THEN RAISE EXCEPTION 'Unexpected meeting invitation function'; END IF;
  definition := replace(definition,'IF NEW.employee_id IS NULL THEN',
    'IF NEW.employee_id IS NULL OR EXISTS (SELECT 1 FROM public.meetings WHERE id=NEW.meeting_id AND recurrence_index > 0) THEN');
  EXECUTE definition;
END $$;

CREATE FUNCTION public.save_meeting(p_data jsonb,p_participants jsonb DEFAULT '[]',p_id uuid DEFAULT NULL,p_recurrence_days integer DEFAULT 0,p_scope text DEFAULT 'single')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE actor public.employees; old public.meetings; m public.meetings; sid uuid; mid uuid; participant jsonb; owner_id uuid; roster jsonb;
BEGIN
  PERFORM pg_advisory_xact_lock(84719231);
  SELECT * INTO actor FROM public.employees e WHERE (e.id=auth.uid() OR e.auth_user_id=auth.uid()) AND e.is_active LIMIT 1;
  IF actor.id IS NULL OR public.current_session_is_seller_portal() THEN RAISE EXCEPTION 'Brak dostępu do spotkań.' USING ERRCODE='42501'; END IF;
  IF p_recurrence_days IS NULL OR p_recurrence_days NOT IN (0,1,7,14) OR p_scope IS NULL OR p_scope NOT IN ('single','future') THEN RAISE EXCEPTION 'Nieprawidłowy cykl spotkania.'; END IF;
  IF p_id IS NULL THEN
    IF NOT coalesce((actor.role='admin' OR actor.access_level='admin' OR coalesce(actor.permissions,'{}') && ARRAY['admin','calendar_view','calendar_manage']),false) THEN RAISE EXCEPTION 'Brak uprawnień do tworzenia spotkań.' USING ERRCODE='42501'; END IF;
    owner_id := actor.id;
    m := jsonb_populate_record(NULL::public.meetings,p_data);
  ELSE
    SELECT * INTO old FROM public.meetings WHERE id=p_id AND deleted_at IS NULL FOR UPDATE;
    IF NOT FOUND OR NOT public.is_current_meeting_participant(p_id) OR NOT coalesce((old.created_by=actor.id OR actor.role='admin' OR actor.access_level='admin' OR coalesce(actor.permissions,'{}') && ARRAY['admin','calendar_manage']),false) THEN RAISE EXCEPTION 'Brak uprawnień do zmiany spotkania.' USING ERRCODE='42501'; END IF;
    owner_id := coalesce(old.created_by,actor.id);
    m := jsonb_populate_record(old,p_data);
    IF old.series_id IS NOT NULL AND p_scope='future' AND old.datetime_start < now() THEN RAISE EXCEPTION 'Aby zmienić cykl, wybierz przyszły termin spotkania.'; END IF;
  END IF;
  IF nullif(btrim(m.title),'') IS NULL OR m.datetime_start IS NULL OR m.datetime_end < m.datetime_start THEN RAISE EXCEPTION 'Podaj tytuł i poprawny termin spotkania.'; END IF;
  IF (p_recurrence_days>0 AND (p_id IS NULL OR old.series_id IS NULL OR p_scope='future')) AND m.datetime_start < now() THEN RAISE EXCEPTION 'Pierwszy termin cyklu musi być w przyszłości.'; END IF;
  IF EXISTS(SELECT 1 FROM unnest(ARRAY[m.alert_1_minutes,m.alert_2_minutes,m.alert_critical_minutes]) v WHERE v<0 OR v>10080) THEN RAISE EXCEPTION 'Przypomnienie można ustawić od 0 minut do 7 dni przed spotkaniem.'; END IF;
  IF jsonb_typeof(coalesce(p_participants,'[]'::jsonb)) <> 'array' OR jsonb_array_length(coalesce(p_participants,'[]'::jsonb))>200 THEN RAISE EXCEPTION 'Nieprawidłowa lista uczestników.'; END IF;
  -- Keep the organizer on the roster: meeting SELECT privacy is participant-only.
  SELECT coalesce(jsonb_agg(DISTINCT value),'[]'::jsonb) INTO roster FROM jsonb_array_elements(coalesce(p_participants,'[]'::jsonb) || jsonb_build_array(jsonb_build_object('employee_id',owner_id)));
  -- Preserve contact participants when mobile sends its employee-only roster.
  IF p_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(roster) p WHERE p->>'contact_id' IS NOT NULL) THEN
    SELECT roster || coalesce(jsonb_agg(jsonb_build_object('contact_id',contact_id)),'[]'::jsonb) INTO roster FROM public.meeting_participants WHERE meeting_id=p_id AND contact_id IS NOT NULL;
  END IF;
  IF old.series_id IS NOT NULL AND p_scope='future' THEN
    UPDATE public.meeting_series SET ends_before=least(coalesce(ends_before,old.datetime_start),old.datetime_start) WHERE id=old.series_id;
    UPDATE public.meetings SET deleted_at=now() WHERE series_id=old.series_id AND recurrence_index>=old.recurrence_index AND id<>p_id AND datetime_start>=now() AND deleted_at IS NULL;
  END IF;
  sid := old.series_id;
  IF old.series_id IS NULL OR p_scope='future' THEN
    sid := NULL;
    IF p_recurrence_days>0 THEN
      INSERT INTO public.meeting_series(template,participants,interval_days,starts_at,created_by)
      VALUES(to_jsonb(m),roster,p_recurrence_days,m.datetime_start,owner_id) RETURNING id INTO sid;
    END IF;
  END IF;
  IF p_id IS NULL THEN
    mid := public.insert_meeting_occurrence(to_jsonb(m),roster,owner_id,sid,CASE WHEN sid IS NOT NULL THEN 0 END,p_recurrence_days);
  ELSE
    mid := p_id;
    UPDATE public.meetings SET title=btrim(m.title),datetime_start=m.datetime_start,datetime_end=m.datetime_end,
      is_all_day=m.is_all_day,color=m.color,notes=m.notes,location_id=m.location_id,location_text=m.location_text,
      related_event_ids=m.related_event_ids,alert_1_minutes=m.alert_1_minutes,alert_2_minutes=m.alert_2_minutes,alert_critical_minutes=m.alert_critical_minutes,
      series_id=sid,recurrence_index=CASE WHEN sid IS NULL THEN NULL WHEN sid=old.series_id THEN old.recurrence_index ELSE 0 END,
      recurrence_days=CASE WHEN sid=old.series_id THEN old.recurrence_days ELSE p_recurrence_days END,server_reminders=true
    WHERE id=mid;
    -- Differential roster update keeps unchanged invitation records intact.
    DELETE FROM public.meeting_participants mp WHERE meeting_id=mid AND NOT EXISTS(
      SELECT 1 FROM jsonb_array_elements(roster) p WHERE nullif(p->>'employee_id','')::uuid=mp.employee_id OR nullif(p->>'contact_id','')::uuid=mp.contact_id);
    FOR participant IN SELECT value FROM jsonb_array_elements(roster) LOOP
      IF NOT EXISTS(SELECT 1 FROM public.meeting_participants WHERE meeting_id=mid AND (employee_id=nullif(participant->>'employee_id','')::uuid OR contact_id=nullif(participant->>'contact_id','')::uuid)) THEN
        INSERT INTO public.meeting_participants(meeting_id,employee_id,contact_id) VALUES(mid,nullif(participant->>'employee_id','')::uuid,nullif(participant->>'contact_id','')::uuid);
      END IF;
    END LOOP;
  END IF;
  IF sid IS NOT NULL THEN PERFORM public.materialize_meeting_series(sid); END IF;
  RETURN jsonb_build_object('id',mid);
END $$;
REVOKE ALL ON FUNCTION public.save_meeting(jsonb,jsonb,uuid,integer,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_meeting(jsonb,jsonb,uuid,integer,text) TO authenticated;

-- Keep the existing creation API compatible with other callers.
CREATE OR REPLACE FUNCTION public.create_private_meeting(p_data jsonb,p_participants jsonb DEFAULT '[]')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  RETURN public.save_meeting(p_data,p_participants,NULL,coalesce((p_data->>'recurrence_days')::integer,0),'single');
END $$;

CREATE FUNCTION public.delete_meeting_occurrences(p_id uuid,p_scope text DEFAULT 'single')
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE actor public.employees; m public.meetings;
BEGIN
  PERFORM pg_advisory_xact_lock(84719231);
  SELECT * INTO actor FROM public.employees e WHERE (e.id=auth.uid() OR e.auth_user_id=auth.uid()) AND e.is_active LIMIT 1;
  SELECT * INTO m FROM public.meetings WHERE id=p_id AND deleted_at IS NULL FOR UPDATE;
  IF actor.id IS NULL OR m.id IS NULL OR public.current_session_is_seller_portal() OR NOT public.is_current_meeting_participant(p_id) OR NOT coalesce((m.created_by=actor.id OR actor.role='admin' OR actor.access_level='admin' OR coalesce(actor.permissions,'{}') && ARRAY['admin','calendar_manage']),false) THEN RAISE EXCEPTION 'Brak uprawnień do usunięcia spotkania.' USING ERRCODE='42501'; END IF;
  IF p_scope IS NULL OR p_scope NOT IN ('single','future') THEN RAISE EXCEPTION 'Nieprawidłowy zakres usuwania.'; END IF;
  IF p_scope='future' AND m.series_id IS NOT NULL THEN
    UPDATE public.meeting_series SET ends_before=least(coalesce(ends_before,greatest(now(),m.datetime_start)),greatest(now(),m.datetime_start)) WHERE id=m.series_id;
    UPDATE public.meetings SET deleted_at=now() WHERE series_id=m.series_id AND recurrence_index>=m.recurrence_index AND datetime_start>=now() AND deleted_at IS NULL;
  ELSE
    UPDATE public.meetings SET deleted_at=now() WHERE id=p_id;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.delete_meeting_occurrences(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.delete_meeting_occurrences(uuid,text) TO authenticated;

CREATE TABLE public.meeting_reminder_deliveries (
  meeting_id uuid NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
  starts_at timestamptz NOT NULL,
  minutes_before integer NOT NULL,
  delivered_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(meeting_id,starts_at,minutes_before)
);
ALTER TABLE public.meeting_reminder_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.meeting_reminder_deliveries FROM anon,authenticated;

CREATE FUNCTION public.process_meeting_reminders()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r record; nid uuid; claimed uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(84719231);
  FOR r IN
    SELECT m.*, a.minutes FROM public.meetings m
    CROSS JOIN LATERAL (SELECT DISTINCT unnest(ARRAY[m.alert_1_minutes,m.alert_2_minutes,m.alert_critical_minutes]) AS minutes) a
    WHERE m.deleted_at IS NULL AND m.server_reminders AND a.minutes IS NOT NULL
      AND m.datetime_start>=now()-interval '1 minute'
      AND m.datetime_start-make_interval(mins=>a.minutes)<=now()
      AND m.datetime_start-make_interval(mins=>a.minutes)>now()-interval '10 minutes'
  LOOP
    INSERT INTO public.meeting_reminder_deliveries(meeting_id,starts_at,minutes_before)
    VALUES(r.id,r.datetime_start,r.minutes) ON CONFLICT DO NOTHING RETURNING meeting_id INTO claimed;
    IF claimed IS NULL THEN CONTINUE; END IF;
    INSERT INTO public.notifications(title,message,type,category,related_entity_type,related_entity_id,action_url,metadata)
    VALUES(CASE WHEN r.minutes=r.alert_critical_minutes THEN 'Pilne przypomnienie: ' ELSE 'Przypomnienie: ' END || r.title,
      format('Spotkanie %s%s',to_char(r.datetime_start AT TIME ZONE 'Europe/Warsaw','DD.MM.YYYY HH24:MI'),CASE WHEN nullif(r.location_text,'') IS NOT NULL THEN ' · '||r.location_text ELSE '' END),
      CASE WHEN r.minutes=r.alert_critical_minutes THEN 'warning' ELSE 'info' END,'meeting','meeting',r.id::text,'/crm/calendar/meeting/'||r.id,
      jsonb_build_object('kind','meeting_reminder','meeting_id',r.id,'series_id',r.series_id,'datetime_start',r.datetime_start,'minutes_before',r.minutes)) RETURNING id INTO nid;
    -- Existing notification_recipients trigger delivers push to mobile devices.
    INSERT INTO public.notification_recipients(notification_id,user_id,is_read)
    SELECT DISTINCT nid,e.id,false FROM public.meeting_participants mp JOIN public.employees e ON e.id=mp.employee_id
    WHERE mp.meeting_id=r.id AND e.is_active ON CONFLICT(notification_id,user_id) DO NOTHING;
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.process_meeting_reminders() FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.refresh_meeting_series()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE sid uuid;
BEGIN
  FOR sid IN SELECT id FROM public.meeting_series WHERE ends_before IS NULL OR ends_before>now() LOOP
    PERFORM public.materialize_meeting_series(sid);
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.refresh_meeting_series() FROM PUBLIC,anon,authenticated;

-- Fail visibly if scheduling is unavailable: never claim recurring reminders
-- are enabled while no server-side scheduler exists.
CREATE EXTENSION IF NOT EXISTS pg_cron;
SELECT cron.schedule('refresh-meeting-series','10 1 * * *','SELECT public.refresh_meeting_series();');
SELECT cron.schedule('process-meeting-reminders','* * * * *','SELECT public.process_meeting_reminders();');
NOTIFY pgrst,'reload schema';
COMMIT;
