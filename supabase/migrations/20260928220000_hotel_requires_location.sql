BEGIN;

-- A hotel points to one canonical locations record. Rooms and technical details
-- remain in locations; do not create copies or guess links for existing hotels.
-- NOT VALID leaves legacy unlinked hotels readable, while all new writes must
-- supply a location. The existing FK checks existence and prevents deleting a
-- hotel's location: ON DELETE SET NULL is rejected by the requirement below.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.organizations'::regclass
      AND conname = 'organizations_hotel_location_required'
  ) THEN
    ALTER TABLE public.organizations
      ADD CONSTRAINT organizations_hotel_location_required
      CHECK (business_type IS DISTINCT FROM 'hotel' OR location_id IS NOT NULL) NOT VALID;
  END IF;
END;
$$;

-- Return a readable error for API/import writes as well as the CRM form.
CREATE OR REPLACE FUNCTION public.require_hotel_location()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.business_type = 'hotel' AND NEW.location_id IS NULL THEN
    RAISE EXCEPTION 'Hotel musi być powiązany z lokalizacją. Wybierz obiekt w karcie hotelu. Nie można odłączyć ani usunąć lokalizacji używanej przez hotel.'
      USING ERRCODE = '23514', CONSTRAINT = 'organizations_hotel_location_required';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS require_hotel_location ON public.organizations;
CREATE TRIGGER require_hotel_location
  BEFORE INSERT OR UPDATE ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.require_hotel_location();

NOTIFY pgrst, 'reload schema';
COMMIT;
