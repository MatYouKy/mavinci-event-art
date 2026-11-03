-- Preserve existing text comparison semantics and mailbox authorization.
-- These are additive indexes; no unique constraint, policy or business data is removed.
CREATE INDEX IF NOT EXISTS received_emails_id_text_lookup ON public.received_emails ((id::text)) INCLUDE (email_account_id);
CREATE INDEX IF NOT EXISTS email_accounts_id_text_lookup ON public.employee_email_accounts ((id::text));
CREATE INDEX IF NOT EXISTS notification_recipients_user_created_id ON public.notification_recipients (user_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS offers_created_id ON public.offers (created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS received_emails_unread_live_account ON public.received_emails (email_account_id) WHERE is_read = false AND deleted_at IS NULL;

CREATE OR REPLACE FUNCTION public.crm_mailbox_unread_counts(p_account_ids uuid[])
RETURNS TABLE(email_account_id uuid, unread_count bigint)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, public
AS $$
  SELECT m.email_account_id, count(*)
  FROM public.received_emails m
  WHERE m.email_account_id = ANY(p_account_ids) AND m.is_read = false AND m.deleted_at IS NULL
  GROUP BY m.email_account_id;
$$;
REVOKE ALL ON FUNCTION public.crm_mailbox_unread_counts(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_mailbox_unread_counts(uuid[]) TO authenticated;
NOTIFY pgrst, 'reload schema';

DO $$
DECLARE t text; policy_row record;
BEGIN
  FOREACH t IN ARRAY ARRAY['events','tasks','employees','task_assignees'] LOOP
    SELECT * INTO policy_row FROM pg_policies WHERE schemaname='public' AND tablename=t AND policyname='seller_portal_deny_'||t;
    IF FOUND AND policy_row.qual = '(NOT current_session_is_seller_portal())'
      AND policy_row.with_check = '(NOT current_session_is_seller_portal())'
      AND policy_row.permissive = 'RESTRICTIVE' THEN
      EXECUTE format('ALTER POLICY %I ON public.%I USING (NOT (SELECT public.current_session_is_seller_portal())) WITH CHECK (NOT (SELECT public.current_session_is_seller_portal()))', 'seller_portal_deny_'||t, t);
    END IF;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.crm_notification_counts(p_hide_phase boolean DEFAULT false)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, public
AS $$
  SELECT jsonb_build_object('total', count(*), 'unread', count(*) FILTER (WHERE NOT r.is_read))
  FROM public.notification_recipients r JOIN public.notifications n ON n.id = r.notification_id
  WHERE r.user_id = auth.uid()
    AND (NOT p_hide_phase OR n.related_entity_type IS DISTINCT FROM 'event_phase_assignment');
$$;
REVOKE ALL ON FUNCTION public.crm_notification_counts(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_notification_counts(boolean) TO authenticated;
NOTIFY pgrst, 'reload schema';
