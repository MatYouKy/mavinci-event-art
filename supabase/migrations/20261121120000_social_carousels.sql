/*
  Social media: karuzele (Instagram do 10 zdjęć, Facebook — kilka zdjęć w jednym poście).

  Okładka posta zostaje w `social_post_variants` (bez zmian — starsze wersje aplikacji działają jak dotąd). Kolejne zdjęcia
  karuzeli to `social_post_slides`: pozycja 1–9 i format feedu (4:5, 1:1, 1.91:1) — wiersz na pozycję i każdy format okładki
  feedu, z tym samym zdjęciem z biblioteki na pozycji (pilnuje serwer CRM), własnym kadrem i grafiką (ten sam szablon i styl
  co okładka, bez tekstów; plik `<marka>/posts/<post>/slide-<n>-<format>-<skrót>.jpg`). Relacja (9:16) — bez karuzeli.
  Zmiana zdjęć, kadrów albo kolejności to zmiana treści posta (wersja +1 — zatwierdzony post wraca do szkicu, jak przy
  wariantach). Zgoda klienta przed publikacją obejmuje także zdjęcia karuzeli (`social_post_problems`).
*/

CREATE TABLE IF NOT EXISTS public.social_post_slides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES public.social_posts(id) ON DELETE CASCADE,
  position smallint NOT NULL,
  format text NOT NULL,
  asset_id uuid NOT NULL REFERENCES public.social_assets(id) ON DELETE RESTRICT,
  crop jsonb,
  rendered_path text,
  render_hash text,
  rendered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT social_post_slides_position_check CHECK (position BETWEEN 1 AND 9),
  CONSTRAINT social_post_slides_format_check CHECK (format IN ('4:5', '1:1', '1.91:1')),
  CONSTRAINT social_post_slides_crop_check CHECK (crop IS NULL OR public.social_crop_is_valid(crop)),
  CONSTRAINT social_post_slides_hash_check CHECK (render_hash IS NULL OR render_hash ~ '^[0-9a-f]{16,64}$'),
  CONSTRAINT social_post_slides_unique UNIQUE (post_id, position, format)
);
CREATE INDEX IF NOT EXISTS social_post_slides_asset_idx ON public.social_post_slides (asset_id);

COMMENT ON TABLE public.social_post_slides IS
  'Kolejne zdjęcia karuzeli posta (pozycje 1–9; okładka to social_post_variants) — wiersz na pozycję i format feedu.';

-- Zdjęcie z biblioteki tej samej marki (dostępne), ścieżka grafiki w katalogu posta, znaczniki czasu.
CREATE OR REPLACE FUNCTION public.social_post_slides_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_company uuid;
  v_asset_company uuid;
  v_asset_status text;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.post_id <> OLD.post_id THEN
    RAISE EXCEPTION 'Nie można przenieść zdjęcia karuzeli do innego posta.' USING ERRCODE = '22023';
  END IF;
  SELECT p.company_id INTO v_company FROM public.social_posts p WHERE p.id = NEW.post_id;
  IF TG_OP = 'INSERT' OR NEW.asset_id IS DISTINCT FROM OLD.asset_id THEN
    SELECT a.company_id, a.status INTO v_asset_company, v_asset_status FROM public.social_assets a WHERE a.id = NEW.asset_id;
    IF v_asset_company IS DISTINCT FROM v_company THEN
      RAISE EXCEPTION 'Zdjęcie musi pochodzić z biblioteki tej samej marki.' USING ERRCODE = '22023';
    END IF;
    IF v_asset_status NOT IN ('proposed', 'ready') THEN
      RAISE EXCEPTION 'To zdjęcie nie jest dostępne w bibliotece (wgrywane albo w archiwum).' USING ERRCODE = '22023';
    END IF;
  END IF;
  IF NEW.rendered_path IS NOT NULL
    AND NEW.rendered_path !~ ('^' || v_company::text || '/posts/' || NEW.post_id::text || '/[A-Za-z0-9._-]{1,80}\.jpg$') THEN
    RAISE EXCEPTION 'Nieprawidłowa ścieżka grafiki.' USING ERRCODE = '22023';
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.created_at := now();
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS social_post_slides_guard ON public.social_post_slides;
CREATE TRIGGER social_post_slides_guard BEFORE INSERT OR UPDATE ON public.social_post_slides
  FOR EACH ROW EXECUTE FUNCTION public.social_post_slides_guard();

-- Zmiana zdjęcia, kadru albo pozycji = nowa wersja posta (sam render grafiki — nie).
CREATE OR REPLACE FUNCTION public.social_post_slides_touch_post()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.position IS NOT DISTINCT FROM OLD.position AND NEW.format IS NOT DISTINCT FROM OLD.format
    AND NEW.asset_id IS NOT DISTINCT FROM OLD.asset_id AND NEW.crop IS NOT DISTINCT FROM OLD.crop THEN
    RETURN NULL;
  END IF;
  UPDATE public.social_posts SET revision = revision + 1
  WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD.post_id ELSE NEW.post_id END;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS social_post_slides_touch_post ON public.social_post_slides;
CREATE TRIGGER social_post_slides_touch_post AFTER INSERT OR UPDATE OR DELETE ON public.social_post_slides
  FOR EACH ROW EXECUTE FUNCTION public.social_post_slides_touch_post();

ALTER TABLE public.social_post_slides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS social_post_slides_select ON public.social_post_slides;
CREATE POLICY social_post_slides_select ON public.social_post_slides FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.social_posts p WHERE p.id = post_id AND public.social_media_can(p.company_id, 'view')));
DROP POLICY IF EXISTS social_post_slides_write ON public.social_post_slides;
CREATE POLICY social_post_slides_write ON public.social_post_slides FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.social_posts p WHERE p.id = post_id AND public.social_media_can(p.company_id, 'create')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.social_posts p WHERE p.id = post_id AND public.social_media_can(p.company_id, 'create')));

REVOKE ALL ON public.social_post_slides FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.social_post_slides TO authenticated;
GRANT ALL ON public.social_post_slides TO service_role;

-- Braki posta: jak dotąd + zgoda klienta i archiwum także dla zdjęć karuzeli.
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
        ELSE 'Facebook: dodaj grafikę 1,91:1, 4:5 albo 1:1.' END::text);
    END IF;
  END LOOP;
  IF NOT p_require_consent THEN
    RETURN v_problems;
  END IF;
  SELECT coalesce(array_agg(DISTINCT CASE WHEN c LIKE 'instagram%' THEN 'instagram' ELSE 'facebook' END), '{}'::text[])
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
