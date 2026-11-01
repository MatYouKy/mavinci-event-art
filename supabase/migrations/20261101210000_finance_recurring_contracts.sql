-- Umowy stałe: najem, leasing, abonament, raty ubezpieczenia, kredyt / pożyczka (2026-11-01).
--
-- CO I DLACZEGO
-- Co miesiąc z rachunku wychodzi np. 450 zł do osoby prywatnej („MARIUSZ SKARUL”, tytuł „CZYNSZ GARAŻ NR 6 …”) — najem na
-- czas nieokreślony, bez faktur. Dokument spoza KSeF tego nie opisuje (jeden dokument = jedna kwota, po pierwszej płatności
-- jest „opłacony”). Rejestr „Umowy stałe” opisuje zobowiązanie (albo należność) powtarzalne w okresach, a przelewy z wyciągu
-- przypisuje się do okresów umowy — tak jak przelewy do deklaracji ZUS / podatkowych.
--
--  1. finance_recurring_contracts — umowa: działalność, rodzaj, kierunek (cost — płacimy, income — otrzymujemy), tytuł,
--     kontrahent (nazwa, opcjonalnie NIP; bez PESEL), rachunek kontrahenta (same cyfry), kwota brutto na okres, waluta, cykl
--     (miesiąc / kwartał / rok, okresy liczone od miesiąca początku umowy), dzień płatności, początek, koniec (NULL = czas
--     nieokreślony), „rozliczaj płatności od” (dla umów zawartych dawno — okresy wcześniejsze nie są pokazywane jako brak),
--     status, „kontrahent wystawia faktury” (wtedy płatność wiąże się z fakturą, a umowa tylko informuje), notatki.
--     finance_recurring_contract_files — pliki umowy i aneksów (prywatny magazyn finance-contracts, {działalność}/{umowa}/…).
--     finance_recurring_contract_payments — przelew z wyciągu przypisany do okresu umowy (kwota, automatycznie / ręcznie, powody).
--  2. Jeden limit kwoty operacji: faktury, wypłaty, deklaracje i umowy stałe liczą się razem (private.bank_transaction_allocated);
--     status operacji (recalculate_bank_transaction_match_state), scalanie i przejmowanie kopii operacji (PDF ↔ MT940) obejmują
--     także płatności umów.
--  3. reconcile_bank_month — reguła „umowa stała” przed regułą „zgodna kwota”: kierunek i waluta jak w umowie, umowa obowiązuje
--     w dniu operacji, kontrahent nie wystawia faktur:
--       * rachunek kontrahenta = rachunek z umowy i kwota = kwota okresu → przypięcie automatyczne do najwcześniejszego
--         nieopłaconego okresu (nie późniejszego niż miesiąc po dacie operacji);
--       * rachunek zgodny, kwota inna → propozycja z podziałem na okresy i informacją o różnicy;
--       * nazwa kontrahenta (albo NIP) w przelewie i kwota okresu → propozycja do zatwierdzenia;
--       * kilka pasujących umów → wybór.
--     Odrzucona propozycja i odpięta płatność blokują tę umowę dla tej operacji (nie wraca przy kolejnym uzgodnieniu).
--     Zatwierdzenie przez człowieka dopisuje do umowy bez rachunku rachunek z przelewu — kolejne okresy przypiszą się same.
--     Licznik auto_contracts w podsumowaniu przebiegu.
--  4. accept_bank_reconciliation_proposal obsługuje dokumenty „contract”; get_bank_reconciliation_month pokazuje płatności umów
--     przy operacji (contracts) i umowy obowiązujące w miesiącu (należne, zapłacone, brak).
--  5. RPC: save / delete (bez płatności — usuwa, z płatnościami — kończy umowę) / pliki / link_bank_transaction_to_recurring_contract /
--     undo_bank_recurring_contract_payment / get_finance_recurring_contracts (okresy od początku do bieżącego miesiąca).
--
-- UPRAWNIENIA: jak deklaracje — odczyt: poziom finansów działalności ≥ finance_view, zmiany: finance_manage tej działalności
-- (wyłącznie przez RPC). Zwykły pracownik, inna działalność, konto portalu sprzedawcy i anon — brak dostępu.
-- Wymaga: 20261101165000, 20261101190000, 20261101200000, 20261101201000, 20261101202000.
-- Zmiany dużych funkcji uzgadniania są punktowe (pg_get_functiondef + zamiana fragmentu, który musi wystąpić dokładnie raz);
-- get_bank_reconciliation_month — pełna definicja oparta na wersji z 20261101200000.
-- Bez tabel tymczasowych; plik można bezpiecznie uruchomić ponownie (w całości w SQL Editorze).
BEGIN;

-- 0. Warunki wstępne -------------------------------------------------------------------------------------------
DO $pre$
BEGIN
  IF to_regprocedure('public.finance_company_level_at_least(uuid,text)') IS NULL
     OR to_regprocedure('public.finance_company_manageable(uuid)') IS NULL
     OR to_regprocedure('private.require_finance_manage_for_transaction(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Najpierw zastosuj migrację 20261101165000_finance_company_access.sql.';
  END IF;
  IF to_regprocedure('private.crm_employee_allowed()') IS NULL THEN
    RAISE EXCEPTION 'Najpierw zastosuj migrację 20261101190000_security_p0.sql.';
  END IF;
  IF to_regprocedure('private.bank_document_kind(text,uuid)') IS NULL
     OR position('bank_document_kind' IN pg_get_functiondef('public.get_bank_reconciliation_month(uuid,integer,integer)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'Najpierw zastosuj migrację 20261101200000_reconciliation_document_details.sql.';
  END IF;
  IF to_regprocedure('private.bank_amount_only_plausible(date,boolean,text,text,date,date,text,text,numeric)') IS NULL
     OR position('bank_amount_only_plausible' IN pg_get_functiondef('public.reconcile_bank_month(uuid,integer,integer)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'Najpierw zastosuj migrację 20261101201000_reconciliation_amount_only_guard.sql.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'public.bank_transactions'::regclass AND conname = 'bank_transactions_accounting_subtype_check'
                   AND pg_get_constraintdef(oid) LIKE '%owner_deposit%') THEN
    RAISE EXCEPTION 'Najpierw zastosuj migrację 20261101202000_bank_owner_deposit_withdrawal.sql.';
  END IF;
END $pre$;

-- 1. Tabele ------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.finance_recurring_contracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  my_company_id uuid NOT NULL REFERENCES public.my_companies(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'rent' CHECK (kind IN ('rent', 'lease', 'subscription', 'insurance', 'loan', 'other')),
  direction text NOT NULL DEFAULT 'cost' CHECK (direction IN ('cost', 'income')),
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 2 AND 200),
  counterparty_name text NOT NULL CHECK (length(btrim(counterparty_name)) BETWEEN 2 AND 200),
  counterparty_nip text CHECK (counterparty_nip IS NULL OR counterparty_nip ~ '^[0-9]{10}$'),
  counterparty_account text CHECK (counterparty_account IS NULL OR counterparty_account ~ '^[0-9]{10,34}$'),
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  currency text NOT NULL DEFAULT 'PLN' CHECK (currency ~ '^[A-Z]{3}$'),
  billing_cycle text NOT NULL DEFAULT 'monthly' CHECK (billing_cycle IN ('monthly', 'quarterly', 'yearly')),
  payment_day smallint CHECK (payment_day IS NULL OR payment_day BETWEEN 1 AND 31),
  start_date date NOT NULL CHECK (start_date BETWEEN DATE '2000-01-01' AND DATE '2100-12-31'),
  end_date date,
  payments_from date CHECK (payments_from IS NULL OR extract(day FROM payments_from) = 1),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'ended')),
  expects_invoice boolean NOT NULL DEFAULT false,
  notes text CHECK (notes IS NULL OR length(notes) <= 2000),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT finance_recurring_contracts_dates CHECK (end_date IS NULL OR end_date >= start_date),
  CONSTRAINT finance_recurring_contracts_ended_has_end CHECK (status = 'active' OR end_date IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_finance_recurring_contracts_company ON public.finance_recurring_contracts(my_company_id, status);
CREATE INDEX IF NOT EXISTS idx_finance_recurring_contracts_account ON public.finance_recurring_contracts(my_company_id, counterparty_account)
  WHERE counterparty_account IS NOT NULL;
COMMENT ON TABLE public.finance_recurring_contracts IS
  'Umowy stałe (najem, leasing, abonament, raty ubezpieczenia, kredyt / pożyczka): kwota na okres, cykl, rachunek kontrahenta; płatności z wyciągów przypisywane do okresów.';
COMMENT ON COLUMN public.finance_recurring_contracts.direction IS 'cost — płacimy (przelew wychodzący), income — otrzymujemy (wpływ).';
COMMENT ON COLUMN public.finance_recurring_contracts.counterparty_account IS 'Rachunek kontrahenta — same cyfry (polski NRB: 26). Zgodny rachunek i kwota okresu = przypięcie automatyczne.';
COMMENT ON COLUMN public.finance_recurring_contracts.amount IS 'Kwota brutto na jeden okres (w walucie umowy).';
COMMENT ON COLUMN public.finance_recurring_contracts.billing_cycle IS 'monthly / quarterly / yearly — okresy liczone od miesiąca początku umowy.';
COMMENT ON COLUMN public.finance_recurring_contracts.payment_day IS 'Dzień płatności w pierwszym miesiącu okresu (NULL — do końca tego miesiąca). Po nim nieopłacony okres jest „po terminie”.';
COMMENT ON COLUMN public.finance_recurring_contracts.end_date IS 'Koniec umowy. NULL — umowa na czas nieokreślony.';
COMMENT ON COLUMN public.finance_recurring_contracts.payments_from IS 'Rozliczaj płatności od (pierwszy dzień miesiąca). Wcześniejsze okresy nie są pokazywane jako brak płatności. NULL — od początku umowy.';
COMMENT ON COLUMN public.finance_recurring_contracts.expects_invoice IS 'Kontrahent wystawia faktury — płatność wiąże się z fakturą (KSeF / spoza KSeF), umowa tylko informuje; przelewów nie przypisuje się do umowy.';

CREATE TABLE IF NOT EXISTS public.finance_recurring_contract_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id uuid NOT NULL REFERENCES public.finance_recurring_contracts(id) ON DELETE RESTRICT,
  period_start date NOT NULL CHECK (extract(day FROM period_start) = 1),
  bank_transaction_id uuid NOT NULL REFERENCES public.bank_transactions(id) ON DELETE CASCADE,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  match_method text NOT NULL DEFAULT 'manual' CHECK (match_method IN ('automatic', 'manual')),
  match_reasons text[] NOT NULL DEFAULT ARRAY[]::text[],
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT finance_recurring_contract_payments_unique UNIQUE (contract_id, period_start, bank_transaction_id)
);
CREATE INDEX IF NOT EXISTS idx_finance_recurring_contract_payments_tx ON public.finance_recurring_contract_payments(bank_transaction_id);
COMMENT ON TABLE public.finance_recurring_contract_payments IS
  'Przelewy z wyciągów przypisane do okresów umów stałych (period_start — pierwszy dzień okresu). Liczą się do limitu kwoty operacji razem z fakturami, wypłatami i deklaracjami.';

CREATE TABLE IF NOT EXISTS public.finance_recurring_contract_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id uuid NOT NULL REFERENCES public.finance_recurring_contracts(id) ON DELETE CASCADE,
  storage_path text NOT NULL UNIQUE,
  file_name text NOT NULL,
  mime_type text,
  file_size bigint,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_finance_recurring_contract_files_contract ON public.finance_recurring_contract_files(contract_id);
COMMENT ON TABLE public.finance_recurring_contract_files IS 'Pliki umów stałych i aneksów — magazyn finance-contracts, ścieżka {działalność}/{umowa}/{plik}.';

-- RLS: odczyt — poziom finansów działalności ≥ finance_view; zapis wyłącznie przez RPC (SECURITY DEFINER).
DO $p$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['finance_recurring_contracts', 'finance_recurring_contract_payments', 'finance_recurring_contract_files'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_table);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_table || '_read', v_table);
    EXECUTE format('DROP POLICY IF EXISTS sales_finance_private ON public.%I', v_table);
    EXECUTE format('CREATE POLICY sales_finance_private ON public.%I AS RESTRICTIVE FOR ALL TO authenticated
      USING (public.invoice_finance_scope() <> ''sales'') WITH CHECK (public.invoice_finance_scope() <> ''sales'')', v_table);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon', v_table);
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.%I FROM authenticated', v_table);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', v_table);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', v_table);
  END LOOP;
END
$p$;
CREATE POLICY finance_recurring_contracts_read ON public.finance_recurring_contracts FOR SELECT TO authenticated
  USING (public.finance_company_level_at_least(my_company_id, 'finance_view'));
CREATE POLICY finance_recurring_contract_payments_read ON public.finance_recurring_contract_payments FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.finance_recurring_contracts c
    WHERE c.id = finance_recurring_contract_payments.contract_id AND public.finance_company_level_at_least(c.my_company_id, 'finance_view')));
CREATE POLICY finance_recurring_contract_files_read ON public.finance_recurring_contract_files FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.finance_recurring_contracts c
    WHERE c.id = finance_recurring_contract_files.contract_id AND public.finance_company_level_at_least(c.my_company_id, 'finance_view')));

-- Pliki umów: prywatny bucket, ścieżka <działalność>/<umowa>/<plik>.
DO $s$
BEGIN
  IF to_regclass('storage.buckets') IS NULL THEN RETURN; END IF;
  INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  VALUES ('finance-contracts', 'finance-contracts', false, 20971520,
    ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/msword',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.oasis.opendocument.text',
          'application/zip', 'application/octet-stream'])
  ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

  EXECUTE 'DROP POLICY IF EXISTS finance_contracts_storage_read ON storage.objects';
  EXECUTE $q$CREATE POLICY finance_contracts_storage_read ON storage.objects FOR SELECT TO authenticated
    USING (bucket_id = 'finance-contracts' AND EXISTS (
      SELECT 1 FROM public.finance_recurring_contracts c
      WHERE c.id::text = (storage.foldername(name))[2] AND c.my_company_id::text = (storage.foldername(name))[1]
        AND public.finance_company_level_at_least(c.my_company_id, 'finance_view')))$q$;
  EXECUTE 'DROP POLICY IF EXISTS finance_contracts_storage_insert ON storage.objects';
  EXECUTE $q$CREATE POLICY finance_contracts_storage_insert ON storage.objects FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'finance-contracts' AND EXISTS (
      SELECT 1 FROM public.finance_recurring_contracts c
      WHERE c.id::text = (storage.foldername(name))[2] AND c.my_company_id::text = (storage.foldername(name))[1]
        AND public.finance_company_manageable(c.my_company_id)))$q$;
  EXECUTE 'DROP POLICY IF EXISTS finance_contracts_storage_delete ON storage.objects';
  EXECUTE $q$CREATE POLICY finance_contracts_storage_delete ON storage.objects FOR DELETE TO authenticated
    USING (bucket_id = 'finance-contracts' AND EXISTS (
      SELECT 1 FROM public.finance_recurring_contracts c
      WHERE c.id::text = (storage.foldername(name))[2] AND c.my_company_id::text = (storage.foldername(name))[1]
        AND public.finance_company_manageable(c.my_company_id)))$q$;
END
$s$;

-- 2. Okresy umowy (funkcje pomocnicze, tylko dla funkcji serwera) ---------------------------------------------------
CREATE OR REPLACE FUNCTION private.recurring_contract_step(p_cycle text)
RETURNS integer LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = pg_catalog AS $$
  SELECT CASE p_cycle WHEN 'quarterly' THEN 3 WHEN 'yearly' THEN 12 ELSE 1 END
$$;

-- Pierwszy dzień okresu, w którym leży data (okresy liczone od miesiąca początku umowy).
CREATE OR REPLACE FUNCTION private.recurring_contract_period_of(p_start date, p_cycle text, p_date date)
RETURNS date LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = pg_catalog AS $$
  SELECT (date_trunc('month', p_start::timestamp) + make_interval(months => private.recurring_contract_step(p_cycle)
    * floor(((extract(year FROM p_date) - extract(year FROM p_start)) * 12 + extract(month FROM p_date) - extract(month FROM p_start))
            / private.recurring_contract_step(p_cycle))::int))::date
$$;

-- Pierwszy rozliczany okres: okres z datą początku albo z „rozliczaj płatności od”, jeśli późniejsza.
CREATE OR REPLACE FUNCTION private.recurring_contract_first_period(p_start date, p_payments_from date, p_cycle text)
RETURNS date LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = pg_catalog AS $$
  SELECT private.recurring_contract_period_of(p_start, p_cycle, greatest(p_start, coalesce(p_payments_from, p_start)))
$$;

-- Termin płatności okresu: dzień płatności w pierwszym miesiącu okresu (krótszy miesiąc — ostatni dzień), bez dnia — koniec miesiąca.
CREATE OR REPLACE FUNCTION private.recurring_contract_due_date(p_period_start date, p_payment_day integer)
RETURNS date LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = pg_catalog AS $$
  SELECT CASE WHEN p_payment_day IS NULL THEN (p_period_start + interval '1 month' - interval '1 day')::date
    ELSE p_period_start + (least(p_payment_day, extract(day FROM (p_period_start + interval '1 month' - interval '1 day'))::int) - 1) END
$$;

CREATE OR REPLACE FUNCTION private.recurring_contract_period_label(p_cycle text, p_period_start date)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = pg_catalog AS $$
  SELECT CASE
    WHEN p_period_start IS NULL THEN NULL
    WHEN coalesce(p_cycle, 'monthly') = 'monthly' THEN to_char(p_period_start, 'MM/YYYY')
    WHEN p_cycle = 'yearly' AND extract(month FROM p_period_start) = 1 THEN to_char(p_period_start, 'YYYY')
    ELSE to_char(p_period_start, 'MM/YYYY') || '–'
      || to_char(p_period_start + make_interval(months => private.recurring_contract_step(p_cycle) - 1), 'MM/YYYY') END
$$;

CREATE OR REPLACE FUNCTION private.recurring_contract_account_label(p_account text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = pg_catalog AS $$
  SELECT CASE WHEN length(coalesce(p_account, '')) = 26
    THEN substr(p_account, 1, 2) || ' ' || substr(p_account, 3, 4) || ' ' || substr(p_account, 7, 4) || ' ' || substr(p_account, 11, 4)
      || ' ' || substr(p_account, 15, 4) || ' ' || substr(p_account, 19, 4) || ' ' || substr(p_account, 23, 4)
    ELSE p_account END
$$;

-- Nazwa kontrahenta w treści przelewu: pierwsze dwa znaczące słowa nazwy (bez form prawnych) muszą wystąpić w tekście
-- („MARIUSZ SKARUL” → MARIUSZ i SKARUL; „PKO Leasing S.A.” → PKO i LEASING). Samo imię nie wystarcza.
CREATE OR REPLACE FUNCTION private.recurring_contract_name_match(p_name text, p_text_norm text)
RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = pg_catalog AS $$
  SELECT coalesce((
    SELECT count(*) > 0 AND bool_and(position(' ' || s.w || ' ' IN ' ' || coalesce(p_text_norm, '') || ' ') > 0)
    FROM (
      SELECT t.w FROM regexp_split_to_table(private.bank_norm(p_name), ' ') WITH ORDINALITY AS t(w, o)
      WHERE length(t.w) >= 3 AND t.w NOT IN ('SPOLKA', 'SPOLKI', 'FIRMA', 'USLUGI', 'HANDLOWA', 'HANDEL', 'PRZEDSIEBIORSTWO',
        'PPHU', 'PHU', 'FHU', 'GRUPA', 'POLSKA', 'POLSKIE', 'OGRANICZONA', 'ODPOWIEDZIALNOSCIA', 'AKCYJNA', 'KOMANDYTOWA',
        'JAWNA', 'CYWILNA', 'ZOO', 'SKA', 'SPK', 'THE', 'AND', 'LTD', 'GMBH', 'INC', 'PANI', 'PAN')
      ORDER BY t.o LIMIT 2
    ) s), false)
$$;

CREATE OR REPLACE FUNCTION private.recurring_contract_period_valid(p_contract_id uuid, p_period date)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT coalesce((
    SELECT p_period >= private.recurring_contract_first_period(c.start_date, c.payments_from, c.billing_cycle)
      AND (c.end_date IS NULL OR p_period <= c.end_date)
      AND private.recurring_contract_period_of(c.start_date, c.billing_cycle, p_period) = p_period
    FROM public.finance_recurring_contracts c WHERE c.id = p_contract_id), false)
$$;

-- Okresy umowy od pierwszego rozliczanego do p_until (i dalej, jeśli są płatności za późniejsze okresy), nie dalej niż koniec umowy.
CREATE OR REPLACE FUNCTION private.recurring_contract_periods(p_contract_id uuid, p_until date)
RETURNS TABLE (period_start date, period_end date, due_date date, amount numeric, paid numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT g.ps::date,
         (g.ps + make_interval(months => private.recurring_contract_step(c.billing_cycle)) - interval '1 day')::date,
         private.recurring_contract_due_date(g.ps::date, c.payment_day),
         c.amount,
         coalesce((SELECT sum(p.amount) FROM public.finance_recurring_contract_payments p
                   WHERE p.contract_id = c.id AND p.period_start = g.ps::date), 0)
  FROM public.finance_recurring_contracts c
  CROSS JOIN LATERAL generate_series(
    private.recurring_contract_first_period(c.start_date, c.payments_from, c.billing_cycle)::timestamp,
    least(coalesce(c.end_date, 'infinity'::date),
          greatest(coalesce(p_until, CURRENT_DATE),
                   coalesce((SELECT max(p.period_start) FROM public.finance_recurring_contract_payments p WHERE p.contract_id = c.id),
                            coalesce(p_until, CURRENT_DATE))))::timestamp,
    make_interval(months => private.recurring_contract_step(c.billing_cycle))) AS g(ps)
  WHERE c.id = p_contract_id
$$;

-- Najwcześniejszy nieopłacony okres nie późniejszy niż miesiąc po dacie operacji (domyślny okres przypisania).
CREATE OR REPLACE FUNCTION private.recurring_contract_open_period(p_contract_id uuid, p_tx_date date)
RETURNS TABLE (period_start date, open numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT x.period_start, round(x.amount - x.paid, 2)
  FROM private.recurring_contract_periods(p_contract_id, (date_trunc('month', p_tx_date::timestamp) + interval '1 month')::date) x
  WHERE x.paid < x.amount - 0.009
    AND x.period_start <= (date_trunc('month', p_tx_date::timestamp) + interval '1 month')::date
  ORDER BY x.period_start
  LIMIT 1
$$;

-- Dokument propozycji uzgodnienia: umowa + okres.
CREATE OR REPLACE FUNCTION private.recurring_contract_doc(p_contract_id uuid, p_period date, p_amount numeric, p_evidence text DEFAULT NULL)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT jsonb_strip_nulls(jsonb_build_object(
    'source', 'contract', 'id', c.id, 'number', c.title, 'party', c.counterparty_name, 'amount', round(p_amount, 2),
    'period_start', p_period, 'period_label', private.recurring_contract_period_label(c.billing_cycle, p_period),
    'contract_amount', c.amount, 'contract_kind', c.kind,
    'due_date', CASE WHEN p_period IS NOT NULL THEN private.recurring_contract_due_date(p_period, c.payment_day) END,
    'evidence', p_evidence))
  FROM public.finance_recurring_contracts c WHERE c.id = p_contract_id
$$;

-- Podział kwoty na kolejne nieopłacone okresy (od najwcześniejszego, który nie jest późniejszy niż miesiąc po dacie operacji;
-- najwyżej 12 okresów). Pusta tablica — brak takiego okresu.
CREATE OR REPLACE FUNCTION private.recurring_contract_fill(p_contract_id uuid, p_tx_date date, p_amount numeric, p_evidence text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_left numeric := round(coalesce(p_amount, 0), 2);
  v_docs jsonb := '[]'::jsonb;
  v_limit date := (date_trunc('month', p_tx_date::timestamp) + interval '1 month')::date;
  r record;
BEGIN
  FOR r IN
    SELECT x.period_start, round(x.amount - x.paid, 2) AS open
    FROM private.recurring_contract_periods(p_contract_id, (date_trunc('month', p_tx_date::timestamp) + interval '13 months')::date) x
    WHERE x.paid < x.amount - 0.009
    ORDER BY x.period_start
  LOOP
    EXIT WHEN v_left <= 0.009 OR jsonb_array_length(v_docs) >= 12;
    EXIT WHEN jsonb_array_length(v_docs) = 0 AND r.period_start > v_limit;
    v_docs := v_docs || jsonb_build_array(private.recurring_contract_doc(p_contract_id, r.period_start, least(v_left, r.open), p_evidence));
    v_left := v_left - least(v_left, r.open);
  END LOOP;
  RETURN v_docs;
END;
$$;

-- Umowy pasujące do operacji (reguła „umowa stała”): kierunek, waluta, umowa obowiązuje w dniu operacji, bez faktur,
-- nie odrzucona przez człowieka dla tej operacji. acct — rachunek z umowy; name_ok — nazwa (lub NIP) w przelewie.
CREATE OR REPLACE FUNCTION private.recurring_contract_candidates(p_company_id uuid, p_date date, p_dir text, p_currency text,
  p_iban text, p_text_norm text, p_text_compact text, p_amount numeric, p_rejected uuid[])
RETURNS TABLE (contract_id uuid, title text, counterparty_name text, counterparty_account text, amount numeric,
  acct boolean, name_ok boolean, amount_ok boolean, period_start date, open numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT c.id, c.title, c.counterparty_name, c.counterparty_account, c.amount,
         coalesce(c.counterparty_account IS NOT NULL AND (coalesce(p_iban, '') = c.counterparty_account
           OR (length(c.counterparty_account) >= 20 AND position(c.counterparty_account IN coalesce(p_text_compact, '')) > 0)), false),
         private.recurring_contract_name_match(c.counterparty_name, p_text_norm)
           OR coalesce(c.counterparty_nip IS NOT NULL AND position(c.counterparty_nip IN coalesce(p_text_compact, '')) > 0, false),
         abs(coalesce(p_amount, 0) - c.amount) <= 0.01,
         op.period_start, op.open
  FROM public.finance_recurring_contracts c
  LEFT JOIN LATERAL private.recurring_contract_open_period(c.id, p_date) op ON true
  WHERE c.my_company_id = p_company_id AND NOT c.expects_invoice
    AND c.currency = upper(coalesce(p_currency, 'PLN'))
    AND c.direction = CASE WHEN p_dir = 'debit' THEN 'cost' ELSE 'income' END
    AND c.start_date <= p_date AND (c.end_date IS NULL OR c.end_date >= p_date)
    AND NOT (c.id = ANY (coalesce(p_rejected, '{}'::uuid[])))
$$;

-- 3. Płatności umów: kontrola i jeden limit kwoty operacji -----------------------------------------------------------
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
$$;

CREATE OR REPLACE FUNCTION private.guard_finance_recurring_contract_payment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_bt public.bank_transactions%ROWTYPE;
  v_contract public.finance_recurring_contracts%ROWTYPE;
  v_company uuid;
  v_allocated numeric;
BEGIN
  SELECT * INTO v_bt FROM public.bank_transactions WHERE id = NEW.bank_transaction_id;
  IF NOT FOUND THEN RETURN NEW; END IF;
  IF v_bt.canonical_transaction_id IS NOT NULL THEN
    RAISE EXCEPTION 'Ta operacja to kopia z drugiego wyciągu (PDF/MT940). Rozliczaj operację potwierdzoną.' USING ERRCODE = '23514';
  END IF;
  IF v_bt.paired_bank_transaction_id IS NOT NULL THEN
    RAISE EXCEPTION 'To przeniesienie między rachunkiem bieżącym a VAT, a nie płatność umowy.' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO v_contract FROM public.finance_recurring_contracts WHERE id = NEW.contract_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Nie znaleziono umowy.' USING ERRCODE = '23514'; END IF;
  SELECT s.my_company_id INTO v_company FROM public.bank_statements s WHERE s.id = v_bt.statement_id;
  IF v_company IS DISTINCT FROM v_contract.my_company_id THEN
    RAISE EXCEPTION 'Umowa i operacja należą do różnych działalności.' USING ERRCODE = '23514';
  END IF;
  IF v_contract.expects_invoice THEN
    RAISE EXCEPTION 'Kontrahent umowy „%” wystawia faktury — przypisz płatność do faktury („Wybierz dokument”), a nie do umowy.', v_contract.title
      USING ERRCODE = '23514';
  END IF;
  IF v_contract.direction = 'cost' AND v_bt.transaction_type <> 'debit' THEN
    RAISE EXCEPTION 'Umowa „%” to koszt (płacimy) — przypisz przelew wychodzący.', v_contract.title USING ERRCODE = '23514';
  END IF;
  IF v_contract.direction = 'income' AND v_bt.transaction_type <> 'credit' THEN
    RAISE EXCEPTION 'Umowa „%” to przychód (otrzymujemy) — przypisz wpływ.', v_contract.title USING ERRCODE = '23514';
  END IF;
  IF upper(coalesce(v_bt.currency, 'PLN')) <> v_contract.currency THEN
    RAISE EXCEPTION 'Waluta operacji (%) jest inna niż waluta umowy (%).', upper(coalesce(v_bt.currency, 'PLN')), v_contract.currency
      USING ERRCODE = '23514';
  END IF;
  IF NOT private.recurring_contract_period_valid(NEW.contract_id, NEW.period_start) THEN
    RAISE EXCEPTION 'Okres % nie należy do umowy „%” (początek %, cykl: %).', to_char(NEW.period_start, 'MM/YYYY'), v_contract.title,
      to_char(v_contract.start_date, 'DD.MM.YYYY'),
      CASE v_contract.billing_cycle WHEN 'quarterly' THEN 'kwartał' WHEN 'yearly' THEN 'rok' ELSE 'miesiąc' END
      USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.bank_transaction_id IS NOT DISTINCT FROM OLD.bank_transaction_id AND NEW.amount <= OLD.amount THEN
    RETURN NEW;
  END IF;
  v_allocated := private.bank_transaction_allocated(NEW.bank_transaction_id)
    - CASE WHEN TG_OP = 'UPDATE' AND OLD.bank_transaction_id = NEW.bank_transaction_id THEN OLD.amount ELSE 0 END;
  IF v_allocated + NEW.amount > abs(v_bt.amount) + 0.01 THEN
    RAISE EXCEPTION 'Operacja z % na % byłaby rozliczona ponad swoją kwotę (przypisano już %).',
      to_char(v_bt.transaction_date, 'DD.MM.YYYY'), private.money_pl(abs(v_bt.amount)), private.money_pl(v_allocated)
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS finance_recurring_contract_payment_guard ON public.finance_recurring_contract_payments;
CREATE TRIGGER finance_recurring_contract_payment_guard
  BEFORE INSERT OR UPDATE OF bank_transaction_id, amount, contract_id, period_start ON public.finance_recurring_contract_payments
  FOR EACH ROW EXECUTE FUNCTION private.guard_finance_recurring_contract_payment();

CREATE OR REPLACE FUNCTION private.sync_finance_recurring_contract_payment_state()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP <> 'DELETE' THEN
    PERFORM public.recalculate_bank_transaction_match_state(NEW.bank_transaction_id);
  END IF;
  IF TG_OP <> 'INSERT' AND (TG_OP = 'DELETE' OR OLD.bank_transaction_id IS DISTINCT FROM NEW.bank_transaction_id) THEN
    PERFORM public.recalculate_bank_transaction_match_state(OLD.bank_transaction_id);
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS finance_recurring_contract_payment_sync ON public.finance_recurring_contract_payments;
CREATE TRIGGER finance_recurring_contract_payment_sync
  AFTER INSERT OR UPDATE OR DELETE ON public.finance_recurring_contract_payments
  FOR EACH ROW EXECUTE FUNCTION private.sync_finance_recurring_contract_payment_state();

-- Status operacji: płatności umów liczą się jak płatności deklaracji (treść jak dotąd + umowy).
DO $chk$
DECLARE
  v_def text := pg_get_functiondef('public.recalculate_bank_transaction_match_state(uuid)'::regprocedure);
BEGIN
  IF position('finance_recurring_contract_payments' IN v_def) = 0 AND position('v_declaration_manual' IN v_def) = 0 THEN
    RAISE EXCEPTION 'recalculate_bank_transaction_match_state ma nieoczekiwaną treść (brak obsługi deklaracji z 20261101130000). Sprawdź ręcznie.';
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
  v_invoice_count integer;
  v_personnel_count integer;
  v_declaration_count integer;
  v_contract_count integer;
  v_declaration_manual boolean;
  v_contract_manual boolean;
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

  v_allocated := ROUND(COALESCE(v_invoice_allocated, 0) + COALESCE(v_personnel_allocated, 0) + COALESCE(v_declaration_allocated, 0)
    + COALESCE(v_contract_allocated, 0), 2);
  v_count := COALESCE(v_invoice_count, 0) + COALESCE(v_personnel_count, 0) + COALESCE(v_declaration_count, 0) + COALESCE(v_contract_count, 0);

  UPDATE public.bank_transactions
  SET allocated_amount = v_allocated,
      matched_document_count = v_count,
      match_status = CASE
        WHEN v_allocated <= 0.009 THEN 'unmatched'
        WHEN v_allocated >= v_total - 0.01 THEN 'matched'
        ELSE 'partial'
      END,
      matched_invoice_id = CASE WHEN v_count = 1 AND v_personnel_count = 0 AND v_declaration_count = 0 AND v_contract_count = 0 THEN v_single_ksef END,
      match_confidence = v_confidence,
      manual_match = v_manual OR v_personnel_count > 0 OR v_declaration_manual OR v_contract_manual
  WHERE id = p_transaction_id;
END;
$function$;

-- Scalanie i przejmowanie kopii operacji (PDF ↔ MT940) przenosi też płatności umów; operacja z płatnością umowy
-- i kopią w drugim pliku nie może zniknąć bez decyzji (jak przy fakturach, wypłatach i deklaracjach).
DO $patch$
DECLARE
  v_fns regprocedure[] := ARRAY[
    'private.merge_bank_transaction_copy(uuid,uuid)'::regprocedure,
    'private.merge_bank_transaction_copy(uuid,uuid)'::regprocedure,
    'private.merge_bank_transaction_copy(uuid,uuid)'::regprocedure,
    'private.promote_bank_transaction_copy_for(uuid)'::regprocedure,
    'private.promote_bank_transaction_copy()'::regprocedure];
  v_olds text[] := ARRAY[
    E'            OR EXISTS (SELECT 1 FROM public.finance_declaration_payments WHERE bank_transaction_id = c.id);',
    E'            OR EXISTS (SELECT 1 FROM public.finance_declaration_payments WHERE bank_transaction_id = p.id);',
    E'    UPDATE public.finance_declaration_payments SET bank_transaction_id = c.id WHERE bank_transaction_id = p.id;',
    E'  UPDATE public.finance_declaration_payments SET bank_transaction_id = v_copy WHERE bank_transaction_id = o.id;',
    E'       OR EXISTS (SELECT 1 FROM public.finance_declaration_payments f WHERE f.bank_transaction_id = OLD.id) THEN'];
  v_news text[] := ARRAY[
    E'            OR EXISTS (SELECT 1 FROM public.finance_declaration_payments WHERE bank_transaction_id = c.id)\n'
      || E'            OR EXISTS (SELECT 1 FROM public.finance_recurring_contract_payments WHERE bank_transaction_id = c.id);',
    E'            OR EXISTS (SELECT 1 FROM public.finance_declaration_payments WHERE bank_transaction_id = p.id)\n'
      || E'            OR EXISTS (SELECT 1 FROM public.finance_recurring_contract_payments WHERE bank_transaction_id = p.id);',
    E'    UPDATE public.finance_declaration_payments SET bank_transaction_id = c.id WHERE bank_transaction_id = p.id;\n'
      || E'    UPDATE public.finance_recurring_contract_payments SET bank_transaction_id = c.id WHERE bank_transaction_id = p.id;',
    E'  UPDATE public.finance_declaration_payments SET bank_transaction_id = v_copy WHERE bank_transaction_id = o.id;\n'
      || E'  UPDATE public.finance_recurring_contract_payments SET bank_transaction_id = v_copy WHERE bank_transaction_id = o.id;',
    E'       OR EXISTS (SELECT 1 FROM public.finance_declaration_payments f WHERE f.bank_transaction_id = OLD.id)\n'
      || E'       OR EXISTS (SELECT 1 FROM public.finance_recurring_contract_payments r WHERE r.bank_transaction_id = OLD.id) THEN'];
  v_fn regprocedure;
  v_def text;
  i int;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY(SELECT DISTINCT unnest(v_fns)) LOOP
    v_def := pg_get_functiondef(v_fn);
    IF position('finance_recurring_contract_payments' IN v_def) > 0 THEN
      RAISE NOTICE '% obsługuje już płatności umów — pomijam.', v_fn;
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

-- 4. Przypisanie przelewu do okresu umowy (wspólne dla RPC, automatu i zatwierdzenia propozycji) -------------------------
CREATE OR REPLACE FUNCTION private.link_recurring_contract_payment(p_transaction_id uuid, p_contract_id uuid, p_period date,
  p_amount numeric, p_method text, p_reasons text[], p_company_id uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_contract public.finance_recurring_contracts%ROWTYPE;
  v_bt public.bank_transactions%ROWTYPE;
  v_period date := CASE WHEN p_period IS NULL THEN NULL ELSE date_trunc('month', p_period::timestamp)::date END;
  v_open numeric;
  v_amount numeric;
  v_iban text;
  v_reasons text[] := coalesce(p_reasons, ARRAY[]::text[]);
  v_id uuid;
BEGIN
  SELECT * INTO v_contract FROM public.finance_recurring_contracts WHERE id = p_contract_id FOR UPDATE;
  IF NOT FOUND OR (p_company_id IS NOT NULL AND v_contract.my_company_id IS DISTINCT FROM p_company_id) THEN
    RAISE EXCEPTION 'Umowa nie należy do działalności tej operacji.';
  END IF;
  SELECT * INTO v_bt FROM public.bank_transactions WHERE id = p_transaction_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Nie znaleziono operacji. Odśwież widok.'; END IF;
  IF v_contract.expects_invoice THEN
    RAISE EXCEPTION 'Kontrahent umowy „%” wystawia faktury — przypisz płatność do faktury („Wybierz dokument”), a nie do umowy.', v_contract.title;
  END IF;
  IF v_period IS NULL THEN
    SELECT o.period_start INTO v_period FROM private.recurring_contract_open_period(p_contract_id, v_bt.transaction_date) o;
    IF v_period IS NULL THEN
      RAISE EXCEPTION 'Umowa „%” nie ma nieopłaconego okresu do % włącznie. Wybierz okres ręcznie.', v_contract.title,
        to_char(v_bt.transaction_date + interval '1 month', 'MM/YYYY');
    END IF;
  END IF;
  IF NOT private.recurring_contract_period_valid(p_contract_id, v_period) THEN
    RAISE EXCEPTION 'Okres % nie należy do umowy „%”.', to_char(v_period, 'MM/YYYY'), v_contract.title;
  END IF;
  SELECT round(v_contract.amount - coalesce(sum(p.amount), 0), 2) INTO v_open
  FROM public.finance_recurring_contract_payments p WHERE p.contract_id = p_contract_id AND p.period_start = v_period;
  IF p_amount IS NULL THEN
    IF v_open <= 0.009 THEN
      RAISE EXCEPTION 'Okres % umowy „%” jest już opłacony. Wybierz inny okres albo podaj kwotę.',
        private.recurring_contract_period_label(v_contract.billing_cycle, v_period), v_contract.title;
    END IF;
    v_amount := least(round(abs(v_bt.amount) - private.bank_transaction_allocated(v_bt.id), 2), v_open);
  ELSE
    v_amount := round(p_amount, 2);
  END IF;
  IF v_amount IS NULL OR v_amount <= 0 THEN RAISE EXCEPTION 'Operacja jest już w całości rozliczona.'; END IF;

  -- Decyzja człowieka: rachunek z przelewu trafia do umowy bez rachunku — kolejne okresy przypiszą się automatycznie.
  v_iban := regexp_replace(coalesce(v_bt.counterparty_account, ''), '\D', '', 'g');
  IF p_method = 'manual' AND v_contract.counterparty_account IS NULL AND length(v_iban) BETWEEN 20 AND 34 THEN
    UPDATE public.finance_recurring_contracts SET counterparty_account = v_iban, updated_at = now() WHERE id = p_contract_id;
    v_reasons := v_reasons || ('Rachunek kontrahenta ' || private.recurring_contract_account_label(v_iban)
      || ' dopisany do umowy — kolejne okresy przypiszą się automatycznie.');
  END IF;

  INSERT INTO public.finance_recurring_contract_payments AS rp (contract_id, period_start, bank_transaction_id, amount, match_method,
    match_reasons, created_by)
  VALUES (p_contract_id, v_period, p_transaction_id, v_amount, CASE WHEN p_method = 'automatic' THEN 'automatic' ELSE 'manual' END,
    v_reasons, public.current_invoice_employee_id())
  ON CONFLICT (contract_id, period_start, bank_transaction_id) DO UPDATE
    SET amount = rp.amount + EXCLUDED.amount,
        match_method = CASE WHEN EXCLUDED.match_method = 'manual' THEN 'manual' ELSE rp.match_method END,
        match_reasons = rp.match_reasons || EXCLUDED.match_reasons
  RETURNING rp.id INTO v_id;
  RETURN v_id;
END;
$$;

-- 5. Reguła „umowa stała” w reconcile_bank_month (przed regułą „zgodna kwota”) ---------------------------------------------
DO $patch$
DECLARE
  v_def text := pg_get_functiondef('public.reconcile_bank_month(uuid,integer,integer)'::regprocedure);
  v_olds text[];
  v_news text[];
  v_rule text;
  i int;
BEGIN
  IF position('auto_contracts' IN v_def) > 0 THEN
    RAISE NOTICE 'reconcile_bank_month ma już regułę „umowa stała” — pomijam.';
    RETURN;
  END IF;

  v_rule := $rule$    -- Reguła „umowa stała” (rejestr „Umowy stałe”): najem, leasing, abonament… bez faktur za okres.
    --   rachunek kontrahenta z umowy i kwota okresu → przypięcie automatyczne do najwcześniejszego nieopłaconego okresu;
    --   rachunek zgodny, inna kwota → propozycja z podziałem na okresy; nazwa (albo NIP) i kwota → propozycja; kilka umów → wybór.
    IF NOT v_done THEN
      SELECT count(*) FILTER (WHERE x.acct AND x.amount_ok AND x.period_start IS NOT NULL AND abs(x.open - x.amount) <= 0.01),
             count(*) FILTER (WHERE x.acct),
             count(*) FILTER (WHERE NOT x.acct AND x.name_ok AND x.amount_ok AND x.period_start IS NOT NULL)
      INTO v_rc_auto, v_rc_acct, v_rc_name
      FROM private.recurring_contract_candidates(p_company_id, t.date, t.dir, t.currency, t.iban, t.text_norm, t.text_compact,
        t.remaining, v_rejected) x;

      IF v_rc_auto = 1 THEN
        SELECT * INTO v_rc
        FROM private.recurring_contract_candidates(p_company_id, t.date, t.dir, t.currency, t.iban, t.text_norm, t.text_compact,
          t.remaining, v_rejected) x
        WHERE x.acct AND x.amount_ok AND x.period_start IS NOT NULL AND abs(x.open - x.amount) <= 0.01
        LIMIT 1;
        v_done := true;
        v_label := private.recurring_contract_period_label((SELECT c.billing_cycle FROM public.finance_recurring_contracts c WHERE c.id = v_rc.contract_id), v_rc.period_start);
        v_reason := 'Reguła „umowa stała”: rachunek kontrahenta ' || private.recurring_contract_account_label(v_rc.counterparty_account) ||
          ' i kwota ' || private.money_pl(t.remaining) || ' jak w umowie „' || v_rc.title || '” (' || v_rc.counterparty_name || ')';
        BEGIN
          PERFORM private.link_recurring_contract_payment(t.id, v_rc.contract_id, v_rc.period_start, t.remaining, 'automatic',
            ARRAY[v_reason, 'Okres ' || v_label || ' — najwcześniejszy nieopłacony'], p_company_id);
          v_auto_contracts := v_auto_contracts + 1;
        EXCEPTION WHEN OTHERS THEN
          v_errors := v_errors + 1;
          IF private.add_bank_proposal(t.id, 'allocate', 'umowa_stala',
               jsonb_build_array(private.recurring_contract_doc(v_rc.contract_id, v_rc.period_start, t.remaining, 'rachunek i kwota jak w umowie')),
               'Przelew pasuje do umowy „' || v_rc.title || '” (okres ' || v_label || '), ale automatyczne przypisanie zatrzymała kontrola: ' || SQLERRM) THEN
            v_proposals := v_proposals + 1;
          END IF;
        END;
      ELSIF v_rc_auto > 1 THEN
        v_done := true;
        SELECT jsonb_agg(private.recurring_contract_doc(x.contract_id, x.period_start, least(t.remaining, x.open), 'rachunek i kwota jak w umowie')
                 ORDER BY x.period_start, x.title)
        INTO v_docs
        FROM private.recurring_contract_candidates(p_company_id, t.date, t.dir, t.currency, t.iban, t.text_norm, t.text_compact,
          t.remaining, v_rejected) x
        WHERE x.acct AND x.amount_ok AND x.period_start IS NOT NULL AND abs(x.open - x.amount) <= 0.01;
        IF private.add_bank_proposal(t.id, 'choose', 'umowa_stala', v_docs,
             v_rc_auto || ' umowy stałe mają ten rachunek kontrahenta i kwotę ' || private.money_pl(t.remaining) || '. Wybierz, której dotyczy przelew.') THEN
          v_choices := v_choices + 1;
        END IF;
      ELSIF v_rc_acct = 1 THEN
        SELECT * INTO v_rc
        FROM private.recurring_contract_candidates(p_company_id, t.date, t.dir, t.currency, t.iban, t.text_norm, t.text_compact,
          t.remaining, v_rejected) x
        WHERE x.acct LIMIT 1;
        v_docs := private.recurring_contract_fill(v_rc.contract_id, t.date, t.remaining, 'rachunek kontrahenta jak w umowie');
        IF jsonb_array_length(v_docs) = 0 THEN
          -- Bez nieopłaconego okresu — tylko wskazówka; pozostałe reguły mogą jeszcze znaleźć dokument.
          IF private.add_bank_proposal(t.id, 'hint', 'umowa_brak_okresu', '[]'::jsonb,
               'Przelew na rachunek z umowy „' || v_rc.title || '” (' || v_rc.counterparty_name || '), ale umowa nie ma nieopłaconego okresu do ' ||
               to_char(t.date + interval '1 month', 'MM/YYYY') || '. Sprawdź okresy w rejestrze „Umowy stałe” (nadpłata, kaucja, inna płatność).') THEN
            v_hints := v_hints + 1;
          END IF;
        ELSE
          v_done := true;
          SELECT string_agg(e.doc ->> 'period_label', ', ' ORDER BY e.ord), coalesce(sum((e.doc ->> 'amount')::numeric), 0)
          INTO v_label, v_sum
          FROM jsonb_array_elements(v_docs) WITH ORDINALITY AS e(doc, ord);
          IF private.add_bank_proposal(t.id, 'allocate', 'umowa_inna_kwota', v_docs,
               'Przelew na rachunek z umowy „' || v_rc.title || '” (' || v_rc.counterparty_name || ')' ||
               CASE WHEN abs(t.remaining - v_rc.amount) <= 0.01
                 THEN ' na kwotę okresu, ale najwcześniejszy nieopłacony okres jest już częściowo opłacony'
                 ELSE ', ale kwota ' || private.money_pl(t.remaining) || ' różni się od kwoty okresu ' || private.money_pl(v_rc.amount) ||
                      ' (różnica ' || private.money_pl(abs(t.remaining - v_rc.amount)) || ')' END ||
               '. Proponowany podział: ' || v_label || '.' ||
               CASE WHEN t.remaining - v_sum > 0.009 THEN ' Pozostałe ' || private.money_pl(t.remaining - v_sum) || ' zostanie bez przypisania.' ELSE '' END ||
               ' Sprawdź przed zatwierdzeniem (kilka okresów w jednym przelewie, waloryzacja, odsetki).') THEN
            v_proposals := v_proposals + 1;
          END IF;
        END IF;
      ELSIF v_rc_acct > 1 THEN
        v_done := true;
        SELECT jsonb_agg(private.recurring_contract_doc(x.contract_id, x.period_start, least(t.remaining, x.open), 'rachunek kontrahenta jak w umowie')
                 ORDER BY x.title)
        INTO v_docs
        FROM private.recurring_contract_candidates(p_company_id, t.date, t.dir, t.currency, t.iban, t.text_norm, t.text_compact,
          t.remaining, v_rejected) x
        WHERE x.acct AND x.period_start IS NOT NULL;
        IF v_docs IS NOT NULL AND private.add_bank_proposal(t.id, 'choose', 'umowa_inna_kwota', v_docs,
             'Rachunek kontrahenta jest w kilku umowach stałych, a kwota ' || private.money_pl(t.remaining) ||
             ' nie odpowiada jednoznacznie żadnej. Wybierz umowę (przypisanie obejmie jeden okres).') THEN
          v_choices := v_choices + 1;
        END IF;
      ELSIF v_rc_name = 1 THEN
        v_done := true;
        SELECT * INTO v_rc
        FROM private.recurring_contract_candidates(p_company_id, t.date, t.dir, t.currency, t.iban, t.text_norm, t.text_compact,
          t.remaining, v_rejected) x
        WHERE NOT x.acct AND x.name_ok AND x.amount_ok AND x.period_start IS NOT NULL LIMIT 1;
        v_label := private.recurring_contract_period_label((SELECT c.billing_cycle FROM public.finance_recurring_contracts c WHERE c.id = v_rc.contract_id), v_rc.period_start);
        IF private.add_bank_proposal(t.id, 'allocate', 'umowa_nazwa',
             jsonb_build_array(private.recurring_contract_doc(v_rc.contract_id, v_rc.period_start, least(t.remaining, v_rc.open), 'nazwa kontrahenta i kwota jak w umowie')),
             'Kontrahent „' || v_rc.counterparty_name || '” i kwota ' || private.money_pl(t.remaining) || ' jak w umowie „' || v_rc.title ||
             '” (okres ' || v_label || '). ' ||
             CASE WHEN v_rc.counterparty_account IS NULL
               THEN 'Umowa nie ma rachunku kontrahenta — po zatwierdzeniu dopiszę rachunek z przelewu, a kolejne okresy przypiszą się same.'
               ELSE 'Rachunek w przelewie jest inny niż w umowie — sprawdź przed zatwierdzeniem.' END) THEN
          v_proposals := v_proposals + 1;
        END IF;
      ELSIF v_rc_name > 1 THEN
        v_done := true;
        SELECT jsonb_agg(private.recurring_contract_doc(x.contract_id, x.period_start, least(t.remaining, x.open), 'nazwa kontrahenta i kwota jak w umowie')
                 ORDER BY x.title)
        INTO v_docs
        FROM private.recurring_contract_candidates(p_company_id, t.date, t.dir, t.currency, t.iban, t.text_norm, t.text_compact,
          t.remaining, v_rejected) x
        WHERE NOT x.acct AND x.name_ok AND x.amount_ok AND x.period_start IS NOT NULL;
        IF private.add_bank_proposal(t.id, 'choose', 'umowa_nazwa', v_docs,
             v_rc_name || ' umowy stałe mają tego kontrahenta i kwotę ' || private.money_pl(t.remaining) || '. Wybierz, której dotyczy przelew.') THEN
          v_choices := v_choices + 1;
        END IF;
      END IF;
    END IF;

$rule$;

  v_olds := ARRAY[
    E'  v_doc_amount numeric;\nBEGIN\n',
    E'    -- Reguła 7: zgodna kwota (i kontrahent) — zawsze do zatwierdzenia przez człowieka.\n',
    E'    ''auto_declarations'', v_auto_declarations,\n'
  ];
  v_news := ARRAY[
    E'  v_doc_amount numeric;\n  v_auto_contracts integer := 0;\n  v_rc record;\n  v_rc_auto integer;\n  v_rc_acct integer;\n  v_rc_name integer;\nBEGIN\n',
    v_rule || E'    -- Reguła 7: zgodna kwota (i kontrahent) — zawsze do zatwierdzenia przez człowieka.\n',
    E'    ''auto_declarations'', v_auto_declarations,\n    ''auto_contracts'', v_auto_contracts,\n'
  ];
  FOR i IN 1 .. array_length(v_olds, 1) LOOP
    IF (length(v_def) - length(replace(v_def, v_olds[i], ''))) / length(v_olds[i]) <> 1 THEN
      RAISE EXCEPTION 'reconcile_bank_month ma nieoczekiwaną treść (fragment nr % dla reguły „umowa stała”). Sprawdź ręcznie.', i;
    END IF;
    v_def := replace(v_def, v_olds[i], v_news[i]);
  END LOOP;
  EXECUTE v_def;
  RAISE NOTICE 'reconcile_bank_month: dodana reguła „umowa stała”.';
END $patch$;

-- 6. Zatwierdzenie propozycji: dokument „contract” = przypisanie przelewu do okresu umowy -------------------------------------
DO $patch$
DECLARE
  v_def text := pg_get_functiondef('public.accept_bank_reconciliation_proposal(uuid,integer)'::regprocedure);
  v_old text := E'    ELSIF v_doc ->> ''source'' = ''personnel'' THEN\n';
  v_new text := E'    ELSIF v_doc ->> ''source'' = ''contract'' THEN\n'
    || E'      PERFORM private.link_recurring_contract_payment(v_proposal.bank_transaction_id, (v_doc ->> ''id'')::uuid,\n'
    || E'        (v_doc ->> ''period_start'')::date, (v_doc ->> ''amount'')::numeric, ''manual'', ARRAY[v_reason], v_company);\n'
    || E'    ELSIF v_doc ->> ''source'' = ''personnel'' THEN\n';
BEGIN
  IF position('link_recurring_contract_payment' IN v_def) > 0 THEN
    RAISE NOTICE 'accept_bank_reconciliation_proposal obsługuje już umowy stałe — pomijam.';
    RETURN;
  END IF;
  IF (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 THEN
    RAISE EXCEPTION 'accept_bank_reconciliation_proposal ma nieoczekiwaną treść. Sprawdź ręcznie.';
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
END $patch$;

-- 7. RPC rejestru „Umowy stałe” --------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.require_finance_contracts(p_company_id uuid, p_manage boolean)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' AND NOT coalesce(
       CASE WHEN p_manage THEN public.finance_company_manageable(p_company_id)
            ELSE public.finance_company_level_at_least(p_company_id, 'finance_view') END, false) THEN
    RAISE EXCEPTION 'Brak uprawnień do umów stałych tej działalności.' USING ERRCODE = '42501';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.save_finance_recurring_contract(p_id uuid, p_company_id uuid, p_kind text, p_direction text,
  p_title text, p_counterparty_name text, p_counterparty_nip text, p_counterparty_account text, p_amount numeric, p_currency text,
  p_billing_cycle text, p_payment_day integer, p_start_date date, p_end_date date, p_payments_from date, p_status text,
  p_expects_invoice boolean, p_notes text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_old public.finance_recurring_contracts%ROWTYPE;
  v_nip text := nullif(regexp_replace(coalesce(p_counterparty_nip, ''), '\D', '', 'g'), '');
  v_account text := nullif(regexp_replace(coalesce(p_counterparty_account, ''), '\D', '', 'g'), '');
  v_currency text := upper(coalesce(nullif(btrim(p_currency), ''), 'PLN'));
  v_status text := coalesce(nullif(btrim(p_status), ''), 'active');
  v_end date := p_end_date;
  v_from date := CASE WHEN p_payments_from IS NULL THEN NULL ELSE date_trunc('month', p_payments_from::timestamp)::date END;
  v_today date := (now() AT TIME ZONE 'Europe/Warsaw')::date;
  v_last date;
  v_bad text;
  v_id uuid;
BEGIN
  PERFORM private.require_finance_contracts(p_company_id, true);
  IF p_kind IS NULL OR p_kind NOT IN ('rent', 'lease', 'subscription', 'insurance', 'loan', 'other') THEN
    RAISE EXCEPTION 'Nieznany rodzaj umowy.';
  END IF;
  IF p_direction IS NULL OR p_direction NOT IN ('cost', 'income') THEN RAISE EXCEPTION 'Wybierz, czy płacimy, czy otrzymujemy.'; END IF;
  IF p_billing_cycle IS NULL OR p_billing_cycle NOT IN ('monthly', 'quarterly', 'yearly') THEN RAISE EXCEPTION 'Nieznany cykl płatności.'; END IF;
  IF length(btrim(coalesce(p_title, ''))) < 2 THEN RAISE EXCEPTION 'Podaj tytuł umowy (np. „Najem garażu nr 6”).'; END IF;
  IF length(btrim(coalesce(p_counterparty_name, ''))) < 2 THEN RAISE EXCEPTION 'Podaj nazwę kontrahenta.'; END IF;
  IF v_nip IS NOT NULL AND length(v_nip) <> 10 THEN
    RAISE EXCEPTION 'NIP ma 10 cyfr. Numeru PESEL nie zapisujemy — przy osobie prywatnej zostaw pole puste.';
  END IF;
  IF v_account IS NOT NULL AND length(v_account) NOT BETWEEN 10 AND 34 THEN
    RAISE EXCEPTION 'Nieprawidłowy numer rachunku kontrahenta (polski rachunek ma 26 cyfr).';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'Podaj kwotę brutto na okres (większą od zera).'; END IF;
  IF v_currency !~ '^[A-Z]{3}$' THEN RAISE EXCEPTION 'Waluta to trzyliterowy kod (np. PLN, EUR).'; END IF;
  IF p_payment_day IS NOT NULL AND p_payment_day NOT BETWEEN 1 AND 31 THEN RAISE EXCEPTION 'Dzień płatności to liczba od 1 do 31.'; END IF;
  IF p_start_date IS NULL OR p_start_date NOT BETWEEN DATE '2000-01-01' AND DATE '2100-12-31' THEN
    RAISE EXCEPTION 'Podaj datę początku umowy.';
  END IF;
  IF v_status NOT IN ('active', 'ended') THEN RAISE EXCEPTION 'Nieznany status umowy.'; END IF;
  IF v_end IS NOT NULL AND v_end < p_start_date THEN RAISE EXCEPTION 'Data końca nie może być wcześniejsza niż data początku.'; END IF;
  IF v_status = 'ended' AND v_end IS NULL THEN
    -- Zakończenie bez daty: dziś, ale nie wcześniej niż koniec ostatniego opłaconego okresu.
    SELECT max(p.period_start) INTO v_last FROM public.finance_recurring_contract_payments p WHERE p.contract_id = p_id;
    v_end := greatest(p_start_date, v_today,
      coalesce((v_last + make_interval(months => private.recurring_contract_step(p_billing_cycle)) - interval '1 day')::date, v_today));
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.finance_recurring_contracts (my_company_id, kind, direction, title, counterparty_name, counterparty_nip,
      counterparty_account, amount, currency, billing_cycle, payment_day, start_date, end_date, payments_from, status,
      expects_invoice, notes, created_by)
    VALUES (p_company_id, p_kind, p_direction, btrim(p_title), btrim(p_counterparty_name), v_nip, v_account, round(p_amount, 2),
      v_currency, p_billing_cycle, p_payment_day, p_start_date, v_end, v_from, v_status, coalesce(p_expects_invoice, false),
      nullif(btrim(coalesce(p_notes, '')), ''), public.current_invoice_employee_id())
    RETURNING id INTO v_id;
  ELSE
    SELECT * INTO v_old FROM public.finance_recurring_contracts WHERE id = p_id FOR UPDATE;
    IF NOT FOUND OR v_old.my_company_id IS DISTINCT FROM p_company_id THEN RAISE EXCEPTION 'Nie znaleziono umowy.'; END IF;
    IF EXISTS (SELECT 1 FROM public.finance_recurring_contract_payments p WHERE p.contract_id = p_id) THEN
      IF v_old.direction <> p_direction OR v_old.currency <> v_currency THEN
        RAISE EXCEPTION 'Umowa ma przypisane płatności — nie można zmienić kierunku ani waluty. Zakończ ją i dodaj nową.';
      END IF;
      IF coalesce(p_expects_invoice, false) THEN
        RAISE EXCEPTION 'Umowa ma przypisane płatności z wyciągu — nie można jej przełączyć na rozliczanie fakturami. Najpierw odepnij płatności.';
      END IF;
    END IF;
    UPDATE public.finance_recurring_contracts
    SET kind = p_kind, direction = p_direction, title = btrim(p_title), counterparty_name = btrim(p_counterparty_name),
        counterparty_nip = v_nip, counterparty_account = v_account, amount = round(p_amount, 2), currency = v_currency,
        billing_cycle = p_billing_cycle, payment_day = p_payment_day, start_date = p_start_date, end_date = v_end,
        payments_from = v_from, status = v_status, expects_invoice = coalesce(p_expects_invoice, false),
        notes = nullif(btrim(coalesce(p_notes, '')), ''), updated_at = now()
    WHERE id = p_id;
    -- Płatności muszą pasować do okresów po zmianie (początek, cykl, koniec, „rozliczaj od”).
    SELECT string_agg(DISTINCT to_char(p.period_start, 'MM/YYYY'), ', ') INTO v_bad
    FROM public.finance_recurring_contract_payments p
    WHERE p.contract_id = p_id AND NOT private.recurring_contract_period_valid(p_id, p.period_start);
    IF v_bad IS NOT NULL THEN
      RAISE EXCEPTION 'Po tej zmianie płatności za okresy % nie pasują do umowy (początek, cykl, koniec albo „rozliczaj od”). Odepnij je najpierw albo zakończ umowę i dodaj nową.', v_bad;
    END IF;
    v_id := p_id;
  END IF;
  RETURN v_id;
END;
$$;

-- Usunięcie: umowa bez płatności znika (pliki do usunięcia z magazynu po stronie aplikacji); z płatnościami — zostaje
-- w historii jako zakończona.
CREATE OR REPLACE FUNCTION public.delete_finance_recurring_contract(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_contract public.finance_recurring_contracts%ROWTYPE;
  v_last date;
  v_today date := (now() AT TIME ZONE 'Europe/Warsaw')::date;
  v_paths text[];
BEGIN
  PERFORM private.require_finance_contracts((SELECT c.my_company_id FROM public.finance_recurring_contracts c WHERE c.id = p_id), true);
  SELECT * INTO v_contract FROM public.finance_recurring_contracts WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Nie znaleziono umowy.'; END IF;
  IF EXISTS (SELECT 1 FROM public.finance_recurring_contract_payments p WHERE p.contract_id = p_id) THEN
    SELECT max(p.period_start) INTO v_last FROM public.finance_recurring_contract_payments p WHERE p.contract_id = p_id;
    UPDATE public.finance_recurring_contracts
    SET status = 'ended',
        end_date = coalesce(end_date, greatest(start_date, v_today,
          (v_last + make_interval(months => private.recurring_contract_step(billing_cycle)) - interval '1 day')::date)),
        updated_at = now()
    WHERE id = p_id;
    RETURN jsonb_build_object('deleted', false, 'ended', true, 'paths', '[]'::jsonb);
  END IF;
  SELECT coalesce(array_agg(f.storage_path), '{}'::text[]) INTO v_paths FROM public.finance_recurring_contract_files f WHERE f.contract_id = p_id;
  DELETE FROM public.finance_recurring_contracts WHERE id = p_id;
  RETURN jsonb_build_object('deleted', true, 'ended', false, 'paths', to_jsonb(v_paths));
END;
$$;

CREATE OR REPLACE FUNCTION public.add_finance_recurring_contract_file(p_contract_id uuid, p_storage_path text, p_file_name text,
  p_mime_type text, p_file_size bigint)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_company uuid := (SELECT c.my_company_id FROM public.finance_recurring_contracts c WHERE c.id = p_contract_id);
  v_id uuid;
BEGIN
  PERFORM private.require_finance_contracts(v_company, true);
  IF v_company IS NULL THEN RAISE EXCEPTION 'Nie znaleziono umowy.'; END IF;
  IF p_storage_path IS NULL OR p_storage_path NOT LIKE v_company::text || '/' || p_contract_id::text || '/%' OR p_storage_path LIKE '%..%' THEN
    RAISE EXCEPTION 'Nieprawidłowa ścieżka pliku.';
  END IF;
  INSERT INTO public.finance_recurring_contract_files (contract_id, storage_path, file_name, mime_type, file_size, created_by)
  VALUES (p_contract_id, p_storage_path, left(coalesce(nullif(btrim(p_file_name), ''), 'plik'), 255), p_mime_type, p_file_size,
    public.current_invoice_employee_id())
  RETURNING id INTO v_id;
  UPDATE public.finance_recurring_contracts SET updated_at = now() WHERE id = p_contract_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.remove_finance_recurring_contract_file(p_file_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_path text;
BEGIN
  PERFORM private.require_finance_contracts((SELECT c.my_company_id FROM public.finance_recurring_contract_files f
    JOIN public.finance_recurring_contracts c ON c.id = f.contract_id WHERE f.id = p_file_id), true);
  DELETE FROM public.finance_recurring_contract_files WHERE id = p_file_id RETURNING storage_path INTO v_path;
  IF v_path IS NULL THEN RAISE EXCEPTION 'Nie znaleziono pliku.'; END IF;
  RETURN v_path; -- plik do usunięcia z magazynu po stronie aplikacji
END;
$$;

-- Ręczne przypięcie przelewu do umowy (z ekranu uzgodnienia). Okres NULL — najwcześniejszy nieopłacony, nie późniejszy niż
-- miesiąc po dacie operacji; kwota NULL — pozostała kwota operacji, najwyżej to, co zostało do zapłaty za okres.
CREATE OR REPLACE FUNCTION public.link_bank_transaction_to_recurring_contract(p_transaction_id uuid, p_contract_id uuid,
  p_period_start date DEFAULT NULL, p_amount numeric DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_company uuid;
  v_id uuid;
BEGIN
  v_company := private.require_finance_manage_for_transaction(p_transaction_id);
  IF p_amount IS NOT NULL AND p_amount <= 0 THEN RAISE EXCEPTION 'Kwota musi być większa od zera.'; END IF;
  v_id := private.link_recurring_contract_payment(p_transaction_id, p_contract_id, p_period_start, p_amount, 'manual',
    ARRAY['Przypisane ręcznie do umowy stałej'], v_company);
  UPDATE public.bank_reconciliation_proposals SET status = 'superseded', decided_at = now()
  WHERE bank_transaction_id = p_transaction_id AND status = 'open';
  RETURN v_id;
END;
$$;

-- Odpięcie przelewu od umowy: ta para nie wraca automatycznie (zapis odrzucenia jak przy deklaracjach).
CREATE OR REPLACE FUNCTION public.undo_bank_recurring_contract_payment(p_payment_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_payment public.finance_recurring_contract_payments%ROWTYPE;
BEGIN
  PERFORM private.require_finance_manage_for_transaction(
    (SELECT p.bank_transaction_id FROM public.finance_recurring_contract_payments p WHERE p.id = p_payment_id));
  SELECT * INTO v_payment FROM public.finance_recurring_contract_payments WHERE id = p_payment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Przypisanie już nie istnieje. Odśwież widok.'; END IF;
  DELETE FROM public.finance_recurring_contract_payments WHERE id = p_payment_id;
  INSERT INTO public.bank_reconciliation_proposals (bank_transaction_id, kind, rule, documents, reason, status, decided_at, decided_by)
  VALUES (v_payment.bank_transaction_id, 'allocate', 'cofniete',
    jsonb_build_array(private.recurring_contract_doc(v_payment.contract_id, v_payment.period_start, v_payment.amount)),
    'Przypisanie do umowy stałej cofnięte przez użytkownika' || CASE WHEN v_payment.match_method = 'automatic' THEN ' (było automatyczne).' ELSE '.' END,
    'rejected', now(), public.current_invoice_employee_id());
END;
$$;

CREATE OR REPLACE FUNCTION private.finance_recurring_contract_json(p_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  WITH base AS (
    SELECT c.*, (now() AT TIME ZONE 'Europe/Warsaw')::date AS today
    FROM public.finance_recurring_contracts c WHERE c.id = p_id
  ), per AS (
    SELECT x.*, CASE
        WHEN b.expects_invoice THEN 'invoice'
        WHEN x.paid > x.amount + 0.01 THEN 'overpaid'
        WHEN x.paid >= x.amount - 0.01 THEN 'paid'
        WHEN x.period_start > b.today THEN 'upcoming'
        WHEN x.due_date < b.today THEN 'overdue'
        ELSE 'missing' END AS status
    FROM base b
    CROSS JOIN LATERAL private.recurring_contract_periods(b.id, (date_trunc('month', b.today::timestamp) + interval '1 month')::date) x
  )
  SELECT jsonb_build_object(
    'id', b.id, 'company_id', b.my_company_id, 'kind', b.kind, 'direction', b.direction, 'title', b.title,
    'counterparty_name', b.counterparty_name, 'counterparty_nip', b.counterparty_nip, 'counterparty_account', b.counterparty_account,
    'amount', b.amount, 'currency', b.currency, 'billing_cycle', b.billing_cycle, 'payment_day', b.payment_day,
    'start_date', b.start_date, 'end_date', b.end_date, 'payments_from', b.payments_from, 'status', b.status,
    'expects_invoice', b.expects_invoice, 'notes', b.notes, 'created_at', b.created_at, 'updated_at', b.updated_at,
    'periods', coalesce((
      SELECT jsonb_agg(jsonb_build_object('period_start', p.period_start, 'period_end', p.period_end,
        'label', private.recurring_contract_period_label(b.billing_cycle, p.period_start), 'due_date', p.due_date,
        'amount', p.amount, 'paid', round(p.paid, 2), 'missing', round(greatest(p.amount - p.paid, 0), 2), 'status', p.status)
        ORDER BY p.period_start)
      FROM per p), '[]'::jsonb),
    'payments', coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', f.id, 'period_start', f.period_start,
        'period_label', private.recurring_contract_period_label(b.billing_cycle, f.period_start),
        'transaction_id', f.bank_transaction_id, 'date', bt.transaction_date, 'amount', f.amount, 'method', f.match_method,
        'reasons', f.match_reasons, 'title', bt.title,
        'counterparty', coalesce(nullif(btrim(bt.counterparty_name), ''), bt.raw_counterparty),
        'statement_year', s.statement_year, 'statement_month', s.statement_month)
        ORDER BY f.period_start DESC, bt.transaction_date DESC, f.created_at DESC)
      FROM public.finance_recurring_contract_payments f
      JOIN public.bank_transactions bt ON bt.id = f.bank_transaction_id
      JOIN public.bank_statements s ON s.id = bt.statement_id
      WHERE f.contract_id = b.id), '[]'::jsonb),
    'files', coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', fl.id, 'storage_path', fl.storage_path, 'file_name', fl.file_name,
        'mime_type', fl.mime_type, 'file_size', fl.file_size, 'created_at', fl.created_at) ORDER BY fl.created_at)
      FROM public.finance_recurring_contract_files fl WHERE fl.contract_id = b.id), '[]'::jsonb),
    'summary', (
      SELECT jsonb_build_object(
        'periods', count(*),
        'paid', count(*) FILTER (WHERE p.status IN ('paid', 'overpaid')),
        'overdue', count(*) FILTER (WHERE p.status = 'overdue'),
        'overdue_amount', round(coalesce(sum(greatest(p.amount - p.paid, 0)) FILTER (WHERE p.status = 'overdue'), 0), 2),
        'missing', count(*) FILTER (WHERE p.status = 'missing'),
        'paid_total', round(coalesce(sum(p.paid), 0), 2),
        'next_due_date', min(p.due_date) FILTER (WHERE p.status IN ('missing', 'upcoming')))
      FROM per p))
  FROM base b
$$;

CREATE OR REPLACE FUNCTION public.get_finance_recurring_contracts(p_company_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  PERFORM private.require_finance_contracts(p_company_id, false);
  RETURN coalesce((
    SELECT jsonb_agg(private.finance_recurring_contract_json(c.id) ORDER BY (c.status = 'active') DESC, c.title, c.created_at)
    FROM public.finance_recurring_contracts c
    WHERE c.my_company_id = p_company_id), '[]'::jsonb);
END;
$$;

-- 8. Widok miesiąca dla ekranu „Uzgodnienie wyciągów” (wersja z 20261101200000 + umowy stałe) ---------------------------
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

-- 9. Uprawnienia ---------------------------------------------------------------------------------------------------------
-- Funkcje pomocnicze: tylko dla funkcji serwera (bez API).
REVOKE ALL ON FUNCTION private.recurring_contract_step(text), private.recurring_contract_period_of(date, text, date),
  private.recurring_contract_first_period(date, date, text), private.recurring_contract_due_date(date, integer),
  private.recurring_contract_period_label(text, date), private.recurring_contract_account_label(text),
  private.recurring_contract_name_match(text, text), private.recurring_contract_period_valid(uuid, date),
  private.recurring_contract_periods(uuid, date), private.recurring_contract_open_period(uuid, date),
  private.recurring_contract_doc(uuid, date, numeric, text), private.recurring_contract_fill(uuid, date, numeric, text),
  private.recurring_contract_candidates(uuid, date, text, text, text, text, text, numeric, uuid[]),
  private.guard_finance_recurring_contract_payment(), private.sync_finance_recurring_contract_payment_state(),
  private.link_recurring_contract_payment(uuid, uuid, date, numeric, text, text[], uuid),
  private.require_finance_contracts(uuid, boolean), private.finance_recurring_contract_json(uuid)
  FROM PUBLIC, anon, authenticated;

-- Wykonuje je właściciel funkcji SECURITY DEFINER uzgadniania (w produkcji ten sam, który uruchamia migrację).
DO $grant$
DECLARE
  v_owner text := (SELECT pg_get_userbyid(p.proowner) FROM pg_proc p WHERE p.oid = 'public.reconcile_bank_month(uuid,integer,integer)'::regprocedure);
BEGIN
  EXECUTE format('GRANT EXECUTE ON FUNCTION private.recurring_contract_step(text), private.recurring_contract_period_of(date, text, date),
    private.recurring_contract_first_period(date, date, text), private.recurring_contract_due_date(date, integer),
    private.recurring_contract_period_label(text, date), private.recurring_contract_account_label(text),
    private.recurring_contract_name_match(text, text), private.recurring_contract_period_valid(uuid, date),
    private.recurring_contract_periods(uuid, date), private.recurring_contract_open_period(uuid, date),
    private.recurring_contract_doc(uuid, date, numeric, text), private.recurring_contract_fill(uuid, date, numeric, text),
    private.recurring_contract_candidates(uuid, date, text, text, text, text, text, numeric, uuid[]),
    private.link_recurring_contract_payment(uuid, uuid, date, numeric, text, text[], uuid),
    private.require_finance_contracts(uuid, boolean), private.finance_recurring_contract_json(uuid) TO %I', v_owner);
END $grant$;

-- RPC wołane z CRM: zalogowani (kontrola uprawnień w treści) i service_role; nigdy PUBLIC / anon.
REVOKE ALL ON FUNCTION public.save_finance_recurring_contract(uuid, uuid, text, text, text, text, text, text, numeric, text, text,
    integer, date, date, date, text, boolean, text),
  public.delete_finance_recurring_contract(uuid),
  public.add_finance_recurring_contract_file(uuid, text, text, text, bigint), public.remove_finance_recurring_contract_file(uuid),
  public.link_bank_transaction_to_recurring_contract(uuid, uuid, date, numeric), public.undo_bank_recurring_contract_payment(uuid),
  public.get_finance_recurring_contracts(uuid),
  public.reconcile_bank_month(uuid, integer, integer), public.accept_bank_reconciliation_proposal(uuid, integer),
  public.get_bank_reconciliation_month(uuid, integer, integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_finance_recurring_contract(uuid, uuid, text, text, text, text, text, text, numeric, text, text,
    integer, date, date, date, text, boolean, text),
  public.delete_finance_recurring_contract(uuid),
  public.add_finance_recurring_contract_file(uuid, text, text, text, bigint), public.remove_finance_recurring_contract_file(uuid),
  public.link_bank_transaction_to_recurring_contract(uuid, uuid, date, numeric), public.undo_bank_recurring_contract_payment(uuid),
  public.get_finance_recurring_contracts(uuid),
  public.reconcile_bank_month(uuid, integer, integer), public.accept_bank_reconciliation_proposal(uuid, integer),
  public.get_bank_reconciliation_month(uuid, integer, integer)
  TO authenticated, service_role;
-- recalculate_bank_transaction_match_state: bez zmian uprawnień (tylko serwer).
REVOKE ALL ON FUNCTION public.recalculate_bank_transaction_match_state(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recalculate_bank_transaction_match_state(uuid) TO service_role;

-- 10. Kontrola końcowa ---------------------------------------------------------------------------------------------------
DO $chk$
DECLARE
  v_list text;
BEGIN
  IF position('finance_recurring_contract_payments' IN pg_get_functiondef('private.bank_transaction_allocated(uuid,uuid,uuid,uuid)'::regprocedure)) = 0
     OR position('auto_contracts' IN pg_get_functiondef('public.reconcile_bank_month(uuid,integer,integer)'::regprocedure)) = 0
     OR position('link_recurring_contract_payment' IN pg_get_functiondef('public.accept_bank_reconciliation_proposal(uuid,integer)'::regprocedure)) = 0
     OR position('finance_recurring_contract_payments' IN pg_get_functiondef('private.merge_bank_transaction_copy(uuid,uuid)'::regprocedure)) = 0
     OR position('finance_recurring_contract_payments' IN pg_get_functiondef('private.promote_bank_transaction_copy_for(uuid)'::regprocedure)) = 0
     OR position('finance_recurring_contract_payments' IN pg_get_functiondef('private.promote_bank_transaction_copy()'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'Kontrola końcowa: funkcje uzgadniania nie obsługują płatności umów stałych.';
  END IF;
  SELECT string_agg(p.oid::regprocedure::text, ', ') INTO v_list
  FROM pg_proc p
  WHERE p.pronamespace IN ('public'::regnamespace, 'private'::regnamespace)
    AND (p.proname LIKE '%recurring_contract%')
    AND (has_function_privilege('anon', p.oid, 'EXECUTE')
         OR (p.pronamespace = 'private'::regnamespace AND has_function_privilege('authenticated', p.oid, 'EXECUTE')));
  IF v_list IS NOT NULL THEN RAISE EXCEPTION 'Kontrola końcowa: złe uprawnienia funkcji umów stałych: %', v_list; END IF;
  IF has_table_privilege('anon', 'public.finance_recurring_contracts', 'SELECT')
     OR has_table_privilege('authenticated', 'public.finance_recurring_contract_payments', 'INSERT') THEN
    RAISE EXCEPTION 'Kontrola końcowa: złe uprawnienia tabel umów stałych.';
  END IF;
END $chk$;

NOTIFY pgrst, 'reload schema';

COMMIT;
