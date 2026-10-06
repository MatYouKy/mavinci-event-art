-- Pending SQL execution: the data API cannot alter trigger functions.
-- Keep existing URLs when an editor changes a service name.
BEGIN;

CREATE OR REPLACE FUNCTION public.generate_slug_from_name()
RETURNS TRIGGER AS $$
BEGIN
  -- A title edit must never invalidate published URLs. Explicit slug edits remain possible.
  IF NEW.slug IS NULL OR NEW.slug = '' THEN
    NEW.slug := public.slugify(NEW.name);
    
    -- Ensure slug is unique by appending number if needed
    DECLARE
      base_slug text := NEW.slug;
      counter integer := 1;
    BEGIN
      WHILE EXISTS (
        SELECT 1 FROM public.conferences_service_items 
        WHERE slug = NEW.slug AND id != COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid)
      ) LOOP
        NEW.slug := base_slug || '-' || counter;
        counter := counter + 1;
      END LOOP;
    END;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMIT;
