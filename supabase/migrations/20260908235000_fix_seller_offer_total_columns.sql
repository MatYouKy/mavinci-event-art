BEGIN;

-- Zapis portalu i trigger recalculate_individual_seller_offer_totals używają
-- pól ze starszej migracji extend_offers_system, nieobecnych na części baz.
-- Uzupełniamy obie kolumny bez nadpisywania istniejących danych.
ALTER TABLE public.offers
  ADD COLUMN IF NOT EXISTS total_base_price numeric(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_final_price numeric(12,2) DEFAULT 0;

NOTIFY pgrst, 'reload schema';
COMMIT;
