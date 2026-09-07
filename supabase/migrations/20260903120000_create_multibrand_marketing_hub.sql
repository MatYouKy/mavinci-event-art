/*
  Multibrand marketing hub

  Provider credentials are written only by trusted server routes. The browser
  receives a sanitised integration DTO and never receives OAuth credentials.
*/

CREATE TABLE IF NOT EXISTS public.marketing_integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.my_companies(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('meta', 'google')),
  status text NOT NULL DEFAULT 'not_connected'
    CHECK (status IN ('not_connected', 'connected', 'needs_attention', 'syncing', 'error')),
  display_name text,
  external_account_id text,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  scopes text[] NOT NULL DEFAULT '{}'::text[],
  credentials_encrypted text,
  token_expires_at timestamptz,
  last_synced_at timestamptz,
  last_error text,
  created_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, provider)
);

CREATE TABLE IF NOT EXISTS public.marketing_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.my_companies(id) ON DELETE CASCADE,
  integration_id uuid NOT NULL REFERENCES public.marketing_integrations(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('meta_ads', 'google_ads')),
  external_campaign_id text NOT NULL,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'UNKNOWN',
  objective text,
  budget_daily numeric(14,2),
  budget_lifetime numeric(14,2),
  currency text NOT NULL DEFAULT 'PLN',
  impressions bigint NOT NULL DEFAULT 0,
  clicks bigint NOT NULL DEFAULT 0,
  spend numeric(14,2) NOT NULL DEFAULT 0,
  conversions numeric(14,2) NOT NULL DEFAULT 0,
  conversion_value numeric(14,2) NOT NULL DEFAULT 0,
  start_date date,
  end_date date,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  synced_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, provider, external_campaign_id)
);

CREATE TABLE IF NOT EXISTS public.marketing_metrics_daily (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.my_companies(id) ON DELETE CASCADE,
  integration_id uuid NOT NULL REFERENCES public.marketing_integrations(id) ON DELETE CASCADE,
  source text NOT NULL
    CHECK (source IN ('meta_ads', 'meta_page', 'google_ads', 'google_search_console')),
  metric_date date NOT NULL,
  external_campaign_id text NOT NULL DEFAULT '',
  campaign_name text,
  currency text NOT NULL DEFAULT 'PLN',
  impressions bigint NOT NULL DEFAULT 0,
  clicks bigint NOT NULL DEFAULT 0,
  spend numeric(14,2) NOT NULL DEFAULT 0,
  conversions numeric(14,2) NOT NULL DEFAULT 0,
  conversion_value numeric(14,2) NOT NULL DEFAULT 0,
  reach bigint NOT NULL DEFAULT 0,
  engagement bigint NOT NULL DEFAULT 0,
  messages bigint NOT NULL DEFAULT 0,
  organic_clicks bigint NOT NULL DEFAULT 0,
  organic_impressions bigint NOT NULL DEFAULT 0,
  average_position numeric(10,3) NOT NULL DEFAULT 0,
  dimensions jsonb NOT NULL DEFAULT '{}'::jsonb,
  synced_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, source, metric_date, external_campaign_id)
);

CREATE TABLE IF NOT EXISTS public.marketing_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.my_companies(id) ON DELETE CASCADE,
  integration_id uuid NOT NULL REFERENCES public.marketing_integrations(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'meta' CHECK (provider IN ('meta')),
  external_thread_id text,
  external_message_id text NOT NULL,
  sender_name text,
  sender_external_id text,
  message_preview text NOT NULL DEFAULT '',
  received_at timestamptz NOT NULL,
  is_read boolean NOT NULL DEFAULT false,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (integration_id, external_message_id)
);

CREATE TABLE IF NOT EXISTS public.marketing_ai_insights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.my_companies(id) ON DELETE CASCADE,
  period_start date NOT NULL,
  period_end date NOT NULL,
  summary text NOT NULL,
  recommendations jsonb NOT NULL DEFAULT '[]'::jsonb,
  risks jsonb NOT NULL DEFAULT '[]'::jsonb,
  opportunities jsonb NOT NULL DEFAULT '[]'::jsonb,
  model text,
  input_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.marketing_company_settings (
  company_id uuid PRIMARY KEY REFERENCES public.my_companies(id) ON DELETE CASCADE,
  automatic_sync_enabled boolean NOT NULL DEFAULT true,
  ai_analysis_enabled boolean NOT NULL DEFAULT false,
  ai_data_scope text NOT NULL DEFAULT 'aggregates_only'
    CHECK (ai_data_scope IN ('aggregates_only')),
  ai_consent_at timestamptz,
  ai_consent_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_marketing_integrations_company
  ON public.marketing_integrations(company_id, provider);
CREATE INDEX IF NOT EXISTS idx_marketing_campaigns_company_status
  ON public.marketing_campaigns(company_id, provider, status);
CREATE INDEX IF NOT EXISTS idx_marketing_metrics_company_date
  ON public.marketing_metrics_daily(company_id, metric_date DESC);
CREATE INDEX IF NOT EXISTS idx_marketing_messages_company_received
  ON public.marketing_messages(company_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_marketing_messages_unread
  ON public.marketing_messages(company_id, is_read) WHERE NOT is_read;
CREATE INDEX IF NOT EXISTS idx_marketing_ai_insights_company_created
  ON public.marketing_ai_insights(company_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.can_access_marketing_company(
  requested_company_id uuid,
  required_permission text DEFAULT 'marketing_campaigns_view'
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.employees employee
    WHERE COALESCE(employee.auth_user_id, employee.id) = auth.uid()
      AND COALESCE(employee.is_active, true)
      AND (
        employee.role::text = 'admin'
        OR employee.access_level::text = 'admin'
        OR 'admin' = ANY(COALESCE(employee.permissions, '{}'::text[]))
        OR required_permission = ANY(COALESCE(employee.permissions, '{}'::text[]))
        OR (
          required_permission = 'marketing_campaigns_view'
          AND (
            'marketing_campaigns_manage' = ANY(COALESCE(employee.permissions, '{}'::text[]))
            OR 'marketing_campaigns_approve' = ANY(COALESCE(employee.permissions, '{}'::text[]))
          )
        )
      )
      AND (
        employee.role::text = 'admin'
        OR employee.access_level::text = 'admin'
        OR 'admin' = ANY(COALESCE(employee.permissions, '{}'::text[]))
        OR cardinality(COALESCE(employee.my_company_ids, '{}'::uuid[])) = 0
        OR requested_company_id = ANY(COALESCE(employee.my_company_ids, '{}'::uuid[]))
      )
  );
$$;

REVOKE ALL ON FUNCTION public.can_access_marketing_company(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_access_marketing_company(uuid, text) TO authenticated;

DROP POLICY IF EXISTS "Marketing can view assigned companies" ON public.my_companies;
CREATE POLICY "Marketing can view assigned companies"
  ON public.my_companies FOR SELECT TO authenticated
  USING (public.can_access_marketing_company(id));

ALTER TABLE public.marketing_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_metrics_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_ai_insights ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_company_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Marketing integrations visible by company scope"
  ON public.marketing_integrations FOR SELECT TO authenticated
  USING (public.can_access_marketing_company(company_id));
CREATE POLICY "Marketing integrations managed by company scope"
  ON public.marketing_integrations FOR ALL TO authenticated
  USING (public.can_access_marketing_company(company_id, 'marketing_campaigns_manage'))
  WITH CHECK (public.can_access_marketing_company(company_id, 'marketing_campaigns_manage'));

CREATE POLICY "Marketing campaigns visible by company scope"
  ON public.marketing_campaigns FOR SELECT TO authenticated
  USING (public.can_access_marketing_company(company_id));
CREATE POLICY "Marketing campaigns managed by company scope"
  ON public.marketing_campaigns FOR ALL TO authenticated
  USING (public.can_access_marketing_company(company_id, 'marketing_campaigns_manage'))
  WITH CHECK (public.can_access_marketing_company(company_id, 'marketing_campaigns_manage'));

CREATE POLICY "Marketing metrics visible by company scope"
  ON public.marketing_metrics_daily FOR SELECT TO authenticated
  USING (public.can_access_marketing_company(company_id));
CREATE POLICY "Marketing metrics managed by company scope"
  ON public.marketing_metrics_daily FOR ALL TO authenticated
  USING (public.can_access_marketing_company(company_id, 'marketing_campaigns_manage'))
  WITH CHECK (public.can_access_marketing_company(company_id, 'marketing_campaigns_manage'));

CREATE POLICY "Marketing messages visible by company scope"
  ON public.marketing_messages FOR SELECT TO authenticated
  USING (public.can_access_marketing_company(company_id));
CREATE POLICY "Marketing messages managed by company scope"
  ON public.marketing_messages FOR ALL TO authenticated
  USING (public.can_access_marketing_company(company_id, 'marketing_campaigns_manage'))
  WITH CHECK (public.can_access_marketing_company(company_id, 'marketing_campaigns_manage'));

CREATE POLICY "Marketing AI insights visible by company scope"
  ON public.marketing_ai_insights FOR SELECT TO authenticated
  USING (public.can_access_marketing_company(company_id));
CREATE POLICY "Marketing AI insights managed by company scope"
  ON public.marketing_ai_insights FOR ALL TO authenticated
  USING (public.can_access_marketing_company(company_id, 'marketing_campaigns_manage'))
  WITH CHECK (public.can_access_marketing_company(company_id, 'marketing_campaigns_manage'));

CREATE POLICY "Marketing company settings visible by company scope"
  ON public.marketing_company_settings FOR SELECT TO authenticated
  USING (public.can_access_marketing_company(company_id));
CREATE POLICY "Marketing company settings managed by company scope"
  ON public.marketing_company_settings FOR ALL TO authenticated
  USING (public.can_access_marketing_company(company_id, 'marketing_campaigns_manage'))
  WITH CHECK (public.can_access_marketing_company(company_id, 'marketing_campaigns_manage'));

-- Do not expose the encrypted credential column to an authenticated browser.
REVOKE SELECT ON public.marketing_integrations FROM authenticated;
GRANT SELECT (
  id, company_id, provider, status, display_name, external_account_id,
  settings, scopes, token_expires_at, last_synced_at, last_error,
  created_by, created_at, updated_at
) ON public.marketing_integrations TO authenticated;

CREATE OR REPLACE FUNCTION public.set_marketing_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_marketing_integrations_updated_at ON public.marketing_integrations;
CREATE TRIGGER set_marketing_integrations_updated_at
  BEFORE UPDATE ON public.marketing_integrations
  FOR EACH ROW EXECUTE FUNCTION public.set_marketing_updated_at();

DROP TRIGGER IF EXISTS set_marketing_campaigns_updated_at ON public.marketing_campaigns;
CREATE TRIGGER set_marketing_campaigns_updated_at
  BEFORE UPDATE ON public.marketing_campaigns
  FOR EACH ROW EXECUTE FUNCTION public.set_marketing_updated_at();

DROP TRIGGER IF EXISTS set_marketing_company_settings_updated_at
  ON public.marketing_company_settings;
CREATE TRIGGER set_marketing_company_settings_updated_at
  BEFORE UPDATE ON public.marketing_company_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_marketing_updated_at();

CREATE OR REPLACE FUNCTION public.notify_new_marketing_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  notification_id uuid;
  company_name text;
BEGIN
  SELECT company.name INTO company_name
  FROM public.my_companies company
  WHERE company.id = NEW.company_id;

  INSERT INTO public.notifications (
    title, message, type, category, action_url, metadata, created_at
  ) VALUES (
    'Nowa wiadomość na Facebooku',
    format(
      '%s · %s: %s',
      COALESCE(company_name, 'Marka'),
      COALESCE(NULLIF(NEW.sender_name, ''), 'Nowy kontakt'),
      left(COALESCE(NEW.message_preview, ''), 180)
    ),
    'info',
    'system',
    '/crm/page?tab=marketing&company=' || NEW.company_id::text,
    jsonb_build_object(
      'kind', 'marketing_message',
      'company_id', NEW.company_id,
      'message_id', NEW.id,
      'provider', NEW.provider
    ),
    now()
  ) RETURNING id INTO notification_id;

  INSERT INTO public.notification_recipients(notification_id, user_id, is_read, created_at)
  SELECT notification_id, auth_user.id, false, now()
  FROM public.employees employee
  JOIN auth.users auth_user ON auth_user.id = COALESCE(employee.auth_user_id, employee.id)
  WHERE COALESCE(employee.is_active, true)
    AND (
      employee.role::text = 'admin'
      OR employee.access_level::text = 'admin'
      OR 'admin' = ANY(COALESCE(employee.permissions, '{}'::text[]))
      OR 'marketing_campaigns_view' = ANY(COALESCE(employee.permissions, '{}'::text[]))
      OR 'marketing_campaigns_manage' = ANY(COALESCE(employee.permissions, '{}'::text[]))
    )
    AND (
      employee.role::text = 'admin'
      OR employee.access_level::text = 'admin'
      OR 'admin' = ANY(COALESCE(employee.permissions, '{}'::text[]))
      OR cardinality(COALESCE(employee.my_company_ids, '{}'::uuid[])) = 0
      OR NEW.company_id = ANY(COALESCE(employee.my_company_ids, '{}'::uuid[]))
    )
  ON CONFLICT (notification_id, user_id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notify_new_marketing_message_after_insert
  ON public.marketing_messages;
CREATE TRIGGER notify_new_marketing_message_after_insert
  AFTER INSERT ON public.marketing_messages
  FOR EACH ROW EXECUTE FUNCTION public.notify_new_marketing_message();

REVOKE ALL ON FUNCTION public.notify_new_marketing_message() FROM PUBLIC;

-- Optional automatic synchronisation. Add `crm_base_url` and
-- `marketing_cron_secret` to Supabase Vault (or app.settings) to activate it.
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION public.invoke_marketing_sync()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  base_url text := NULLIF(current_setting('app.settings.crm_base_url', true), '');
  cron_secret text := NULLIF(current_setting('app.settings.marketing_cron_secret', true), '');
  request_id bigint;
BEGIN
  IF to_regclass('vault.decrypted_secrets') IS NOT NULL THEN
    EXECUTE $query$
      SELECT COALESCE(
        (SELECT decrypted_secret FROM vault.decrypted_secrets
         WHERE name = 'crm_base_url' LIMIT 1), $1
      )
    $query$ INTO base_url USING base_url;
    EXECUTE $query$
      SELECT COALESCE(
        (SELECT decrypted_secret FROM vault.decrypted_secrets
         WHERE name = 'marketing_cron_secret' LIMIT 1), $1
      )
    $query$ INTO cron_secret USING cron_secret;
  END IF;

  IF base_url IS NULL OR cron_secret IS NULL THEN
    RAISE WARNING 'Marketing sync skipped: crm_base_url or marketing_cron_secret is missing.';
    RETURN NULL;
  END IF;

  SELECT net.http_post(
    url := rtrim(base_url, '/') || '/bridge/marketing/sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-marketing-cron-secret', cron_secret
    ),
    body := jsonb_build_object('source', 'pg_cron'),
    timeout_milliseconds := 300000
  ) INTO request_id;

  RETURN request_id;
END;
$$;

REVOKE ALL ON FUNCTION public.invoke_marketing_sync() FROM PUBLIC, anon, authenticated;

DO $schedule_marketing_sync$
DECLARE
  job_id bigint;
BEGIN
  BEGIN
    CREATE EXTENSION IF NOT EXISTS pg_cron;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'pg_cron unavailable; marketing sync was not scheduled: %', SQLERRM;
  END;

  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    FOR job_id IN EXECUTE
      'SELECT jobid FROM cron.job WHERE jobname = $1'
      USING 'multibrand-marketing-sync'
    LOOP
      EXECUTE 'SELECT cron.unschedule($1)' USING job_id;
    END LOOP;

    EXECUTE 'SELECT cron.schedule($1, $2, $3)'
      USING 'multibrand-marketing-sync', '15 */6 * * *',
        'SELECT public.invoke_marketing_sync();';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Could not schedule marketing sync: %', SQLERRM;
END;
$schedule_marketing_sync$;

COMMENT ON TABLE public.marketing_integrations IS
  'OAuth integrations assigned to one CRM company/brand. Credentials are encrypted server-side.';
COMMENT ON FUNCTION public.invoke_marketing_sync() IS
  'Invokes automatic Meta, Google Ads and Search Console synchronisation every six hours.';
