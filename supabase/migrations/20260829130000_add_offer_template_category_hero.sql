-- Zdjęcie przewodnie przypisane do zestawu szablonów danej kategorii wydarzenia.
ALTER TABLE public.offer_template_categories
  ADD COLUMN IF NOT EXISTS hero_image_path text,
  ADD COLUMN IF NOT EXISTS hero_image_alt text;

COMMENT ON COLUMN public.offer_template_categories.hero_image_path IS
  'Ścieżka zdjęcia hero używanego przez szablony ofert tej kategorii.';

COMMENT ON COLUMN public.offer_template_categories.hero_image_alt IS
  'Opis zdjęcia hero kategorii oferty.';
