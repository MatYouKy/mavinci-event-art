-- Tryb testowy „widok jako” — administrator ogląda CRM (albo portal sprzedawcy) oczami wybranej osoby
-- ===============================================================================================================
-- Można uruchomić ponownie. Opis: docs/test-mode.md.
--
-- Przebieg (serwer CRM, `src/lib/testMode/*`, trasy `/bridge/test-mode/*`):
--   1. Administrator wybiera osobę (Ustawienia → „Tryb testowy”: `test_mode_targets`). Serwer sprawdza go (`test_mode_prepare`),
--      otwiera w tle sesję tej osoby (link logowania wygenerowany na serwerze — bez e-maila) i zapisuje ją zaszyfrowaną
--      kluczem, który zna tylko przeglądarka administratora (`test_mode_open`).
--   2. Przeglądarka dostaje sesję zastępczą (bez prawdziwego klucza osoby); każde zapytanie do bazy idzie przez serwer CRM,
--      który podstawia klucz osoby. Odczyt — jak u tej osoby (RLS, funkcje). Zapis — wykonuje się jako ta osoba i jest
--      wycofywany (PostgREST `Prefer: tx=rollback`): baza sprawdza uprawnienia i walidacje, ale nic nie zostaje.
--      Przed otwarciem sesji serwer sprawdza, że baza naprawdę wycofuje zapis (`test_mode_probe` / `test_mode_probe_take`).
--   3. „Wyjdź z trybu” (`test_mode_close`): sesja osoby jest unieważniana (`auth.sessions`), wraca sesja administratora.
-- Każde wejście zostaje w dzienniku (`test_mode_history` — kto, kogo, kiedy, jak zakończono).
--
-- Kogo można oglądać: aktywnych pracowników z kontem logowania (bez administratorów i bez siebie) oraz sprzedawców
-- zewnętrznych z włączonym portalem. Funkcje serwera (`test_mode_prepare`, `_open`, `_get`, `_store`, `_touch`, `_close`,
-- `_close_expired`, `_probe`, `_probe_take`) — tylko klucz serwisowy; lista osób i dziennik — tylko administrator.

BEGIN;

CREATE TABLE IF NOT EXISTS private.test_mode_sessions (
  id uuid PRIMARY KEY,
  secret_hash text NOT NULL,
  admin_auth_user_id uuid NOT NULL,
  admin_employee_id uuid,
  target_kind text NOT NULL CHECK (target_kind IN ('employee', 'seller')),
  target_ref_id uuid NOT NULL,
  target_auth_user_id uuid NOT NULL,
  target_label text NOT NULL,
  -- Sesja logowania osoby otwarta na czas testu (`auth.sessions.id`) — usuwana przy wyjściu.
  target_auth_session_id uuid,
  -- Zaszyfrowane przez serwer CRM (AES-GCM, klucz z sekretu w przeglądarce administratora): klucze sesji osoby, jej profil
  -- logowania i sesja administratora do przywrócenia. Po zakończeniu — NULL.
  payload text,
  payload_version integer NOT NULL DEFAULT 0,
  user_agent text,
  started_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  last_seen_at timestamptz,
  ended_at timestamptz,
  end_reason text
);
CREATE INDEX IF NOT EXISTS test_mode_sessions_open ON private.test_mode_sessions (admin_auth_user_id) WHERE ended_at IS NULL;
CREATE INDEX IF NOT EXISTS test_mode_sessions_started ON private.test_mode_sessions (started_at DESC);

-- Próba „zapis wycofany”: wiersz wstawiony w żądaniu z `Prefer: tx=rollback` nie może zostać w tabeli.
CREATE TABLE IF NOT EXISTS private.test_mode_probes (
  token uuid PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);

REVOKE ALL ON private.test_mode_sessions, private.test_mode_probes FROM PUBLIC, anon, authenticated;

-- ─── Kto ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

-- Pracownik-administrator o tym koncie logowania (jak w `rental_access`: rola, poziom dostępu albo uprawnienie „admin”).
CREATE OR REPLACE FUNCTION private.test_mode_admin_employee(p_auth uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT e.id FROM public.employees e
   WHERE p_auth IS NOT NULL AND e.is_active AND e.auth_user_id = p_auth
     AND (coalesce(e.role::text = 'admin', false) OR coalesce(e.access_level::text = 'admin', false)
          OR 'admin' = ANY (coalesce(e.permissions, '{}'::text[])))
   ORDER BY e.id
   LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION private.test_mode_is_admin_employee(p_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT EXISTS (SELECT 1 FROM public.employees e WHERE e.id = p_id
    AND (coalesce(e.role::text = 'admin', false) OR coalesce(e.access_level::text = 'admin', false)
         OR 'admin' = ANY (coalesce(e.permissions, '{}'::text[]))));
$$;

-- Osoby do wyboru w Ustawieniach → „Tryb testowy” (tylko administrator): pracownicy i sprzedawcy zewnętrzni.
CREATE OR REPLACE FUNCTION public.test_mode_targets()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_admin uuid := private.test_mode_admin_employee(auth.uid());
BEGIN
  IF v_admin IS NULL THEN RAISE EXCEPTION 'Tryb testowy jest dostępny tylko dla administratora.' USING ERRCODE = '42501'; END IF;
  RETURN jsonb_build_object(
    'employees', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
               'kind', 'employee', 'id', e.id,
               'name', nullif(btrim(concat_ws(' ', e.name, e.surname)), ''),
               'nickname', e.nickname, 'avatar_url', e.avatar_url, 'occupation', e.occupation,
               'department', e.department, 'role', e.role::text,
               'access_level', coalesce(al.name, e.access_level::text),
               'permissions', cardinality(coalesce(e.permissions, '{}'::text[])))
             ORDER BY e.name, e.surname), '[]'::jsonb)
        FROM public.employees e
        LEFT JOIN public.access_levels al ON al.id = e.access_level_id
       WHERE e.is_active AND e.auth_user_id IS NOT NULL AND e.id <> v_admin
         AND NOT private.test_mode_is_admin_employee(e.id)),
    'sellers', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
               'kind', 'seller', 'id', p.id,
               'name', coalesce(nullif(btrim(coalesce(c.full_name, concat_ws(' ', c.first_name, c.last_name))), ''), 'Sprzedawca'),
               'organization', g.name, 'partner_type', p.partner_type, 'status', p.status)
             ORDER BY coalesce(c.full_name, c.last_name)), '[]'::jsonb)
        FROM public.sales_partner_profiles p
        JOIN public.contacts c ON c.id = p.contact_id
        LEFT JOIN public.organizations g ON g.id = p.organization_id
       WHERE p.portal_enabled AND p.portal_auth_user_id IS NOT NULL));
END $$;

-- Dziennik wejść (tylko administrator): ostatnie sesje testowe wszystkich administratorów.
CREATE OR REPLACE FUNCTION public.test_mode_history(p_limit integer DEFAULT 20)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF private.test_mode_admin_employee(auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'Tryb testowy jest dostępny tylko dla administratora.' USING ERRCODE = '42501';
  END IF;
  RETURN (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
             'id', s.id, 'admin', nullif(btrim(concat_ws(' ', e.name, e.surname)), ''), 'kind', s.target_kind,
             'target', s.target_label, 'started_at', s.started_at, 'ended_at', s.ended_at, 'end_reason', s.end_reason,
             'active', s.ended_at IS NULL AND s.expires_at > now())
           ORDER BY s.started_at DESC), '[]'::jsonb)
      FROM (SELECT * FROM private.test_mode_sessions ORDER BY started_at DESC LIMIT least(greatest(coalesce(p_limit, 20), 1), 100)) s
      LEFT JOIN public.employees e ON e.id = s.admin_employee_id);
END $$;

-- ─── Serwer CRM (klucz serwisowy) ────────────────────────────────────────────────────────────────────────────────────

-- Sprawdzenie przed otwarciem: administrator (konto z sesji przeglądarki) i osoba do oglądania.
CREATE OR REPLACE FUNCTION public.test_mode_prepare(p_admin_auth uuid, p_kind text, p_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_admin uuid := private.test_mode_admin_employee(p_admin_auth); v_auth uuid; v_label text;
BEGIN
  IF v_admin IS NULL THEN RAISE EXCEPTION 'Tryb testowy jest dostępny tylko dla administratora.' USING ERRCODE = '42501'; END IF;
  IF p_kind = 'employee' THEN
    SELECT e.auth_user_id,
           concat_ws(' · ', nullif(btrim(concat_ws(' ', e.name, e.surname)), ''), coalesce(al.name, e.access_level::text, e.role::text))
      INTO v_auth, v_label
      FROM public.employees e LEFT JOIN public.access_levels al ON al.id = e.access_level_id
     WHERE e.id = p_id AND e.is_active AND e.auth_user_id IS NOT NULL;
    IF v_auth IS NULL THEN RAISE EXCEPTION 'Nie znaleziono aktywnego pracownika z kontem logowania.' USING ERRCODE = '22023'; END IF;
    IF p_id = v_admin OR private.test_mode_is_admin_employee(p_id) THEN
      RAISE EXCEPTION 'Widoku administratora nie trzeba testować — wybierz innego pracownika.' USING ERRCODE = '22023';
    END IF;
  ELSIF p_kind = 'seller' THEN
    SELECT p.portal_auth_user_id,
           concat_ws(' · ', coalesce(nullif(btrim(coalesce(c.full_name, concat_ws(' ', c.first_name, c.last_name))), ''), 'Sprzedawca'),
                     'sprzedawca zewnętrzny')
      INTO v_auth, v_label
      FROM public.sales_partner_profiles p JOIN public.contacts c ON c.id = p.contact_id
     WHERE p.id = p_id AND p.portal_enabled AND p.portal_auth_user_id IS NOT NULL;
    IF v_auth IS NULL THEN RAISE EXCEPTION 'Nie znaleziono sprzedawcy z włączonym portalem.' USING ERRCODE = '22023'; END IF;
  ELSE
    RAISE EXCEPTION 'Nieprawidłowy rodzaj osoby.' USING ERRCODE = '22023';
  END IF;
  IF v_auth = p_admin_auth THEN RAISE EXCEPTION 'To Twoje konto.' USING ERRCODE = '22023'; END IF;
  RETURN jsonb_build_object('admin_employee_id', v_admin, 'target_auth_user_id', v_auth, 'label', left(v_label, 200),
    'landing', CASE WHEN p_kind = 'seller' THEN '/seller' ELSE '/crm' END);
END $$;

-- Usunięcie sesji logowania osoby otwartej na czas testu (tylko ta jedna sesja; prawdziwe logowania osoby zostają).
CREATE OR REPLACE FUNCTION private.test_mode_revoke(p_session uuid, p_user uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF p_session IS NULL OR p_user IS NULL THEN RETURN; END IF;
  DELETE FROM auth.sessions WHERE id = p_session AND user_id = p_user;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Tryb testowy: nie udało się usunąć sesji testowej: %', SQLERRM;
END $$;

-- Zamknięcie wygasłych sesji testowych (przy każdym nowym wejściu). Dane zaszyfrowane zostają jeszcze dobę — „Wyjdź z trybu”
-- po wygaśnięciu przywróci sesję administratora (klucze oglądanej osoby są już wtedy unieważnione).
CREATE OR REPLACE FUNCTION public.test_mode_close_expired()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE r record; v_count integer := 0;
BEGIN
  FOR r IN SELECT * FROM private.test_mode_sessions WHERE ended_at IS NULL AND expires_at <= now() FOR UPDATE SKIP LOCKED LOOP
    PERFORM private.test_mode_revoke(r.target_auth_session_id, r.target_auth_user_id);
    UPDATE private.test_mode_sessions SET ended_at = now(), end_reason = 'expired' WHERE id = r.id;
    v_count := v_count + 1;
  END LOOP;
  UPDATE private.test_mode_sessions SET payload = NULL
   WHERE payload IS NOT NULL AND ended_at IS NOT NULL AND ended_at < now() - interval '1 day';
  RETURN v_count;
END $$;

-- Nowa sesja testowa; poprzednie otwarte sesje tego administratora są zamykane (jedna naraz).
CREATE OR REPLACE FUNCTION public.test_mode_open(
  p_id uuid, p_secret_hash text, p_admin_auth uuid, p_admin_employee uuid, p_kind text, p_ref uuid, p_target_auth uuid,
  p_label text, p_auth_session uuid, p_payload text, p_expires_at timestamptz, p_user_agent text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE r record;
BEGIN
  IF private.test_mode_admin_employee(p_admin_auth) IS DISTINCT FROM p_admin_employee THEN
    RAISE EXCEPTION 'Tryb testowy jest dostępny tylko dla administratora.' USING ERRCODE = '42501';
  END IF;
  IF p_expires_at IS NULL OR p_expires_at <= now() OR p_expires_at > now() + interval '12 hours' THEN
    RAISE EXCEPTION 'Nieprawidłowy czas sesji testowej.' USING ERRCODE = '22023';
  END IF;
  FOR r IN SELECT * FROM private.test_mode_sessions WHERE admin_auth_user_id = p_admin_auth AND ended_at IS NULL FOR UPDATE LOOP
    PERFORM private.test_mode_revoke(r.target_auth_session_id, r.target_auth_user_id);
    UPDATE private.test_mode_sessions SET ended_at = now(), end_reason = 'replaced', payload = NULL WHERE id = r.id;
  END LOOP;
  INSERT INTO private.test_mode_sessions(id, secret_hash, admin_auth_user_id, admin_employee_id, target_kind, target_ref_id,
    target_auth_user_id, target_label, target_auth_session_id, payload, expires_at, user_agent, last_seen_at)
  VALUES (p_id, p_secret_hash, p_admin_auth, p_admin_employee, p_kind, p_ref, p_target_auth, left(p_label, 200), p_auth_session,
    p_payload, p_expires_at, left(p_user_agent, 300), now());
  RETURN p_id;
END $$;

-- Sesja do obsługi żądania (serwer porównuje skrót sekretu i odszyfrowuje dane).
CREATE OR REPLACE FUNCTION public.test_mode_get(p_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT jsonb_build_object('id', s.id, 'secret_hash', s.secret_hash, 'payload', s.payload, 'version', s.payload_version,
           'kind', s.target_kind, 'ref_id', s.target_ref_id, 'target_auth_user_id', s.target_auth_user_id, 'label', s.target_label,
           'admin_auth_user_id', s.admin_auth_user_id, 'expires_at', s.expires_at, 'ended_at', s.ended_at,
           'active', s.ended_at IS NULL AND s.expires_at > now())
    FROM private.test_mode_sessions s WHERE s.id = p_id;
$$;

-- Nowe klucze sesji osoby po odświeżeniu (zapis tylko z aktualnej wersji — dwa równoległe odświeżenia się nie nadpiszą).
CREATE OR REPLACE FUNCTION public.test_mode_store(p_id uuid, p_version integer, p_payload text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  UPDATE private.test_mode_sessions SET payload = p_payload, payload_version = payload_version + 1, last_seen_at = now()
   WHERE id = p_id AND payload_version = p_version AND ended_at IS NULL AND expires_at > now();
  RETURN FOUND;
END $$;

CREATE OR REPLACE FUNCTION public.test_mode_touch(p_id uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  UPDATE private.test_mode_sessions SET last_seen_at = now() WHERE id = p_id AND ended_at IS NULL;
$$;

-- Wyjście z trybu (albo zakończenie po błędzie): sesja osoby unieważniona, dane zaszyfrowane usunięte.
CREATE OR REPLACE FUNCTION public.test_mode_close(p_id uuid, p_reason text DEFAULT 'exit')
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE r private.test_mode_sessions%ROWTYPE;
BEGIN
  SELECT * INTO r FROM private.test_mode_sessions WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  PERFORM private.test_mode_revoke(r.target_auth_session_id, r.target_auth_user_id);
  UPDATE private.test_mode_sessions
     SET ended_at = coalesce(ended_at, now()), end_reason = coalesce(end_reason, left(coalesce(p_reason, 'exit'), 40)), payload = NULL
   WHERE id = p_id;
  RETURN r.ended_at IS NULL;
END $$;

-- Próba wycofania zapisu: wstawienie wiersza (wywoływane z `Prefer: tx=rollback`) i sprawdzenie, czy go nie ma.
CREATE OR REPLACE FUNCTION public.test_mode_probe(p_token uuid)
RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  INSERT INTO private.test_mode_probes(token) VALUES (p_token) RETURNING token;
$$;

CREATE OR REPLACE FUNCTION public.test_mode_probe_take(p_token uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  WITH gone AS (DELETE FROM private.test_mode_probes WHERE token = p_token OR created_at < now() - interval '1 day' RETURNING token)
  SELECT EXISTS (SELECT 1 FROM gone WHERE token = p_token);
$$;

-- ─── Uprawnienia ─────────────────────────────────────────────────────────────────────────────────────────────────────

REVOKE ALL ON FUNCTION
  private.test_mode_admin_employee(uuid), private.test_mode_is_admin_employee(uuid), private.test_mode_revoke(uuid, uuid)
FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION
  public.test_mode_targets(), public.test_mode_history(integer), public.test_mode_prepare(uuid, text, uuid),
  public.test_mode_close_expired(),
  public.test_mode_open(uuid, text, uuid, uuid, text, uuid, uuid, text, uuid, text, timestamptz, text),
  public.test_mode_get(uuid), public.test_mode_store(uuid, integer, text), public.test_mode_touch(uuid),
  public.test_mode_close(uuid, text), public.test_mode_probe(uuid), public.test_mode_probe_take(uuid)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.test_mode_targets(), public.test_mode_history(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION
  public.test_mode_prepare(uuid, text, uuid), public.test_mode_close_expired(),
  public.test_mode_open(uuid, text, uuid, uuid, text, uuid, uuid, text, uuid, text, timestamptz, text),
  public.test_mode_get(uuid), public.test_mode_store(uuid, integer, text), public.test_mode_touch(uuid),
  public.test_mode_close(uuid, text), public.test_mode_probe(uuid), public.test_mode_probe_take(uuid)
TO service_role;

COMMIT;
