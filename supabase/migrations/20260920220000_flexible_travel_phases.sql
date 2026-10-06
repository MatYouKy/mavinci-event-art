BEGIN;
-- Flexible travel stages are declarations, not dated resource bookings.
-- Keep the existing NOT NULL constraints of operational event_phases intact.
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS flexible_travel_phases jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.events ADD CONSTRAINT flexible_travel_phases_array
  CHECK (jsonb_typeof(flexible_travel_phases)='array');
CREATE OR REPLACE FUNCTION public.save_flexible_travel_phase(
  p_event_id uuid, p_key text, p_name text, p_description text DEFAULT ''
) RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE stages jsonb;
BEGIN
  IF p_key NOT IN ('outbound','inbound') OR p_key IS NULL THEN
    RAISE EXCEPTION 'Nieprawidłowy typ fazy logistycznej.' USING ERRCODE='22023';
  END IF;
  IF p_name IS NOT NULL AND (length(btrim(p_name))=0 OR length(p_name)>200 OR length(p_description)>2000) THEN
    RAISE EXCEPTION 'Uzupełnij nazwę fazy (do 200 znaków) i opis do 2000 znaków.' USING ERRCODE='22023';
  END IF;
  -- Row lock avoids losing the other direction when two editors save together.
  SELECT flexible_travel_phases INTO stages FROM public.events WHERE id=p_event_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Brak dostępu do wydarzenia.' USING ERRCODE='42501'; END IF;
  SELECT coalesce(jsonb_agg(item), '[]'::jsonb) INTO stages FROM jsonb_array_elements(stages) item
    WHERE item->>'key' IS DISTINCT FROM p_key;
  IF p_name IS NOT NULL THEN
    stages:=stages||jsonb_build_array(jsonb_build_object('key',p_key,'name',btrim(p_name),'description',coalesce(p_description,'')));
  END IF;
  UPDATE public.events SET flexible_travel_phases=stages WHERE id=p_event_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Brak uprawnień do edycji wydarzenia.' USING ERRCODE='42501'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.save_flexible_travel_phase(uuid,text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_flexible_travel_phase(uuid,text,text,text) TO authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
