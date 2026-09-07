/*
  Publiczny, bezpieczny odczyt motywu marki.

  Funkcja udostępnia wyłącznie kolory i publiczny adres fontu domyślnej firmy.
  Nie zwraca danych księgowych ani kontaktowych. Dzięki temu CRM i publiczna
  część serwisu korzystają z jednego brandbooka.
*/

CREATE OR REPLACE FUNCTION public.get_public_brand_theme()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH selected_company AS (
    SELECT id
    FROM public.my_companies
    WHERE is_active = true
    ORDER BY is_default DESC, created_at ASC
    LIMIT 1
  ),
  heading_font AS (
    SELECT
      NULLIF(TRIM(font.family), '') AS family,
      NULLIF(TRIM(font.weight), '') AS weight,
      NULLIF(TRIM(font.file_url), '') AS file_url
    FROM public.company_brandbook_fonts font
    JOIN selected_company company ON company.id = font.company_id
    WHERE LOWER(COALESCE(font.role, '')) = 'heading'
       OR LOWER(COALESCE(font.family, '')) LIKE '%atom%'
       OR LOWER(COALESCE(font.label, '')) LIKE '%atom%'
    ORDER BY
      CASE WHEN LOWER(COALESCE(font.family, '')) LIKE '%atom%'
             OR LOWER(COALESCE(font.label, '')) LIKE '%atom%' THEN 0 ELSE 1 END,
      font.order_index,
      font.created_at
    LIMIT 1
  ),
  palette AS (
    SELECT COALESCE(
      jsonb_object_agg(LOWER(COALESCE(color.role, 'other')), color.hex ORDER BY color.order_index),
      '{}'::jsonb
    ) AS colors
    FROM public.company_brandbook_colors color
    JOIN selected_company company ON company.id = color.company_id
  )
  SELECT jsonb_build_object(
    'heading_font_family', COALESCE((SELECT family FROM heading_font), 'Atom'),
    'heading_font_weight', COALESCE((SELECT weight FROM heading_font), '400'),
    'heading_font_url', COALESCE((SELECT file_url FROM heading_font), ''),
    'colors', COALESCE((SELECT colors FROM palette), '{}'::jsonb)
  );
$$;

REVOKE ALL ON FUNCTION public.get_public_brand_theme() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_brand_theme() TO anon, authenticated;

COMMENT ON FUNCTION public.get_public_brand_theme() IS
  'Zwraca niesensytywne elementy aktywnego brandbooka używane przez motyw CRM i strony publicznej.';
