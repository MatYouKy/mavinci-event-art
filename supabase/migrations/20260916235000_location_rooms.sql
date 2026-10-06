BEGIN;
ALTER TABLE public.locations ADD COLUMN IF NOT EXISTS rooms jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS location_room_ids uuid[] NOT NULL DEFAULT '{}';
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS stage_room_id uuid;

CREATE OR REPLACE FUNCTION public.validate_location_rooms() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE room jsonb; ids uuid[] := '{}'; names text[] := '{}'; room_id uuid; room_name text;
BEGIN
  IF jsonb_typeof(NEW.rooms) <> 'array' OR jsonb_array_length(NEW.rooms) > 100 THEN
    RAISE EXCEPTION 'Lista sal musi być tablicą, maksymalnie 100 sal';
  END IF;
  FOR room IN SELECT value FROM jsonb_array_elements(NEW.rooms) LOOP
    room_id := (room->>'id')::uuid;
    room_name := btrim(room->>'name');
    IF room_id IS NULL OR room_name IS NULL OR length(room_name) NOT BETWEEN 1 AND 150
      OR length(coalesce(room->>'notes','')) > 1000 THEN
      RAISE EXCEPTION 'Sala musi mieć identyfikator i nazwę do 150 znaków; wskazówki do 1000 znaków';
    END IF;
    IF room_id = ANY(ids) OR lower(room_name) = ANY(names) THEN
      RAISE EXCEPTION 'Nazwy i identyfikatory sal w obiekcie nie mogą się powtarzać';
    END IF;
    ids := array_append(ids, room_id); names := array_append(names, lower(room_name));
  END LOOP;
  IF EXISTS (SELECT 1 FROM events e WHERE e.location_id = NEW.id AND NOT e.location_room_ids <@ ids) THEN
    RAISE EXCEPTION 'Nie można usunąć sali przypisanej do wydarzenia';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER validate_location_rooms BEFORE INSERT OR UPDATE OF rooms ON public.locations
FOR EACH ROW EXECUTE FUNCTION public.validate_location_rooms();

CREATE OR REPLACE FUNCTION public.validate_event_rooms() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE available uuid[];
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.location_id IS DISTINCT FROM OLD.location_id THEN
    NEW.location_room_ids := '{}'; NEW.stage_room_id := NULL;
  END IF;
  IF cardinality(NEW.location_room_ids) = 0 AND NEW.stage_room_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.location_id IS NULL THEN RAISE EXCEPTION 'Wybierz obiekt przed wybraniem sal'; END IF;
  -- Serialize room selection with room deletion on this location.
  PERFORM 1 FROM locations WHERE id = NEW.location_id FOR UPDATE;
  SELECT coalesce(array_agg((r->>'id')::uuid), '{}') INTO available
    FROM locations l CROSS JOIN LATERAL jsonb_array_elements(l.rooms) r WHERE l.id = NEW.location_id;
  IF array_position(NEW.location_room_ids, NULL) IS NOT NULL
    OR NOT NEW.location_room_ids <@ available
    OR cardinality(NEW.location_room_ids) <> (SELECT count(DISTINCT x) FROM unnest(NEW.location_room_ids) x) THEN
    RAISE EXCEPTION 'Wybierz różne sale należące do obiektu wydarzenia';
  END IF;
  IF NEW.stage_room_id IS NOT NULL AND NOT NEW.stage_room_id = ANY(NEW.location_room_ids) THEN
    RAISE EXCEPTION 'Scena/DJ musi znajdować się w jednej z wybranych sal';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER validate_event_rooms BEFORE INSERT OR UPDATE OF location_id, location_room_ids, stage_room_id
ON public.events FOR EACH ROW EXECUTE FUNCTION public.validate_event_rooms();
REVOKE ALL ON FUNCTION public.validate_location_rooms() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.validate_event_rooms() FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION public.reset_room_guidelines() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF ROW(NEW.location_id,NEW.location_room_ids,NEW.stage_room_id) IS DISTINCT FROM
     ROW(OLD.location_id,OLD.location_room_ids,OLD.stage_room_id) THEN
    UPDATE subcontractor_tasks SET guidelines_status='draft', confirmation_token_hash=NULL,
      confirmation_expires_at=NULL, confirmed_at=NULL, declined_at=NULL, confirmed_by_name=NULL,
      response_note=NULL, guidelines_sent_at=NULL, guidelines_sent_by=NULL, guidelines_snapshot=NULL,
      reminder_week_sent_at=NULL, reminder_day_sent_at=NULL
    WHERE event_id=NEW.id AND guidelines_status IS DISTINCT FROM 'draft';
  END IF;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.reset_room_guidelines() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER reset_room_guidelines AFTER UPDATE OF location_id, location_room_ids, stage_room_id ON public.events
FOR EACH ROW EXECUTE FUNCTION public.reset_room_guidelines();
COMMIT;
