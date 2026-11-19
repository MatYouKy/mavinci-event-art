-- Marketing → „Social media” (Etap 3): statystyki opublikowanych postów z Meta, najlepsze godziny publikacji z własnych
-- wyników i tygodniowy raport „Trendy i rekomendacje” (web CRM, Mac, telefon).
-- Wymaga migracji 20261119200000_marketing_social_media.sql i 20261119220000_social_media_publishing.sql.
-- Plik idempotentny — można go wykonać ponownie.
--
-- Wyniki pobiera wyłącznie serwer Next (token strony zapisany zaszyfrowany w `marketing_integrations`): Instagram —
-- `/{media}/insights` (views, reach, saved, shares, total_interactions, likes, comments, profile_visits, follows; relacje:
-- views, reach, shares, total_interactions, replies, profile_visits, follows — tylko przez 24 h od publikacji), Facebook —
-- `/{post}/insights` (post_media_view, post_total_media_view_unique, post_clicks) i pola posta (reakcje, komentarze,
-- udostępnienia). Metryki wycofane przez Meta (impressions, post_impressions*) nie są używane.
-- `social_publications.metrics` — ostatni stan (narastająco od publikacji), `social_post_metrics_daily` — jeden zrzut
-- dziennie na kanał posta (przyrosty dzienne = różnica kolejnych zrzutów). Odświeżanie: pg_cron co godzinę wywołuje Next
-- tylko, gdy są publikacje do odświeżenia (relacje co godzinę przez 24 h, posty: 3 dni — co 3 h, do 30 dni — co 12 h,
-- do 90 dni — raz dziennie; starsze zostają z ostatnim stanem).
--
-- Raport tygodniowy (poniedziałek rano, za poprzedni tydzień pon–niedz., strefa Warszawa) zapisuje serwer w
-- `marketing_ai_insights` z `kind = 'social_weekly'` (jeden na markę i tydzień; dane do widoku w `details`). Analiza AI
-- tylko po zgodzie akceptującego w ustawieniach social media marki (`social_settings.ai_reports_enabled`) — do AI trafiają
-- wyłącznie zagregowane wyniki (bez treści postów, komentarzy i danych osobowych); bez zgody raport zawiera same liczby
-- i wnioski z danych. Powiadomienie o nowym raporcie: osoby z dostępem do social media marki (bez osoby, która raport
-- wygenerowała ręcznie). Analiza marketingu (`kind = 'marketing'`) bez zmian.

-- 1. Ustawienia marki: zgoda na analizę AI w raporcie tygodniowym ----------------------------------------------------------

ALTER TABLE public.social_settings
  ADD COLUMN IF NOT EXISTS ai_reports_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ai_reports_consent_at timestamptz,
  ADD COLUMN IF NOT EXISTS ai_reports_consent_by uuid REFERENCES public.employees(id) ON DELETE SET NULL;

-- Treść jak w 20261119200000 + znacznik zgody na analizę AI raportów (kto i kiedy włączył).
CREATE OR REPLACE FUNCTION public.social_settings_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.company_id <> OLD.company_id THEN
    RAISE EXCEPTION 'Nie można przenieść ustawień do innej marki.' USING ERRCODE = '22023';
  END IF;
  IF NEW.ai_captions_enabled AND (TG_OP = 'INSERT' OR NOT OLD.ai_captions_enabled) THEN
    NEW.ai_consent_at := now();
    NEW.ai_consent_by := public.current_crm_employee_id();
  ELSIF NOT NEW.ai_captions_enabled THEN
    NEW.ai_consent_at := NULL;
    NEW.ai_consent_by := NULL;
  ELSIF TG_OP = 'UPDATE' THEN
    NEW.ai_consent_at := OLD.ai_consent_at;
    NEW.ai_consent_by := OLD.ai_consent_by;
  END IF;
  IF NEW.ai_reports_enabled AND (TG_OP = 'INSERT' OR NOT OLD.ai_reports_enabled) THEN
    NEW.ai_reports_consent_at := now();
    NEW.ai_reports_consent_by := public.current_crm_employee_id();
  ELSIF NOT NEW.ai_reports_enabled THEN
    NEW.ai_reports_consent_at := NULL;
    NEW.ai_reports_consent_by := NULL;
  ELSIF TG_OP = 'UPDATE' THEN
    NEW.ai_reports_consent_at := OLD.ai_reports_consent_at;
    NEW.ai_reports_consent_by := OLD.ai_reports_consent_by;
  END IF;
  NEW.default_hashtags := public.social_normalize_hashtags(NEW.default_hashtags);
  NEW.updated_at := now();
  NEW.updated_by := coalesce(public.current_crm_employee_id(), NEW.updated_by);
  RETURN NEW;
END;
$$;

-- 2. Publikacje kanałów: ostatnie wyniki z Meta ------------------------------------------------------------------------
-- `metrics` — ostatni stan narastająco od publikacji (klucze jak kolumny `social_post_metrics_daily`, brak klucza = Meta
-- nie podaje tej metryki dla kanału); `metrics_error` — dlaczego wyników nie ma (uprawnienia, za mało odbiorców relacji).

ALTER TABLE public.social_publications
  ADD COLUMN IF NOT EXISTS metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS metrics_synced_at timestamptz,
  ADD COLUMN IF NOT EXISTS metrics_error text;
ALTER TABLE public.social_publications DROP CONSTRAINT IF EXISTS social_publications_metrics_check;
ALTER TABLE public.social_publications ADD CONSTRAINT social_publications_metrics_check
  CHECK (jsonb_typeof(metrics) = 'object' AND char_length(coalesce(metrics_error, '')) <= 1000);
CREATE INDEX IF NOT EXISTS social_publications_metrics_due_idx ON public.social_publications (metrics_synced_at NULLS FIRST)
  WHERE status = 'published';

-- 3. Zrzuty dzienne -------------------------------------------------------------------------------------------------------
-- Jeden wiersz na kanał posta i dzień (strefa Warszawa): stan narastająco w chwili pobrania. Puste pole = metryka
-- niedostępna dla kanału (np. zapisania na Facebooku). Zapis wyłącznie serwer.

CREATE TABLE IF NOT EXISTS public.social_post_metrics_daily (
  publication_id uuid NOT NULL REFERENCES public.social_publications(id) ON DELETE CASCADE,
  metric_date date NOT NULL,
  post_id uuid NOT NULL REFERENCES public.social_posts(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.my_companies(id) ON DELETE CASCADE,
  channel text NOT NULL,
  views bigint,
  reach bigint,
  interactions bigint,
  saves bigint,
  profile_visits bigint,
  shares bigint,
  likes bigint,
  comments bigint,
  follows bigint,
  clicks bigint,
  replies bigint,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (publication_id, metric_date),
  CONSTRAINT social_post_metrics_daily_channel_check CHECK (channel IN ('instagram_feed', 'instagram_story', 'facebook_feed')),
  CONSTRAINT social_post_metrics_daily_values_check CHECK (
    coalesce(views, 0) >= 0 AND coalesce(reach, 0) >= 0 AND coalesce(interactions, 0) >= 0 AND coalesce(saves, 0) >= 0
    AND coalesce(profile_visits, 0) >= 0 AND coalesce(shares, 0) >= 0 AND coalesce(likes, 0) >= 0
    AND coalesce(comments, 0) >= 0 AND coalesce(follows, 0) >= 0 AND coalesce(clicks, 0) >= 0 AND coalesce(replies, 0) >= 0)
);
CREATE INDEX IF NOT EXISTS social_post_metrics_daily_company_idx ON public.social_post_metrics_daily (company_id, metric_date);
CREATE INDEX IF NOT EXISTS social_post_metrics_daily_post_idx ON public.social_post_metrics_daily (post_id, metric_date);

-- Post, marka i kanał zawsze z publikacji (nie z danych zapisu).
CREATE OR REPLACE FUNCTION public.social_post_metrics_daily_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  SELECT p.post_id, p.company_id, p.channel INTO NEW.post_id, NEW.company_id, NEW.channel
  FROM public.social_publications p WHERE p.id = NEW.publication_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Nie znaleziono publikacji.' USING ERRCODE = 'P0002';
  END IF;
  NEW.fetched_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS social_post_metrics_daily_guard ON public.social_post_metrics_daily;
CREATE TRIGGER social_post_metrics_daily_guard BEFORE INSERT OR UPDATE ON public.social_post_metrics_daily
  FOR EACH ROW EXECUTE FUNCTION public.social_post_metrics_daily_guard();

-- 4. Raporty: rodzaj raportu w `marketing_ai_insights` -----------------------------------------------------------------
-- `marketing` — analiza marketingu (bez zmian), `social_weekly` — raport tygodniowy social media (jeden na markę i tydzień,
-- ponowne przygotowanie nadpisuje treść). `details` — dane do widoku (wyniki, porównanie, najlepsze godziny, najlepsze posty).

ALTER TABLE public.marketing_ai_insights
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'marketing',
  ADD COLUMN IF NOT EXISTS details jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz;
ALTER TABLE public.marketing_ai_insights DROP CONSTRAINT IF EXISTS marketing_ai_insights_kind_check;
ALTER TABLE public.marketing_ai_insights ADD CONSTRAINT marketing_ai_insights_kind_check
  CHECK (kind IN ('marketing', 'social_weekly') AND jsonb_typeof(details) = 'object');
CREATE UNIQUE INDEX IF NOT EXISTS marketing_ai_insights_social_week_key ON public.marketing_ai_insights (company_id, period_start)
  WHERE kind = 'social_weekly';
CREATE INDEX IF NOT EXISTS marketing_ai_insights_company_kind_idx ON public.marketing_ai_insights (company_id, kind, created_at DESC);

-- Raport social media widzą też osoby z dostępem do social media marki (bez dostępu do panelu marketingu).
DROP POLICY IF EXISTS "Social weekly reports visible to social viewers" ON public.marketing_ai_insights;
CREATE POLICY "Social weekly reports visible to social viewers" ON public.marketing_ai_insights FOR SELECT TO authenticated
  USING (kind = 'social_weekly' AND public.social_media_can(company_id, 'view'));

-- Porządek uprawnień tabeli: bez dostępu anonimowego, bez TRUNCATE / TRIGGER / REFERENCES dla zalogowanych (RLS bez zmian).
REVOKE ALL ON public.marketing_ai_insights FROM anon;
REVOKE TRUNCATE, TRIGGER, REFERENCES ON public.marketing_ai_insights FROM authenticated;

-- 5. Raport tygodniowy: tydzień, odbiorcy, zapis z powiadomieniem ------------------------------------------------------

-- Poniedziałek poprzedniego tygodnia (strefa Warszawa) — okres raportu przygotowywanego w tym tygodniu.
CREATE OR REPLACE FUNCTION public.social_report_last_week()
RETURNS date
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT (date_trunc('week', now() AT TIME ZONE 'Europe/Warsaw') - interval '7 days')::date;
$$;

REVOKE ALL ON FUNCTION public.social_report_last_week() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.social_report_last_week() TO authenticated, service_role;

-- Odbiorcy raportu (identyfikatory kont): osoby z dowolnym uprawnieniem „Social media” w marce (bez sprzedawców z portalu),
-- a gdy takich nie ma — administratorzy; poza `p_except` (pracownik, który przygotował raport ręcznie).
CREATE OR REPLACE FUNCTION public.social_viewer_user_ids(p_company uuid, p_except uuid)
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  WITH active AS (
    SELECT e.* FROM public.employees e
    WHERE e.is_active AND e.id IS DISTINCT FROM p_except
      AND NOT EXISTS (SELECT 1 FROM public.sales_partner_profiles s
                      WHERE s.portal_auth_user_id = coalesce(e.auth_user_id, e.id) AND s.portal_enabled AND s.contact_id IS NOT NULL)
  ), viewers AS (
    SELECT coalesce(a.auth_user_id, a.id) AS user_id FROM active a
    WHERE coalesce(a.permissions, '{}'::text[])
          && ARRAY['marketing_social_view', 'marketing_social_create', 'marketing_social_approve', 'marketing_social_publish']
      AND (cardinality(coalesce(a.my_company_ids, '{}'::uuid[])) = 0 OR p_company = ANY(coalesce(a.my_company_ids, '{}'::uuid[])))
  ), admins AS (
    SELECT coalesce(a.auth_user_id, a.id) AS user_id FROM active a
    WHERE a.role::text = 'admin' OR a.access_level::text = 'admin' OR 'admin' = ANY(coalesce(a.permissions, '{}'::text[]))
  )
  SELECT CASE WHEN EXISTS (SELECT 1 FROM viewers)
    THEN ARRAY(SELECT DISTINCT user_id FROM viewers)
    ELSE ARRAY(SELECT DISTINCT user_id FROM admins) END;
$$;

REVOKE ALL ON FUNCTION public.social_viewer_user_ids(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.social_viewer_user_ids(uuid, uuid) TO service_role;

-- Zapis raportu tygodniowego (serwer). Nowy raport → powiadomienie odbiorców (bez `p_actor`); ponowne przygotowanie
-- raportu za ten sam tydzień nadpisuje treść bez kolejnego powiadomienia. Zwraca {id, created}.
CREATE OR REPLACE FUNCTION public.social_report_save(
  p_company uuid,
  p_period_start date,
  p_period_end date,
  p_summary text,
  p_recommendations jsonb,
  p_risks jsonb,
  p_opportunities jsonb,
  p_model text,
  p_input jsonb,
  p_details jsonb,
  p_actor uuid DEFAULT NULL,
  p_message text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_id uuid;
  v_created boolean;
  v_recipients uuid[];
BEGIN
  IF p_company IS NULL OR p_period_start IS NULL OR p_period_end IS NULL OR p_period_end < p_period_start
     OR p_period_end - p_period_start > 31 THEN
    RAISE EXCEPTION 'Nieprawidłowy okres raportu.' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.my_companies WHERE id = p_company) THEN
    RAISE EXCEPTION 'Nie znaleziono marki.' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.marketing_ai_insights AS i (company_id, kind, period_start, period_end, summary, recommendations, risks,
    opportunities, model, input_snapshot, details, created_by)
  VALUES (p_company, 'social_weekly', p_period_start, p_period_end, left(coalesce(nullif(btrim(p_summary), ''), 'Raport tygodniowy.'), 8000),
    CASE WHEN jsonb_typeof(p_recommendations) = 'array' THEN p_recommendations ELSE '[]'::jsonb END,
    CASE WHEN jsonb_typeof(p_risks) = 'array' THEN p_risks ELSE '[]'::jsonb END,
    CASE WHEN jsonb_typeof(p_opportunities) = 'array' THEN p_opportunities ELSE '[]'::jsonb END,
    nullif(btrim(coalesce(p_model, '')), ''),
    CASE WHEN jsonb_typeof(p_input) = 'object' THEN p_input ELSE '{}'::jsonb END,
    CASE WHEN jsonb_typeof(p_details) = 'object' THEN p_details ELSE '{}'::jsonb END,
    (SELECT e.id FROM public.employees e WHERE e.id = p_actor))
  ON CONFLICT (company_id, period_start) WHERE kind = 'social_weekly'
  DO UPDATE SET
    period_end = EXCLUDED.period_end,
    summary = EXCLUDED.summary,
    recommendations = EXCLUDED.recommendations,
    risks = EXCLUDED.risks,
    opportunities = EXCLUDED.opportunities,
    model = EXCLUDED.model,
    input_snapshot = EXCLUDED.input_snapshot,
    details = EXCLUDED.details,
    updated_at = now()
  RETURNING i.id, (i.xmax = 0) INTO v_id, v_created;

  IF v_created THEN
    v_recipients := public.social_viewer_user_ids(p_company, p_actor);
    IF cardinality(v_recipients) > 0 THEN
      PERFORM public.enqueue_crm_business_notification(
        'social-report:' || v_id::text, 'social_weekly_report', 'Raport tygodniowy social media',
        left(coalesce(nullif(btrim(p_message), ''), 'Trendy i rekomendacje za ' || to_char(p_period_start, 'DD.MM') || '–'
          || to_char(p_period_end, 'DD.MM')), 500),
        'info', 'system', '/crm/marketing/social?tab=stats&report=' || v_id::text, NULL, NULL,
        jsonb_build_object('company_id', p_company, 'report_id', v_id), v_recipients);
    END IF;
  END IF;
  RETURN jsonb_build_object('id', v_id, 'created', v_created);
END;
$$;

REVOKE ALL ON FUNCTION public.social_report_save(uuid, date, date, text, jsonb, jsonb, jsonb, text, jsonb, jsonb, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.social_report_save(uuid, date, date, text, jsonb, jsonb, jsonb, text, jsonb, jsonb, uuid, text)
  TO service_role;

-- 6. Kolejka odświeżania wyników ----------------------------------------------------------------------------------------
-- Publikacje do odświeżenia: relacje co godzinę przez 24 h (później Meta ich nie podaje), posty do 3 dni — co 3 h,
-- do 30 dni — co 12 h, do 90 dni — raz dziennie. `p_company` — tylko marka (przycisk „Odśwież statystyki”).
CREATE OR REPLACE FUNCTION public.social_metrics_due(p_limit integer DEFAULT 40, p_company uuid DEFAULT NULL)
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT p.id FROM public.social_publications p
  WHERE p.status = 'published' AND p.external_id IS NOT NULL AND p.published_at IS NOT NULL
    AND (p_company IS NULL OR p.company_id = p_company)
    AND CASE WHEN p.channel = 'instagram_story'
      THEN p.published_at > now() - interval '24 hours'
        AND (p.metrics_synced_at IS NULL OR p.metrics_synced_at < now() - interval '50 minutes')
      ELSE p.published_at > now() - interval '90 days'
        AND (p.metrics_synced_at IS NULL OR p.metrics_synced_at < now() - CASE
          WHEN p.published_at > now() - interval '3 days' THEN interval '170 minutes'
          WHEN p.published_at > now() - interval '30 days' THEN interval '715 minutes'
          ELSE interval '1435 minutes' END)
    END
  ORDER BY (p.channel = 'instagram_story') DESC, p.metrics_synced_at NULLS FIRST, p.published_at DESC
  LIMIT greatest(1, least(coalesce(p_limit, 40), 200));
$$;

REVOKE ALL ON FUNCTION public.social_metrics_due(integer, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.social_metrics_due(integer, uuid) TO service_role;

-- Przyrosty dzienne marki (wykres „Statystyki”): różnica kolejnych zrzutów każdej publikacji; pierwszy zrzut — cały wynik
-- od publikacji. Uprawnienia wywołującego (RLS zrzutów — zakres „view” marki). Najwyżej 400 dni.
CREATE OR REPLACE FUNCTION public.social_metrics_timeline(p_company uuid, p_from date, p_to date)
RETURNS TABLE (metric_date date, views bigint, interactions bigint)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
  WITH snaps AS (
    SELECT d.metric_date, d.views, d.interactions,
      lag(d.views) OVER w AS prev_views, lag(d.interactions) OVER w AS prev_interactions
    FROM public.social_post_metrics_daily d
    WHERE d.company_id = p_company AND d.metric_date <= p_to
    WINDOW w AS (PARTITION BY d.publication_id ORDER BY d.metric_date)
  )
  SELECT s.metric_date,
    sum(greatest(coalesce(s.views, 0) - coalesce(s.prev_views, 0), 0))::bigint,
    sum(greatest(coalesce(s.interactions, 0) - coalesce(s.prev_interactions, 0), 0))::bigint
  FROM snaps s
  WHERE s.metric_date >= p_from AND p_to - p_from <= 400
  GROUP BY s.metric_date
  ORDER BY s.metric_date;
$$;

REVOKE ALL ON FUNCTION public.social_metrics_timeline(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.social_metrics_timeline(uuid, date, date) TO authenticated, service_role;

-- 7. RLS i uprawnienia ------------------------------------------------------------------------------------------------

ALTER TABLE public.social_post_metrics_daily ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS social_post_metrics_daily_select ON public.social_post_metrics_daily;
CREATE POLICY social_post_metrics_daily_select ON public.social_post_metrics_daily FOR SELECT TO authenticated
  USING (public.social_media_can(company_id, 'view'));
REVOKE ALL ON public.social_post_metrics_daily FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.social_post_metrics_daily TO authenticated;
GRANT ALL ON public.social_post_metrics_daily TO service_role;

-- 8. Harmonogram: pg_cron → Next (tylko gdy jest praca) -----------------------------------------------------------------
-- Treść jak w 20261119220000 + zadania `metrics` (wyniki postów) i `report` (raport tygodniowy marek z publikacjami
-- z ostatnich 5 tygodni, które nie mają jeszcze raportu za poprzedni tydzień).
CREATE OR REPLACE FUNCTION public.invoke_social_worker(p_task text)
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
  IF p_task NOT IN ('publish', 'comments', 'metrics', 'report') THEN
    RAISE EXCEPTION 'Nieznane zadanie social media.' USING ERRCODE = '22023';
  END IF;
  IF p_task = 'publish' AND NOT EXISTS (
    SELECT 1 FROM public.social_posts
    WHERE (status = 'scheduled' AND scheduled_at <= now() + interval '30 seconds')
       OR (status = 'publishing' AND publish_started_at < now() - interval '10 minutes')) THEN
    RETURN NULL;
  END IF;
  IF p_task = 'comments' AND NOT EXISTS (
    SELECT 1 FROM public.social_publications
    WHERE status = 'published' AND external_id IS NOT NULL AND published_at > now() - interval '30 days') THEN
    RETURN NULL;
  END IF;
  IF p_task = 'metrics' AND NOT EXISTS (SELECT 1 FROM public.social_metrics_due(1, NULL)) THEN
    RETURN NULL;
  END IF;
  IF p_task = 'report' AND NOT EXISTS (
    SELECT 1 FROM public.social_publications p
    WHERE p.status = 'published' AND p.published_at > now() - interval '35 days'
      AND NOT EXISTS (SELECT 1 FROM public.marketing_ai_insights i
                      WHERE i.company_id = p.company_id AND i.kind = 'social_weekly'
                        AND i.period_start = public.social_report_last_week())) THEN
    RETURN NULL;
  END IF;

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
    RAISE WARNING 'Social media worker skipped: crm_base_url or marketing_cron_secret is missing.';
    RETURN NULL;
  END IF;

  SELECT net.http_post(
    url := rtrim(base_url, '/') || '/bridge/social/worker',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-marketing-cron-secret', cron_secret
    ),
    body := jsonb_build_object('task', p_task, 'source', 'pg_cron'),
    timeout_milliseconds := 300000
  ) INTO request_id;

  RETURN request_id;
END;
$$;

REVOKE ALL ON FUNCTION public.invoke_social_worker(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.invoke_social_worker(text) TO service_role;

-- Wyniki: co godzinę (minuta 17). Raport: w poniedziałek od 7:23 (8:23 latem) co godzinę do skutku — kolejne wywołania
-- nic nie robią, gdy raporty za poprzedni tydzień już są.
DO $$
DECLARE
  v_job_id bigint;
BEGIN
  IF to_regclass('cron.job') IS NULL THEN
    RAISE NOTICE 'pg_cron niedostępny — harmonogram statystyk social media pominięty.';
    RETURN;
  END IF;
  FOR v_job_id IN SELECT jobid FROM cron.job WHERE jobname IN ('social-media-metrics', 'social-media-weekly-report') LOOP
    PERFORM cron.unschedule(v_job_id);
  END LOOP;
  PERFORM cron.schedule('social-media-metrics', '17 * * * *', 'SELECT public.invoke_social_worker(''metrics'');');
  PERFORM cron.schedule('social-media-weekly-report', '23 6-12 * * 1', 'SELECT public.invoke_social_worker(''report'');');
END $$;
