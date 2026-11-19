-- Marketing → „Social media” (Etap 2): publikacja i planowanie w Meta (Facebook — post ze zdjęciem, Instagram — post
-- i relacja) oraz komentarze Facebook i Instagram z odpowiedziami z CRM, Maca i telefonu.
-- Wymaga migracji 20261119200000_marketing_social_media.sql. Plik idempotentny — można go wykonać ponownie.
--
-- Publikację wykonuje wyłącznie serwer Next (`/bridge/social/worker` i „Opublikuj teraz”) tokenem strony zapisanym
-- zaszyfrowanym w `marketing_integrations` — baza nie widzi tokenów. pg_cron co minutę sprawdza, czy są posty do publikacji
-- (i co 15 minut — czy są opublikowane posty z ostatnich 30 dni do odświeżenia komentarzy); tylko wtedy wywołuje Next
-- (sekrety w vault: `crm_base_url`, `marketing_cron_secret` — te same co synchronizacja marketingu).
--
-- Statusy: zatwierdzony → „Zaplanuj publikację” (uprawnienie „Publikacja”) → zaplanowany → w terminie: publikowanie →
-- opublikowany albo „błąd publikacji” (powiadomienie: autor i osoba planująca, bez osoby, która właśnie kliknęła
-- „Opublikuj teraz”). „Wstrzymaj publikację” → zatwierdzony. Kanały publikowane osobno (`social_publications`) —
-- ponowienie publikuje tylko brakujące, nic nie trafia do Meta dwa razy. Zmiana treści zaplanowanego posta cofa go do szkicu;
-- po opublikowaniu części kanałów treści nie można już zmienić (kopia posta).
-- Komentarze (`social_comments`) zapisuje wyłącznie serwer; odpowiedź z CRM — twórca treści (zakres „create”).
-- Nowe komentarze bez odpowiedzi → powiadomienie autora posta (raz na odświeżenie, zbiorczo).

-- 1. Post: nowe statusy i dane publikacji ------------------------------------------------------------------------------

ALTER TABLE public.social_posts
  ADD COLUMN IF NOT EXISTS scheduled_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS publish_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS publish_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS publish_error text;

ALTER TABLE public.social_posts DROP CONSTRAINT IF EXISTS social_posts_status_check;
ALTER TABLE public.social_posts ADD CONSTRAINT social_posts_status_check CHECK (status IN (
  'draft', 'in_review', 'changes_requested', 'approved', 'scheduled', 'publishing', 'failed', 'published', 'cancelled'));
ALTER TABLE public.social_posts DROP CONSTRAINT IF EXISTS social_posts_publish_check;
ALTER TABLE public.social_posts ADD CONSTRAINT social_posts_publish_check
  CHECK (publish_attempts >= 0 AND char_length(coalesce(publish_error, '')) <= 2000);

ALTER TABLE public.social_post_events DROP CONSTRAINT IF EXISTS social_post_events_kind_check;
ALTER TABLE public.social_post_events ADD CONSTRAINT social_post_events_kind_check CHECK (kind IN ('created', 'submitted',
  'approved', 'changes_requested', 'reopened', 'edited_after_approval', 'cancelled', 'published', 'scheduled', 'unscheduled',
  'publish_failed'));

CREATE INDEX IF NOT EXISTS social_posts_due_idx ON public.social_posts (scheduled_at) WHERE status IN ('scheduled', 'publishing');

-- 2. Publikacje kanałów ----------------------------------------------------------------------------------------------
-- Jeden wiersz na kanał posta: stan wysyłki do Meta, identyfikatory (kontener Instagram, media / post), link, błąd.
-- „sending” — wysyłka trwała, gdy proces został przerwany: serwer najpierw sprawdza w Meta, czy post już jest, i dopiero
-- potem ponawia (bez podwójnej publikacji).
CREATE TABLE IF NOT EXISTS public.social_publications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES public.social_posts(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.my_companies(id) ON DELETE CASCADE,
  channel text NOT NULL,
  format text,
  status text NOT NULL DEFAULT 'pending',
  account_id text,
  container_id text,
  external_id text,
  permalink text,
  error text,
  attempts integer NOT NULL DEFAULT 0,
  attempted_at timestamptz,
  published_at timestamptz,
  comments_synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT social_publications_channel_check CHECK (channel IN ('instagram_feed', 'instagram_story', 'facebook_feed')),
  CONSTRAINT social_publications_format_check CHECK (format IS NULL OR format IN ('4:5', '1:1', '9:16', '1.91:1')),
  CONSTRAINT social_publications_status_check CHECK (status IN ('pending', 'sending', 'published', 'failed')),
  CONSTRAINT social_publications_permalink_check CHECK (permalink IS NULL OR (permalink ~ '^https://\S{4,}$' AND char_length(permalink) <= 2000)),
  CONSTRAINT social_publications_text_check CHECK (char_length(coalesce(error, '')) <= 2000 AND char_length(coalesce(external_id, '')) <= 200
    AND char_length(coalesce(container_id, '')) <= 200 AND char_length(coalesce(account_id, '')) <= 200 AND attempts >= 0),
  CONSTRAINT social_publications_unique UNIQUE (post_id, channel)
);
CREATE INDEX IF NOT EXISTS social_publications_company_idx ON public.social_publications (company_id, published_at DESC);
CREATE INDEX IF NOT EXISTS social_publications_published_idx ON public.social_publications (published_at DESC) WHERE status = 'published';

CREATE OR REPLACE FUNCTION public.social_publications_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.post_id <> OLD.post_id OR NEW.channel <> OLD.channel) THEN
    RAISE EXCEPTION 'Nie można przenieść publikacji do innego posta ani kanału.' USING ERRCODE = '22023';
  END IF;
  SELECT p.company_id INTO NEW.company_id FROM public.social_posts p WHERE p.id = NEW.post_id;
  IF TG_OP = 'INSERT' THEN
    NEW.created_at := now();
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS social_publications_guard ON public.social_publications;
CREATE TRIGGER social_publications_guard BEFORE INSERT OR UPDATE ON public.social_publications
  FOR EACH ROW EXECUTE FUNCTION public.social_publications_guard();

-- 3. Komentarze ----------------------------------------------------------------------------------------------------------
-- Komentarze opublikowanych postów (Facebook, Instagram) i odpowiedzi; `is_own` — konto marki (strona / profil IG),
-- `answered_at` — komentarz najwyższego poziomu ma odpowiedź marki (z CRM albo bezpośrednio w Meta).
CREATE TABLE IF NOT EXISTS public.social_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.my_companies(id) ON DELETE CASCADE,
  post_id uuid NOT NULL REFERENCES public.social_posts(id) ON DELETE CASCADE,
  publication_id uuid NOT NULL REFERENCES public.social_publications(id) ON DELETE CASCADE,
  platform text NOT NULL,
  external_id text NOT NULL,
  parent_external_id text,
  author_name text NOT NULL DEFAULT '',
  author_external_id text,
  is_own boolean NOT NULL DEFAULT false,
  message text NOT NULL DEFAULT '',
  commented_at timestamptz NOT NULL DEFAULT now(),
  like_count integer NOT NULL DEFAULT 0,
  replied_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  answered_at timestamptz,
  notified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT social_comments_platform_check CHECK (platform IN ('facebook', 'instagram')),
  CONSTRAINT social_comments_text_check CHECK (char_length(message) <= 8000 AND char_length(author_name) <= 300
    AND char_length(external_id) BETWEEN 1 AND 200 AND char_length(coalesce(parent_external_id, '')) <= 200
    AND char_length(coalesce(author_external_id, '')) <= 200 AND like_count >= 0),
  CONSTRAINT social_comments_unique UNIQUE (platform, external_id)
);
CREATE INDEX IF NOT EXISTS social_comments_post_idx ON public.social_comments (post_id, commented_at);
CREATE INDEX IF NOT EXISTS social_comments_inbox_idx ON public.social_comments (company_id, commented_at DESC)
  WHERE parent_external_id IS NULL AND NOT is_own;

CREATE OR REPLACE FUNCTION public.social_comments_touch()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.created_at := now();
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS social_comments_touch ON public.social_comments;
CREATE TRIGGER social_comments_touch BEFORE INSERT OR UPDATE ON public.social_comments
  FOR EACH ROW EXECUTE FUNCTION public.social_comments_touch();

-- 4. Wyzwalacz posta: nowe pola chronione, termin zaplanowanej publikacji, blokady w trakcie i po publikacji ------------

CREATE OR REPLACE FUNCTION public.social_posts_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor uuid := public.current_crm_employee_id();
  v_session boolean := auth.uid() IS NOT NULL;
  v_transition boolean := coalesce(current_setting('mavinci.social_transition', true), '') = 'on';
  v_content boolean;
  v_people constant text[] := ARRAY['author_id', 'submitted_by', 'reviewed_by', 'published_by', 'scheduled_by', 'updated_by', 'updated_at'];
BEGIN
  NEW.hashtags := public.social_normalize_hashtags(NEW.hashtags);
  NEW.channels := ARRAY(SELECT DISTINCT c FROM unnest(NEW.channels) AS c ORDER BY c);
  IF TG_OP = 'INSERT' THEN
    IF v_session THEN
      NEW.author_id := v_actor;
      NEW.status := 'draft';
      NEW.revision := 1;
      NEW.submitted_at := NULL; NEW.submitted_by := NULL;
      NEW.reviewed_at := NULL; NEW.reviewed_by := NULL; NEW.review_note := NULL; NEW.approved_revision := NULL;
      NEW.published_at := NULL; NEW.published_by := NULL; NEW.published_url := NULL; NEW.cancelled_at := NULL;
      NEW.scheduled_by := NULL; NEW.publish_started_at := NULL; NEW.publish_attempts := 0; NEW.publish_error := NULL;
    END IF;
    NEW.created_at := now();
    NEW.updated_at := now();
    NEW.updated_by := coalesce(v_actor, NEW.updated_by);
    RETURN NEW;
  END IF;

  -- Usunięcie konta pracownika (klucze obce SET NULL) — zmieniają się tylko pola osób, na NULL.
  IF (to_jsonb(NEW) - v_people) = (to_jsonb(OLD) - v_people) AND NOT EXISTS (
    SELECT 1 FROM unnest(v_people) AS column_name
    WHERE to_jsonb(NEW) -> column_name IS DISTINCT FROM to_jsonb(OLD) -> column_name
      AND column_name <> 'updated_at' AND to_jsonb(NEW) -> column_name <> 'null'::jsonb) THEN
    NEW.updated_at := OLD.updated_at;
    RETURN NEW;
  END IF;
  IF NEW.company_id <> OLD.company_id OR NEW.author_id IS DISTINCT FROM OLD.author_id OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Nie można zmienić marki ani autora posta.' USING ERRCODE = '22023';
  END IF;
  IF NOT v_transition AND v_session AND (
    NEW.status IS DISTINCT FROM OLD.status OR NEW.submitted_at IS DISTINCT FROM OLD.submitted_at
    OR NEW.submitted_by IS DISTINCT FROM OLD.submitted_by OR NEW.reviewed_at IS DISTINCT FROM OLD.reviewed_at
    OR NEW.reviewed_by IS DISTINCT FROM OLD.reviewed_by OR NEW.review_note IS DISTINCT FROM OLD.review_note
    OR NEW.approved_revision IS DISTINCT FROM OLD.approved_revision OR NEW.published_at IS DISTINCT FROM OLD.published_at
    OR NEW.published_by IS DISTINCT FROM OLD.published_by OR NEW.published_url IS DISTINCT FROM OLD.published_url
    OR NEW.cancelled_at IS DISTINCT FROM OLD.cancelled_at OR NEW.scheduled_by IS DISTINCT FROM OLD.scheduled_by
    OR NEW.publish_started_at IS DISTINCT FROM OLD.publish_started_at OR NEW.publish_attempts IS DISTINCT FROM OLD.publish_attempts
    OR NEW.publish_error IS DISTINCT FROM OLD.publish_error) THEN
    RAISE EXCEPTION 'Status posta zmieniają przyciski akcji: akceptacja, planowanie i publikacja.' USING ERRCODE = '42501';
  END IF;

  v_content := NEW.channels IS DISTINCT FROM OLD.channels OR NEW.caption IS DISTINCT FROM OLD.caption
    OR NEW.hashtags IS DISTINCT FROM OLD.hashtags OR NEW.template_id IS DISTINCT FROM OLD.template_id
    OR NEW.event_id IS DISTINCT FROM OLD.event_id OR NEW.portfolio_project_id IS DISTINCT FROM OLD.portfolio_project_id
    OR NEW.revision IS DISTINCT FROM OLD.revision;

  IF v_transition THEN
    NEW.revision := OLD.revision;
  ELSIF v_content OR NEW.scheduled_at IS DISTINCT FROM OLD.scheduled_at OR NEW.title IS DISTINCT FROM OLD.title THEN
    IF OLD.status IN ('published', 'cancelled') THEN
      RAISE EXCEPTION 'Opublikowanego ani anulowanego posta nie można zmieniać — przywróć go do szkicu albo utwórz kopię.'
        USING ERRCODE = '22023';
    END IF;
    IF OLD.status = 'publishing' THEN
      RAISE EXCEPTION 'Post jest właśnie publikowany — poczekaj chwilę i odśwież widok.' USING ERRCODE = '55006';
    END IF;
    IF v_content AND EXISTS (SELECT 1 FROM public.social_publications pb WHERE pb.post_id = OLD.id AND pb.status = 'published') THEN
      RAISE EXCEPTION 'Część kanałów jest już opublikowana — treści nie można zmienić. Ponów publikację pozostałych kanałów, oznacz post jako opublikowany albo zrób kopię posta.'
        USING ERRCODE = '22023';
    END IF;
    -- Termin zaplanowanej publikacji zmienia osoba z uprawnieniem „Publikacja” (np. przeciągnięcie w kalendarzu).
    IF v_session AND OLD.status = 'scheduled' AND NEW.scheduled_at IS DISTINCT FROM OLD.scheduled_at AND NOT v_content THEN
      IF NOT public.social_media_can(OLD.company_id, 'publish') THEN
        RAISE EXCEPTION 'Termin zaplanowanej publikacji zmienia osoba z uprawnieniem „Publikacja”.' USING ERRCODE = '42501';
      END IF;
      IF NEW.scheduled_at IS NULL THEN
        RAISE EXCEPTION 'Zaplanowany post musi mieć termin — żeby go usunąć, najpierw wstrzymaj publikację.' USING ERRCODE = '22023';
      END IF;
      IF NEW.scheduled_at < now() - interval '1 minute' THEN
        RAISE EXCEPTION 'Termin publikacji musi być w przyszłości.' USING ERRCODE = '22023';
      END IF;
    END IF;
    IF v_content THEN
      NEW.revision := OLD.revision + 1;
      IF OLD.status IN ('approved', 'scheduled', 'failed') THEN
        NEW.status := 'draft';
        NEW.approved_revision := NULL;
        NEW.scheduled_by := NULL;
        NEW.publish_error := NULL;
        INSERT INTO public.social_post_events (post_id, kind, actor_id, revision, note)
        VALUES (OLD.id, 'edited_after_approval', v_actor, NEW.revision, CASE OLD.status
          WHEN 'approved' THEN 'Zmiana treści po zatwierdzeniu — post wrócił do szkicu.'
          ELSE 'Zmiana treści zaplanowanego posta — post wrócił do szkicu, publikacja wstrzymana.' END);
      END IF;
    ELSE
      NEW.revision := OLD.revision;
    END IF;
  ELSE
    NEW.revision := OLD.revision;
  END IF;
  NEW.updated_at := now();
  NEW.updated_by := coalesce(v_actor, NEW.updated_by);
  RETURN NEW;
END;
$$;

-- 5. Zmiany statusu: planowanie, wstrzymanie, publikacja ręczna ------------------------------------------------------
-- Akcje jak w Etapie 1 oraz: schedule (publikujący: zatwierdzony / błąd publikacji → zaplanowany; termin ustawiony,
-- najwcześniej teraz), unschedule (publikujący: zaplanowany / błąd → zatwierdzony). Publikacja ręczna („Oznacz jako
-- opublikowany”) także z „błędu publikacji”; link — podany albo pierwszy z opublikowanych kanałów.
CREATE OR REPLACE FUNCTION public.social_post_transition(
  p_post_id uuid,
  p_action text,
  p_expected_revision integer DEFAULT NULL,
  p_note text DEFAULT NULL,
  p_published_url text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor uuid := public.current_crm_employee_id();
  v_actor_user uuid;
  v_admin boolean := public.current_employee_is_crm_admin();
  v_post public.social_posts%ROWTYPE;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_url text := nullif(btrim(coalesce(p_published_url, '')), '');
  v_problems text[];
  v_recipients uuid[];
  v_author_user uuid;
  v_label text;
  v_actor_name text;
  v_partial boolean;
BEGIN
  IF v_actor IS NULL OR public.current_session_is_seller_portal() THEN
    RAISE EXCEPTION 'Brak dostępu do social media.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_post FROM public.social_posts WHERE id = p_post_id FOR UPDATE;
  IF NOT FOUND OR NOT public.social_media_can(v_post.company_id, 'view') THEN
    RAISE EXCEPTION 'Nie znaleziono posta.' USING ERRCODE = 'P0002';
  END IF;
  IF p_expected_revision IS NOT NULL AND p_expected_revision <> v_post.revision THEN
    RAISE EXCEPTION 'Post zmieniono w innym oknie. Odśwież widok i spróbuj ponownie.' USING ERRCODE = '40001';
  END IF;
  IF v_note IS NOT NULL AND char_length(v_note) > 1000 THEN
    RAISE EXCEPTION 'Notatka może mieć najwyżej 1000 znaków.' USING ERRCODE = '22023';
  END IF;
  IF v_post.status = 'publishing' THEN
    RAISE EXCEPTION 'Post jest właśnie publikowany — poczekaj chwilę i odśwież widok.' USING ERRCODE = '55006';
  END IF;
  v_partial := EXISTS (SELECT 1 FROM public.social_publications pb WHERE pb.post_id = p_post_id AND pb.status = 'published');

  SELECT coalesce(e.auth_user_id, e.id), btrim(concat_ws(' ', e.name, e.surname)) INTO v_actor_user, v_actor_name
  FROM public.employees e WHERE e.id = v_actor;
  SELECT coalesce(e.auth_user_id, e.id) INTO v_author_user FROM public.employees e WHERE e.id = v_post.author_id;
  v_label := coalesce(nullif(btrim(v_post.title), ''), nullif(left(btrim(v_post.caption), 60), ''), 'Post')
    || CASE WHEN v_post.scheduled_at IS NOT NULL
         THEN ' · ' || to_char(v_post.scheduled_at AT TIME ZONE 'Europe/Warsaw', 'DD.MM.YYYY HH24:MI') ELSE '' END;

  PERFORM set_config('mavinci.social_transition', 'on', true);

  IF p_action = 'submit' THEN
    IF NOT public.social_media_can(v_post.company_id, 'create') THEN
      RAISE EXCEPTION 'Wysłać post do akceptacji może twórca treści.' USING ERRCODE = '42501';
    END IF;
    IF v_post.status NOT IN ('draft', 'changes_requested') THEN
      RAISE EXCEPTION 'Do akceptacji można wysłać szkic albo post do poprawy.' USING ERRCODE = '22023';
    END IF;
    v_problems := public.social_post_problems(p_post_id, false);
    IF cardinality(v_problems) > 0 THEN
      RAISE EXCEPTION '%', array_to_string(v_problems, ' ') USING ERRCODE = '22023';
    END IF;
    UPDATE public.social_posts SET status = 'in_review', submitted_at = now(), submitted_by = v_actor,
      reviewed_at = NULL, reviewed_by = NULL, review_note = NULL, approved_revision = NULL
    WHERE id = p_post_id;
    INSERT INTO public.social_post_events (post_id, kind, actor_id, revision, note)
    VALUES (p_post_id, 'submitted', v_actor, v_post.revision, v_note);
    v_recipients := ARRAY(SELECT r FROM unnest(public.social_approver_user_ids(v_post.company_id, v_actor)) AS r
                          WHERE r IS DISTINCT FROM v_actor_user);
    IF cardinality(v_recipients) > 0 THEN
      PERFORM public.enqueue_crm_business_notification(
        'social-post:' || p_post_id::text || ':submitted:' || v_post.revision::text || ':' || floor(extract(epoch FROM clock_timestamp()))::bigint::text,
        'social_post_review', 'Post do akceptacji',
        concat_ws(' · ', v_label, 'autor: ' || nullif(v_actor_name, '')),
        'info', 'system', '/crm/marketing/social?post=' || p_post_id::text, NULL, NULL,
        jsonb_build_object('social_post_id', p_post_id, 'company_id', v_post.company_id), v_recipients);
    END IF;

  ELSIF p_action IN ('approve', 'request_changes') THEN
    IF NOT public.social_media_can(v_post.company_id, 'approve') THEN
      RAISE EXCEPTION 'Akceptuje osoba z uprawnieniem „Akceptacja postów”.' USING ERRCODE = '42501';
    END IF;
    IF p_action = 'approve' AND v_post.status <> 'in_review'
      OR p_action = 'request_changes' AND v_post.status NOT IN ('in_review', 'approved', 'scheduled', 'failed') THEN
      RAISE EXCEPTION 'Post nie czeka na akceptację.' USING ERRCODE = '22023';
    END IF;
    IF p_action = 'request_changes' AND v_partial THEN
      RAISE EXCEPTION 'Część kanałów jest już opublikowana — zamiast poprawek zrób kopię posta.' USING ERRCODE = '22023';
    END IF;
    IF p_action = 'request_changes' AND v_note IS NULL THEN
      RAISE EXCEPTION 'Napisz, co poprawić.' USING ERRCODE = '22023';
    END IF;
    IF p_action = 'approve' THEN
      IF v_post.author_id = v_actor AND NOT v_admin THEN
        RAISE EXCEPTION 'Autor nie zatwierdza własnego posta — poproś inną osobę z uprawnieniem akceptacji.' USING ERRCODE = '42501';
      END IF;
      IF v_post.author_id = v_actor AND v_note IS NULL THEN
        v_note := 'Zatwierdzone przez administratora będącego autorem posta.';
      END IF;
      v_problems := public.social_post_problems(p_post_id, true);
      IF cardinality(v_problems) > 0 THEN
        RAISE EXCEPTION '%', array_to_string(v_problems, ' ') USING ERRCODE = '22023';
      END IF;
      UPDATE public.social_posts SET status = 'approved', reviewed_at = now(), reviewed_by = v_actor, review_note = v_note,
        approved_revision = v_post.revision
      WHERE id = p_post_id;
    ELSE
      UPDATE public.social_posts SET status = 'changes_requested', reviewed_at = now(), reviewed_by = v_actor,
        review_note = v_note, approved_revision = NULL, scheduled_by = NULL, publish_error = NULL
      WHERE id = p_post_id;
    END IF;
    INSERT INTO public.social_post_events (post_id, kind, actor_id, revision, note)
    VALUES (p_post_id, CASE p_action WHEN 'approve' THEN 'approved' ELSE 'changes_requested' END, v_actor, v_post.revision, v_note);
    IF v_author_user IS NOT NULL AND v_author_user IS DISTINCT FROM v_actor_user AND v_post.author_id IS DISTINCT FROM v_actor THEN
      PERFORM public.enqueue_crm_business_notification(
        'social-post:' || p_post_id::text || ':' || p_action || ':' || v_post.revision::text || ':' || floor(extract(epoch FROM clock_timestamp()))::bigint::text,
        'social_post_reviewed',
        CASE p_action WHEN 'approve' THEN 'Post zatwierdzony' ELSE 'Post do poprawy' END,
        concat_ws(' · ', v_label, CASE WHEN p_action = 'request_changes' THEN v_note END, 'akceptujący: ' || nullif(v_actor_name, '')),
        CASE p_action WHEN 'approve' THEN 'success' ELSE 'warning' END, 'system',
        '/crm/marketing/social?post=' || p_post_id::text, NULL, NULL,
        jsonb_build_object('social_post_id', p_post_id, 'company_id', v_post.company_id), ARRAY[v_author_user]);
    END IF;

  ELSIF p_action = 'reopen' THEN
    IF NOT public.social_media_can(v_post.company_id, 'create') THEN
      RAISE EXCEPTION 'Przywrócić szkic może twórca treści.' USING ERRCODE = '42501';
    END IF;
    IF v_post.status NOT IN ('changes_requested', 'approved', 'cancelled', 'in_review', 'scheduled', 'failed') THEN
      RAISE EXCEPTION 'Tego posta nie można przywrócić do szkicu.' USING ERRCODE = '22023';
    END IF;
    IF v_partial THEN
      RAISE EXCEPTION 'Część kanałów jest już opublikowana — zamiast przywracać szkic, zrób kopię posta.' USING ERRCODE = '22023';
    END IF;
    UPDATE public.social_posts SET status = 'draft', approved_revision = NULL, cancelled_at = NULL, scheduled_by = NULL,
      publish_error = NULL
    WHERE id = p_post_id;
    INSERT INTO public.social_post_events (post_id, kind, actor_id, revision, note)
    VALUES (p_post_id, 'reopened', v_actor, v_post.revision, v_note);

  ELSIF p_action = 'cancel' THEN
    IF NOT public.social_media_can(v_post.company_id, 'create') THEN
      RAISE EXCEPTION 'Anulować post może twórca treści.' USING ERRCODE = '42501';
    END IF;
    IF v_post.status IN ('published', 'cancelled') THEN
      RAISE EXCEPTION 'Opublikowanego ani anulowanego posta nie można anulować.' USING ERRCODE = '22023';
    END IF;
    IF v_partial THEN
      RAISE EXCEPTION 'Część kanałów jest już opublikowana — oznacz post jako opublikowany albo ponów publikację pozostałych kanałów.'
        USING ERRCODE = '22023';
    END IF;
    UPDATE public.social_posts SET status = 'cancelled', cancelled_at = now(), approved_revision = NULL, scheduled_by = NULL,
      publish_error = NULL
    WHERE id = p_post_id;
    INSERT INTO public.social_post_events (post_id, kind, actor_id, revision, note)
    VALUES (p_post_id, 'cancelled', v_actor, v_post.revision, v_note);

  ELSIF p_action = 'schedule' THEN
    IF NOT public.social_media_can(v_post.company_id, 'publish') THEN
      RAISE EXCEPTION 'Zaplanować publikację może osoba z uprawnieniem „Publikacja”.' USING ERRCODE = '42501';
    END IF;
    IF v_post.status NOT IN ('approved', 'failed') OR v_post.approved_revision IS DISTINCT FROM v_post.revision THEN
      RAISE EXCEPTION 'Zaplanować można tylko zatwierdzoną wersję posta.' USING ERRCODE = '22023';
    END IF;
    IF v_post.scheduled_at IS NULL THEN
      RAISE EXCEPTION 'Ustaw termin publikacji.' USING ERRCODE = '22023';
    END IF;
    IF v_post.scheduled_at < now() - interval '2 minutes' THEN
      RAISE EXCEPTION 'Termin publikacji minął — ustaw nowy termin albo wybierz „Opublikuj teraz”.' USING ERRCODE = '22023';
    END IF;
    v_problems := public.social_post_problems(p_post_id, true);
    IF cardinality(v_problems) > 0 THEN
      RAISE EXCEPTION '%', array_to_string(v_problems, ' ') USING ERRCODE = '22023';
    END IF;
    UPDATE public.social_posts SET status = 'scheduled', scheduled_by = v_actor, publish_error = NULL, publish_attempts = 0,
      publish_started_at = NULL
    WHERE id = p_post_id;
    INSERT INTO public.social_post_events (post_id, kind, actor_id, revision, note)
    VALUES (p_post_id, 'scheduled', v_actor, v_post.revision,
      coalesce(v_note, 'Publikacja w Meta: ' || to_char(v_post.scheduled_at AT TIME ZONE 'Europe/Warsaw', 'DD.MM.YYYY HH24:MI')));

  ELSIF p_action = 'unschedule' THEN
    IF NOT public.social_media_can(v_post.company_id, 'publish') THEN
      RAISE EXCEPTION 'Wstrzymać publikację może osoba z uprawnieniem „Publikacja”.' USING ERRCODE = '42501';
    END IF;
    IF v_post.status NOT IN ('scheduled', 'failed') THEN
      RAISE EXCEPTION 'Ten post nie jest zaplanowany.' USING ERRCODE = '22023';
    END IF;
    UPDATE public.social_posts SET status = 'approved', scheduled_by = NULL, publish_error = NULL, publish_started_at = NULL
    WHERE id = p_post_id;
    INSERT INTO public.social_post_events (post_id, kind, actor_id, revision, note)
    VALUES (p_post_id, 'unscheduled', v_actor, v_post.revision, v_note);

  ELSIF p_action = 'publish' THEN
    IF NOT public.social_media_can(v_post.company_id, 'publish') THEN
      RAISE EXCEPTION 'Oznaczyć post jako opublikowany może osoba z uprawnieniem „Publikacja”.' USING ERRCODE = '42501';
    END IF;
    IF v_post.status NOT IN ('approved', 'scheduled', 'failed') OR v_post.approved_revision IS DISTINCT FROM v_post.revision THEN
      RAISE EXCEPTION 'Opublikować można tylko zatwierdzoną wersję posta.' USING ERRCODE = '22023';
    END IF;
    IF v_url IS NOT NULL AND (v_url !~ '^https://\S{4,}$' OR char_length(v_url) > 2000) THEN
      RAISE EXCEPTION 'Link do posta musi zaczynać się od https://' USING ERRCODE = '22023';
    END IF;
    v_problems := public.social_post_problems(p_post_id, true);
    IF cardinality(v_problems) > 0 THEN
      RAISE EXCEPTION '%', array_to_string(v_problems, ' ') USING ERRCODE = '22023';
    END IF;
    IF v_url IS NULL THEN
      SELECT pb.permalink INTO v_url FROM public.social_publications pb
      WHERE pb.post_id = p_post_id AND pb.status = 'published' AND pb.permalink IS NOT NULL
      ORDER BY CASE pb.channel WHEN 'instagram_feed' THEN 1 WHEN 'facebook_feed' THEN 2 ELSE 3 END
      LIMIT 1;
    END IF;
    UPDATE public.social_posts SET status = 'published', published_at = now(), published_by = v_actor, published_url = v_url,
      publish_error = NULL
    WHERE id = p_post_id;
    INSERT INTO public.social_post_events (post_id, kind, actor_id, revision, note)
    VALUES (p_post_id, 'published', v_actor, v_post.revision, v_note);

  ELSE
    RAISE EXCEPTION 'Nieznana akcja.' USING ERRCODE = '22023';
  END IF;

  PERFORM set_config('mavinci.social_transition', 'off', true);
  SELECT * INTO v_post FROM public.social_posts WHERE id = p_post_id;
  RETURN jsonb_build_object('id', v_post.id, 'status', v_post.status, 'revision', v_post.revision,
    'approvedRevision', v_post.approved_revision, 'updatedAt', v_post.updated_at);
END;
$$;

REVOKE ALL ON FUNCTION public.social_post_transition(uuid, text, integer, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.social_post_transition(uuid, text, integer, text, text) TO authenticated, service_role;

-- 6. Funkcje serwera publikacji (tylko service_role) ----------------------------------------------------------------

-- Zajęcie postów do publikacji: zaplanowane w terminie (do 30 s wcześniej) i przerwane publikacje starsze niż 10 minut.
-- `p_post_id` — „Opublikuj teraz” jednego posta. Zwraca zajęte posty (status „publikowanie”).
CREATE OR REPLACE FUNCTION public.social_publish_claim(p_post_id uuid DEFAULT NULL, p_limit integer DEFAULT 5)
RETURNS SETOF uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_id uuid;
BEGIN
  PERFORM set_config('mavinci.social_transition', 'on', true);
  FOR v_id IN
    WITH due AS (
      SELECT p.id FROM public.social_posts p
      WHERE (p_post_id IS NULL OR p.id = p_post_id)
        AND p.approved_revision = p.revision
        AND ((p.status = 'scheduled' AND p.scheduled_at <= now() + interval '30 seconds')
          OR (p.status = 'publishing' AND p.publish_started_at < now() - interval '10 minutes'))
      ORDER BY p.scheduled_at NULLS FIRST
      LIMIT greatest(1, least(coalesce(p_limit, 5), 20))
      FOR UPDATE SKIP LOCKED
    )
    UPDATE public.social_posts p SET status = 'publishing', publish_started_at = now(), publish_attempts = p.publish_attempts + 1
    FROM due WHERE p.id = due.id
    RETURNING p.id
  LOOP
    RETURN NEXT v_id;
  END LOOP;
  PERFORM set_config('mavinci.social_transition', 'off', true);
  RETURN;
END;
$$;

REVOKE ALL ON FUNCTION public.social_publish_claim(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.social_publish_claim(uuid, integer) TO service_role;

-- Wynik publikacji: wszystkie kanały opublikowane → „opublikowany” (link: post Instagram, potem Facebook, potem relacja);
-- inaczej „błąd publikacji” z opisem i powiadomieniem autora oraz osoby planującej (bez `p_actor` — osoby, która
-- właśnie kliknęła „Opublikuj teraz” i widzi wynik).
CREATE OR REPLACE FUNCTION public.social_publish_finish(p_post_id uuid, p_ok boolean, p_error text DEFAULT NULL, p_actor uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
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
    ORDER BY CASE pb.channel WHEN 'instagram_feed' THEN 1 WHEN 'facebook_feed' THEN 2 ELSE 3 END
    LIMIT 1;
    SELECT string_agg(CASE pb.channel WHEN 'instagram_feed' THEN 'Instagram — post' WHEN 'instagram_story' THEN 'Instagram — relacja'
      ELSE 'Facebook — post' END, ', ' ORDER BY pb.channel) INTO v_channels
    FROM public.social_publications pb WHERE pb.post_id = p_post_id AND pb.status = 'published';
    UPDATE public.social_posts SET status = 'published', published_at = now(), published_by = coalesce(p_actor, v_post.scheduled_by),
      published_url = v_url, publish_error = NULL, publish_started_at = NULL
    WHERE id = p_post_id;
    INSERT INTO public.social_post_events (post_id, kind, actor_id, revision, note)
    VALUES (p_post_id, 'published', coalesce(p_actor, v_post.scheduled_by), v_post.revision,
      'Opublikowano w Meta' || coalesce(': ' || v_channels, '') || '.');
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
$$;

REVOKE ALL ON FUNCTION public.social_publish_finish(uuid, boolean, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.social_publish_finish(uuid, boolean, text, uuid) TO service_role;

-- Nowe komentarze bez odpowiedzi: jedno powiadomienie dla autora posta (gdy nieaktywny — dla osoby planującej).
CREATE OR REPLACE FUNCTION public.social_comments_notify(p_post_id uuid, p_count integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_post public.social_posts%ROWTYPE;
  v_recipient uuid;
  v_label text;
BEGIN
  IF coalesce(p_count, 0) <= 0 THEN
    RETURN;
  END IF;
  SELECT * INTO v_post FROM public.social_posts WHERE id = p_post_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  SELECT coalesce(e.auth_user_id, e.id) INTO v_recipient FROM public.employees e
  WHERE e.id IN (v_post.author_id, v_post.scheduled_by) AND e.is_active
  ORDER BY (e.id = v_post.author_id) DESC
  LIMIT 1;
  IF v_recipient IS NULL THEN
    RETURN;
  END IF;
  v_label := coalesce(nullif(btrim(v_post.title), ''), nullif(left(btrim(v_post.caption), 60), ''), 'Post');
  PERFORM public.enqueue_crm_business_notification(
    'social-comments:' || p_post_id::text || ':' || floor(extract(epoch FROM clock_timestamp()))::bigint::text,
    'social_post_comments', 'Nowe komentarze',
    v_label || ' · ' || p_count::text || ' ' || CASE
      WHEN p_count = 1 THEN 'nowy komentarz'
      WHEN p_count % 10 BETWEEN 2 AND 4 AND p_count % 100 NOT BETWEEN 12 AND 14 THEN 'nowe komentarze'
      ELSE 'nowych komentarzy' END,
    'info', 'system', '/crm/marketing/social?post=' || p_post_id::text || '&tab=comments', NULL, NULL,
    jsonb_build_object('social_post_id', p_post_id, 'company_id', v_post.company_id), ARRAY[v_recipient]);
END;
$$;

REVOKE ALL ON FUNCTION public.social_comments_notify(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.social_comments_notify(uuid, integer) TO service_role;

-- 7. RLS i uprawnienia ------------------------------------------------------------------------------------------------

ALTER TABLE public.social_publications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_comments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS social_publications_select ON public.social_publications;
CREATE POLICY social_publications_select ON public.social_publications FOR SELECT TO authenticated
  USING (public.social_media_can(company_id, 'view'));
DROP POLICY IF EXISTS social_comments_select ON public.social_comments;
CREATE POLICY social_comments_select ON public.social_comments FOR SELECT TO authenticated
  USING (public.social_media_can(company_id, 'view'));

REVOKE ALL ON public.social_publications, public.social_comments FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.social_publications, public.social_comments TO authenticated;
GRANT ALL ON public.social_publications, public.social_comments TO service_role;

-- 8. Harmonogram: pg_cron → Next (tylko gdy jest praca) -----------------------------------------------------------------

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
  IF p_task NOT IN ('publish', 'comments') THEN
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

DO $$
DECLARE
  v_job_id bigint;
BEGIN
  IF to_regclass('cron.job') IS NULL THEN
    RAISE NOTICE 'pg_cron niedostępny — harmonogram social media pominięty.';
    RETURN;
  END IF;
  FOR v_job_id IN SELECT jobid FROM cron.job WHERE jobname IN ('social-media-publish', 'social-media-comments') LOOP
    PERFORM cron.unschedule(v_job_id);
  END LOOP;
  PERFORM cron.schedule('social-media-publish', '* * * * *', 'SELECT public.invoke_social_worker(''publish'');');
  PERFORM cron.schedule('social-media-comments', '7,22,37,52 * * * *', 'SELECT public.invoke_social_worker(''comments'');');
END $$;
