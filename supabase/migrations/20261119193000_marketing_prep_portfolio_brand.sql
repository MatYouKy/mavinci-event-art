-- Marketing → przygotowanie pod „Social media” (Etap 0).
-- 1. Realizacje na stronie (portfolio) i zdjęcia nagłówków stron „Portfolio” i „Zespół”: zapis tylko dla osób, które
--    mogą edytować stronę (`can_edit_website()`: administrator albo uprawnienie `website_edit` / `page_manage`, nigdy konto
--    sprzedawcy z portalu) — jak pozostałe tabele `*_page_images` (polityka `website_editors_write`). Dotąd każdy zalogowany
--    (także sprzedawca z portalu) mógł dodawać, zmieniać i usuwać realizacje. Odczyt publiczny bez zmian.
-- 2. Księga znaku Mavinci: paleta marki z księgi znaku (bordo, złoto, grafit, granat, piasek) i „ciepła biel” z szablonu
--    postów. Rola `neutral` — dokumenty, broszury, stopki i ikona aplikacji (role primary / secondary / accent) bez zmian.
--    Szablony grafik social media wskazują te kolory po identyfikatorze (bez kolorów w kodzie).
-- Plik idempotentny — można go wykonać ponownie.

-- 1. Realizacje i zdjęcia nagłówków ------------------------------------------------------------------------------------

DROP POLICY IF EXISTS "Authenticated users can manage portfolio projects" ON public.portfolio_projects;
DROP POLICY IF EXISTS website_editors_write ON public.portfolio_projects;
CREATE POLICY website_editors_write ON public.portfolio_projects
  FOR ALL TO authenticated
  USING (public.can_edit_website())
  WITH CHECK (public.can_edit_website());

DROP POLICY IF EXISTS "Authenticated users can insert project features" ON public.portfolio_project_features;
DROP POLICY IF EXISTS "Authenticated users can update project features" ON public.portfolio_project_features;
DROP POLICY IF EXISTS "Authenticated users can delete project features" ON public.portfolio_project_features;
DROP POLICY IF EXISTS website_editors_write ON public.portfolio_project_features;
CREATE POLICY website_editors_write ON public.portfolio_project_features
  FOR ALL TO authenticated
  USING (public.can_edit_website())
  WITH CHECK (public.can_edit_website());

DROP POLICY IF EXISTS "Allow authenticated users to insert portfolio page images" ON public.portfolio_page_images;
DROP POLICY IF EXISTS "Allow authenticated users to update portfolio page images" ON public.portfolio_page_images;
DROP POLICY IF EXISTS "Allow authenticated users to delete portfolio page images" ON public.portfolio_page_images;
DROP POLICY IF EXISTS website_editors_write ON public.portfolio_page_images;
CREATE POLICY website_editors_write ON public.portfolio_page_images
  FOR ALL TO authenticated
  USING (public.can_edit_website())
  WITH CHECK (public.can_edit_website());

DROP POLICY IF EXISTS "Authenticated users with website_edit can insert team page imag" ON public.team_page_images;
DROP POLICY IF EXISTS "Authenticated users with website_edit can update team page imag" ON public.team_page_images;
DROP POLICY IF EXISTS "Authenticated users with website_edit can delete team page imag" ON public.team_page_images;
DROP POLICY IF EXISTS website_editors_write ON public.team_page_images;
CREATE POLICY website_editors_write ON public.team_page_images
  FOR ALL TO authenticated
  USING (public.can_edit_website())
  WITH CHECK (public.can_edit_website());

-- 2. Paleta Mavinci w księdze znaku ------------------------------------------------------------------------------------
-- Wartości z próbek kolorów księgi znaku (strona „Kolorystyka”); opisy HEX grafitu i granatu w PDF nie zgadzają się
-- z próbkami — przyjęte wartości próbek. Kolor dopisywany tylko, gdy marka nie ma już tego HEX-a (ponowne wykonanie
-- i ręczne zmiany w księdze znaku są bezpieczne).
DO $$
DECLARE
  v_company uuid;
  v_base integer;
  v_color record;
BEGIN
  SELECT c.id INTO v_company
  FROM public.my_companies c
  WHERE lower(btrim(c.name)) = 'mavinci'
  ORDER BY coalesce(c.is_default, false) DESC, c.created_at
  LIMIT 1;

  IF v_company IS NULL THEN
    RAISE NOTICE 'Brak firmy Mavinci w my_companies — paleta nie została dopisana.';
    RETURN;
  END IF;

  SELECT coalesce(max(order_index), -1) + 1 INTO v_base
  FROM public.company_brandbook_colors WHERE company_id = v_company;

  FOR v_color IN
    SELECT * FROM (VALUES
      (0, 'Bordo', '#4a001f'),
      (1, 'Złoto – gradient, ciemne', '#c99d2e'),
      (2, 'Złoto – gradient, jasne', '#fcec94'),
      (3, 'Złoto – gradient, koniec', '#cca235'),
      (4, 'Grafit', '#282828'),
      (5, 'Granat', '#141937'),
      (6, 'Piasek', '#d5c489'),
      (7, 'Ciepła biel (tekst na zdjęciach)', '#f7f2ea')
    ) AS palette(position, label, hex)
    ORDER BY position
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.company_brandbook_colors existing
      WHERE existing.company_id = v_company
        AND lower(left(btrim(existing.hex), 7)) = v_color.hex
    ) THEN
      INSERT INTO public.company_brandbook_colors (company_id, label, hex, role, order_index)
      VALUES (v_company, v_color.label, v_color.hex, 'neutral', v_base + v_color.position);
    END IF;
  END LOOP;
END $$;
