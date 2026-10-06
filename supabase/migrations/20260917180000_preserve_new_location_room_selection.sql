BEGIN;
CREATE OR REPLACE FUNCTION public.validate_event_rooms() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE available uuid[];
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.location_id IS DISTINCT FROM OLD.location_id
    AND NEW.location_room_ids IS NOT DISTINCT FROM OLD.location_room_ids
    AND NEW.stage_room_id IS NOT DISTINCT FROM OLD.stage_room_id THEN
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
COMMIT;
