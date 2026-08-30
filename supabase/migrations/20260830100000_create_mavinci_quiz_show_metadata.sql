-- Quiz Show w CRM przechowuje wyłącznie metadane i plan realizacji.
-- Treść pytań, odpowiedzi, multimedia i ekrany pozostają lokalnie w Mavinci LIVE.

CREATE TABLE IF NOT EXISTS public.mavinci_quiz_show_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  local_id text NOT NULL UNIQUE,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  question_count integer NOT NULL DEFAULT 0 CHECK (question_count >= 0),
  slide_count integer NOT NULL DEFAULT 0 CHECK (slide_count >= 0),
  question_types text[] NOT NULL DEFAULT '{}'::text[],
  has_media boolean NOT NULL DEFAULT false,
  source_instance_id text NOT NULL DEFAULT '',
  local_updated_at timestamptz,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (char_length(btrim(local_id)) BETWEEN 1 AND 200),
  CHECK (char_length(btrim(name)) BETWEEN 1 AND 200)
);

CREATE TABLE IF NOT EXISTS public.mavinci_quiz_show_games (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  local_id text UNIQUE,
  event_id uuid REFERENCES public.events(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  source text NOT NULL DEFAULT 'crm' CHECK (source IN ('crm', 'desktop', 'import')),
  source_instance_id text NOT NULL DEFAULT '',
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (char_length(btrim(name)) BETWEEN 2 AND 200)
);

CREATE TABLE IF NOT EXISTS public.mavinci_quiz_show_game_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id uuid NOT NULL REFERENCES public.mavinci_quiz_show_games(id) ON DELETE CASCADE,
  category_id uuid NOT NULL REFERENCES public.mavinci_quiz_show_categories(id) ON DELETE RESTRICT,
  sort_order integer NOT NULL CHECK (sort_order >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (game_id, category_id),
  UNIQUE (game_id, sort_order)
);

CREATE TABLE IF NOT EXISTS public.mavinci_quiz_show_rosters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (char_length(btrim(name)) BETWEEN 2 AND 200)
);

CREATE TABLE IF NOT EXISTS public.mavinci_quiz_show_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  roster_id uuid NOT NULL REFERENCES public.mavinci_quiz_show_rosters(id) ON DELETE CASCADE,
  first_name text NOT NULL,
  last_name text NOT NULL DEFAULT '',
  nickname text NOT NULL DEFAULT '',
  email text NOT NULL DEFAULT '',
  team text NOT NULL DEFAULT '',
  pilot_id integer CHECK (pilot_id BETWEEN 1 AND 624),
  sort_order integer NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (char_length(btrim(first_name)) BETWEEN 1 AND 120),
  UNIQUE (roster_id, pilot_id)
);

CREATE TABLE IF NOT EXISTS public.mavinci_quiz_show_event_setups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL UNIQUE REFERENCES public.events(id) ON DELETE CASCADE,
  game_id uuid REFERENCES public.mavinci_quiz_show_games(id) ON DELETE SET NULL,
  roster_id uuid REFERENCES public.mavinci_quiz_show_rosters(id) ON DELETE SET NULL,
  anonymous_mode boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mavinci_quiz_categories_updated
  ON public.mavinci_quiz_show_categories(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_mavinci_quiz_games_event
  ON public.mavinci_quiz_show_games(event_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_mavinci_quiz_game_categories_game
  ON public.mavinci_quiz_show_game_categories(game_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_mavinci_quiz_rosters_event
  ON public.mavinci_quiz_show_rosters(event_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_mavinci_quiz_participants_roster
  ON public.mavinci_quiz_show_participants(roster_id, sort_order);

DROP TRIGGER IF EXISTS trg_mavinci_quiz_categories_audit ON public.mavinci_quiz_show_categories;
CREATE TRIGGER trg_mavinci_quiz_categories_audit
BEFORE INSERT OR UPDATE ON public.mavinci_quiz_show_categories
FOR EACH ROW EXECUTE FUNCTION public.set_mavinci_audit_fields();

DROP TRIGGER IF EXISTS trg_mavinci_quiz_games_audit ON public.mavinci_quiz_show_games;
CREATE TRIGGER trg_mavinci_quiz_games_audit
BEFORE INSERT OR UPDATE ON public.mavinci_quiz_show_games
FOR EACH ROW EXECUTE FUNCTION public.set_mavinci_audit_fields();

DROP TRIGGER IF EXISTS trg_mavinci_quiz_rosters_audit ON public.mavinci_quiz_show_rosters;
CREATE TRIGGER trg_mavinci_quiz_rosters_audit
BEFORE INSERT OR UPDATE ON public.mavinci_quiz_show_rosters
FOR EACH ROW EXECUTE FUNCTION public.set_mavinci_audit_fields();

DROP TRIGGER IF EXISTS trg_mavinci_quiz_setups_audit ON public.mavinci_quiz_show_event_setups;
CREATE TRIGGER trg_mavinci_quiz_setups_audit
BEFORE INSERT OR UPDATE ON public.mavinci_quiz_show_event_setups
FOR EACH ROW EXECUTE FUNCTION public.set_mavinci_audit_fields();

CREATE OR REPLACE FUNCTION public.touch_mavinci_quiz_child_row()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_mavinci_quiz_participant ON public.mavinci_quiz_show_participants;
CREATE TRIGGER trg_touch_mavinci_quiz_participant
BEFORE UPDATE ON public.mavinci_quiz_show_participants
FOR EACH ROW EXECUTE FUNCTION public.touch_mavinci_quiz_child_row();

ALTER TABLE public.mavinci_quiz_show_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mavinci_quiz_show_games ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mavinci_quiz_show_game_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mavinci_quiz_show_rosters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mavinci_quiz_show_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mavinci_quiz_show_event_setups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mavinci_quiz_categories_select ON public.mavinci_quiz_show_categories;
CREATE POLICY mavinci_quiz_categories_select ON public.mavinci_quiz_show_categories
FOR SELECT USING (
  public.can_use_mavinci_global_module('quiz_show')
  AND public.can_use_mavinci_hub('view')
);

DROP POLICY IF EXISTS mavinci_quiz_categories_write ON public.mavinci_quiz_show_categories;
CREATE POLICY mavinci_quiz_categories_write ON public.mavinci_quiz_show_categories
FOR ALL USING (
  public.can_use_mavinci_global_module('quiz_show')
  AND public.can_use_mavinci_hub('manage')
) WITH CHECK (
  public.can_use_mavinci_global_module('quiz_show')
  AND public.can_use_mavinci_hub('manage')
);

DROP POLICY IF EXISTS mavinci_quiz_games_select ON public.mavinci_quiz_show_games;
CREATE POLICY mavinci_quiz_games_select ON public.mavinci_quiz_show_games
FOR SELECT USING (
  public.can_use_mavinci_global_module('quiz_show')
  AND (
    public.can_use_mavinci_hub('view')
    OR (event_id IS NOT NULL AND public.can_use_mavinci_module(event_id, 'quiz_show', 'view'))
  )
);

DROP POLICY IF EXISTS mavinci_quiz_games_write ON public.mavinci_quiz_show_games;
CREATE POLICY mavinci_quiz_games_write ON public.mavinci_quiz_show_games
FOR ALL USING (
  public.can_use_mavinci_global_module('quiz_show')
  AND (
    public.can_use_mavinci_hub('manage')
    OR (event_id IS NOT NULL AND public.can_use_mavinci_module(event_id, 'quiz_show', 'edit'))
  )
) WITH CHECK (
  public.can_use_mavinci_global_module('quiz_show')
  AND (
    public.can_use_mavinci_hub('manage')
    OR (event_id IS NOT NULL AND public.can_use_mavinci_module(event_id, 'quiz_show', 'edit'))
  )
);

DROP POLICY IF EXISTS mavinci_quiz_game_categories_select ON public.mavinci_quiz_show_game_categories;
CREATE POLICY mavinci_quiz_game_categories_select ON public.mavinci_quiz_show_game_categories
FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.mavinci_quiz_show_games game WHERE game.id = game_id)
);

DROP POLICY IF EXISTS mavinci_quiz_game_categories_write ON public.mavinci_quiz_show_game_categories;
CREATE POLICY mavinci_quiz_game_categories_write ON public.mavinci_quiz_show_game_categories
FOR ALL USING (
  EXISTS (
    SELECT 1 FROM public.mavinci_quiz_show_games game
    WHERE game.id = game_id
      AND public.can_use_mavinci_global_module('quiz_show')
      AND (
        public.can_use_mavinci_hub('manage')
        OR (game.event_id IS NOT NULL AND public.can_use_mavinci_module(game.event_id, 'quiz_show', 'edit'))
      )
  )
) WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.mavinci_quiz_show_games game
    WHERE game.id = game_id
      AND public.can_use_mavinci_global_module('quiz_show')
      AND (
        public.can_use_mavinci_hub('manage')
        OR (game.event_id IS NOT NULL AND public.can_use_mavinci_module(game.event_id, 'quiz_show', 'edit'))
      )
  )
);

DROP POLICY IF EXISTS mavinci_quiz_rosters_select ON public.mavinci_quiz_show_rosters;
CREATE POLICY mavinci_quiz_rosters_select ON public.mavinci_quiz_show_rosters
FOR SELECT USING (
  public.can_use_mavinci_global_module('quiz_show')
  AND (
    public.can_use_mavinci_hub('view')
    OR public.can_use_mavinci_module(event_id, 'quiz_show', 'view')
  )
);

DROP POLICY IF EXISTS mavinci_quiz_rosters_write ON public.mavinci_quiz_show_rosters;
CREATE POLICY mavinci_quiz_rosters_write ON public.mavinci_quiz_show_rosters
FOR ALL USING (
  public.can_use_mavinci_global_module('quiz_show')
  AND (
    public.can_use_mavinci_hub('manage')
    OR public.can_use_mavinci_module(event_id, 'quiz_show', 'edit')
  )
) WITH CHECK (
  public.can_use_mavinci_global_module('quiz_show')
  AND (
    public.can_use_mavinci_hub('manage')
    OR public.can_use_mavinci_module(event_id, 'quiz_show', 'edit')
  )
);

DROP POLICY IF EXISTS mavinci_quiz_participants_select ON public.mavinci_quiz_show_participants;
CREATE POLICY mavinci_quiz_participants_select ON public.mavinci_quiz_show_participants
FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.mavinci_quiz_show_rosters roster WHERE roster.id = roster_id)
);

DROP POLICY IF EXISTS mavinci_quiz_participants_write ON public.mavinci_quiz_show_participants;
CREATE POLICY mavinci_quiz_participants_write ON public.mavinci_quiz_show_participants
FOR ALL USING (
  EXISTS (
    SELECT 1 FROM public.mavinci_quiz_show_rosters roster
    WHERE roster.id = roster_id
      AND public.can_use_mavinci_global_module('quiz_show')
      AND (
        public.can_use_mavinci_hub('manage')
        OR public.can_use_mavinci_module(roster.event_id, 'quiz_show', 'edit')
      )
  )
) WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.mavinci_quiz_show_rosters roster
    WHERE roster.id = roster_id
      AND public.can_use_mavinci_global_module('quiz_show')
      AND (
        public.can_use_mavinci_hub('manage')
        OR public.can_use_mavinci_module(roster.event_id, 'quiz_show', 'edit')
      )
  )
);

DROP POLICY IF EXISTS mavinci_quiz_setups_select ON public.mavinci_quiz_show_event_setups;
CREATE POLICY mavinci_quiz_setups_select ON public.mavinci_quiz_show_event_setups
FOR SELECT USING (
  public.can_use_mavinci_global_module('quiz_show')
  AND (
    public.can_use_mavinci_hub('view')
    OR public.can_use_mavinci_module(event_id, 'quiz_show', 'view')
  )
);

DROP POLICY IF EXISTS mavinci_quiz_setups_write ON public.mavinci_quiz_show_event_setups;
CREATE POLICY mavinci_quiz_setups_write ON public.mavinci_quiz_show_event_setups
FOR ALL USING (
  public.can_use_mavinci_global_module('quiz_show')
  AND (
    public.can_use_mavinci_hub('manage')
    OR public.can_use_mavinci_module(event_id, 'quiz_show', 'edit')
  )
) WITH CHECK (
  public.can_use_mavinci_global_module('quiz_show')
  AND (
    public.can_use_mavinci_hub('manage')
    OR public.can_use_mavinci_module(event_id, 'quiz_show', 'edit')
  )
);

CREATE OR REPLACE FUNCTION public.mavinci_sync_quiz_show_inventory(
  p_categories jsonb,
  p_games jsonb,
  p_instance_id text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  category_value jsonb;
  game_value jsonb;
  category_local_id text;
  game_id_value uuid;
  category_id_value uuid;
  category_index integer;
  category_count integer := 0;
  game_count integer := 0;
BEGIN
  IF jsonb_typeof(COALESCE(p_categories, '[]'::jsonb)) <> 'array'
    OR jsonb_typeof(COALESCE(p_games, '[]'::jsonb)) <> 'array'
  THEN
    RAISE EXCEPTION 'Nieprawidłowy katalog Quiz Show';
  END IF;

  FOR category_value IN SELECT value FROM jsonb_array_elements(COALESCE(p_categories, '[]'::jsonb))
  LOOP
    category_local_id := btrim(COALESCE(category_value->>'local_id', ''));
    IF category_local_id = '' OR btrim(COALESCE(category_value->>'name', '')) = '' THEN CONTINUE; END IF;
    INSERT INTO public.mavinci_quiz_show_categories (
      local_id, name, description, question_count, slide_count, question_types,
      has_media, source_instance_id, local_updated_at, is_active
    ) VALUES (
      category_local_id,
      left(btrim(category_value->>'name'), 200),
      COALESCE(category_value->>'description', ''),
      GREATEST(0, COALESCE((category_value->>'question_count')::integer, 0)),
      GREATEST(0, COALESCE((category_value->>'slide_count')::integer, 0)),
      ARRAY(SELECT jsonb_array_elements_text(COALESCE(category_value->'question_types', '[]'::jsonb))),
      COALESCE((category_value->>'has_media')::boolean, false),
      left(COALESCE(p_instance_id, ''), 160),
      CASE WHEN COALESCE(category_value->>'local_updated_at', '') <> '' THEN (category_value->>'local_updated_at')::timestamptz ELSE NULL END,
      true
    )
    ON CONFLICT (local_id) DO UPDATE SET
      name = EXCLUDED.name,
      description = EXCLUDED.description,
      question_count = EXCLUDED.question_count,
      slide_count = EXCLUDED.slide_count,
      question_types = EXCLUDED.question_types,
      has_media = EXCLUDED.has_media,
      source_instance_id = EXCLUDED.source_instance_id,
      local_updated_at = EXCLUDED.local_updated_at,
      is_active = true;
    category_count := category_count + 1;
  END LOOP;

  FOR game_value IN SELECT value FROM jsonb_array_elements(COALESCE(p_games, '[]'::jsonb))
  LOOP
    IF btrim(COALESCE(game_value->>'local_id', '')) = '' OR btrim(COALESCE(game_value->>'name', '')) = '' THEN CONTINUE; END IF;
    INSERT INTO public.mavinci_quiz_show_games (
      local_id, event_id, name, description, source, source_instance_id, is_active
    ) VALUES (
      btrim(game_value->>'local_id'),
      NULL,
      left(btrim(game_value->>'name'), 200),
      COALESCE(game_value->>'description', ''),
      'desktop',
      left(COALESCE(p_instance_id, ''), 160),
      true
    )
    ON CONFLICT (local_id) DO UPDATE SET
      name = EXCLUDED.name,
      description = EXCLUDED.description,
      source_instance_id = EXCLUDED.source_instance_id,
      is_active = true
    RETURNING id INTO game_id_value;

    DELETE FROM public.mavinci_quiz_show_game_categories WHERE game_id = game_id_value;
    category_index := 0;
    FOR category_local_id IN SELECT jsonb_array_elements_text(COALESCE(game_value->'category_local_ids', '[]'::jsonb))
    LOOP
      SELECT id INTO category_id_value
      FROM public.mavinci_quiz_show_categories
      WHERE local_id = category_local_id AND is_active = true;
      IF category_id_value IS NOT NULL THEN
        INSERT INTO public.mavinci_quiz_show_game_categories (game_id, category_id, sort_order)
        VALUES (game_id_value, category_id_value, category_index);
        category_index := category_index + 1;
      END IF;
      category_id_value := NULL;
    END LOOP;
    game_count := game_count + 1;
  END LOOP;

  RETURN jsonb_build_object('categories', category_count, 'games', game_count);
END;
$$;

CREATE OR REPLACE FUNCTION public.mavinci_save_quiz_show_game(p_game jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  game_id_value uuid;
  event_id_value uuid;
  category_value jsonb;
  category_id_value uuid;
  category_index integer := 0;
BEGIN
  IF length(btrim(COALESCE(p_game->>'name', ''))) NOT BETWEEN 2 AND 200 THEN
    RAISE EXCEPTION 'Podaj nazwę gry Quiz Show';
  END IF;
  IF jsonb_typeof(COALESCE(p_game->'categories', '[]'::jsonb)) <> 'array'
    OR jsonb_array_length(COALESCE(p_game->'categories', '[]'::jsonb)) = 0
  THEN
    RAISE EXCEPTION 'Gra musi zawierać przynajmniej jedną kategorię';
  END IF;
  game_id_value := CASE
    WHEN COALESCE(p_game->>'id', '') ~* '^[0-9a-f-]{36}$' THEN (p_game->>'id')::uuid
    ELSE gen_random_uuid()
  END;
  event_id_value := CASE
    WHEN COALESCE(p_game->>'event_id', '') ~* '^[0-9a-f-]{36}$' THEN (p_game->>'event_id')::uuid
    ELSE NULL
  END;

  INSERT INTO public.mavinci_quiz_show_games (id, local_id, event_id, name, description, source, is_active)
  VALUES (game_id_value, NULL, event_id_value, btrim(p_game->>'name'), COALESCE(p_game->>'description', ''), 'crm', true)
  ON CONFLICT (id) DO UPDATE SET
    event_id = EXCLUDED.event_id,
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    is_active = true;

  DELETE FROM public.mavinci_quiz_show_game_categories WHERE game_id = game_id_value;
  FOR category_value IN SELECT value FROM jsonb_array_elements(p_game->'categories')
  LOOP
    category_id_value := (category_value->>'category_id')::uuid;
    IF NOT EXISTS (SELECT 1 FROM public.mavinci_quiz_show_categories WHERE id = category_id_value AND is_active = true) THEN
      RAISE EXCEPTION 'Wybrana kategoria nie jest już dostępna';
    END IF;
    INSERT INTO public.mavinci_quiz_show_game_categories (game_id, category_id, sort_order)
    VALUES (game_id_value, category_id_value, category_index);
    category_index := category_index + 1;
  END LOOP;
  RETURN game_id_value;
END;
$$;

CREATE OR REPLACE FUNCTION public.mavinci_save_quiz_show_roster(p_roster jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  roster_id_value uuid;
  event_id_value uuid;
  participant_value jsonb;
  participant_index integer := 0;
BEGIN
  event_id_value := (p_roster->>'event_id')::uuid;
  IF length(btrim(COALESCE(p_roster->>'name', ''))) NOT BETWEEN 2 AND 200 THEN
    RAISE EXCEPTION 'Podaj nazwę listy uczestników';
  END IF;
  IF jsonb_typeof(COALESCE(p_roster->'participants', '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'Nieprawidłowa lista uczestników';
  END IF;
  roster_id_value := CASE
    WHEN COALESCE(p_roster->>'id', '') ~* '^[0-9a-f-]{36}$' THEN (p_roster->>'id')::uuid
    ELSE gen_random_uuid()
  END;

  INSERT INTO public.mavinci_quiz_show_rosters (id, event_id, name, description, is_active)
  VALUES (roster_id_value, event_id_value, btrim(p_roster->>'name'), COALESCE(p_roster->>'description', ''), true)
  ON CONFLICT (id) DO UPDATE SET
    event_id = EXCLUDED.event_id,
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    is_active = true;

  DELETE FROM public.mavinci_quiz_show_participants WHERE roster_id = roster_id_value;
  FOR participant_value IN SELECT value FROM jsonb_array_elements(COALESCE(p_roster->'participants', '[]'::jsonb))
  LOOP
    IF btrim(COALESCE(participant_value->>'first_name', '')) = '' THEN CONTINUE; END IF;
    INSERT INTO public.mavinci_quiz_show_participants (
      roster_id, first_name, last_name, nickname, email, team, pilot_id, sort_order
    ) VALUES (
      roster_id_value,
      left(btrim(participant_value->>'first_name'), 120),
      left(btrim(COALESCE(participant_value->>'last_name', '')), 120),
      left(btrim(COALESCE(participant_value->>'nickname', '')), 120),
      left(btrim(COALESCE(participant_value->>'email', '')), 240),
      left(btrim(COALESCE(participant_value->>'team', '')), 120),
      CASE WHEN COALESCE(participant_value->>'pilot_id', '') ~ '^[0-9]+$' THEN (participant_value->>'pilot_id')::integer ELSE NULL END,
      participant_index
    );
    participant_index := participant_index + 1;
  END LOOP;
  RETURN roster_id_value;
END;
$$;

CREATE OR REPLACE FUNCTION public.mavinci_quiz_show_events()
RETURNS TABLE (
  event_id uuid,
  event_name text,
  event_date timestamptz,
  event_status text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT event.id, event.name, event.event_date, event.status::text
  FROM public.events event
  WHERE (
    public.can_access_mavinci_event(event.id)
    OR public.can_manage_mavinci_event(event.id)
  )
  AND EXISTS (
    SELECT 1
    FROM public.offers offer_row
    JOIN public.offer_items offer_item ON offer_item.offer_id = offer_row.id
    JOIN public.offer_product_mavinci_live_modules module_link ON module_link.product_id = offer_item.product_id
    WHERE offer_row.event_id = event.id
      AND offer_row.status::text NOT IN ('rejected', 'cancelled')
      AND module_link.module_key = 'quiz_show'
  )
  ORDER BY event.event_date DESC NULLS LAST, event.name
$$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.mavinci_quiz_show_categories TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mavinci_quiz_show_games TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mavinci_quiz_show_game_categories TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mavinci_quiz_show_rosters TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mavinci_quiz_show_participants TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mavinci_quiz_show_event_setups TO authenticated;
GRANT EXECUTE ON FUNCTION public.mavinci_sync_quiz_show_inventory(jsonb, jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mavinci_save_quiz_show_game(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mavinci_save_quiz_show_roster(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mavinci_quiz_show_events() TO authenticated;
