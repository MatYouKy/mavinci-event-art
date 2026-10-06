BEGIN;

-- Keep all existing entity kinds while allowing an email to be identified correctly.
DO $$
DECLARE definition text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO definition FROM pg_constraint
  WHERE conrelid='public.notifications'::regclass AND conname='notifications_related_entity_type_check';
  IF definition IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.notifications DROP CONSTRAINT notifications_related_entity_type_check';
    EXECUTE 'ALTER TABLE public.notifications ADD CONSTRAINT notifications_related_entity_type_check CHECK (('
      || substring(definition FROM 7) || ') OR related_entity_type IN (''received_email'',''received_emails''))';
  END IF;
END $$;

-- No administrator override: notifications require actual mailbox membership.
CREATE OR REPLACE FUNCTION public.mailbox_notification_allowed(p_notification uuid, p_user uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE n public.notifications%ROWTYPE; account_id uuid;
BEGIN
  SELECT * INTO n FROM public.notifications WHERE id=p_notification;
  IF NOT FOUND THEN RETURN false; END IF;
  IF NOT coalesce((n.category='email_received' OR n.related_entity_type IN ('received_email','received_emails')
    OR n.metadata ? 'email_account_id' OR coalesce(n.action_url,'') LIKE '/crm/messages/%type=received%'),false) THEN
    RETURN true;
  END IF;
  SELECT email_account_id INTO account_id FROM public.received_emails WHERE id::text=n.related_entity_id::text;
  IF account_id IS NULL THEN
    SELECT id INTO account_id FROM public.employee_email_accounts WHERE id::text=n.metadata->>'email_account_id';
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM public.employee_email_accounts a JOIN public.employees e
      ON e.id=p_user OR e.auth_user_id=p_user
    WHERE a.id=account_id AND a.is_active AND e.is_active
      AND (a.employee_id=e.id OR EXISTS (
        SELECT 1 FROM public.employee_email_account_assignments x
        WHERE x.email_account_id=a.id AND x.employee_id=e.id AND x.can_receive=true
      ))
  );
END $$;
REVOKE ALL ON FUNCTION public.mailbox_notification_allowed(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.mailbox_notification_allowed(uuid,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.current_user_mailbox_notification_allowed(p_notification uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
  SELECT public.mailbox_notification_allowed(p_notification,auth.uid());
$$;
REVOKE ALL ON FUNCTION public.current_user_mailbox_notification_allowed(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.current_user_mailbox_notification_allowed(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.guard_mailbox_notification_recipient()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  IF NOT public.mailbox_notification_allowed(NEW.notification_id,NEW.user_id) THEN RETURN NULL; END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_mailbox_notification_recipient() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS guard_mailbox_notification_recipient ON public.notification_recipients;
CREATE TRIGGER guard_mailbox_notification_recipient BEFORE INSERT OR UPDATE OF notification_id,user_id
  ON public.notification_recipients FOR EACH ROW EXECUTE FUNCTION public.guard_mailbox_notification_recipient();

-- Hide old, incorrectly routed email notifications without deleting history.
DROP POLICY IF EXISTS mailbox_notification_membership ON public.notifications;
CREATE POLICY mailbox_notification_membership ON public.notifications AS RESTRICTIVE
  FOR SELECT TO authenticated USING(public.current_user_mailbox_notification_allowed(id));
DROP POLICY IF EXISTS mailbox_recipient_membership ON public.notification_recipients;
CREATE POLICY mailbox_recipient_membership ON public.notification_recipients AS RESTRICTIVE
  FOR SELECT TO authenticated USING(public.current_user_mailbox_notification_allowed(notification_id));

CREATE OR REPLACE FUNCTION public.notify_new_received_email()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
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
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.notify_new_received_email() FROM PUBLIC,anon,authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
