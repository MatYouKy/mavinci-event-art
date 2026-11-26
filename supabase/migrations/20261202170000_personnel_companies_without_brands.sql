-- Umowy personelu: lista działalności bez marek (docs/bank-reconciliation.md, sekcja 14).
--
-- Pracodawcą i stroną umowy o pracę, zlecenia albo o dzieło jest działalność — podmiot z NIP (np. Mavinci, NASTROJOWO).
-- Marka bez NIP (np. Event Rulers) realizuje wydarzenia, ale nie ma własnych finansów ani pracowników na umowach, więc nie
-- pojawia się na liście firm w „Umowach personelu” — tak jak w pozostałych listach działalności w finansach
-- (`src/lib/invoices/financeEntities.ts`, `purchases_access`, `purchase_can_record`). Żadna umowa nie jest przypisana do marki
-- (sprawdzone przed zmianą), więc lista nie gubi zapisanych umów. Uprawnienia funkcji zostają (CREATE OR REPLACE).

CREATE OR REPLACE FUNCTION public.personnel_picker_companies()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'legal_name',legal_name,'is_default',is_default) ORDER BY is_default DESC,name),'[]')
 FROM public.my_companies
 WHERE public.personnel_can_access() AND is_active AND btrim(coalesce(nip, '')) <> '';
$$;
