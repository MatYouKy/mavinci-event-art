BEGIN;

-- Skrzynki w „Wiadomościach” i kontrola korespondencji:
--  1. Każdy pracownik wybiera w Ustawieniach → Powiadomienia, które z jego skrzynek (własna,
--     przypisane wspólne) widzi w Wiadomościach i z których dostaje powiadomienia
--     (employees.preferences.messages.hiddenMailboxIds / mutedMailboxIds).
--     Wyzwalacz powiadomień o nowej wiadomości respektuje ten wybór.
--  2. Administrator poczty (messages_manage) może w Ustawieniach → Konta email → Kontrola
--     korespondencji przejrzeć dowolną skrzynkę tylko do odczytu, bez zmiany statusu wiadomości.
--     Każde wejście trafia do dziennika mailbox_control_access_log.

-- 1. Powiadomienia o nowej wiadomości ---------------------------------------------------------
-- Ta sama definicja co na produkcji (31.10.2026), plus wykluczenie ukrytych i wyciszonych skrzynek.
CREATE OR REPLACE FUNCTION public.notify_new_received_email()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE notification_id uuid; account public.employee_email_accounts%ROWTYPE;
BEGIN
  SELECT * INTO account FROM public.employee_email_accounts WHERE id=NEW.email_account_id AND is_active;
  IF NOT FOUND THEN RETURN NEW; END IF;
  INSERT INTO public.notifications(title,message,type,category,action_url,related_entity_type,related_entity_id,metadata)
  VALUES('Nowa wiadomość e-mail',format('Od: %s - %s',left(coalesce(NEW.from_address,''),50),coalesce(left(NEW.subject,100),'(bez tematu)')),
    'info','email_received',format('/crm/messages/%s?type=received',NEW.id),'received_email',NEW.id,
    jsonb_build_object('email_account_id',NEW.email_account_id,'email_account_name',account.account_name,'from_address',NEW.from_address,'subject',NEW.subject))
  RETURNING id INTO notification_id;

  INSERT INTO public.notification_recipients(notification_id,user_id)
  SELECT DISTINCT notification_id,u.id FROM public.employees e
  JOIN auth.users u ON u.id=coalesce(e.auth_user_id,e.id)
  WHERE e.is_active
    AND (account.employee_id=e.id OR EXISTS (
      SELECT 1 FROM public.employee_email_account_assignments a
      WHERE a.email_account_id=account.id AND a.employee_id=e.id AND a.can_receive=true))
    AND (account.account_type='personal' OR NEW.assigned_to IS NULL OR NEW.assigned_to=e.id)
    AND (e.preferences->'notifications'->>'email_received') IS DISTINCT FROM 'false'
    AND (account.account_type<>'system' OR (e.preferences->'notifications'->>'system_messages') IS DISTINCT FROM 'false')
    -- Skrzynka ukryta albo wyciszona w Ustawieniach → Powiadomienia.
    AND NOT (coalesce(e.preferences->'messages'->'hiddenMailboxIds', '[]'::jsonb) ? account.id::text)
    AND NOT (coalesce(e.preferences->'messages'->'mutedMailboxIds', '[]'::jsonb) ? account.id::text)
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END $$;

-- 2. Kontrola korespondencji ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.current_employee_can_control_mailboxes()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT coalesce((
    SELECT NOT public.current_session_is_seller_portal()
      AND e.is_active AND 'messages_manage' = ANY(coalesce(e.permissions, '{}'::text[]))
    FROM public.employees e WHERE e.id = public.current_crm_employee_id()
  ), false);
$$;

-- Odebrane wiadomości administrator poczty widział już wcześniej (polityka received_emails);
-- wysłane — tylko z własnych i przypisanych skrzynek. Do kontroli potrzebny jest odczyt obu.
DROP POLICY IF EXISTS sent_emails_mailbox_control_read ON public.sent_emails;
CREATE POLICY sent_emails_mailbox_control_read ON public.sent_emails FOR SELECT TO authenticated
  USING (public.current_employee_can_control_mailboxes());

CREATE TABLE IF NOT EXISTS public.mailbox_control_access_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email_account_id uuid NOT NULL REFERENCES public.employee_email_accounts(id) ON DELETE CASCADE,
  viewer_employee_id uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  email_type text CHECK (email_type IS NULL OR email_type IN ('received', 'sent')),
  email_id uuid,
  viewed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mailbox_control_log_account ON public.mailbox_control_access_log(email_account_id, viewed_at DESC);
COMMENT ON TABLE public.mailbox_control_access_log IS
  'Dziennik wejść administratora w podgląd kontrolny skrzynek (kto, którą skrzynkę/wiadomość, kiedy).';
ALTER TABLE public.mailbox_control_access_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mailbox_control_access_log FROM anon, authenticated;
GRANT SELECT ON public.mailbox_control_access_log TO authenticated;
DROP POLICY IF EXISTS mailbox_control_log_read ON public.mailbox_control_access_log;
CREATE POLICY mailbox_control_log_read ON public.mailbox_control_access_log FOR SELECT TO authenticated
  USING (public.current_employee_can_control_mailboxes());

CREATE OR REPLACE FUNCTION public.log_mailbox_control_access(p_account_id uuid, p_email_type text DEFAULT NULL, p_email_id uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE viewer uuid := public.current_crm_employee_id();
BEGIN
  IF NOT public.current_employee_can_control_mailboxes() THEN
    RAISE EXCEPTION 'Kontrola korespondencji wymaga uprawnienia do zarządzania pocztą.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.employee_email_accounts WHERE id = p_account_id) THEN
    RAISE EXCEPTION 'Nie znaleziono skrzynki.' USING ERRCODE = 'P0002';
  END IF;
  IF p_email_id IS NOT NULL AND NOT (
    (p_email_type = 'received' AND EXISTS (SELECT 1 FROM public.received_emails WHERE id = p_email_id AND email_account_id = p_account_id))
    OR (p_email_type = 'sent' AND EXISTS (SELECT 1 FROM public.sent_emails WHERE id = p_email_id AND email_account_id = p_account_id))
  ) THEN
    RAISE EXCEPTION 'Wiadomość nie należy do tej skrzynki.' USING ERRCODE = '22023';
  END IF;
  -- Ponowne otwarcie tej samej skrzynki lub wiadomości w ciągu 10 minut nie dubluje wpisu.
  IF EXISTS (
    SELECT 1 FROM public.mailbox_control_access_log l
    WHERE l.email_account_id = p_account_id AND l.viewer_employee_id IS NOT DISTINCT FROM viewer
      AND l.email_id IS NOT DISTINCT FROM p_email_id AND l.viewed_at > now() - interval '10 minutes'
  ) THEN
    RETURN;
  END IF;
  INSERT INTO public.mailbox_control_access_log(email_account_id, viewer_employee_id, email_type, email_id)
  VALUES (p_account_id, viewer, CASE WHEN p_email_id IS NULL THEN NULL ELSE p_email_type END, p_email_id);
END;
$$;

-- Lista skrzynek do kontroli: bez haseł, z właścicielem, przypisanymi osobami i licznikami.
CREATE OR REPLACE FUNCTION public.get_mailbox_control_overview()
RETURNS TABLE (
  id uuid, account_name text, email_address text, account_type text, is_active boolean,
  owner_name text, assigned_names text, received_count bigint, unread_count bigint,
  sent_count bigint, last_message_at timestamptz, last_control_at timestamptz
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF NOT public.current_employee_can_control_mailboxes() THEN
    RAISE EXCEPTION 'Kontrola korespondencji wymaga uprawnienia do zarządzania pocztą.' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT a.id, a.account_name, a.email_address, a.account_type::text, a.is_active,
    nullif(concat_ws(' ', o.name, o.surname), ''),
    (SELECT string_agg(concat_ws(' ', e.name, e.surname), ', ' ORDER BY e.surname, e.name)
       FROM public.employee_email_account_assignments s JOIN public.employees e ON e.id = s.employee_id
       WHERE s.email_account_id = a.id),
    (SELECT count(*) FROM public.received_emails r WHERE r.email_account_id = a.id AND r.deleted_at IS NULL),
    (SELECT count(*) FROM public.received_emails r WHERE r.email_account_id = a.id AND r.deleted_at IS NULL AND NOT coalesce(r.is_read, false)),
    (SELECT count(*) FROM public.sent_emails s WHERE s.email_account_id = a.id AND s.deleted_at IS NULL),
    greatest(
      (SELECT max(r.received_date) FROM public.received_emails r WHERE r.email_account_id = a.id),
      (SELECT max(coalesce(s.sent_at, s.created_at)) FROM public.sent_emails s WHERE s.email_account_id = a.id)),
    (SELECT max(l.viewed_at) FROM public.mailbox_control_access_log l WHERE l.email_account_id = a.id)
  FROM public.employee_email_accounts a
  LEFT JOIN public.employees o ON o.id = a.employee_id
  ORDER BY CASE a.account_type::text WHEN 'personal' THEN 0 WHEN 'shared' THEN 1 ELSE 2 END,
    NOT a.is_active, a.account_name;
END;
$$;

REVOKE ALL ON FUNCTION public.current_employee_can_control_mailboxes(), public.log_mailbox_control_access(uuid, text, uuid),
  public.get_mailbox_control_overview() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_employee_can_control_mailboxes(), public.log_mailbox_control_access(uuid, text, uuid),
  public.get_mailbox_control_overview() TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
