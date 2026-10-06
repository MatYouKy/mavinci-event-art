-- Additive catalog fields only; existing offer pricing and equipment functions are unchanged.
BEGIN;
ALTER TABLE public.offer_products ADD COLUMN IF NOT EXISTS sales_packages jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.offer_products ADD COLUMN IF NOT EXISTS sales_packages_enabled boolean NOT NULL DEFAULT false;
NOTIFY pgrst,'reload schema';
COMMIT;
