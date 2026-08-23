/*
  # Automatyczne zapytania z formularzy i webhooków

  Każda nowa wiadomość z formularza oraz każde zdarzenie webhookowe tworzy
  zadanie oznaczone jako zapytanie. Zadanie ma najwyższy priorytet i zachowuje
  identyfikator źródła, dzięki czemu ten sam rekord nie może utworzyć duplikatu.
*/

CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_unique_contact_message_inquiry
  ON public.tasks ((inquiry_details ->> 'source_message_id'))
  WHERE is_inquiry = true
    AND inquiry_details ->> 'source_kind' = 'contact_form'
    AND inquiry_details ? 'source_message_id';

CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_unique_webhook_inquiry
  ON public.tasks ((inquiry_details ->> 'inbound_event_id'))
  WHERE is_inquiry = true
    AND inquiry_details ->> 'source_kind' = 'webhook'
    AND inquiry_details ? 'inbound_event_id';

CREATE OR REPLACE FUNCTION public.create_inquiry_from_contact_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_id uuid;
  v_title text;
  v_description text;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.tasks t
    WHERE t.is_inquiry = true
      AND t.inquiry_details ->> 'source_kind' = 'contact_form'
      AND t.inquiry_details ->> 'source_message_id' = NEW.id::text
  ) THEN
    RETURN NEW;
  END IF;

  SELECT e.id
  INTO v_admin_id
  FROM public.employees e
  WHERE e.is_active = true
    AND (e.role = 'admin' OR e.access_level = 'admin')
  ORDER BY e.created_at ASC
  LIMIT 1;

  v_title := left(
    'Zapytanie: ' || COALESCE(NULLIF(btrim(NEW.name), ''), NULLIF(btrim(NEW.email), ''), 'formularz WWW'),
    500
  );

  v_description := concat_ws(E'\n',
    'Źródło: formularz na stronie ' || COALESCE(NULLIF(NEW.source_page, ''), 'mavinci.pl'),
    CASE WHEN NULLIF(NEW.subject, '') IS NOT NULL THEN 'Temat: ' || NEW.subject END,
    CASE WHEN NULLIF(NEW.name, '') IS NOT NULL THEN 'Nadawca: ' || NEW.name END,
    CASE WHEN NULLIF(NEW.company, '') IS NOT NULL THEN 'Firma: ' || NEW.company END,
    CASE WHEN NULLIF(NEW.email, '') IS NOT NULL THEN 'E-mail: ' || NEW.email END,
    CASE WHEN NULLIF(NEW.phone, '') IS NOT NULL THEN 'Telefon: ' || NEW.phone END,
    '',
    'Treść wiadomości:',
    COALESCE(NULLIF(NEW.message, ''), 'Brak treści wiadomości')
  );

  BEGIN
    INSERT INTO public.tasks (
      title,
      description,
      priority,
      status,
      board_column,
      order_index,
      created_by,
      is_inquiry,
      inquiry_details
    ) VALUES (
      v_title,
      left(v_description, 10000),
      'urgent',
      'todo',
      'todo',
      0,
      v_admin_id,
      true,
      jsonb_strip_nulls(jsonb_build_object(
        'source_kind', 'contact_form',
        'source_message_id', NEW.id,
        'source_message_type', 'contact_form',
        'source_message_date', NEW.created_at,
        'source_message_content', NEW.message,
        'source_page', NEW.source_page,
        'category', NEW.category,
        'subject', NEW.subject,
        'client_text', NEW.name,
        'client_email', NEW.email,
        'client_phone', NEW.phone,
        'client_company', NEW.company
      ))
    );
  EXCEPTION
    WHEN unique_violation THEN
      NULL;
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_create_inquiry_from_contact_message ON public.contact_messages;
CREATE TRIGGER trigger_create_inquiry_from_contact_message
  AFTER INSERT ON public.contact_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.create_inquiry_from_contact_message();

CREATE OR REPLACE FUNCTION public.create_inquiry_from_inbound_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_id uuid;
  v_source_name text;
  v_source_slug text;
  v_description text;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.tasks t
    WHERE t.is_inquiry = true
      AND t.inquiry_details ->> 'source_kind' = 'webhook'
      AND t.inquiry_details ->> 'inbound_event_id' = NEW.id::text
  ) THEN
    RETURN NEW;
  END IF;

  SELECT ws.name, ws.slug
  INTO v_source_name, v_source_slug
  FROM public.webhook_sources ws
  WHERE ws.id = NEW.source_id;

  SELECT e.id
  INTO v_admin_id
  FROM public.employees e
  WHERE e.is_active = true
    AND (e.role = 'admin' OR e.access_level = 'admin')
  ORDER BY e.created_at ASC
  LIMIT 1;

  v_description := concat_ws(E'\n',
    'Źródło: ' || COALESCE(v_source_name, v_source_slug, 'webhook'),
    'Typ zdarzenia: ' || NEW.event_type,
    CASE WHEN NULLIF(NEW.metadata ->> 'name', '') IS NOT NULL
      THEN 'Nadawca: ' || (NEW.metadata ->> 'name') END,
    CASE WHEN NULLIF(NEW.metadata ->> 'email', '') IS NOT NULL
      THEN 'E-mail: ' || (NEW.metadata ->> 'email') END,
    CASE WHEN NULLIF(NEW.metadata ->> 'phone', '') IS NOT NULL
      THEN 'Telefon: ' || (NEW.metadata ->> 'phone') END,
    '',
    'Treść wiadomości:',
    COALESCE(NULLIF(NEW.body, ''), NEW.title)
  );

  BEGIN
    INSERT INTO public.tasks (
      title,
      description,
      priority,
      status,
      board_column,
      order_index,
      created_by,
      is_inquiry,
      inquiry_details
    ) VALUES (
      left('Zapytanie: ' || NEW.title, 500),
      left(v_description, 10000),
      'urgent',
      'todo',
      'todo',
      0,
      v_admin_id,
      true,
      jsonb_strip_nulls(jsonb_build_object(
        'source_kind', 'webhook',
        'inbound_event_id', NEW.id,
        'external_event_id', NEW.external_event_id,
        'source_id', NEW.source_id,
        'source_name', v_source_name,
        'source_slug', v_source_slug,
        'event_type', NEW.event_type,
        'event_time', NEW.event_time,
        'source_message_content', NEW.body,
        'detail_url', NEW.detail_url,
        'client_text', COALESCE(NEW.metadata ->> 'name', NEW.metadata ->> 'client_name'),
        'client_email', NEW.metadata ->> 'email',
        'client_phone', NEW.metadata ->> 'phone',
        'metadata', NEW.metadata
      ))
    );
  EXCEPTION
    WHEN unique_violation THEN
      NULL;
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_create_inquiry_from_inbound_event ON public.inbound_events;
CREATE TRIGGER trigger_create_inquiry_from_inbound_event
  AFTER INSERT ON public.inbound_events
  FOR EACH ROW
  EXECUTE FUNCTION public.create_inquiry_from_inbound_event();

COMMENT ON FUNCTION public.create_inquiry_from_contact_message() IS
  'Tworzy pilne zapytanie w tasks dla każdej wiadomości zapisanej w contact_messages.';

COMMENT ON FUNCTION public.create_inquiry_from_inbound_event() IS
  'Tworzy pilne zapytanie w tasks dla każdego zdarzenia przyjętego przez webhook.';
