-- Spotkania: powiadomienia o zmianach (docs/meeting-notifications.md).
--
-- 1. Edycja spotkania (CRM, Mac, telefon — `save_meeting` albo zapis wprost) wysyła uczestnikom powiadomienie w CRM,
--    na Macu i push na telefon/tablet, z nazwiskiem autora zmiany (on sam powiadomienia nie dostaje):
--    • „Zmiana terminu” — nowy i poprzedni termin; kto przyjął zaproszenie (albo „może”), ma odpowiedź wycofaną i prośbę
--      o ponowne potwierdzenie, kto odrzucił albo nie odpowiedział — prośbę o odpowiedź; organizator — tylko informację;
--    • „Spotkanie odwołane” / „Spotkanie przywrócone”;
--    • „Zmiany w spotkaniu” — lista zmian: tytuł, miejsce, notatki, status (wstępne / potwierdzone), powtarzanie.
--    Odnośnik `/crm/meetings?meetingId=…` otwiera szczegóły spotkania w CRM, na Macu i w aplikacji na telefon.
-- 2. Nowy termin zeruje odpowiedzi uczestników (poza organizatorem i autorem zmiany) — dotąd robiło to `save_meeting`,
--    teraz wyzwalacz: działa przy każdym zapisie terminu, a treść powiadomienia wie, kto wcześniej przyjął zaproszenie.
-- Wyzwalacz jest odroczony do zatwierdzenia transakcji, więc widzi ostateczną listę uczestników: nowo dodani dostają tylko
-- zaproszenie (`notify_meeting_participant_assignment`), usunięci — nic. Zapis wycofany (tryb testowy) niczego nie wysyła.
-- Błąd w treści powiadomienia nie blokuje zapisu spotkania (ostrzeżenie w logu bazy).

-- Termin po polsku, czas polski: „27.11.2026, 10:00–11:30”, „27.11.2026 (cały dzień)”.
create or replace function public.meeting_when_label(p_start timestamptz, p_end timestamptz, p_all_day boolean)
returns text
language sql
stable
set search_path to 'pg_catalog', 'public'
as $function$
  select case
    when p_start is null then 'bez terminu'
    when coalesce(p_all_day, false) then
      case
        when p_end is not null and (p_end at time zone 'Europe/Warsaw')::date > (p_start at time zone 'Europe/Warsaw')::date
          then to_char(p_start at time zone 'Europe/Warsaw', 'DD.MM.YYYY') || ' – '
            || to_char(p_end at time zone 'Europe/Warsaw', 'DD.MM.YYYY') || ' (cały dzień)'
        else to_char(p_start at time zone 'Europe/Warsaw', 'DD.MM.YYYY') || ' (cały dzień)'
      end
    when p_end is null then to_char(p_start at time zone 'Europe/Warsaw', 'DD.MM.YYYY, HH24:MI')
    when (p_end at time zone 'Europe/Warsaw')::date = (p_start at time zone 'Europe/Warsaw')::date
      then to_char(p_start at time zone 'Europe/Warsaw', 'DD.MM.YYYY, HH24:MI') || '–' || to_char(p_end at time zone 'Europe/Warsaw', 'HH24:MI')
    else to_char(p_start at time zone 'Europe/Warsaw', 'DD.MM.YYYY, HH24:MI') || ' – '
      || to_char(p_end at time zone 'Europe/Warsaw', 'DD.MM.YYYY, HH24:MI')
  end
$function$;

revoke all on function public.meeting_when_label(timestamptz, timestamptz, boolean) from public, anon;
grant execute on function public.meeting_when_label(timestamptz, timestamptz, boolean) to authenticated, service_role;

create or replace function public.notify_meeting_changes()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  actor public.employees;
  v_owner uuid := new.created_by;
  v_title_text text := btrim(coalesce(new.title, ''));
  v_moved boolean;
  v_cancelled boolean;
  v_restored boolean;
  v_series boolean;
  v_old_place text;
  v_new_place text;
  v_changes text[] := array[]::text[];
  v_recipients jsonb;
  v_actor text;
  v_when text;
  v_before text;
  v_extra text := '';
  v_kind text;
  v_title text;
  v_message text;
  r record;
  nid uuid;
begin
  -- Usunięte spotkania i utworzone w tej samej transakcji (zaproszenia wysyła wyzwalacz uczestników) — bez powiadomień.
  if new.deleted_at is not null or old.deleted_at is not null or new.created_at >= now() then
    return null;
  end if;

  -- Porównanie co do minuty (aplikacje zapisują terminy z dokładnością do minuty).
  v_moved := date_trunc('minute', old.datetime_start) is distinct from date_trunc('minute', new.datetime_start)
    or date_trunc('minute', old.datetime_end) is distinct from date_trunc('minute', new.datetime_end)
    or coalesce(old.is_all_day, false) is distinct from coalesce(new.is_all_day, false);
  v_cancelled := new.status = 'cancelled' and old.status is distinct from 'cancelled';
  v_restored := old.status = 'cancelled' and new.status is distinct from 'cancelled';
  -- Zmiana „ten i następne” w cyklu: edytowany termin rozpoczyna nowy cykl (kolejne terminy są tworzone na nowo).
  v_series := old.series_id is not null and new.series_id is not null and old.series_id is distinct from new.series_id;

  if btrim(coalesce(old.title, '')) is distinct from v_title_text then
    v_changes := array_append(v_changes, format('tytuł (wcześniej „%s”)', btrim(coalesce(old.title, ''))));
  end if;
  select coalesce(nullif(btrim(old.location_text), ''), (select l.name from public.locations l where l.id = old.location_id)) into v_old_place;
  select coalesce(nullif(btrim(new.location_text), ''), (select l.name from public.locations l where l.id = new.location_id)) into v_new_place;
  if coalesce(v_old_place, '') is distinct from coalesce(v_new_place, '') then
    v_changes := array_append(v_changes, case when v_new_place is null then 'miejsce usunięte' else 'miejsce: ' || v_new_place end);
  end if;
  if btrim(coalesce(old.notes, '')) is distinct from btrim(coalesce(new.notes, '')) then
    v_changes := array_append(v_changes, 'notatki'::text);
  end if;
  if not v_cancelled and not v_restored and coalesce(old.status, 'confirmed') is distinct from coalesce(new.status, 'confirmed') then
    v_changes := array_append(v_changes, case new.status when 'tentative' then 'status: wstępne' else 'status: potwierdzone' end);
  end if;
  if coalesce(old.recurrence_days, 0) is distinct from coalesce(new.recurrence_days, 0) then
    v_changes := array_append(v_changes, case coalesce(new.recurrence_days, 0)
      when 0 then 'bez powtarzania' when 1 then 'powtarzanie: codziennie' when 7 then 'powtarzanie: co tydzień'
      when 14 then 'powtarzanie: co 2 tygodnie' else 'powtarzanie' end);
  end if;

  if not v_moved and not v_cancelled and not v_restored and cardinality(v_changes) = 0 then
    return null;
  end if;

  -- Autor zmiany (zalogowany pracownik). Zmiana systemowa (bez zalogowanego pracownika) — bez powiadomień.
  select e.* into actor from public.employees e
   where auth.uid() is not null and (e.id = auth.uid() or e.auth_user_id = auth.uid())
   order by (e.id = auth.uid()) desc
   limit 1;

  -- Odbiorcy z dotychczasową odpowiedzią (przed jej wyzerowaniem): uczestnicy sprzed tej zmiany i organizator, bez autora.
  select coalesce(jsonb_agg(jsonb_build_object('employee_id', x.employee_id, 'response', x.response)), '[]'::jsonb)
    into v_recipients
    from (
      select distinct on (p.employee_id) p.employee_id, p.response
        from (
          select mp.employee_id, mp.response, (mp.response = 'pending') as unanswered
            from public.meeting_participants mp
           where mp.meeting_id = new.id and mp.employee_id is not null and mp.created_at < now()
          union all
          select new.created_by, 'accepted'::text, true where new.created_by is not null
        ) p
        join public.employees e on e.id = p.employee_id and e.is_active
       where p.employee_id is distinct from actor.id
       order by p.employee_id, p.unanswered
    ) x;

  -- Nowy termin: uczestnicy odpowiadają ponownie (jak w Teams) — organizator i autor zmiany zachowują swoją odpowiedź.
  if v_moved and not v_cancelled then
    update public.meeting_participants
       set response = 'pending', responded_at = null
     where meeting_id = new.id and employee_id is not null and response <> 'pending'
       and employee_id is distinct from v_owner and employee_id is distinct from actor.id;
  end if;

  if actor.id is null then
    return null;
  end if;

  begin
    v_actor := coalesce(nullif(btrim(concat_ws(' ', actor.name, actor.surname)), ''), nullif(btrim(actor.nickname), ''), 'Organizator');
    v_when := public.meeting_when_label(new.datetime_start, new.datetime_end, new.is_all_day);
    v_before := public.meeting_when_label(old.datetime_start, old.datetime_end, old.is_all_day);
    if cardinality(v_changes) > 0 then
      v_extra := ' Zmieniono też: ' || array_to_string(v_changes, ', ') || '.';
    end if;
    if v_series then
      v_extra := v_extra || ' Zmiana dotyczy też kolejnych spotkań z cyklu.';
    end if;

    for r in
      select (item->>'employee_id')::uuid as employee_id, item->>'response' as response
        from jsonb_array_elements(v_recipients) item
    loop
      if v_cancelled then
        v_kind := 'meeting_cancelled';
        v_title := 'Spotkanie odwołane: ' || v_title_text;
        v_message := format('%s odwołuje spotkanie „%s” (%s).', v_actor, v_title_text, v_when);
      elsif v_moved then
        v_kind := 'meeting_rescheduled';
        v_title := 'Zmiana terminu: ' || v_title_text;
        v_message := format('%s zmienia termin %s „%s”: %s (wcześniej %s).', v_actor,
            case when r.employee_id = v_owner then 'Twojego spotkania' else 'spotkania' end, v_title_text, v_when, v_before)
          || case
               when r.employee_id = v_owner then ''
               when r.response in ('accepted', 'tentative') then ' Twoja odpowiedź została wycofana — potwierdź udział w nowym terminie.'
               when r.response = 'declined' then ' Odpowiedz, czy nowy termin Ci pasuje.'
               else ' Odpowiedz na zaproszenie.'
             end
          || v_extra;
      elsif v_restored then
        v_kind := 'meeting_restored';
        v_title := 'Spotkanie przywrócone: ' || v_title_text;
        v_message := format('%s przywraca spotkanie „%s” (%s).', v_actor, v_title_text, v_when) || v_extra;
      else
        v_kind := 'meeting_updated';
        v_title := 'Zmiany w spotkaniu: ' || v_title_text;
        v_message := format('%s wprowadza zmiany w spotkaniu „%s” (%s): %s.', v_actor, v_title_text, v_when, array_to_string(v_changes, ', '))
          || case when v_series then ' Zmiana dotyczy też kolejnych spotkań z cyklu.' else '' end;
      end if;

      insert into public.notifications(title, message, type, category, related_entity_type, related_entity_id, action_url, metadata)
      values (
        v_title, v_message, case when v_cancelled then 'warning' else 'info' end,
        'meeting', 'meeting', new.id::text, '/crm/meetings?meetingId=' || new.id::text,
        jsonb_strip_nulls(jsonb_build_object(
          'kind', v_kind,
          'meeting_id', new.id,
          'changed_by', actor.id,
          'changed_by_name', v_actor,
          'changes', to_jsonb(v_changes),
          'datetime_start', new.datetime_start,
          'datetime_end', new.datetime_end,
          'previous_start', case when v_moved then old.datetime_start end,
          'previous_end', case when v_moved then old.datetime_end end,
          'previous_response', case when v_moved and not v_cancelled then r.response end,
          'needs_response', v_moved and not v_cancelled and r.employee_id is distinct from v_owner
        ))
      )
      returning id into nid;

      insert into public.notification_recipients(notification_id, user_id, is_read)
      values (nid, r.employee_id, false)
      on conflict (notification_id, user_id) do nothing;
    end loop;
  exception when others then
    raise warning 'notify_meeting_changes(%): %', new.id, sqlerrm;
  end;

  return null;
end
$function$;

drop trigger if exists notify_meeting_changes_after_update on public.meetings;
create constraint trigger notify_meeting_changes_after_update
  after update on public.meetings
  deferrable initially deferred
  for each row
  when (new.deleted_at is null and old.deleted_at is null and (
    old.datetime_start is distinct from new.datetime_start
    or old.datetime_end is distinct from new.datetime_end
    or old.is_all_day is distinct from new.is_all_day
    or old.title is distinct from new.title
    or old.location_id is distinct from new.location_id
    or old.location_text is distinct from new.location_text
    or old.notes is distinct from new.notes
    or old.status is distinct from new.status
    or old.recurrence_days is distinct from new.recurrence_days
  ))
  execute function public.notify_meeting_changes();

-- Zapis spotkania bez zerowania odpowiedzi (robi to teraz `notify_meeting_changes`); reszta funkcji bez zmian
-- (jak w `20261111120000_meeting_privacy_status.sql`).
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
  -- Nowy termin: odpowiedzi uczestników zeruje i powiadomienia wysyła `notify_meeting_changes` (przy zatwierdzeniu transakcji).
 END IF;
 IF sid IS NOT NULL THEN PERFORM public.materialize_meeting_series(sid); END IF;
 RETURN jsonb_build_object('id',mid);
END $function$;
