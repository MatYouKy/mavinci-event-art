BEGIN;
ALTER TABLE public.offer_products ADD COLUMN IF NOT EXISTS related_service_ids uuid[] NOT NULL DEFAULT '{}';
COMMENT ON COLUMN public.offer_products.related_service_ids IS 'Service catalog IDs shown as public links; titles and slugs are resolved from active services_catalog entries.';
-- Explicitly requested first mapping; other products are configured independently in CRM.
DO $$
DECLARE casino_service uuid;
BEGIN
  SELECT id INTO casino_service FROM public.services_catalog WHERE slug = 'kasyno' AND is_active = true;
  IF casino_service IS NULL THEN RAISE EXCEPTION 'Brak aktywnej usługi kasyno w katalogu'; END IF;
  UPDATE public.offer_products
    SET related_service_ids = CASE WHEN casino_service = ANY(related_service_ids) THEN related_service_ids ELSE array_append(related_service_ids, casino_service) END
    WHERE id = '32072a07-439e-4942-9b97-5ea2b60e4f89';
  IF NOT FOUND THEN RAISE EXCEPTION 'Nie znaleziono produktu Strefa Kasynowa'; END IF;
END $$;
NOTIFY pgrst, 'reload schema';
COMMIT;
