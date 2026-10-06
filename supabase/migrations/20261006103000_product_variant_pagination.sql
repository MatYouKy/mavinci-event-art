BEGIN;
-- The editor and PDF now paginate arbitrary element lists. Package count stays at three.
DROP TRIGGER IF EXISTS trg_enforce_offer_product_variant_limit ON public.offer_product_variants;
ALTER TABLE public.offer_product_variants DROP CONSTRAINT IF EXISTS offer_product_variants_display_order_check;
ALTER TABLE public.offer_product_variants ADD CONSTRAINT offer_product_variants_display_order_check CHECK (display_order >= 0);
NOTIFY pgrst, 'reload schema';
COMMIT;
