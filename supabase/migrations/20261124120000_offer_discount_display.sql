-- Jak klient widzi rabat w PDF oferty (wycena): przy pozycjach — kolumna „Rabat” i rabaty w podsumowaniu (domyślnie, jak dotąd),
-- rabat łączny — pozycje w cenach przed rabatem i jeden rabat pod tabelą, albo tylko ceny po rabacie — bez kwot rabatu.
-- Rabaty pozycji i rabat całej oferty liczą się zawsze tak samo (sumy, próg akceptacji) — kolumna zmienia tylko prezentację.
-- Zmiana kolumny podnosi wersję treści oferty (`mark_offer_modified`), więc zapisany PDF oznacza się jako nieaktualny.

ALTER TABLE public.offers
  ADD COLUMN IF NOT EXISTS discount_display text NOT NULL DEFAULT 'lines';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'offers_discount_display_check' AND conrelid = 'public.offers'::regclass
  ) THEN
    ALTER TABLE public.offers
      ADD CONSTRAINT offers_discount_display_check CHECK (discount_display IN ('lines', 'total', 'none'));
  END IF;
END $$;

COMMENT ON COLUMN public.offers.discount_display IS
  'Rabat w PDF dla klienta: lines — przy pozycjach i w podsumowaniu; total — jeden rabat łączny; none — tylko ceny po rabacie.';
