-- Remove the application-specific domain count limit. Keep DNS format validation.
CREATE OR REPLACE FUNCTION public.valid_correspondence_domains(domains text[])
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
 SELECT NOT EXISTS (
   SELECT 1 FROM unnest(domains) d WHERE d IS NULL OR length(d) > 253
     OR d <> lower(d) OR d !~ '^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$'
 );
$$;
