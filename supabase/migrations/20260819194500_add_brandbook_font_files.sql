ALTER TABLE public.company_brandbook_fonts
  ADD COLUMN IF NOT EXISTS file_url text,
  ADD COLUMN IF NOT EXISTS storage_path text;

COMMENT ON COLUMN public.company_brandbook_fonts.file_url IS
  'Publiczny URL pliku fontu używanego przez @font-face.';
COMMENT ON COLUMN public.company_brandbook_fonts.storage_path IS
  'Ścieżka pliku fontu w bucket company-logos.';
