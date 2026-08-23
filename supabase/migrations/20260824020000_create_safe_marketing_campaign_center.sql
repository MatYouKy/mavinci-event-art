/*
  # Bezpieczne Centrum kampanii

  Modernizuje historyczne mailing_campaigns/mailing_recipients. Kampanie są
  najpierw podglądem; masowa wysyłka nie jest uruchamiana przez tę migrację.
*/

-- Nie każda instancja CRM ma historyczny moduł mailingowy. Tworzymy jego
-- minimalną, współczesną bazę zanim wykonamy idempotentną modernizację.
CREATE TABLE IF NOT EXISTS public.mailing_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  subject text NOT NULL DEFAULT '',
  content text,
  status text NOT NULL DEFAULT 'draft',
  scheduled_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.mailing_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.mailing_campaigns(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending',
  sent_at timestamptz,
  opened_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.mailing_campaigns ALTER COLUMN status DROP DEFAULT;
ALTER TABLE public.mailing_campaigns ALTER COLUMN status TYPE text USING status::text;
ALTER TABLE public.mailing_campaigns ALTER COLUMN status SET DEFAULT 'draft';

ALTER TABLE public.mailing_recipients ALTER COLUMN status DROP DEFAULT;
ALTER TABLE public.mailing_recipients ALTER COLUMN status TYPE text USING status::text;
ALTER TABLE public.mailing_recipients ALTER COLUMN status SET DEFAULT 'pending';

CREATE OR REPLACE FUNCTION public.current_marketing_employee_id()
RETURNS uuid LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT employee.id
  FROM public.employees employee
  WHERE employee.is_active = true
    AND (employee.id = auth.uid() OR employee.auth_user_id = auth.uid())
  ORDER BY (employee.id = auth.uid()) DESC
  LIMIT 1;
$$;

-- Ujednolicenie wcześniejszej polityki segmentów z mapowaniem auth_user_id.
CREATE OR REPLACE FUNCTION public.can_view_customer_segmentation()
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.employees employee
    WHERE (employee.id = auth.uid() OR employee.auth_user_id = auth.uid())
      AND employee.is_active = true
      AND (
        employee.role = 'admin' OR employee.access_level = 'admin'
        OR 'contacts_view' = ANY(COALESCE(employee.permissions, '{}'::text[]))
        OR 'contacts_manage' = ANY(COALESCE(employee.permissions, '{}'::text[]))
        OR 'inquiries_view' = ANY(COALESCE(employee.permissions, '{}'::text[]))
        OR 'inquiries_manage' = ANY(COALESCE(employee.permissions, '{}'::text[]))
        OR 'marketing_campaigns_view' = ANY(COALESCE(employee.permissions, '{}'::text[]))
        OR 'marketing_campaigns_manage' = ANY(COALESCE(employee.permissions, '{}'::text[]))
      )
  );
$$;

ALTER TABLE public.mailing_campaigns
  ADD COLUMN IF NOT EXISTS email_account_id uuid REFERENCES public.employee_email_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS template_id uuid REFERENCES public.email_templates(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS preview_text text,
  ADD COLUMN IF NOT EXISTS segment_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  ADD COLUMN IF NOT EXISTS audience_rules jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES public.employees(id) ON DELETE SET NULL DEFAULT public.current_marketing_employee_id(),
  ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES public.employees(id) ON DELETE SET NULL DEFAULT public.current_marketing_employee_id(),
  ADD COLUMN IF NOT EXISTS submitted_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS test_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS test_sent_to text,
  ADD COLUMN IF NOT EXISTS eligible_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS excluded_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sent_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS failed_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.mailing_recipients
  ADD COLUMN IF NOT EXISTS contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS profile_id uuid REFERENCES public.customer_marketing_profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS display_name text,
  ADD COLUMN IF NOT EXISTS legal_basis text,
  ADD COLUMN IF NOT EXISTS exclusion_reason text,
  ADD COLUMN IF NOT EXISTS personalization jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS unsubscribe_token uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS delivered_at timestamptz,
  ADD COLUMN IF NOT EXISTS clicked_at timestamptz,
  ADD COLUMN IF NOT EXISTS replied_at timestamptz,
  ADD COLUMN IF NOT EXISTS failed_at timestamptz,
  ADD COLUMN IF NOT EXISTS error_message text,
  ADD COLUMN IF NOT EXISTS message_id text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.mailing_campaigns DROP CONSTRAINT IF EXISTS mailing_campaigns_status_check;
ALTER TABLE public.mailing_campaigns ADD CONSTRAINT mailing_campaigns_status_check CHECK (
  status IN ('draft', 'pending_approval', 'approved', 'scheduled', 'sending', 'paused', 'sent', 'cancelled', 'failed')
);
ALTER TABLE public.mailing_recipients DROP CONSTRAINT IF EXISTS mailing_recipients_status_check;
ALTER TABLE public.mailing_recipients ADD CONSTRAINT mailing_recipients_status_check CHECK (
  status IN ('pending', 'eligible', 'excluded', 'queued', 'sent', 'delivered', 'opened', 'clicked', 'replied', 'bounced', 'failed', 'unsubscribed')
);

DROP INDEX IF EXISTS public.uq_mailing_recipient_campaign_email;
CREATE INDEX IF NOT EXISTS idx_mailing_recipient_campaign_email
  ON public.mailing_recipients(campaign_id, lower(email)) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_mailing_recipients_campaign_status
  ON public.mailing_recipients(campaign_id, status);
CREATE INDEX IF NOT EXISTS idx_mailing_campaigns_status_updated
  ON public.mailing_campaigns(status, updated_at DESC);

CREATE TABLE IF NOT EXISTS public.marketing_suppression_list (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  reason text NOT NULL CHECK (reason IN ('unsubscribe', 'objection', 'bounce', 'complaint', 'manual', 'invalid')),
  source text,
  notes text,
  created_by uuid REFERENCES public.employees(id) ON DELETE SET NULL DEFAULT public.current_marketing_employee_id(),
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  revoked_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_marketing_suppression_active_email
  ON public.marketing_suppression_list(lower(email)) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS public.mailing_campaign_approval_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.mailing_campaigns(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN ('created', 'audience_refreshed', 'test_sent', 'submitted', 'approved', 'rejected', 'cancelled')),
  actor_id uuid REFERENCES public.employees(id) ON DELETE SET NULL DEFAULT public.current_marketing_employee_id(),
  note text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.mailing_campaign_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.mailing_campaigns(id) ON DELETE CASCADE,
  recipient_id uuid REFERENCES public.mailing_recipients(id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type IN ('queued', 'sent', 'delivered', 'opened', 'clicked', 'replied', 'bounced', 'failed', 'unsubscribed')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.can_view_marketing_campaigns()
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.employees employee
    WHERE (employee.id = auth.uid() OR employee.auth_user_id = auth.uid()) AND employee.is_active = true
      AND (
        employee.role = 'admin' OR employee.access_level = 'admin'
        OR 'marketing_campaigns_view' = ANY(COALESCE(employee.permissions, '{}'::text[]))
        OR 'marketing_campaigns_manage' = ANY(COALESCE(employee.permissions, '{}'::text[]))
        OR 'marketing_campaigns_approve' = ANY(COALESCE(employee.permissions, '{}'::text[]))
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.can_manage_marketing_campaigns()
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.employees employee
    WHERE (employee.id = auth.uid() OR employee.auth_user_id = auth.uid()) AND employee.is_active = true
      AND (
        employee.role = 'admin' OR employee.access_level = 'admin'
        OR 'marketing_campaigns_manage' = ANY(COALESCE(employee.permissions, '{}'::text[]))
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.can_approve_marketing_campaigns()
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.employees employee
    WHERE (employee.id = auth.uid() OR employee.auth_user_id = auth.uid()) AND employee.is_active = true
      AND (
        employee.role = 'admin' OR employee.access_level = 'admin'
        OR 'marketing_campaigns_approve' = ANY(COALESCE(employee.permissions, '{}'::text[]))
      )
  );
$$;

ALTER TABLE public.mailing_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mailing_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_suppression_list ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mailing_campaign_approval_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mailing_campaign_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mailing_campaigns_select_secure ON public.mailing_campaigns;
CREATE POLICY mailing_campaigns_select_secure ON public.mailing_campaigns
  FOR SELECT TO authenticated USING (public.can_view_marketing_campaigns());
DROP POLICY IF EXISTS mailing_campaigns_manage_secure ON public.mailing_campaigns;
CREATE POLICY mailing_campaigns_manage_secure ON public.mailing_campaigns
  FOR ALL TO authenticated USING (public.can_manage_marketing_campaigns())
  WITH CHECK (public.can_manage_marketing_campaigns());

DROP POLICY IF EXISTS mailing_recipients_select_secure ON public.mailing_recipients;
CREATE POLICY mailing_recipients_select_secure ON public.mailing_recipients
  FOR SELECT TO authenticated USING (public.can_view_marketing_campaigns());
DROP POLICY IF EXISTS mailing_recipients_manage_secure ON public.mailing_recipients;

DROP POLICY IF EXISTS marketing_suppression_select_secure ON public.marketing_suppression_list;
CREATE POLICY marketing_suppression_select_secure ON public.marketing_suppression_list
  FOR SELECT TO authenticated USING (public.can_view_marketing_campaigns());
DROP POLICY IF EXISTS marketing_suppression_manage_secure ON public.marketing_suppression_list;
CREATE POLICY marketing_suppression_manage_secure ON public.marketing_suppression_list
  FOR ALL TO authenticated USING (public.can_manage_marketing_campaigns())
  WITH CHECK (public.can_manage_marketing_campaigns());

DROP POLICY IF EXISTS mailing_approval_log_select_secure ON public.mailing_campaign_approval_log;
CREATE POLICY mailing_approval_log_select_secure ON public.mailing_campaign_approval_log
  FOR SELECT TO authenticated USING (public.can_view_marketing_campaigns());
DROP POLICY IF EXISTS mailing_events_select_secure ON public.mailing_campaign_events;
CREATE POLICY mailing_events_select_secure ON public.mailing_campaign_events
  FOR SELECT TO authenticated USING (public.can_view_marketing_campaigns());

-- Usuń historyczne, zbyt szerokie polityki, jeśli istnieją.
DO $$
DECLARE policy_row record;
BEGIN
  FOR policy_row IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('mailing_campaigns', 'mailing_recipients')
      AND policyname NOT IN (
        'mailing_campaigns_select_secure', 'mailing_campaigns_manage_secure',
        'mailing_recipients_select_secure', 'mailing_recipients_manage_secure'
      )
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', policy_row.policyname, policy_row.schemaname, policy_row.tablename);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.prepare_mailing_campaign_write()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  NEW.updated_at := now();
  NEW.updated_by := COALESCE(public.current_marketing_employee_id(), NEW.updated_by);
  IF TG_OP = 'INSERT' AND NEW.status <> 'draft' THEN
    RAISE EXCEPTION 'Nowa kampania musi być wersją roboczą';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT (
      (OLD.status = 'draft' AND NEW.status = 'pending_approval'
        AND COALESCE(current_setting('app.mailing_campaign_transition', true), '') = 'submit')
      OR (OLD.status = 'pending_approval' AND NEW.status = 'approved'
        AND COALESCE(current_setting('app.mailing_campaign_transition', true), '') = 'approve')
      OR (OLD.status = 'pending_approval' AND NEW.status = 'draft'
        AND COALESCE(current_setting('app.mailing_campaign_transition', true), '') = 'refresh')
    ) THEN
      RAISE EXCEPTION 'Niedozwolona zmiana statusu kampanii';
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status IN ('approved', 'scheduled', 'sending', 'sent') AND (
    NEW.subject IS DISTINCT FROM OLD.subject
    OR NEW.content IS DISTINCT FROM OLD.content
    OR NEW.segment_ids IS DISTINCT FROM OLD.segment_ids
    OR NEW.audience_rules IS DISTINCT FROM OLD.audience_rules
    OR NEW.email_account_id IS DISTINCT FROM OLD.email_account_id
  ) THEN
    RAISE EXCEPTION 'Zatwierdzonej lub wysłanej kampanii nie można zmieniać';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'draft' AND (
    NEW.subject IS DISTINCT FROM OLD.subject
    OR NEW.content IS DISTINCT FROM OLD.content
    OR NEW.preview_text IS DISTINCT FROM OLD.preview_text
    OR NEW.segment_ids IS DISTINCT FROM OLD.segment_ids
    OR NEW.audience_rules IS DISTINCT FROM OLD.audience_rules
    OR NEW.email_account_id IS DISTINCT FROM OLD.email_account_id
  ) THEN
    NEW.test_sent_at := NULL;
    NEW.test_sent_to := NULL;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'draft' AND (
    NEW.segment_ids IS DISTINCT FROM OLD.segment_ids
    OR NEW.audience_rules IS DISTINCT FROM OLD.audience_rules
  ) THEN
    NEW.eligible_count := 0;
    NEW.excluded_count := 0;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.protect_mailing_campaign_delete()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF OLD.status NOT IN ('draft', 'cancelled', 'failed') THEN
    RAISE EXCEPTION 'Kampanii w tym stanie nie można usunąć';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS protect_mailing_campaign_before_delete ON public.mailing_campaigns;
CREATE TRIGGER protect_mailing_campaign_before_delete
  BEFORE DELETE ON public.mailing_campaigns
  FOR EACH ROW EXECUTE FUNCTION public.protect_mailing_campaign_delete();

DROP TRIGGER IF EXISTS prepare_mailing_campaign_before_write ON public.mailing_campaigns;
CREATE TRIGGER prepare_mailing_campaign_before_write
  BEFORE INSERT OR UPDATE ON public.mailing_campaigns
  FOR EACH ROW EXECUTE FUNCTION public.prepare_mailing_campaign_write();

CREATE OR REPLACE FUNCTION public.refresh_mailing_campaign_audience(p_campaign_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  campaign public.mailing_campaigns%ROWTYPE;
  eligible_total integer;
  excluded_total integer;
BEGIN
  IF NOT public.can_manage_marketing_campaigns() THEN RAISE EXCEPTION 'Brak uprawnień'; END IF;
  SELECT * INTO campaign FROM public.mailing_campaigns WHERE id = p_campaign_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Nie znaleziono kampanii'; END IF;
  IF campaign.status NOT IN ('draft', 'pending_approval') THEN
    RAISE EXCEPTION 'Odbiorców można przeliczyć tylko przed zatwierdzeniem kampanii';
  END IF;

  DELETE FROM public.mailing_recipients WHERE campaign_id = campaign.id;

  INSERT INTO public.mailing_recipients(
    campaign_id, contact_id, organization_id, profile_id, email, display_name,
    legal_basis, status, exclusion_reason, personalization
  )
  WITH candidates AS (
    SELECT
      profile.id AS profile_id,
      profile.contact_id,
      profile.organization_id,
      lower(btrim(COALESCE(contact.email, organization.email))) AS email,
      COALESCE(contact.full_name, organization.name) AS display_name,
      profile.marketing_status,
      profile.legal_basis,
      profile.email_deliverability,
      profile.interests,
      profile.event_types,
      profile.regions,
      profile.budget_min,
      profile.budget_max,
      row_number() OVER (
        PARTITION BY lower(btrim(COALESCE(contact.email, organization.email)))
        ORDER BY profile.updated_at DESC, profile.id
      ) AS email_rank,
      EXISTS (
        SELECT 1 FROM public.marketing_suppression_list suppression
        WHERE lower(btrim(suppression.email)) = lower(btrim(COALESCE(contact.email, organization.email)))
          AND suppression.revoked_at IS NULL
      ) AS suppressed
    FROM public.customer_marketing_profiles profile
    LEFT JOIN public.contacts contact ON contact.id = profile.contact_id
    LEFT JOIN public.organizations organization ON organization.id = profile.organization_id
    WHERE COALESCE(contact.status::text, organization.status::text) = 'active'
      AND (
        cardinality(campaign.segment_ids) = 0
        OR EXISTS (
          SELECT 1 FROM public.customer_marketing_segment_members member
          WHERE (member.contact_id = profile.contact_id OR member.organization_id = profile.organization_id)
            AND member.segment_id = ANY(campaign.segment_ids)
        )
      )
      AND (
        NOT (campaign.audience_rules ? 'entity_types')
        OR CASE WHEN profile.contact_id IS NOT NULL THEN 'contact' ELSE 'organization' END IN (
          SELECT jsonb_array_elements_text(campaign.audience_rules -> 'entity_types')
        )
      )
      AND (
        NOT (campaign.audience_rules ? 'event_types')
        OR profile.event_types && ARRAY(SELECT jsonb_array_elements_text(campaign.audience_rules -> 'event_types'))
      )
      AND (
        NOT (campaign.audience_rules ? 'regions')
        OR profile.regions && ARRAY(SELECT jsonb_array_elements_text(campaign.audience_rules -> 'regions'))
      )
      AND (
        NOT (campaign.audience_rules ? 'budget_min')
        OR profile.budget_max IS NULL
        OR profile.budget_max >= (campaign.audience_rules ->> 'budget_min')::numeric
      )
      AND (
        NOT (campaign.audience_rules ? 'budget_max')
        OR profile.budget_min IS NULL
        OR profile.budget_min <= (campaign.audience_rules ->> 'budget_max')::numeric
      )
  )
  SELECT
    campaign.id, candidate.contact_id, candidate.organization_id, candidate.profile_id,
    NULLIF(candidate.email, ''), candidate.display_name, candidate.legal_basis,
    CASE
      WHEN NULLIF(candidate.email, '') IS NULL THEN 'excluded'
      WHEN candidate.marketing_status = 'objected' THEN 'excluded'
      WHEN candidate.marketing_status = 'unsubscribed' THEN 'excluded'
      WHEN candidate.marketing_status <> 'subscribed' THEN 'excluded'
      WHEN candidate.legal_basis = 'none' THEN 'excluded'
      WHEN candidate.email_deliverability IN ('bounced', 'invalid') THEN 'excluded'
      WHEN candidate.suppressed THEN 'excluded'
      WHEN candidate.email_rank > 1 THEN 'excluded'
      ELSE 'eligible'
    END,
    CASE
      WHEN NULLIF(candidate.email, '') IS NULL THEN 'missing_email'
      WHEN candidate.marketing_status = 'objected' THEN 'objection'
      WHEN candidate.marketing_status = 'unsubscribed' THEN 'unsubscribed'
      WHEN candidate.marketing_status <> 'subscribed' THEN 'no_marketing_permission'
      WHEN candidate.legal_basis = 'none' THEN 'missing_legal_basis'
      WHEN candidate.email_deliverability = 'bounced' THEN 'email_bounced'
      WHEN candidate.email_deliverability = 'invalid' THEN 'invalid_email'
      WHEN candidate.suppressed THEN 'suppression_list'
      WHEN candidate.email_rank > 1 THEN 'duplicate_email'
      ELSE NULL
    END,
    jsonb_build_object(
      'interests', candidate.interests,
      'event_types', candidate.event_types,
      'regions', candidate.regions,
      'budget_min', candidate.budget_min,
      'budget_max', candidate.budget_max
    )
  FROM candidates candidate;

  SELECT count(*) FILTER (WHERE status = 'eligible'), count(*) FILTER (WHERE status = 'excluded')
  INTO eligible_total, excluded_total
  FROM public.mailing_recipients WHERE campaign_id = campaign.id;

  PERFORM set_config('app.mailing_campaign_transition', 'refresh', true);
  UPDATE public.mailing_campaigns SET
    status = 'draft', submitted_by = NULL, submitted_at = NULL,
    approved_by = NULL, approved_at = NULL,
    eligible_count = eligible_total, excluded_count = excluded_total
  WHERE id = campaign.id;

  INSERT INTO public.mailing_campaign_approval_log(campaign_id, action, metadata)
  VALUES (campaign.id, 'audience_refreshed', jsonb_build_object('eligible', eligible_total, 'excluded', excluded_total));
  RETURN jsonb_build_object('eligible', eligible_total, 'excluded', excluded_total);
END;
$$;

CREATE OR REPLACE FUNCTION public.record_mailing_campaign_test(p_campaign_id uuid, p_test_email text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.can_manage_marketing_campaigns() THEN RAISE EXCEPTION 'Brak uprawnień'; END IF;
  UPDATE public.mailing_campaigns
  SET test_sent_at = now(), test_sent_to = lower(btrim(p_test_email))
  WHERE id = p_campaign_id AND status IN ('draft', 'pending_approval');
  IF NOT FOUND THEN RAISE EXCEPTION 'Nie znaleziono kampanii możliwej do testu'; END IF;
  INSERT INTO public.mailing_campaign_approval_log(campaign_id, action, metadata)
  VALUES (p_campaign_id, 'test_sent', jsonb_build_object('recipient', lower(btrim(p_test_email))));
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_mailing_campaign_for_approval(p_campaign_id uuid)
RETURNS public.mailing_campaigns LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE result public.mailing_campaigns%ROWTYPE;
BEGIN
  IF NOT public.can_manage_marketing_campaigns() THEN RAISE EXCEPTION 'Brak uprawnień'; END IF;
  SELECT * INTO result FROM public.mailing_campaigns WHERE id = p_campaign_id FOR UPDATE;
  IF NOT FOUND OR result.status <> 'draft' THEN RAISE EXCEPTION 'Kampania nie jest wersją roboczą'; END IF;
  IF result.email_account_id IS NULL OR NULLIF(btrim(result.subject), '') IS NULL OR NULLIF(btrim(result.content), '') IS NULL THEN
    RAISE EXCEPTION 'Uzupełnij konto nadawcze, temat i treść';
  END IF;
  IF result.eligible_count <= 0 THEN RAISE EXCEPTION 'Kampania nie ma kwalifikowanych odbiorców'; END IF;
  IF result.test_sent_at IS NULL THEN RAISE EXCEPTION 'Przed zatwierdzeniem wyślij wiadomość testową'; END IF;
  PERFORM set_config('app.mailing_campaign_transition', 'submit', true);
  UPDATE public.mailing_campaigns SET status = 'pending_approval', submitted_by = public.current_marketing_employee_id(), submitted_at = now()
  WHERE id = p_campaign_id RETURNING * INTO result;
  INSERT INTO public.mailing_campaign_approval_log(campaign_id, action) VALUES (p_campaign_id, 'submitted');
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.approve_mailing_campaign(p_campaign_id uuid, p_note text DEFAULT NULL)
RETURNS public.mailing_campaigns LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE result public.mailing_campaigns%ROWTYPE;
BEGIN
  IF NOT public.can_approve_marketing_campaigns() THEN RAISE EXCEPTION 'Brak uprawnień do zatwierdzania'; END IF;
  PERFORM set_config('app.mailing_campaign_transition', 'approve', true);
  UPDATE public.mailing_campaigns SET status = 'approved', approved_by = public.current_marketing_employee_id(), approved_at = now()
  WHERE id = p_campaign_id AND status = 'pending_approval' RETURNING * INTO result;
  IF NOT FOUND THEN RAISE EXCEPTION 'Kampania nie oczekuje na zatwierdzenie'; END IF;
  INSERT INTO public.mailing_campaign_approval_log(campaign_id, action, note) VALUES (p_campaign_id, 'approved', NULLIF(btrim(p_note), ''));
  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.refresh_mailing_campaign_audience(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_mailing_campaign_test(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_mailing_campaign_for_approval(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_mailing_campaign(uuid, text) TO authenticated;

COMMENT ON TABLE public.marketing_suppression_list IS
  'Centralna lista adresów wykluczonych niezależnie od segmentu i kampanii.';
COMMENT ON FUNCTION public.refresh_mailing_campaign_audience(uuid) IS
  'Materializuje podgląd odbiorców wraz z jednoznacznym powodem każdego wykluczenia.';
