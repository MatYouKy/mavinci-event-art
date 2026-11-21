-- Marketing → „Social media”: style grafik posta i napis nad tytułem (web CRM, Mac, telefon).
-- Wymaga migracji 20261119200000_marketing_social_media.sql.
-- Plik idempotentny — można go wykonać ponownie.
--
-- Style: Klasyczny (dotychczasowy układ — istniejące grafiki zostają aktualne), Rama, Passe-partout, Kino, Winieta, Okładka.
-- Logo, fonty i kolory nadal wyłącznie z księgi znaku (szablon marki); styl zmienia układ, ramki, maski i cienie. Grafikę
-- generuje serwer Next tym samym HTML co podgląd na żywo w CRM i warstwa podglądu na Macu.
-- Styl i napis nad tytułem (np. „Realizacja”) są w wariancie grafiki — jak tytuł i podpis. Ich zmiana to zmiana treści
-- posta: wersja +1, a zatwierdzony lub zaplanowany post wraca do szkicu (wyzwalacz `social_posts_guard`).
-- Domyślny styl nowych postów marki: `social_brand_templates.settings.defaultStyle` (bez zmian w schemacie).

ALTER TABLE public.social_post_variants
  ADD COLUMN IF NOT EXISTS style text NOT NULL DEFAULT 'classic',
  ADD COLUMN IF NOT EXISTS kicker text NOT NULL DEFAULT '';

ALTER TABLE public.social_post_variants DROP CONSTRAINT IF EXISTS social_post_variants_style_check;
ALTER TABLE public.social_post_variants ADD CONSTRAINT social_post_variants_style_check
  CHECK (style IN ('classic', 'frame', 'mat', 'cinema', 'vignette', 'cover'));

ALTER TABLE public.social_post_variants DROP CONSTRAINT IF EXISTS social_post_variants_kicker_check;
ALTER TABLE public.social_post_variants ADD CONSTRAINT social_post_variants_kicker_check
  CHECK (char_length(kicker) <= 40);

COMMENT ON COLUMN public.social_post_variants.style IS
  'Styl grafiki: classic | frame | mat | cinema | vignette | cover (układ, ramki, maski i cienie; kolory i fonty z szablonu marki).';
COMMENT ON COLUMN public.social_post_variants.kicker IS 'Napis nad tytułem grafiki (np. „Realizacja”), do 40 znaków.';

-- Treść jak w 20261119200000 + styl i napis nad tytułem: ich zmiana podnosi wersję posta.
CREATE OR REPLACE FUNCTION public.social_post_variants_touch_post()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.format IS NOT DISTINCT FROM OLD.format AND NEW.asset_id IS NOT DISTINCT FROM OLD.asset_id
    AND NEW.crop IS NOT DISTINCT FROM OLD.crop AND NEW.headline IS NOT DISTINCT FROM OLD.headline
    AND NEW.subline IS NOT DISTINCT FROM OLD.subline AND NEW.style IS NOT DISTINCT FROM OLD.style
    AND NEW.kicker IS NOT DISTINCT FROM OLD.kicker THEN
    RETURN NULL;
  END IF;
  UPDATE public.social_posts SET revision = revision + 1
  WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD.post_id ELSE NEW.post_id END;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS social_post_variants_touch_post ON public.social_post_variants;
CREATE TRIGGER social_post_variants_touch_post AFTER INSERT OR UPDATE OR DELETE ON public.social_post_variants
  FOR EACH ROW EXECUTE FUNCTION public.social_post_variants_touch_post();
