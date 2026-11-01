-- Dni ustawowo wolne od pracy i wymiar czasu pracy.
--
-- 1. Lista świąt wynika z ustawy o dniach wolnych od pracy (wyliczana w bazie, także Wielkanoc i święta
--    ruchome; Wigilia od 2025 r.) i jest co tydzień porównywana ze źródłem zewnętrznym (Nager.Date,
--    date.nager.at). Gdy ustawa się zmieni, źródło zewnętrzne dopisze nowy dzień (source = 'external'),
--    a dzień, którego źródło nie potwierdza, dostaje external_confirmed = false — widać to w CRM.
-- 2. working_time_norm(rok, miesiąc) — wymiar czasu pracy pełnego etatu (art. 130 Kodeksu pracy):
--    8 h × dni od poniedziałku do piątku, minus 8 h za każde święto przypadające w inny dzień niż niedziela.
-- Plik można bezpiecznie uruchomić ponownie.
BEGIN;

CREATE TABLE IF NOT EXISTS public.public_holidays (
  country text NOT NULL DEFAULT 'PL',
  holiday_date date NOT NULL,
  name text NOT NULL,
  source text NOT NULL DEFAULT 'statute' CHECK (source IN ('statute', 'external', 'manual')),
  external_confirmed boolean,
  external_name text,
  checked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (country, holiday_date)
);
COMMENT ON TABLE public.public_holidays IS
  'Dni ustawowo wolne od pracy. source: statute – wyliczone z ustawy, external – dopisane ze źródła zewnętrznego, manual – ręcznie. external_confirmed: NULL – nie sprawdzono, true – źródło zewnętrzne potwierdza, false – brak w źródle.';

CREATE TABLE IF NOT EXISTS public.public_holiday_sync_runs (
  id bigserial PRIMARY KEY,
  country text NOT NULL DEFAULT 'PL',
  year integer NOT NULL,
  request_id bigint,
  status text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'done', 'error', 'skipped')),
  confirmed integer,
  added integer,
  missing_in_source integer,
  message text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_public_holiday_sync_runs_year ON public.public_holiday_sync_runs(country, year, requested_at DESC);

ALTER TABLE public.public_holidays ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.public_holiday_sync_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS public_holidays_read ON public.public_holidays;
CREATE POLICY public_holidays_read ON public.public_holidays FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS public_holiday_sync_runs_read ON public.public_holiday_sync_runs;
CREATE POLICY public_holiday_sync_runs_read ON public.public_holiday_sync_runs FOR SELECT TO authenticated USING (true);
REVOKE INSERT, UPDATE, DELETE ON public.public_holidays, public.public_holiday_sync_runs FROM anon, authenticated;
GRANT SELECT ON public.public_holidays, public.public_holiday_sync_runs TO authenticated;

-- Niedziela Wielkanocna (algorytm Meeusa/Jonesa/Butchera, kalendarz gregoriański).
CREATE OR REPLACE FUNCTION private.easter_sunday(p_year integer)
RETURNS date LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE SET search_path = pg_catalog AS $$
DECLARE
  a int := p_year % 19; b int := p_year / 100; c int := p_year % 100;
  d int; e int; f int; g int; h int; i int; k int; l int; m int; n int;
BEGIN
  d := b / 4; e := b % 4; f := (b + 8) / 25; g := (b - f + 1) / 3;
  h := (19 * a + b - d - g + 15) % 30; i := c / 4; k := c % 4;
  l := (32 + 2 * e + 2 * i - h - k) % 7; m := (a + 11 * h + 22 * l) / 451;
  n := h + l - 7 * m + 114;
  RETURN make_date(p_year, n / 31, n % 31 + 1);
END;
$$;

-- Dni wolne według ustawy z 18 stycznia 1951 r. o dniach wolnych od pracy (stan na 2026 r.).
CREATE OR REPLACE FUNCTION private.pl_statutory_holidays(p_year integer)
RETURNS TABLE (holiday_date date, name text)
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = pg_catalog AS $$
  WITH e AS (SELECT private.easter_sunday(p_year) AS d)
  SELECT x.dt, x.nm FROM e, LATERAL (VALUES
    (make_date(p_year, 1, 1), 'Nowy Rok', true),
    (make_date(p_year, 1, 6), 'Święto Trzech Króli', p_year >= 2011),
    (e.d, 'Wielkanoc', true),
    (e.d + 1, 'Poniedziałek Wielkanocny', true),
    (make_date(p_year, 5, 1), 'Święto Pracy', true),
    (make_date(p_year, 5, 3), 'Święto Konstytucji 3 Maja', true),
    (e.d + 49, 'Zielone Świątki', true),
    (e.d + 60, 'Boże Ciało', true),
    (make_date(p_year, 8, 15), 'Wniebowzięcie Najświętszej Maryi Panny', true),
    (make_date(p_year, 11, 1), 'Wszystkich Świętych', true),
    (make_date(p_year, 11, 11), 'Narodowe Święto Niepodległości', true),
    (make_date(p_year, 12, 24), 'Wigilia Bożego Narodzenia', p_year >= 2025),
    (make_date(p_year, 12, 25), 'Boże Narodzenie (pierwszy dzień)', true),
    (make_date(p_year, 12, 26), 'Boże Narodzenie (drugi dzień)', true)
  ) AS x(dt, nm, valid)
  WHERE x.valid
$$;

CREATE OR REPLACE FUNCTION public.seed_statutory_holidays(p_year integer)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_count integer;
BEGIN
  IF p_year NOT BETWEEN 2000 AND 2100 THEN RAISE EXCEPTION 'Nieprawidłowy rok.'; END IF;
  INSERT INTO public.public_holidays (country, holiday_date, name, source)
  SELECT 'PL', h.holiday_date, h.name, 'statute' FROM private.pl_statutory_holidays(p_year) h
  ON CONFLICT (country, holiday_date) DO UPDATE
    SET name = CASE WHEN public_holidays.source = 'manual' THEN public_holidays.name ELSE EXCLUDED.name END,
        source = CASE WHEN public_holidays.source = 'manual' THEN 'manual' ELSE 'statute' END,
        updated_at = now();
  GET DIAGNOSTICS v_count = ROW_COUNT;
  -- Dzień, który przestał wynikać z ustawy (zmiana przepisów w tej funkcji), znika — chyba że wpisano go ręcznie
  -- albo potwierdza go źródło zewnętrzne.
  DELETE FROM public.public_holidays p
  WHERE p.country = 'PL' AND p.source = 'statute' AND extract(year FROM p.holiday_date) = p_year
    AND p.external_confirmed IS DISTINCT FROM true
    AND NOT EXISTS (SELECT 1 FROM private.pl_statutory_holidays(p_year) h WHERE h.holiday_date = p.holiday_date);
  RETURN v_count;
END;
$$;

-- Prośba o listę świąt ze źródła zewnętrznego (wynik odbiera process_public_holiday_responses).
CREATE OR REPLACE FUNCTION public.request_public_holiday_refresh(p_years integer[] DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_year integer;
  v_request bigint;
  v_count integer := 0;
  v_now_year integer := extract(year FROM (now() AT TIME ZONE 'Europe/Warsaw'))::int;
BEGIN
  IF auth.role() IS NOT NULL AND auth.role() NOT IN ('service_role', 'authenticated') THEN
    RAISE EXCEPTION 'Brak uprawnień.' USING ERRCODE = '42501';
  END IF;
  FOREACH v_year IN ARRAY coalesce(p_years, ARRAY[v_now_year - 1, v_now_year, v_now_year + 1, v_now_year + 2]) LOOP
    IF v_year NOT BETWEEN v_now_year - 5 AND v_now_year + 5 THEN CONTINUE; END IF;
    PERFORM public.seed_statutory_holidays(v_year);
    -- Najwyżej jedno zapytanie na rok co 10 minut.
    IF EXISTS (SELECT 1 FROM public.public_holiday_sync_runs r
               WHERE r.country = 'PL' AND r.year = v_year AND r.requested_at > now() - interval '10 minutes') THEN
      CONTINUE;
    END IF;
    IF to_regprocedure('net.http_get(text,jsonb,jsonb,integer)') IS NULL THEN
      INSERT INTO public.public_holiday_sync_runs (year, status, message, finished_at)
      VALUES (v_year, 'skipped', 'Brak rozszerzenia pg_net — użyto tylko listy z ustawy.', now());
      CONTINUE;
    END IF;
    EXECUTE 'SELECT net.http_get(url := $1, timeout_milliseconds := 15000)'
      INTO v_request USING 'https://date.nager.at/api/v3/PublicHolidays/' || v_year || '/PL';
    INSERT INTO public.public_holiday_sync_runs (year, request_id) VALUES (v_year, v_request);
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.process_public_holiday_responses()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  r record;
  v_status integer;
  v_content text;
  v_error text;
  v_items jsonb;
  v_confirmed integer;
  v_added integer;
  v_missing integer;
  v_done integer := 0;
BEGIN
  IF to_regclass('net._http_response') IS NULL THEN RETURN 0; END IF;
  FOR r IN SELECT * FROM public.public_holiday_sync_runs WHERE status = 'requested' AND request_id IS NOT NULL ORDER BY id LOOP
    EXECUTE 'SELECT status_code, content, coalesce(error_msg, CASE WHEN timed_out THEN ''przekroczony czas'' END) FROM net._http_response WHERE id = $1'
      INTO v_status, v_content, v_error USING r.request_id;
    IF v_status IS NULL AND v_error IS NULL THEN
      IF r.requested_at < now() - interval '6 hours' THEN
        UPDATE public.public_holiday_sync_runs SET status = 'error', message = 'Brak odpowiedzi źródła zewnętrznego.', finished_at = now() WHERE id = r.id;
      END IF;
      CONTINUE;
    END IF;
    IF v_status IS DISTINCT FROM 200 THEN
      UPDATE public.public_holiday_sync_runs
      SET status = 'error', message = 'Źródło zewnętrzne: ' || coalesce(v_error, 'HTTP ' || v_status::text), finished_at = now()
      WHERE id = r.id;
      CONTINUE;
    END IF;
    BEGIN
      v_items := v_content::jsonb;
      IF jsonb_typeof(v_items) <> 'array' THEN RAISE EXCEPTION 'nieoczekiwany format'; END IF;
    EXCEPTION WHEN OTHERS THEN
      UPDATE public.public_holiday_sync_runs SET status = 'error', message = 'Źródło zewnętrzne zwróciło nieczytelne dane.', finished_at = now() WHERE id = r.id;
      CONTINUE;
    END;

    WITH src AS (
      SELECT DISTINCT ON ((i ->> 'date')::date) (i ->> 'date')::date AS d, coalesce(nullif(i ->> 'localName', ''), i ->> 'name') AS nm
      FROM jsonb_array_elements(v_items) i
      WHERE (i -> 'types') ? 'Public' AND extract(year FROM (i ->> 'date')::date) = r.year
      ORDER BY (i ->> 'date')::date
    ), upd AS (
      INSERT INTO public.public_holidays AS p (country, holiday_date, name, source, external_confirmed, external_name, checked_at)
      SELECT 'PL', src.d, src.nm, 'external', true, src.nm, now() FROM src
      ON CONFLICT (country, holiday_date) DO UPDATE
        SET external_confirmed = true, external_name = EXCLUDED.external_name, checked_at = now(), updated_at = now()
      RETURNING (xmax = 0) AS inserted
    )
    SELECT count(*) FILTER (WHERE NOT inserted), count(*) FILTER (WHERE inserted) INTO v_confirmed, v_added FROM upd;

    UPDATE public.public_holidays p SET external_confirmed = false, checked_at = now(), updated_at = now()
    WHERE p.country = 'PL' AND extract(year FROM p.holiday_date) = r.year AND p.source <> 'manual'
      AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_items) i
                      WHERE (i -> 'types') ? 'Public' AND (i ->> 'date')::date = p.holiday_date);
    GET DIAGNOSTICS v_missing = ROW_COUNT;

    UPDATE public.public_holiday_sync_runs
    SET status = 'done', confirmed = v_confirmed, added = v_added, missing_in_source = v_missing, finished_at = now(),
        message = CASE WHEN v_added > 0 OR v_missing > 0
          THEN 'Źródło zewnętrzne różni się od listy z ustawy: dopisano ' || v_added || ', niepotwierdzone ' || v_missing || '.'
          ELSE 'Zgodne z listą z ustawy.' END
    WHERE id = r.id;
    v_done := v_done + 1;
  END LOOP;
  RETURN v_done;
END;
$$;

-- Ręczny dzień wolny (np. dzień wolny w zamian za święto w sobotę — decyzja firmy) — tylko administrator.
CREATE OR REPLACE FUNCTION public.save_public_holiday(p_date date, p_name text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' AND NOT coalesce(public.is_crm_admin(), false) THEN
    RAISE EXCEPTION 'Tylko administrator może dopisać dzień wolny.' USING ERRCODE = '42501';
  END IF;
  IF nullif(btrim(p_name), '') IS NULL THEN RAISE EXCEPTION 'Podaj nazwę dnia wolnego.'; END IF;
  INSERT INTO public.public_holidays (country, holiday_date, name, source)
  VALUES ('PL', p_date, btrim(p_name), 'manual')
  ON CONFLICT (country, holiday_date) DO UPDATE SET name = EXCLUDED.name, source = 'manual', updated_at = now();
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_manual_public_holiday(p_date date)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' AND NOT coalesce(public.is_crm_admin(), false) THEN
    RAISE EXCEPTION 'Tylko administrator może usunąć dzień wolny.' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.public_holidays WHERE country = 'PL' AND holiday_date = p_date AND source = 'manual';
  PERFORM public.seed_statutory_holidays(extract(year FROM p_date)::int);
END;
$$;

-- Wymiar czasu pracy pełnego etatu w miesiącu (art. 130 KP).
CREATE OR REPLACE FUNCTION public.working_time_norm(p_year integer, p_month integer)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_from date := make_date(p_year, p_month, 1);
  v_to date := (make_date(p_year, p_month, 1) + interval '1 month - 1 day')::date;
  v_weekdays integer;
  v_holidays jsonb;
  v_reducing integer;
  v_saturday integer;
BEGIN
  IF p_month NOT BETWEEN 1 AND 12 THEN RAISE EXCEPTION 'Nieprawidłowy miesiąc.'; END IF;
  SELECT count(*) INTO v_weekdays FROM generate_series(v_from, v_to, interval '1 day') d WHERE extract(isodow FROM d) < 6;
  WITH h AS (
    SELECT p.holiday_date AS d, p.name, p.source, p.external_confirmed FROM public.public_holidays p
    WHERE p.country = 'PL' AND p.holiday_date BETWEEN v_from AND v_to
    UNION ALL
    SELECT s.holiday_date, s.name, 'statute', NULL FROM private.pl_statutory_holidays(p_year) s
    WHERE s.holiday_date BETWEEN v_from AND v_to
      AND NOT EXISTS (SELECT 1 FROM public.public_holidays p WHERE p.country = 'PL' AND extract(year FROM p.holiday_date) = p_year)
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object('date', d, 'name', name, 'weekday', extract(isodow FROM d)::int,
           'reduces_norm', extract(isodow FROM d) <> 7, 'source', source, 'external_confirmed', external_confirmed) ORDER BY d), '[]'::jsonb),
         count(*) FILTER (WHERE extract(isodow FROM d) <> 7),
         count(*) FILTER (WHERE extract(isodow FROM d) = 6)
  INTO v_holidays, v_reducing, v_saturday FROM h;
  RETURN jsonb_build_object(
    'year', p_year, 'month', p_month,
    'calendar_days', extract(day FROM v_to)::int,
    'weekdays', v_weekdays,
    'working_days', v_weekdays - v_reducing,
    'hours_full_time', 8 * (v_weekdays - v_reducing),
    'saturday_holidays', v_saturday,
    'holidays', v_holidays);
END;
$$;

REVOKE ALL ON FUNCTION private.easter_sunday(integer), private.pl_statutory_holidays(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.seed_statutory_holidays(integer), public.process_public_holiday_responses() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.seed_statutory_holidays(integer), public.process_public_holiday_responses() TO service_role;
REVOKE ALL ON FUNCTION public.request_public_holiday_refresh(integer[]), public.save_public_holiday(date, text),
  public.delete_manual_public_holiday(date), public.working_time_norm(integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_public_holiday_refresh(integer[]), public.save_public_holiday(date, text),
  public.delete_manual_public_holiday(date), public.working_time_norm(integer, integer) TO authenticated, service_role;

-- Lista z ustawy od razu na kilka lat (źródło zewnętrzne dociąga cotygodniowy harmonogram).
DO $seed$
DECLARE y integer;
BEGIN
  FOR y IN 2024 .. extract(year FROM now())::int + 3 LOOP
    PERFORM public.seed_statutory_holidays(y);
  END LOOP;
END
$seed$;

-- Harmonogram: w poniedziałki prośba do źródła zewnętrznego, co 10 minut odbiór odpowiedzi.
DO $cron$
BEGIN
  IF to_regnamespace('cron') IS NULL THEN RETURN; END IF;
  PERFORM cron.schedule('refresh-public-holidays', '7 3 * * 1', 'SELECT public.request_public_holiday_refresh(NULL)');
  PERFORM cron.schedule('process-public-holiday-responses', '*/10 * * * *', 'SELECT public.process_public_holiday_responses()');
  PERFORM public.request_public_holiday_refresh(NULL); -- pierwsze porównanie ze źródłem zewnętrznym od razu
END
$cron$;

NOTIFY pgrst, 'reload schema';

COMMIT;
