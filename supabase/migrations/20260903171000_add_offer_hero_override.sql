ALTER TABLE public.offers
  ADD COLUMN IF NOT EXISTS hero_image_path text,
  ADD COLUMN IF NOT EXISTS hero_image_alt text;

COMMENT ON COLUMN public.offers.hero_image_path IS
  'Opcjonalne zdjęcie hero konkretnej oferty. Nadpisuje zdjęcie hero kategorii szablonu.';

COMMENT ON COLUMN public.offers.hero_image_alt IS
  'Opis alternatywny indywidualnego zdjęcia hero oferty.';
