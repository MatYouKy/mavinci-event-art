/*
  Social media: układy grafik jako dane (kreator układów, kolaże).

  - `social_layouts` — układy marki zapisane jako dane (definicja JSON: tło, miejsca na zdjęcia, przyciemnienia, ramki,
    logo i teksty z pozycjami w każdym formacie). Kolory, fonty i logo nadal wyłącznie z księgi znaku przez szablon marki
    (układ wskazuje tylko role: przyciemnienie / akcent / tekst, font tytułu / podpisu). Podgląd: Social media — podgląd;
    zmiany: osoba akceptująca (jak szablony marki).
  - Wariant posta: `layout_id` (wybrany układ) i `layout` — migawka definicji z chwili zapisu posta (zatwierdzony post nie
    zmienia się po późniejszej edycji układu). Bez układu — styl grafiki jak dotąd. Zmiana układu = nowa wersja posta.
  - `social_post_slots` — zdjęcia kolażu w miejscach 1–3 (miejsce 0 to zdjęcie wariantu): wiersz na miejsce i format, z tym
    samym zdjęciem z biblioteki na miejscu (pilnuje serwer CRM) i własnym kadrem w proporcjach miejsca. Zmiana = nowa wersja.
  - `social_post_problems`: zgoda klienta także dla zdjęć kolażu; kolaż bez zdjęcia w którymś miejscu blokuje akceptację.
*/

CREATE TABLE IF NOT EXISTS public.social_layouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.my_companies(id) ON DELETE CASCADE,
  name text NOT NULL,
  definition jsonb NOT NULL,
  is_archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  CONSTRAINT social_layouts_name_check CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  CONSTRAINT social_layouts_definition_check CHECK (jsonb_typeof(definition) = 'object' AND pg_column_size(definition) <= 65536)
);
CREATE INDEX IF NOT EXISTS social_layouts_company_idx ON public.social_layouts (company_id, is_archived);

COMMENT ON TABLE public.social_layouts IS
  'Układy grafik social media marki jako dane (definicja JSON; kolory, fonty i logo — role z szablonu / księgi znaku).';

CREATE OR REPLACE FUNCTION public.social_layouts_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.company_id <> OLD.company_id THEN
    RAISE EXCEPTION 'Nie można przenieść układu do innej marki.' USING ERRCODE = '22023';
  END IF;
  NEW.name := btrim(NEW.name);
  IF TG_OP = 'INSERT' THEN
    NEW.created_by := coalesce(public.current_crm_employee_id(), NEW.created_by);
    NEW.created_at := now();
  END IF;
  NEW.updated_at := now();
  NEW.updated_by := coalesce(public.current_crm_employee_id(), NEW.updated_by);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS social_layouts_guard ON public.social_layouts;
CREATE TRIGGER social_layouts_guard BEFORE INSERT OR UPDATE ON public.social_layouts
  FOR EACH ROW EXECUTE FUNCTION public.social_layouts_guard();

ALTER TABLE public.social_layouts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS social_layouts_select ON public.social_layouts;
CREATE POLICY social_layouts_select ON public.social_layouts FOR SELECT TO authenticated
  USING (public.social_media_can(company_id, 'view'));
DROP POLICY IF EXISTS social_layouts_write ON public.social_layouts;
CREATE POLICY social_layouts_write ON public.social_layouts FOR ALL TO authenticated
  USING (public.social_media_can(company_id, 'approve'))
  WITH CHECK (public.social_media_can(company_id, 'approve'));

REVOKE ALL ON public.social_layouts FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.social_layouts TO authenticated;
GRANT ALL ON public.social_layouts TO service_role;

-- Wariant posta: wybrany układ i migawka jego definicji (render).
ALTER TABLE public.social_post_variants ADD COLUMN IF NOT EXISTS layout_id uuid REFERENCES public.social_layouts(id) ON DELETE SET NULL;
ALTER TABLE public.social_post_variants ADD COLUMN IF NOT EXISTS layout jsonb;
ALTER TABLE public.social_post_variants DROP CONSTRAINT IF EXISTS social_post_variants_layout_check;
ALTER TABLE public.social_post_variants ADD CONSTRAINT social_post_variants_layout_check
  CHECK (layout IS NULL OR (jsonb_typeof(layout) = 'object' AND pg_column_size(layout) <= 65536));
CREATE INDEX IF NOT EXISTS social_post_variants_layout_idx ON public.social_post_variants (layout_id) WHERE layout_id IS NOT NULL;

-- Strażnik wariantu: jak dotąd + układ z tej samej marki.
CREATE OR REPLACE FUNCTION public.social_post_variants_guard()
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
    RAISE EXCEPTION 'Nie można przenieść grafiki do innego posta.' USING ERRCODE = '22023';
  END IF;
  SELECT p.company_id INTO v_company FROM public.social_posts p WHERE p.id = NEW.post_id;
  IF NEW.asset_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.asset_id IS DISTINCT FROM OLD.asset_id) THEN
    SELECT a.company_id, a.status INTO v_asset_company, v_asset_status FROM public.social_assets a WHERE a.id = NEW.asset_id;
    IF v_asset_company IS DISTINCT FROM v_company THEN
      RAISE EXCEPTION 'Zdjęcie musi pochodzić z biblioteki tej samej marki.' USING ERRCODE = '22023';
    END IF;
    IF v_asset_status NOT IN ('proposed', 'ready') THEN
      RAISE EXCEPTION 'To zdjęcie nie jest dostępne w bibliotece (wgrywane albo w archiwum).' USING ERRCODE = '22023';
    END IF;
  END IF;
  IF NEW.layout_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.layout_id IS DISTINCT FROM OLD.layout_id)
    AND NOT EXISTS (SELECT 1 FROM public.social_layouts l WHERE l.id = NEW.layout_id AND l.company_id = v_company) THEN
    RAISE EXCEPTION 'Układ musi należeć do tej samej marki.' USING ERRCODE = '22023';
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

-- Zmiana treści wariantu (także układu) = nowa wersja posta; sam render i wskazanie układu bez zmiany definicji — nie.
CREATE OR REPLACE FUNCTION public.social_post_variants_touch_post()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.format IS NOT DISTINCT FROM OLD.format AND NEW.asset_id IS NOT DISTINCT FROM OLD.asset_id
    AND NEW.crop IS NOT DISTINCT FROM OLD.crop AND NEW.headline IS NOT DISTINCT FROM OLD.headline
    AND NEW.subline IS NOT DISTINCT FROM OLD.subline AND NEW.style IS NOT DISTINCT FROM OLD.style
    AND NEW.kicker IS NOT DISTINCT FROM OLD.kicker AND NEW.layout IS NOT DISTINCT FROM OLD.layout THEN
    RETURN NULL;
  END IF;
  UPDATE public.social_posts SET revision = revision + 1
  WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD.post_id ELSE NEW.post_id END;
  RETURN NULL;
END;
$$;

-- Zdjęcia kolażu (miejsca 1–3; miejsce 0 — zdjęcie wariantu).
CREATE TABLE IF NOT EXISTS public.social_post_slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES public.social_posts(id) ON DELETE CASCADE,
  slot smallint NOT NULL,
  format text NOT NULL,
  asset_id uuid NOT NULL REFERENCES public.social_assets(id) ON DELETE RESTRICT,
  crop jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT social_post_slots_slot_check CHECK (slot BETWEEN 1 AND 3),
  CONSTRAINT social_post_slots_format_check CHECK (format IN ('4:5', '1:1', '9:16', '1.91:1')),
  CONSTRAINT social_post_slots_crop_check CHECK (crop IS NULL OR public.social_crop_is_valid(crop)),
  CONSTRAINT social_post_slots_unique UNIQUE (post_id, slot, format)
);
CREATE INDEX IF NOT EXISTS social_post_slots_asset_idx ON public.social_post_slots (asset_id);

COMMENT ON TABLE public.social_post_slots IS
  'Zdjęcia kolażu posta w miejscach 1–3 układu (miejsce 0 — zdjęcie wariantu) — wiersz na miejsce i format.';

CREATE OR REPLACE FUNCTION public.social_post_slots_guard()
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
    RAISE EXCEPTION 'Nie można przenieść zdjęcia kolażu do innego posta.' USING ERRCODE = '22023';
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
  IF TG_OP = 'INSERT' THEN
    NEW.created_at := now();
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS social_post_slots_guard ON public.social_post_slots;
CREATE TRIGGER social_post_slots_guard BEFORE INSERT OR UPDATE ON public.social_post_slots
  FOR EACH ROW EXECUTE FUNCTION public.social_post_slots_guard();

CREATE OR REPLACE FUNCTION public.social_post_slots_touch_post()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.slot IS NOT DISTINCT FROM OLD.slot AND NEW.format IS NOT DISTINCT FROM OLD.format
    AND NEW.asset_id IS NOT DISTINCT FROM OLD.asset_id AND NEW.crop IS NOT DISTINCT FROM OLD.crop THEN
    RETURN NULL;
  END IF;
  UPDATE public.social_posts SET revision = revision + 1
  WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD.post_id ELSE NEW.post_id END;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS social_post_slots_touch_post ON public.social_post_slots;
CREATE TRIGGER social_post_slots_touch_post AFTER INSERT OR UPDATE OR DELETE ON public.social_post_slots
  FOR EACH ROW EXECUTE FUNCTION public.social_post_slots_touch_post();

ALTER TABLE public.social_post_slots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS social_post_slots_select ON public.social_post_slots;
CREATE POLICY social_post_slots_select ON public.social_post_slots FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.social_posts p WHERE p.id = post_id AND public.social_media_can(p.company_id, 'view')));
DROP POLICY IF EXISTS social_post_slots_write ON public.social_post_slots;
CREATE POLICY social_post_slots_write ON public.social_post_slots FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.social_posts p WHERE p.id = post_id AND public.social_media_can(p.company_id, 'create')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.social_posts p WHERE p.id = post_id AND public.social_media_can(p.company_id, 'create')));

REVOKE ALL ON public.social_post_slots FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.social_post_slots TO authenticated;
GRANT ALL ON public.social_post_slots TO service_role;

-- Braki posta: jak dotąd + kolaż bez zdjęcia w którymś miejscu i zgoda klienta także dla zdjęć kolażu.
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

REVOKE ALL ON FUNCTION public.social_post_problems(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.social_post_problems(uuid, boolean) TO authenticated, service_role;
