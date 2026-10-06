BEGIN;

-- Additive validation: keep the existing dimensions, materials and CAD rules.
-- All power details remain in locations.rooms[].technical / technical_details.
-- Existing general power_notes and historical offer snapshots are not rewritten.
CREATE OR REPLACE FUNCTION public.validate_location_power_connection_details(details jsonb)
RETURNS void LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  point jsonb;
  amount numeric;
  field text;
BEGIN
  IF jsonb_typeof(details) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Informacje techniczne muszą być obiektem';
  END IF;
  IF details ? 'power_230v_notes' THEN
    IF jsonb_typeof(details->'power_230v_notes') IS DISTINCT FROM 'string'
      OR length(details->>'power_230v_notes') > 4000 THEN
      RAISE EXCEPTION 'Opis gniazd 230 V może mieć do 4000 znaków';
    END IF;
  END IF;
  IF NOT (details ? 'power_400v_points') THEN RETURN; END IF;
  IF jsonb_typeof(details->'power_400v_points') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Przyłącza 400 V muszą być listą';
  END IF;
  IF jsonb_array_length(details->'power_400v_points') > 20 THEN
    RAISE EXCEPTION 'Możesz opisać maksymalnie 20 punktów lub grup przyłączy 400 V';
  END IF;
  IF jsonb_array_length(details->'power_400v_points') > 0
    AND (details->>'power_supply' = 'unavailable' OR details->'power_400v' = 'false'::jsonb) THEN
    RAISE EXCEPTION 'Przy braku przyłączy 400 V usuń ich listę albo popraw oznaczenie dostępności';
  END IF;
  FOR point IN SELECT value FROM jsonb_array_elements(details->'power_400v_points') LOOP
    IF jsonb_typeof(point) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'Nieprawidłowe dane przyłącza 400 V';
    END IF;
    IF jsonb_typeof(point->'id') IS DISTINCT FROM 'string'
      OR coalesce(point->>'id','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION 'Nieprawidłowy identyfikator przyłącza 400 V';
    END IF;
    IF jsonb_typeof(point->'position') IS DISTINCT FROM 'string'
      OR coalesce(length(btrim(point->>'position')),0) NOT BETWEEN 1 AND 1000 THEN
      RAISE EXCEPTION 'Podaj miejsce przyłącza 400 V (do 1000 znaków)';
    END IF;
    IF point ? 'connector' THEN
      IF jsonb_typeof(point->'connector') IS DISTINCT FROM 'string' OR length(point->>'connector') > 200 THEN
        RAISE EXCEPTION 'Opis złącza może mieć do 200 znaków';
      END IF;
    END IF;
    IF point ? 'notes' THEN
      IF jsonb_typeof(point->'notes') IS DISTINCT FROM 'string' OR length(point->>'notes') > 2000 THEN
        RAISE EXCEPTION 'Uwagi do przyłącza mogą mieć do 2000 znaków';
      END IF;
    END IF;
    IF point ? 'rating_a' THEN
      IF point->'rating_a' NOT IN ('16'::jsonb,'32'::jsonb,'63'::jsonb,'"other"'::jsonb) THEN
        RAISE EXCEPTION 'Wybierz 16, 32, 63 A albo inne złącze';
      END IF;
      IF point->>'rating_a' = 'other' AND coalesce(length(btrim(point->>'connector')),0) = 0 THEN
        RAISE EXCEPTION 'Dla innego złącza podaj amperaż i rodzaj w opisie';
      END IF;
    END IF;
    FOREACH field IN ARRAY ARRAY['quantity','distance_to_stage_m'] LOOP
      IF point ? field THEN
        IF jsonb_typeof(point->field) IS DISTINCT FROM 'number' THEN
          RAISE EXCEPTION 'Liczba gniazd i odległość muszą być liczbami';
        END IF;
        amount := (point->>field)::numeric;
        IF field = 'quantity' AND (amount < 1 OR amount > 1000 OR amount <> trunc(amount)) THEN
          RAISE EXCEPTION 'Liczba gniazd musi być liczbą całkowitą od 1 do 1000';
        END IF;
        IF field = 'distance_to_stage_m' AND (amount < 0 OR amount > 10000) THEN
          RAISE EXCEPTION 'Odległość od sceny musi mieścić się w zakresie od 0 do 10000 metrów';
        END IF;
      END IF;
    END LOOP;
  END LOOP;
  IF (SELECT count(*) <> count(DISTINCT item->>'id')
    FROM jsonb_array_elements(details->'power_400v_points') item) THEN
    RAISE EXCEPTION 'Przyłącza 400 V nie mogą mieć powtórzonych identyfikatorów';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_location_technical_details()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE room jsonb;
BEGIN
  PERFORM public.validate_location_technical_value(NEW.technical_details, NEW.id);
  PERFORM public.validate_location_power_connection_details(NEW.technical_details);
  FOR room IN SELECT value FROM jsonb_array_elements(NEW.rooms) LOOP
    IF room ? 'technical' THEN
      PERFORM public.validate_location_technical_value(room->'technical', NEW.id);
      PERFORM public.validate_location_power_connection_details(room->'technical');
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;

COMMIT;
