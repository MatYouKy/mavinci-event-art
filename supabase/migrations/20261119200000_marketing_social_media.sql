-- Marketing → „Social media” (Etap 1): biblioteka zdjęć, kreator grafik z szablonu marki, kalendarz publikacji z akceptacją.
-- Web CRM, aplikacja na Maca i telefon korzystają z tych samych tabel i funkcji (dane przez `/bridge/native/v1/social`,
-- token pracownika, RLS). Grafiki (JPEG — format wymagany przez Instagram) renderuje wyłącznie serwer Next (ten sam HTML
-- i Chromium) — plik jest jeden dla web, Maca i telefonu. Publikacja w Etapie 1 jest ręczna („Pobierz paczkę” + „Oznacz jako opublikowany”).
--
-- Uprawnienia (Ustawienia → Poziomy dostępu → sekcja „Social media”, profil pracownika → Uprawnienia):
--   marketing_social_view     — podgląd kalendarza, biblioteki i postów,
--   marketing_social_create   — kreator, szkice, „Wyślij do akceptacji”, biblioteka, status zgody klienta,
--   marketing_social_approve  — akceptacja / „Do poprawy” (nie własnych postów), szablony marki, ustawienia AI, zgody,
--   marketing_social_publish  — „Oznacz jako opublikowany” (Etap 2: publikacja i planowanie w Meta).
-- Administrator ma wszystko; sprzedawca z portalu — nic. Zakres marek jak w marketingu (`employees.my_company_ids`, pusty =
-- wszystkie marki). Członek zespołu wydarzenia (dostęp operacyjny do wydarzenia) może dodać zdjęcie z wydarzenia jako propozycję.
-- Status posta zmieniają wyłącznie funkcje `social_post_transition` (wyzwalacz blokuje zmianę bezpośrednią); zmiana treści
-- zatwierdzonego posta cofa go do szkicu. Powiadomienia tylko niezbędne i nigdy o własnej akcji: post do akceptacji →
-- akceptujący, zatwierdzony / do poprawy → autor.
-- Szablon grafiki wskazuje logo, fonty i kolory z księgi znaku marki po identyfikatorze — kolory nie są wpisane w kod.
-- Plik idempotentny — można go wykonać ponownie.

-- 1. Dostęp ------------------------------------------------------------------------------------------------------------

-- Czy bieżący pracownik ma zakres `p_scope` (view | create | consent | approve | publish) w marce `p_company`
-- (`NULL` — dowolna marka, np. zgody klienta, które nie należą do marki).
CREATE OR REPLACE FUNCTION public.social_media_can(p_company uuid, p_scope text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT coalesce((
    SELECT NOT public.current_session_is_seller_portal() AND (
      e.role::text = 'admin' OR e.access_level::text = 'admin' OR 'admin' = ANY(coalesce(e.permissions, '{}'::text[]))
      OR (
        (p_company IS NULL OR cardinality(coalesce(e.my_company_ids, '{}'::uuid[])) = 0
          OR p_company = ANY(coalesce(e.my_company_ids, '{}'::uuid[])))
        AND coalesce(e.permissions, '{}'::text[]) && CASE p_scope
          WHEN 'view' THEN ARRAY['marketing_social_view', 'marketing_social_create', 'marketing_social_approve', 'marketing_social_publish']
          WHEN 'create' THEN ARRAY['marketing_social_create', 'marketing_social_approve', 'marketing_social_publish']
          WHEN 'consent' THEN ARRAY['marketing_social_create', 'marketing_social_approve']
          WHEN 'approve' THEN ARRAY['marketing_social_approve']
          WHEN 'publish' THEN ARRAY['marketing_social_publish']
          ELSE ARRAY[]::text[]
        END
      )
    )
    FROM public.employees e
    WHERE e.id = public.current_crm_employee_id()
  ), false);
$$;

REVOKE ALL ON FUNCTION public.social_media_can(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.social_media_can(uuid, text) TO authenticated, service_role;

-- Zakresy bieżącego pracownika w marce — przyciski w web, na Macu i w telefonie (te same reguły co RLS).
CREATE OR REPLACE FUNCTION public.social_media_access(p_company uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT jsonb_build_object(
    'view', public.social_media_can(p_company, 'view'),
    'create', public.social_media_can(p_company, 'create'),
    'consent', public.social_media_can(p_company, 'consent'),
    'approve', public.social_media_can(p_company, 'approve'),
    'publish', public.social_media_can(p_company, 'publish'),
    'admin', public.current_employee_is_crm_admin(),
    'employeeId', public.current_crm_employee_id()
  );
$$;

REVOKE ALL ON FUNCTION public.social_media_access(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.social_media_access(uuid) TO authenticated, service_role;

-- Uprawnienia sekcji „Social media” w „Dostępie według sekcji” (moduł `marketing_social`). Treść funkcji bez zmian poza
-- listą znanych zakresów: + marketing_social_*, + offers_brochures_view_own / _all (zakresy broszur z katalogu uprawnień,
-- dotąd odrzucane przy zapisie sekcji „Oferty i produkty”).
CREATE OR REPLACE FUNCTION public.admin_set_employee_section_permissions(p_employee_id uuid, p_module text, p_permissions text[], p_expected_permissions text[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE v_employee public.employees%ROWTYPE; v_current text[]; v_expected text[]; v_next text[];
 v_known constant text[] := ARRAY['events_view','events_view_planning','events_view_operational','events_manage','events_create','event_categories_manage','calendar_view','calendar_manage','calendar_view_accepted_only','tasks_view','tasks_manage','tasks_create','offers_view','offers_manage','offers_create','offers_brochures_view_own','offers_brochures_view_all','contracts_view','contracts_manage','contracts_create','contracts_own_only','offers_own_only','events_own_only','attractions_view','attractions_manage','attractions_create','clients_view','clients_manage','clients_create','contacts_view','contacts_manage','contacts_create','inquiries_view','inquiries_manage','inquiries_view_pool','inquiries_view_own','inquiries_manage_own','inquiries_view_team','inquiries_manage_team','inquiries_view_all','inquiries_manage_all','inquiries_assign','messages_view','messages_manage','messages_assign','marketing_campaigns_view','marketing_campaigns_manage','marketing_campaigns_approve','marketing_social_view','marketing_social_create','marketing_social_approve','marketing_social_publish','chat_view','chat_manage','chat_create_group','webhooks_view','webhooks_manage','equipment_view','equipment_manage','equipment_create','fleet_view','fleet_manage','fleet_create','locations_view','locations_manage','locations_create','subcontractors_manage','time_tracking_view_own','time_tracking_view','time_tracking_manage','mavinci_live_view','mavinci_live_manage','mavinci_live_light_magic','mavinci_live_quiz_show','mavinci_live_familiada','mavinci_live_wedding_show','mavinci_live_streaming','finances_view','finances_manage','invoices_view','invoices_manage','databases_view','databases_manage','tenders_view','personnel_view','personnel_manage','employees_view','employees_manage','employees_create','employees_permissions','page_view','page_manage','website_edit'];
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.employees e WHERE (e.id=auth.uid() OR e.auth_user_id=auth.uid()) AND e.is_active AND (e.role='admin' OR e.access_level='admin')) THEN
  RAISE EXCEPTION 'Tylko administrator może zmieniać dostęp w ustawieniach aplikacji.' USING ERRCODE='42501';
 END IF;
 IF p_module IS NULL OR p_module !~ '^[a-z_]+$' OR NOT EXISTS(SELECT 1 FROM unnest(v_known) s WHERE starts_with(s,p_module||'_')) THEN
  RAISE EXCEPTION 'Nieznana sekcja.' USING ERRCODE='22023';
 END IF;
 IF p_permissions IS NULL OR p_expected_permissions IS NULL OR EXISTS(SELECT 1 FROM unnest(p_permissions) s WHERE s IS NULL OR NOT (s=ANY(v_known)) OR NOT starts_with(s,p_module||'_')) THEN
  RAISE EXCEPTION 'Nieprawidłowy zakres dla sekcji.' USING ERRCODE='22023';
 END IF;
 SELECT * INTO v_employee FROM public.employees WHERE id=p_employee_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Nie znaleziono pracownika.'; END IF;
 IF v_employee.role='admin' OR v_employee.access_level='admin' THEN RAISE EXCEPTION 'Administrator zachowuje pełny dostęp.' USING ERRCODE='42501'; END IF;
 SELECT coalesce(array_agg(DISTINCT s ORDER BY s),'{}') INTO v_current FROM unnest(coalesce(v_employee.permissions,'{}')) s WHERE starts_with(s,p_module||'_');
 SELECT coalesce(array_agg(DISTINCT s ORDER BY s),'{}') INTO v_expected FROM unnest(p_expected_permissions) s;
 IF v_current IS DISTINCT FROM v_expected THEN RAISE EXCEPTION 'Uprawnienia tej sekcji zmieniono w innym oknie. Otwórz edycję ponownie.' USING ERRCODE='40001'; END IF;
 SELECT coalesce(array_agg(DISTINCT s ORDER BY s),'{}') INTO v_next FROM (
 SELECT s FROM unnest(coalesce(v_employee.permissions,'{}')) s WHERE NOT starts_with(s,p_module||'_')
 UNION SELECT unnest(p_permissions)) scope;
 UPDATE public.employees SET permissions=v_next,role_permissions_inherited=false,updated_at=clock_timestamp() WHERE id=p_employee_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_set_employee_section_permissions(uuid,text,text[],text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_employee_section_permissions(uuid,text,text[],text[]) TO authenticated;

-- Kadr: prostokąt znormalizowany do zdjęcia (0…1), np. {"x":0.1,"y":0,"w":0.8,"h":1}.
CREATE OR REPLACE FUNCTION public.social_crop_is_valid(p_crop jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public
AS $$
  SELECT CASE WHEN jsonb_typeof(p_crop) IS DISTINCT FROM 'object'
      OR jsonb_typeof(p_crop -> 'x') IS DISTINCT FROM 'number' OR jsonb_typeof(p_crop -> 'y') IS DISTINCT FROM 'number'
      OR jsonb_typeof(p_crop -> 'w') IS DISTINCT FROM 'number' OR jsonb_typeof(p_crop -> 'h') IS DISTINCT FROM 'number' THEN false
    ELSE (p_crop ->> 'x')::numeric >= 0 AND (p_crop ->> 'y')::numeric >= 0
      AND (p_crop ->> 'w')::numeric > 0.01 AND (p_crop ->> 'h')::numeric > 0.01
      AND (p_crop ->> 'x')::numeric + (p_crop ->> 'w')::numeric <= 1.0001
      AND (p_crop ->> 'y')::numeric + (p_crop ->> 'h')::numeric <= 1.0001
  END;
$$;

-- Propozycje kadrów zdjęcia: {"4:5": kadr, "1:1": kadr, "9:16": kadr, "1.91:1": kadr} (pusty obiekt — jeszcze nie policzone).
CREATE OR REPLACE FUNCTION public.social_crops_are_valid(p_crops jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public
AS $$
  SELECT CASE WHEN jsonb_typeof(p_crops) IS DISTINCT FROM 'object' THEN false ELSE NOT EXISTS (
    SELECT 1 FROM jsonb_each(p_crops) AS item(key, value)
    WHERE item.key NOT IN ('4:5', '1:1', '9:16', '1.91:1') OR NOT public.social_crop_is_valid(item.value)
  ) END;
$$;

-- Hashtagi: „#” na początku, bez spacji, bez powtórzeń (wielkość liter bez znaczenia), w kolejności wpisania.
CREATE OR REPLACE FUNCTION public.social_normalize_hashtags(p_tags text[])
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public
AS $$
  SELECT coalesce(array_agg(tag ORDER BY position), '{}'::text[]) FROM (
    SELECT DISTINCT ON (lower(tag)) tag, position FROM (
      SELECT '#' || regexp_replace(coalesce(raw, ''), '[][[:space:]#.,;:!?"''()<>{}/\\|]+', '', 'g') AS tag, position
      FROM unnest(coalesce(p_tags, '{}'::text[])) WITH ORDINALITY AS item(raw, position)
    ) AS cleaned
    WHERE tag <> '#'
    ORDER BY lower(tag), position
  ) AS unique_tags;
$$;

-- 2. Tabele -------------------------------------------------------------------------------------------------------------

-- Ustawienia marki: opisy AI (zgoda na przekazanie treści realizacji bez danych osobowych), stałe hashtagi, styl opisów.
CREATE TABLE IF NOT EXISTS public.social_settings (
  company_id uuid PRIMARY KEY REFERENCES public.my_companies(id) ON DELETE CASCADE,
  ai_captions_enabled boolean NOT NULL DEFAULT false,
  ai_consent_at timestamptz,
  ai_consent_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  default_hashtags text[] NOT NULL DEFAULT '{}'::text[],
  caption_style text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  CONSTRAINT social_settings_hashtags_check CHECK (cardinality(default_hashtags) <= 30),
  CONSTRAINT social_settings_style_check CHECK (char_length(caption_style) <= 600)
);

-- Szablon grafiki marki: wyłącznie odwołania do księgi znaku + parametry układu (`settings`, liczby w px dla 1080 px).
CREATE TABLE IF NOT EXISTS public.social_brand_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.my_companies(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT 'Szablon marki',
  is_default boolean NOT NULL DEFAULT false,
  logo_id uuid REFERENCES public.company_brandbook_logos(id) ON DELETE SET NULL,
  title_font_id uuid REFERENCES public.company_brandbook_fonts(id) ON DELETE SET NULL,
  caption_font_id uuid REFERENCES public.company_brandbook_fonts(id) ON DELETE SET NULL,
  overlay_color_id uuid REFERENCES public.company_brandbook_colors(id) ON DELETE SET NULL,
  accent_color_id uuid REFERENCES public.company_brandbook_colors(id) ON DELETE SET NULL,
  text_color_id uuid REFERENCES public.company_brandbook_colors(id) ON DELETE SET NULL,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  CONSTRAINT social_brand_templates_name_check CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  CONSTRAINT social_brand_templates_settings_check CHECK (jsonb_typeof(settings) = 'object')
);
CREATE UNIQUE INDEX IF NOT EXISTS social_brand_templates_default_idx
  ON public.social_brand_templates (company_id) WHERE is_default;

-- Zgoda klienta na publikację — domyślnie dla organizacji klienta, z nadpisaniem dla wydarzenia (i zdjęcia w bibliotece).
CREATE TABLE IF NOT EXISTS public.social_publication_consents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  event_id uuid REFERENCES public.events(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'unknown',
  channels text[] NOT NULL DEFAULT '{}'::text[],
  note text NOT NULL DEFAULT '',
  decided_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT social_publication_consents_target_check CHECK ((organization_id IS NULL) <> (event_id IS NULL)),
  CONSTRAINT social_publication_consents_status_check CHECK (status IN ('unknown', 'requested', 'granted', 'denied', 'not_required')),
  CONSTRAINT social_publication_consents_channels_check CHECK (channels <@ ARRAY['facebook', 'instagram', 'website']::text[]),
  CONSTRAINT social_publication_consents_note_check CHECK (char_length(note) <= 1000)
);
CREATE UNIQUE INDEX IF NOT EXISTS social_publication_consents_organization_idx
  ON public.social_publication_consents (organization_id) WHERE organization_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS social_publication_consents_event_idx
  ON public.social_publication_consents (event_id) WHERE event_id IS NOT NULL;

-- Biblioteka: zdjęcia i grafiki marki. Pliki w prywatnym buckecie `social-media` pod `<marka>/assets/<id>/…`:
-- oryginał, wersja robocza (do 3200 px) i miniatura. Status: uploading (wgrywanie) → proposed (propozycja członka zespołu
-- wydarzenia) / ready (w bibliotece) → archived.
CREATE TABLE IF NOT EXISTS public.social_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.my_companies(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'photo',
  source text NOT NULL DEFAULT 'upload',
  status text NOT NULL DEFAULT 'uploading',
  storage_path text NOT NULL,
  work_path text,
  thumbnail_path text,
  source_ref text,
  original_name text NOT NULL DEFAULT '',
  mime_type text,
  bytes bigint,
  width integer,
  height integer,
  content_sha256 text,
  title text NOT NULL DEFAULT '',
  note text NOT NULL DEFAULT '',
  event_id uuid REFERENCES public.events(id) ON DELETE SET NULL,
  portfolio_project_id uuid REFERENCES public.portfolio_projects(id) ON DELETE SET NULL,
  organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  visible_brands text[] NOT NULL DEFAULT '{}'::text[],
  consent_status text NOT NULL DEFAULT 'inherit',
  consent_channels text[] NOT NULL DEFAULT '{}'::text[],
  consent_note text NOT NULL DEFAULT '',
  consent_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  consent_at timestamptz,
  crops jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT social_assets_kind_check CHECK (kind IN ('photo', 'graphic')),
  CONSTRAINT social_assets_source_check CHECK (source IN ('upload', 'event_file', 'portfolio', 'camera', 'mac')),
  CONSTRAINT social_assets_status_check CHECK (status IN ('uploading', 'proposed', 'ready', 'archived')),
  CONSTRAINT social_assets_consent_check CHECK (consent_status IN ('inherit', 'unknown', 'requested', 'granted', 'denied', 'not_required')),
  CONSTRAINT social_assets_consent_channels_check CHECK (consent_channels <@ ARRAY['facebook', 'instagram', 'website']::text[]),
  CONSTRAINT social_assets_paths_check CHECK (
    storage_path ~ ('^' || company_id::text || '/assets/' || id::text || '/[A-Za-z0-9._-]{1,80}$')
    AND (work_path IS NULL OR work_path ~ ('^' || company_id::text || '/assets/' || id::text || '/[A-Za-z0-9._-]{1,80}$'))
    AND (thumbnail_path IS NULL OR thumbnail_path ~ ('^' || company_id::text || '/assets/' || id::text || '/[A-Za-z0-9._-]{1,80}$'))),
  CONSTRAINT social_assets_ready_check CHECK (status IN ('uploading', 'archived')
    OR (work_path IS NOT NULL AND thumbnail_path IS NOT NULL AND width > 0 AND height > 0)),
  CONSTRAINT social_assets_crops_check CHECK (public.social_crops_are_valid(crops)),
  CONSTRAINT social_assets_text_check CHECK (char_length(title) <= 160 AND char_length(note) <= 1000
    AND char_length(consent_note) <= 1000 AND char_length(original_name) <= 255 AND cardinality(visible_brands) <= 20),
  CONSTRAINT social_assets_sha_check CHECK (content_sha256 IS NULL OR content_sha256 ~ '^[0-9a-f]{64}$')
);
CREATE INDEX IF NOT EXISTS social_assets_company_idx ON public.social_assets (company_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS social_assets_event_idx ON public.social_assets (event_id) WHERE event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS social_assets_portfolio_idx ON public.social_assets (portfolio_project_id) WHERE portfolio_project_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS social_assets_sha_idx ON public.social_assets (company_id, content_sha256) WHERE content_sha256 IS NOT NULL;
CREATE INDEX IF NOT EXISTS social_assets_created_by_idx ON public.social_assets (created_by);

-- Post: szkic → do akceptacji → do poprawy / zatwierdzony → opublikowany (Etap 2: zaplanowany = publikacja automatyczna).
CREATE TABLE IF NOT EXISTS public.social_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.my_companies(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'draft',
  channels text[] NOT NULL DEFAULT ARRAY['instagram_feed']::text[],
  scheduled_at timestamptz,
  caption text NOT NULL DEFAULT '',
  hashtags text[] NOT NULL DEFAULT '{}'::text[],
  template_id uuid REFERENCES public.social_brand_templates(id) ON DELETE SET NULL,
  event_id uuid REFERENCES public.events(id) ON DELETE SET NULL,
  portfolio_project_id uuid REFERENCES public.portfolio_projects(id) ON DELETE SET NULL,
  ai_suggestions jsonb NOT NULL DEFAULT '[]'::jsonb,
  author_id uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  revision integer NOT NULL DEFAULT 1,
  submitted_at timestamptz,
  submitted_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  review_note text,
  approved_revision integer,
  published_at timestamptz,
  published_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  published_url text,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  CONSTRAINT social_posts_status_check CHECK (status IN ('draft', 'in_review', 'changes_requested', 'approved', 'scheduled', 'published', 'cancelled')),
  CONSTRAINT social_posts_channels_check CHECK (channels <@ ARRAY['instagram_feed', 'instagram_story', 'facebook_feed']::text[]),
  CONSTRAINT social_posts_text_check CHECK (char_length(title) <= 160 AND char_length(caption) <= 2200
    AND cardinality(hashtags) <= 30 AND char_length(coalesce(review_note, '')) <= 1000),
  CONSTRAINT social_posts_ai_check CHECK (jsonb_typeof(ai_suggestions) = 'array'),
  CONSTRAINT social_posts_url_check CHECK (published_url IS NULL OR (published_url ~ '^https://\S{4,}$' AND char_length(published_url) <= 2000)),
  CONSTRAINT social_posts_revision_check CHECK (revision >= 1)
);
CREATE INDEX IF NOT EXISTS social_posts_calendar_idx ON public.social_posts (company_id, scheduled_at);
CREATE INDEX IF NOT EXISTS social_posts_status_idx ON public.social_posts (company_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS social_posts_event_idx ON public.social_posts (event_id) WHERE event_id IS NOT NULL;

-- Wersja grafiki posta w formacie: zdjęcie z biblioteki, kadr (pusty — propozycja zdjęcia), teksty, wyrenderowana grafika
-- (`<marka>/posts/<post>/<format>-<skrót>.jpg`, skrót danych renderu — ten sam plik dla web, Maca i telefonu).
CREATE TABLE IF NOT EXISTS public.social_post_variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES public.social_posts(id) ON DELETE CASCADE,
  format text NOT NULL,
  asset_id uuid REFERENCES public.social_assets(id) ON DELETE RESTRICT,
  crop jsonb,
  headline text NOT NULL DEFAULT '',
  subline text NOT NULL DEFAULT '',
  rendered_path text,
  render_hash text,
  rendered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT social_post_variants_format_check CHECK (format IN ('4:5', '1:1', '9:16', '1.91:1')),
  CONSTRAINT social_post_variants_crop_check CHECK (crop IS NULL OR public.social_crop_is_valid(crop)),
  CONSTRAINT social_post_variants_text_check CHECK (char_length(headline) <= 80 AND char_length(subline) <= 120),
  CONSTRAINT social_post_variants_hash_check CHECK (render_hash IS NULL OR render_hash ~ '^[0-9a-f]{16,64}$'),
  CONSTRAINT social_post_variants_unique UNIQUE (post_id, format)
);
CREATE INDEX IF NOT EXISTS social_post_variants_asset_idx ON public.social_post_variants (asset_id) WHERE asset_id IS NOT NULL;

-- Historia posta (zapisują wyłącznie funkcje i wyzwalacze).
CREATE TABLE IF NOT EXISTS public.social_post_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES public.social_posts(id) ON DELETE CASCADE,
  kind text NOT NULL,
  actor_id uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  revision integer,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT social_post_events_kind_check CHECK (kind IN ('created', 'submitted', 'approved', 'changes_requested', 'reopened',
    'edited_after_approval', 'cancelled', 'published'))
);
CREATE INDEX IF NOT EXISTS social_post_events_post_idx ON public.social_post_events (post_id, created_at DESC);

-- 3. Zgoda klienta -----------------------------------------------------------------------------------------------------

-- Zgoda obowiązująca dla zdjęcia: własna zdjęcia → wydarzenia → organizacji klienta (zdjęcia albo wydarzenia) → „nieznana”.
-- Pole wyliczane PostgREST (`social_assets.select('consent:social_asset_consent')`): {status, channels, source}.
CREATE OR REPLACE FUNCTION public.social_asset_consent(p_asset public.social_assets)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_row record;
  v_organization uuid;
BEGIN
  IF p_asset.consent_status <> 'inherit' THEN
    RETURN jsonb_build_object('status', p_asset.consent_status, 'channels', to_jsonb(p_asset.consent_channels), 'source', 'asset');
  END IF;
  IF p_asset.event_id IS NOT NULL THEN
    SELECT c.status, c.channels INTO v_row FROM public.social_publication_consents c
    WHERE c.event_id = p_asset.event_id AND c.status <> 'unknown';
    IF FOUND THEN
      RETURN jsonb_build_object('status', v_row.status, 'channels', to_jsonb(v_row.channels), 'source', 'event');
    END IF;
  END IF;
  v_organization := p_asset.organization_id;
  IF v_organization IS NULL AND p_asset.event_id IS NOT NULL THEN
    SELECT e.organization_id INTO v_organization FROM public.events e WHERE e.id = p_asset.event_id;
  END IF;
  IF v_organization IS NOT NULL THEN
    SELECT c.status, c.channels INTO v_row FROM public.social_publication_consents c
    WHERE c.organization_id = v_organization AND c.status <> 'unknown';
    IF FOUND THEN
      RETURN jsonb_build_object('status', v_row.status, 'channels', to_jsonb(v_row.channels), 'source', 'organization');
    END IF;
  END IF;
  RETURN jsonb_build_object('status', 'unknown', 'channels', '[]'::jsonb, 'source', 'none');
END;
$$;

REVOKE ALL ON FUNCTION public.social_asset_consent(public.social_assets) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.social_asset_consent(public.social_assets) TO authenticated, service_role;

-- Braki posta przed akceptacją i publikacją: brak grafiki dla kanału, zgoda klienta inna niż „jest” / „niepotrzebna”
-- albo nieobejmująca platformy. Pusta tablica — post gotowy. `p_require_consent = false` — tylko grafiki (wysłanie do akceptacji).
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
    WHERE a.id IN (SELECT v.asset_id FROM public.social_post_variants v WHERE v.post_id = p_post_id AND v.asset_id IS NOT NULL)
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

-- 4. Wyzwalacze ---------------------------------------------------------------------------------------------------------

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
  NEW.default_hashtags := public.social_normalize_hashtags(NEW.default_hashtags);
  NEW.updated_at := now();
  NEW.updated_by := coalesce(public.current_crm_employee_id(), NEW.updated_by);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS social_settings_guard ON public.social_settings;
CREATE TRIGGER social_settings_guard BEFORE INSERT OR UPDATE ON public.social_settings
  FOR EACH ROW EXECUTE FUNCTION public.social_settings_guard();

-- Szablon: logo, fonty i kolory tylko z księgi znaku tej samej marki; jeden szablon domyślny marki.
CREATE OR REPLACE FUNCTION public.social_brand_templates_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.company_id <> OLD.company_id THEN
    RAISE EXCEPTION 'Nie można przenieść szablonu do innej marki.' USING ERRCODE = '22023';
  END IF;
  IF NEW.logo_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.company_brandbook_logos l WHERE l.id = NEW.logo_id AND l.company_id = NEW.company_id)
    OR NEW.title_font_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.company_brandbook_fonts f WHERE f.id = NEW.title_font_id AND f.company_id = NEW.company_id)
    OR NEW.caption_font_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.company_brandbook_fonts f WHERE f.id = NEW.caption_font_id AND f.company_id = NEW.company_id)
    OR EXISTS (SELECT 1 FROM unnest(ARRAY[NEW.overlay_color_id, NEW.accent_color_id, NEW.text_color_id]) AS color_id
               WHERE color_id IS NOT NULL AND NOT EXISTS (
                 SELECT 1 FROM public.company_brandbook_colors c WHERE c.id = color_id AND c.company_id = NEW.company_id)) THEN
    RAISE EXCEPTION 'Szablon może używać tylko logo, fontów i kolorów z księgi znaku tej marki.' USING ERRCODE = '22023';
  END IF;
  IF NEW.is_default THEN
    UPDATE public.social_brand_templates SET is_default = false
    WHERE company_id = NEW.company_id AND id <> NEW.id AND is_default;
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.created_by := coalesce(public.current_crm_employee_id(), NEW.created_by);
    NEW.created_at := now();
  END IF;
  NEW.updated_at := now();
  NEW.updated_by := coalesce(public.current_crm_employee_id(), NEW.updated_by);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS social_brand_templates_guard ON public.social_brand_templates;
CREATE TRIGGER social_brand_templates_guard BEFORE INSERT OR UPDATE ON public.social_brand_templates
  FOR EACH ROW EXECUTE FUNCTION public.social_brand_templates_guard();

CREATE OR REPLACE FUNCTION public.social_publication_consents_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.organization_id IS DISTINCT FROM OLD.organization_id OR NEW.event_id IS DISTINCT FROM OLD.event_id) THEN
    RAISE EXCEPTION 'Nie można przenieść zgody na inny cel.' USING ERRCODE = '22023';
  END IF;
  NEW.channels := ARRAY(SELECT DISTINCT c FROM unnest(NEW.channels) AS c ORDER BY c);
  IF TG_OP = 'INSERT' OR NEW.status IS DISTINCT FROM OLD.status OR NEW.channels IS DISTINCT FROM OLD.channels OR NEW.note IS DISTINCT FROM OLD.note THEN
    NEW.decided_by := coalesce(public.current_crm_employee_id(), NEW.decided_by);
    NEW.decided_at := now();
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.created_at := now();
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS social_publication_consents_guard ON public.social_publication_consents;
CREATE TRIGGER social_publication_consents_guard BEFORE INSERT OR UPDATE ON public.social_publication_consents
  FOR EACH ROW EXECUTE FUNCTION public.social_publication_consents_guard();

-- Zdjęcie: wgrywający jest autorem; propozycja członka zespołu wydarzenia nie trafia do biblioteki bez twórcy;
-- zgodę zmienia twórca lub akceptujący (z podpisem kto i kiedy). Sesja bez użytkownika (migracje, klucz serwisowy) — bez reguł.
CREATE OR REPLACE FUNCTION public.social_assets_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor uuid := public.current_crm_employee_id();
  v_session boolean := auth.uid() IS NOT NULL;
  v_people constant text[] := ARRAY['created_by', 'updated_by', 'consent_by', 'updated_at'];
BEGIN
  NEW.visible_brands := ARRAY(SELECT DISTINCT btrim(b) FROM unnest(NEW.visible_brands) AS b WHERE btrim(coalesce(b, '')) <> '' ORDER BY 1);
  NEW.consent_channels := ARRAY(SELECT DISTINCT c FROM unnest(NEW.consent_channels) AS c ORDER BY c);
  IF TG_OP = 'INSERT' THEN
    NEW.created_at := now();
    IF v_session THEN
      NEW.created_by := v_actor;
      NEW.status := 'uploading';
      IF (NEW.consent_status <> 'inherit' OR cardinality(NEW.consent_channels) > 0 OR NEW.consent_note <> '')
        AND NOT public.social_media_can(NEW.company_id, 'consent') THEN
        RAISE EXCEPTION 'Status zgody klienta ustawia twórca treści lub akceptujący.' USING ERRCODE = '42501';
      END IF;
    END IF;
    IF NEW.consent_status <> 'inherit' OR cardinality(NEW.consent_channels) > 0 OR NEW.consent_note <> '' THEN
      NEW.consent_by := coalesce(v_actor, NEW.consent_by);
      NEW.consent_at := now();
    ELSE
      NEW.consent_by := NULL;
      NEW.consent_at := NULL;
    END IF;
  ELSE
    -- Usunięcie konta pracownika (klucze obce SET NULL) — zmieniają się tylko pola osób, na NULL.
    IF (to_jsonb(NEW) - v_people) = (to_jsonb(OLD) - v_people) AND NOT EXISTS (
      SELECT 1 FROM unnest(v_people) AS column_name
      WHERE to_jsonb(NEW) -> column_name IS DISTINCT FROM to_jsonb(OLD) -> column_name
        AND column_name <> 'updated_at' AND to_jsonb(NEW) -> column_name <> 'null'::jsonb) THEN
      NEW.updated_at := OLD.updated_at;
      RETURN NEW;
    END IF;
    IF NEW.company_id <> OLD.company_id OR NEW.storage_path <> OLD.storage_path
      OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'Nie można zmienić marki, pliku ani autora zdjęcia.' USING ERRCODE = '22023';
    END IF;
    IF v_session THEN
      IF NEW.status IS DISTINCT FROM OLD.status THEN
        IF NEW.status = 'uploading' THEN
          RAISE EXCEPTION 'Nieprawidłowa zmiana statusu zdjęcia.' USING ERRCODE = '22023';
        ELSIF OLD.status = 'uploading' THEN
          IF NEW.status <> 'proposed' AND NOT public.social_media_can(OLD.company_id, 'create') THEN
            NEW.status := 'proposed';
          END IF;
        ELSIF NOT public.social_media_can(OLD.company_id, 'create') THEN
          RAISE EXCEPTION 'Status zdjęcia w bibliotece zmienia twórca treści.' USING ERRCODE = '42501';
        END IF;
      END IF;
      IF NEW.consent_status IS DISTINCT FROM OLD.consent_status OR NEW.consent_channels IS DISTINCT FROM OLD.consent_channels
        OR NEW.consent_note IS DISTINCT FROM OLD.consent_note THEN
        IF NOT public.social_media_can(OLD.company_id, 'consent') THEN
          RAISE EXCEPTION 'Status zgody klienta ustawia twórca treści lub akceptujący.' USING ERRCODE = '42501';
        END IF;
        NEW.consent_by := v_actor;
        NEW.consent_at := now();
      ELSE
        NEW.consent_by := OLD.consent_by;
        NEW.consent_at := OLD.consent_at;
      END IF;
    END IF;
  END IF;
  NEW.updated_at := now();
  NEW.updated_by := coalesce(v_actor, NEW.updated_by);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS social_assets_guard ON public.social_assets;
CREATE TRIGGER social_assets_guard BEFORE INSERT OR UPDATE ON public.social_assets
  FOR EACH ROW EXECUTE FUNCTION public.social_assets_guard();

-- Post: status zmieniają tylko funkcje `social_post_transition` (zmienna transakcji `mavinci.social_transition`);
-- zmiana treści (kanały, opis, hashtagi, szablon, wydarzenie, realizacja, grafiki) podnosi wersję, a zatwierdzony post
-- wraca do szkicu. Opublikowanego i anulowanego posta nie można zmieniać.
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
  v_people constant text[] := ARRAY['author_id', 'submitted_by', 'reviewed_by', 'published_by', 'updated_by', 'updated_at'];
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
    OR NEW.cancelled_at IS DISTINCT FROM OLD.cancelled_at) THEN
    RAISE EXCEPTION 'Status posta zmieniają przyciski „Wyślij do akceptacji”, „Zatwierdź”, „Do poprawy” i „Oznacz jako opublikowany”.'
      USING ERRCODE = '42501';
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
    IF v_content THEN
      NEW.revision := OLD.revision + 1;
      IF OLD.status IN ('approved', 'scheduled') THEN
        NEW.status := 'draft';
        NEW.approved_revision := NULL;
        INSERT INTO public.social_post_events (post_id, kind, actor_id, revision, note)
        VALUES (OLD.id, 'edited_after_approval', v_actor, NEW.revision, 'Zmiana treści po zatwierdzeniu — post wrócił do szkicu.');
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

DROP TRIGGER IF EXISTS social_posts_guard ON public.social_posts;
CREATE TRIGGER social_posts_guard BEFORE INSERT OR UPDATE ON public.social_posts
  FOR EACH ROW EXECUTE FUNCTION public.social_posts_guard();

CREATE OR REPLACE FUNCTION public.social_posts_created()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  INSERT INTO public.social_post_events (post_id, kind, actor_id, revision)
  VALUES (NEW.id, 'created', NEW.author_id, NEW.revision);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS social_posts_created ON public.social_posts;
CREATE TRIGGER social_posts_created AFTER INSERT ON public.social_posts
  FOR EACH ROW EXECUTE FUNCTION public.social_posts_created();

-- Grafika posta: zdjęcie z biblioteki tej samej marki (nie wgrywane i nie z archiwum), JPEG pod katalogiem posta.
-- Zmiana zdjęcia, kadru, tekstów albo formatu to zmiana treści posta (wersja +1, zatwierdzony → szkic).
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

DROP TRIGGER IF EXISTS social_post_variants_guard ON public.social_post_variants;
CREATE TRIGGER social_post_variants_guard BEFORE INSERT OR UPDATE ON public.social_post_variants
  FOR EACH ROW EXECUTE FUNCTION public.social_post_variants_guard();

CREATE OR REPLACE FUNCTION public.social_post_variants_touch_post()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.format IS NOT DISTINCT FROM OLD.format AND NEW.asset_id IS NOT DISTINCT FROM OLD.asset_id
    AND NEW.crop IS NOT DISTINCT FROM OLD.crop AND NEW.headline IS NOT DISTINCT FROM OLD.headline
    AND NEW.subline IS NOT DISTINCT FROM OLD.subline THEN
    RETURN NULL;
  END IF;
  UPDATE public.social_posts SET revision = revision + 1
  WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD.post_id ELSE NEW.post_id END;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS social_post_variants_touch_post ON public.social_post_variants;
CREATE TRIGGER social_post_variants_touch_post AFTER INSERT OR UPDATE OR DELETE ON public.social_post_variants
  FOR EACH ROW EXECUTE FUNCTION public.social_post_variants_touch_post();

-- 5. Zmiany statusu posta ------------------------------------------------------------------------------------------------

-- Odbiorcy powiadomień (identyfikatory kont): akceptujący marki (bez administratorów, gdy są akceptujący), poza `p_except`.
CREATE OR REPLACE FUNCTION public.social_approver_user_ids(p_company uuid, p_except uuid)
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
  ), approvers AS (
    SELECT coalesce(a.auth_user_id, a.id) AS user_id FROM active a
    WHERE 'marketing_social_approve' = ANY(coalesce(a.permissions, '{}'::text[]))
      AND (cardinality(coalesce(a.my_company_ids, '{}'::uuid[])) = 0 OR p_company = ANY(coalesce(a.my_company_ids, '{}'::uuid[])))
  ), admins AS (
    SELECT coalesce(a.auth_user_id, a.id) AS user_id FROM active a
    WHERE a.role::text = 'admin' OR a.access_level::text = 'admin' OR 'admin' = ANY(coalesce(a.permissions, '{}'::text[]))
  )
  SELECT CASE WHEN EXISTS (SELECT 1 FROM approvers)
    THEN ARRAY(SELECT DISTINCT user_id FROM approvers)
    ELSE ARRAY(SELECT DISTINCT user_id FROM admins) END;
$$;

REVOKE ALL ON FUNCTION public.social_approver_user_ids(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.social_approver_user_ids(uuid, uuid) TO service_role;

-- Akcje: submit (twórca: szkic / do poprawy → do akceptacji), approve (akceptujący, nie własny post — wyjątek administrator
-- z notatką), request_changes (akceptujący, notatka wymagana), reopen (twórca: do poprawy / zatwierdzony / anulowany → szkic),
-- cancel (twórca), publish (publikujący: zatwierdzona wersja → opublikowany, link opcjonalny).
-- `p_expected_revision` — wersja widziana przez użytkownika (zmiana w innym oknie → błąd 40001).
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
      OR p_action = 'request_changes' AND v_post.status NOT IN ('in_review', 'approved') THEN
      RAISE EXCEPTION 'Post nie czeka na akceptację.' USING ERRCODE = '22023';
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
        review_note = v_note, approved_revision = NULL
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
    IF v_post.status NOT IN ('changes_requested', 'approved', 'cancelled', 'in_review') THEN
      RAISE EXCEPTION 'Tego posta nie można przywrócić do szkicu.' USING ERRCODE = '22023';
    END IF;
    UPDATE public.social_posts SET status = 'draft', approved_revision = NULL, cancelled_at = NULL WHERE id = p_post_id;
    INSERT INTO public.social_post_events (post_id, kind, actor_id, revision, note)
    VALUES (p_post_id, 'reopened', v_actor, v_post.revision, v_note);

  ELSIF p_action = 'cancel' THEN
    IF NOT public.social_media_can(v_post.company_id, 'create') THEN
      RAISE EXCEPTION 'Anulować post może twórca treści.' USING ERRCODE = '42501';
    END IF;
    IF v_post.status IN ('published', 'cancelled') THEN
      RAISE EXCEPTION 'Opublikowanego ani anulowanego posta nie można anulować.' USING ERRCODE = '22023';
    END IF;
    UPDATE public.social_posts SET status = 'cancelled', cancelled_at = now(), approved_revision = NULL WHERE id = p_post_id;
    INSERT INTO public.social_post_events (post_id, kind, actor_id, revision, note)
    VALUES (p_post_id, 'cancelled', v_actor, v_post.revision, v_note);

  ELSIF p_action = 'publish' THEN
    IF NOT public.social_media_can(v_post.company_id, 'publish') THEN
      RAISE EXCEPTION 'Oznaczyć post jako opublikowany może osoba z uprawnieniem „Publikacja”.' USING ERRCODE = '42501';
    END IF;
    IF v_post.status NOT IN ('approved', 'scheduled') OR v_post.approved_revision IS DISTINCT FROM v_post.revision THEN
      RAISE EXCEPTION 'Opublikować można tylko zatwierdzoną wersję posta.' USING ERRCODE = '22023';
    END IF;
    IF v_url IS NOT NULL AND (v_url !~ '^https://\S{4,}$' OR char_length(v_url) > 2000) THEN
      RAISE EXCEPTION 'Link do posta musi zaczynać się od https://' USING ERRCODE = '22023';
    END IF;
    v_problems := public.social_post_problems(p_post_id, true);
    IF cardinality(v_problems) > 0 THEN
      RAISE EXCEPTION '%', array_to_string(v_problems, ' ') USING ERRCODE = '22023';
    END IF;
    UPDATE public.social_posts SET status = 'published', published_at = now(), published_by = v_actor, published_url = v_url
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

-- 6. RLS ----------------------------------------------------------------------------------------------------------------

ALTER TABLE public.social_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_brand_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_publication_consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_post_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_post_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS social_settings_select ON public.social_settings;
CREATE POLICY social_settings_select ON public.social_settings FOR SELECT TO authenticated
  USING (public.social_media_can(company_id, 'view'));
DROP POLICY IF EXISTS social_settings_write ON public.social_settings;
CREATE POLICY social_settings_write ON public.social_settings FOR ALL TO authenticated
  USING (public.social_media_can(company_id, 'approve'))
  WITH CHECK (public.social_media_can(company_id, 'approve'));

DROP POLICY IF EXISTS social_brand_templates_select ON public.social_brand_templates;
CREATE POLICY social_brand_templates_select ON public.social_brand_templates FOR SELECT TO authenticated
  USING (public.social_media_can(company_id, 'view'));
DROP POLICY IF EXISTS social_brand_templates_write ON public.social_brand_templates;
CREATE POLICY social_brand_templates_write ON public.social_brand_templates FOR ALL TO authenticated
  USING (public.social_media_can(company_id, 'approve'))
  WITH CHECK (public.social_media_can(company_id, 'approve'));

DROP POLICY IF EXISTS social_publication_consents_select ON public.social_publication_consents;
CREATE POLICY social_publication_consents_select ON public.social_publication_consents FOR SELECT TO authenticated
  USING (public.social_media_can(NULL, 'view'));
DROP POLICY IF EXISTS social_publication_consents_write ON public.social_publication_consents;
CREATE POLICY social_publication_consents_write ON public.social_publication_consents FOR ALL TO authenticated
  USING (public.social_media_can(NULL, 'consent'))
  WITH CHECK (public.social_media_can(NULL, 'consent'));

DROP POLICY IF EXISTS social_assets_select ON public.social_assets;
CREATE POLICY social_assets_select ON public.social_assets FOR SELECT TO authenticated
  USING (public.social_media_can(company_id, 'view') OR created_by = public.current_crm_employee_id());
DROP POLICY IF EXISTS social_assets_insert ON public.social_assets;
CREATE POLICY social_assets_insert ON public.social_assets FOR INSERT TO authenticated
  WITH CHECK (NOT public.current_session_is_seller_portal() AND (
    public.social_media_can(company_id, 'create')
    OR (event_id IS NOT NULL AND public.current_employee_can_view_event(event_id))));
DROP POLICY IF EXISTS social_assets_update ON public.social_assets;
CREATE POLICY social_assets_update ON public.social_assets FOR UPDATE TO authenticated
  USING (public.social_media_can(company_id, 'create')
    OR (created_by = public.current_crm_employee_id() AND status = 'uploading'))
  WITH CHECK (public.social_media_can(company_id, 'create')
    OR (created_by = public.current_crm_employee_id() AND status IN ('uploading', 'proposed')
        AND (event_id IS NULL OR public.current_employee_can_view_event(event_id))));
DROP POLICY IF EXISTS social_assets_delete ON public.social_assets;
CREATE POLICY social_assets_delete ON public.social_assets FOR DELETE TO authenticated
  USING (public.social_media_can(company_id, 'create')
    OR (created_by = public.current_crm_employee_id() AND status = 'uploading'));

DROP POLICY IF EXISTS social_posts_select ON public.social_posts;
CREATE POLICY social_posts_select ON public.social_posts FOR SELECT TO authenticated
  USING (public.social_media_can(company_id, 'view'));
DROP POLICY IF EXISTS social_posts_insert ON public.social_posts;
CREATE POLICY social_posts_insert ON public.social_posts FOR INSERT TO authenticated
  WITH CHECK (public.social_media_can(company_id, 'create'));
DROP POLICY IF EXISTS social_posts_update ON public.social_posts;
CREATE POLICY social_posts_update ON public.social_posts FOR UPDATE TO authenticated
  USING (public.social_media_can(company_id, 'create'))
  WITH CHECK (public.social_media_can(company_id, 'create'));
DROP POLICY IF EXISTS social_posts_delete ON public.social_posts;
CREATE POLICY social_posts_delete ON public.social_posts FOR DELETE TO authenticated
  USING (status IN ('draft', 'cancelled') AND public.social_media_can(company_id, 'create')
    AND (author_id = public.current_crm_employee_id() OR public.social_media_can(company_id, 'approve')));

DROP POLICY IF EXISTS social_post_variants_select ON public.social_post_variants;
CREATE POLICY social_post_variants_select ON public.social_post_variants FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.social_posts p WHERE p.id = post_id AND public.social_media_can(p.company_id, 'view')));
DROP POLICY IF EXISTS social_post_variants_write ON public.social_post_variants;
CREATE POLICY social_post_variants_write ON public.social_post_variants FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.social_posts p WHERE p.id = post_id AND public.social_media_can(p.company_id, 'create')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.social_posts p WHERE p.id = post_id AND public.social_media_can(p.company_id, 'create')));

DROP POLICY IF EXISTS social_post_events_select ON public.social_post_events;
CREATE POLICY social_post_events_select ON public.social_post_events FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.social_posts p WHERE p.id = post_id AND public.social_media_can(p.company_id, 'view')));

-- Nazwy marek w wyborze marki („Social media” bez uprawnień kampanii marketingowych).
DROP POLICY IF EXISTS "Social media can view assigned companies" ON public.my_companies;
CREATE POLICY "Social media can view assigned companies" ON public.my_companies FOR SELECT TO authenticated
  USING (public.social_media_can(id, 'view'));

REVOKE ALL ON public.social_settings, public.social_brand_templates, public.social_publication_consents, public.social_assets,
  public.social_posts, public.social_post_variants, public.social_post_events FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.social_settings, public.social_brand_templates, public.social_publication_consents,
  public.social_assets, public.social_posts, public.social_post_variants TO authenticated;
GRANT SELECT ON public.social_post_events TO authenticated;
GRANT ALL ON public.social_settings, public.social_brand_templates, public.social_publication_consents, public.social_assets,
  public.social_posts, public.social_post_variants, public.social_post_events TO service_role;

-- Kalendarz w CRM, na Macu i w telefonie odświeża się po zmianie posta (Realtime z RLS).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
    AND NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime'
                    AND schemaname = 'public' AND tablename = 'social_posts') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.social_posts;
  END IF;
END $$;

-- 7. Pliki: prywatny bucket `social-media` ----------------------------------------------------------------------------
-- `<marka>/assets/<zdjęcie>/<plik>` — podgląd: zakres „view” albo wgrywający; zapis: twórca albo wgrywający w trakcie
-- wgrywania; usuwanie: twórca albo wgrywający w trakcie wgrywania. `<marka>/posts/<post>/<plik>.jpg` — podgląd „view”,
-- zapis i usuwanie „create”. Pliki nie są nadpisywane (nowa nazwa przy każdej zmianie) — bez prawa UPDATE.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('social-media', 'social-media', false, 41943040, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE OR REPLACE FUNCTION public.social_media_storage_can(p_name text, p_mode text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_parts text[] := string_to_array(coalesce(p_name, ''), '/');
  v_company uuid;
  v_id uuid;
  v_actor uuid := public.current_crm_employee_id();
  v_asset record;
BEGIN
  IF v_actor IS NULL OR public.current_session_is_seller_portal() OR cardinality(v_parts) <> 4
    OR v_parts[1] !~ '^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$'
    OR v_parts[3] !~ '^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$'
    OR v_parts[4] !~ '^[A-Za-z0-9._-]{1,80}$' THEN
    RETURN false;
  END IF;
  v_company := v_parts[1]::uuid;
  v_id := v_parts[3]::uuid;
  IF v_parts[2] = 'assets' THEN
    SELECT a.company_id, a.created_by, a.status INTO v_asset FROM public.social_assets a WHERE a.id = v_id;
    IF NOT FOUND OR v_asset.company_id <> v_company THEN
      RETURN false;
    END IF;
    IF p_mode = 'read' THEN
      RETURN public.social_media_can(v_company, 'view') OR v_asset.created_by = v_actor;
    END IF;
    RETURN public.social_media_can(v_company, 'create') OR (v_asset.created_by = v_actor AND v_asset.status = 'uploading');
  ELSIF v_parts[2] = 'posts' THEN
    IF NOT EXISTS (SELECT 1 FROM public.social_posts p WHERE p.id = v_id AND p.company_id = v_company) THEN
      RETURN false;
    END IF;
    RETURN public.social_media_can(v_company, CASE WHEN p_mode = 'read' THEN 'view' ELSE 'create' END)
      AND (p_mode = 'read' OR v_parts[4] ~ '\.jpg$');
  END IF;
  RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION public.social_media_storage_can(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.social_media_storage_can(text, text) TO authenticated, service_role;

DROP POLICY IF EXISTS "Social media read" ON storage.objects;
CREATE POLICY "Social media read" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'social-media' AND public.social_media_storage_can(name, 'read'));
DROP POLICY IF EXISTS "Social media insert" ON storage.objects;
CREATE POLICY "Social media insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'social-media' AND public.social_media_storage_can(name, 'write'));
DROP POLICY IF EXISTS "Social media delete" ON storage.objects;
CREATE POLICY "Social media delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'social-media' AND public.social_media_storage_can(name, 'delete'));

-- 8. Szablon domyślny Mavinci (z księgi znaku: logo pionowe w negatywie, MBF Atom, bordo / piasek / ciepła biel) ----------
-- Układ jak w szablonie PSD 1080×1350 (`Zbuduj-szablon-MAVINCI.jsx`): logo 170 px, 56 px od góry, na środku; tytuł 34 px,
-- odstęp liter 0,2 em, linia bazowa 168 px od dołu; złota kreska 72×2 px, 129 px od dołu; podpis 17 px, 0,35 em, 88 px
-- od dołu; przyciemnienie góry 300 px (60%), dołu 540 px w stronę bordo (do 90%). Pozostałe formaty — skala i marginesy
-- stref bezpiecznych (relacja: 220 px góra, 300 px dół).
DO $$
DECLARE
  v_company uuid;
  v_logo uuid;
  v_font uuid;
  v_overlay uuid;
  v_accent uuid;
  v_text uuid;
BEGIN
  SELECT c.id INTO v_company FROM public.my_companies c
  WHERE lower(btrim(c.name)) = 'mavinci' ORDER BY coalesce(c.is_default, false) DESC, c.created_at LIMIT 1;
  IF v_company IS NULL OR EXISTS (SELECT 1 FROM public.social_brand_templates t WHERE t.company_id = v_company) THEN
    RETURN;
  END IF;
  SELECT l.id INTO v_logo FROM public.company_brandbook_logos l
  WHERE l.company_id = v_company AND l.variant = 'vertical'
  ORDER BY (lower(l.label) LIKE '%white%' OR lower(l.label) LIKE '%negatyw%' OR lower(l.label) LIKE '%bia%') DESC,
    coalesce(l.is_default, false) DESC, l.order_index, l.created_at
  LIMIT 1;
  SELECT f.id INTO v_font FROM public.company_brandbook_fonts f
  WHERE f.company_id = v_company AND f.family ILIKE 'MBF Atom%' AND f.storage_path IS NOT NULL
  ORDER BY f.order_index, f.created_at LIMIT 1;
  SELECT c.id INTO v_overlay FROM public.company_brandbook_colors c
  WHERE c.company_id = v_company AND lower(left(btrim(c.hex), 7)) = '#4a001f' ORDER BY c.order_index LIMIT 1;
  SELECT c.id INTO v_accent FROM public.company_brandbook_colors c
  WHERE c.company_id = v_company AND lower(left(btrim(c.hex), 7)) = '#d5c489' ORDER BY c.order_index LIMIT 1;
  SELECT c.id INTO v_text FROM public.company_brandbook_colors c
  WHERE c.company_id = v_company AND lower(left(btrim(c.hex), 7)) = '#f7f2ea' ORDER BY c.order_index LIMIT 1;

  INSERT INTO public.social_brand_templates (company_id, name, is_default, logo_id, title_font_id, caption_font_id,
    overlay_color_id, accent_color_id, text_color_id, settings)
  VALUES (v_company, 'Mavinci — zdjęcie z podpisem', true, v_logo, v_font, v_font, v_overlay, v_accent, v_text,
    jsonb_build_object(
      'version', 1,
      'logo', jsonb_build_object('widthPx', 170, 'topPx', 56),
      'topShade', jsonb_build_object('heightPx', 300, 'opacity', 0.6, 'darken', 0.86),
      'bottomShade', jsonb_build_object('heightPx', 540, 'opacity', 0.9, 'darken', 0.73),
      'title', jsonb_build_object('sizePx', 34, 'trackingEm', 0.2, 'baselineFromBottomPx', 168, 'maxChars', 30),
      'line', jsonb_build_object('widthPx', 72, 'heightPx', 2, 'topFromBottomPx', 129),
      'caption', jsonb_build_object('sizePx', 17, 'trackingEm', 0.35, 'baselineFromBottomPx', 88, 'maxChars', 60),
      'sideMarginPx', 90,
      'formats', jsonb_build_object(
        '4:5', jsonb_build_object('scale', 1, 'insetTopPx', 0, 'insetBottomPx', 0),
        '1:1', jsonb_build_object('scale', 0.92, 'insetTopPx', 0, 'insetBottomPx', 0),
        '9:16', jsonb_build_object('scale', 1.05, 'insetTopPx', 220, 'insetBottomPx', 300),
        '1.91:1', jsonb_build_object('scale', 0.8, 'insetTopPx', 0, 'insetBottomPx', 0)
      )
    ));

  INSERT INTO public.social_settings (company_id) VALUES (v_company) ON CONFLICT (company_id) DO NOTHING;
END $$;
