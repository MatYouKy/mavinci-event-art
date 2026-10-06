BEGIN;
ALTER TABLE public.locations ADD COLUMN IF NOT EXISTS technical_details jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE OR REPLACE FUNCTION public.validate_location_technical_value(details jsonb, location_id uuid)
RETURNS void LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE asset jsonb; field text;
BEGIN
  IF jsonb_typeof(details) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Informacje techniczne muszą być obiektem'; END IF;
  FOREACH field IN ARRAY ARRAY['description','restrictions','difficulties'] LOOP
    IF details ? field AND (jsonb_typeof(details->field) <> 'string' OR length(details->>field) > 4000) THEN
      RAISE EXCEPTION 'Opis, ograniczenia i utrudnienia mogą mieć do 4000 znaków';
    END IF;
  END LOOP;
  IF details ? 'assets' THEN
    IF jsonb_typeof(details->'assets') <> 'array' THEN RAISE EXCEPTION 'Materiały muszą być listą'; END IF;
    IF jsonb_array_length(details->'assets') > 30 THEN RAISE EXCEPTION 'Maksymalnie 30 materiałów'; END IF;
    FOR asset IN SELECT value FROM jsonb_array_elements(details->'assets') LOOP
      IF jsonb_typeof(asset) IS DISTINCT FROM 'object'
        OR coalesce(asset->>'kind','') NOT IN ('plan','photo')
        OR coalesce(length(asset->>'name'),0) NOT BETWEEN 1 AND 255
        OR coalesce(asset->>'path','') !~ ('^' || location_id::text || '/[0-9a-f-]{36}\.(jpg|png|webp|pdf)$')
        OR (asset->>'kind' = 'photo' AND asset->>'path' LIKE '%.pdf') THEN
        RAISE EXCEPTION 'Nieprawidłowy materiał lokalizacji';
      END IF;
    END LOOP;
  END IF;
END; $$;
CREATE OR REPLACE FUNCTION public.validate_location_technical_details()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE room jsonb;
BEGIN
  PERFORM public.validate_location_technical_value(NEW.technical_details, NEW.id);
  FOR room IN SELECT value FROM jsonb_array_elements(NEW.rooms) LOOP
    IF room ? 'technical' THEN PERFORM public.validate_location_technical_value(room->'technical', NEW.id); END IF;
  END LOOP;
  RETURN NEW;
END; $$;
CREATE TRIGGER validate_location_technical_details BEFORE INSERT OR UPDATE OF technical_details, rooms
ON public.locations FOR EACH ROW EXECUTE FUNCTION public.validate_location_technical_details();

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('location-materials','location-materials',false,20971520,ARRAY['image/jpeg','image/png','image/webp','application/pdf'])
ON CONFLICT (id) DO NOTHING;
CREATE POLICY "Location materials view" ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'location-materials' AND EXISTS (
  SELECT 1 FROM public.locations l WHERE l.id::text = (storage.foldername(name))[1]
));
CREATE POLICY "Location materials insert" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'location-materials' AND EXISTS (
  SELECT 1 FROM public.locations l WHERE l.id::text = (storage.foldername(name))[1]
) AND EXISTS (
  SELECT 1 FROM public.employees e WHERE e.id = auth.uid()
  AND ('admin' = ANY(e.permissions) OR 'locations_manage' = ANY(e.permissions))
));
CREATE POLICY "Location materials delete" ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'location-materials' AND EXISTS (
  SELECT 1 FROM public.locations l WHERE l.id::text = (storage.foldername(name))[1]
) AND EXISTS (
  SELECT 1 FROM public.employees e WHERE e.id = auth.uid()
  AND ('admin' = ANY(e.permissions) OR 'locations_manage' = ANY(e.permissions))
));
COMMIT;
