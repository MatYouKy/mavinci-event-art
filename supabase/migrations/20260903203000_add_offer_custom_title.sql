-- Dedykowany tytul oferty. Pole jest opcjonalne, aby starsze oferty nadal
-- korzystaly z nazwy wydarzenia lub zapytania jako wartosci domyslnej.
ALTER TABLE public.offers
  ADD COLUMN IF NOT EXISTS title text;

COMMENT ON COLUMN public.offers.title
IS 'Opcjonalny tytul oferty nadpisujacy nazwe wydarzenia lub zapytania w CRM i PDF.';
