/*
  Social media: LinkedIn (strona firmowa marki) — kanał „LinkedIn — post” obok Instagrama i Facebooka.

  - Integracja marketingu `linkedin` (token LinkedIn zaszyfrowany po stronie serwera CRM, jak Meta i Google).
  - Kanał `linkedin_page` w postach, publikacjach i dziennych statystykach; komentarze z platformy `linkedin`; zgoda klienta
    może obejmować platformę `linkedin` (zgoda bez listy platform — wszystkie, jak dotąd).
  - Braki posta: grafika LinkedIn (1,91:1, 4:5 albo 1:1, jak Facebook) i zgoda klienta na LinkedIn; komunikat o publikacji
    z nazwą kanału LinkedIn (bez „w Meta”).
  - Kolejka statystyk (`social_metrics_due`) pomija LinkedIn — statystyki postów LinkedIn dojdą osobno (bez tego publikacje
    LinkedIn bez pobranych wyników zajmowałyby początek kolejki).
  Konfiguracja aplikacji LinkedIn (Community Management API) — później; do tego czasu post na LinkedIn publikuje się ręcznie
  („Pobierz paczkę” + „Oznacz jako opublikowany”).
*/

ALTER TABLE public.marketing_integrations DROP CONSTRAINT IF EXISTS marketing_integrations_provider_check;
ALTER TABLE public.marketing_integrations ADD CONSTRAINT marketing_integrations_provider_check
  CHECK (provider = ANY (ARRAY['meta'::text, 'google'::text, 'linkedin'::text]));

ALTER TABLE public.social_posts DROP CONSTRAINT IF EXISTS social_posts_channels_check;
ALTER TABLE public.social_posts ADD CONSTRAINT social_posts_channels_check
  CHECK (channels <@ ARRAY['instagram_feed', 'instagram_story', 'facebook_feed', 'linkedin_page']::text[]);

ALTER TABLE public.social_publications DROP CONSTRAINT IF EXISTS social_publications_channel_check;
ALTER TABLE public.social_publications ADD CONSTRAINT social_publications_channel_check
  CHECK (channel = ANY (ARRAY['instagram_feed'::text, 'instagram_story'::text, 'facebook_feed'::text, 'linkedin_page'::text]));

ALTER TABLE public.social_post_metrics_daily DROP CONSTRAINT IF EXISTS social_post_metrics_daily_channel_check;
ALTER TABLE public.social_post_metrics_daily ADD CONSTRAINT social_post_metrics_daily_channel_check
  CHECK (channel = ANY (ARRAY['instagram_feed'::text, 'instagram_story'::text, 'facebook_feed'::text, 'linkedin_page'::text]));

ALTER TABLE public.social_comments DROP CONSTRAINT IF EXISTS social_comments_platform_check;
ALTER TABLE public.social_comments ADD CONSTRAINT social_comments_platform_check
  CHECK (platform = ANY (ARRAY['facebook'::text, 'instagram'::text, 'linkedin'::text]));

ALTER TABLE public.social_assets DROP CONSTRAINT IF EXISTS social_assets_consent_channels_check;
ALTER TABLE public.social_assets ADD CONSTRAINT social_assets_consent_channels_check
  CHECK (consent_channels <@ ARRAY['facebook'::text, 'instagram'::text, 'linkedin'::text, 'website'::text]);

ALTER TABLE public.social_publication_consents DROP CONSTRAINT IF EXISTS social_publication_consents_channels_check;
ALTER TABLE public.social_publication_consents ADD CONSTRAINT social_publication_consents_channels_check
  CHECK (channels <@ ARRAY['facebook'::text, 'instagram'::text, 'linkedin'::text, 'website'::text]);

-- Braki posta: grafika i zgoda klienta także dla LinkedIn.
CREATE OR REPLACE FUNCTION public.social_post_problems(p_post_id uuid, p_require_consent boolean DEFAULT true)
RETURNS text[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_post public.social_posts%ROWTYPE;
  v_problems text[] := '{}'::text[];
  v_channel text;
  v_formats text[];
  v_asset public.social_assets%ROWTYPE;
  v_consent jsonb;
  v_platforms text[];
  v_label text;
BEGIN
  SELECT * INTO v_post FROM public.social_posts WHERE id = p_post_id;
  IF NOT FOUND THEN
    RETURN ARRAY['Nie znaleziono posta.'];
  END IF;
  IF cardinality(v_post.channels) = 0 THEN
    v_problems := array_append(v_problems, 'Wybierz co najmniej jeden kanał publikacji.');
  END IF;
  FOREACH v_channel IN ARRAY v_post.channels LOOP
    v_formats := CASE v_channel
      WHEN 'instagram_feed' THEN ARRAY['4:5', '1:1']
      WHEN 'instagram_story' THEN ARRAY['9:16']
      ELSE ARRAY['1.91:1', '4:5', '1:1'] END;
    IF NOT EXISTS (SELECT 1 FROM public.social_post_variants v
                   WHERE v.post_id = p_post_id AND v.format = ANY(v_formats) AND v.asset_id IS NOT NULL) THEN
      v_problems := array_append(v_problems, CASE v_channel
        WHEN 'instagram_feed' THEN 'Instagram — post: dodaj grafikę 4:5 albo 1:1.'
        WHEN 'instagram_story' THEN 'Instagram — relacja: dodaj grafikę 9:16.'
        WHEN 'linkedin_page' THEN 'LinkedIn: dodaj grafikę 1,91:1, 4:5 albo 1:1.'
        ELSE 'Facebook: dodaj grafikę 1,91:1, 4:5 albo 1:1.' END::text);
    END IF;
  END LOOP;
  IF NOT p_require_consent THEN
    RETURN v_problems;
  END IF;
  SELECT coalesce(array_agg(DISTINCT CASE WHEN c LIKE 'instagram%' THEN 'instagram' WHEN c LIKE 'linkedin%' THEN 'linkedin' ELSE 'facebook' END), '{}'::text[])
    INTO v_platforms FROM unnest(v_post.channels) AS c;
  FOR v_asset IN
    SELECT a.* FROM public.social_assets a
    WHERE a.id IN (
      SELECT v.asset_id FROM public.social_post_variants v WHERE v.post_id = p_post_id AND v.asset_id IS NOT NULL
      UNION
      SELECT s.asset_id FROM public.social_post_slides s WHERE s.post_id = p_post_id
    )
    ORDER BY a.created_at
  LOOP
    v_consent := public.social_asset_consent(v_asset);
    v_label := coalesce(nullif(btrim(v_asset.title), ''), nullif(btrim(v_asset.original_name), ''), 'zdjęcie');
    IF v_asset.status = 'archived' THEN
      v_problems := array_append(v_problems, format('„%s”: zdjęcie jest w archiwum biblioteki.', v_label));
    END IF;
    IF v_consent ->> 'status' NOT IN ('granted', 'not_required') THEN
      v_problems := array_append(v_problems, format('„%s”: zgoda klienta — %s.', v_label, CASE v_consent ->> 'status'
        WHEN 'denied' THEN 'brak zgody'
        WHEN 'requested' THEN 'czeka na odpowiedź'
        ELSE 'nieustalona' END));
    ELSIF v_consent ->> 'status' = 'granted' AND jsonb_array_length(v_consent -> 'channels') > 0
      AND EXISTS (SELECT 1 FROM unnest(v_platforms) AS p WHERE NOT (v_consent -> 'channels') ? p) THEN
      v_problems := array_append(v_problems, format('„%s”: zgoda klienta nie obejmuje wszystkich wybranych platform.', v_label));
    END IF;
  END LOOP;
  RETURN v_problems;
END;
$$;


REVOKE ALL ON FUNCTION public.social_post_problems(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.social_post_problems(uuid, boolean) TO authenticated, service_role;

-- Zakończenie publikacji: nazwy kanałów z LinkedIn, notatka bez „w Meta” (publikacja także na LinkedIn).
CREATE OR REPLACE FUNCTION public.social_publish_finish(p_post_id uuid, p_ok boolean, p_error text DEFAULT NULL::text, p_actor uuid DEFAULT NULL::uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_post public.social_posts%ROWTYPE;
  v_url text;
  v_error text;
  v_label text;
  v_actor_user uuid;
  v_recipients uuid[];
  v_channels text;
BEGIN
  SELECT * INTO v_post FROM public.social_posts WHERE id = p_post_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Nie znaleziono posta.' USING ERRCODE = 'P0002';
  END IF;
  IF v_post.status <> 'publishing' THEN
    RETURN jsonb_build_object('id', v_post.id, 'status', v_post.status, 'skipped', true);
  END IF;
  SELECT coalesce(e.auth_user_id, e.id) INTO v_actor_user FROM public.employees e WHERE e.id = p_actor;
  v_label := coalesce(nullif(btrim(v_post.title), ''), nullif(left(btrim(v_post.caption), 60), ''), 'Post');
  PERFORM set_config('mavinci.social_transition', 'on', true);

  IF p_ok THEN
    SELECT pb.permalink INTO v_url FROM public.social_publications pb
    WHERE pb.post_id = p_post_id AND pb.status = 'published' AND pb.permalink IS NOT NULL
    ORDER BY CASE pb.channel WHEN 'instagram_feed' THEN 1 WHEN 'facebook_feed' THEN 2 WHEN 'linkedin_page' THEN 3 ELSE 4 END
    LIMIT 1;
    SELECT string_agg(CASE pb.channel WHEN 'instagram_feed' THEN 'Instagram — post' WHEN 'instagram_story' THEN 'Instagram — relacja'
      WHEN 'linkedin_page' THEN 'LinkedIn — post' ELSE 'Facebook — post' END, ', ' ORDER BY pb.channel) INTO v_channels
    FROM public.social_publications pb WHERE pb.post_id = p_post_id AND pb.status = 'published';
    UPDATE public.social_posts SET status = 'published', published_at = now(), published_by = coalesce(p_actor, v_post.scheduled_by),
      published_url = v_url, publish_error = NULL, publish_started_at = NULL
    WHERE id = p_post_id;
    INSERT INTO public.social_post_events (post_id, kind, actor_id, revision, note)
    VALUES (p_post_id, 'published', coalesce(p_actor, v_post.scheduled_by), v_post.revision,
      'Opublikowano' || coalesce(': ' || v_channels, '') || '.');
  ELSE
    v_error := left(coalesce(nullif(btrim(coalesce(p_error, '')), ''), 'Publikacja nie powiodła się.'), 2000);
    UPDATE public.social_posts SET status = 'failed', publish_error = v_error, publish_started_at = NULL WHERE id = p_post_id;
    INSERT INTO public.social_post_events (post_id, kind, actor_id, revision, note)
    VALUES (p_post_id, 'publish_failed', p_actor, v_post.revision, left(v_error, 1000));
    v_recipients := ARRAY(
      SELECT DISTINCT coalesce(e.auth_user_id, e.id) FROM public.employees e
      WHERE e.id IN (v_post.author_id, v_post.scheduled_by) AND e.is_active
        AND coalesce(e.auth_user_id, e.id) IS DISTINCT FROM v_actor_user AND e.id IS DISTINCT FROM p_actor);
    IF cardinality(v_recipients) > 0 THEN
      PERFORM public.enqueue_crm_business_notification(
        'social-post:' || p_post_id::text || ':publish_failed:' || v_post.publish_attempts::text || ':' || floor(extract(epoch FROM clock_timestamp()))::bigint::text,
        'social_post_publish_failed', 'Publikacja posta nie powiodła się',
        concat_ws(' · ', v_label, left(v_error, 300)),
        'error', 'system', '/crm/marketing/social?post=' || p_post_id::text, NULL, NULL,
        jsonb_build_object('social_post_id', p_post_id, 'company_id', v_post.company_id), v_recipients);
    END IF;
  END IF;

  PERFORM set_config('mavinci.social_transition', 'off', true);
  SELECT * INTO v_post FROM public.social_posts WHERE id = p_post_id;
  RETURN jsonb_build_object('id', v_post.id, 'status', v_post.status, 'publishedUrl', v_post.published_url, 'error', v_post.publish_error);
END;
$function$;

-- Kolejka statystyk: bez LinkedIn (wyniki LinkedIn — osobny etap). Poza tym bez zmian.
CREATE OR REPLACE FUNCTION public.social_metrics_due(p_limit integer DEFAULT 40, p_company uuid DEFAULT NULL::uuid)
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT p.id FROM public.social_publications p
  WHERE p.status = 'published' AND p.external_id IS NOT NULL AND p.published_at IS NOT NULL
    AND p.channel <> 'linkedin_page'
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
$function$;
