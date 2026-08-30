ALTER TABLE public.offer_template_categories
  ADD COLUMN IF NOT EXISTS design_config jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.offer_template_categories.design_config IS
  'Ustawienia kreatora wyglądu ofert dla kategorii: kolory, hero, logo, założenia, produkty i wycena.';
