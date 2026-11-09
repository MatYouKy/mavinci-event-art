-- Mavinci LIVE: odpowiadanie z telefonów przez internet (mavinci.pl/quiz/KOD).
--
-- Przebieg:
--  * prowadzący (aplikacja Mavinci LIVE, zalogowany pracownik) otwiera sesję → dostaje krótki KOD,
--  * gracz na telefonie wpisuje KOD i imię (bez konta) → dostaje token i numer gracza (od 2001),
--  * stan przycisków (pytanie, odpowiedzi, czy zbieramy) prowadzący zapisuje funkcją, a baza rozsyła go
--    przez Realtime na prywatny kanał sesji `mquiz:<id>` (czytać może tylko ten, kto zna id sesji),
--  * naciśnięcie gracza = wiersz w mavinci_online_presses z czasem serwera; wyzwalacz rozsyła je
--    na kanał prowadzącego `mquiz-host:<id>` (czyta wyłącznie właściciel sesji).
-- Telefony nie piszą na kanały same — każda zmiana przechodzi przez funkcje poniżej.

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS public.mavinci_online_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL,
  title text NOT NULL DEFAULT 'Mavinci LIVE',
  event_id uuid REFERENCES public.events(id) ON DELETE SET NULL,
  created_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  host_user_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  state jsonb NOT NULL DEFAULT '{"title":"Mavinci LIVE","mode":"idle","answers":[],"collecting":false,"message":"Czekaj na start gry"}'::jsonb,
  state_rev integer NOT NULL DEFAULT 0,
  max_players integer NOT NULL DEFAULT 1000 CHECK (max_players BETWEEN 1 AND 5000),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '18 hours',
  closed_at timestamptz
);

-- Kod jest unikalny wśród otwartych sesji (po zamknięciu może wrócić).
CREATE UNIQUE INDEX IF NOT EXISTS mavinci_online_sessions_open_code
  ON public.mavinci_online_sessions (code) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS mavinci_online_sessions_host
  ON public.mavinci_online_sessions (host_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.mavinci_online_players (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.mavinci_online_sessions(id) ON DELETE CASCADE,
  player_no integer NOT NULL,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 40),
  token_hash text NOT NULL,
  joined_at timestamptz NOT NULL DEFAULT now(),
  last_press_at timestamptz,
  UNIQUE (session_id, player_no),
  UNIQUE (token_hash)
);

CREATE TABLE IF NOT EXISTS public.mavinci_online_presses (
  id bigserial PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES public.mavinci_online_sessions(id) ON DELETE CASCADE,
  player_id uuid NOT NULL REFERENCES public.mavinci_online_players(id) ON DELETE CASCADE,
  player_no integer NOT NULL,
  answer text NOT NULL CHECK (answer IN ('A', 'B', 'C', 'D', 'E', 'F', 'QUIZ')),
  -- Licytacja: telefon zbiera stuknięcia i wysyła je paczką.
  taps integer NOT NULL DEFAULT 1 CHECK (taps BETWEEN 1 AND 60),
  state_rev integer NOT NULL DEFAULT 0,
  pressed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS mavinci_online_presses_session
  ON public.mavinci_online_presses (session_id, id);

-- Bez bezpośredniego dostępu do tabel: wszystko przez funkcje SECURITY DEFINER.
ALTER TABLE public.mavinci_online_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mavinci_online_players ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mavinci_online_presses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "mavinci_online_sessions_host_read" ON public.mavinci_online_sessions;
CREATE POLICY "mavinci_online_sessions_host_read" ON public.mavinci_online_sessions
  FOR SELECT TO authenticated USING (host_user_id = auth.uid());
DROP POLICY IF EXISTS "mavinci_online_players_host_read" ON public.mavinci_online_players;
CREATE POLICY "mavinci_online_players_host_read" ON public.mavinci_online_players
  FOR SELECT TO authenticated USING (EXISTS (
    SELECT 1 FROM public.mavinci_online_sessions s WHERE s.id = session_id AND s.host_user_id = auth.uid()
  ));
DROP POLICY IF EXISTS "mavinci_online_presses_host_read" ON public.mavinci_online_presses;
CREATE POLICY "mavinci_online_presses_host_read" ON public.mavinci_online_presses
  FOR SELECT TO authenticated USING (EXISTS (
    SELECT 1 FROM public.mavinci_online_sessions s WHERE s.id = session_id AND s.host_user_id = auth.uid()
  ));

CREATE OR REPLACE FUNCTION public.mavinci_online_token_hash(p_token text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public, extensions
AS $$
  SELECT encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')
$$;

CREATE OR REPLACE FUNCTION public.mavinci_online_new_code()
RETURNS text
LANGUAGE plpgsql
VOLATILE
SET search_path = public, extensions
AS $$
DECLARE
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  candidate text;
  bytes bytea;
  i integer;
BEGIN
  LOOP
    bytes := extensions.gen_random_bytes(6);
    candidate := '';
    FOR i IN 0..5 LOOP
      candidate := candidate || substr(alphabet, (get_byte(bytes, i) % 32) + 1, 1);
    END LOOP;
    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM public.mavinci_online_sessions WHERE code = candidate AND status = 'open'
    );
  END LOOP;
  RETURN candidate;
END;
$$;

-- ── Prowadzący ──────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.mavinci_online_open(
  p_title text DEFAULT NULL,
  p_event_id uuid DEFAULT NULL,
  p_max_players integer DEFAULT 1000
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_employee uuid := public.current_mavinci_employee_id();
  v_session public.mavinci_online_sessions;
BEGIN
  IF auth.uid() IS NULL OR v_employee IS NULL THEN
    RAISE EXCEPTION 'Quiz online może otworzyć tylko zalogowany pracownik.' USING ERRCODE = '42501';
  END IF;

  -- Porządki: wygasłe sesje zamykamy, a zamknięte starsze niż 7 dni usuwamy razem z naciśnięciami.
  UPDATE public.mavinci_online_sessions
     SET status = 'closed', closed_at = now()
   WHERE status = 'open' AND expires_at < now();
  DELETE FROM public.mavinci_online_sessions
   WHERE status = 'closed' AND coalesce(closed_at, expires_at) < now() - interval '7 days';

  INSERT INTO public.mavinci_online_sessions (code, title, event_id, created_by, host_user_id, max_players)
  VALUES (
    public.mavinci_online_new_code(),
    coalesce(nullif(trim(p_title), ''), 'Mavinci LIVE'),
    p_event_id,
    v_employee,
    auth.uid(),
    greatest(1, least(coalesce(p_max_players, 1000), 5000))
  )
  RETURNING * INTO v_session;

  RETURN jsonb_build_object(
    'id', v_session.id,
    'code', v_session.code,
    'expiresAt', v_session.expires_at,
    'hostTopic', 'mquiz-host:' || v_session.id
  );
END;
$$;

-- Ponowne podłączenie aplikacji do swojej otwartej sesji (np. po restarcie) — bez zmiany kodu.
CREATE OR REPLACE FUNCTION public.mavinci_online_resume(p_session_id uuid)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'id', s.id,
    'code', s.code,
    'expiresAt', s.expires_at,
    'hostTopic', 'mquiz-host:' || s.id,
    'players', (SELECT count(*) FROM public.mavinci_online_players p WHERE p.session_id = s.id)
  )
  FROM public.mavinci_online_sessions s
  WHERE s.id = p_session_id
    AND s.host_user_id = auth.uid()
    AND s.status = 'open'
    AND s.expires_at > now()
$$;

CREATE OR REPLACE FUNCTION public.mavinci_online_set_state(p_session_id uuid, p_state jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rev integer;
BEGIN
  IF pg_column_size(p_state) > 16000 THEN
    RAISE EXCEPTION 'Stan jest za duży.' USING ERRCODE = '22023';
  END IF;
  UPDATE public.mavinci_online_sessions
     SET state = p_state, state_rev = state_rev + 1
   WHERE id = p_session_id AND host_user_id = auth.uid() AND status = 'open'
  RETURNING state_rev INTO v_rev;
  IF v_rev IS NULL THEN
    RAISE EXCEPTION 'Sesja nie istnieje albo jest zamknięta.' USING ERRCODE = 'P0002';
  END IF;
  PERFORM realtime.send(p_state || jsonb_build_object('rev', v_rev), 'state', 'mquiz:' || p_session_id, true);
  RETURN v_rev;
END;
$$;

CREATE OR REPLACE FUNCTION public.mavinci_online_close(p_session_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.mavinci_online_sessions
     SET status = 'closed', closed_at = now()
   WHERE id = p_session_id AND host_user_id = auth.uid() AND status = 'open';
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  PERFORM realtime.send(
    jsonb_build_object('title', 'Mavinci LIVE', 'mode', 'idle', 'answers', '[]'::jsonb, 'collecting', false,
                       'message', 'Gra zakończona. Dziękujemy!', 'closed', true),
    'state', 'mquiz:' || p_session_id, true
  );
  RETURN true;
END;
$$;

-- Zapasowy odczyt naciśnięć (gdy połączenie Realtime prowadzącego się zerwie).
CREATE OR REPLACE FUNCTION public.mavinci_online_presses_since(p_session_id uuid, p_after_id bigint DEFAULT 0)
RETURNS TABLE (id bigint, player_no integer, answer text, taps integer, pressed_at timestamptz)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT pr.id, pr.player_no, pr.answer, pr.taps, pr.pressed_at
  FROM public.mavinci_online_presses pr
  JOIN public.mavinci_online_sessions s ON s.id = pr.session_id
  WHERE pr.session_id = p_session_id
    AND s.host_user_id = auth.uid()
    AND pr.id > coalesce(p_after_id, 0)
  ORDER BY pr.id
  LIMIT 2000
$$;

CREATE OR REPLACE FUNCTION public.mavinci_online_players_list(p_session_id uuid)
RETURNS TABLE (player_no integer, name text, joined_at timestamptz)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.player_no, p.name, p.joined_at
  FROM public.mavinci_online_players p
  JOIN public.mavinci_online_sessions s ON s.id = p.session_id
  WHERE p.session_id = p_session_id AND s.host_user_id = auth.uid()
  ORDER BY p.player_no
$$;

-- ── Gracz (bez konta) ───────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.mavinci_online_join(p_code text, p_name text, p_token text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_session public.mavinci_online_sessions;
  v_player public.mavinci_online_players;
  v_name text := left(trim(coalesce(p_name, '')), 40);
  v_token text;
BEGIN
  SELECT * INTO v_session
    FROM public.mavinci_online_sessions
   WHERE code = upper(trim(coalesce(p_code, ''))) AND status = 'open' AND expires_at > now();
  IF v_session.id IS NULL THEN
    RAISE EXCEPTION 'Nie ma otwartej gry z tym kodem.' USING ERRCODE = 'P0002';
  END IF;

  -- Powrót po odświeżeniu strony: ten sam gracz, ten sam numer.
  IF p_token IS NOT NULL AND p_token <> '' THEN
    SELECT * INTO v_player FROM public.mavinci_online_players
     WHERE token_hash = public.mavinci_online_token_hash(p_token) AND session_id = v_session.id;
    IF v_player.id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'sessionId', v_session.id, 'topic', 'mquiz:' || v_session.id, 'token', p_token,
        'playerNo', v_player.player_no, 'name', v_player.name, 'state', v_session.state || jsonb_build_object('rev', v_session.state_rev)
      );
    END IF;
  END IF;

  IF v_name = '' THEN
    RAISE EXCEPTION 'Podaj imię.' USING ERRCODE = '22023';
  END IF;

  -- Numer kolejnego gracza nadajemy pod blokadą sesji, żeby dwa telefony nie dostały tego samego.
  PERFORM 1 FROM public.mavinci_online_sessions WHERE id = v_session.id FOR UPDATE;
  IF (SELECT count(*) FROM public.mavinci_online_players WHERE session_id = v_session.id) >= v_session.max_players THEN
    RAISE EXCEPTION 'Brak wolnych miejsc w tej grze.' USING ERRCODE = '53400';
  END IF;

  v_token := encode(extensions.gen_random_bytes(18), 'hex');
  INSERT INTO public.mavinci_online_players (session_id, player_no, name, token_hash)
  VALUES (
    v_session.id,
    2000 + coalesce((SELECT max(player_no) - 2000 FROM public.mavinci_online_players WHERE session_id = v_session.id), 0) + 1,
    v_name,
    public.mavinci_online_token_hash(v_token)
  )
  RETURNING * INTO v_player;

  RETURN jsonb_build_object(
    'sessionId', v_session.id, 'topic', 'mquiz:' || v_session.id, 'token', v_token,
    'playerNo', v_player.player_no, 'name', v_player.name, 'state', v_session.state || jsonb_build_object('rev', v_session.state_rev)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.mavinci_online_press(p_token text, p_answer text, p_taps integer DEFAULT 1)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_player public.mavinci_online_players;
  v_session public.mavinci_online_sessions;
  v_answer text := upper(trim(coalesce(p_answer, '')));
  v_taps integer := greatest(1, least(coalesce(p_taps, 1), 60));
BEGIN
  SELECT * INTO v_player FROM public.mavinci_online_players
   WHERE token_hash = public.mavinci_online_token_hash(p_token);
  IF v_player.id IS NULL THEN
    RAISE EXCEPTION 'Nieznany gracz — dołącz ponownie.' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO v_session FROM public.mavinci_online_sessions WHERE id = v_player.session_id;
  IF v_session.status <> 'open' OR v_session.expires_at < now() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'closed');
  END IF;
  IF v_answer NOT IN ('A', 'B', 'C', 'D', 'E', 'F', 'QUIZ') THEN
    RAISE EXCEPTION 'Nieznany przycisk.' USING ERRCODE = '22023';
  END IF;
  -- Gdy prowadzący nie zbiera odpowiedzi, naciśnięcie nie trafia do bazy.
  IF coalesce((v_session.state ->> 'collecting')::boolean, false) = false THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not-collecting');
  END IF;
  -- Ochrona przed zalewem: pojedyncze naciśnięcia nie częściej niż co 80 ms (licytacja wysyła paczki).
  IF v_player.last_press_at IS NOT NULL AND clock_timestamp() - v_player.last_press_at < interval '80 milliseconds' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'too-fast');
  END IF;

  UPDATE public.mavinci_online_players SET last_press_at = clock_timestamp() WHERE id = v_player.id;
  INSERT INTO public.mavinci_online_presses (session_id, player_id, player_no, answer, taps, state_rev)
  VALUES (v_session.id, v_player.id, v_player.player_no, v_answer, v_taps, v_session.state_rev);
  RETURN jsonb_build_object('ok', true);
END;
$$;

-- Bieżący stan dla telefonu po powrocie połączenia.
CREATE OR REPLACE FUNCTION public.mavinci_online_state(p_token text)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE WHEN s.status = 'open' AND s.expires_at > now()
              THEN s.state || jsonb_build_object('rev', s.state_rev)
              ELSE jsonb_build_object('mode', 'idle', 'answers', '[]'::jsonb, 'collecting', false,
                                      'message', 'Gra zakończona. Dziękujemy!', 'closed', true) END
  FROM public.mavinci_online_players p
  JOIN public.mavinci_online_sessions s ON s.id = p.session_id
  WHERE p.token_hash = public.mavinci_online_token_hash(p_token)
$$;

-- ── Realtime: naciśnięcia i nowi gracze → kanał prowadzącego ───────────────

CREATE OR REPLACE FUNCTION public.mavinci_online_notify_press()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM realtime.send(
    jsonb_build_object('id', NEW.id, 'playerNo', NEW.player_no, 'answer', NEW.answer, 'taps', NEW.taps,
                       'at', (extract(epoch FROM NEW.pressed_at) * 1000)::bigint),
    'press', 'mquiz-host:' || NEW.session_id, true
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS mavinci_online_presses_notify ON public.mavinci_online_presses;
CREATE TRIGGER mavinci_online_presses_notify
AFTER INSERT ON public.mavinci_online_presses
FOR EACH ROW EXECUTE FUNCTION public.mavinci_online_notify_press();

CREATE OR REPLACE FUNCTION public.mavinci_online_notify_join()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM realtime.send(
    jsonb_build_object('playerNo', NEW.player_no, 'name', NEW.name),
    'joined', 'mquiz-host:' || NEW.session_id, true
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS mavinci_online_players_notify ON public.mavinci_online_players;
CREATE TRIGGER mavinci_online_players_notify
AFTER INSERT ON public.mavinci_online_players
FOR EACH ROW EXECUTE FUNCTION public.mavinci_online_notify_join();

-- Kanały prywatne: telefon (anon) odbiera stan otwartej sesji, prowadzący — swoje naciśnięcia.
-- Nikt nie wysyła na te kanały bezpośrednio (brak polityk INSERT) — tylko realtime.send z funkcji.
-- Sprawdzenie w funkcji SECURITY DEFINER, bo anon nie widzi tabeli sesji.
CREATE OR REPLACE FUNCTION public.mavinci_online_can_receive(p_topic text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_topic LIKE 'mquiz-host:%' THEN EXISTS (
      SELECT 1 FROM public.mavinci_online_sessions s
      WHERE s.id::text = substr(p_topic, 12) AND s.host_user_id = auth.uid()
    )
    WHEN p_topic LIKE 'mquiz:%' THEN EXISTS (
      SELECT 1 FROM public.mavinci_online_sessions s
      WHERE s.id::text = substr(p_topic, 7) AND s.status = 'open'
    )
    ELSE false
  END
$$;

DROP POLICY IF EXISTS "mavinci_online_receive" ON realtime.messages;
CREATE POLICY "mavinci_online_receive" ON realtime.messages
  FOR SELECT TO anon, authenticated
  USING (
    realtime.topic() LIKE 'mquiz%'
    AND public.mavinci_online_can_receive(realtime.topic())
  );

REVOKE ALL ON FUNCTION public.mavinci_online_open(text, uuid, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mavinci_online_resume(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mavinci_online_set_state(uuid, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mavinci_online_close(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mavinci_online_presses_since(uuid, bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mavinci_online_players_list(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mavinci_online_new_code() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mavinci_online_notify_press() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mavinci_online_notify_join() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.mavinci_online_open(text, uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mavinci_online_resume(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mavinci_online_set_state(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mavinci_online_close(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mavinci_online_presses_since(uuid, bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mavinci_online_players_list(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mavinci_online_join(text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mavinci_online_press(text, text, integer) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mavinci_online_state(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mavinci_online_can_receive(text) TO anon, authenticated;
