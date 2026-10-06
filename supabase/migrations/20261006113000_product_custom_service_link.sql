BEGIN;
ALTER TABLE public.offer_products
  ADD COLUMN IF NOT EXISTS related_service_url text,
  ADD COLUMN IF NOT EXISTS related_service_label text;
COMMENT ON COLUMN public.offer_products.related_service_url IS 'Optional public Mavinci marketing page path under /oferta/ or /uslugi/.';
COMMENT ON COLUMN public.offer_products.related_service_label IS 'Optional label for the marketing page CTA on the public product card.';
COMMIT;
