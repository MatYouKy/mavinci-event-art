-- Recommendations are independent of offer_items: no pricing or reservations.
ALTER TABLE public.offers
  ADD COLUMN IF NOT EXISTS recommended_items jsonb NOT NULL DEFAULT '[]'::jsonb
  CHECK (jsonb_typeof(recommended_items) = 'array');
