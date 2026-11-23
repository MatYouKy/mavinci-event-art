-- Baza pytań Drabinki (format „Milionerzy”) w Mavinci LIVE.
-- CRM jest źródłem pytań; Mavinci LIVE pobiera je i trzyma lokalną kopię do pracy bez sieci.
-- Każde pytanie ma dokładnie 4 odpowiedzi (A–D), jedną poprawną i poziom: łatwe / średnie / trudne.
-- Drabinka układa pytania od łatwych (pierwsza ⅓ stawek) przez średnie do trudnych (ostatnia ⅓).

CREATE TABLE IF NOT EXISTS public.mavinci_ladder_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid REFERENCES public.events(id) ON DELETE CASCADE,
  difficulty text NOT NULL DEFAULT 'medium' CHECK (difficulty IN ('easy', 'medium', 'hard')),
  category text NOT NULL DEFAULT 'Ogólne',
  question text NOT NULL,
  answers jsonb NOT NULL DEFAULT '[]'::jsonb,
  correct smallint NOT NULL DEFAULT 0 CHECK (correct BETWEEN 0 AND 3),
  host_note text NOT NULL DEFAULT '',
  tags text[] NOT NULL DEFAULT '{}'::text[],
  is_active boolean NOT NULL DEFAULT true,
  usage_count integer NOT NULL DEFAULT 0 CHECK (usage_count >= 0),
  source text NOT NULL DEFAULT 'crm' CHECK (source IN ('crm', 'desktop', 'import')),
  created_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (char_length(btrim(question)) BETWEEN 2 AND 500),
  CHECK (char_length(category) <= 80),
  CHECK (char_length(host_note) <= 1000),
  CHECK (jsonb_typeof(answers) = 'array')
);

CREATE INDEX IF NOT EXISTS idx_mavinci_ladder_questions_level
  ON public.mavinci_ladder_questions(difficulty, category, updated_at DESC) WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_mavinci_ladder_questions_event
  ON public.mavinci_ladder_questions(event_id, updated_at DESC);

-- Dokładnie 4 niepuste odpowiedzi tekstowe (do 200 znaków), bez powtórzeń.
CREATE OR REPLACE FUNCTION public.validate_mavinci_ladder_question()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  answer jsonb;
  seen text[] := '{}'::text[];
  normalized text;
BEGIN
  IF jsonb_typeof(NEW.answers) <> 'array' OR jsonb_array_length(NEW.answers) <> 4 THEN
    RAISE EXCEPTION 'Pytanie Drabinki musi mieć dokładnie 4 odpowiedzi (A–D)';
  END IF;
  FOR answer IN SELECT value FROM jsonb_array_elements(NEW.answers)
  LOOP
    IF jsonb_typeof(answer) <> 'string' OR char_length(btrim(answer #>> '{}')) = 0 THEN
      RAISE EXCEPTION 'Każda odpowiedź Drabinki musi mieć treść';
    END IF;
    IF char_length(answer #>> '{}') > 200 THEN
      RAISE EXCEPTION 'Odpowiedź Drabinki może mieć najwyżej 200 znaków';
    END IF;
    normalized := lower(btrim(answer #>> '{}'));
    IF normalized = ANY(seen) THEN
      RAISE EXCEPTION 'Odpowiedzi w pytaniu Drabinki nie mogą się powtarzać';
    END IF;
    seen := seen || normalized;
  END LOOP;
  NEW.question := btrim(NEW.question);
  NEW.category := COALESCE(NULLIF(btrim(NEW.category), ''), 'Ogólne');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_mavinci_ladder_question ON public.mavinci_ladder_questions;
CREATE TRIGGER trg_validate_mavinci_ladder_question
BEFORE INSERT OR UPDATE OF answers, question, category ON public.mavinci_ladder_questions
FOR EACH ROW EXECUTE FUNCTION public.validate_mavinci_ladder_question();

DROP TRIGGER IF EXISTS trg_mavinci_ladder_questions_audit ON public.mavinci_ladder_questions;
CREATE TRIGGER trg_mavinci_ladder_questions_audit
BEFORE INSERT OR UPDATE ON public.mavinci_ladder_questions
FOR EACH ROW EXECUTE FUNCTION public.set_mavinci_audit_fields();

ALTER TABLE public.mavinci_ladder_questions ENABLE ROW LEVEL SECURITY;

-- Drabinka należy do modułu Quiz Show (Teleturnieje → Drabinka).
DROP POLICY IF EXISTS mavinci_ladder_questions_select ON public.mavinci_ladder_questions;
CREATE POLICY mavinci_ladder_questions_select
ON public.mavinci_ladder_questions FOR SELECT
USING (
  public.can_use_mavinci_global_module('quiz_show')
  AND (
    public.can_use_mavinci_hub('view')
    OR (event_id IS NOT NULL AND public.can_use_mavinci_module(event_id, 'quiz_show', 'view'))
    OR (
      event_id IS NULL
      AND EXISTS (
        SELECT 1
        FROM public.mavinci_event_module_access access
        WHERE access.employee_id = public.current_mavinci_employee_id()
          AND access.module_key = 'quiz_show'
          AND access.revoked_at IS NULL
          AND (access.valid_from IS NULL OR access.valid_from <= now())
          AND (access.valid_until IS NULL OR access.valid_until >= now())
          AND (access.can_view OR access.can_edit OR access.can_run OR access.can_admin)
      )
    )
  )
);

DROP POLICY IF EXISTS mavinci_ladder_questions_write ON public.mavinci_ladder_questions;
CREATE POLICY mavinci_ladder_questions_write
ON public.mavinci_ladder_questions FOR ALL
USING (
  public.can_use_mavinci_global_module('quiz_show')
  AND (
    public.can_use_mavinci_hub('manage')
    OR (event_id IS NOT NULL AND public.can_use_mavinci_module(event_id, 'quiz_show', 'edit'))
  )
)
WITH CHECK (
  public.can_use_mavinci_global_module('quiz_show')
  AND (
    public.can_use_mavinci_hub('manage')
    OR (event_id IS NOT NULL AND public.can_use_mavinci_module(event_id, 'quiz_show', 'edit'))
  )
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.mavinci_ladder_questions TO authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
    AND NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'mavinci_ladder_questions'
    )
  THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.mavinci_ladder_questions;
  END IF;
END;
$$;

-- Pakiet startowy: 15 pytań na poziom (globalne, tag „pakiet-startowy”). Wstawiany tylko raz.
INSERT INTO public.mavinci_ladder_questions (difficulty, category, question, answers, correct, host_note, tags, source)
SELECT v.difficulty, v.category, v.question, v.answers::jsonb, v.correct, v.host_note, ARRAY['pakiet-startowy'], 'import'
FROM (VALUES
  ('easy', 'Polska', 'Stolicą Polski jest:', '["Kraków","Warszawa","Gdańsk","Poznań"]', 1, 'Warszawa — stolica od przełomu XVI i XVII w.'),
  ('easy', 'Przyroda', 'Ile nóg ma pająk?', '["6","8","10","4"]', 1, 'Pająki mają 8 nóg, owady — 6.'),
  ('easy', 'Ogólne', 'Który miesiąc ma najmniej dni?', '["Luty","Kwiecień","Listopad","Czerwiec"]', 0, 'Luty: 28 dni, w roku przestępnym 29.'),
  ('easy', 'Literatura', 'Kto napisał „Pana Tadeusza”?', '["Adam Mickiewicz","Juliusz Słowacki","Henryk Sienkiewicz","Bolesław Prus"]', 0, 'Epopeja narodowa wydana w 1834 r.'),
  ('easy', 'Polska', 'Najdłuższa rzeka Polski to:', '["Odra","Warta","Wisła","Bug"]', 2, 'Wisła — ok. 1047 km.'),
  ('easy', 'Ogólne', 'Jaki kolor powstaje ze zmieszania niebieskiego i żółtego?', '["Zielony","Fioletowy","Pomarańczowy","Brązowy"]', 0, 'Zielony.'),
  ('easy', 'Ogólne', 'Ile minut ma godzina?', '["30","60","90","100"]', 1, '60 minut.'),
  ('easy', 'Polska', 'Jakie zwierzę widnieje w godle Polski?', '["Orzeł","Lew","Niedźwiedź","Żubr"]', 0, 'Biały orzeł w koronie na czerwonym tle.'),
  ('easy', 'Polska', 'W którym mieście znajduje się Wawel?', '["Warszawa","Kraków","Wrocław","Toruń"]', 1, 'Wzgórze wawelskie w Krakowie.'),
  ('easy', 'Muzyka', 'Który instrument ma białe i czarne klawisze?', '["Skrzypce","Gitara","Fortepian","Trąbka"]', 2, 'Fortepian (i pianino).'),
  ('easy', 'Przysłowia', 'Dokończ przysłowie: „Nie chwal dnia przed…”', '["zachodem słońca","obiadem","niedzielą","deszczem"]', 0, '„Nie chwal dnia przed zachodem słońca”.'),
  ('easy', 'Matematyka', 'Ile to jest 12 × 12?', '["124","144","132","148"]', 1, '144.'),
  ('easy', 'Kuchnia', 'Z czego najczęściej robi się frytki?', '["Z ziemniaków","Z marchwi","Z buraków","Z pietruszki"]', 0, 'Z ziemniaków.'),
  ('easy', 'Przyroda', 'Który z tych ptaków nie lata?', '["Pingwin","Wróbel","Bocian","Jaskółka"]', 0, 'Pingwin nie lata, ale świetnie pływa.'),
  ('easy', 'Geografia', 'Na jakim kontynencie leży Egipt?', '["W Azji","W Afryce","W Europie","W Ameryce Południowej"]', 1, 'Egipt leży w Afryce (półwysep Synaj — w Azji).'),

  ('medium', 'Nauka', 'Który pierwiastek ma symbol chemiczny Fe?', '["Fluor","Żelazo","Fosfor","Frans"]', 1, 'Fe — od łacińskiego ferrum.'),
  ('medium', 'Historia', 'W którym roku Polska wstąpiła do Unii Europejskiej?', '["2000","2004","2007","1999"]', 1, '1 maja 2004 r.'),
  ('medium', 'Geografia', 'Który kraj ma kształt buta?', '["Grecja","Hiszpania","Włochy","Portugalia"]', 2, 'Półwysep Apeniński — Włochy.'),
  ('medium', 'Sztuka', 'Kto namalował „Bitwę pod Grunwaldem”?', '["Jan Matejko","Józef Chełmoński","Stanisław Wyspiański","Jacek Malczewski"]', 0, 'Jan Matejko, 1878 r.'),
  ('medium', 'Nauka', 'Ile planet liczy Układ Słoneczny?', '["7","8","9","10"]', 1, 'Od 2006 r. Pluton jest planetą karłowatą.'),
  ('medium', 'Geografia', 'Największy ocean świata to Ocean:', '["Atlantycki","Indyjski","Spokojny","Arktyczny"]', 2, 'Ocean Spokojny (Pacyfik).'),
  ('medium', 'Literatura', 'Kto otrzymał literacką Nagrodę Nobla za powieść „Chłopi”?', '["Henryk Sienkiewicz","Władysław Reymont","Czesław Miłosz","Wisława Szymborska"]', 1, 'Władysław Reymont, 1924 r.'),
  ('medium', 'Polska', 'Najwyższy szczyt Polski to:', '["Śnieżka","Kasprowy Wierch","Rysy","Giewont"]', 2, 'Rysy — 2499 m n.p.m.'),
  ('medium', 'Nauka', 'Ile kości ma szkielet dorosłego człowieka?', '["106","206","306","406"]', 1, 'Ok. 206 kości.'),
  ('medium', 'Geografia', 'Jaka jest stolica Australii?', '["Sydney","Melbourne","Canberra","Perth"]', 2, 'Canberra.'),
  ('medium', 'Muzyka', 'Który z tych instrumentów jest dęty?', '["Wiolonczela","Obój","Harfa","Kontrabas"]', 1, 'Obój — instrument dęty drewniany.'),
  ('medium', 'Geografia', 'W którym mieście stoi słynna Krzywa Wieża?', '["We Florencji","W Pizie","W Rzymie","W Wenecji"]', 1, 'Piza, Toskania.'),
  ('medium', 'Nauka', 'Maria Skłodowska-Curie odkryła wraz z mężem polon i:', '["rad","uran","hel","neon"]', 0, 'Rad i polon — 1898 r.'),
  ('medium', 'Matematyka', 'Ile wynosi suma kątów wewnętrznych trójkąta?', '["90°","180°","270°","360°"]', 1, '180°.'),
  ('medium', 'Historia', 'Który kraj jako pierwszy wysłał człowieka w kosmos?', '["USA","ZSRR","Chiny","Francja"]', 1, 'Jurij Gagarin, 12 kwietnia 1961 r.'),

  ('hard', 'Historia', 'W którym roku odbyła się bitwa pod Grunwaldem?', '["1385","1410","1466","1525"]', 1, '15 lipca 1410 r.'),
  ('hard', 'Nauka', 'Który gaz stanowi największą część atmosfery Ziemi?', '["Tlen","Azot","Argon","Dwutlenek węgla"]', 1, 'Azot — ok. 78%.'),
  ('hard', 'Geografia', 'Najgłębsze znane miejsce oceanów, Głębia Challengera, leży w:', '["Rowie Mariańskim","Rowie Atakamskim","Rowie Puerto Rico","Rowie Kurylskim"]', 0, 'Rów Mariański, Ocean Spokojny — ok. 11 km.'),
  ('hard', 'Historia', 'Kto jest autorem słów „Mazurka Dąbrowskiego”?', '["Józef Wybicki","Adam Mickiewicz","Jan Kochanowski","Ignacy Krasicki"]', 0, 'Józef Wybicki, 1797 r. (Reggio nell’Emilia).'),
  ('hard', 'Nauka', 'Który metal ma najwyższą temperaturę topnienia?', '["Platyna","Tytan","Wolfram","Osm"]', 2, 'Wolfram — ok. 3422°C.'),
  ('hard', 'Historia', 'W którym roku upadł mur berliński?', '["1987","1989","1990","1991"]', 1, '9 listopada 1989 r.'),
  ('hard', 'Matematyka', 'Ile wynosi pierwiastek kwadratowy z 196?', '["12","13","14","16"]', 2, '14 × 14 = 196.'),
  ('hard', 'Historia', 'Kto był pierwszym koronowanym królem Polski?', '["Mieszko I","Bolesław Chrobry","Kazimierz Wielki","Władysław Łokietek"]', 1, 'Bolesław Chrobry, koronacja w 1025 r.'),
  ('hard', 'Geografia', 'Które państwo (razem z terytoriami zamorskimi) ma najwięcej stref czasowych?', '["Rosja","USA","Francja","Wielka Brytania"]', 2, 'Francja — 12 stref (USA i Rosja po 11).'),
  ('hard', 'Sztuka', 'Który malarz odciął sobie fragment ucha?', '["Paul Gauguin","Vincent van Gogh","Claude Monet","Edvard Munch"]', 1, 'Vincent van Gogh, Arles, 1888 r.'),
  ('hard', 'Nauka', 'Z jaką prędkością (w przybliżeniu) porusza się światło w próżni?', '["30 000 km/s","300 000 km/s","3 000 000 km/s","150 000 km/s"]', 1, 'Ok. 299 792 km/s.'),
  ('hard', 'Historia', 'Który pokój zakończył w 1648 r. wojnę trzydziestoletnią?', '["Pokój westfalski","Pokój oliwski","Traktat wersalski","Pokój toruński"]', 0, 'Pokój westfalski (Münster i Osnabrück).'),
  ('hard', 'Muzyka', 'Ile strun ma standardowa wiolonczela?', '["4","5","6","7"]', 0, 'Cztery: C, G, D, A.'),
  ('hard', 'Muzyka', 'W jakiej miejscowości urodził się Fryderyk Chopin?', '["W Żelazowej Woli","W Warszawie","W Krakowie","W Dusznikach-Zdroju"]', 0, 'Żelazowa Wola, 1810 r.'),
  ('hard', 'Geografia', 'Najmniejsze państwo świata to:', '["Monako","San Marino","Watykan","Liechtenstein"]', 2, 'Watykan — ok. 0,44 km².')
) AS v(difficulty, category, question, answers, correct, host_note)
WHERE NOT EXISTS (
  SELECT 1 FROM public.mavinci_ladder_questions existing WHERE 'pakiet-startowy' = ANY(existing.tags)
);
