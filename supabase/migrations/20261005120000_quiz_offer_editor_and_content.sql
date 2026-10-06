-- Quiz offer refresh. Apply through the normal Supabase migration workflow before deploying the page.
-- Preserves uploaded assets and customized content. No public write permissions are added.
BEGIN;

ALTER TABLE public.quiz_show_gallery ADD COLUMN IF NOT EXISTS is_primary boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.can_manage_quiz_website()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.employees e
    WHERE (e.id = auth.uid() OR lower(e.email) =
      (SELECT lower(u.email) FROM auth.users u WHERE u.id = auth.uid()))
      AND (e.access_level = 'admin' OR e.role = 'admin'
        OR 'website_edit' = ANY(e.permissions) OR 'page_manage' = ANY(e.permissions))
  );
$$;
REVOKE ALL ON FUNCTION public.can_manage_quiz_website() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_manage_quiz_website() TO authenticated;

-- Use the same identity and scopes as canEditWebsite. The public can only read visible rows.
DROP POLICY IF EXISTS "Admins have full access to quiz show formats" ON public.quiz_show_formats;
DROP POLICY IF EXISTS "Website editors can update quiz show formats" ON public.quiz_show_formats;
DROP POLICY IF EXISTS "Website editors can insert quiz show formats" ON public.quiz_show_formats;
CREATE POLICY "Quiz editors read formats" ON public.quiz_show_formats FOR SELECT TO authenticated
  USING ((SELECT public.can_manage_quiz_website()));
CREATE POLICY "Quiz editors insert formats" ON public.quiz_show_formats FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.can_manage_quiz_website()));
CREATE POLICY "Quiz editors update formats" ON public.quiz_show_formats FOR UPDATE TO authenticated
  USING ((SELECT public.can_manage_quiz_website())) WITH CHECK ((SELECT public.can_manage_quiz_website()));

DROP POLICY IF EXISTS "Admins have full access to quiz gallery" ON public.quiz_show_gallery;
DROP POLICY IF EXISTS "Website editors can update quiz gallery" ON public.quiz_show_gallery;
DROP POLICY IF EXISTS "Website editors can insert quiz gallery" ON public.quiz_show_gallery;
DROP POLICY IF EXISTS "Website editors can delete quiz gallery" ON public.quiz_show_gallery;
CREATE POLICY "Quiz editors read gallery" ON public.quiz_show_gallery FOR SELECT TO authenticated
  USING ((SELECT public.can_manage_quiz_website()));
CREATE POLICY "Quiz editors insert gallery" ON public.quiz_show_gallery FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.can_manage_quiz_website()));
CREATE POLICY "Quiz editors update gallery" ON public.quiz_show_gallery FOR UPDATE TO authenticated
  USING ((SELECT public.can_manage_quiz_website())) WITH CHECK ((SELECT public.can_manage_quiz_website()));

CREATE POLICY "Quiz editors upload website images" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'site-images' AND (storage.foldername(name))[1] IN ('quiz-formats', 'quiz-gallery')
    AND (SELECT public.can_manage_quiz_website()));

-- Quiz heroes use the same editor scopes. City edits are isolated by page_slug.
CREATE POLICY "Quiz editors read main hero" ON public."quizy-teleturnieje_page_images" FOR SELECT TO authenticated
  USING (section = 'hero' AND (SELECT public.can_manage_quiz_website()));
CREATE POLICY "Quiz editors insert main hero" ON public."quizy-teleturnieje_page_images" FOR INSERT TO authenticated
  WITH CHECK (section = 'hero' AND (SELECT public.can_manage_quiz_website()));
CREATE POLICY "Quiz editors update main hero" ON public."quizy-teleturnieje_page_images" FOR UPDATE TO authenticated
  USING (section = 'hero' AND (SELECT public.can_manage_quiz_website()))
  WITH CHECK (section = 'hero' AND (SELECT public.can_manage_quiz_website()));
CREATE POLICY "Quiz editors read city heroes" ON public.service_hero_images FOR SELECT TO authenticated
  USING (page_slug ~ '^oferta/quizy-teleturnieje/[a-z0-9]+(-[a-z0-9]+)*$' AND (SELECT public.can_manage_quiz_website()));
CREATE POLICY "Quiz editors insert city heroes" ON public.service_hero_images FOR INSERT TO authenticated
  WITH CHECK (page_slug ~ '^oferta/quizy-teleturnieje/[a-z0-9]+(-[a-z0-9]+)*$' AND (SELECT public.can_manage_quiz_website()));
CREATE POLICY "Quiz editors update city heroes" ON public.service_hero_images FOR UPDATE TO authenticated
  USING (page_slug ~ '^oferta/quizy-teleturnieje/[a-z0-9]+(-[a-z0-9]+)*$' AND (SELECT public.can_manage_quiz_website()))
  WITH CHECK (page_slug ~ '^oferta/quizy-teleturnieje/[a-z0-9]+(-[a-z0-9]+)*$' AND (SELECT public.can_manage_quiz_website()));

-- Public icons are only those explicitly assigned to a published quiz format.
CREATE POLICY "Public reads published quiz icons" ON public.custom_icons FOR SELECT TO anon, authenticated
  USING (EXISTS (SELECT 1 FROM public.quiz_show_formats f WHERE f.icon_id = custom_icons.id AND f.is_visible));
CREATE POLICY "Quiz editors read icon library" ON public.custom_icons FOR SELECT TO authenticated
  USING ((SELECT public.can_manage_quiz_website()));

-- One transaction prevents partial updates when selecting the featured gallery photo.
CREATE OR REPLACE FUNCTION public.set_quiz_gallery_primary(image_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF NOT public.can_manage_quiz_website() THEN RAISE EXCEPTION 'Brak uprawnien do edycji strony'; END IF;
  PERFORM pg_advisory_xact_lock(610051200);
  IF NOT EXISTS (SELECT 1 FROM public.quiz_show_gallery WHERE id = image_id) THEN
    RAISE EXCEPTION 'Nie znaleziono zdjecia';
  END IF;
  UPDATE public.quiz_show_gallery SET is_primary = (id = image_id)
    WHERE is_primary = true OR id = image_id;
END;
$$;
REVOKE ALL ON FUNCTION public.set_quiz_gallery_primary(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_quiz_gallery_primary(uuid) TO authenticated;

-- Initial sample copy is replaced only when its entire editable text still matches the seed.

UPDATE public.quiz_show_formats SET title = 'Quiz wiedzy na integrację', level = 'Wspólna rozgrywka',
  description = 'Wspólne szukanie odpowiedzi daje uczestnikom okazję do rozmowy i współpracy. Dobieramy tematykę oraz poziom pytań do grupy, a rundy wpisujemy w program integracji lub kolacji firmowej.', features = ARRAY['Pytania dopasowane do uczestników', 'Możliwość gry drużynowej', 'Rundy uzgodnione z programem wieczoru', 'Czas i sposób udziału ustalane przed wydarzeniem']::text[]
WHERE title = 'Klasyczne quizy wiedzy' AND level = 'Proste'
  AND description = 'Idealne na szybką integrację i pierwsze lodołamacze. Format 1 z 10 pytań, prostota i dynamika.'
  AND to_jsonb(features) = '["Pytania wielokrotnego wyboru", "Szybka rozgrywka 15-30 min", "Bez zaawansowanego sprzętu", "Do 100 uczestników"]'::jsonb;

UPDATE public.quiz_show_formats SET title = 'Teleturniej z buzzerami', level = 'Emocje na scenie',
  description = 'Sygnał, szybka decyzja i odpowiedź przed publicznością. Buzzery nadają rozgrywce wyraźny rytm, a prowadzący pomaga uczestnikom odnaleźć się w zasadach. To propozycja na sceniczny punkt firmowego wieczoru.', features = ARRAY['Przyciski z wykrywaniem pierwszeństwa', 'Wyniki prezentowane na ekranie', 'Rozgrywka indywidualna lub drużynowa', 'Finał wpisany w scenariusz wydarzenia']::text[]
WHERE title = 'Quizy z buzzerami' AND level = 'Średnio zaawansowane'
  AND description = 'Dynamiczne teleturnieje z systemem buzzerów – kto pierwszy naciśnie, ten odpowiada. Emocje i rywalizacja.'
  AND to_jsonb(features) = '["Profesjonalne buzzery", "System wykrywania pierwszeństwa", "Wyniki na żywo na ekranie", "Tryb drużynowy lub indywidualny"]'::jsonb;

UPDATE public.quiz_show_formats SET title = 'Quiz z pilotami do głosowania', level = 'Udział całej sali',
  description = 'Uczestnicy odpowiadają za pomocą bezprzewodowych pilotów, a system zlicza wyniki. Format pozwala zaangażować gości bez konieczności zapraszania każdego na scenę. Liczbę pilotów i organizację udziału ustalamy dla konkretnej grupy.', features = ARRAY['Odpowiedzi za pomocą pilotów', 'Zliczanie wyników w trakcie rozgrywki', 'Ranking uczestników lub zespołów', 'Sprzęt dopasowany do liczby gości']::text[]
WHERE title = 'Teleturnieje z pilotami' AND level = 'Zaawansowane'
  AND description = 'Każdy uczestnik otrzymuje bezprzewodowy pilot do głosowania. System zlicza odpowiedzi w czasie rzeczywistym.'
  AND to_jsonb(features) = '["Indywidualne piloty bezprzewodowe", "Statystyki na żywo", "Ranking uczestników", "Do 500 osób jednocześnie"]'::jsonb;

UPDATE public.quiz_show_formats SET title = 'Teleturniej multimedialny', level = 'Obraz, dźwięk i rywalizacja',
  description = 'Zdjęcia, fragmenty wideo i pytania dźwiękowe urozmaicają kolejne rundy. Łączymy prowadzenie z realizacją obrazu oraz dźwięku, aby rozgrywka była czytelna i atrakcyjna również dla publiczności.', features = ARRAY['Rundy audio i wideo', 'Pytania i ranking na ekranie', 'Prowadzący oraz obsługa multimediów', 'Zakres ekranu i scenografii uzgadniany osobno']::text[]
WHERE title = 'Multimedialne teleturnieje' AND level = 'Premium'
  AND description = 'Pełna produkcja z materiałami wideo, dźwiękiem, grafiką na ekranach LED. Format godny studia telewizyjnego.'
  AND to_jsonb(features) = '["Pytania wideo i audio", "Profesjonalna scenografia", "Konferansjer i realizator", "Nagranie relacji wideo"]'::jsonb;

UPDATE public.quiz_show_formats SET title = 'Teleturniej o Waszej firmie', level = 'Pytania z własnym charakterem',
  description = 'Historia firmy, produkty, zespół lub temat konferencji mogą stać się punktem wyjścia do zabawy. Wspólnie z organizatorem wybieramy materiały i przygotowujemy pytania zrozumiałe dla zaproszonych gości.', features = ARRAY['Pytania związane z firmą lub branżą', 'Możliwość wykorzystania zdjęć i wideo klienta', 'Grafika dopasowana do wydarzenia', 'Scenariusz uzgadniany przed realizacją']::text[]
WHERE title = 'Teleturnieje tematyczne' AND level = 'Spersonalizowane'
  AND description = 'Scenariusz dopasowany do branży, historii firmy lub tematyki wydarzenia. Pytania szyte na miarę.'
  AND to_jsonb(features) = '["Pytania o firmę/branżę", "Personalizowana grafika", "Wideo i zdjęcia klienta", "Unikalna scenografia"]'::jsonb;

UPDATE public.quiz_show_formats SET title = 'Teleturniej na galę i jubileusz', level = 'Sceniczny punkt programu',
  description = 'Rozgrywka przygotowana jako część gali, jubileuszu lub uroczystego spotkania. Uzgadniamy jej ton, tempo i miejsce w harmonogramie. Oprawę techniczną oraz dodatkowe elementy produkcji dobieramy do wydarzenia.', features = ARRAY['Scenariusz dopasowany do charakteru spotkania', 'Koordynacja z programem gali', 'Zakres scenografii i nagród do ustalenia', 'Nagranie i streaming jako opcje dodatkowe']::text[]
WHERE title = 'Teleturnieje dla VIP' AND level = 'Ekskluzywne'
  AND description = 'Najwyższa jakość realizacji na gale, jubileusze, uroczystości premium. Pełna obsługa produkcyjna.'
  AND to_jsonb(features) = '["Dedykowany scenariusz", "Operator kamery i realizator", "Nagrody luksusowe", "Transmisja live opcjonalnie"]'::jsonb;

UPDATE public."quizy-teleturnieje_page_images"
SET title = 'Quizy i teleturnieje na imprezy firmowe',
    description = 'Zamień firmowy wieczór we wspólną rozgrywkę. Łączymy zespołową rywalizację, humor i multimedia. Dobieramy formułę do uczestników oraz programu wydarzenia — od integracji przy kolacji po teleturniej na scenie.'
WHERE section = 'hero' AND title = 'Quizy i Teleturnieje'
  AND description = 'Organizujemy interaktywne quizy i teleturnieje, które integrują zespoły i dostarczają niezapomnianych wrażeń. Profesjonalna realizacja z pełnym zapleczem technicznym.';

COMMIT;
