-- Spotkania: prywatne (widoczne WYŁĄCZNIE dla autora i uczestników — także administrator ich nie widzi),
-- status spotkania (wstępne / potwierdzone / odwołane) i odpowiedzi uczestników (oczekuje / przyjmuję / może / odrzucam),
-- jak zaproszenia w Teams. Migracja jest idempotentna — można ją uruchomić ponownie.

begin;

-- 1. Pola -----------------------------------------------------------------------------------------------
alter table public.meetings add column if not exists is_private boolean not null default false;
alter table public.meetings add column if not exists status text not null default 'confirmed';
alter table public.meetings drop constraint if exists meetings_status_check;
alter table public.meetings add constraint meetings_status_check check (status in ('tentative', 'confirmed', 'cancelled'));

do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'meeting_participants' and column_name = 'response') then
    -- Dotychczasowe zaproszenia działały bez odpowiedzi — traktujemy je jak przyjęte; nowe czekają na odpowiedź.
    alter table public.meeting_participants add column response text not null default 'accepted';
    alter table public.meeting_participants alter column response set default 'pending';
  end if;
end $$;
alter table public.meeting_participants add column if not exists responded_at timestamptz;
alter table public.meeting_participants drop constraint if exists meeting_participants_response_check;
alter table public.meeting_participants add constraint meeting_participants_response_check check (response in ('pending', 'accepted', 'tentative', 'declined'));

create index if not exists meetings_private_idx on public.meetings (is_private) where is_private;

-- Autor spotkania jest jego uczestnikiem z odpowiedzią „przyjmuję”.
create or replace function public.meeting_participant_default_response()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if new.employee_id is not null and exists (select 1 from public.meetings m where m.id = new.meeting_id and m.created_by = new.employee_id) then
    new.response := 'accepted';
    new.responded_at := coalesce(new.responded_at, now());
  end if;
  return new;
end $$;
drop trigger if exists meeting_participant_default_response on public.meeting_participants;
create trigger meeting_participant_default_response before insert on public.meeting_participants
  for each row execute function public.meeting_participant_default_response();

-- Starsze spotkania bez autora na liście uczestników — bez tego autor nie mógł ich edytować.
insert into public.meeting_participants (meeting_id, employee_id)
select m.id, m.created_by
  from public.meetings m
 where m.deleted_at is null and m.created_by is not null
   and exists (select 1 from public.employees e where e.id = m.created_by)
   and not exists (select 1 from public.meeting_participants p where p.meeting_id = m.id and p.employee_id = m.created_by);

-- 2. Widoczność: prywatne spotkanie widzą tylko autor i uczestnicy -------------------------------------------
-- Funkcja z uprawnieniami właściciela — bez rekursji polityk meetings ↔ meeting_participants.
create or replace function public.meeting_visible_to_staff(p_meeting_id uuid)
returns boolean language sql stable security definer set search_path = pg_catalog, public as $$
  select not coalesce((select m.is_private from public.meetings m where m.id = p_meeting_id), false)
$$;
revoke all on function public.meeting_visible_to_staff(uuid) from public;
grant execute on function public.meeting_visible_to_staff(uuid) to authenticated;

drop policy if exists "Users can view meetings" on public.meetings;
create policy "Users can view meetings" on public.meetings for select to authenticated using (
  deleted_at is null and (
    created_by = auth.uid()
    or (not is_private and exists (select 1 from public.employees emp where emp.id = auth.uid()
      and (emp.role = 'admin' or 'admin' = any (emp.permissions) or 'calendar_manage' = any (emp.permissions) or 'events_manage' = any (emp.permissions))))
  )
);

drop policy if exists "Users can view meetings based on permissions" on public.meetings;
create policy "Users can view meetings based on permissions" on public.meetings for select to authenticated using (
  deleted_at is null and (
    created_by = auth.uid()
    or exists (select 1 from public.meeting_participants mp where mp.meeting_id = meetings.id and mp.employee_id = auth.uid())
    or (not is_private and exists (select 1 from public.employees emp where emp.id = auth.uid()
      and (emp.role = 'admin' or 'admin' = any (emp.permissions) or 'calendar_manage' = any (emp.permissions) or 'events_manage' = any (emp.permissions))))
  )
);

drop policy if exists "Users can update meetings" on public.meetings;
create policy "Users can update meetings" on public.meetings for update to authenticated using (
  deleted_at is null and (
    created_by = auth.uid()
    or (not is_private and exists (select 1 from public.employees emp where emp.id = auth.uid()
      and (emp.role = 'admin' or 'calendar_manage' = any (emp.permissions))))
  )
) with check (
  created_by = auth.uid()
  or (not is_private and exists (select 1 from public.employees emp where emp.id = auth.uid()
    and (emp.role = 'admin' or 'calendar_manage' = any (emp.permissions))))
);

drop policy if exists "Admins can soft-delete any meeting" on public.meetings;
create policy "Admins can soft-delete any meeting" on public.meetings for update to authenticated
  using (public.is_admin(auth.uid()) and not is_private)
  with check (public.is_admin(auth.uid()) and not is_private);

drop policy if exists "Users can delete meetings" on public.meetings;
create policy "Users can delete meetings" on public.meetings for delete to authenticated using (
  not is_private and exists (select 1 from public.employees emp where emp.id = auth.uid()
    and (emp.role = 'admin' or 'calendar_manage' = any (emp.permissions)))
);

drop policy if exists "Users can view meeting participants" on public.meeting_participants;
create policy "Users can view meeting participants" on public.meeting_participants for select to authenticated using (
  employee_id = auth.uid() or contact_id = auth.uid()
  or (public.meeting_visible_to_staff(meeting_id) and exists (select 1 from public.employees emp where emp.id = auth.uid()
    and (emp.role = 'admin' or 'admin' = any (emp.permissions) or 'calendar_manage' = any (emp.permissions) or 'calendar_view' = any (emp.permissions))))
);

drop policy if exists "Users can update meeting participants" on public.meeting_participants;
create policy "Users can update meeting participants" on public.meeting_participants for update to authenticated using (
  public.meeting_visible_to_staff(meeting_id) and exists (select 1 from public.employees emp where emp.id = auth.uid()
    and (emp.role = 'admin' or 'calendar_manage' = any (emp.permissions)))
);

drop policy if exists "Users can delete meeting participants" on public.meeting_participants;
create policy "Users can delete meeting participants" on public.meeting_participants for delete to authenticated using (
  public.meeting_visible_to_staff(meeting_id) and exists (select 1 from public.employees emp where emp.id = auth.uid()
    and (emp.role = 'admin' or 'calendar_manage' = any (emp.permissions)))
);

drop policy if exists "Users can add meeting participants" on public.meeting_participants;
create policy "Users can add meeting participants" on public.meeting_participants for insert to authenticated with check (
  (public.meeting_visible_to_staff(meeting_id) or public.is_meeting_creator(meeting_id))
  and exists (select 1 from public.employees emp where emp.id = auth.uid()
    and (emp.role = 'admin' or 'calendar_manage' = any (emp.permissions) or 'calendar_view' = any (emp.permissions)))
);

-- 3. Zapis spotkania: prywatność i status; zmiana terminu prosi uczestników o ponowną odpowiedź -------------------
create or replace function public.insert_meeting_occurrence(p_data jsonb, p_participants jsonb, p_owner uuid, p_series uuid, p_index integer, p_days integer)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'pg_catalog', 'public'
as $function$
DECLARE m public.meetings; mid uuid; participant jsonb;
BEGIN
 m:=jsonb_populate_record(NULL::public.meetings,p_data);
 INSERT INTO public.meetings(title,datetime_start,datetime_end,is_all_day,color,notes,location_id,location_text,related_event_ids,alert_1_minutes,alert_2_minutes,alert_critical_minutes,created_by,series_id,recurrence_index,recurrence_days,server_reminders,is_private,status)
 VALUES(m.title,m.datetime_start,m.datetime_end,coalesce(m.is_all_day,false),coalesce(m.color,'#d3bb73'),m.notes,m.location_id,m.location_text,m.related_event_ids,m.alert_1_minutes,m.alert_2_minutes,m.alert_critical_minutes,p_owner,p_series,p_index,p_days,true,coalesce(m.is_private,false),coalesce(m.status,'confirmed')) RETURNING id INTO mid;
 FOR participant IN SELECT DISTINCT value FROM jsonb_array_elements(p_participants) LOOP
  INSERT INTO public.meeting_participants(meeting_id,employee_id,contact_id) VALUES(mid,nullif(participant->>'employee_id','')::uuid,nullif(participant->>'contact_id','')::uuid);
 END LOOP;
 RETURN mid;
END $function$;

create or replace function public.save_meeting(p_data jsonb, p_participants jsonb default '[]'::jsonb, p_id uuid default null::uuid, p_recurrence_days integer default 0, p_scope text default 'single'::text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'pg_catalog', 'public'
as $function$
DECLARE actor public.employees; old public.meetings; m public.meetings; sid uuid; mid uuid; participant jsonb; owner_id uuid; roster jsonb;
BEGIN
 PERFORM pg_advisory_xact_lock(84719231);
 SELECT * INTO actor FROM public.employees e WHERE (e.id=auth.uid() OR e.auth_user_id=auth.uid()) AND e.is_active LIMIT 1;
 IF actor.id IS NULL OR public.current_session_is_seller_portal() THEN RAISE EXCEPTION 'Brak dostępu do spotkań.' USING ERRCODE='42501'; END IF;
 IF p_recurrence_days IS NULL OR p_recurrence_days NOT IN (0,1,7,14) OR p_scope IS NULL OR p_scope NOT IN ('single','future') THEN RAISE EXCEPTION 'Nieprawidłowy cykl spotkania.'; END IF;
 IF p_id IS NULL THEN
  IF NOT coalesce((actor.role='admin' OR actor.access_level='admin' OR coalesce(actor.permissions,'{}') && ARRAY['admin','calendar_view','calendar_manage']),false) THEN RAISE EXCEPTION 'Brak uprawnień do tworzenia spotkań.' USING ERRCODE='42501'; END IF;
  owner_id:=actor.id; m:=jsonb_populate_record(NULL::public.meetings,p_data);
 ELSE
  SELECT * INTO old FROM public.meetings WHERE id=p_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND OR NOT public.is_current_meeting_participant(p_id) OR NOT coalesce((old.created_by=actor.id OR actor.role='admin' OR actor.access_level='admin' OR coalesce(actor.permissions,'{}') && ARRAY['admin','calendar_manage']),false) THEN RAISE EXCEPTION 'Brak uprawnień do zmiany spotkania.' USING ERRCODE='42501'; END IF;
  owner_id:=coalesce(old.created_by,actor.id); m:=jsonb_populate_record(old,p_data);
  IF old.series_id IS NOT NULL AND p_scope='future' AND old.datetime_start<now() THEN RAISE EXCEPTION 'Aby zmienić cykl, wybierz przyszły termin spotkania.'; END IF;
 END IF;
 IF nullif(btrim(m.title),'') IS NULL OR m.datetime_start IS NULL OR m.datetime_end<m.datetime_start THEN RAISE EXCEPTION 'Podaj tytuł i poprawny termin spotkania.'; END IF;
 IF coalesce(m.status,'confirmed') NOT IN ('tentative','confirmed','cancelled') THEN RAISE EXCEPTION 'Nieprawidłowy status spotkania.'; END IF;
 IF (p_recurrence_days>0 AND (p_id IS NULL OR old.series_id IS NULL OR p_scope='future')) AND m.datetime_start<now() THEN RAISE EXCEPTION 'Pierwszy termin cyklu musi być w przyszłości.'; END IF;
 IF EXISTS(SELECT 1 FROM unnest(ARRAY[m.alert_1_minutes,m.alert_2_minutes,m.alert_critical_minutes]) v WHERE v<0 OR v>10080) THEN RAISE EXCEPTION 'Przypomnienie można ustawić od 0 minut do 7 dni przed spotkaniem.'; END IF;
 IF jsonb_typeof(coalesce(p_participants,'[]'::jsonb))<>'array' OR jsonb_array_length(coalesce(p_participants,'[]'::jsonb))>200 THEN RAISE EXCEPTION 'Nieprawidłowa lista uczestników.'; END IF;
 SELECT coalesce(jsonb_agg(DISTINCT value),'[]'::jsonb) INTO roster FROM jsonb_array_elements(coalesce(p_participants,'[]'::jsonb)||jsonb_build_array(jsonb_build_object('employee_id',owner_id)));
 IF p_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(roster) p WHERE p->>'contact_id' IS NOT NULL) THEN
  SELECT roster||coalesce(jsonb_agg(jsonb_build_object('contact_id',contact_id)),'[]'::jsonb) INTO roster FROM public.meeting_participants WHERE meeting_id=p_id AND contact_id IS NOT NULL;
 END IF;
 IF old.series_id IS NOT NULL AND p_scope='future' THEN
  UPDATE public.meeting_series SET ends_before=least(coalesce(ends_before,old.datetime_start),old.datetime_start) WHERE id=old.series_id;
  UPDATE public.meetings SET deleted_at=now() WHERE series_id=old.series_id AND recurrence_index>=old.recurrence_index AND id<>p_id AND datetime_start>=now() AND deleted_at IS NULL;
 END IF;
 sid:=old.series_id;
 IF old.series_id IS NULL OR p_scope='future' THEN
  sid:=NULL;
  IF p_recurrence_days>0 THEN
   INSERT INTO public.meeting_series(template,participants,interval_days,starts_at,created_by) VALUES(to_jsonb(m),roster,p_recurrence_days,m.datetime_start,owner_id) RETURNING id INTO sid;
  END IF;
 END IF;
 IF p_id IS NULL THEN
  mid:=public.insert_meeting_occurrence(to_jsonb(m),roster,owner_id,sid,CASE WHEN sid IS NOT NULL THEN 0 END,p_recurrence_days);
 ELSE
  mid:=p_id;
  UPDATE public.meetings SET title=btrim(m.title),datetime_start=m.datetime_start,datetime_end=m.datetime_end,
   is_all_day=m.is_all_day,color=m.color,notes=m.notes,location_id=m.location_id,location_text=m.location_text,
   related_event_ids=m.related_event_ids,alert_1_minutes=m.alert_1_minutes,alert_2_minutes=m.alert_2_minutes,alert_critical_minutes=m.alert_critical_minutes,
   is_private=coalesce(m.is_private,false),status=coalesce(m.status,'confirmed'),
   series_id=sid,recurrence_index=CASE WHEN sid IS NULL THEN NULL WHEN sid=old.series_id THEN old.recurrence_index ELSE 0 END,
   recurrence_days=CASE WHEN sid=old.series_id THEN old.recurrence_days ELSE p_recurrence_days END,server_reminders=true WHERE id=mid;
  DELETE FROM public.meeting_participants mp WHERE meeting_id=mid AND NOT EXISTS(
   SELECT 1 FROM jsonb_array_elements(roster) p WHERE nullif(p->>'employee_id','')::uuid=mp.employee_id OR nullif(p->>'contact_id','')::uuid=mp.contact_id);
  FOR participant IN SELECT value FROM jsonb_array_elements(roster) LOOP
   IF NOT EXISTS(SELECT 1 FROM public.meeting_participants WHERE meeting_id=mid AND (employee_id=nullif(participant->>'employee_id','')::uuid OR contact_id=nullif(participant->>'contact_id','')::uuid)) THEN
    INSERT INTO public.meeting_participants(meeting_id,employee_id,contact_id) VALUES(mid,nullif(participant->>'employee_id','')::uuid,nullif(participant->>'contact_id','')::uuid);
   END IF;
  END LOOP;
  -- Nowy termin: uczestnicy odpowiadają ponownie (jak w Teams); autor pozostaje „przyjmuję”.
  IF old.datetime_start IS DISTINCT FROM m.datetime_start OR old.datetime_end IS DISTINCT FROM m.datetime_end THEN
   UPDATE public.meeting_participants SET response='pending', responded_at=NULL
    WHERE meeting_id=mid AND employee_id IS NOT NULL AND employee_id IS DISTINCT FROM owner_id AND response<>'pending';
  END IF;
 END IF;
 IF sid IS NOT NULL THEN PERFORM public.materialize_meeting_series(sid); END IF;
 RETURN jsonb_build_object('id',mid);
END $function$;

-- 4. Odpowiedź uczestnika (przyjmuję / może / odrzucam) z powiadomieniem dla autora --------------------------------
create or replace function public.respond_to_meeting(p_meeting_id uuid, p_response text)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare actor public.employees; m public.meetings; changed integer; nid uuid;
begin
  if p_response is null or p_response not in ('accepted', 'tentative', 'declined') then raise exception 'Nieprawidłowa odpowiedź.'; end if;
  select * into actor from public.employees e where (e.id = auth.uid() or e.auth_user_id = auth.uid()) and e.is_active limit 1;
  if actor.id is null or public.current_session_is_seller_portal() then raise exception 'Brak dostępu do spotkań.' using errcode = '42501'; end if;
  select * into m from public.meetings where id = p_meeting_id and deleted_at is null;
  if m.id is null then raise exception 'Spotkanie nie istnieje.' using errcode = '42501'; end if;
  update public.meeting_participants set response = p_response, responded_at = now()
   where meeting_id = p_meeting_id and employee_id = actor.id and response is distinct from p_response;
  get diagnostics changed = row_count;
  if changed = 0 and not exists (select 1 from public.meeting_participants where meeting_id = p_meeting_id and employee_id = actor.id) then
    raise exception 'Nie jesteś uczestnikiem tego spotkania.' using errcode = '42501';
  end if;
  if changed > 0 and m.created_by is not null and m.created_by <> actor.id then
    insert into public.notifications(title, message, type, category, related_entity_type, related_entity_id, action_url, metadata)
    values ('Odpowiedź na spotkanie: ' || m.title,
            btrim(coalesce(actor.name, '') || ' ' || coalesce(actor.surname, '')) || ' — ' ||
              case p_response when 'accepted' then 'przyjmuje' when 'tentative' then 'może będzie' else 'odrzuca' end ||
              ' (' || to_char(m.datetime_start at time zone 'Europe/Warsaw', 'DD.MM.YYYY HH24:MI') || ')',
            case p_response when 'declined' then 'warning' else 'info' end, 'meeting', 'meeting', m.id::text,
            '/crm/meetings?meetingId=' || m.id,
            jsonb_build_object('kind', 'meeting_response', 'meeting_id', m.id, 'employee_id', actor.id, 'response', p_response))
    returning id into nid;
    insert into public.notification_recipients(notification_id, user_id, is_read) values (nid, m.created_by, false)
      on conflict (notification_id, user_id) do nothing;
  end if;
  return jsonb_build_object('meeting_id', p_meeting_id, 'response', p_response);
end $$;
revoke all on function public.respond_to_meeting(uuid, text) from public;
grant execute on function public.respond_to_meeting(uuid, text) to authenticated;

-- 5. Przypomnienia: bez odwołanych spotkań i bez osób, które odrzuciły ---------------------------------------
create or replace function public.process_meeting_reminders()
 returns void
 language plpgsql
 security definer
 set search_path to 'pg_catalog', 'public'
as $function$
DECLARE r record; nid uuid; claimed uuid;
BEGIN
 PERFORM pg_advisory_xact_lock(84719231);
 FOR r IN
  SELECT m.*,a.minutes FROM public.meetings m
  CROSS JOIN LATERAL (SELECT DISTINCT unnest(ARRAY[m.alert_1_minutes,m.alert_2_minutes,m.alert_critical_minutes]) AS minutes) a
  WHERE m.deleted_at IS NULL AND m.server_reminders AND a.minutes IS NOT NULL AND m.status<>'cancelled'
   AND m.datetime_start>=now()-interval '1 minute'
   AND m.datetime_start-make_interval(mins=>a.minutes)<=now()
   AND m.datetime_start-make_interval(mins=>a.minutes)>now()-interval '10 minutes'
 LOOP
  INSERT INTO public.meeting_reminder_deliveries(meeting_id,starts_at,minutes_before) VALUES(r.id,r.datetime_start,r.minutes) ON CONFLICT DO NOTHING RETURNING meeting_id INTO claimed;
  IF claimed IS NULL THEN CONTINUE; END IF;
  INSERT INTO public.notifications(title,message,type,category,related_entity_type,related_entity_id,action_url,metadata)
  VALUES(CASE WHEN r.minutes=r.alert_critical_minutes THEN 'Pilne przypomnienie: ' ELSE 'Przypomnienie: ' END||r.title,
   format('Spotkanie %s%s',to_char(r.datetime_start AT TIME ZONE 'Europe/Warsaw','DD.MM.YYYY HH24:MI'),CASE WHEN nullif(r.location_text,'') IS NOT NULL THEN ' · '||r.location_text ELSE '' END),
   CASE WHEN r.minutes=r.alert_critical_minutes THEN 'warning' ELSE 'info' END,'meeting','meeting',r.id::text,'/crm/calendar/meeting/'||r.id,
   jsonb_build_object('kind','meeting_reminder','meeting_id',r.id,'series_id',r.series_id,'datetime_start',r.datetime_start,'minutes_before',r.minutes)) RETURNING id INTO nid;
  INSERT INTO public.notification_recipients(notification_id,user_id,is_read)
  SELECT DISTINCT nid,e.id,false FROM public.meeting_participants mp JOIN public.employees e ON e.id=mp.employee_id
  WHERE mp.meeting_id=r.id AND e.is_active AND mp.response<>'declined' ON CONFLICT(notification_id,user_id) DO NOTHING;
 END LOOP;
END $function$;

-- 6. Plan dnia (get_employee_schedule): bez odwołanych, bez odrzuconych, prywatne innych osób niewidoczne -----------
do $$
declare d text; n text;
begin
  d := pg_get_functiondef('public.get_employee_schedule(uuid[],timestamptz,timestamptz)'::regprocedure);
  if strpos(d, 'm.status <> ''cancelled''') > 0 then return; end if;
  n := replace(d, $a$'planned'::text,
         coalesce(nullif(m.color, ''), '#0ea5e9')::text$a$, $b$(CASE WHEN m.status = 'tentative' THEN 'tentative' ELSE 'planned' END)::text,
         coalesce(nullif(m.color, ''), '#0ea5e9')::text$b$);
  if n = d then raise exception 'get_employee_schedule: nie znaleziono statusu spotkań — sprawdź definicję funkcji.'; end if;
  d := n;
  n := replace(d, $a$   WHERE m.deleted_at IS NULL
     AND m.datetime_start < p_to$a$, $b$   WHERE m.deleted_at IS NULL
     AND m.status <> 'cancelled'
     AND (NOT m.is_private OR m.created_by = v_viewer
          OR EXISTS (SELECT 1 FROM public.meeting_participants vp WHERE vp.meeting_id = m.id AND vp.employee_id = v_viewer))
     AND NOT EXISTS (SELECT 1 FROM public.meeting_participants dp
                      WHERE dp.meeting_id = m.id AND dp.employee_id = who.emp AND dp.response = 'declined'
                        AND m.created_by IS DISTINCT FROM who.emp)
     AND m.datetime_start < p_to$b$);
  if n = d then raise exception 'get_employee_schedule: nie znaleziono warunków spotkań — sprawdź definicję funkcji.'; end if;
  execute n;
end $$;

commit;
