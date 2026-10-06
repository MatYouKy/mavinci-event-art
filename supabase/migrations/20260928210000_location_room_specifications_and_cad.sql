-- Requires the location materials and seller hotel venue directory migrations.
-- Extends existing room.technical / location.technical_details JSON; it does not
-- rewrite saved offer snapshots or grant sellers permission to edit the directory.
BEGIN;

CREATE OR REPLACE FUNCTION public.validate_location_technical_value(details jsonb, location_id uuid)
RETURNS void LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  asset jsonb;
  field text;
  amount numeric;
BEGIN
  IF jsonb_typeof(details) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Informacje techniczne muszą być obiektem';
  END IF;

  FOREACH field IN ARRAY ARRAY['description','restrictions','difficulties','power_notes'] LOOP
    IF details ? field THEN
      IF jsonb_typeof(details->field) IS DISTINCT FROM 'string' OR length(details->>field) > 4000 THEN
        RAISE EXCEPTION 'Opisy techniczne mogą mieć do 4000 znaków';
      END IF;
    END IF;
  END LOOP;

  FOREACH field IN ARRAY ARRAY['length_m','width_m','height_m','area_m2','capacity','power_kw'] LOOP
    IF details ? field THEN
      IF jsonb_typeof(details->field) IS DISTINCT FROM 'number' THEN
        RAISE EXCEPTION 'Wymiary, powierzchnia, pojemność i moc muszą być liczbami';
      END IF;
      amount := (details->>field)::numeric;
      IF amount <= 0 OR amount > 100000 THEN
        RAISE EXCEPTION 'Wymiary, powierzchnia, pojemność i moc muszą być większe od zera i nie większe niż 100000';
      END IF;
      IF field = 'capacity' AND amount <> trunc(amount) THEN
        RAISE EXCEPTION 'Liczba osób musi być liczbą całkowitą';
      END IF;
    END IF;
  END LOOP;

  IF details ? 'power_supply' THEN
    IF jsonb_typeof(details->'power_supply') IS DISTINCT FROM 'string'
      OR details->>'power_supply' NOT IN ('available','unavailable') THEN
      RAISE EXCEPTION 'Wybierz dostępność zasilania lub pozostaw ją do potwierdzenia';
    END IF;
  END IF;
  FOREACH field IN ARRAY ARRAY['power_230v','power_400v'] LOOP
    IF details ? field AND jsonb_typeof(details->field) IS DISTINCT FROM 'boolean' THEN
      RAISE EXCEPTION 'Nieprawidłowa informacja o przyłączach';
    END IF;
  END LOOP;
  IF details->>'power_supply' = 'unavailable' AND (
    details->'power_230v' = 'true'::jsonb OR details->'power_400v' = 'true'::jsonb OR details ? 'power_kw'
  ) THEN
    RAISE EXCEPTION 'Przy braku zasilania nie podawaj dostępnych przyłączy ani mocy';
  END IF;

  IF details ? 'assets' THEN
    IF jsonb_typeof(details->'assets') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'Materiały muszą być listą';
    END IF;
    IF jsonb_array_length(details->'assets') > 30 THEN
      RAISE EXCEPTION 'Maksymalnie 30 materiałów';
    END IF;
    FOR asset IN SELECT value FROM jsonb_array_elements(details->'assets') LOOP
      IF jsonb_typeof(asset) IS DISTINCT FROM 'object'
        OR coalesce(asset->>'kind','') NOT IN ('plan','photo')
        OR jsonb_typeof(asset->'name') IS DISTINCT FROM 'string'
        OR coalesce(length(btrim(asset->>'name')),0) NOT BETWEEN 1 AND 255
        OR jsonb_typeof(asset->'path') IS DISTINCT FROM 'string'
        OR coalesce(asset->>'path','') !~ ('^' || location_id::text || '/[0-9a-f-]{36}\.(jpg|png|webp|pdf|dxf|dwg)$')
        OR (asset->>'kind' = 'photo' AND coalesce(asset->>'path','') !~ '\.(jpg|png|webp)$') THEN
        RAISE EXCEPTION 'Nieprawidłowy materiał lokalizacji. Rzuty: PDF, DXF, DWG lub zdjęcia; galeria: JPG, PNG lub WebP';
      END IF;
    END LOOP;
  END IF;
END;
$$;

-- The existing location trigger invokes the validator above for each room.
-- Keep the bucket private and retain its current file size limit (20 MB).
UPDATE storage.buckets
SET allowed_mime_types = ARRAY[
  'image/jpeg','image/png','image/webp','application/pdf','image/vnd.dxf','image/vnd.dwg'
]
WHERE id = 'location-materials';

CREATE OR REPLACE FUNCTION public.seller_hotel_material_read_access(p_name text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT auth.uid() IS NOT NULL
    AND p_name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp|pdf|dxf|dwg)$'
    AND (
      EXISTS (
        SELECT 1 FROM public.organizations org
        JOIN public.locations l ON l.id = org.location_id
        WHERE public.seller_hotel_read_access(org.id)
          AND (
            EXISTS (
              SELECT 1 FROM jsonb_array_elements(COALESCE(l.technical_details->'assets','[]'::jsonb)) a
              WHERE a->>'path' = p_name
            )
            OR EXISTS (
              SELECT 1 FROM jsonb_array_elements(l.rooms) room
              CROSS JOIN LATERAL jsonb_array_elements(COALESCE(room#>'{technical,assets}','[]'::jsonb)) a
              WHERE a->>'path' = p_name
            )
          )
      )
      OR EXISTS (
        SELECT 1 FROM public.seller_offer_arrangements a
        WHERE public.seller_arrangements_access(a.offer_id)
          AND EXISTS (
            SELECT 1 FROM jsonb_array_elements(
              COALESCE(a.venue_snapshot#>'{room,technical,assets}','[]'::jsonb)
              || COALESCE(a.venue_snapshot#>'{technical_details,assets}','[]'::jsonb)
            ) asset
            WHERE asset->>'path' = p_name
          )
      )
    );
$$;

REVOKE ALL ON FUNCTION public.seller_hotel_material_read_access(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.seller_hotel_material_read_access(text) TO authenticated;

COMMIT;
