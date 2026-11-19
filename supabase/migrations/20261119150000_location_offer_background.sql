-- Lokalizacje: „Tło ofert” — zdjęcie miejsca na okładkę ofert wydarzeń w tym miejscu. Przykład: hotel Marina jest miejscem
-- imprezy firmy, która nie jest hotelem — oferta idzie do firmy, a na okładce jest zdjęcie Mariny.
-- Plik w `location-materials` pod katalogiem lokalizacji (`<id lokalizacji>/<uuid>.jpg|png|webp`) — te same reguły dostępu co
-- materiały lokalizacji (podgląd: pracownicy; wgrywanie i zmiana: administrator albo `locations_manage`, RLS `locations`).
-- Okładka oferty (`src/lib/offer-pdf/render.ts`, `src/lib/CRM/Offers/offerVenueBackground.ts`): własna grafika oferty → tło
-- miejsca (pierwsza istniejąca lokalizacja: wybrana w ofercie, wydarzenia, z zapytania, organizacji klienta) → grafika kategorii
-- szablonu → zdjęcie produktu. Oferty sprzedawców hotelowych — bez zmian (okładka z profilu sprzedawcy).
-- Plik idempotentny — można go wykonać ponownie (także po wcześniejszej, krótszej wersji z tą samą nazwą).

ALTER TABLE public.locations ADD COLUMN IF NOT EXISTS offer_background_path text;
-- Ostatnia zmiana tła (ustawia wyłącznie wyzwalacz) — PDF ofert wygenerowane wcześniej mają nieaktualną okładkę.
ALTER TABLE public.locations ADD COLUMN IF NOT EXISTS offer_background_updated_at timestamptz;

COMMENT ON COLUMN public.locations.offer_background_path IS
  'Tło ofert: zdjęcie miejsca na okładkę ofert wydarzeń w tej lokalizacji (bucket location-materials, <id>/<uuid>.jpg|png|webp).';
COMMENT ON COLUMN public.locations.offer_background_updated_at IS
  'Ostatnia zmiana Tła ofert (dodanie, zmiana, usunięcie) — ustawia wyzwalacz touch_location_offer_background; PDF ofert wygenerowane wcześniej są nieaktualne.';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'locations_offer_background_path_check'
                 AND conrelid = 'public.locations'::regclass) THEN
    ALTER TABLE public.locations ADD CONSTRAINT locations_offer_background_path_check
      CHECK (offer_background_path IS NULL OR offer_background_path ~ ('^' || id::text || '/[0-9a-f-]{36}\.(jpg|png|webp)$'));
  END IF;
END $$;

-- Czas zmiany tła ustawia baza (wartość wysłana przez aplikację jest pomijana).
CREATE OR REPLACE FUNCTION public.touch_location_offer_background()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.offer_background_updated_at := CASE WHEN NEW.offer_background_path IS NULL THEN NULL ELSE now() END;
  ELSIF NEW.offer_background_path IS DISTINCT FROM OLD.offer_background_path THEN
    NEW.offer_background_updated_at := now();
  ELSE
    NEW.offer_background_updated_at := OLD.offer_background_updated_at;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS touch_location_offer_background ON public.locations;
CREATE TRIGGER touch_location_offer_background
  BEFORE INSERT OR UPDATE ON public.locations
  FOR EACH ROW EXECUTE FUNCTION public.touch_location_offer_background();

-- Miejsce wybrane w ofercie z listy lokalizacji („Miejsce wydarzenia”) — pierwsze w kolejności miejsca okładki. Miejsce wpisane
-- ręcznie zostaje tylko tekstem (`event_location`, `location_id` puste). Usunięcie lokalizacji czyści powiązanie (jak w wydarzeniach).
ALTER TABLE public.offers ADD COLUMN IF NOT EXISTS location_id uuid REFERENCES public.locations(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS offers_location_id_idx ON public.offers (location_id) WHERE location_id IS NOT NULL;

COMMENT ON COLUMN public.offers.location_id IS
  'Lokalizacja wybrana w ofercie z listy (pole „Miejsce wydarzenia”) — miejsce okładki oferty przed lokalizacją wydarzenia, zapytania i organizacji klienta.';

-- PDF oferty sprzed ostatniej zmiany „Tła ofert” jej miejsca (dodanie, zmiana, usunięcie) — okładka w PDF jest nieaktualna, wysyłka
-- po ponownym wygenerowaniu (jak `modified_after_generation`). Pole wyliczane PostgREST (`offers.select('offer_venue_pdf_outdated')`),
-- bez zmiany samych ofert (ich wyzwalacze i zakres danych bez zmian). Miejsce jak `offerVenue` w aplikacji: pierwsza istniejąca
-- lokalizacja — wybrana w ofercie, wydarzenia, z zapytania, organizacji klienta. Oferty z własną grafiką i oferty sprzedawców — nie.
CREATE OR REPLACE FUNCTION public.offer_venue_pdf_outdated(p_offer public.offers)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT CASE
    WHEN p_offer.generated_pdf_url IS NULL OR p_offer.last_generated_at IS NULL OR p_offer.hero_image_path IS NOT NULL
      OR coalesce(p_offer.sales_channel, '') = 'seller_portal' THEN false
    ELSE coalesce((
      SELECT l.offer_background_updated_at > p_offer.last_generated_at
      FROM (
        SELECT 1 AS priority, p_offer.location_id AS location_id
        UNION ALL
        SELECT 2, e.location_id FROM public.events e WHERE e.id = p_offer.event_id
        UNION ALL
        SELECT 3, CASE WHEN (t.inquiry_details ->> 'location_id') ~* '^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$'
                       THEN (t.inquiry_details ->> 'location_id')::uuid END
        FROM public.tasks t WHERE t.id = p_offer.inquiry_id AND jsonb_typeof(t.inquiry_details) = 'object'
        UNION ALL
        SELECT 4, o.location_id FROM public.organizations o WHERE o.id = p_offer.organization_id
      ) AS venue
      JOIN public.locations l ON l.id = venue.location_id
      ORDER BY venue.priority
      LIMIT 1
    ), false)
  END;
$$;

REVOKE ALL ON FUNCTION public.offer_venue_pdf_outdated(public.offers) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.offer_venue_pdf_outdated(public.offers) TO authenticated, service_role;
