-- Czat spotkania (docs/meeting-chat.md).
--
-- Każde spotkanie może mieć rozmowę grupową w Komunikatorze: organizator i zaproszeni pracownicy — także przed odpowiedzią
-- na zaproszenie (prośba o inny termin, ustalenia, agenda). Pliki (np. agenda) dodaje się w czacie jak w każdej rozmowie
-- (`chat-attachments`); szczegóły spotkania w CRM, na Macu i w telefonie pokazują liczbę wiadomości, nieprzeczytane i pliki.
-- Rozmowa powstaje przy pierwszym otwarciu („Czat spotkania”, `meeting_chat(id, true)`), skład pilnuje baza: dodanie
-- uczestnika do spotkania dodaje go do rozmowy, usunięcie — usuwa (organizator zostaje). Tytuł: „Spotkanie: … (DD.MM)”,
-- zmienia się razem z tytułem i datą spotkania. Wiadomości, powiadomienia push, nieprzeczytane i pliki — jak w Komunikatorze.
-- Składu i tytułu rozmowy spotkania nie zmienia się ręcznie w Komunikatorze (polityki niżej) — wynika ze spotkania.

-- 1. Rozmowa przypięta do spotkania — jedna na termin (w cyklu każdy termin ma swoją).
alter table public.employee_conversations
  add column if not exists meeting_id uuid references public.meetings(id) on delete set null;
create unique index if not exists employee_conversations_meeting_id_key
  on public.employee_conversations (meeting_id) where meeting_id is not null;

-- 2. Tytuł rozmowy spotkania.
create or replace function public.meeting_chat_title(p_title text, p_start timestamptz)
returns text
language sql
stable
set search_path to 'pg_catalog'
as $function$
  select left('Spotkanie: ' || coalesce(nullif(btrim(p_title), ''), 'bez tytułu'), 90)
    || coalesce(' (' || to_char(p_start at time zone 'Europe/Warsaw', 'DD.MM') || ')', '')
$function$;

revoke all on function public.meeting_chat_title(text, timestamptz) from public, anon;
grant execute on function public.meeting_chat_title(text, timestamptz) to authenticated, service_role;

-- 3. Czy rozmowa należy do spotkania (polityki Komunikatora).
create or replace function private.is_meeting_conversation(target_conversation_id uuid)
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
  select exists (
    select 1 from public.employee_conversations c
    where c.id = target_conversation_id and c.meeting_id is not null
  );
$function$;

revoke all on function private.is_meeting_conversation(uuid) from public, anon;
grant execute on function private.is_meeting_conversation(uuid) to authenticated, service_role;

-- 4. Czat spotkania dla uczestnika albo organizatora: identyfikator rozmowy, liczba wiadomości, nieprzeczytane i pliki
--    (ostatnie 20). `p_create` — utworzenie rozmowy przy pierwszym otwarciu i uzupełnienie jej składu o uczestników spotkania.
create or replace function public.meeting_chat(p_meeting_id uuid, p_create boolean default false)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  me uuid := private.current_employee_id();
  m public.meetings;
  cid uuid;
  v_member boolean := false;
  v_messages integer := 0;
  v_unread integer := 0;
  v_files jsonb := '[]'::jsonb;
begin
  if me is null or public.current_session_is_seller_portal()
     or not exists (select 1 from public.employees e where e.id = me and e.is_active) then
    raise exception 'Brak dostępu do spotkań.' using errcode = '42501';
  end if;
  select * into m from public.meetings where id = p_meeting_id and deleted_at is null;
  if m.id is null or (m.created_by is distinct from me and not exists (
       select 1 from public.meeting_participants mp where mp.meeting_id = m.id and mp.employee_id = me)) then
    raise exception 'Czat spotkania jest dostępny tylko dla jego uczestników.' using errcode = '42501';
  end if;

  select c.id into cid from public.employee_conversations c where c.meeting_id = m.id;
  if p_create then
    if cid is null then
      perform pg_advisory_xact_lock(hashtextextended('meeting_chat:' || m.id::text, 0));
      select c.id into cid from public.employee_conversations c where c.meeting_id = m.id;
    end if;
    if cid is null then
      insert into public.employee_conversations(title, is_group, created_by, meeting_id, last_message_at)
      values (public.meeting_chat_title(m.title, m.datetime_start), true,
              coalesce((select e.id from public.employees e where e.id = m.created_by), me), m.id, now())
      returning id into cid;
    end if;
    -- Skład = aktywni pracownicy spotkania i organizator (przy każdym otwarciu — uzupełnienie braków).
    insert into public.employee_conversation_participants(conversation_id, employee_id)
    select distinct cid, e.id
      from (
        select mp.employee_id from public.meeting_participants mp where mp.meeting_id = m.id and mp.employee_id is not null
        union
        select m.created_by
      ) p
      join public.employees e on e.id = p.employee_id and e.is_active
    on conflict (conversation_id, employee_id) do nothing;
  end if;

  if cid is not null then
    select exists (
      select 1 from public.employee_conversation_participants p where p.conversation_id = cid and p.employee_id = me
    ) into v_member;
  end if;
  if v_member then
    select count(*) into v_messages from public.employee_messages em where em.conversation_id = cid;
    select count(*) into v_unread
      from public.employee_messages em
      join public.employee_conversation_participants p on p.conversation_id = em.conversation_id and p.employee_id = me
     where em.conversation_id = cid and em.sender_id <> me
       and em.created_at > coalesce(p.last_read_at, '-infinity'::timestamptz);
    select coalesce(jsonb_agg(f order by f.created_at desc), '[]'::jsonb) into v_files
      from (
        select em.id, coalesce(nullif(btrim(em.attachment_filename), ''), 'Plik') as name, em.attachment_url as url,
               em.attachment_size as size, em.message_type as type, em.created_at,
               nullif(btrim(concat_ws(' ', e.name, e.surname)), '') as sender
          from public.employee_messages em
          left join public.employees e on e.id = em.sender_id
         where em.conversation_id = cid and nullif(em.attachment_url, '') is not null
         order by em.created_at desc
         limit 20
      ) f;
  end if;

  return jsonb_build_object(
    'conversation_id', cid,
    'member', v_member,
    'messages', v_messages,
    'unread', v_unread,
    'files', v_files
  );
end
$function$;

revoke all on function public.meeting_chat(uuid, boolean) from public, anon;
grant execute on function public.meeting_chat(uuid, boolean) to authenticated, service_role;

-- 5. Skład rozmowy za uczestnikami spotkania (dodanie / usunięcie pracownika; organizator zostaje).
create or replace function public.sync_meeting_chat_members()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  cid uuid;
  v_owner uuid;
begin
  if tg_op = 'INSERT' then
    if new.employee_id is not null then
      select c.id into cid from public.employee_conversations c where c.meeting_id = new.meeting_id;
      if cid is not null and exists (select 1 from public.employees e where e.id = new.employee_id and e.is_active) then
        insert into public.employee_conversation_participants(conversation_id, employee_id)
        values (cid, new.employee_id)
        on conflict (conversation_id, employee_id) do nothing;
      end if;
    end if;
  elsif old.employee_id is not null then
    select c.id, m.created_by into cid, v_owner
      from public.employee_conversations c
      join public.meetings m on m.id = c.meeting_id
     where c.meeting_id = old.meeting_id;
    if cid is not null and old.employee_id is distinct from v_owner and not exists (
      select 1 from public.meeting_participants mp where mp.meeting_id = old.meeting_id and mp.employee_id = old.employee_id
    ) then
      delete from public.employee_conversation_participants where conversation_id = cid and employee_id = old.employee_id;
    end if;
  end if;
  return null;
end
$function$;

drop trigger if exists sync_meeting_chat_members_after_change on public.meeting_participants;
create trigger sync_meeting_chat_members_after_change
  after insert or delete on public.meeting_participants
  for each row execute function public.sync_meeting_chat_members();

-- 6. Tytuł rozmowy za tytułem i datą spotkania.
create or replace function public.sync_meeting_chat_title()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
begin
  update public.employee_conversations
     set title = public.meeting_chat_title(new.title, new.datetime_start)
   where meeting_id = new.id
     and title is distinct from public.meeting_chat_title(new.title, new.datetime_start);
  return null;
end
$function$;

drop trigger if exists sync_meeting_chat_title_after_update on public.meetings;
create trigger sync_meeting_chat_title_after_update
  after update of title, datetime_start on public.meetings
  for each row
  when (old.title is distinct from new.title or old.datetime_start is distinct from new.datetime_start)
  execute function public.sync_meeting_chat_title();

-- 7. Komunikator: rozmowy spotkania nie zakłada się, nie zmienia ani nie usuwa ręcznie, a ich składu nie zmienia autor
--    rozmowy — wynika ze spotkania (punkty 4–6). Wyjście z rozmowy (własny udział) bez zmian.
alter policy chat_insert_conversations on public.employee_conversations
  with check ((created_by = (select private.current_employee_id())) and meeting_id is null);
alter policy chat_update_conversations on public.employee_conversations
  using ((created_by = (select private.current_employee_id())) and meeting_id is null)
  with check ((created_by = (select private.current_employee_id())) and meeting_id is null);
alter policy chat_delete_conversations on public.employee_conversations
  using ((created_by = (select private.current_employee_id())) and meeting_id is null);
alter policy chat_insert_participants on public.employee_conversation_participants
  with check (
    (select private.current_employee_created_conversation(employee_conversation_participants.conversation_id))
    and not (select private.is_meeting_conversation(employee_conversation_participants.conversation_id))
    and exists (select 1 from public.employees e where e.id = employee_conversation_participants.employee_id)
  );
alter policy chat_delete_participants on public.employee_conversation_participants
  using (
    (employee_id = (select private.current_employee_id()))
    or ((select private.current_employee_created_conversation(employee_conversation_participants.conversation_id))
        and not (select private.is_meeting_conversation(employee_conversation_participants.conversation_id)))
  );
