-- Zwrot płatności w uzgadnianiu wyciągów: para „płatność + zwrot” bez faktury (2026-11-03).
--
-- CO I DLACZEGO
-- 12.08.2026 z rachunku wyszło −107,00 zł (BLIK, „www.musicce nter.com.pl” w MT940, „Lokalizacja: www.musiccenter.com.pl”
-- w PDF), a sklep — bez towaru i bez faktury — od razu oddał +107,00 zł. Obie operacje czekały na dokument („Brak dokumentu”),
-- choć dowodem jest sam wyciąg. Ten sam mechanizm działa w drugą stronę (klient zapłacił, my zwróciliśmy).
--
--  1. bank_transaction_refund_pairs — para: działalność, operacja pierwotna (wcześniejsza), operacja zwrotu (przeciwny kierunek,
--     ta sama działalność i waluta, tylko operacje główne — nie kopie z drugiego wyciągu, nie przeniesienia własne), kwota pary,
--     automatic / manual, powody, kto, kiedy. Zwrot częściowy: kwota pary mniejsza niż płatność — reszta płatności nadal
--     czeka na fakturę. Jedna operacja może mieć kilka par (np. dwa zwroty częściowe).
--  2. Jeden limit kwoty operacji: kwota pary liczy się po obu stronach razem z fakturami, wypłatami, deklaracjami i umowami
--     stałymi (private.bank_transaction_allocated); status operacji (recalculate_bank_transaction_match_state), strażnicy,
--     scalanie i przejmowanie kopii operacji (PDF ↔ MT940) obejmują pary.
--  3. reconcile_bank_month — reguła „zwrot płatności” przed regułą „zgodna kwota”: operacja otwarta i dokładnie jedna operacja
--     przeciwnego kierunku z tej samej działalności (także z sąsiednich miesięcy) z równą pozostałą kwotą (co do grosza),
--     datą ±45 dni i wspólnym wyróżniającym słowem w treści (porównanie także bez spacji — MT940 łamie słowa: „MUSICCE NTER”;
--     bez słów ogólnych, liczb, nazwy własnej działalności i słów częstych po obu stronach rachunku) albo tym samym rachunkiem
--     kontrahenta → propozycja; kilka takich operacji → wybór. Nigdy automatycznie — parę zatwierdza człowiek.
--     Akceptacja tworzy parę i zamyka propozycję tej samej pary po drugiej stronie; odrzucenie i cofnięcie blokują tę parę
--     po obu stronach. Licznik refund_proposals w podsumowaniu przebiegu.
--  4. accept_bank_reconciliation_proposal obsługuje dokumenty „refund”; reject_bank_reconciliation_proposal zamyka propozycję
--     tej samej pary po drugiej stronie; get_bank_reconciliation_month pokazuje przy operacji pary (refunds).
--  5. RPC: link_bank_refund_pair (ręczne powiązanie; kwota domyślnie = mniejsza z pozostałych kwot), undo_bank_refund_pair,
--     get_bank_refund_candidates (okno wyboru: operacje przeciwnego kierunku ±90 dni z pozostałą kwotą, z powodami).
--  6. Kontrola końcowa: żadna funkcja w public / private nie ma UPDATE ani DELETE bez WHERE (rozszerzenie safeupdate
--     odrzuca je przy wywołaniach z API).
--
-- KSIĘGOWO: para płatność + zwrot bez faktury jest udokumentowana wyciągiem (dwie operacje znoszą się). Przy zwrocie częściowym
-- reszta płatności nadal wymaga faktury.
-- UPRAWNIENIA: jak umowy stałe — odczyt: poziom finansów działalności ≥ finance_view, zmiany: finance_manage tej działalności
-- (wyłącznie przez RPC). Zwykły pracownik, inna działalność, konto portalu sprzedawcy i anon — brak dostępu.
-- Wymaga: 20261101210000 (umowy stałe) i 20261103140000 (poprawka safeupdate w reconcile_bank_month).
-- Zmiany dużych funkcji uzgadniania są punktowe (pg_get_functiondef + zamiana fragmentu, który musi wystąpić dokładnie raz);
-- get_bank_reconciliation_month — pełna definicja oparta na wersji z 20261101210000.
-- Bez tabel tymczasowych; plik można bezpiecznie uruchomić ponownie (w całości w SQL Editorze). Każde UPDATE / DELETE ma WHERE.
BEGIN;

-- 0. Warunki wstępne -------------------------------------------------------------------------------------------
DO $pre$
BEGIN
  IF to_regclass('public.finance_recurring_contract_payments') IS NULL
     OR to_regprocedure('private.link_recurring_contract_payment(uuid,uuid,date,numeric,text,text[],uuid)') IS NULL
     OR position('auto_contracts' IN pg_get_functiondef('public.reconcile_bank_month(uuid,integer,integer)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'Najpierw zastosuj migrację 20261101210000_finance_recurring_contracts.sql (umowy stałe).';
  END IF;
  IF position('WHERE true;  -- WHERE wymagany przez safeupdate' IN pg_get_functiondef('public.reconcile_bank_month(uuid,integer,integer)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'Najpierw zastosuj migrację 20261103140000_reconcile_safeupdate_fix.sql (UPDATE bez WHERE w reconcile_bank_month).';
  END IF;
  IF to_regprocedure('private.require_finance_manage_for_transaction(uuid)') IS NULL
     OR to_regprocedure('public.finance_company_level_at_least(uuid,text)') IS NULL
     OR to_regprocedure('private.add_bank_proposal(uuid,text,text,jsonb,text)') IS NULL
     OR to_regprocedure('private.bank_norm(text)') IS NULL OR to_regprocedure('private.money_pl(numeric)') IS NULL THEN
    RAISE EXCEPTION 'Brak funkcji uzgadniania wyciągów (20261101120000, 20261101165000). Sprawdź kolejność migracji.';
  END IF;
END $pre$;

-- 1. Tabela par ---------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.bank_transaction_refund_pairs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  my_company_id uuid NOT NULL REFERENCES public.my_companies(id) ON DELETE CASCADE,
  original_transaction_id uuid NOT NULL REFERENCES public.bank_transactions(id) ON DELETE CASCADE,
  refund_transaction_id uuid NOT NULL REFERENCES public.bank_transactions(id) ON DELETE CASCADE,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  match_method text NOT NULL DEFAULT 'manual' CHECK (match_method IN ('automatic', 'manual')),
  match_reasons text[] NOT NULL DEFAULT ARRAY[]::text[],
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bank_transaction_refund_pairs_distinct CHECK (original_transaction_id <> refund_transaction_id)
);
-- Jedna para na dwie operacje (niezależnie od kolejności).
CREATE UNIQUE INDEX IF NOT EXISTS uq_bank_transaction_refund_pairs_pair ON public.bank_transaction_refund_pairs
  (least(original_transaction_id, refund_transaction_id), greatest(original_transaction_id, refund_transaction_id));
CREATE INDEX IF NOT EXISTS idx_bank_transaction_refund_pairs_original ON public.bank_transaction_refund_pairs(original_transaction_id);
CREATE INDEX IF NOT EXISTS idx_bank_transaction_refund_pairs_refund ON public.bank_transaction_refund_pairs(refund_transaction_id);
CREATE INDEX IF NOT EXISTS idx_bank_transaction_refund_pairs_company ON public.bank_transaction_refund_pairs(my_company_id);
-- Odrzucenia par są szukane po operacji (dotąd tylko indeks otwartych propozycji).
CREATE INDEX IF NOT EXISTS idx_bank_reconciliation_proposals_tx ON public.bank_reconciliation_proposals(bank_transaction_id);
COMMENT ON TABLE public.bank_transaction_refund_pairs IS
  'Zwrot płatności bez faktury: płatność (operacja pierwotna) i zwrot (operacja przeciwnego kierunku) z wyciągów tej samej działalności. Kwota pary liczy się do limitu kwoty obu operacji razem z fakturami, wypłatami, deklaracjami i umowami stałymi.';
COMMENT ON COLUMN public.bank_transaction_refund_pairs.original_transaction_id IS 'Operacja pierwotna (wcześniejsza): płatność, którą zwrócono.';
COMMENT ON COLUMN public.bank_transaction_refund_pairs.refund_transaction_id IS 'Operacja zwrotu (późniejsza, przeciwny kierunek).';
COMMENT ON COLUMN public.bank_transaction_refund_pairs.amount IS 'Kwota pary. Zwrot częściowy: mniej niż płatność — reszta płatności nadal wymaga faktury.';

-- RLS: odczyt — poziom finansów działalności ≥ finance_view; zapis wyłącznie przez RPC (SECURITY DEFINER).
ALTER TABLE public.bank_transaction_refund_pairs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bank_transaction_refund_pairs_read ON public.bank_transaction_refund_pairs;
DROP POLICY IF EXISTS sales_finance_private ON public.bank_transaction_refund_pairs;
CREATE POLICY sales_finance_private ON public.bank_transaction_refund_pairs AS RESTRICTIVE FOR ALL TO authenticated
  USING (public.invoice_finance_scope() <> 'sales') WITH CHECK (public.invoice_finance_scope() <> 'sales');
CREATE POLICY bank_transaction_refund_pairs_read ON public.bank_transaction_refund_pairs FOR SELECT TO authenticated
  USING (public.finance_company_level_at_least(my_company_id, 'finance_view'));
REVOKE ALL ON public.bank_transaction_refund_pairs FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.bank_transaction_refund_pairs FROM authenticated;
GRANT SELECT ON public.bank_transaction_refund_pairs TO authenticated;
GRANT ALL ON public.bank_transaction_refund_pairs TO service_role;

-- 2. Funkcje pomocnicze (tylko dla funkcji serwera) ------------------------------------------------------------------
-- Treść operacji do porównań: tytuł, opis, kontrahent, referencja — także z kopii w drugim wyciągu (jak w reconcile_bank_month).
CREATE OR REPLACE FUNCTION private.bank_transaction_text_norm(p_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT private.bank_norm(concat_ws(' ', bt.title, bt.raw_description, bt.counterparty_name, bt.raw_counterparty, bt.reference_number,
    (SELECT string_agg(concat_ws(' ', c.title, c.raw_description, c.counterparty_name, c.raw_counterparty), ' ')
     FROM public.bank_transactions c WHERE c.canonical_transaction_id = bt.id)))
  FROM public.bank_transactions bt WHERE bt.id = p_id
$$;

-- MT940 skleja numer pola z treścią („~32MUSIC STORE” → „32MUSIC”) — usuwamy dwucyfrowy kod przed literami.
CREATE OR REPLACE FUNCTION private.bank_refund_norm(p_text_norm text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = pg_catalog AS $$
  SELECT regexp_replace(coalesce(p_text_norm, ''), '(^| )[0-9]{2}([A-Z])', '\1\2', 'g')
$$;

-- Wyróżniające słowa treści: same litery, 4–40 znaków, bez słów ogólnych (bankowych, form prawnych, stopek wyciągów, miast,
-- miesięcy) i bez słów z nazwy i adresu własnej działalności (p_exclude).
CREATE OR REPLACE FUNCTION private.bank_refund_words(p_text_norm text, p_exclude text DEFAULT NULL)
RETURNS text[] LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = pg_catalog AS $$
  SELECT coalesce(array_agg(DISTINCT x.w), '{}'::text[])
  FROM regexp_split_to_table(private.bank_refund_norm(p_text_norm), ' ') AS x(w)
  WHERE length(x.w) BETWEEN 4 AND 40 AND x.w ~ '^[A-Z]+$'
    AND position(' ' || x.w || ' ' IN ' ' || coalesce(p_exclude, '') || ' ') = 0
    AND NOT (x.w = ANY (ARRAY[
      'PRZELEW', 'PRZELEWU', 'PRZELEWY', 'PRZELEWEM', 'PRZELEWOW', 'PLATNOSC', 'PLATNOSCI', 'PLATNOSCIA', 'ZAKUP', 'ZAKUPU', 'ZAKUPY',
      'ZWROT', 'ZWROTU', 'ZWROTY', 'KARTA', 'KARTY', 'KARTE', 'KARTOWA', 'KARTOWY', 'BLIK', 'GODZ', 'GODZINA', 'LOKALIZACJA',
      'LOKALIZACJI', 'HTTP', 'HTTPS', 'POLSKA', 'POLSKI', 'POLSKIE', 'POLSKIEGO', 'NONREF', 'KWOTA', 'KWOTY', 'ORYG', 'ORYGINALNA',
      'NAZWISKO', 'IMIE', 'PRZY', 'UZYCIU', 'OKRES', 'FAKTURA', 'FAKTURY', 'FAKTURE', 'FAKTURZE', 'NUMER', 'NUMERU', 'NUMEROW',
      'TYTUL', 'TYTULEM', 'TYTULU', 'OPIS', 'DATA', 'DATY', 'DNIA', 'WALUTA', 'WALUTY', 'OPERACJA', 'OPERACJI', 'TRANSAKCJA',
      'TRANSAKCJI', 'WYCHODZACY', 'PRZYCHODZACY', 'PRZYCH', 'PRZETW', 'DOSTAWCY', 'ZBIORCZOSCI', 'RACHUNEK', 'RACHUNKU', 'RACH',
      'KONTO', 'KONTA', 'BANK', 'BANKU', 'BANKOWY', 'BANKOWA', 'BANKOWE', 'BANKOWYM', 'OPLATA', 'OPLATY', 'OPLAT', 'PROWIZJA',
      'MOBILNY', 'MOBILNA', 'MOBILE', 'ONLINE', 'INTERNET', 'INTERNETOWY', 'INTERNETOWA', 'ELIXIR', 'SORBNET', 'EXPRESS',
      'NATYCHMIASTOWY', 'UZNANIE', 'OBCIAZENIE', 'WPLATA', 'WPLATY', 'WYPLATA', 'WYPLATY', 'SPOLKA', 'SPOLKI', 'SPOKA',
      'OGRANICZONA', 'OGRANICZON', 'ODPOWIEDZIALNOSCIA', 'ODPOWIEDZIALNOCI', 'AKCYJNA', 'JAWNA', 'KOMANDYTOWA', 'CYWILNA', 'FIRMA',
      'USLUGI', 'HANDEL', 'HANDLOWA', 'PPHU', 'GRUPA', 'CENTRUM', 'SKLEP', 'SHOP', 'STORE', 'ORDER', 'PAYMENT', 'REFUND', 'PURCHASE',
      'CARD', 'ZAMOWIENIE', 'ZAMOWIENIA', 'TERMINAL', 'TERMINALU', 'STACJA', 'SPLIT', 'IDENTYFIKATOR', 'TELEFON', 'NADAWCA',
      'NADAWCY', 'ODBIORCA', 'ODBIORCY', 'ADRES', 'ULICA', 'INFO', 'ZLEC', 'ZLECENIE', 'WLASNA', 'WLASNY', 'WLASNE', 'WLASNEJ',
      'WLASNEGO', 'SRODKI', 'SRODKOW', 'GOTOWKA', 'GOTOWKI', 'WPLATOMAT', 'BANKOMAT',
      'REJONOWY', 'WYDZIAL', 'WPLACONY', 'WYDRUKIEM', 'PODPISU', 'DOKUMENT', 'DOKUMENTU', 'SADOWEGO', 'KRAJOWEGO', 'REGON', 'KAPITAL',
      'ZAKLADOWY', 'REJESTRU', 'POWSZECHNA', 'GOSPODARCZY', 'OSZCZEDNOSCI', 'NINIEJSZY', 'WYMAGA', 'PIECZECI', 'KASA',
      'INFORMATYCZNEGO', 'SYSTEMU', 'SYSTEM', 'KRAJOWYCH', 'INFOLINIA', 'KRAJU', 'TERENIE', 'BRAK', 'TARYFA', 'WYCIAG',
      'POZOSTALYCH', 'OPERATORA', 'ZGODNA', 'PKOBP', 'JEST', 'ORAZ', 'PRZEZ',
      'WARSZAWA', 'WARSZAWIE', 'WARSZAWY', 'KRAKOW', 'KRAKOWIE', 'LODZ', 'WROCLAW', 'POZNAN', 'GDANSK', 'GDYNIA', 'SZCZECIN',
      'BYDGOSZCZ', 'LUBLIN', 'KATOWICE', 'BIALYSTOK', 'OLSZTYN', 'RZESZOW', 'TORUN', 'KIELCE', 'OPOLE',
      'STYCZNIA', 'LUTEGO', 'MARCA', 'KWIETNIA', 'MAJA', 'CZERWCA', 'LIPCA', 'SIERPNIA', 'WRZESNIA', 'PAZDZIERNIKA', 'LISTOPADA',
      'GRUDNIA']))
$$;

-- Wspólne słowa dwóch treści: słowo jednej treści jest słowem drugiej albo (od 6 znaków) występuje w niej po usunięciu spacji
-- („MUSICCENTER” ↔ „MUSICCE NTER”). Fragmenty dłuższego wspólnego słowa są pomijane; najdłuższe pierwsze.
-- Słowa i treść bez spacji pierwszej operacji liczy raz wywołujący (p_a_words = bank_refund_words(a), p_a_compact).
CREATE OR REPLACE FUNCTION private.bank_refund_common_words(p_a_words text[], p_a_compact text, p_b text, p_exclude text DEFAULT NULL)
RETURNS text[] LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = pg_catalog AS $$
  WITH a AS (SELECT unnest(coalesce(p_a_words, '{}'::text[])) AS w),
       b AS (SELECT unnest(private.bank_refund_words(p_b, p_exclude)) AS w),
       hit AS (
         SELECT a.w FROM a
         WHERE a.w IN (SELECT b.w FROM b)
            OR (length(a.w) >= 6 AND position(a.w IN replace(private.bank_refund_norm(p_b), ' ', '')) > 0)
         UNION
         SELECT b.w FROM b
         WHERE length(b.w) >= 6 AND position(b.w IN coalesce(p_a_compact, '')) > 0)
  SELECT coalesce(array_agg(h.w ORDER BY length(h.w) DESC, h.w), '{}'::text[])
  FROM hit h
  WHERE NOT EXISTS (SELECT 1 FROM hit l WHERE length(l.w) > length(h.w) AND position(h.w IN l.w) > 0)
$$;

-- Nazwa do wyświetlenia: sprzedawca z „Lokalizacja: …” (płatności kartą / BLIK, także z kopii PDF), kontrahent, tytuł.
CREATE OR REPLACE FUNCTION private.bank_transaction_party_label(p_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT coalesce(
    (SELECT (regexp_match(concat_ws(' ', bt.title, bt.raw_description, bt.counterparty_name,
              string_agg(concat_ws(' ', c.title, c.raw_description, c.counterparty_name), ' ')), 'Lokalizacja:\s*([^\s]+)', 'i'))[1]
     FROM public.bank_transactions c WHERE c.canonical_transaction_id = bt.id),
    nullif(btrim(bt.counterparty_name), ''), nullif(btrim(bt.raw_counterparty), ''), left(nullif(btrim(bt.title), ''), 120))
  FROM public.bank_transactions bt WHERE bt.id = p_id
$$;

-- Która operacja jest pierwotna: wcześniejsza data, potem kolejność w wyciągu.
CREATE OR REPLACE FUNCTION private.bank_refund_is_first(p_a uuid, p_b uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT (x.transaction_date, coalesce(x.source_index, 2147483647), x.id::text)
      <= (y.transaction_date, coalesce(y.source_index, 2147483647), y.id::text)
  FROM public.bank_transactions x, public.bank_transactions y WHERE x.id = p_a AND y.id = p_b
$$;

-- Para odrzucona albo cofnięta przez człowieka (zapis po którejkolwiek stronie) — automat jej nie proponuje.
CREATE OR REPLACE FUNCTION private.bank_refund_pair_blocked(p_a uuid, p_b uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.bank_reconciliation_proposals pr CROSS JOIN LATERAL jsonb_array_elements(pr.documents) e
    WHERE pr.status = 'rejected' AND pr.bank_transaction_id IN (p_a, p_b) AND e ->> 'source' = 'refund'
      AND ((pr.bank_transaction_id = p_a AND e ->> 'id' = p_b::text) OR (pr.bank_transaction_id = p_b AND e ->> 'id' = p_a::text)))
$$;

-- Dokument propozycji uzgodnienia operacji p_tx: druga operacja pary (p_other).
CREATE OR REPLACE FUNCTION private.bank_refund_doc(p_tx uuid, p_other uuid, p_amount numeric, p_evidence text DEFAULT NULL)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT jsonb_strip_nulls(jsonb_build_object(
    'source', 'refund', 'id', o.id, 'statement_id', o.statement_id,
    'role', CASE WHEN private.bank_refund_is_first(p_tx, o.id) THEN 'refund' ELSE 'payment' END,
    'number', CASE WHEN private.bank_refund_is_first(p_tx, o.id) THEN 'Zwrot ' ELSE 'Zwrócona płatność ' END
      || CASE WHEN o.transaction_type = 'credit' THEN '+' ELSE '−' END || private.money_pl(abs(o.amount))
      || ' z ' || to_char(o.transaction_date, 'DD.MM.YYYY'),
    'party', private.bank_transaction_party_label(o.id), 'title', o.title,
    'amount', round(p_amount, 2), 'date', o.transaction_date, 'direction', o.transaction_type, 'tx_amount', abs(o.amount),
    'remaining', round(greatest(abs(o.amount) - private.bank_transaction_allocated(o.id), 0), 2),
    'statement_year', s.statement_year, 'statement_month', s.statement_month, 'evidence', p_evidence))
  FROM public.bank_transactions o JOIN public.bank_statements s ON s.id = o.statement_id
  WHERE o.id = p_other
$$;

-- Operacje, które mogą być drugą stroną pary dla p_transaction_id: przeciwny kierunek, ta sama działalność i waluta, operacje
-- główne (bez kopii i przeniesień własnych), data ±p_days, pozostała kwota > 0 (p_exact — równa pozostałej kwocie operacji).
-- words — wspólne wyróżniające słowa; słowo częste po obu stronach rachunku (≥ 5 wydatków i ≥ 5 wpływów w ±120 dniach:
-- nazwa właściciela, stopka wyciągu, kontrahent z obrotami w obie strony) nie jest dowodem.
CREATE OR REPLACE FUNCTION private.bank_refund_candidates(p_transaction_id uuid, p_days integer, p_exact boolean, p_search text DEFAULT NULL)
RETURNS TABLE (transaction_id uuid, statement_id uuid, tx_date date, amount numeric, remaining numeric, direction text,
  currency text, counterparty text, title text, statement_year integer, statement_month integer, day_diff integer,
  same_amount boolean, same_account boolean, words text[], evidence text, blocked boolean, explained boolean, score integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $fn$
#variable_conflict use_column
DECLARE
  v_t public.bank_transactions%ROWTYPE;
  v_company uuid;
  v_remaining numeric;
  v_text text;
  v_words text[];
  v_compact text;
  v_iban text;
  v_own text;
  v_own_accounts text[];
  v_needle text := private.bank_norm(p_search);
  v_days integer := least(greatest(coalesce(p_days, 45), 0), 366);
BEGIN
  SELECT bt.* INTO v_t FROM public.bank_transactions bt WHERE bt.id = p_transaction_id;
  IF NOT FOUND OR v_t.canonical_transaction_id IS NOT NULL THEN RETURN; END IF;
  SELECT s.my_company_id INTO v_company FROM public.bank_statements s WHERE s.id = v_t.statement_id;
  v_remaining := round(greatest(abs(v_t.amount) - private.bank_transaction_allocated(v_t.id), 0), 2);
  IF p_exact AND v_remaining <= 0.009 THEN RETURN; END IF;
  v_text := private.bank_transaction_text_norm(v_t.id);
  v_iban := regexp_replace(coalesce(v_t.counterparty_account, ''), '\D', '', 'g');
  SELECT private.bank_norm(concat_ws(' ', c.name, c.legal_name, c.city, c.street)),
         array_remove(ARRAY[nullif(regexp_replace(coalesce(c.bank_account, ''), '\D', '', 'g'), ''),
                            nullif(regexp_replace(coalesce(c.vat_bank_account, ''), '\D', '', 'g'), ''),
                            nullif(regexp_replace(coalesce(c.private_bank_account, ''), '\D', '', 'g'), '')], NULL)
  INTO v_own, v_own_accounts
  FROM public.my_companies c WHERE c.id = v_company;
  v_words := private.bank_refund_words(v_text, v_own);
  v_compact := replace(private.bank_refund_norm(v_text), ' ', '');

  RETURN QUERY
  WITH base AS MATERIALIZED (
    SELECT o.id, o.statement_id AS st_id, o.transaction_date AS d, abs(o.amount) AS amt, o.transaction_type AS dir,
           upper(coalesce(o.currency, 'PLN')) AS cur, o.title AS ttl, o.counterparty_account AS acc,
           s.statement_year AS sy, s.statement_month AS sm,
           coalesce(o.accounting_review_status = 'explained', false) AS expl,
           round(greatest(abs(o.amount) - private.bank_transaction_allocated(o.id), 0), 2) AS rem
    FROM public.bank_transactions o JOIN public.bank_statements s ON s.id = o.statement_id
    WHERE s.my_company_id = v_company AND s.processed AND s.validation_status = 'valid'
      AND o.canonical_transaction_id IS NULL AND o.id <> v_t.id
      AND o.transaction_type <> v_t.transaction_type
      AND upper(coalesce(o.currency, 'PLN')) = upper(coalesce(v_t.currency, 'PLN'))
      AND o.transaction_date BETWEEN v_t.transaction_date - v_days AND v_t.transaction_date + v_days
      AND o.paired_bank_transaction_id IS NULL AND NOT coalesce(o.private_transfer_detected, false)
      AND NOT (coalesce(o.accounting_review_status, '') = 'explained' AND coalesce(o.accounting_category, '') = 'own_transfer')
      -- Reguła automatu: tylko równa pozostała kwota — wstępnie po kwocie albo zapisanej kwocie rozliczonej (allocated_amount),
      -- dokładnie niżej (rem).
      AND (NOT p_exact OR abs(abs(o.amount) - v_remaining) <= 0.004
           OR abs(abs(o.amount) - coalesce(o.allocated_amount, 0) - v_remaining) <= 0.01)
  ), opn AS MATERIALIZED (
    SELECT b.*, private.bank_transaction_text_norm(b.id) AS txt
    FROM base b
    WHERE b.rem > 0.009 AND (NOT p_exact OR abs(b.rem - v_remaining) <= 0.004)
  ), fnd AS MATERIALIZED (
    SELECT o.*, private.bank_refund_common_words(v_words, v_compact, o.txt, v_own) AS common,
           coalesce(length(v_iban) >= 20 AND NOT (v_iban = ANY (coalesce(v_own_accounts, '{}'::text[])))
                    AND regexp_replace(coalesce(o.acc, ''), '\D', '', 'g') = v_iban, false) AS acct
    FROM opn o
    WHERE coalesce(v_needle, '') = '' OR position(v_needle IN o.txt) > 0
       OR position(replace(v_needle, ' ', '') IN replace(o.txt, ' ', '')) > 0
       OR position(replace(v_needle, ' ', '') IN replace(private.bank_norm(to_char(o.amt, 'FM999999990.00')), ' ', '')) > 0
       OR position(v_needle IN to_char(o.d, 'DD MM YYYY')) > 0
  ), allw AS (
    SELECT DISTINCT unnest(f.common) AS w FROM fnd f
  ), win AS MATERIALIZED (
    -- Częstość słowa: przybliżenie na surowej treści operacji głównych (wielkie litery bez polskich znaków, bez spacji).
    SELECT x.transaction_type AS wdir,
           replace(upper(translate(concat_ws(' ', x.title, x.raw_description, x.counterparty_name, x.raw_counterparty),
             'ąćęłńóśźżĄĆĘŁŃÓŚŹŻ', 'acelnoszzACELNOSZZ')), ' ', '') AS n
    FROM public.bank_transactions x JOIN public.bank_statements s ON s.id = x.statement_id
    WHERE EXISTS (SELECT 1 FROM allw) AND s.my_company_id = v_company AND x.canonical_transaction_id IS NULL
      AND x.transaction_date BETWEEN v_t.transaction_date - 120 AND v_t.transaction_date + 120
  ), generic AS (
    SELECT a.w FROM allw a
    CROSS JOIN LATERAL (
      SELECT count(*) FILTER (WHERE z.wdir = 'debit') AS nd, count(*) FILTER (WHERE z.wdir = 'credit') AS nc
      FROM win z WHERE position(a.w IN z.n) > 0) k
    WHERE k.nd >= 5 AND k.nc >= 5
  ), scored AS (
    SELECT f.*, ARRAY(SELECT u.w FROM unnest(f.common) WITH ORDINALITY AS u(w, ord)
                      WHERE NOT EXISTS (SELECT 1 FROM generic g WHERE g.w = u.w) ORDER BY u.ord) AS wds
    FROM fnd f
  )
  SELECT sc.id, sc.st_id, sc.d, sc.amt, sc.rem, sc.dir, sc.cur, private.bank_transaction_party_label(sc.id), sc.ttl,
         sc.sy, sc.sm, abs(sc.d - v_t.transaction_date),
         abs(sc.rem - v_remaining) <= 0.004, sc.acct, sc.wds,
         nullif(concat_ws(' i ',
           CASE WHEN cardinality(sc.wds) = 1 THEN 'wspólne słowo „' || sc.wds[1] || '”'
                WHEN cardinality(sc.wds) > 1 THEN 'wspólne słowa „' || array_to_string(sc.wds[1:3], '”, „') || '”' END,
           CASE WHEN sc.acct THEN 'ten sam rachunek kontrahenta' END), ''),
         private.bank_refund_pair_blocked(v_t.id, sc.id), sc.expl,
         (CASE WHEN abs(sc.rem - v_remaining) <= 0.004 THEN 4 ELSE 0 END
          + CASE WHEN cardinality(sc.wds) > 0 THEN 2 ELSE 0 END + CASE WHEN sc.acct THEN 2 ELSE 0 END)::integer
  FROM scored sc;
END;
$fn$;

CREATE OR REPLACE FUNCTION private.require_finance_refunds(p_company_id uuid, p_manage boolean, p_missing text)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF p_company_id IS NULL THEN
    RAISE EXCEPTION '%', coalesce(p_missing, 'Nie znaleziono operacji. Odśwież widok.');
  END IF;
  IF auth.role() IS DISTINCT FROM 'service_role' AND NOT coalesce(
       CASE WHEN p_manage THEN public.finance_company_manageable(p_company_id)
            ELSE public.finance_company_level_at_least(p_company_id, 'finance_view') END, false) THEN
    RAISE EXCEPTION 'Brak uprawnień do rozliczania płatności tej działalności.' USING ERRCODE = '42501';
  END IF;
END;
$$;

-- 3. Jeden limit kwoty operacji, strażnik i stan operacji -----------------------------------------------------------
CREATE OR REPLACE FUNCTION private.bank_transaction_allocated(p_transaction_id uuid,
  p_skip_match uuid DEFAULT NULL, p_skip_personnel uuid DEFAULT NULL, p_skip_declaration uuid DEFAULT NULL)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT coalesce((SELECT sum(m.amount) FROM public.bank_transaction_invoice_matches m
                   WHERE m.bank_transaction_id = p_transaction_id AND m.id IS DISTINCT FROM p_skip_match), 0)
       + coalesce((SELECT sum(p.amount) FROM public.personnel_contract_payments p
                   WHERE p.bank_transaction_id = p_transaction_id AND p.id IS DISTINCT FROM p_skip_personnel), 0)
       + coalesce((SELECT sum(f.amount) FROM public.finance_declaration_payments f
                   WHERE f.bank_transaction_id = p_transaction_id AND f.id IS DISTINCT FROM p_skip_declaration), 0)
       + coalesce((SELECT sum(r.amount) FROM public.finance_recurring_contract_payments r
                   WHERE r.bank_transaction_id = p_transaction_id), 0)
       + coalesce((SELECT sum(z.amount) FROM public.bank_transaction_refund_pairs z
                   WHERE z.original_transaction_id = p_transaction_id OR z.refund_transaction_id = p_transaction_id), 0)
$$;

CREATE OR REPLACE FUNCTION private.guard_bank_refund_pair()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_side public.bank_transactions%ROWTYPE;
  v_other public.bank_transactions%ROWTYPE;
  v_company uuid;
  v_other_company uuid;
  v_allocated numeric;
  v_id uuid;
BEGIN
  IF NEW.original_transaction_id = NEW.refund_transaction_id THEN
    RAISE EXCEPTION 'Płatność i zwrot to dwie różne operacje.' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO v_side FROM public.bank_transactions WHERE id = NEW.original_transaction_id;
  SELECT * INTO v_other FROM public.bank_transactions WHERE id = NEW.refund_transaction_id;
  IF v_side.id IS NULL OR v_other.id IS NULL THEN
    RAISE EXCEPTION 'Nie znaleziono operacji. Odśwież widok.' USING ERRCODE = '23514';
  END IF;
  IF v_side.canonical_transaction_id IS NOT NULL OR v_other.canonical_transaction_id IS NOT NULL THEN
    RAISE EXCEPTION 'Operacja z % to kopia z drugiego wyciągu (PDF/MT940). Łącz operację potwierdzoną.',
      to_char(CASE WHEN v_side.canonical_transaction_id IS NOT NULL THEN v_side.transaction_date ELSE v_other.transaction_date END, 'DD.MM.YYYY')
      USING ERRCODE = '23514';
  END IF;
  IF v_side.paired_bank_transaction_id IS NOT NULL OR v_other.paired_bank_transaction_id IS NOT NULL
     OR coalesce(v_side.private_transfer_detected, false) OR coalesce(v_other.private_transfer_detected, false)
     OR (v_side.accounting_review_status = 'explained' AND v_side.accounting_category = 'own_transfer')
     OR (v_other.accounting_review_status = 'explained' AND v_other.accounting_category = 'own_transfer') THEN
    RAISE EXCEPTION 'Przeniesienie między własnymi rachunkami (bieżący ↔ VAT, przelew własny) nie jest płatnością ani zwrotem.'
      USING ERRCODE = '23514';
  END IF;
  IF v_side.transaction_type = v_other.transaction_type THEN
    RAISE EXCEPTION 'Płatność i zwrot muszą mieć przeciwne kierunki (wydatek i wpływ).' USING ERRCODE = '23514';
  END IF;
  SELECT s.my_company_id INTO v_company FROM public.bank_statements s WHERE s.id = v_side.statement_id;
  SELECT s.my_company_id INTO v_other_company FROM public.bank_statements s WHERE s.id = v_other.statement_id;
  IF v_company IS DISTINCT FROM v_other_company OR v_company IS DISTINCT FROM NEW.my_company_id THEN
    RAISE EXCEPTION 'Płatność i zwrot należą do różnych działalności.' USING ERRCODE = '23514';
  END IF;
  IF upper(coalesce(v_side.currency, 'PLN')) <> upper(coalesce(v_other.currency, 'PLN')) THEN
    RAISE EXCEPTION 'Płatność i zwrot muszą być w tej samej walucie (% i %).',
      upper(coalesce(v_side.currency, 'PLN')), upper(coalesce(v_other.currency, 'PLN')) USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.original_transaction_id = OLD.original_transaction_id
     AND NEW.refund_transaction_id = OLD.refund_transaction_id AND NEW.amount <= OLD.amount THEN
    RETURN NEW;
  END IF;
  -- Limit kwoty po obu stronach (bez tej pary, gdy to zmiana istniejącej).
  FOREACH v_id IN ARRAY ARRAY[NEW.original_transaction_id, NEW.refund_transaction_id] LOOP
    SELECT * INTO v_side FROM public.bank_transactions WHERE id = v_id;
    v_allocated := private.bank_transaction_allocated(v_id)
      - CASE WHEN TG_OP = 'UPDATE' AND v_id IN (OLD.original_transaction_id, OLD.refund_transaction_id) THEN OLD.amount ELSE 0 END;
    IF v_allocated + NEW.amount > abs(v_side.amount) + 0.01 THEN
      RAISE EXCEPTION 'Operacja z % na % byłaby rozliczona ponad swoją kwotę (przypisano już %).',
        to_char(v_side.transaction_date, 'DD.MM.YYYY'), private.money_pl(abs(v_side.amount)), private.money_pl(v_allocated)
        USING ERRCODE = '23514';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS bank_transaction_refund_pair_guard ON public.bank_transaction_refund_pairs;
CREATE TRIGGER bank_transaction_refund_pair_guard
  BEFORE INSERT OR UPDATE OF original_transaction_id, refund_transaction_id, amount, my_company_id ON public.bank_transaction_refund_pairs
  FOR EACH ROW EXECUTE FUNCTION private.guard_bank_refund_pair();

CREATE OR REPLACE FUNCTION private.sync_bank_refund_pair_state()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_id uuid;
BEGIN
  FOREACH v_id IN ARRAY ARRAY(SELECT DISTINCT x FROM unnest(ARRAY[
      CASE WHEN TG_OP <> 'DELETE' THEN NEW.original_transaction_id END, CASE WHEN TG_OP <> 'DELETE' THEN NEW.refund_transaction_id END,
      CASE WHEN TG_OP <> 'INSERT' THEN OLD.original_transaction_id END, CASE WHEN TG_OP <> 'INSERT' THEN OLD.refund_transaction_id END]) x
      WHERE x IS NOT NULL) LOOP
    PERFORM public.recalculate_bank_transaction_match_state(v_id);
  END LOOP;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS bank_transaction_refund_pair_sync ON public.bank_transaction_refund_pairs;
CREATE TRIGGER bank_transaction_refund_pair_sync
  AFTER INSERT OR UPDATE OR DELETE ON public.bank_transaction_refund_pairs
  FOR EACH ROW EXECUTE FUNCTION private.sync_bank_refund_pair_state();

-- Status operacji: pary liczą się jak płatności umów (treść z 20261101210000 + pary zwrotu).
DO $chk$
DECLARE
  v_def text := pg_get_functiondef('public.recalculate_bank_transaction_match_state(uuid)'::regprocedure);
BEGIN
  IF position('bank_transaction_refund_pairs' IN v_def) = 0 AND position('v_contract_manual' IN v_def) = 0 THEN
    RAISE EXCEPTION 'recalculate_bank_transaction_match_state ma nieoczekiwaną treść (brak obsługi umów stałych z 20261101210000). Sprawdź ręcznie.';
  END IF;
END $chk$;

CREATE OR REPLACE FUNCTION public.recalculate_bank_transaction_match_state(p_transaction_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE
  v_total numeric(15,2);
  v_invoice_allocated numeric(15,2);
  v_personnel_allocated numeric(15,2);
  v_declaration_allocated numeric(15,2);
  v_contract_allocated numeric(15,2);
  v_refund_allocated numeric(15,2);
  v_invoice_count integer;
  v_personnel_count integer;
  v_declaration_count integer;
  v_contract_count integer;
  v_refund_count integer;
  v_declaration_manual boolean;
  v_contract_manual boolean;
  v_refund_manual boolean;
  v_allocated numeric(15,2);
  v_count integer;
  v_single_ksef uuid;
  v_confidence numeric(4,3);
  v_manual boolean;
BEGIN
  SELECT ABS(bt.amount) INTO v_total FROM public.bank_transactions bt WHERE bt.id = p_transaction_id;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT COALESCE(SUM(bank_match.amount), 0), COUNT(*),
         CASE WHEN COUNT(*) = 1 THEN (ARRAY_AGG(bank_match.ksef_invoice_id))[1] END,
         MAX(bank_match.confidence),
         COALESCE(BOOL_OR(bank_match.match_method IN ('manual', 'legacy')), false)
  INTO v_invoice_allocated, v_invoice_count, v_single_ksef, v_confidence, v_manual
  FROM public.bank_transaction_invoice_matches bank_match
  WHERE bank_match.bank_transaction_id = p_transaction_id;

  SELECT COALESCE(SUM(personnel_payment.amount), 0), COUNT(*)
  INTO v_personnel_allocated, v_personnel_count
  FROM public.personnel_contract_payments personnel_payment
  WHERE personnel_payment.bank_transaction_id = p_transaction_id;

  SELECT COALESCE(SUM(f.amount), 0), COUNT(*), COALESCE(BOOL_OR(f.match_method = 'manual'), false)
  INTO v_declaration_allocated, v_declaration_count, v_declaration_manual
  FROM public.finance_declaration_payments f
  WHERE f.bank_transaction_id = p_transaction_id;

  SELECT COALESCE(SUM(r.amount), 0), COUNT(*), COALESCE(BOOL_OR(r.match_method = 'manual'), false)
  INTO v_contract_allocated, v_contract_count, v_contract_manual
  FROM public.finance_recurring_contract_payments r
  WHERE r.bank_transaction_id = p_transaction_id;

  -- Pary „płatność + zwrot” — po obu stronach.
  SELECT COALESCE(SUM(z.amount), 0), COUNT(*), COALESCE(BOOL_OR(z.match_method = 'manual'), false)
  INTO v_refund_allocated, v_refund_count, v_refund_manual
  FROM public.bank_transaction_refund_pairs z
  WHERE z.original_transaction_id = p_transaction_id OR z.refund_transaction_id = p_transaction_id;

  v_allocated := ROUND(COALESCE(v_invoice_allocated, 0) + COALESCE(v_personnel_allocated, 0) + COALESCE(v_declaration_allocated, 0)
    + COALESCE(v_contract_allocated, 0) + COALESCE(v_refund_allocated, 0), 2);
  v_count := COALESCE(v_invoice_count, 0) + COALESCE(v_personnel_count, 0) + COALESCE(v_declaration_count, 0) + COALESCE(v_contract_count, 0)
    + COALESCE(v_refund_count, 0);

  UPDATE public.bank_transactions
  SET allocated_amount = v_allocated,
      matched_document_count = v_count,
      match_status = CASE
        WHEN v_allocated <= 0.009 THEN 'unmatched'
        WHEN v_allocated >= v_total - 0.01 THEN 'matched'
        ELSE 'partial'
      END,
      matched_invoice_id = CASE WHEN v_count = 1 AND v_personnel_count = 0 AND v_declaration_count = 0 AND v_contract_count = 0
                                     AND v_refund_count = 0 THEN v_single_ksef END,
      match_confidence = v_confidence,
      manual_match = v_manual OR v_personnel_count > 0 OR v_declaration_manual OR v_contract_manual OR v_refund_manual
  WHERE id = p_transaction_id;
END;
$function$;

-- Scalanie i przejmowanie kopii operacji (PDF ↔ MT940) przenosi też pary; operacja z parą i kopią w drugim pliku nie może
-- zniknąć bez decyzji (jak przy fakturach, wypłatach, deklaracjach i umowach).
DO $patch$
DECLARE
  v_fns regprocedure[] := ARRAY[
    'private.merge_bank_transaction_copy(uuid,uuid)'::regprocedure,
    'private.merge_bank_transaction_copy(uuid,uuid)'::regprocedure,
    'private.merge_bank_transaction_copy(uuid,uuid)'::regprocedure,
    'private.promote_bank_transaction_copy_for(uuid)'::regprocedure,
    'private.promote_bank_transaction_copy()'::regprocedure];
  v_olds text[] := ARRAY[
    E'            OR EXISTS (SELECT 1 FROM public.finance_recurring_contract_payments WHERE bank_transaction_id = c.id);',
    E'            OR EXISTS (SELECT 1 FROM public.finance_recurring_contract_payments WHERE bank_transaction_id = p.id);',
    E'    UPDATE public.finance_recurring_contract_payments SET bank_transaction_id = c.id WHERE bank_transaction_id = p.id;',
    E'  UPDATE public.finance_recurring_contract_payments SET bank_transaction_id = v_copy WHERE bank_transaction_id = o.id;',
    E'       OR EXISTS (SELECT 1 FROM public.finance_recurring_contract_payments r WHERE r.bank_transaction_id = OLD.id) THEN'];
  v_news text[] := ARRAY[
    E'            OR EXISTS (SELECT 1 FROM public.finance_recurring_contract_payments WHERE bank_transaction_id = c.id)\n'
      || E'            OR EXISTS (SELECT 1 FROM public.bank_transaction_refund_pairs WHERE original_transaction_id = c.id OR refund_transaction_id = c.id);',
    E'            OR EXISTS (SELECT 1 FROM public.finance_recurring_contract_payments WHERE bank_transaction_id = p.id)\n'
      || E'            OR EXISTS (SELECT 1 FROM public.bank_transaction_refund_pairs WHERE original_transaction_id = p.id OR refund_transaction_id = p.id);',
    E'    UPDATE public.finance_recurring_contract_payments SET bank_transaction_id = c.id WHERE bank_transaction_id = p.id;\n'
      || E'    UPDATE public.bank_transaction_refund_pairs SET original_transaction_id = c.id WHERE original_transaction_id = p.id;\n'
      || E'    UPDATE public.bank_transaction_refund_pairs SET refund_transaction_id = c.id WHERE refund_transaction_id = p.id;',
    E'  UPDATE public.finance_recurring_contract_payments SET bank_transaction_id = v_copy WHERE bank_transaction_id = o.id;\n'
      || E'  UPDATE public.bank_transaction_refund_pairs SET original_transaction_id = v_copy WHERE original_transaction_id = o.id;\n'
      || E'  UPDATE public.bank_transaction_refund_pairs SET refund_transaction_id = v_copy WHERE refund_transaction_id = o.id;',
    E'       OR EXISTS (SELECT 1 FROM public.finance_recurring_contract_payments r WHERE r.bank_transaction_id = OLD.id)\n'
      || E'       OR EXISTS (SELECT 1 FROM public.bank_transaction_refund_pairs z WHERE z.original_transaction_id = OLD.id OR z.refund_transaction_id = OLD.id) THEN'];
  v_fn regprocedure;
  v_def text;
  i int;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY(SELECT DISTINCT unnest(v_fns)) LOOP
    v_def := pg_get_functiondef(v_fn);
    IF position('bank_transaction_refund_pairs' IN v_def) > 0 THEN
      RAISE NOTICE '% obsługuje już pary zwrotu — pomijam.', v_fn;
      CONTINUE;
    END IF;
    FOR i IN 1 .. array_length(v_fns, 1) LOOP
      CONTINUE WHEN v_fns[i] <> v_fn;
      IF (length(v_def) - length(replace(v_def, v_olds[i], ''))) / length(v_olds[i]) <> 1 THEN
        RAISE EXCEPTION '% ma nieoczekiwaną treść (fragment nr %). Sprawdź ręcznie.', v_fn, i;
      END IF;
      v_def := replace(v_def, v_olds[i], v_news[i]);
    END LOOP;
    EXECUTE v_def;
  END LOOP;
END $patch$;

-- 4. Powiązanie dwóch operacji (wspólne dla RPC i zatwierdzenia propozycji) --------------------------------------------
CREATE OR REPLACE FUNCTION private.link_bank_refund_pair(p_transaction_id uuid, p_other_transaction_id uuid, p_amount numeric,
  p_method text, p_reasons text[], p_company_id uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_a public.bank_transactions%ROWTYPE;
  v_b public.bank_transactions%ROWTYPE;
  v_company uuid;
  v_other_company uuid;
  v_original uuid;
  v_refund uuid;
  v_rem_a numeric;
  v_rem_b numeric;
  v_amount numeric;
  v_existing numeric;
  v_id uuid;
BEGIN
  IF p_transaction_id IS NULL OR p_other_transaction_id IS NULL OR p_transaction_id = p_other_transaction_id THEN
    RAISE EXCEPTION 'Wybierz drugą operację pary (płatność albo zwrot).';
  END IF;
  -- Blokada obu operacji w stałej kolejności (bez zakleszczeń przy równoczesnym łączeniu).
  PERFORM 1 FROM public.bank_transactions WHERE id IN (p_transaction_id, p_other_transaction_id) ORDER BY id FOR UPDATE;
  SELECT * INTO v_a FROM public.bank_transactions WHERE id = p_transaction_id;
  SELECT * INTO v_b FROM public.bank_transactions WHERE id = p_other_transaction_id;
  IF v_a.id IS NULL OR v_b.id IS NULL THEN RAISE EXCEPTION 'Nie znaleziono operacji. Odśwież widok.'; END IF;
  SELECT s.my_company_id INTO v_company FROM public.bank_statements s WHERE s.id = v_a.statement_id;
  SELECT s.my_company_id INTO v_other_company FROM public.bank_statements s WHERE s.id = v_b.statement_id;
  IF v_company IS DISTINCT FROM v_other_company OR (p_company_id IS NOT NULL AND v_company IS DISTINCT FROM p_company_id) THEN
    RAISE EXCEPTION 'Płatność i zwrot należą do różnych działalności.';
  END IF;
  IF v_a.transaction_type = v_b.transaction_type THEN
    RAISE EXCEPTION 'Płatność i zwrot muszą mieć przeciwne kierunki (wydatek i wpływ).';
  END IF;
  SELECT z.amount INTO v_existing FROM public.bank_transaction_refund_pairs z
  WHERE (z.original_transaction_id = v_a.id AND z.refund_transaction_id = v_b.id)
     OR (z.original_transaction_id = v_b.id AND z.refund_transaction_id = v_a.id);
  IF FOUND THEN
    RAISE EXCEPTION 'Te operacje są już powiązane jako płatność i zwrot (kwota %). Cofnij powiązanie, aby zmienić kwotę.', private.money_pl(v_existing);
  END IF;
  v_rem_a := round(greatest(abs(v_a.amount) - private.bank_transaction_allocated(v_a.id), 0), 2);
  v_rem_b := round(greatest(abs(v_b.amount) - private.bank_transaction_allocated(v_b.id), 0), 2);
  v_amount := coalesce(round(p_amount, 2), least(v_rem_a, v_rem_b));
  IF least(v_rem_a, v_rem_b) <= 0.009 THEN
    RAISE EXCEPTION 'Operacja z % jest już w całości rozliczona — nie ma kwoty do powiązania.',
      to_char(CASE WHEN v_rem_a <= 0.009 THEN v_a.transaction_date ELSE v_b.transaction_date END, 'DD.MM.YYYY');
  END IF;
  IF v_amount IS NULL OR v_amount <= 0 THEN RAISE EXCEPTION 'Kwota pary musi być większa od zera.'; END IF;
  IF v_amount > least(v_rem_a, v_rem_b) + 0.01 THEN
    RAISE EXCEPTION 'Kwota pary (%) jest większa niż pozostało do rozliczenia: operacja z % — %, operacja z % — %.',
      private.money_pl(v_amount), to_char(v_a.transaction_date, 'DD.MM.YYYY'), private.money_pl(v_rem_a),
      to_char(v_b.transaction_date, 'DD.MM.YYYY'), private.money_pl(v_rem_b);
  END IF;
  IF private.bank_refund_is_first(v_a.id, v_b.id) THEN
    v_original := v_a.id; v_refund := v_b.id;
  ELSE
    v_original := v_b.id; v_refund := v_a.id;
  END IF;

  INSERT INTO public.bank_transaction_refund_pairs (my_company_id, original_transaction_id, refund_transaction_id, amount,
    match_method, match_reasons, created_by)
  VALUES (v_company, v_original, v_refund, v_amount, CASE WHEN p_method = 'automatic' THEN 'automatic' ELSE 'manual' END,
    coalesce(p_reasons, ARRAY[]::text[])
      || CASE WHEN v_amount < greatest(abs(v_a.amount), abs(v_b.amount)) - 0.009
           THEN ARRAY['Zwrot częściowy: ' || private.money_pl(v_amount) || ' — reszta płatności nadal wymaga faktury.'] ELSE ARRAY[]::text[] END,
    public.current_invoice_employee_id())
  RETURNING id INTO v_id;

  -- Propozycja tej samej pary po drugiej stronie jest już nieaktualna (zatwierdzana zostaje zamknięta przez wywołującego);
  -- operacja rozliczona w całości nie potrzebuje innych propozycji.
  UPDATE public.bank_reconciliation_proposals pr
  SET status = 'superseded', decided_at = now()
  WHERE pr.status = 'open' AND pr.bank_transaction_id IN (v_a.id, v_b.id)
    AND (EXISTS (SELECT 1 FROM jsonb_array_elements(pr.documents) e
                 WHERE e ->> 'source' = 'refund'
                   AND e ->> 'id' = CASE WHEN pr.bank_transaction_id = v_a.id THEN v_b.id ELSE v_a.id END::text)
         OR private.bank_transaction_allocated(pr.bank_transaction_id) >=
            (SELECT abs(x.amount) FROM public.bank_transactions x WHERE x.id = pr.bank_transaction_id) - 0.01);
  -- Propozycje zwrotu innych operacji, które wskazują operację rozliczoną teraz w całości (np. drugi wydatek z tym samym
  -- sklepem i kwotą), też są nieaktualne — kolejne uzgodnienie zaproponuje to, co zostało.
  UPDATE public.bank_reconciliation_proposals pr
  SET status = 'superseded', decided_at = now()
  WHERE pr.status = 'open' AND pr.rule = 'zwrot_platnosci' AND pr.bank_transaction_id NOT IN (v_a.id, v_b.id)
    AND EXISTS (SELECT 1 FROM jsonb_array_elements(pr.documents) e
                JOIN public.bank_transactions x ON x.id::text = e ->> 'id'
                WHERE e ->> 'source' = 'refund' AND x.id IN (v_a.id, v_b.id)
                  AND private.bank_transaction_allocated(x.id) >= abs(x.amount) - 0.01);
  RETURN v_id;
END;
$$;

-- 5. Reguła „zwrot płatności” w reconcile_bank_month (przed regułą „zgodna kwota”) --------------------------------------
DO $patch$
DECLARE
  v_def text := pg_get_functiondef('public.reconcile_bank_month(uuid,integer,integer)'::regprocedure);
  v_olds text[];
  v_news text[];
  v_rule text;
  i int;
BEGIN
  IF position('refund_proposals' IN v_def) > 0 THEN
    RAISE NOTICE 'reconcile_bank_month ma już regułę „zwrot płatności” — pomijam.';
    RETURN;
  END IF;

  v_rule := $rule$    -- Reguła „zwrot płatności” (bez faktury): dokładnie jedna operacja przeciwnego kierunku z tej samej działalności
    -- (także z sąsiednich miesięcy) z równą pozostałą kwotą co do grosza, datą ±45 dni i wspólnym wyróżniającym słowem
    -- w treści (także bez spacji — MT940 łamie słowa: „MUSICCE NTER”) albo tym samym rachunkiem kontrahenta → propozycja;
    -- kilka takich operacji → wybór. Nigdy automatycznie — parę zatwierdza człowiek; odrzucona para nie wraca (po obu stronach).
    IF NOT v_done THEN
      SELECT count(*),
             jsonb_agg(jsonb_build_object('id', x.transaction_id, 'evidence', x.evidence, 'date', x.tx_date,
                         'direction', x.direction, 'amount', x.amount, 'party', x.counterparty)
                       ORDER BY x.score DESC, x.day_diff, x.tx_date, x.transaction_id)
      INTO v_rf_n, v_rf_list
      FROM private.bank_refund_candidates(t.id, 45, true) x
      WHERE (x.same_account OR cardinality(x.words) > 0) AND x.same_amount AND NOT x.blocked AND NOT x.explained;

      IF v_rf_n = 1 THEN
        v_done := true;
        v_rf := v_rf_list -> 0;
        IF private.add_bank_proposal(t.id, 'allocate', 'zwrot_platnosci',
             jsonb_build_array(private.bank_refund_doc(t.id, (v_rf ->> 'id')::uuid, t.remaining, v_rf ->> 'evidence')),
             CASE WHEN private.bank_refund_is_first(t.id, (v_rf ->> 'id')::uuid)
               THEN 'Ta płatność wygląda na zwróconą: '
               ELSE 'Ta operacja wygląda na zwrot płatności ' END ||
             CASE WHEN v_rf ->> 'direction' = 'credit' THEN '+' ELSE '−' END || private.money_pl((v_rf ->> 'amount')::numeric) ||
             ' z ' || to_char((v_rf ->> 'date')::date, 'DD.MM.YYYY') ||
             coalesce(' (' || nullif(left(v_rf ->> 'party', 60), '') || ')', '') ||
             ' — ta sama kwota ' || private.money_pl(t.remaining) || ', potwierdza to ' || coalesce(v_rf ->> 'evidence', 'opis') ||
             '. Zatwierdź, jeśli pieniądze wróciły bez faktury — obie operacje zostaną rozliczone parą „płatność + zwrot” (dowodem jest wyciąg).') THEN
          v_refund_proposals := v_refund_proposals + 1;
        END IF;
      ELSIF v_rf_n > 1 THEN
        v_done := true;
        SELECT jsonb_agg(private.bank_refund_doc(t.id, (e.doc ->> 'id')::uuid, t.remaining, e.doc ->> 'evidence') ORDER BY e.ord)
        INTO v_docs
        FROM jsonb_array_elements(v_rf_list) WITH ORDINALITY AS e(doc, ord)
        WHERE e.ord <= 5;
        IF private.add_bank_proposal(t.id, 'choose', 'zwrot_platnosci', v_docs,
             v_rf_n || CASE WHEN v_rf_n BETWEEN 2 AND 4 THEN ' operacje przeciwnego kierunku mają' ELSE ' operacji przeciwnego kierunku ma' END ||
             ' tę samą kwotę (' || private.money_pl(t.remaining) ||
             ') i wspólne słowo w opisie albo rachunek. Wybierz drugą operację pary „płatność + zwrot” (bez faktury).') THEN
          v_refund_proposals := v_refund_proposals + 1;
        END IF;
      END IF;
    END IF;

$rule$;

  v_olds := ARRAY[
    E'  v_rc_name integer;\nBEGIN\n',
    E'    -- Reguła 7: zgodna kwota (i kontrahent) — zawsze do zatwierdzenia przez człowieka.\n',
    E'    ''auto_contracts'', v_auto_contracts,\n'
  ];
  v_news := ARRAY[
    E'  v_rc_name integer;\n  v_refund_proposals integer := 0;\n  v_rf jsonb;\n  v_rf_n integer;\n  v_rf_list jsonb;\nBEGIN\n',
    v_rule || E'    -- Reguła 7: zgodna kwota (i kontrahent) — zawsze do zatwierdzenia przez człowieka.\n',
    E'    ''auto_contracts'', v_auto_contracts,\n    ''refund_proposals'', v_refund_proposals,\n'
  ];
  FOR i IN 1 .. array_length(v_olds, 1) LOOP
    IF (length(v_def) - length(replace(v_def, v_olds[i], ''))) / length(v_olds[i]) <> 1 THEN
      RAISE EXCEPTION 'reconcile_bank_month ma nieoczekiwaną treść (fragment nr % dla reguły „zwrot płatności”). Sprawdź ręcznie.', i;
    END IF;
    v_def := replace(v_def, v_olds[i], v_news[i]);
  END LOOP;
  EXECUTE v_def;
  RAISE NOTICE 'reconcile_bank_month: dodana reguła „zwrot płatności”.';
END $patch$;

-- 6. Zatwierdzenie i odrzucenie propozycji --------------------------------------------------------------------------
-- Dokument „refund” = para płatność + zwrot (druga operacja i kwota pary).
DO $patch$
DECLARE
  v_def text := pg_get_functiondef('public.accept_bank_reconciliation_proposal(uuid,integer)'::regprocedure);
  v_old text := E'    ELSIF v_doc ->> ''source'' = ''contract'' THEN\n';
  v_new text := E'    ELSIF v_doc ->> ''source'' = ''refund'' THEN\n'
    || E'      PERFORM private.link_bank_refund_pair(v_proposal.bank_transaction_id, (v_doc ->> ''id'')::uuid,\n'
    || E'        (v_doc ->> ''amount'')::numeric, ''manual'', ARRAY[v_reason], v_company);\n'
    || E'    ELSIF v_doc ->> ''source'' = ''contract'' THEN\n';
BEGIN
  IF position('link_bank_refund_pair' IN v_def) > 0 THEN
    RAISE NOTICE 'accept_bank_reconciliation_proposal obsługuje już pary zwrotu — pomijam.';
    RETURN;
  END IF;
  IF (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 THEN
    RAISE EXCEPTION 'accept_bank_reconciliation_proposal ma nieoczekiwaną treść (brak obsługi umów stałych). Sprawdź ręcznie.';
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
END $patch$;

-- Odrzucenie pary po jednej stronie zamyka propozycję tej samej pary po drugiej (para nie wraca po żadnej ze stron —
-- private.bank_refund_pair_blocked sprawdza odrzucenia po obu stronach).
DO $patch$
DECLARE
  v_def text := pg_get_functiondef('public.reject_bank_reconciliation_proposal(uuid)'::regprocedure);
  v_old text := E'  WHERE id = p_proposal_id AND status = ''open'';\n';
  v_new text := E'  WHERE id = p_proposal_id AND status = ''open'';\n'
    || E'  -- Zwrot płatności: propozycja tej samej pary po drugiej stronie też jest nieaktualna.\n'
    || E'  UPDATE public.bank_reconciliation_proposals o\n'
    || E'  SET status = ''superseded'', decided_at = now()\n'
    || E'  FROM public.bank_reconciliation_proposals p CROSS JOIN LATERAL jsonb_array_elements(p.documents) e\n'
    || E'  WHERE p.id = p_proposal_id AND p.status = ''rejected'' AND e ->> ''source'' = ''refund''\n'
    || E'    AND o.bank_transaction_id::text = e ->> ''id'' AND o.status = ''open''\n'
    || E'    AND EXISTS (SELECT 1 FROM jsonb_array_elements(o.documents) oe\n'
    || E'                WHERE oe ->> ''source'' = ''refund'' AND oe ->> ''id'' = p.bank_transaction_id::text);\n';
BEGIN
  IF position('bank_transaction_id::text = e ->> ''id''' IN v_def) > 0 THEN
    RAISE NOTICE 'reject_bank_reconciliation_proposal obsługuje już pary zwrotu — pomijam.';
    RETURN;
  END IF;
  IF (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 THEN
    RAISE EXCEPTION 'reject_bank_reconciliation_proposal ma nieoczekiwaną treść. Sprawdź ręcznie.';
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
END $patch$;

-- 7. RPC ----------------------------------------------------------------------------------------------------------
-- Ręczne powiązanie dwóch operacji jako płatność i zwrot (z ekranu uzgodnienia, oba kierunki). Kwota NULL — mniejsza
-- z pozostałych kwot obu operacji; zwrot częściowy — podaj kwotę zwrotu.
CREATE OR REPLACE FUNCTION public.link_bank_refund_pair(p_transaction_id uuid, p_other_transaction_id uuid, p_amount numeric DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_company uuid;
  v_other_company uuid;
  v_id uuid;
BEGIN
  v_company := private.require_finance_manage_for_transaction(p_transaction_id);
  SELECT s.my_company_id INTO v_other_company
  FROM public.bank_transactions bt JOIN public.bank_statements s ON s.id = bt.statement_id WHERE bt.id = p_other_transaction_id;
  IF v_other_company IS DISTINCT FROM v_company THEN
    RAISE EXCEPTION 'Druga operacja nie należy do tej działalności albo już nie istnieje. Odśwież widok.';
  END IF;
  IF p_amount IS NOT NULL AND p_amount <= 0 THEN RAISE EXCEPTION 'Kwota pary musi być większa od zera.'; END IF;
  v_id := private.link_bank_refund_pair(p_transaction_id, p_other_transaction_id, p_amount, 'manual',
    ARRAY['Powiązane ręcznie: płatność i zwrot bez faktury'], v_company);
  -- Decyzja człowieka: otwarte propozycje obu operacji są nieaktualne (kolejne uzgodnienie zaproponuje resztę).
  UPDATE public.bank_reconciliation_proposals SET status = 'superseded', decided_at = now()
  WHERE bank_transaction_id IN (p_transaction_id, p_other_transaction_id) AND status = 'open';
  RETURN v_id;
END;
$$;

-- Cofnięcie pary: operacje wracają do rozliczenia, a automat nie zaproponuje tej pary ponownie (zapis po obu stronach).
CREATE OR REPLACE FUNCTION public.undo_bank_refund_pair(p_pair_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_pair public.bank_transaction_refund_pairs%ROWTYPE;
  v_reason text;
BEGIN
  PERFORM private.require_finance_refunds((SELECT z.my_company_id FROM public.bank_transaction_refund_pairs z WHERE z.id = p_pair_id),
    true, 'Powiązanie płatności ze zwrotem już nie istnieje. Odśwież widok.');
  SELECT * INTO v_pair FROM public.bank_transaction_refund_pairs WHERE id = p_pair_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Powiązanie płatności ze zwrotem już nie istnieje. Odśwież widok.'; END IF;
  DELETE FROM public.bank_transaction_refund_pairs WHERE id = p_pair_id;
  v_reason := 'Powiązanie płatności ze zwrotem cofnięte przez użytkownika' ||
    CASE WHEN v_pair.match_method = 'automatic' THEN ' (było automatyczne).' ELSE '.' END;
  INSERT INTO public.bank_reconciliation_proposals (bank_transaction_id, kind, rule, documents, reason, status, decided_at, decided_by)
  VALUES
    (v_pair.original_transaction_id, 'allocate', 'cofniete',
     jsonb_build_array(private.bank_refund_doc(v_pair.original_transaction_id, v_pair.refund_transaction_id, v_pair.amount)),
     v_reason, 'rejected', now(), public.current_invoice_employee_id()),
    (v_pair.refund_transaction_id, 'allocate', 'cofniete',
     jsonb_build_array(private.bank_refund_doc(v_pair.refund_transaction_id, v_pair.original_transaction_id, v_pair.amount)),
     v_reason, 'rejected', now(), public.current_invoice_employee_id());
END;
$$;

-- Kandydaci do okna „Powiąż ze zwrotem”: operacje przeciwnego kierunku tej działalności ±90 dni z pozostałą kwotą,
-- najpierw równa kwota, wspólne słowo / rachunek, bliskość daty; z powodami po polsku. Najwyżej 100 (truncated).
CREATE OR REPLACE FUNCTION public.get_bank_refund_candidates(p_transaction_id uuid, p_search text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_tx public.bank_transactions%ROWTYPE;
  v_remaining numeric;
  v_total integer;
  v_rows jsonb;
BEGIN
  PERFORM private.require_finance_refunds((SELECT s.my_company_id FROM public.bank_transactions bt
    JOIN public.bank_statements s ON s.id = bt.statement_id WHERE bt.id = p_transaction_id), false,
    'Nie znaleziono operacji. Odśwież widok.');
  SELECT * INTO v_tx FROM public.bank_transactions WHERE id = p_transaction_id;
  IF v_tx.canonical_transaction_id IS NOT NULL THEN
    RAISE EXCEPTION 'Ta operacja to kopia z drugiego wyciągu (PDF/MT940). Łącz operację potwierdzoną.';
  END IF;
  v_remaining := round(greatest(abs(v_tx.amount) - private.bank_transaction_allocated(v_tx.id), 0), 2);

  WITH c AS (
    SELECT x.* FROM private.bank_refund_candidates(p_transaction_id, 90, false, nullif(btrim(coalesce(p_search, '')), '')) x
  ), ranked AS (
    SELECT c.*, row_number() OVER (ORDER BY c.same_amount DESC, (cardinality(c.words) > 0 OR c.same_account) DESC,
                                            c.day_diff, c.tx_date, c.transaction_id) AS rn,
           count(*) OVER () AS total
    FROM c
  )
  SELECT max(r.total), jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'id', r.transaction_id, 'statement_id', r.statement_id, 'date', r.tx_date, 'amount', r.amount, 'remaining', r.remaining,
      'direction', r.direction, 'currency', r.currency, 'counterparty', r.counterparty, 'title', r.title,
      'statement_year', r.statement_year, 'statement_month', r.statement_month, 'day_diff', r.day_diff,
      'same_amount', r.same_amount, 'same_account', r.same_account, 'words', to_jsonb(r.words), 'evidence', r.evidence,
      'blocked', r.blocked, 'explained', r.explained, 'score', r.score,
      'role', CASE WHEN private.bank_refund_is_first(p_transaction_id, r.transaction_id) THEN 'refund' ELSE 'payment' END,
      'suggested_amount', least(v_remaining, r.remaining),
      'reasons', to_jsonb(array_remove(ARRAY[
        CASE WHEN r.same_amount THEN 'Ta sama kwota do rozliczenia (' || private.money_pl(r.remaining) || ')' END,
        CASE WHEN cardinality(r.words) = 1 THEN 'Wspólne słowo w opisie: „' || r.words[1] || '”'
             WHEN cardinality(r.words) > 1 THEN 'Wspólne słowa w opisie: „' || array_to_string(r.words[1:3], '”, „') || '”' END,
        CASE WHEN r.same_account THEN 'Ten sam rachunek kontrahenta' END,
        CASE WHEN r.day_diff = 0 THEN 'Ten sam dzień' WHEN r.day_diff = 1 THEN '1 dzień różnicy' ELSE r.day_diff || ' dni różnicy' END,
        CASE WHEN r.remaining < r.amount - 0.009 THEN 'Pozostało do rozliczenia ' || private.money_pl(r.remaining) || ' z ' || private.money_pl(r.amount) END,
        CASE WHEN r.explained THEN 'Operacja ma już wyjaśnienie bez faktury' END,
        CASE WHEN r.blocked THEN 'Ta para była odrzucona albo cofnięta — automat jej nie proponuje, ręcznie możesz ją powiązać' END
      ], NULL))))
    ORDER BY r.rn)
  INTO v_total, v_rows
  FROM ranked r WHERE r.rn <= 100;

  RETURN jsonb_build_object(
    'transaction', jsonb_build_object('id', v_tx.id, 'date', v_tx.transaction_date, 'amount', abs(v_tx.amount),
      'remaining', v_remaining, 'direction', v_tx.transaction_type, 'currency', upper(coalesce(v_tx.currency, 'PLN')),
      'counterparty', private.bank_transaction_party_label(v_tx.id), 'title', v_tx.title),
    'candidates', coalesce(v_rows, '[]'::jsonb),
    'total', coalesce(v_total, 0),
    'truncated', coalesce(v_total, 0) > 100);
END;
$$;

-- 8. Widok miesiąca (wersja z 20261101210000 + pary zwrotu przy operacji) --------------------------------------------
CREATE OR REPLACE FUNCTION public.get_bank_reconciliation_month(p_company_id uuid, p_year integer, p_month integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_result jsonb;
  v_from date := make_date(p_year, p_month, 1);
  v_to date := (make_date(p_year, p_month, 1) + interval '1 month - 1 day')::date;
  v_today date := (now() AT TIME ZONE 'Europe/Warsaw')::date;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND NOT (public.finance_can_view() AND public.finance_company_visible(p_company_id)) THEN
    RAISE EXCEPTION 'Brak uprawnień do podglądu wyciągów.' USING ERRCODE = '42501';
  END IF;

  WITH st AS (
    SELECT s.* FROM public.bank_statements s
    WHERE s.my_company_id = p_company_id AND s.statement_year = p_year AND s.statement_month = p_month
      AND s.processed AND s.validation_status = 'valid'
  ), tx AS (
    SELECT t.*, CASE WHEN st.account_type = 'vat' THEN 'vat' ELSE 'regular' END AS account_kind,
           private.bank_transaction_allocated(t.id) AS alloc
    FROM public.bank_transactions t JOIN st ON st.id = t.statement_id
    WHERE t.canonical_transaction_id IS NULL
  ), rows AS (
    SELECT tx.*, pr.id AS proposal_id, pr.kind AS proposal_kind,
      CASE
        WHEN tx.paired_bank_transaction_id IS NOT NULL OR tx.private_transfer_detected
             OR (tx.accounting_review_status = 'explained' AND tx.accounting_category = 'own_transfer') THEN 'transfer'
        WHEN tx.alloc >= abs(tx.amount) - 0.01 THEN 'matched'
        WHEN tx.accounting_review_status = 'explained' AND pr.kind IN ('allocate', 'choose') THEN CASE WHEN pr.kind = 'allocate' THEN 'proposal' ELSE 'choice' END
        WHEN tx.accounting_review_status = 'explained' THEN 'explained'
        WHEN pr.kind = 'allocate' THEN 'proposal'
        WHEN pr.kind = 'choose' THEN 'choice'
        WHEN tx.alloc > 0.009 THEN 'partial'
        ELSE 'missing'
      END AS status,
      to_jsonb(pr) AS proposal
    FROM tx
    LEFT JOIN public.bank_reconciliation_proposals pr ON pr.bank_transaction_id = tx.id AND pr.status = 'open'
  ), docs AS (
    SELECT * FROM private.bank_reconciliation_documents(p_company_id)
  )
  SELECT jsonb_build_object(
    'company_id', p_company_id, 'year', p_year, 'month', p_month,
    'sources', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', st.id, 'kind', CASE WHEN st.account_type = 'vat' THEN 'vat' ELSE 'regular' END,
        'format', coalesce(st.import_format, st.file_type), 'file_name', st.file_name,
        'transactions_count', (SELECT count(*) FROM public.bank_transactions x WHERE x.statement_id = st.id),
        'opening_balance', st.opening_balance, 'closing_balance', st.closing_balance,
        'confirmed', (SELECT count(*) FROM public.bank_transactions x WHERE x.statement_id = st.id AND x.source_confirmation = 'confirmed'),
        'unconfirmed', (SELECT count(*) FROM public.bank_transactions x WHERE x.statement_id = st.id AND x.source_confirmation = 'unconfirmed'),
        'created_at', st.created_at) ORDER BY st.account_type, st.import_format)
      FROM st), '[]'::jsonb),
    'last_run', (SELECT to_jsonb(r) FROM public.bank_reconciliation_runs r
                 WHERE r.my_company_id = p_company_id AND r.statement_year = p_year AND r.statement_month = p_month
                 ORDER BY r.created_at DESC LIMIT 1),
    'transactions', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', r.id, 'statement_id', r.statement_id, 'date', r.transaction_date, 'amount', abs(r.amount),
        'direction', r.transaction_type, 'currency', coalesce(r.currency, 'PLN'),
        'counterparty', coalesce(nullif(btrim(r.counterparty_name), ''), r.raw_counterparty),
        'counterparty_account', r.counterparty_account, 'title', r.title,
        'source_description', (SELECT string_agg(nullif(concat_ws(' · ', nullif(btrim(c.title), ''), nullif(btrim(c.counterparty_name), '')), ''), ' | ')
                               FROM public.bank_transactions c WHERE c.canonical_transaction_id = r.id),
        'account_kind', r.account_kind, 'source_confirmation', r.source_confirmation,
        'allocated', round(r.alloc, 2), 'remaining', round(greatest(abs(r.amount) - r.alloc, 0), 2),
        'status', r.status,
        'allocations', coalesce((
          SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
            'match_id', m.id, 'source', m.document_source,
            'document_id', coalesce(m.ksef_invoice_id, m.invoice_id, m.external_invoice_id),
            'number', coalesce(k.invoice_number, i.invoice_number, e.invoice_number),
            'party', coalesce(CASE WHEN k.invoice_type::text = 'issued' THEN k.buyer_name ELSE k.seller_name END, i.buyer_name, e.seller_name),
            'amount', m.amount, 'method', m.match_method, 'reasons', m.match_reasons, 'created_at', m.created_at,
            'document_amount', CASE WHEN upper(coalesce(m.document_currency, m.currency)) <> upper(m.currency) THEN m.document_amount END,
            'document_currency', CASE WHEN upper(coalesce(m.document_currency, m.currency)) <> upper(m.currency) THEN upper(m.document_currency) END,
            'exchange_rate', CASE WHEN upper(coalesce(m.document_currency, m.currency)) <> upper(m.currency) THEN m.exchange_rate END,
            'doc_kind', private.bank_document_kind(m.document_source, coalesce(m.ksef_invoice_id, m.invoice_id, m.external_invoice_id)),
            'issue_date', x.issue_date, 'due_date', x.due_date,
            'doc_due', round(x.due, 2), 'doc_paid', round(x.bank_paid + x.manual_paid, 2),
            'doc_open', round(greatest(x.due - x.bank_paid - x.manual_paid, 0), 2),
            'doc_manual', CASE WHEN x.manual_paid > 0.009 THEN round(x.manual_paid, 2) END,
            'doc_status', x.payment_status))
            ORDER BY m.created_at)
          FROM public.bank_transaction_invoice_matches m
          LEFT JOIN public.ksef_invoices k ON k.id = m.ksef_invoice_id
          LEFT JOIN public.invoices i ON i.id = m.invoice_id
          LEFT JOIN public.external_invoices e ON e.id = m.external_invoice_id
          LEFT JOIN docs x ON x.source = m.document_source
                          AND x.document_id = coalesce(m.ksef_invoice_id, m.invoice_id, m.external_invoice_id)
          WHERE m.bank_transaction_id = r.id), '[]'::jsonb),
        'personnel', coalesce((
          SELECT jsonb_agg(jsonb_build_object('id', p.id, 'recipient', p.recipient_name, 'amount', p.amount, 'title', p.title,
            'payment_type', p.payment_type, 'payment_date', p.payment_date, 'contract_id', pc.id, 'contract_number', pc.contract_number,
            'contract_kind', pc.contract_kind, 'method', coalesce(p.bank_match_method, 'manual'), 'reasons', p.bank_match_reasons))
          FROM public.personnel_contract_payments p
          LEFT JOIN public.personnel_contracts pc ON pc.id = p.personnel_contract_id
          WHERE p.bank_transaction_id = r.id), '[]'::jsonb),
        'declarations', coalesce((
          SELECT jsonb_agg(jsonb_build_object('payment_id', f.id, 'declaration_id', d.id, 'kind', d.kind, 'form', d.form,
            'label', private.finance_declaration_label(d.form, d.period_kind, d.period_start),
            'amount', f.amount, 'method', f.match_method, 'reasons', f.match_reasons,
            'amount_due', d.amount_due,
            'status', private.finance_declaration_status(d.amount_due,
              (SELECT sum(x.amount) FROM public.finance_declaration_payments x WHERE x.declaration_id = d.id))) ORDER BY f.created_at)
          FROM public.finance_declaration_payments f JOIN public.finance_declarations d ON d.id = f.declaration_id
          WHERE f.bank_transaction_id = r.id), '[]'::jsonb),
        -- Płatności umów stałych (najem, leasing, abonament…) przypięte do tej operacji.
        'contracts', coalesce((
          SELECT jsonb_agg(jsonb_build_object('payment_id', rp.id, 'contract_id', c.id, 'kind', c.kind, 'title', c.title,
            'counterparty', c.counterparty_name, 'period_start', rp.period_start,
            'period_label', private.recurring_contract_period_label(c.billing_cycle, rp.period_start),
            'amount', rp.amount, 'method', rp.match_method, 'reasons', rp.match_reasons, 'period_amount', c.amount,
            'period_paid', (SELECT round(sum(x.amount), 2) FROM public.finance_recurring_contract_payments x
                            WHERE x.contract_id = c.id AND x.period_start = rp.period_start))
            ORDER BY rp.period_start, rp.created_at)
          FROM public.finance_recurring_contract_payments rp
          JOIN public.finance_recurring_contracts c ON c.id = rp.contract_id
          WHERE rp.bank_transaction_id = r.id), '[]'::jsonb),
        -- Pary „płatność + zwrot” (bez faktury): rola tej operacji (payment — zwrócona płatność, refund — zwrot) i druga operacja.
        'refunds', coalesce((
          SELECT jsonb_agg(jsonb_build_object(
            'pair_id', z.id, 'role', CASE WHEN z.original_transaction_id = r.id THEN 'payment' ELSE 'refund' END,
            'amount', z.amount, 'method', z.match_method, 'reasons', z.match_reasons, 'created_at', z.created_at,
            'other', jsonb_build_object('id', o.id, 'statement_id', o.statement_id, 'date', o.transaction_date,
              'amount', abs(o.amount), 'direction', o.transaction_type, 'currency', coalesce(o.currency, 'PLN'),
              'counterparty', private.bank_transaction_party_label(o.id), 'title', o.title,
              'statement_year', os.statement_year, 'statement_month', os.statement_month))
            ORDER BY z.created_at)
          FROM public.bank_transaction_refund_pairs z
          JOIN public.bank_transactions o
            ON o.id = CASE WHEN z.original_transaction_id = r.id THEN z.refund_transaction_id ELSE z.original_transaction_id END
          JOIN public.bank_statements os ON os.id = o.statement_id
          WHERE z.original_transaction_id = r.id OR z.refund_transaction_id = r.id), '[]'::jsonb),
        'explanation', CASE WHEN r.accounting_review_status = 'explained' THEN jsonb_build_object(
          'category', r.accounting_category, 'subtype', r.accounting_subtype, 'note', r.accounting_note,
          'by', coalesce(r.accounting_explained_by, 'user')) END,
        'proposal', CASE WHEN r.proposal IS NULL OR jsonb_typeof(r.proposal->'documents') <> 'array' THEN r.proposal
          ELSE r.proposal || jsonb_build_object('documents', coalesce((
            SELECT jsonb_agg(z.doc || jsonb_strip_nulls(jsonb_build_object(
                'suggested', CASE WHEN z.suggested THEN true END,
                'hint', CASE
                  WHEN z.suggested THEN 'Oznaczona ręcznie jako opłacona w dniu przelewu (' || to_char(r.transaction_date, 'DD.MM.YYYY') || ') na tę samą kwotę.'
                  WHEN z.issued_after THEN 'Wystawiona po dacie przelewu (' || to_char(z.issue_date, 'DD.MM.YYYY') || ').'
                END))
              ORDER BY z.ord)  -- kolejność bez zmian: accept_bank_reconciliation_proposal wybiera po indeksie
            FROM (
              SELECT y.*, (y.choose AND y.date_match AND count(*) FILTER (WHERE y.date_match) OVER () = 1) AS suggested
              FROM (
                SELECT d.ord, x.issue_date,
                  d.doc || jsonb_strip_nulls(jsonb_build_object(
                    'issue_date', coalesce(d.doc->>'issue_date', x.issue_date::text),
                    'due_date', coalesce(d.doc->>'due_date', x.due_date::text),
                    'doc_kind', CASE WHEN d.doc->>'source' IN ('ksef', 'invoice', 'external') AND d.doc ? 'id'
                                     THEN private.bank_document_kind(d.doc->>'source', (d.doc->>'id')::uuid) END,
                    'payment_status', x.payment_status,
                    'paid', CASE WHEN x.document_id IS NOT NULL THEN round(x.bank_paid + x.manual_paid, 2) END,
                    'bank_paid', CASE WHEN x.bank_paid > 0.009 THEN round(x.bank_paid, 2) END,
                    'manual_paid', CASE WHEN x.manual_paid > 0.009 THEN round(x.manual_paid, 2) END,
                    'manual_date', CASE WHEN x.manual_paid > 0.009 THEN x.manual_date END)) AS doc,
                  (r.proposal->>'kind') = 'choose' AS choose,
                  coalesce(x.manual_paid > 0.009 AND x.manual_date = r.transaction_date
                           AND abs(x.manual_paid - coalesce((d.doc->>'amount')::numeric, 0)) <= 0.02, false) AS date_match,
                  coalesce(x.issue_date > r.transaction_date, false) AS issued_after
                FROM jsonb_array_elements(r.proposal->'documents') WITH ORDINALITY AS d(doc, ord)
                LEFT JOIN docs x ON x.source = d.doc->>'source' AND x.document_id::text = d.doc->>'id'
              ) y
            ) z), '[]'::jsonb)) END)
        ORDER BY r.transaction_date, r.source_index NULLS LAST, r.id)
      FROM rows r), '[]'::jsonb),
    -- Deklaracje za poprzedni miesiąc (zwykle płatne w tym) i te, które mają przelew w tym miesiącu.
    'declarations', coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', x.id, 'kind', x.kind, 'form', x.form, 'label', x.label,
        'amount_due', x.amount_due, 'paid', x.paid, 'paid_this_month', x.paid_month,
        'status', private.finance_declaration_status(x.amount_due, x.paid)) ORDER BY x.period_start, x.kind, x.form)
      FROM (
        SELECT d.id, d.kind, d.form, d.period_start, d.amount_due,
               private.finance_declaration_label(d.form, d.period_kind, d.period_start) AS label,
               round(coalesce((SELECT sum(f.amount) FROM public.finance_declaration_payments f WHERE f.declaration_id = d.id), 0), 2) AS paid,
               round(coalesce((SELECT sum(f.amount) FROM public.finance_declaration_payments f
                               JOIN public.bank_transactions bt ON bt.id = f.bank_transaction_id
                               JOIN public.bank_statements s ON s.id = bt.statement_id
                               WHERE f.declaration_id = d.id AND s.statement_year = p_year AND s.statement_month = p_month), 0), 2) AS paid_month
        FROM public.finance_declarations d
        WHERE d.my_company_id = p_company_id
          AND ((d.period_kind = 'month' AND d.period_start = (v_from - interval '1 month')::date)
               OR EXISTS (SELECT 1 FROM public.finance_declaration_payments f
                          JOIN public.bank_transactions bt ON bt.id = f.bank_transaction_id
                          JOIN public.bank_statements s ON s.id = bt.statement_id
                          WHERE f.declaration_id = d.id AND s.statement_year = p_year AND s.statement_month = p_month))
      ) x), '[]'::jsonb),
    -- Umowy stałe obowiązujące w miesiącu: należne za okresy zaczynające się w tym miesiącu, zapłacone w tym miesiącu, brak.
    'contracts', coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', x.id, 'kind', x.kind, 'title', x.title, 'counterparty', x.counterparty_name,
        'direction', x.direction, 'currency', x.currency, 'amount', x.amount, 'billing_cycle', x.billing_cycle,
        'expects_invoice', x.expects_invoice, 'periods', x.labels, 'due', round(x.due, 2), 'due_date', x.due_date,
        'paid_for_periods', round(x.paid_due, 2), 'paid_this_month', round(x.paid_month, 2),
        'missing', round(greatest(x.due - x.paid_due, 0), 2),
        'status', CASE
          WHEN x.expects_invoice THEN 'invoice'
          WHEN x.due <= 0.009 THEN 'not_due'
          WHEN x.paid_due >= x.due - 0.01 THEN 'paid'
          WHEN x.due_date < v_today THEN 'overdue'
          ELSE 'missing' END)
        ORDER BY x.direction, x.title)
      FROM (
        SELECT c.id, c.kind, c.title, c.counterparty_name, c.direction, c.currency, c.amount, c.billing_cycle, c.expects_invoice,
               coalesce(per.due, 0) AS due, coalesce(per.paid_due, 0) AS paid_due, per.due_date, coalesce(per.labels, '[]'::jsonb) AS labels,
               coalesce((SELECT sum(rp.amount) FROM public.finance_recurring_contract_payments rp
                         JOIN public.bank_transactions bt ON bt.id = rp.bank_transaction_id
                         JOIN public.bank_statements s ON s.id = bt.statement_id
                         WHERE rp.contract_id = c.id AND s.statement_year = p_year AND s.statement_month = p_month), 0) AS paid_month
        FROM public.finance_recurring_contracts c
        LEFT JOIN LATERAL (
          SELECT sum(pp.amount) AS due, sum(least(pp.paid, pp.amount)) AS paid_due, min(pp.due_date) AS due_date,
                 jsonb_agg(private.recurring_contract_period_label(c.billing_cycle, pp.period_start) ORDER BY pp.period_start) AS labels
          FROM private.recurring_contract_periods(c.id, v_to) pp
          WHERE pp.period_start BETWEEN v_from AND v_to
        ) per ON true
        WHERE c.my_company_id = p_company_id AND c.start_date <= v_to AND (c.end_date IS NULL OR c.end_date >= v_from)
      ) x), '[]'::jsonb),
    'paid_without_statement', coalesce((
      SELECT jsonb_agg(jsonb_build_object('source', d.source, 'id', d.document_id, 'number', d.number, 'party', d.party,
        'side', d.side, 'due', round(d.due, 2), 'manual_paid', round(d.manual_paid, 2), 'payment_date', d.manual_date,
        'currency', d.currency)
        ORDER BY d.manual_date, d.number)
      FROM docs d
      WHERE d.manual_paid > 0.009 AND NOT d.is_shadow AND d.manual_date BETWEEN v_from AND v_to
        AND NOT (d.source = 'invoice' AND EXISTS (SELECT 1 FROM docs k WHERE k.source = 'ksef' AND k.local_invoice_id = d.document_id))), '[]'::jsonb),
    'shadow_documents', coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', d.document_id, 'number', d.number, 'party', d.party, 'due', round(d.due, 2),
        'payment_status', d.payment_status, 'issue_date', d.issue_date) ORDER BY d.issue_date DESC, d.number)
      FROM docs d WHERE d.is_shadow), '[]'::jsonb),
    'unpaid_due', coalesce((
      SELECT jsonb_agg(jsonb_build_object('source', d.source, 'id', d.document_id, 'number', d.number, 'party', d.party,
        'side', d.side, 'due', round(d.due, 2), 'open', round(greatest(d.due - d.bank_paid - d.manual_paid, 0), 2),
        'due_date', d.due_date, 'issue_date', d.issue_date, 'currency', d.currency) ORDER BY d.due_date, d.number)
      FROM (
        SELECT DISTINCT ON (x.twin_key) x.* FROM docs x
        WHERE NOT x.is_shadow AND x.due - x.bank_paid - x.manual_paid > 0.009
          AND coalesce(x.due_date, x.issue_date) <= v_to
          AND coalesce(x.due_date, x.issue_date) >= v_from - interval '6 months'
        ORDER BY x.twin_key, (x.source = 'ksef') DESC
      ) d), '[]'::jsonb)
  ) INTO v_result;
  RETURN v_result;
END;
$function$;

-- 9. Uprawnienia ----------------------------------------------------------------------------------------------------
-- Funkcje pomocnicze: tylko dla funkcji serwera (bez API).
REVOKE ALL ON FUNCTION private.bank_transaction_text_norm(uuid), private.bank_refund_norm(text),
  private.bank_refund_words(text, text), private.bank_refund_common_words(text[], text, text, text),
  private.bank_transaction_party_label(uuid), private.bank_refund_is_first(uuid, uuid), private.bank_refund_pair_blocked(uuid, uuid),
  private.bank_refund_doc(uuid, uuid, numeric, text), private.bank_refund_candidates(uuid, integer, boolean, text),
  private.require_finance_refunds(uuid, boolean, text), private.guard_bank_refund_pair(), private.sync_bank_refund_pair_state(),
  private.link_bank_refund_pair(uuid, uuid, numeric, text, text[], uuid)
  FROM PUBLIC, anon, authenticated;

-- Wykonuje je właściciel funkcji SECURITY DEFINER uzgadniania (w produkcji ten sam, który uruchamia migrację).
DO $grant$
DECLARE
  v_owner text := (SELECT pg_get_userbyid(p.proowner) FROM pg_proc p WHERE p.oid = 'public.reconcile_bank_month(uuid,integer,integer)'::regprocedure);
BEGIN
  EXECUTE format('GRANT EXECUTE ON FUNCTION private.bank_transaction_text_norm(uuid), private.bank_refund_norm(text),
    private.bank_refund_words(text, text), private.bank_refund_common_words(text[], text, text, text),
    private.bank_transaction_party_label(uuid), private.bank_refund_is_first(uuid, uuid), private.bank_refund_pair_blocked(uuid, uuid),
    private.bank_refund_doc(uuid, uuid, numeric, text), private.bank_refund_candidates(uuid, integer, boolean, text),
    private.require_finance_refunds(uuid, boolean, text), private.link_bank_refund_pair(uuid, uuid, numeric, text, text[], uuid) TO %I', v_owner);
END $grant$;

-- RPC wołane z CRM: zalogowani (kontrola uprawnień w pierwszej linii) i service_role; nigdy PUBLIC / anon.
REVOKE ALL ON FUNCTION public.link_bank_refund_pair(uuid, uuid, numeric), public.undo_bank_refund_pair(uuid),
  public.get_bank_refund_candidates(uuid, text),
  public.reconcile_bank_month(uuid, integer, integer), public.accept_bank_reconciliation_proposal(uuid, integer),
  public.reject_bank_reconciliation_proposal(uuid), public.get_bank_reconciliation_month(uuid, integer, integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.link_bank_refund_pair(uuid, uuid, numeric), public.undo_bank_refund_pair(uuid),
  public.get_bank_refund_candidates(uuid, text),
  public.reconcile_bank_month(uuid, integer, integer), public.accept_bank_reconciliation_proposal(uuid, integer),
  public.reject_bank_reconciliation_proposal(uuid), public.get_bank_reconciliation_month(uuid, integer, integer)
  TO authenticated, service_role;
-- bank_transaction_allocated i recalculate_bank_transaction_match_state: bez zmian uprawnień (tylko serwer).
REVOKE ALL ON FUNCTION private.bank_transaction_allocated(uuid, uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.recalculate_bank_transaction_match_state(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recalculate_bank_transaction_match_state(uuid) TO service_role;

-- 10. Kontrola końcowa ------------------------------------------------------------------------------------------------
DO $chk$
DECLARE
  v_list text;
BEGIN
  IF position('bank_transaction_refund_pairs' IN pg_get_functiondef('private.bank_transaction_allocated(uuid,uuid,uuid,uuid)'::regprocedure)) = 0
     OR position('bank_transaction_refund_pairs' IN pg_get_functiondef('public.recalculate_bank_transaction_match_state(uuid)'::regprocedure)) = 0
     OR position('refund_proposals' IN pg_get_functiondef('public.reconcile_bank_month(uuid,integer,integer)'::regprocedure)) = 0
     OR position('link_bank_refund_pair' IN pg_get_functiondef('public.accept_bank_reconciliation_proposal(uuid,integer)'::regprocedure)) = 0
     OR position('''refund''' IN pg_get_functiondef('public.reject_bank_reconciliation_proposal(uuid)'::regprocedure)) = 0
     OR position('bank_transaction_refund_pairs' IN pg_get_functiondef('public.get_bank_reconciliation_month(uuid,integer,integer)'::regprocedure)) = 0
     OR position('bank_transaction_refund_pairs' IN pg_get_functiondef('private.merge_bank_transaction_copy(uuid,uuid)'::regprocedure)) = 0
     OR position('bank_transaction_refund_pairs' IN pg_get_functiondef('private.promote_bank_transaction_copy_for(uuid)'::regprocedure)) = 0
     OR position('bank_transaction_refund_pairs' IN pg_get_functiondef('private.promote_bank_transaction_copy()'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'Kontrola końcowa: funkcje uzgadniania nie obsługują par „płatność + zwrot”.';
  END IF;
  SELECT string_agg(p.oid::regprocedure::text, ', ') INTO v_list
  FROM pg_proc p
  WHERE p.pronamespace IN ('public'::regnamespace, 'private'::regnamespace)
    AND (p.proname LIKE '%refund%' OR p.proname IN ('bank_transaction_text_norm', 'bank_transaction_party_label', 'bank_transaction_allocated'))
    AND (has_function_privilege('anon', p.oid, 'EXECUTE')
         OR (p.pronamespace = 'private'::regnamespace AND has_function_privilege('authenticated', p.oid, 'EXECUTE')));
  IF v_list IS NOT NULL THEN RAISE EXCEPTION 'Kontrola końcowa: złe uprawnienia funkcji par zwrotu: %', v_list; END IF;
  IF has_table_privilege('anon', 'public.bank_transaction_refund_pairs', 'SELECT')
     OR has_table_privilege('authenticated', 'public.bank_transaction_refund_pairs', 'INSERT')
     OR has_table_privilege('authenticated', 'public.bank_transaction_refund_pairs', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.bank_transaction_refund_pairs', 'DELETE') THEN
    RAISE EXCEPTION 'Kontrola końcowa: złe uprawnienia tabeli par zwrotu.';
  END IF;
END $chk$;

-- Supabase (safeupdate) odrzuca w wywołaniach z API każde UPDATE i DELETE bez WHERE — także w funkcjach. Przegląd treści
-- wszystkich funkcji plpgsql / sql w public i private: komentarze i stałe tekstowe (także $tag$…$tag$) są pomijane, nawiasy
-- (podzapytania) usuwane; UPDATE / DELETE musi mieć WHERE w tej samej instrukcji. Nie liczą się: SELECT … FOR UPDATE,
-- ON CONFLICT … DO UPDATE, ON UPDATE / ON DELETE, MERGE. SQL dynamiczny (EXECUTE '…') nie jest sprawdzany.
DO $chk$
DECLARE
  r record;
  v_chars text[];
  v_n integer;
  i integer;
  j integer;
  k integer;
  v_start integer;
  v_depth integer;
  v_escape boolean;
  v_tag text;
  v_code text;
  v_parts text[];
  v_stmt text;
  v_prev text;
  v_pieces text[];
  v_bad text[] := ARRAY[]::text[];
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure::text AS fn, p.prosrc AS src
    FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
    WHERE p.pronamespace IN ('public'::regnamespace, 'private'::regnamespace)
      AND l.lanname IN ('plpgsql', 'sql') AND p.prosrc ~* '\m(update|delete)\M'
      AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')
  LOOP
    v_chars := string_to_array(r.src, NULL);
    v_n := coalesce(array_length(v_chars, 1), 0);
    v_parts := ARRAY[]::text[];
    i := 1;
    v_start := 1;
    WHILE i <= v_n LOOP
      IF v_chars[i] = '-' AND i < v_n AND v_chars[i + 1] = '-' THEN
        v_parts := array_append(v_parts, substr(r.src, v_start, i - v_start) || ' ');
        WHILE i <= v_n AND v_chars[i] <> E'\n' LOOP i := i + 1; END LOOP;
        v_start := i;
      ELSIF v_chars[i] = '/' AND i < v_n AND v_chars[i + 1] = '*' THEN
        v_parts := array_append(v_parts, substr(r.src, v_start, i - v_start) || ' ');
        v_depth := 1;
        i := i + 2;
        WHILE i <= v_n AND v_depth > 0 LOOP
          IF v_chars[i] = '*' AND i < v_n AND v_chars[i + 1] = '/' THEN v_depth := v_depth - 1; i := i + 2;
          ELSIF v_chars[i] = '/' AND i < v_n AND v_chars[i + 1] = '*' THEN v_depth := v_depth + 1; i := i + 2;
          ELSE i := i + 1; END IF;
        END LOOP;
        v_start := i;
      ELSIF v_chars[i] = '''' THEN
        v_parts := array_append(v_parts, substr(r.src, v_start, i - v_start) || ' ''s'' ');
        v_escape := i > 1 AND upper(v_chars[i - 1]) = 'E' AND (i = 2 OR v_chars[i - 2] !~ '[A-Za-z0-9_]');
        i := i + 1;
        WHILE i <= v_n LOOP
          IF v_escape AND v_chars[i] = '\' THEN i := i + 2; CONTINUE; END IF;
          IF v_chars[i] = '''' THEN
            IF i < v_n AND v_chars[i + 1] = '''' THEN i := i + 2; CONTINUE; END IF;
            EXIT;
          END IF;
          i := i + 1;
        END LOOP;
        i := i + 1;
        v_start := i;
      ELSIF v_chars[i] = '"' THEN
        v_parts := array_append(v_parts, substr(r.src, v_start, i - v_start) || ' ident ');
        i := i + 1;
        WHILE i <= v_n AND v_chars[i] <> '"' LOOP i := i + 1; END LOOP;
        i := i + 1;
        v_start := i;
      ELSIF v_chars[i] = '$' AND (i = 1 OR v_chars[i - 1] !~ '[A-Za-z0-9_]') THEN
        j := i + 1;
        WHILE j <= v_n AND v_chars[j] ~ '[A-Za-z0-9_]' LOOP j := j + 1; END LOOP;
        v_tag := substr(r.src, i, j - i + 1);
        IF j <= v_n AND v_chars[j] = '$' AND substr(v_tag, 2, 1) !~ '[0-9]' THEN
          k := position(v_tag IN substr(r.src, j + 1));
          v_parts := array_append(v_parts, substr(r.src, v_start, i - v_start) || ' ''s'' ');
          i := CASE WHEN k = 0 THEN v_n + 1 ELSE j + k + length(v_tag) END;
          v_start := i;
        ELSE
          i := i + 1;
        END IF;
      ELSE
        i := i + 1;
      END IF;
    END LOOP;
    v_parts := array_append(v_parts, substr(r.src, v_start));
    v_code := upper(array_to_string(v_parts, ''));

    FOREACH v_stmt IN ARRAY string_to_array(v_code, ';') LOOP
      CONTINUE WHEN v_stmt !~ '\m(UPDATE|DELETE)\M' OR v_stmt ~ '\mMERGE\M' OR v_stmt ~ '^\s*(GRANT|REVOKE)\M';
      LOOP
        v_prev := v_stmt;
        v_stmt := regexp_replace(v_stmt, '\([^()]*\)', ' ', 'g');
        EXIT WHEN v_stmt = v_prev;
      END LOOP;
      v_stmt := regexp_replace(v_stmt, '\m(FOR|DO|ON|OR|BEFORE|AFTER|OF)\s+(NO\s+KEY\s+)?(UPDATE|DELETE)\M', ' ', 'g');
      CONTINUE WHEN v_stmt !~ '\m(UPDATE|DELETE)\M';
      v_pieces := regexp_split_to_array(v_stmt, '\m(UPDATE|DELETE)\M');
      FOR j IN 2 .. coalesce(array_length(v_pieces, 1), 1) LOOP
        IF v_pieces[j] !~ '\mWHERE\M' THEN
          v_bad := v_bad || (r.fn || ': ' || left(regexp_replace(btrim(substring(v_stmt FROM '\m(?:UPDATE|DELETE)\M.*$')), '\s+', ' ', 'g'), 80));
          EXIT;
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;
  IF cardinality(v_bad) > 0 THEN
    RAISE EXCEPTION 'Kontrola safeupdate: UPDATE/DELETE bez WHERE (wywołanie z CRM zakończy się błędem „UPDATE requires a WHERE clause”): %',
      array_to_string(v_bad, ' | ');
  END IF;
END $chk$;

NOTIFY pgrst, 'reload schema';

COMMIT;
