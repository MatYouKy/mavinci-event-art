/*
  Per-offer control of prices displayed on a product variant comparison page.

  Pricing data remains part of the calculation. This flag controls only the
  client-facing product page in the generated PDF.
*/

ALTER TABLE public.offer_items
  ADD COLUMN IF NOT EXISTS show_variant_prices_in_pdf boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS show_product_variants_in_pdf boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.offer_items.show_variant_prices_in_pdf IS
  'Whether net and gross variant prices are displayed on the product variant page in the offer PDF.';

COMMENT ON COLUMN public.offer_items.show_product_variants_in_pdf IS
  'Whether all product variants are rendered as a comparison page; when false, the selected variant uses the regular product layout.';

ALTER TABLE public.offer_items
  DROP CONSTRAINT IF EXISTS offer_items_offer_page_variant_override_check;

ALTER TABLE public.offer_items
  ADD CONSTRAINT offer_items_offer_page_variant_override_check
  CHECK (
    offer_page_variant_override IS NULL
    OR offer_page_variant_override IN ('compact', 'default', 'visual')
  );
