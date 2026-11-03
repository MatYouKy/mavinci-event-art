BEGIN;

-- Mailbox membership grants housekeeping, not global message management.
CREATE OR REPLACE FUNCTION public.can_trash_mailbox(p_account uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
 SELECT NOT public.current_session_is_seller_portal() AND EXISTS (
   SELECT 1 FROM public.employees e JOIN public.employee_email_accounts a ON a.id=p_account
   WHERE e.id=public.current_crm_employee_id() AND e.is_active AND a.is_active
     AND (e.role='admin' OR e.access_level='admin' OR coalesce(e.permissions,'{}') && ARRAY['admin','messages_view','messages_manage'])
     AND (a.employee_id=e.id OR EXISTS (SELECT 1 FROM public.employee_email_account_assignments s
       WHERE s.email_account_id=a.id AND s.employee_id=e.id))
 );
$$;
CREATE OR REPLACE FUNCTION public.get_mailbox_trash_permissions()
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
 SELECT a.id FROM public.employee_email_accounts a WHERE public.can_trash_mailbox(a.id);
$$;

ALTER TABLE public.received_emails ADD COLUMN IF NOT EXISTS trash_original_mailbox text;
ALTER TABLE public.sent_emails ADD COLUMN IF NOT EXISTS trash_original_mailbox text;
ALTER TABLE public.sent_emails ADD COLUMN IF NOT EXISTS imap_mailbox text;
ALTER TABLE public.sent_emails ADD COLUMN IF NOT EXISTS imap_uid bigint;
ALTER TABLE public.sent_emails ADD COLUMN IF NOT EXISTS imap_uidvalidity text;

CREATE TABLE IF NOT EXISTS public.email_trash_operations (
 email_type text NOT NULL CHECK(email_type IN ('received','sent')),
 email_id uuid NOT NULL,
 action text NOT NULL CHECK(action IN ('trash','restore')),
 token uuid NOT NULL,
 state text NOT NULL CHECK(state IN ('pending','failed','done')),
 started_at timestamptz NOT NULL DEFAULT now(),
 actor_id uuid NOT NULL,
 PRIMARY KEY(email_type,email_id)
);
ALTER TABLE public.email_trash_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.email_trash_operations FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.email_trash_operations TO service_role;

CREATE OR REPLACE FUNCTION public.begin_email_trash_operation(p_type text,p_id uuid,p_action text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE tab text; m jsonb; op public.email_trash_operations%ROWTYPE; tok uuid := gen_random_uuid();
BEGIN
 IF p_type NOT IN ('received','sent') OR p_action NOT IN ('trash','restore') OR p_type IS NULL OR p_action IS NULL THEN
   RAISE EXCEPTION 'Nieprawidłowa operacja.' USING ERRCODE='22023';
 END IF;
 tab := CASE p_type WHEN 'received' THEN 'received_emails' ELSE 'sent_emails' END;
 EXECUTE format('SELECT to_jsonb(e) FROM public.%I e WHERE id=$1 FOR UPDATE',tab) INTO m USING p_id;
 IF m IS NULL OR NOT public.can_trash_mailbox((m->>'email_account_id')::uuid) THEN
   RAISE EXCEPTION 'Brak uprawnień do porządkowania tej skrzynki.' USING ERRCODE='42501';
 END IF;
 IF nullif(m->>'message_id','') IS NULL THEN
   RAISE EXCEPTION 'Wiadomość nie ma identyfikatora serwera. Nie można bezpiecznie przenieść jej do kosza.';
 END IF;
 SELECT * INTO op FROM public.email_trash_operations WHERE email_type=p_type AND email_id=p_id;
 IF FOUND AND op.state <> 'done' THEN
   IF op.action<>p_action THEN RAISE EXCEPTION 'Najpierw ponów poprzednią operację, aby uzgodnić stan z serwerem pocztowym.'; END IF;
   IF op.state='pending' AND op.started_at>now()-interval '90 seconds' THEN
     RAISE EXCEPTION 'Trwa synchronizacja tej wiadomości. Poczekaj chwilę.';
   END IF;
 END IF;
 INSERT INTO public.email_trash_operations(email_type,email_id,action,token,state,actor_id)
 VALUES(p_type,p_id,p_action,tok,'pending',public.current_crm_employee_id())
 ON CONFLICT(email_type,email_id) DO UPDATE SET action=excluded.action,token=excluded.token,state='pending',started_at=now(),actor_id=excluded.actor_id;
 RETURN jsonb_build_object('token',tok,'accountId',m->>'email_account_id','messageId',m->>'message_id',
   'mailbox',coalesce(m->>'imap_mailbox',m#>>'{delivery_archive,sentCopy,mailbox}'),
   'imapUid',m->>'imap_uid','imapUidValidity',m->>'imap_uidvalidity','originalMailbox',m->>'trash_original_mailbox');
END $$;

-- Only the trusted IMAP bridge may acknowledge a move. A timeout leaves a
-- recoverable operation; retrying reconciles source and destination by identity.
CREATE OR REPLACE FUNCTION public.finish_email_trash_operation(p_type text,p_id uuid,p_token uuid,p_result jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE tab text; op public.email_trash_operations%ROWTYPE;
BEGIN
 IF p_type NOT IN ('received','sent') OR p_type IS NULL THEN RAISE EXCEPTION 'Nieprawidłowy typ.'; END IF;
 tab := CASE p_type WHEN 'received' THEN 'received_emails' ELSE 'sent_emails' END;
 EXECUTE format('SELECT id FROM public.%I WHERE id=$1 FOR UPDATE',tab) USING p_id;
 SELECT * INTO op FROM public.email_trash_operations WHERE email_type=p_type AND email_id=p_id AND token=p_token FOR UPDATE;
 IF NOT FOUND OR op.state<>'pending' THEN RAISE EXCEPTION 'Stan operacji zmienił się. Odśwież wiadomość.'; END IF;
 IF p_result->>'success'='true' THEN
   IF nullif(p_result->>'mailbox','') IS NULL OR nullif(p_result->>'originalMailbox','') IS NULL THEN RAISE EXCEPTION 'Brak potwierdzenia folderu.'; END IF;
   EXECUTE format('UPDATE public.%I SET deleted_at=CASE WHEN $2=''trash'' THEN coalesce(deleted_at,now()) ELSE NULL END,
     imap_mailbox=$3,imap_uid=$4,imap_uidvalidity=$5,trash_original_mailbox=CASE WHEN $2=''trash'' THEN $6 ELSE NULL END WHERE id=$1',tab)
   USING p_id,op.action,p_result->>'mailbox',nullif(p_result->>'uid','')::bigint,p_result->>'uidValidity',p_result->>'originalMailbox';
   UPDATE public.email_trash_operations SET state='done' WHERE email_type=p_type AND email_id=p_id;
 ELSE
   UPDATE public.email_trash_operations SET state='failed' WHERE email_type=p_type AND email_id=p_id;
 END IF;
END $$;

-- Do not allow direct API writes to bypass IMAP confirmation or change identity.
CREATE OR REPLACE FUNCTION public.guard_email_trash_sync()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
 IF current_user IN ('authenticated','anon') AND (
   NEW.deleted_at IS DISTINCT FROM OLD.deleted_at OR NEW.email_account_id IS DISTINCT FROM OLD.email_account_id
   OR NEW.message_id IS DISTINCT FROM OLD.message_id OR NEW.imap_mailbox IS DISTINCT FROM OLD.imap_mailbox
   OR NEW.imap_uid IS DISTINCT FROM OLD.imap_uid OR NEW.imap_uidvalidity IS DISTINCT FROM OLD.imap_uidvalidity
   OR NEW.trash_original_mailbox IS DISTINCT FROM OLD.trash_original_mailbox) THEN
   RAISE EXCEPTION 'Przenoszenie poczty wymaga synchronizacji z serwerem pocztowym.' USING ERRCODE='42501';
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS guard_email_trash_sync ON public.received_emails;
CREATE TRIGGER guard_email_trash_sync BEFORE UPDATE ON public.received_emails FOR EACH ROW EXECUTE FUNCTION public.guard_email_trash_sync();
DROP TRIGGER IF EXISTS guard_email_trash_sync ON public.sent_emails;
CREATE TRIGGER guard_email_trash_sync BEFORE UPDATE ON public.sent_emails FOR EACH ROW EXECUTE FUNCTION public.guard_email_trash_sync();
REVOKE DELETE ON public.received_emails,public.sent_emails FROM authenticated,anon;
REVOKE ALL ON FUNCTION public.can_trash_mailbox(uuid),public.get_mailbox_trash_permissions(),public.begin_email_trash_operation(text,uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.can_trash_mailbox(uuid),public.get_mailbox_trash_permissions(),public.begin_email_trash_operation(text,uuid,text) TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.finish_email_trash_operation(text,uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.finish_email_trash_operation(text,uuid,uuid,jsonb) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
