/* Allow product artwork to be reduced as well as enlarged in offer layouts. */

BEGIN;

ALTER TABLE public.offer_products
  DROP CONSTRAINT IF EXISTS offer_products_offer_image_zoom_check;

ALTER TABLE public.offer_products
  ADD CONSTRAINT offer_products_offer_image_zoom_check
  CHECK (offer_image_zoom BETWEEN 0.5 AND 3);

COMMENT ON COLUMN public.offer_products.offer_image_zoom IS
  'Skala grafiki produktu w ofercie PDF (0.5-3; 1 oznacza rozmiar domyślny).';

NOTIFY pgrst, 'reload schema';

COMMIT;
