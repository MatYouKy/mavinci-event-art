-- Korespondencja eventu: zakładka „Korespondencja” w CRM i na Macu, wysyłka agendy i karty weselnej e-mailem.
--
-- Prywatność poczty bez zmian (migracja 20261031180000): wiadomości ze skrzynek osobistych i wspólnych widzi osoba z dostępem
-- do skrzynki, jak w Wiadomościach — odczyt działa z uprawnieniami wywołującego. Jedyny wyjątek to wiadomości systemowe
-- o evencie (skrzynka systemowa: potwierdzenie realizacji i wysyłki ze skrzynki systemowej powiązane z eventem) — widzi je
-- każdy, kto widzi dokumenty handlowe eventu (obszar commercial_docs, jak zakładki Oferta i Umowa).
--
-- Skład korespondencji liczony przy odczycie, więc kolejne odpowiedzi dochodzą same:
--  1. wiadomości wysłane z eventu (agenda, karta weselna, kalkulacja, umowa, oferta i faktura eventu; także zaplanowane —
--     po wysyłce dochodzi wysłana wiadomość, a do tego czasu widać zlecenie),
--  2. wiadomości dołączone ręcznie („Dołącz wiadomość lub konwersację”),
--  3. korespondencja zapytań, z których powstał event,
--  4. potwierdzenia realizacji wysłane ze skrzynki systemowej (dziennik zmian eventu),
-- razem z wątkami (odpowiedzi i ten sam temat z tym samym rozmówcą w tej skrzynce — `event_mail_thread`), bez wykluczonych.
-- Wcześniejsze wysyłki (przed tą migracją) dołączamy jednorazowo, gdy powiązanie jest jednoznaczne (na końcu pliku).
BEGIN;

-- Wiadomości wysłane z eventu albo dołączone ręcznie. Zaplanowana wysyłka wskazuje zlecenie (`scheduled_emails`).
CREATE TABLE public.event_email_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  received_email_id uuid REFERENCES public.received_emails(id) ON DELETE CASCADE,
  sent_email_id uuid REFERENCES public.sent_emails(id) ON DELETE CASCADE,
  scheduled_email_id uuid REFERENCES public.scheduled_emails(id) ON DELETE CASCADE,
  include_thread boolean NOT NULL DEFAULT true,
  -- event — wysłana z eventu, manual — dołączona ręcznie, backfill — wcześniejsza wysyłka dołączona przez migrację.
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('event', 'manual', 'backfill')),
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (num_nonnulls(received_email_id, sent_email_id, scheduled_email_id) = 1)
);
CREATE UNIQUE INDEX event_email_links_received ON public.event_email_links(event_id, received_email_id) WHERE received_email_id IS NOT NULL;
CREATE UNIQUE INDEX event_email_links_sent ON public.event_email_links(event_id, sent_email_id) WHERE sent_email_id IS NOT NULL;
CREATE UNIQUE INDEX event_email_links_scheduled ON public.event_email_links(event_id, scheduled_email_id) WHERE scheduled_email_id IS NOT NULL;
CREATE INDEX event_email_links_received_email ON public.event_email_links(received_email_id) WHERE received_email_id IS NOT NULL;
CREATE INDEX event_email_links_sent_email ON public.event_email_links(sent_email_id) WHERE sent_email_id IS NOT NULL;
CREATE INDEX event_email_links_scheduled_email ON public.event_email_links(scheduled_email_id) WHERE scheduled_email_id IS NOT NULL;

-- Wiadomości wykluczone z korespondencji eventu (także odpowiedzi w wątku i wiadomości z zapytania). „Przywróć” usuwa wiersz.
CREATE TABLE public.event_email_exclusions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  received_email_id uuid REFERENCES public.received_emails(id) ON DELETE CASCADE,
  sent_email_id uuid REFERENCES public.sent_emails(id) ON DELETE CASCADE,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (num_nonnulls(received_email_id, sent_email_id) = 1)
);
CREATE UNIQUE INDEX event_email_exclusions_received ON public.event_email_exclusions(event_id, received_email_id) WHERE received_email_id IS NOT NULL;
CREATE UNIQUE INDEX event_email_exclusions_sent ON public.event_email_exclusions(event_id, sent_email_id) WHERE sent_email_id IS NOT NULL;
CREATE INDEX event_email_exclusions_received_email ON public.event_email_exclusions(received_email_id) WHERE received_email_id IS NOT NULL;
CREATE INDEX event_email_exclusions_sent_email ON public.event_email_exclusions(sent_email_id) WHERE sent_email_id IS NOT NULL;

-- Czy to własna wiadomość osoby: wysłana przez nią albo jej zlecenie wysyłki (bez ujawniania treści).
CREATE FUNCTION public.event_email_own_message(p_kind text, p_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE p_kind
    WHEN 'sent' THEN EXISTS (
      SELECT 1 FROM public.sent_emails s
      WHERE s.id = p_id AND s.deleted_at IS NULL AND s.employee_id IS NOT NULL
        AND (s.employee_id = auth.uid()
          OR EXISTS (SELECT 1 FROM public.employees e WHERE e.id = s.employee_id AND e.auth_user_id = auth.uid())))
    WHEN 'scheduled' THEN EXISTS (
      SELECT 1 FROM public.scheduled_emails j WHERE j.id = p_id AND j.created_by = auth.uid())
    ELSE false
  END;
$$;

-- Porządkowanie korespondencji eventu: zarządzanie eventem i wgląd w jego dokumenty handlowe.
CREATE FUNCTION public.event_email_can_organize(p_event uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT coalesce(public.current_employee_can_manage_event(p_event), false)
    AND coalesce(public.can_view_event_area(p_event, 'commercial_docs'), false);
$$;

-- Kto może powiązać wiadomość z eventem. Własną wiadomość wysłaną (albo zaplanowaną) z eventu — każdy, kto widzi event.
-- Ręczne dołączanie — osoba zarządzająca eventem (administrator, events_manage, sprzedawca eventu), która widzi jego dokumenty
-- handlowe, i tylko wiadomość widoczna w jej skrzynkach (podzapytania działają z uprawnieniami wywołującego).
-- Porządkowanie (wykluczanie) — te same osoby: `event_email_can_organize`.
CREATE FUNCTION public.event_email_link_allowed(p_event uuid, p_received uuid, p_sent uuid, p_scheduled uuid, p_source text)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT CASE
    WHEN p_source = 'event' AND p_received IS NULL AND (
        (p_sent IS NOT NULL AND p_scheduled IS NULL AND public.event_email_own_message('sent', p_sent))
        OR (p_scheduled IS NOT NULL AND p_sent IS NULL AND public.event_email_own_message('scheduled', p_scheduled)))
      THEN coalesce(public.current_employee_can_view_event(p_event), false)
    WHEN p_source = 'manual' AND p_scheduled IS NULL
      THEN public.event_email_can_organize(p_event) AND CASE
        WHEN p_received IS NOT NULL AND p_sent IS NULL
          THEN EXISTS (SELECT 1 FROM public.received_emails e WHERE e.id = p_received AND e.deleted_at IS NULL)
        WHEN p_sent IS NOT NULL AND p_received IS NULL
          THEN EXISTS (SELECT 1 FROM public.sent_emails e WHERE e.id = p_sent AND e.deleted_at IS NULL)
            OR public.event_email_own_message('sent', p_sent)
        ELSE false
      END
    ELSE false
  END;
$$;

ALTER TABLE public.event_email_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_email_exclusions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.event_email_links, public.event_email_exclusions FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.event_email_links TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.event_email_exclusions TO authenticated;
GRANT ALL ON public.event_email_links, public.event_email_exclusions TO service_role;

CREATE POLICY event_email_links_read ON public.event_email_links FOR SELECT TO authenticated
  USING (public.can_view_event_area(event_id, 'commercial_docs'));
CREATE POLICY event_email_links_insert ON public.event_email_links FOR INSERT TO authenticated
  WITH CHECK (public.event_email_link_allowed(event_id, received_email_id, sent_email_id, scheduled_email_id, source));
CREATE POLICY event_email_links_update ON public.event_email_links FOR UPDATE TO authenticated
  USING (public.event_email_can_organize(event_id))
  WITH CHECK (public.event_email_link_allowed(event_id, received_email_id, sent_email_id, scheduled_email_id, 'manual'));
CREATE POLICY event_email_exclusions_read ON public.event_email_exclusions FOR SELECT TO authenticated
  USING (public.can_view_event_area(event_id, 'commercial_docs'));
CREATE POLICY event_email_exclusions_insert ON public.event_email_exclusions FOR INSERT TO authenticated
  WITH CHECK (public.event_email_can_organize(event_id));
CREATE POLICY event_email_exclusions_delete ON public.event_email_exclusions FOR DELETE TO authenticated
  USING (public.event_email_can_organize(event_id));

-- Powiązanie wiadomości z eventem: p_type received | sent | scheduled (zlecenie wysyłki), p_source event | manual.
-- Ponowne powiązanie własnej wysyłki niczego nie zmienia; ręczne — ustawia „cały wątek” i zdejmuje wykluczenie.
-- Wysyłka z eventu bez ON CONFLICT: przy konflikcie Postgres sprawdza też regułę odczytu (dokumenty handlowe), a z eventu
-- wysyła też osoba bez wglądu w jego korespondencję (np. faktura z Finansów, kalkulacja sprzedawcy).
CREATE FUNCTION public.link_event_email(p_event_id uuid, p_type text, p_id uuid, p_thread boolean DEFAULT true, p_source text DEFAULT 'manual')
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  v_received uuid := CASE WHEN p_type = 'received' THEN p_id END;
  v_sent uuid := CASE WHEN p_type = 'sent' THEN p_id END;
  v_scheduled uuid := CASE WHEN p_type = 'scheduled' THEN p_id END;
  v_thread boolean := coalesce(p_thread, true);
BEGIN
  IF p_event_id IS NULL OR p_id IS NULL OR p_type NOT IN ('received', 'sent', 'scheduled') THEN
    RAISE EXCEPTION 'Nieprawidłowa wiadomość';
  END IF;
  IF p_source NOT IN ('event', 'manual') THEN RAISE EXCEPTION 'Nieprawidłowe źródło powiązania'; END IF;
  IF NOT public.event_email_link_allowed(p_event_id, v_received, v_sent, v_scheduled, p_source) THEN
    RAISE EXCEPTION 'Brak dostępu do eventu lub wiadomości' USING ERRCODE = '42501';
  END IF;
  IF p_source = 'event' THEN
    BEGIN
      INSERT INTO public.event_email_links(event_id, sent_email_id, scheduled_email_id, include_thread, source)
      VALUES (p_event_id, v_sent, v_scheduled, true, 'event');
    EXCEPTION WHEN unique_violation THEN
      NULL;
    END;
    RETURN;
  END IF;
  IF v_received IS NOT NULL THEN
    DELETE FROM public.event_email_exclusions WHERE event_id = p_event_id AND received_email_id = v_received;
    INSERT INTO public.event_email_links(event_id, received_email_id, include_thread, source)
    VALUES (p_event_id, v_received, v_thread, 'manual')
    ON CONFLICT (event_id, received_email_id) WHERE received_email_id IS NOT NULL
    DO UPDATE SET include_thread = excluded.include_thread;
  ELSE
    DELETE FROM public.event_email_exclusions WHERE event_id = p_event_id AND sent_email_id = v_sent;
    INSERT INTO public.event_email_links(event_id, sent_email_id, include_thread, source)
    VALUES (p_event_id, v_sent, v_thread, 'manual')
    ON CONFLICT (event_id, sent_email_id) WHERE sent_email_id IS NOT NULL
    DO UPDATE SET include_thread = excluded.include_thread;
  END IF;
END;
$$;

-- „Wyklucz” / „Przywróć” wiadomość w korespondencji eventu (osoba zarządzająca eventem).
CREATE FUNCTION public.exclude_event_email(p_event_id uuid, p_type text, p_id uuid, p_exclude boolean DEFAULT true)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
BEGIN
  IF p_event_id IS NULL OR p_id IS NULL OR p_type NOT IN ('received', 'sent') THEN RAISE EXCEPTION 'Nieprawidłowa wiadomość'; END IF;
  IF NOT public.event_email_can_organize(p_event_id) THEN
    RAISE EXCEPTION 'Korespondencję eventu porządkuje osoba zarządzająca eventem' USING ERRCODE = '42501';
  END IF;
  IF coalesce(p_exclude, true) THEN
    IF p_type = 'received' THEN
      INSERT INTO public.event_email_exclusions(event_id, received_email_id) VALUES (p_event_id, p_id)
      ON CONFLICT (event_id, received_email_id) WHERE received_email_id IS NOT NULL DO NOTHING;
    ELSE
      INSERT INTO public.event_email_exclusions(event_id, sent_email_id) VALUES (p_event_id, p_id)
      ON CONFLICT (event_id, sent_email_id) WHERE sent_email_id IS NOT NULL DO NOTHING;
    END IF;
  ELSIF p_type = 'received' THEN
    DELETE FROM public.event_email_exclusions WHERE event_id = p_event_id AND received_email_id = p_id;
  ELSE
    DELETE FROM public.event_email_exclusions WHERE event_id = p_event_id AND sent_email_id = p_id;
  END IF;
END;
$$;

-- Czytelny tekst wiadomości HTML: bez stylów, skryptów i nagłówka, akapity jako nowe wiersze, podstawowe encje.
CREATE FUNCTION public.email_readable_text(p_html text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = '' AS $$
  SELECT btrim(
    regexp_replace(regexp_replace(regexp_replace(regexp_replace(
      replace(replace(replace(replace(replace(replace(replace(
        regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
          coalesce(p_html, ''),
          -- Bez alternatyw na początku wzorca: grupa z „|” czyni cały wzorzec zachłannym (zjadłby treść między blokami).
          '<!--.*?-->', ' ', 'g'),
          '<head\M.*?</head\s*>', ' ', 'gi'),
          '<style\M.*?</style\s*>', ' ', 'gi'),
          '<script\M.*?</script\s*>', ' ', 'gi'),
          '<title\M.*?</title\s*>', ' ', 'gi'),
          '<br\s*/?>|</(p|div|tr|li|h[1-6]|table|blockquote)\s*>', E'\n', 'gi'),
          '<[^>]*>', ' ', 'g'),
        '&nbsp;', ' '), '&quot;', '"'), '&#39;', ''''), '&#039;', ''''), '&lt;', '<'), '&gt;', '>'), '&amp;', '&'),
      '[ \t\r\f\v]+', ' ', 'g'),
      ' ?\n ?', E'\n', 'g'),
      '\n{3,}', E'\n\n', 'g'),
      '^\s+', '', 'g'),
    E' \n');
$$;

-- Adresy i rodzaj skrzynek wskazanych wiadomości (nadawca wysłanej, oznaczenie „Systemowa”) — bez treści i uprawnień.
CREATE FUNCTION public.event_mail_accounts(p_ids uuid[])
RETURNS TABLE(id uuid, email_address text, is_system boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT a.id, coalesce(a.email_address, ''), coalesce(a.account_type, 'personal') = 'system'
  FROM public.employee_email_accounts a
  WHERE a.id = ANY(coalesce(p_ids, '{}'::uuid[]));
$$;

-- Wiadomość do zakładki: czytelny tekst (do 20 000 znaków) i lista załączników. Uprawnienia wywołującego (reguły skrzynek).
CREATE FUNCTION public.event_mail_message_json(p_type text, p_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT CASE WHEN p_type = 'received' THEN (
    SELECT jsonb_build_object(
      'type', 'received', 'id', e.id, 'email_account_id', e.email_account_id, 'subject', coalesce(e.subject, ''),
      'from_address', coalesce(e.from_address, ''), 'to_address', coalesce(e.to_address, ''), 'message_at', e.received_date,
      'body', left(coalesce(nullif(btrim(e.body_text), ''), public.email_readable_text(e.body_html)), 20000),
      'attachments', coalesce((
        SELECT jsonb_agg(jsonb_build_object('id', a.id, 'filename', a.filename, 'size', a.size_bytes) ORDER BY a.created_at, a.filename)
        FROM public.email_attachments a WHERE a.email_type = 'received' AND a.email_id = e.id), '[]'::jsonb))
    FROM public.received_emails e WHERE e.id = p_id AND e.deleted_at IS NULL)
  WHEN p_type = 'sent' THEN (
    SELECT jsonb_build_object(
      'type', 'sent', 'id', s.id, 'email_account_id', s.email_account_id, 'subject', coalesce(s.subject, ''),
      'from_address', '', 'to_address', coalesce(s.to_address, ''), 'message_at', coalesce(s.sent_at, s.created_at),
      'body', left(public.email_readable_text(s.body), 20000),
      'attachments', coalesce((
        SELECT jsonb_agg(jsonb_build_object('id', a.id, 'filename', a.filename, 'size', a.size_bytes) ORDER BY a.created_at, a.filename)
        FROM public.email_attachments a WHERE a.email_type = 'sent' AND a.email_id = s.id), '[]'::jsonb))
    FROM public.sent_emails s WHERE s.id = p_id AND s.deleted_at IS NULL)
  END;
$$;

-- Punkty wyjścia korespondencji (same identyfikatory): powiązania (zlecenia po wysyłce → wysłana wiadomość) i potwierdzenia
-- realizacji ze skrzynki systemowej. Tylko dla osoby, która widzi dokumenty handlowe eventu.
CREATE FUNCTION public.event_correspondence_seeds(p_event_id uuid)
RETURNS TABLE(type text, id uuid, include_thread boolean, source text, is_system boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
BEGIN
  IF NOT public.can_view_event_area(p_event_id, 'commercial_docs') THEN RETURN; END IF;
  RETURN QUERY
  WITH links AS (
    SELECT 'received'::text AS type, l.received_email_id AS id, l.include_thread, l.source, l.created_at
    FROM public.event_email_links l WHERE l.event_id = p_event_id AND l.received_email_id IS NOT NULL
    UNION ALL
    SELECT 'sent', l.sent_email_id, l.include_thread, l.source, l.created_at
    FROM public.event_email_links l WHERE l.event_id = p_event_id AND l.sent_email_id IS NOT NULL
    UNION ALL
    SELECT 'sent', sent.id, l.include_thread, l.source, l.created_at
    FROM public.event_email_links l
    JOIN public.scheduled_emails j ON j.id = l.scheduled_email_id AND j.status = 'sent' AND nullif(btrim(j.provider_message_id), '') IS NOT NULL
    CROSS JOIN LATERAL (
      SELECT s.id FROM public.sent_emails s
      WHERE btrim(s.message_id, '<> ') = btrim(j.provider_message_id, '<> ') AND s.deleted_at IS NULL
        AND (j.email_account_id IS NULL OR s.email_account_id = j.email_account_id)
      ORDER BY s.created_at LIMIT 1
    ) sent
    WHERE l.event_id = p_event_id
    UNION ALL
    -- Potwierdzenie realizacji (send-event-confirmation): wysyłka ze skrzynki systemowej i wpis w dzienniku eventu z adresatem.
    SELECT 'sent', s.id, true, 'confirmation', a.created_at
    FROM public.event_audit_log a
    JOIN public.sent_emails s ON s.deleted_at IS NULL
      AND s.subject LIKE 'Potwierdzenie realizacji: %'
      AND public.extract_email_address(s.to_address) = lower(btrim(a.new_value #>> '{}'))
      AND coalesce(s.sent_at, s.created_at) BETWEEN a.created_at - interval '10 minutes' AND a.created_at + interval '2 minutes'
    JOIN public.employee_email_accounts acc ON acc.id = s.email_account_id AND acc.account_type = 'system'
    WHERE a.event_id = p_event_id AND a.field_name = 'acceptance_confirmation_email' AND jsonb_typeof(a.new_value) = 'string'
  ), ranked AS (
    SELECT DISTINCT ON (links.type, links.id) links.* FROM links WHERE links.id IS NOT NULL
    ORDER BY links.type, links.id, links.include_thread DESC, links.created_at
  )
  SELECT r.type, r.id, r.include_thread, r.source,
    coalesce((
      SELECT acc.account_type = 'system' FROM public.employee_email_accounts acc
      WHERE acc.id = CASE WHEN r.type = 'received'
        THEN (SELECT e.email_account_id FROM public.received_emails e WHERE e.id = r.id)
        ELSE (SELECT s.email_account_id FROM public.sent_emails s WHERE s.id = r.id) END
    ), false)
  FROM ranked r
  ORDER BY r.created_at, r.type, r.id;
END;
$$;

-- Wątek wiadomości w jej skrzynce: ona sama, wiadomości o tym samym temacie (bez Re:/Odp:/Fwd:) z tym samym rozmówcą oraz
-- bezpośrednie odpowiedzi i poprzedniki (In-Reply-To / References). Jedno przejście po skrzynce zamiast rekurencji
-- `get_email_conversation` (w dużej skrzynce kilka sekund na wątek). Uprawnienia wywołującego (reguły skrzynek).
CREATE FUNCTION public.event_mail_thread(p_type text, p_id uuid, p_thread boolean DEFAULT true)
RETURNS TABLE(type text, id uuid, email_account_id uuid)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  WITH seed AS MATERIALIZED (
    SELECT 'received'::text AS type, e.id, e.email_account_id, btrim(coalesce(e.message_id, ''), '<> ') AS message_id,
      public.normalize_email_sales_subject(e.subject) AS topic, public.extract_email_address(e.from_address) AS participant,
      public.crm_email_reference_ids((
        SELECT string_agg(h.value::text, ' ') FROM jsonb_each(CASE WHEN jsonb_typeof(e.raw_headers) = 'object' THEN e.raw_headers ELSE '{}'::jsonb END) h
        WHERE lower(h.key) IN ('in-reply-to', 'references'))) AS reference_ids
    FROM public.received_emails e WHERE p_type = 'received' AND e.id = p_id AND e.deleted_at IS NULL
    UNION ALL
    SELECT 'sent', s.id, s.email_account_id, btrim(coalesce(s.message_id, ''), '<> '),
      public.normalize_email_sales_subject(s.subject), public.extract_email_address(s.to_address),
      public.crm_email_reference_ids(coalesce(s.in_reply_to, '') || ' ' || array_to_string(coalesce(s.email_references, '{}'), ' '))
    FROM public.sent_emails s WHERE p_type = 'sent' AND s.id = p_id AND s.deleted_at IS NULL
  ), mailbox AS (
    SELECT 'received'::text AS type, e.id, e.email_account_id, btrim(coalesce(e.message_id, ''), '<> ') AS message_id,
      e.subject, e.from_address AS participant_address, coalesce(e.raw_headers::text, '') AS reference_text
    FROM public.received_emails e JOIN seed ON e.email_account_id = seed.email_account_id
    WHERE coalesce(p_thread, true) AND e.deleted_at IS NULL
    UNION ALL
    SELECT 'sent', s.id, s.email_account_id, btrim(coalesce(s.message_id, ''), '<> '),
      s.subject, s.to_address, coalesce(s.in_reply_to, '') || ' ' || array_to_string(coalesce(s.email_references, '{}'), ' ')
    FROM public.sent_emails s JOIN seed ON s.email_account_id = seed.email_account_id
    WHERE coalesce(p_thread, true) AND s.deleted_at IS NULL
  )
  SELECT seed.type, seed.id, seed.email_account_id FROM seed
  UNION
  SELECT m.type, m.id, m.email_account_id FROM mailbox m CROSS JOIN seed
  WHERE (seed.message_id <> '' AND position(seed.message_id IN m.reference_text) > 0)
    OR (m.message_id <> '' AND m.message_id = ANY(seed.reference_ids))
    OR (length(seed.topic) > 2 AND seed.participant LIKE '%@%'
      AND public.extract_email_address(m.participant_address) = seed.participant
      AND public.normalize_email_sales_subject(m.subject) = seed.topic);
$$;

-- Wiadomości systemowe o evencie (z wątkami w skrzynce systemowej) dla osób bez dostępu do skrzynki systemowej.
CREATE FUNCTION public.event_system_correspondence(p_event_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r record;
  m record;
  seen text[] := '{}';
  k text;
  item jsonb;
  result jsonb := '[]'::jsonb;
  systems uuid[];
BEGIN
  IF NOT public.can_view_event_area(p_event_id, 'commercial_docs') THEN RETURN '[]'::jsonb; END IF;
  SELECT coalesce(array_agg(a.id), '{}') INTO systems FROM public.employee_email_accounts a WHERE a.account_type = 'system';
  FOR r IN SELECT * FROM public.event_correspondence_seeds(p_event_id) s WHERE s.is_system LOOP
    CONTINUE WHEN (r.type || ':' || r.id) = ANY(seen);
    FOR m IN SELECT * FROM public.event_mail_thread(r.type, r.id, r.include_thread) LOOP
      k := m.type || ':' || m.id;
      CONTINUE WHEN k = ANY(seen) OR m.email_account_id IS NULL OR NOT (m.email_account_id = ANY(systems));
      seen := seen || k;
      item := public.event_mail_message_json(m.type, m.id);
      IF item IS NOT NULL THEN result := result || jsonb_build_array(item); END IF;
    END LOOP;
  END LOOP;
  RETURN result;
END;
$$;

-- Zlecenia wysyłki z eventu, które jeszcze nie wyszły (zaplanowane, w trakcie, ponawiane, nieudane).
CREATE FUNCTION public.event_correspondence_scheduled(p_event_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN NOT public.can_view_event_area(p_event_id, 'commercial_docs') THEN '[]'::jsonb ELSE coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'id', j.id, 'status', j.status, 'scheduled_at', j.scheduled_at,
      'subject', coalesce(j.payload->>'subject', ''), 'to_address', coalesce(j.payload->>'to', ''),
      'error', CASE WHEN j.status = 'failed' THEN j.last_error END,
      'author', nullif(btrim(concat_ws(' ', e.name, e.surname)), '')
    ) ORDER BY j.scheduled_at, j.id)
    FROM public.event_email_links l
    JOIN public.scheduled_emails j ON j.id = l.scheduled_email_id
    LEFT JOIN LATERAL (
      SELECT p.name, p.surname FROM public.employees p
      WHERE p.id = j.created_by OR p.auth_user_id = j.created_by
      ORDER BY (p.id = j.created_by) DESC LIMIT 1
    ) e ON true
    WHERE l.event_id = p_event_id AND j.status IN ('scheduled', 'processing', 'retry', 'failed')
  ), '[]'::jsonb) END;
$$;

-- Korespondencja eventu dla zakładki „Korespondencja” (od najstarszej). Każda wiadomość: type, id, subject, from_address,
-- to_address, message_at, body (tekst), attachments, source (event | manual | backfill | confirmation | inquiry | thread),
-- system (skrzynka systemowa), accessible (widoczna w skrzynkach osoby — można ją otworzyć w Wiadomościach).
CREATE FUNCTION public.get_event_correspondence(p_event_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public AS $$
DECLARE
  r record;
  m record;
  item jsonb;
  k text;
  seen text[] := '{}';
  accessible_keys text[] := '{}';
  origin jsonb := '{}'::jsonb;
  seed_origin jsonb := '{}'::jsonb;
  excluded_keys text[];
  inquiry_excluded text[];
  collected jsonb := '{}'::jsonb;
  messages jsonb := '[]'::jsonb;
  excluded_list jsonb := '[]'::jsonb;
  accounts jsonb;
BEGIN
  IF NOT public.can_view_event_area(p_event_id, 'commercial_docs') THEN
    RAISE EXCEPTION 'Brak dostępu do korespondencji tego eventu' USING ERRCODE = '42501';
  END IF;
  SELECT coalesce(array_agg(CASE WHEN x.received_email_id IS NOT NULL THEN 'received:' || x.received_email_id ELSE 'sent:' || x.sent_email_id END), '{}')
  INTO excluded_keys FROM public.event_email_exclusions x WHERE x.event_id = p_event_id;

  -- 1. Powiązania i potwierdzenia z wątkami — z uprawnieniami osoby (tylko jej skrzynki).
  FOR r IN SELECT * FROM public.event_correspondence_seeds(p_event_id) LOOP
    k := r.type || ':' || r.id;
    seed_origin := seed_origin || jsonb_build_object(k, r.source);
    CONTINUE WHEN k = ANY(seen);
    FOR m IN SELECT * FROM public.event_mail_thread(r.type, r.id, r.include_thread) LOOP
      k := m.type || ':' || m.id;
      CONTINUE WHEN k = ANY(seen);
      seen := seen || k;
      accessible_keys := accessible_keys || k;
      origin := origin || jsonb_build_object(k, 'thread');
    END LOOP;
  END LOOP;

  -- 2. Korespondencja zapytań, z których powstał event: wiadomość źródłowa i dołączone do zapytania (bez wykluczonych tam),
  -- z wątkami — reguły zapytania i skrzynek osoby.
  SELECT coalesce(array_agg(CASE WHEN l.received_email_id IS NOT NULL THEN 'received:' || l.received_email_id ELSE 'sent:' || l.sent_email_id END), '{}')
  INTO inquiry_excluded
  FROM public.tasks t JOIN public.inquiry_email_links l ON l.inquiry_id = t.id
  WHERE t.event_id = p_event_id AND t.is_inquiry AND l.excluded;
  FOR r IN
    SELECT CASE WHEN l.received_email_id IS NOT NULL THEN 'received' ELSE 'sent' END AS type,
      coalesce(l.received_email_id, l.sent_email_id) AS id, l.include_thread
    FROM public.tasks t JOIN public.inquiry_email_links l ON l.inquiry_id = t.id
    WHERE t.event_id = p_event_id AND t.is_inquiry AND NOT l.excluded
    UNION ALL
    SELECT CASE WHEN t.inquiry_details ? 'received_email_id' THEN 'received' ELSE t.inquiry_details->>'source_message_type' END,
      coalesce(t.inquiry_details->>'received_email_id', t.inquiry_details->>'source_message_id')::uuid, true
    FROM public.tasks t
    WHERE t.event_id = p_event_id AND t.is_inquiry
      AND coalesce(t.inquiry_details->>'received_email_id', t.inquiry_details->>'source_message_id', '') ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
  LOOP
    CONTINUE WHEN r.type NOT IN ('received', 'sent') OR (r.type || ':' || r.id) = ANY(seen) OR (r.type || ':' || r.id) = ANY(inquiry_excluded);
    FOR m IN SELECT * FROM public.event_mail_thread(r.type, r.id, r.include_thread) LOOP
      k := m.type || ':' || m.id;
      CONTINUE WHEN k = ANY(seen) OR k = ANY(inquiry_excluded);
      seen := seen || k;
      accessible_keys := accessible_keys || k;
      origin := origin || jsonb_build_object(k, 'inquiry');
    END LOOP;
  END LOOP;

  FOREACH k IN ARRAY accessible_keys LOOP
    item := public.event_mail_message_json(split_part(k, ':', 1), split_part(k, ':', 2)::uuid);
    CONTINUE WHEN item IS NULL;
    collected := collected || jsonb_build_object(k, item || jsonb_build_object('accessible', true,
      'source', coalesce(seed_origin->>k, origin->>k, 'thread')));
  END LOOP;

  -- 3. Wiadomości systemowe o evencie — także dla osób bez dostępu do skrzynki systemowej.
  FOR item IN SELECT value FROM jsonb_array_elements(public.event_system_correspondence(p_event_id)) LOOP
    k := (item->>'type') || ':' || (item->>'id');
    CONTINUE WHEN collected ? k;
    collected := collected || jsonb_build_object(k, item || jsonb_build_object('accessible', false,
      'source', coalesce(seed_origin->>k, 'thread')));
  END LOOP;

  SELECT coalesce(jsonb_object_agg(a.id::text, jsonb_build_object('email', a.email_address, 'system', a.is_system)), '{}'::jsonb)
  INTO accounts
  FROM public.event_mail_accounts(ARRAY(
    SELECT DISTINCT (v.value->>'email_account_id')::uuid FROM jsonb_each(collected) v WHERE v.value->>'email_account_id' IS NOT NULL
  )) a;

  SELECT
    coalesce(jsonb_agg(
      v.value || jsonb_build_object(
        'system', coalesce((accounts->(v.value->>'email_account_id')->>'system')::boolean, false),
        'from_address', CASE WHEN v.value->>'type' = 'sent'
          THEN coalesce(accounts->(v.value->>'email_account_id')->>'email', '') ELSE v.value->>'from_address' END)
      ORDER BY (v.value->>'message_at')::timestamptz, v.key) FILTER (WHERE NOT (v.key = ANY(excluded_keys))), '[]'::jsonb),
    coalesce(jsonb_agg(jsonb_build_object('type', v.value->>'type', 'id', v.value->>'id', 'subject', v.value->>'subject',
      'message_at', v.value->>'message_at') ORDER BY (v.value->>'message_at')::timestamptz DESC, v.key)
      FILTER (WHERE v.key = ANY(excluded_keys)), '[]'::jsonb)
  INTO messages, excluded_list
  FROM jsonb_each(collected) v;

  -- Wykluczone wiadomości spoza zebranych (np. odpowiedź, której osoba nie widzi) — tylko identyfikator, bez treści.
  SELECT excluded_list || coalesce(jsonb_agg(jsonb_build_object('type', split_part(x, ':', 1), 'id', split_part(x, ':', 2),
    'subject', NULL, 'message_at', NULL)), '[]'::jsonb)
  INTO excluded_list
  FROM unnest(excluded_keys) x WHERE NOT (collected ? x);

  RETURN jsonb_build_object(
    'messages', messages,
    'excluded', excluded_list,
    'scheduled', public.event_correspondence_scheduled(p_event_id),
    'can_manage', public.event_email_can_organize(p_event_id),
    'signature', md5(messages::text || excluded_list::text)
  );
END;
$$;

-- „Inne wiadomości z klientem”: niepowiązane wiadomości z adresami klienta eventu (osoba kontaktowa, organizacja i jej
-- osoby, domeny korespondencji organizacji) w okresie eventu — tylko ze skrzynek osoby; do ręcznego dołączenia.
CREATE FUNCTION public.get_event_correspondence_suggestions(p_event_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public AS $$
DECLARE
  ev record;
  addresses text[];
  domains text[] := '{}';
  window_start timestamptz;
  window_end timestamptz;
  result jsonb;
BEGIN
  IF NOT public.can_view_event_area(p_event_id, 'commercial_docs') THEN
    RAISE EXCEPTION 'Brak dostępu do korespondencji tego eventu' USING ERRCODE = '42501';
  END IF;
  SELECT e.created_at, e.event_date, e.event_end_date, e.contact_person_id, e.organization_id INTO ev
  FROM public.events e WHERE e.id = p_event_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('messages', '[]'::jsonb, 'addresses', '[]'::jsonb); END IF;
  SELECT coalesce(array_agg(DISTINCT x.address), '{}') INTO addresses FROM (
    SELECT lower(btrim(c.email)) AS address FROM public.contacts c WHERE c.id = ev.contact_person_id
    UNION ALL
    SELECT lower(btrim(o.email)) FROM public.organizations o WHERE o.id = ev.organization_id
    UNION ALL
    SELECT lower(btrim(c.email)) FROM public.contact_organizations co JOIN public.contacts c ON c.id = co.contact_id
    WHERE ev.organization_id IS NOT NULL AND co.organization_id = ev.organization_id AND co.is_current IS NOT FALSE
  ) x WHERE x.address LIKE '_%@_%.__%';
  IF ev.organization_id IS NOT NULL THEN
    SELECT coalesce(o.correspondence_domains, '{}') INTO domains FROM public.organizations o WHERE o.id = ev.organization_id;
    domains := coalesce(domains, '{}');
  END IF;
  IF cardinality(addresses) = 0 AND cardinality(domains) = 0 THEN
    RETURN jsonb_build_object('messages', '[]'::jsonb, 'addresses', '[]'::jsonb);
  END IF;
  window_start := least(coalesce(ev.created_at, now()), coalesce(ev.event_date, now())) - interval '180 days';
  window_end := greatest(coalesce(ev.event_end_date, ev.event_date, now()), coalesce(ev.created_at, now())) + interval '120 days';
  WITH candidates AS (
    SELECT 'received'::text AS type, e.id, coalesce(e.subject, '') AS subject, coalesce(e.from_address, '') AS from_address,
      coalesce(e.to_address, '') AS to_address, e.received_date AS message_at
    FROM public.received_emails e
    WHERE e.deleted_at IS NULL AND e.received_date BETWEEN window_start AND window_end
      AND (public.extract_email_address(e.from_address) = ANY(addresses)
        OR split_part(public.extract_email_address(e.from_address), '@', 2) = ANY(domains))
    UNION ALL
    SELECT 'sent', s.id, coalesce(s.subject, ''), '', coalesce(s.to_address, ''), coalesce(s.sent_at, s.created_at)
    FROM public.sent_emails s
    WHERE s.deleted_at IS NULL AND coalesce(s.sent_at, s.created_at) BETWEEN window_start AND window_end
      AND EXISTS (
        SELECT 1 FROM regexp_matches(lower(coalesce(s.to_address, '')), '([a-z0-9.!#$%&''*+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+)', 'g') AS found(parts)
        WHERE found.parts[1] = ANY(addresses) OR split_part(found.parts[1], '@', 2) = ANY(domains))
  )
  SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY c.message_at DESC, c.type, c.id), '[]'::jsonb) INTO result
  FROM (SELECT * FROM candidates ORDER BY message_at DESC, type, id LIMIT 60) c;
  RETURN jsonb_build_object('messages', result, 'addresses', to_jsonb(addresses));
END;
$$;

REVOKE ALL ON FUNCTION
  public.event_email_own_message(text, uuid),
  public.event_email_can_organize(uuid),
  public.event_email_link_allowed(uuid, uuid, uuid, uuid, text),
  public.link_event_email(uuid, text, uuid, boolean, text),
  public.exclude_event_email(uuid, text, uuid, boolean),
  public.email_readable_text(text),
  public.event_mail_accounts(uuid[]),
  public.event_mail_message_json(text, uuid),
  public.event_mail_thread(text, uuid, boolean),
  public.event_correspondence_seeds(uuid),
  public.event_system_correspondence(uuid),
  public.event_correspondence_scheduled(uuid),
  public.get_event_correspondence(uuid),
  public.get_event_correspondence_suggestions(uuid)
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION
  public.event_email_own_message(text, uuid),
  public.event_email_can_organize(uuid),
  public.event_email_link_allowed(uuid, uuid, uuid, uuid, text),
  public.link_event_email(uuid, text, uuid, boolean, text),
  public.exclude_event_email(uuid, text, uuid, boolean),
  public.email_readable_text(text),
  public.event_mail_accounts(uuid[]),
  public.event_mail_message_json(text, uuid),
  public.event_mail_thread(text, uuid, boolean),
  public.event_correspondence_seeds(uuid),
  public.event_system_correspondence(uuid),
  public.event_correspondence_scheduled(uuid),
  public.get_event_correspondence(uuid),
  public.get_event_correspondence_suggestions(uuid)
TO authenticated, service_role;

-- Wcześniejsze wysyłki — jednorazowo, tylko jednoznaczne powiązania (źródło „backfill”).
-- a) Załącznik o nazwie pliku z folderu eventu (PDF agendy, umowy, kalkulacji, oferty) — nazwa występuje w jednym evencie.
WITH files AS (
  SELECT DISTINCT f.event_id, regexp_replace(f.file_path, '^.*/', '') AS name
  FROM public.event_files f WHERE f.event_id IS NOT NULL AND nullif(f.file_path, '') IS NOT NULL
), unique_files AS (
  SELECT name, min(event_id::text)::uuid AS event_id FROM files GROUP BY name HAVING count(DISTINCT event_id) = 1
)
INSERT INTO public.event_email_links(event_id, sent_email_id, include_thread, source, created_by)
SELECT DISTINCT u.event_id, a.email_id, true, 'backfill', NULL::uuid
FROM public.email_attachments a
JOIN unique_files u ON u.name = a.filename
JOIN public.sent_emails s ON s.id = a.email_id AND s.deleted_at IS NULL
WHERE a.email_type = 'sent'
ON CONFLICT DO NOTHING;

-- b) Numer oferty albo faktury eventu w temacie wysłanej wiadomości — numer pasuje do dokumentów jednego eventu.
WITH documents AS (
  SELECT o.event_id, o.offer_number AS number FROM public.offers o
  WHERE o.event_id IS NOT NULL AND length(btrim(coalesce(o.offer_number, ''))) >= 6
  UNION
  SELECT i.event_id, i.invoice_number FROM public.invoices i
  WHERE i.event_id IS NOT NULL AND length(btrim(coalesce(i.invoice_number, ''))) >= 5
), patterns AS (
  SELECT DISTINCT d.event_id,
    '(^|[^0-9a-z/])' || regexp_replace(btrim(d.number), '([.^$*+?()\[\]{}|\\/-])', '\\\1', 'g') || '($|[^0-9a-z/])' AS pattern
  FROM documents d
), matches AS (
  SELECT s.id AS sent_email_id, p.event_id
  FROM public.sent_emails s
  JOIN patterns p ON coalesce(s.subject, '') ~* p.pattern
  WHERE s.deleted_at IS NULL
), unique_matches AS (
  SELECT sent_email_id, min(event_id::text)::uuid AS event_id FROM matches
  GROUP BY sent_email_id HAVING count(DISTINCT event_id) = 1
)
INSERT INTO public.event_email_links(event_id, sent_email_id, include_thread, source, created_by)
SELECT u.event_id, u.sent_email_id, true, 'backfill', NULL::uuid FROM unique_matches u
ON CONFLICT DO NOTHING;

-- c) Zaplanowane wysyłki z oznaczeniem eventu (kalkulacja, umowa, karta weselna).
INSERT INTO public.event_email_links(event_id, scheduled_email_id, include_thread, source, created_by)
SELECT e.id, j.id, true, 'backfill', NULL::uuid
FROM public.scheduled_emails j
JOIN public.events e ON e.id::text = j.metadata->>'eventId'
ON CONFLICT DO NOTHING;

COMMIT;
