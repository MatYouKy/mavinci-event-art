-- Centralne gry Familiady. Supabase przechowuje kolejność rund i ich mnożniki,
-- a Mavinci LIVE utrzymuje lokalny cache do pracy bez sieci.

CREATE TABLE IF NOT EXISTS public.mavinci_familiada_games (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid REFERENCES public.events(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  is_active boolean NOT NULL DEFAULT true,
  source text NOT NULL DEFAULT 'crm' CHECK (source IN ('crm', 'desktop', 'import')),
  created_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (char_length(btrim(name)) BETWEEN 2 AND 160)
);

CREATE TABLE IF NOT EXISTS public.mavinci_familiada_game_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id uuid NOT NULL REFERENCES public.mavinci_familiada_games(id) ON DELETE CASCADE,
  question_id uuid NOT NULL REFERENCES public.mavinci_familiada_questions(id) ON DELETE RESTRICT,
  sort_order integer NOT NULL CHECK (sort_order >= 0),
  multiplier smallint NOT NULL DEFAULT 1 CHECK (multiplier IN (1, 2, 3)),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (game_id, question_id),
  UNIQUE (game_id, sort_order)
);

CREATE INDEX IF NOT EXISTS idx_mavinci_familiada_games_event
  ON public.mavinci_familiada_games(event_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_mavinci_familiada_game_questions_game
  ON public.mavinci_familiada_game_questions(game_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_mavinci_familiada_game_questions_question
  ON public.mavinci_familiada_game_questions(question_id);

DROP TRIGGER IF EXISTS trg_mavinci_familiada_games_audit ON public.mavinci_familiada_games;
CREATE TRIGGER trg_mavinci_familiada_games_audit
BEFORE INSERT OR UPDATE ON public.mavinci_familiada_games
FOR EACH ROW EXECUTE FUNCTION public.set_mavinci_audit_fields();

CREATE OR REPLACE FUNCTION public.touch_mavinci_familiada_game_question()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_mavinci_familiada_game_question ON public.mavinci_familiada_game_questions;
CREATE TRIGGER trg_touch_mavinci_familiada_game_question
BEFORE UPDATE ON public.mavinci_familiada_game_questions
FOR EACH ROW EXECUTE FUNCTION public.touch_mavinci_familiada_game_question();

-- Od tej wersji każde pytanie używane w nowej grze ma dokładnie 3–6 odpowiedzi.
-- Zastępujemy funkcję istniejącego triggera, zachowując również limit 100 punktów.
CREATE OR REPLACE FUNCTION public.validate_mavinci_familiada_answers()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  answer jsonb;
  answer_points integer;
  points_sum integer := 0;
BEGIN
  IF jsonb_typeof(NEW.answers) <> 'array'
    OR jsonb_array_length(NEW.answers) NOT BETWEEN 3 AND 6
  THEN
    RAISE EXCEPTION 'Pytanie Familiady musi mieć od 3 do 6 odpowiedzi';
  END IF;

  FOR answer IN SELECT value FROM jsonb_array_elements(NEW.answers)
  LOOP
    IF jsonb_typeof(answer) <> 'object'
      OR length(btrim(COALESCE(answer->>'text', ''))) = 0
      OR NOT (answer ? 'points')
      OR jsonb_typeof(answer->'points') <> 'number'
    THEN
      RAISE EXCEPTION 'Każda odpowiedź musi zawierać tekst i liczbę punktów';
    END IF;

    answer_points := (answer->>'points')::integer;
    IF answer_points < 0 OR answer_points > 100 THEN
      RAISE EXCEPTION 'Punkty odpowiedzi muszą mieścić się w zakresie 0–100';
    END IF;
    points_sum := points_sum + answer_points;
  END LOOP;

  IF points_sum > 100 THEN
    RAISE EXCEPTION 'Suma punktów odpowiedzi nie może przekraczać 100';
  END IF;
  RETURN NEW;
END;
$$;

ALTER TABLE public.mavinci_familiada_games ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mavinci_familiada_game_questions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mavinci_familiada_games_select ON public.mavinci_familiada_games;
CREATE POLICY mavinci_familiada_games_select
ON public.mavinci_familiada_games FOR SELECT
USING (
  public.can_use_mavinci_global_module('familiada')
  AND (
    public.can_use_mavinci_hub('view')
    OR (event_id IS NOT NULL AND public.can_use_mavinci_module(event_id, 'familiada', 'view'))
  )
);

DROP POLICY IF EXISTS mavinci_familiada_games_write ON public.mavinci_familiada_games;
CREATE POLICY mavinci_familiada_games_write
ON public.mavinci_familiada_games FOR ALL
USING (
  public.can_use_mavinci_global_module('familiada')
  AND (
    public.can_use_mavinci_hub('manage')
    OR (event_id IS NOT NULL AND public.can_use_mavinci_module(event_id, 'familiada', 'edit'))
  )
)
WITH CHECK (
  public.can_use_mavinci_global_module('familiada')
  AND (
    public.can_use_mavinci_hub('manage')
    OR (event_id IS NOT NULL AND public.can_use_mavinci_module(event_id, 'familiada', 'edit'))
  )
);

DROP POLICY IF EXISTS mavinci_familiada_game_questions_select ON public.mavinci_familiada_game_questions;
CREATE POLICY mavinci_familiada_game_questions_select
ON public.mavinci_familiada_game_questions FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.mavinci_familiada_games game
    WHERE game.id = game_id
  )
);

DROP POLICY IF EXISTS mavinci_familiada_game_questions_write ON public.mavinci_familiada_game_questions;
CREATE POLICY mavinci_familiada_game_questions_write
ON public.mavinci_familiada_game_questions FOR ALL
USING (
  EXISTS (
    SELECT 1
    FROM public.mavinci_familiada_games game
    WHERE game.id = game_id
      AND public.can_use_mavinci_global_module('familiada')
      AND (
        public.can_use_mavinci_hub('manage')
        OR (game.event_id IS NOT NULL AND public.can_use_mavinci_module(game.event_id, 'familiada', 'edit'))
      )
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.mavinci_familiada_games game
    WHERE game.id = game_id
      AND public.can_use_mavinci_global_module('familiada')
      AND (
        public.can_use_mavinci_hub('manage')
        OR (game.event_id IS NOT NULL AND public.can_use_mavinci_module(game.event_id, 'familiada', 'edit'))
      )
  )
);

CREATE OR REPLACE FUNCTION public.mavinci_save_familiada_game(p_game jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  game_id_value uuid;
  event_id_value uuid;
  round_value jsonb;
  question_id_value uuid;
  multiplier_value smallint;
  round_index integer := 0;
BEGIN
  IF p_game IS NULL OR jsonb_typeof(p_game) <> 'object' THEN
    RAISE EXCEPTION 'Brakuje danych gry Familiady';
  END IF;

  IF length(btrim(COALESCE(p_game->>'name', ''))) NOT BETWEEN 2 AND 160 THEN
    RAISE EXCEPTION 'Nazwa gry musi mieć od 2 do 160 znaków';
  END IF;

  IF jsonb_typeof(COALESCE(p_game->'rounds', '[]'::jsonb)) <> 'array'
    OR jsonb_array_length(COALESCE(p_game->'rounds', '[]'::jsonb)) = 0
  THEN
    RAISE EXCEPTION 'Gra musi zawierać przynajmniej jedną rundę';
  END IF;

  game_id_value := CASE
    WHEN COALESCE(p_game->>'id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      THEN (p_game->>'id')::uuid
    ELSE gen_random_uuid()
  END;
  event_id_value := CASE
    WHEN COALESCE(p_game->>'event_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      THEN (p_game->>'event_id')::uuid
    ELSE NULL
  END;

  INSERT INTO public.mavinci_familiada_games (
    id, event_id, name, description, is_active, source
  ) VALUES (
    game_id_value,
    event_id_value,
    btrim(p_game->>'name'),
    COALESCE(btrim(p_game->>'description'), ''),
    COALESCE((p_game->>'is_active')::boolean, true),
    CASE WHEN COALESCE(p_game->>'source', '') IN ('crm', 'desktop', 'import')
      THEN p_game->>'source' ELSE 'crm' END
  )
  ON CONFLICT (id) DO UPDATE SET
    event_id = EXCLUDED.event_id,
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    is_active = EXCLUDED.is_active,
    source = EXCLUDED.source;

  DELETE FROM public.mavinci_familiada_game_questions
  WHERE game_id = game_id_value;

  FOR round_value IN
    SELECT value FROM jsonb_array_elements(p_game->'rounds')
  LOOP
    IF COALESCE(round_value->>'question_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION 'Runda zawiera nieprawidłowe pytanie';
    END IF;
    question_id_value := (round_value->>'question_id')::uuid;
    multiplier_value := COALESCE((round_value->>'multiplier')::smallint, 1);
    IF multiplier_value NOT IN (1, 2, 3) THEN
      RAISE EXCEPTION 'Mnożnik rundy musi wynosić 1, 2 albo 3';
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.mavinci_familiada_questions question
      WHERE question.id = question_id_value
        AND question.is_active = true
        AND jsonb_array_length(question.answers) BETWEEN 3 AND 6
    ) THEN
      RAISE EXCEPTION 'Pytanie rundy nie istnieje, jest wyłączone lub ma nieprawidłową liczbę odpowiedzi';
    END IF;

    INSERT INTO public.mavinci_familiada_game_questions (
      game_id, question_id, sort_order, multiplier
    ) VALUES (
      game_id_value, question_id_value, round_index, multiplier_value
    );
    round_index := round_index + 1;
  END LOOP;

  RETURN game_id_value;
END;
$$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.mavinci_familiada_games TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mavinci_familiada_game_questions TO authenticated;
GRANT EXECUTE ON FUNCTION public.mavinci_save_familiada_game(jsonb) TO authenticated;
