-- Prezentacje → „Oferta ze spotkania” (CRM, Mac, telefon i tablet):
-- 1. Klient roboczy: oferta bez klienta w bazie — sprzedawca wpisuje samą nazwę (np. „Firma z targów”), a klienta przypisuje
--    później w CRM. Zapytanie i oferta powstają bez klienta (`inquiry_details.client_text` + `client_placeholder`, oferta
--    z pustym `client_type`); nic nie trafia do bazy klientów. Zmiana w `sales_showcase_offer_request` (migracja
--    20261122160000): `client.placeholder`, `clientType: 'none'`, `placeholder` w wyniku. Reszta funkcji bez zmian.
-- 2. Rabat na pozycję (offer_items.discount_percent — jak w kreatorze ofert) liczy się do progu rabatu (akceptacja).
-- Plik idempotentny. Wymaga migracji 20261122160000.

begin;

-- 1. Klient i zapytanie dla oferty ze spotkania.
create or replace function public.sales_showcase_offer_request(p_request jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  actor uuid := public.current_crm_employee_id();
  uuid_pattern constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  request jsonb := coalesce(p_request, '{}'::jsonb);
  v_client jsonb;
  v_event jsonb;
  v_org uuid;
  v_contact uuid;
  v_inquiry uuid;
  created_org boolean := false;
  created_contact boolean := false;
  created_inquiry boolean := false;
  v_company text;
  v_nip text;
  v_first text;
  v_last text;
  v_email text;
  v_phone text;
  v_phone_key text;
  v_subject text;
  v_termin text;
  v_due timestamptz;
  v_location text;
  v_location_id uuid;
  v_guests integer;
  v_note text;
  v_scope text;
  v_estimated numeric;
  v_client_name text;
  v_client_email text;
  v_matched uuid;
  v_matched_count integer;
  v_placeholder text;
  inquiry_row public.tasks%rowtype;
  v_next_order integer;
  v_lines text[] := array[]::text[];
begin
  if actor is null or not public.sales_showcase_offer_can() then
    raise exception 'Brak uprawnień do tworzenia ofert z prezentacji.' using errcode = '42501';
  end if;
  if jsonb_typeof(request) <> 'object' then
    raise exception 'Nieprawidłowe dane oferty.' using errcode = '22023';
  end if;
  v_client := case when jsonb_typeof(request->'client') = 'object' then request->'client' else '{}'::jsonb end;
  v_event := case when jsonb_typeof(request->'event') = 'object' then request->'event' else '{}'::jsonb end;

  v_company := left(btrim(coalesce(v_client->>'company', '')), 200);
  v_nip := left(regexp_replace(coalesce(v_client->>'nip', ''), '\D', '', 'g'), 20);
  v_first := left(btrim(coalesce(v_client->>'firstName', '')), 120);
  v_last := left(btrim(coalesce(v_client->>'lastName', '')), 120);
  v_email := lower(left(btrim(coalesce(v_client->>'email', '')), 200));
  v_phone := left(btrim(coalesce(v_client->>'phone', '')), 50);
  v_phone_key := public.customer360_normalize_phone(v_phone);
  -- Klient roboczy: sama nazwa (np. „Firma z targów”), bez dodawania do bazy — używana tylko, gdy nie ma klienta z bazy ani nowego.
  v_placeholder := left(btrim(coalesce(v_client->>'placeholder', '')), 200);
  v_subject := left(btrim(coalesce(v_event->>'name', '')), 160);
  v_termin := left(btrim(coalesce(v_event->>'date', '')), 16);
  v_location := left(btrim(coalesce(v_event->>'location', '')), 500);
  -- Miejsce z bazy lokalizacji (podpowiedź w ofercie ze spotkania) — tylko istniejąca lokalizacja i z podanym tekstem.
  if coalesce(v_event->>'locationId', '') ~* '^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$' and v_location <> '' then
    select l.id into v_location_id from public.locations l where l.id = (v_event->>'locationId')::uuid;
  end if;
  v_note := left(btrim(coalesce(request->>'note', '')), 2000);
  v_scope := left(btrim(coalesce(request->>'scope', '')), 4000);

  if v_email <> '' and v_email !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'Podaj poprawny adres e-mail.' using errcode = '22023';
  end if;
  if v_nip <> '' and length(v_nip) <> 10 then
    raise exception 'NIP ma 10 cyfr.' using errcode = '22023';
  end if;
  if nullif(btrim(coalesce(v_event->>'guestCount', '')), '') is not null then
    if btrim(v_event->>'guestCount') !~ '^[0-9]{1,6}$' or (v_event->>'guestCount')::integer not between 1 and 100000 then
      raise exception 'Podaj liczbę osób od 1 do 100 000 albo zostaw pole puste.' using errcode = '22023';
    end if;
    v_guests := (v_event->>'guestCount')::integer;
  end if;
  if v_termin <> '' then
    if v_termin !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}(T[0-9]{2}:[0-9]{2})?$' then
      raise exception 'Podaj poprawny termin wydarzenia.' using errcode = '22023';
    end if;
    begin
      -- Sam dzień — południe czasu polskiego (jak v_termin bez godziny w zapytaniach).
      v_due := (case when length(v_termin) = 10 then v_termin || 'T12:00' else v_termin end)::timestamp at time zone 'Europe/Warsaw';
    exception when others then
      raise exception 'Podaj poprawny termin wydarzenia.' using errcode = '22023';
    end;
  end if;
  if jsonb_typeof(request->'estimatedNet') = 'number' then
    v_estimated := round(greatest(0, least((request->>'estimatedNet')::numeric, 999999999)), 2);
  end if;

  -- 1. Klient z bazy — tylko widoczny dla sprzedawcy.
  if nullif(btrim(coalesce(v_client->>'organizationId', '')), '') is not null then
    if (v_client->>'organizationId') !~ uuid_pattern then
      raise exception 'Nie znaleziono klienta.' using errcode = '42501';
    end if;
    v_org := (v_client->>'organizationId')::uuid;
    if not public.crm_can_read_client_directory() or not exists (select 1 from public.organizations o where o.id = v_org) then
      raise exception 'Nie znaleziono klienta.' using errcode = '42501';
    end if;
  end if;
  if nullif(btrim(coalesce(v_client->>'contactId', '')), '') is not null then
    if (v_client->>'contactId') !~ uuid_pattern then
      raise exception 'Nie znaleziono osoby kontaktowej.' using errcode = '42501';
    end if;
    v_contact := (v_client->>'contactId')::uuid;
    if not exists (
      select 1 from public.contacts c
      where c.id = v_contact
        and (public.crm_can_read_client_directory() or c.owner_id = actor or c.created_by = actor)
    ) then
      raise exception 'Nie znaleziono osoby kontaktowej.' using errcode = '42501';
    end if;
  end if;

  -- 2. Nowa firma: bez duplikatu (NIP, potem dokładna nazwa).
  if v_org is null and v_company <> '' then
    if v_nip <> '' then
      select o.id into v_org from public.organizations o
      where regexp_replace(coalesce(o.nip, ''), '\D', '', 'g') = v_nip
      order by o.created_at nulls last, o.id limit 1;
    end if;
    if v_org is null then
      select o.id into v_org from public.organizations o
      where lower(btrim(o.name)) = lower(v_company)
      order by o.created_at nulls last, o.id limit 1;
    end if;
    if v_org is null then
      insert into public.organizations (name, nip, email, phone, notes)
      values (v_company, nullif(v_nip, ''),
        case when v_first = '' and v_last = '' then nullif(v_email, '') end,
        case when v_first = '' and v_last = '' then nullif(v_phone, '') end,
        'Klient dodany na spotkaniu (Strefa sprzedawcy → Prezentacje).')
      returning id into v_org;
      created_org := true;
    end if;
  end if;

  -- 3. Osoba kontaktowa: bez duplikatu (e-mail albo telefon — jedno dopasowanie), inaczej nowa.
  if v_contact is null and (v_first <> '' or v_last <> '') then
    if v_email <> '' or length(v_phone_key) >= 9 then
      select count(*), (array_agg(c.id order by c.id))[1] into v_matched_count, v_matched
      from public.contacts c
      where (v_email <> '' and lower(btrim(coalesce(c.email, ''))) = v_email)
         or (length(v_phone_key) >= 9 and v_phone_key in (public.customer360_normalize_phone(c.mobile), public.customer360_normalize_phone(c.phone)));
      if v_matched_count = 1 then
        v_contact := v_matched;
      end if;
    end if;
    if v_contact is null then
      if v_first = '' or v_last = '' then
        raise exception 'Podaj imię i nazwisko osoby kontaktowej.' using errcode = '22023';
      end if;
      insert into public.contacts (first_name, last_name, email, phone, contact_type, source, notes, created_by)
      values (v_first, v_last, nullif(v_email, ''), nullif(v_phone, ''),
        case when v_org is null then 'individual' else 'contact' end, 'meeting',
        'Kontakt dodany na spotkaniu (Strefa sprzedawcy → Prezentacje).', actor)
      returning id into v_contact;
      created_contact := true;
    end if;
  end if;
  if v_org is not null and v_contact is not null
    and not exists (select 1 from public.contact_organizations r where r.contact_id = v_contact and r.organization_id = v_org) then
    insert into public.contact_organizations (contact_id, organization_id, is_current, is_primary)
    values (v_contact, v_org, true,
      not exists (select 1 from public.contact_organizations r where r.organization_id = v_org and coalesce(r.is_primary, false)));
  end if;
  -- Bez klienta z bazy i bez nowego — dozwolony klient roboczy: zapytanie i oferta bez klienta, nazwa robocza w zapytaniu;
  -- klienta przypisuje się później w CRM (oferta bez klienta: client_type, organization_id i contact_id puste).
  if v_org is null and v_contact is null and v_placeholder = '' then
    raise exception 'Wybierz klienta, podaj firmę lub imię i nazwisko albo wpisz nazwę roboczą klienta.' using errcode = '22023';
  end if;

  select coalesce(
      (select o.name from public.organizations o where o.id = v_org),
      (select coalesce(nullif(btrim(c.full_name), ''), btrim(c.first_name || ' ' || c.last_name)) from public.contacts c where c.id = v_contact),
      case when v_org is null and v_contact is null then nullif(v_placeholder, '') end),
    coalesce(nullif(v_email, ''),
      (select nullif(btrim(c.email), '') from public.contacts c where c.id = v_contact),
      (select nullif(btrim(o.email), '') from public.organizations o where o.id = v_org))
    into v_client_name, v_client_email;

  -- 4. Zapytanie: otwarte zapytanie tego klienta albo nowe.
  if nullif(btrim(coalesce(request->>'inquiryId', '')), '') is not null then
    if (request->>'inquiryId') !~ uuid_pattern then
      raise exception 'Zapytanie jest niedostępne albo zamknięte.' using errcode = '42501';
    end if;
    select * into inquiry_row from public.tasks t
    where t.id = (request->>'inquiryId')::uuid and t.is_inquiry and t.archived_at is null and t.deleted_at is null
      and coalesce(t.inquiry_stage, 'new') not in ('won', 'lost')
    for update;
    if not found or not public.can_manage_inquiry(inquiry_row.inquiry_owner_id, inquiry_row.id) then
      raise exception 'Zapytanie jest niedostępne albo zamknięte.' using errcode = '42501';
    end if;
    if (inquiry_row.organization_id is not null and v_org is distinct from inquiry_row.organization_id)
      or (inquiry_row.organization_id is null and inquiry_row.contact_id is not null and v_org is null
          and v_contact is distinct from inquiry_row.contact_id) then
      raise exception 'To zapytanie dotyczy innego klienta.' using errcode = '22023';
    end if;
    v_inquiry := inquiry_row.id;
    -- Rozmowa na spotkaniu kwalifikuje zapytanie; brakujący klient uzupełnia się z oferty.
    update public.tasks t
    set inquiry_stage = case when coalesce(t.inquiry_stage, 'new') in ('new', 'contacted') then 'qualified' else t.inquiry_stage end,
        organization_id = coalesce(t.organization_id, v_org),
        contact_id = coalesce(t.contact_id, v_contact),
        last_contact_at = now()
    where t.id = v_inquiry;
  else
    if v_subject = '' then
      v_subject := left(coalesce(v_client_name, 'Klient'), 160);
    end if;
    if v_termin <> '' then v_lines := v_lines || ('Termin: ' || replace(v_termin, 'T', ' ')); end if;
    if v_location <> '' then v_lines := v_lines || ('Lokalizacja: ' || v_location); end if;
    if v_guests is not null then v_lines := v_lines || ('Liczba osób: ' || v_guests::text); end if;
    if v_scope <> '' then v_lines := v_lines || ('Wybrane na spotkaniu: ' || v_scope); end if;
    if v_note <> '' then v_lines := v_lines || ('Notatka: ' || v_note); end if;
    v_lines := v_lines || ('Kontakt: ' || concat_ws(' | ', v_client_name, nullif(v_phone, ''), v_client_email));
    if v_org is null and v_contact is null then
      v_lines := v_lines || 'Klient roboczy (bez bazy) — przypisz klienta w CRM przed wysłaniem oferty.'::text;
    end if;
    select coalesce(min(t.order_index), 0) - 1 into v_next_order from public.tasks t;

    insert into public.tasks (
      title, description, priority, status, board_column, order_index, due_date, created_by, is_inquiry, is_private,
      inquiry_stage, inquiry_owner_id, estimated_value, contact_id, organization_id, last_contact_at, inquiry_details
    ) values (
      'Zapytanie: ' || v_subject, array_to_string(v_lines, E'\n'), 'high', 'in_progress', 'review', v_next_order, v_due,
      actor, true, false, 'qualified', actor, v_estimated, v_contact, v_org, now(),
      jsonb_strip_nulls(jsonb_build_object(
        'source_kind', 'manual',
        'source_name', 'Rozmowa / spotkanie',
        'source_channel', 'meeting',
        'source_detail', 'Prezentacje (Strefa sprzedawcy)',
        'source_message_content', nullif(coalesce(nullif(v_note, ''), v_scope), ''),
        'termin', nullif(v_termin, ''),
        'location_text', nullif(v_location, ''),
        'location_id', v_location_id,
        'scope', nullif(v_scope, ''),
        'guest_count', v_guests,
        'expectations', nullif(v_note, ''),
        'client_text', v_client_name,
        'client_organization_id', v_org,
        'client_contact_id', v_contact,
        'client_phone', nullif(v_phone, ''),
        'client_email', v_client_email,
        'client_placeholder', case when v_org is null and v_contact is null then true end
      ))
    ) returning id into v_inquiry;
    created_inquiry := true;
  end if;

  return jsonb_build_object(
    'inquiryId', v_inquiry,
    'organizationId', v_org,
    'contactId', v_contact,
    'clientType', case when v_org is not null then 'business' when v_contact is not null then 'individual' else 'none' end,
    'placeholder', v_org is null and v_contact is null,
    'clientName', coalesce(v_client_name, ''),
    'clientEmail', coalesce(v_client_email, ''),
    'created', jsonb_build_object('inquiry', created_inquiry, 'organization', created_org, 'contact', created_contact)
  );
end;
$$;
revoke all on function public.sales_showcase_offer_request(jsonb) from public, anon;
grant execute on function public.sales_showcase_offer_request(jsonb) to authenticated, service_role;

comment on function public.sales_showcase_offer_request(jsonb) is
  'Oferta ze spotkania (Prezentacje): klient (z bazy, nowy bez duplikatów albo roboczy — sama nazwa, bez bazy) i zapytanie (nowe albo otwarte zapytanie klienta, miejsce z bazy lokalizacji albo tekst) — oferta i pozycje zapisuje serwer Next tokenem pracownika.';

-- 2. Progi rabatu: rabat łączny — rabaty pozycji (od wartości pozycji przed rabatem) i rabat całej oferty, wobec wartości
-- przed rabatami. Wcześniej próg liczył tylko rabat całej oferty, więc rabat wpisany przy pozycji omijał akceptację.
-- `subtotal` w wyniku bez zmian (wartość pozycji po ich rabatach) — porównanie z migawką zaakceptowanej oferty działa jak dotąd.
-- (W chwili wprowadzenia żadna pozycja oferty nie miała rabatu — wynik dla istniejących ofert się nie zmienia.)
CREATE OR REPLACE FUNCTION public.offer_guardrail_evaluate_row(o public.offers)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE g public.sales_offer_guardrails%ROWTYPE;
  items_subtotal numeric := 0; items_cost numeric := 0; item_discounts numeric := 0; subtotal numeric; cost numeric;
  discount_value numeric; discount numeric; net numeric; margin numeric; list_value numeric;
  reasons jsonb := '[]'::jsonb; approval_valid boolean := false; snapshot jsonb := o.approval_snapshot;
BEGIN
  SELECT * INTO g FROM public.sales_offer_guardrails WHERE id = 1;
  SELECT coalesce(sum(coalesce(i.total, 0)), 0)::numeric,
         coalesce(sum(coalesce(i.unit_cost, 0) * coalesce(i.quantity, 0)), 0)::numeric,
         coalesce(sum(greatest(coalesce(i.discount_amount, 0), 0)), 0)::numeric
    INTO items_subtotal, items_cost, item_discounts
  FROM public.offer_items i WHERE i.offer_id = o.id;

  subtotal := items_subtotal + CASE WHEN coalesce(o.logistics_enabled, false)
    THEN coalesce(o.logistics_price_net, 0)::numeric ELSE 0 END;
  cost := items_cost + coalesce(o.logistics_cost_net, 0)::numeric;
  discount_value := CASE WHEN coalesce(o.discount_amount, 0) > 0
    THEN least(subtotal, o.discount_amount::numeric)
    ELSE round(subtotal * coalesce(o.discount_percent, 0)::numeric / 100, 2) END;
  list_value := subtotal + item_discounts;
  discount := CASE WHEN list_value > 0 THEN round((discount_value + item_discounts) / list_value * 100, 2) ELSE 0 END;
  net := subtotal - discount_value;
  margin := CASE WHEN cost > 0 AND net > 0 THEN round((net - cost) / net * 100, 2) END;

  IF coalesce(g.enabled, false) AND coalesce(o.sales_channel, 'crm') <> 'seller_portal' THEN
    IF discount > g.max_discount_percent THEN
      reasons := reasons || jsonb_build_object('kind', 'discount', 'value', discount, 'limit', g.max_discount_percent,
        'message', format('Rabat %s%% przekracza limit %s%%', discount, g.max_discount_percent));
    END IF;
    IF margin IS NOT NULL AND margin < g.min_margin_percent THEN
      reasons := reasons || jsonb_build_object('kind', 'margin', 'value', margin, 'limit', g.min_margin_percent,
        'message', format('Marża %s%% jest poniżej progu %s%%', margin, g.min_margin_percent));
    END IF;
  END IF;

  -- Akceptacja obowiązuje dla tej samej wartości pozycji, rabatu nie wyższego i marży nie niższej.
  IF o.approval_status = 'approved' AND snapshot IS NOT NULL THEN
    approval_valid := abs(coalesce((snapshot->>'subtotal')::numeric, -1) - subtotal) <= 0.01
      AND discount <= coalesce((snapshot->>'discount')::numeric, -1) + 0.01
      AND (margin IS NULL
        OR margin >= coalesce(g.min_margin_percent, 0)
        OR ((snapshot->>'margin') IS NOT NULL AND margin >= (snapshot->>'margin')::numeric - 0.01));
  END IF;

  RETURN jsonb_build_object(
    'offer_id', o.id,
    'required', jsonb_array_length(reasons) > 0,
    'reasons', reasons,
    'subtotal', subtotal,
    'discount_percent', discount,
    'margin_percent', margin,
    'margin_known', margin IS NOT NULL,
    'approval_status', o.approval_status,
    'approval_valid', approval_valid,
    'approval_note', o.approval_note,
    'approval_requested_at', o.approval_requested_at,
    'approval_decided_at', o.approval_decided_at,
    'can_send', jsonb_array_length(reasons) = 0 OR approval_valid,
    'limits', jsonb_build_object('enabled', coalesce(g.enabled, false),
      'max_discount_percent', g.max_discount_percent, 'min_margin_percent', g.min_margin_percent)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.offer_guardrail_evaluate_row(public.offers) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.offer_guardrail_evaluate_row(public.offers) TO service_role;

commit;
