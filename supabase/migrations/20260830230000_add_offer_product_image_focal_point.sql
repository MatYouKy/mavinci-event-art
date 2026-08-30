ALTER TABLE public.offer_products
  ADD COLUMN IF NOT EXISTS offer_image_position_x numeric(5, 2) NOT NULL DEFAULT 50
    CHECK (offer_image_position_x BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS offer_image_position_y numeric(5, 2) NOT NULL DEFAULT 25
    CHECK (offer_image_position_y BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS offer_image_zoom numeric(4, 2) NOT NULL DEFAULT 1
    CHECK (offer_image_zoom BETWEEN 1 AND 3);

COMMENT ON COLUMN public.offer_products.offer_image_position_x IS
  'Poziomy punkt kadrowania grafiki produktu w ofercie PDF (0-100%).';
COMMENT ON COLUMN public.offer_products.offer_image_position_y IS
  'Pionowy punkt kadrowania grafiki produktu w ofercie PDF (0-100%).';
COMMENT ON COLUMN public.offer_products.offer_image_zoom IS
  'Powiększenie grafiki produktu w ofercie PDF (1-3).';

NOTIFY pgrst, 'reload schema';
