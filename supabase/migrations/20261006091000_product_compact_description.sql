BEGIN;
ALTER TABLE public.offer_products ADD COLUMN IF NOT EXISTS offer_compact_description text;
ALTER TABLE public.offer_products ADD CONSTRAINT offer_products_compact_description_length
  CHECK (offer_compact_description IS NULL OR char_length(offer_compact_description) <= 330);
COMMENT ON COLUMN public.offer_products.offer_compact_description IS
  'Opis wyłącznie dla kompaktowej karty oferty. NULL zachowuje starszy sposób skracania opisu rozszerzonego.';
COMMIT;
