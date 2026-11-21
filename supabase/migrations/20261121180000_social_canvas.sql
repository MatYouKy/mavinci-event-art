/*
  Social media — siatka profilu Instagram i panorama w karuzeli (Etap G).

  Duża grafika to układ z polem `canvas` w migawce układu wariantu (`social_post_variants.layout`): siatka profilu (3 kolumny ×
  1–3 rzędy) albo panorama (2–5 slajdów). Post ma wtedy jeden wariant 4:5 (zdjęcie, kadr w proporcjach całej grafiki, teksty),
  a serwer CRM renderuje dużą grafikę raz i tnie ją na kafelki 4:5 (1080 × 1350) — `social_post_tiles` (pozycja 1 — lewy
  górny; plik `<marka>/posts/<post>/tile-<nn>-<skrót>.jpg`). Kafelki to wynik renderu (jak `rendered_path` wariantu) — ich
  zmiana nie podnosi wersji posta; zmiana treści dużej grafiki podnosi ją przez wariant (jak dotąd).

  Publikacja: siatka — osobny post Instagram na każdy kafelek (od ostatniego do pierwszego), więc `social_publications` ma
  kolumnę `tile` (kafelek 1…n; zwykły post i panorama — 0) i unikalność (post, kanał, kafelek). Panorama — jedna karuzela
  (Instagram, Facebook, LinkedIn). `social_post_problems`: siatka tylko na feed Instagram, panorama bez relacji, tylko 4:5.
  `social_publish_finish`: link do posta — kafelek 1, kanały bez powtórzeń.
*/

CREATE TABLE IF NOT EXISTS public.social_post_tiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES public.social_posts(id) ON DELETE CASCADE,
  position smallint NOT NULL,
  rendered_path text,
  render_hash text,
  rendered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT social_post_tiles_position_check CHECK (position BETWEEN 1 AND 9),
  CONSTRAINT social_post_tiles_hash_check CHECK (render_hash IS NULL OR render_hash ~ '^[0-9a-f]{16,64}$'),
  CONSTRAINT social_post_tiles_unique UNIQUE (post_id, position)
);

COMMENT ON TABLE public.social_post_tiles IS
  'Kafelki dużej grafiki posta (siatka profilu Instagram, panorama w karuzeli) — wycinki jednego renderu, pozycja 1 = lewy górny.';

CREATE OR REPLACE FUNCTION public.social_post_tiles_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_company uuid;
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.post_id <> OLD.post_id OR NEW.position <> OLD.position) THEN
    RAISE EXCEPTION 'Nie można przenieść kafelka do innego posta ani miejsca.' USING ERRCODE = '22023';
  END IF;
  SELECT p.company_id INTO v_company FROM public.social_posts p WHERE p.id = NEW.post_id;
  IF NEW.rendered_path IS NOT NULL
    AND NEW.rendered_path !~ ('^' || v_company::text || '/posts/' || NEW.post_id::text || '/[A-Za-z0-9._-]{1,80}\.jpg$') THEN
    RAISE EXCEPTION 'Nieprawidłowa ścieżka kafelka.' USING ERRCODE = '22023';
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.created_at := now();
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS social_post_tiles_guard ON public.social_post_tiles;
CREATE TRIGGER social_post_tiles_guard BEFORE INSERT OR UPDATE ON public.social_post_tiles
  FOR EACH ROW EXECUTE FUNCTION public.social_post_tiles_guard();

ALTER TABLE public.social_post_tiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS social_post_tiles_select ON public.social_post_tiles;
CREATE POLICY social_post_tiles_select ON public.social_post_tiles FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.social_posts p WHERE p.id = post_id AND public.social_media_can(p.company_id, 'view')));
DROP POLICY IF EXISTS social_post_tiles_write ON public.social_post_tiles;
CREATE POLICY social_post_tiles_write ON public.social_post_tiles FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.social_posts p WHERE p.id = post_id AND public.social_media_can(p.company_id, 'create')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.social_posts p WHERE p.id = post_id AND public.social_media_can(p.company_id, 'create')));

REVOKE ALL ON public.social_post_tiles FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.social_post_tiles TO authenticated;
GRANT ALL ON public.social_post_tiles TO service_role;

-- Publikacja siatki: osobny post Instagram na kafelek (zwykły post i panorama — kafelek 0, jak dotąd).
ALTER TABLE public.social_publications ADD COLUMN IF NOT EXISTS tile smallint NOT NULL DEFAULT 0;
ALTER TABLE public.social_publications DROP CONSTRAINT IF EXISTS social_publications_tile_check;
ALTER TABLE public.social_publications ADD CONSTRAINT social_publications_tile_check CHECK (tile BETWEEN 0 AND 9);
ALTER TABLE public.social_publications DROP CONSTRAINT IF EXISTS social_publications_unique;
ALTER TABLE public.social_publications ADD CONSTRAINT social_publications_unique UNIQUE (post_id, channel, tile);

CREATE OR REPLACE FUNCTION public.social_publications_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.post_id <> OLD.post_id OR NEW.channel <> OLD.channel OR NEW.tile <> OLD.tile) THEN
    RAISE EXCEPTION 'Nie można przenieść publikacji do innego posta, kanału ani kafelka.' USING ERRCODE = '22023';
  END IF;
  SELECT p.company_id INTO NEW.company_id FROM public.social_posts p WHERE p.id = NEW.post_id;
  IF TG_OP = 'INSERT' THEN
    NEW.created_at := now();
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

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
  v_canvas jsonb;
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
  -- Kolaż: każde miejsce na zdjęcie w układzie wariantu ma zdjęcie (miejsce 0 — zdjęcie wariantu).
  FOR v_label IN
    SELECT v.format FROM public.social_post_variants v
    WHERE v.post_id = p_post_id AND v.asset_id IS NOT NULL AND v.layout IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(v.layout -> 'elements') = 'array' THEN v.layout -> 'elements' ELSE '[]'::jsonb END) AS e
        WHERE e ->> 'type' = 'photo' AND (e ->> 'slot') ~ '^[1-3]$'
          AND NOT EXISTS (SELECT 1 FROM public.social_post_slots c
                          WHERE c.post_id = p_post_id AND c.format = v.format AND c.slot = (e ->> 'slot')::smallint))
    ORDER BY v.format
  LOOP
    v_problems := array_append(v_problems, format('Kolaż %s: dodaj zdjęcia do wszystkich miejsc układu.', v_label));
  END LOOP;
  -- Siatka profilu / panorama (układ z dużą grafiką `canvas`): dozwolone kanały i jeden format 4:5.
  SELECT v.layout -> 'canvas' INTO v_canvas FROM public.social_post_variants v
  WHERE v.post_id = p_post_id AND jsonb_typeof(v.layout -> 'canvas') = 'object' LIMIT 1;
  IF v_canvas IS NOT NULL THEN
    IF v_canvas ->> 'mode' = 'grid' AND EXISTS (SELECT 1 FROM unnest(v_post.channels) AS c WHERE c <> 'instagram_feed') THEN
      v_problems := array_append(v_problems, 'Siatka profilu: tylko kanał „Instagram — post” (kafelki trafiają na profil Instagram).');
    END IF;
    IF v_canvas ->> 'mode' = 'panorama' AND 'instagram_story' = ANY(v_post.channels) THEN
      v_problems := array_append(v_problems, 'Panorama: relacja Instagram nie pokazuje karuzeli — usuń ten kanał.');
    END IF;
    IF EXISTS (SELECT 1 FROM public.social_post_variants v WHERE v.post_id = p_post_id AND v.format <> '4:5') THEN
      v_problems := array_append(v_problems, 'Siatka profilu i panorama mają tylko format 4:5.');
    END IF;
  END IF;
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
      UNION
      SELECT c.asset_id FROM public.social_post_slots c WHERE c.post_id = p_post_id
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
    -- Link: Instagram, Facebook, LinkedIn; siatka profilu — kafelek 1 (lewy górny, publikowany na końcu).
    SELECT pb.permalink INTO v_url FROM public.social_publications pb
    WHERE pb.post_id = p_post_id AND pb.status = 'published' AND pb.permalink IS NOT NULL
    ORDER BY CASE pb.channel WHEN 'instagram_feed' THEN 1 WHEN 'facebook_feed' THEN 2 WHEN 'linkedin_page' THEN 3 ELSE 4 END, pb.tile
    LIMIT 1;
    SELECT string_agg(x.label, ', ' ORDER BY x.channel) INTO v_channels FROM (
      SELECT DISTINCT pb.channel, CASE pb.channel WHEN 'instagram_feed' THEN 'Instagram — post' WHEN 'instagram_story' THEN 'Instagram — relacja'
        WHEN 'linkedin_page' THEN 'LinkedIn — post' ELSE 'Facebook — post' END AS label
      FROM public.social_publications pb WHERE pb.post_id = p_post_id AND pb.status = 'published'
    ) AS x;
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
