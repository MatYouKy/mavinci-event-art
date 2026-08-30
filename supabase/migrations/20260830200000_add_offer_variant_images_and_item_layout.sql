/*
  Product variant presentation assets and per-offer-item PDF layout override.

  The product keeps its catalog default. The offer item can override it without
  mutating the catalog, so the same product may be prominent in one offer and
  compact in another.
*/

ALTER TABLE public.offer_product_variants
  ADD COLUMN IF NOT EXISTS offer_image_path text,
  ADD COLUMN IF NOT EXISTS offer_image_alt text;

ALTER TABLE public.offer_items
  ADD COLUMN IF NOT EXISTS offer_page_variant_override text;

ALTER TABLE public.offer_products
  ADD COLUMN IF NOT EXISTS product_page_url text;

ALTER TABLE public.offer_items
  DROP CONSTRAINT IF EXISTS offer_items_offer_page_variant_override_check;

ALTER TABLE public.offer_items
  ADD CONSTRAINT offer_items_offer_page_variant_override_check
  CHECK (
    offer_page_variant_override IS NULL
    OR offer_page_variant_override IN ('compact', 'default')
  );

COMMENT ON COLUMN public.offer_product_variants.offer_image_path IS
  'Storage path of the client-facing image used for this product variant.';

COMMENT ON COLUMN public.offer_items.offer_page_variant_override IS
  'Optional PDF layout override for this offer only: compact or default/full-page.';

COMMENT ON COLUMN public.offer_products.product_page_url IS
  'Full public URL of the product page on any company website.';
