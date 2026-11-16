-- Odpowiedź na spotkanie: pierwsza świadoma odpowiedź uczestnika też się liczy.
-- Zaproszenia sprzed 20261111120000 miały domyślnie response = 'accepted' (bez responded_at), więc „Przyjmuję”
-- niczego nie zmieniało: nie zapisywał się czas odpowiedzi, a organizator nie dostawał powiadomienia.
-- Teraz zapis i powiadomienie następują, gdy odpowiedź się zmienia ALBO uczestnik odpowiada po raz pierwszy
-- (responded_at jest puste). Reszta funkcji bez zmian.

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
   where meeting_id = p_meeting_id and employee_id = actor.id
     and (response is distinct from p_response or responded_at is null);
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
