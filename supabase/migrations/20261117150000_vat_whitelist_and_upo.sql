-- Finanse, krok 4: biała lista VAT przy płatnościach i archiwum UPO z KSeF — 2026-11-17.
--
-- CO I DLACZEGO
-- 1. Biała lista VAT (wykaz podatników VAT, API Ministerstwa Finansów wl-api.mf.gov.pl). Zapłata za transakcję
--    o wartości ponad 15 000 zł na rachunek spoza wykazu (w dniu zlecenia przelewu) oznacza utratę kosztu podatkowego
--    i solidarną odpowiedzialność za VAT dostawcy, chyba że w 7 dni od zlecenia przelewu złoży się zawiadomienie ZAW-NR.
--    CRM nie zleca przelewów, więc:
--     • przed zapłatą: „Sprawdź na białej liście” dla faktur kosztowych do zapłaty — NIP i rachunek z faktury KSeF,
--       sprawdzenie na dziś, z identyfikatorem zapytania MF (dowód sprawdzenia);
--     • po zapłacie: przelewy z ostatnich 90 dni dopasowane do faktur kosztowych o wartości ponad 15 000 zł — rachunek
--       z wyciągu sprawdzany na dzień przelewu.
--    Wyniki: finance_vat_whitelist_checks (zapis tylko z serwera CRM — /bridge/finance/vat-whitelist — żeby wynik
--    i identyfikator zapytania pochodziły z MF). Odczyt: get_vat_whitelist_status; ostrzeżenia w Centrum finansów.
-- 2. UPO (Urzędowe Poświadczenie Odbioru) faktur wysłanych z CRM do KSeF: ksef_invoice_upo — numer sesji, numer
--    referencyjny wysyłki, numer KSeF i XML UPO z KSeF (wraz z hashem SHA-256 z nagłówka). Zapis z serwera CRM
--    (wysyłka do KSeF i /bridge/ksef/invoices/upo); odczyt — kto widzi fakturę. Centrum finansów pokazuje faktury
--    przyjęte przez KSeF bez zapisanego UPO.
-- 3. get_finance_center: ostrzeżenia o białej liście i brakujących UPO (reszta funkcji bez zmian).
-- Wymaga: 20261117140000_finance_center.sql. Plik można uruchomić ponownie.
BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.get_finance_center(uuid)') IS NULL
     OR to_regprocedure('private.finance_account_digits(text)') IS NULL
     OR to_regprocedure('private.ksef_nip_digits(text)') IS NULL THEN
    RAISE EXCEPTION 'Najpierw zastosuj migrację 20261117140000_finance_center.sql.';
  END IF;
END $$;

-- 1. Biała lista VAT --------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.finance_vat_whitelist_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  my_company_id uuid NOT NULL REFERENCES public.my_companies(id) ON DELETE CASCADE,
  nip text NOT NULL CHECK (nip ~ '^[0-9]{10}$'),
  account text CHECK (account IS NULL OR account ~ '^[0-9]{26}$'),
  check_date date NOT NULL,
  subject_name text,
  status_vat text,
  account_assigned boolean,
  has_virtual_accounts boolean,
  method text NOT NULL DEFAULT 'search' CHECK (method IN ('search', 'check')),
  request_id text,
  request_datetime text,
  message text,
  error text,
  ksef_invoice_id uuid REFERENCES public.ksef_invoices(id) ON DELETE SET NULL,
  external_invoice_id uuid REFERENCES public.external_invoices(id) ON DELETE SET NULL,
  bank_transaction_id uuid REFERENCES public.bank_transactions(id) ON DELETE SET NULL,
  checked_by uuid,
  checked_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.finance_vat_whitelist_checks IS
  'Sprawdzenia rachunków dostawców na białej liście VAT (API MF) z identyfikatorem zapytania — przed zapłatą i po przelewie.';
CREATE INDEX IF NOT EXISTS finance_vat_whitelist_checks_company_nip
  ON public.finance_vat_whitelist_checks (my_company_id, nip, check_date DESC);
CREATE INDEX IF NOT EXISTS finance_vat_whitelist_checks_ksef
  ON public.finance_vat_whitelist_checks (ksef_invoice_id, checked_at DESC) WHERE ksef_invoice_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS finance_vat_whitelist_checks_transaction
  ON public.finance_vat_whitelist_checks (bank_transaction_id, checked_at DESC) WHERE bank_transaction_id IS NOT NULL;
ALTER TABLE public.finance_vat_whitelist_checks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS finance_vat_whitelist_checks_read ON public.finance_vat_whitelist_checks;
CREATE POLICY finance_vat_whitelist_checks_read ON public.finance_vat_whitelist_checks FOR SELECT TO authenticated
  USING (public.finance_company_visible(my_company_id));
REVOKE ALL ON public.finance_vat_whitelist_checks FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.finance_vat_whitelist_checks TO authenticated;
GRANT ALL ON public.finance_vat_whitelist_checks TO service_role;

-- NIP i rachunek w formacie API MF (10 i 26 cyfr) albo NULL.
CREATE OR REPLACE FUNCTION private.vat_whitelist_nip(p_nip text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public
AS $$
  SELECT CASE WHEN private.ksef_nip_digits(p_nip) ~ '^[0-9]{10}$' THEN private.ksef_nip_digits(p_nip) END;
$$;
REVOKE ALL ON FUNCTION private.vat_whitelist_nip(text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.vat_whitelist_account(p_account text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public
AS $$
  SELECT CASE WHEN private.finance_account_digits(p_account) ~ '^[0-9]{26}$' THEN private.finance_account_digits(p_account) END;
$$;
REVOKE ALL ON FUNCTION private.vat_whitelist_account(text) FROM PUBLIC, anon, authenticated;

-- Ocena sprawdzenia: ok (rachunek w wykazie), not_listed (rachunku nie ma), not_found (NIP poza wykazem),
-- no_account (sprawdzono tylko status VAT — faktura bez rachunku), error (MF nie odpowiedział).
CREATE OR REPLACE FUNCTION private.vat_whitelist_verdict(p_error text, p_status_vat text, p_account text, p_assigned boolean)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $$
  SELECT CASE
    WHEN p_error IS NOT NULL THEN 'error'
    WHEN p_status_vat IS NULL THEN 'not_found'
    WHEN p_account IS NULL THEN 'no_account'
    WHEN coalesce(p_assigned, false) THEN 'ok'
    ELSE 'not_listed' END;
$$;
REVOKE ALL ON FUNCTION private.vat_whitelist_verdict(text, text, text, boolean) FROM PUBLIC, anon, authenticated;

-- Faktury kosztowe KSeF do zapłaty z ostatnim sprawdzeniem.
CREATE OR REPLACE FUNCTION private.vat_whitelist_payables(p_company_id uuid, p_today date)
RETURNS TABLE (
  ksef_invoice_id uuid, invoice_number text, seller_name text, nip text, account text, gross numeric, due_date date,
  verdict text, status_vat text, subject_name text, check_date date, checked_at timestamptz, request_id text, message text,
  fresh boolean
)
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT k.id, coalesce(k.invoice_number, k.ksef_reference_number), k.seller_name, private.vat_whitelist_nip(k.seller_nip),
    private.vat_whitelist_account(k.bank_account_number), coalesce(k.amount_to_pay_gross, k.gross_amount), k.payment_due_date,
    CASE WHEN c.id IS NOT NULL THEN private.vat_whitelist_verdict(c.error, c.status_vat, c.account, c.account_assigned) END,
    c.status_vat, c.subject_name, c.check_date, c.checked_at, c.request_id, c.message,
    coalesce(c.check_date = p_today, false)
  FROM public.ksef_invoices k
  LEFT JOIN LATERAL (
    SELECT x.* FROM public.finance_vat_whitelist_checks x
    WHERE x.ksef_invoice_id = k.id AND x.bank_transaction_id IS NULL
    ORDER BY x.checked_at DESC LIMIT 1
  ) c ON true
  WHERE k.my_company_id = p_company_id AND k.invoice_type = 'received'
    AND coalesce(k.payment_status, 'unpaid') IN ('unpaid', 'overdue')
    AND coalesce(k.amount_to_pay_gross, k.gross_amount, 0) > 0.009;
$$;
REVOKE ALL ON FUNCTION private.vat_whitelist_payables(uuid, date) FROM PUBLIC, anon, authenticated;

-- Przelewy z ostatnich dni dopasowane do faktur kosztowych, gdy wartość transakcji (faktury) lub przelewu > 15 000 zł.
CREATE OR REPLACE FUNCTION private.vat_whitelist_payments(p_company_id uuid, p_since date)
RETURNS TABLE (
  bank_transaction_id uuid, document_source text, ksef_invoice_id uuid, external_invoice_id uuid, document_number text,
  seller_name text, nip text, account text, transaction_date date, amount numeric, document_gross numeric,
  verdict text, status_vat text, check_date date, checked_at timestamptz, request_id text, message text
)
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $$
  WITH docs AS (
    SELECT DISTINCT ON (t.id, coalesce(m.ksef_invoice_id, m.external_invoice_id))
      t.id AS transaction_id, m.document_source, m.ksef_invoice_id, m.external_invoice_id,
      coalesce(k.invoice_number, k.ksef_reference_number, x.invoice_number, x.label) AS document_number,
      coalesce(k.seller_name, x.seller_name) AS seller_name,
      private.vat_whitelist_nip(coalesce(k.seller_nip, x.seller_nip)) AS nip,
      private.vat_whitelist_account(t.counterparty_account) AS account,
      t.transaction_date, t.amount,
      abs(coalesce(k.gross_amount, x.amount_gross, 0)) AS document_gross
    FROM public.bank_transaction_invoice_matches m
    JOIN public.bank_transactions t ON t.id = m.bank_transaction_id
    JOIN public.bank_statements s ON s.id = t.statement_id
    LEFT JOIN public.ksef_invoices k ON k.id = m.ksef_invoice_id AND k.invoice_type = 'received'
    LEFT JOIN public.external_invoices x ON x.id = m.external_invoice_id
    WHERE s.my_company_id = p_company_id AND t.canonical_transaction_id IS NULL
      AND t.transaction_type = 'debit' AND t.transaction_date >= p_since
      AND (k.id IS NOT NULL OR x.id IS NOT NULL)
      AND (abs(t.amount) > 15000 OR abs(coalesce(k.gross_amount, x.amount_gross, 0)) > 15000)
    ORDER BY t.id, coalesce(m.ksef_invoice_id, m.external_invoice_id), m.id
  )
  SELECT d.transaction_id, d.document_source, d.ksef_invoice_id, d.external_invoice_id, d.document_number, d.seller_name,
    d.nip, d.account, d.transaction_date, d.amount, d.document_gross,
    CASE WHEN c.id IS NOT NULL THEN private.vat_whitelist_verdict(c.error, c.status_vat, c.account, c.account_assigned) END,
    c.status_vat, c.check_date, c.checked_at, c.request_id, c.message
  FROM docs d
  LEFT JOIN LATERAL (
    SELECT x.* FROM public.finance_vat_whitelist_checks x
    WHERE x.bank_transaction_id = d.transaction_id AND x.check_date = d.transaction_date
    ORDER BY x.checked_at DESC LIMIT 1
  ) c ON true;
$$;
REVOKE ALL ON FUNCTION private.vat_whitelist_payments(uuid, date) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_vat_whitelist_status(p_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Europe/Warsaw')::date;
BEGIN
  PERFORM private.require_finance_company(p_company_id, false);
  RETURN jsonb_build_object(
    'company_id', p_company_id,
    'today', v_today,
    'since', v_today - 90,
    'payables', coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.due_date NULLS LAST, p.invoice_number)
                          FROM private.vat_whitelist_payables(p_company_id, v_today) p), '[]'::jsonb),
    'payments', coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.transaction_date DESC, p.document_number)
                          FROM private.vat_whitelist_payments(p_company_id, v_today - 90) p), '[]'::jsonb),
    'last_check_at', (SELECT max(c.checked_at) FROM public.finance_vat_whitelist_checks c WHERE c.my_company_id = p_company_id));
END;
$$;
REVOKE ALL ON FUNCTION public.get_vat_whitelist_status(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_vat_whitelist_status(uuid) TO authenticated, service_role;

-- 2. UPO faktur wysłanych do KSeF ---------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ksef_invoice_upo (
  invoice_id uuid PRIMARY KEY REFERENCES public.invoices(id) ON DELETE CASCADE,
  my_company_id uuid REFERENCES public.my_companies(id) ON DELETE SET NULL,
  ksef_number text,
  session_reference text,
  invoice_reference text,
  upo_xml text,
  upo_hash text,
  fetched_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.ksef_invoice_upo IS
  'UPO (Urzędowe Poświadczenie Odbioru) faktur wysłanych z CRM do KSeF: sesja, numer wysyłki, numer KSeF, XML UPO.';
ALTER TABLE public.ksef_invoice_upo ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ksef_invoice_upo_read ON public.ksef_invoice_upo;
-- Widoczne dla każdego, kto widzi fakturę (reguły wierszy faktur działają w podzapytaniu).
CREATE POLICY ksef_invoice_upo_read ON public.ksef_invoice_upo FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.invoices i WHERE i.id = ksef_invoice_upo.invoice_id));
REVOKE ALL ON public.ksef_invoice_upo FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.ksef_invoice_upo TO authenticated;
GRANT ALL ON public.ksef_invoice_upo TO service_role;

-- 3. Ostrzeżenia dla Centrum finansów -----------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.finance_whitelist_quality(p_company_id uuid, p_today date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_out jsonb := '[]'::jsonb;
  v_n integer;
  v_sum numeric;
BEGIN
  SELECT count(*), coalesce(sum(p.gross), 0) INTO v_n, v_sum
  FROM private.vat_whitelist_payables(p_company_id, p_today) p
  WHERE p.gross > 15000 AND p.verdict IN ('not_listed', 'not_found');
  IF v_n > 0 THEN
    v_out := v_out || jsonb_build_object('level', 'error', 'key', 'whitelist_payables',
      'text', format('%s faktur do zapłaty ponad 15 000 zł (%s) ma rachunek spoza białej listy VAT — nie płać na ten rachunek bez wyjaśnienia z dostawcą.',
                     v_n, private.format_pln(v_sum)),
      'tab', 'external', 'section', 'deadlines');
  END IF;

  SELECT count(*) INTO v_n FROM private.vat_whitelist_payments(p_company_id, p_today - 90) p
  WHERE p.verdict IN ('not_listed', 'not_found');
  IF v_n > 0 THEN
    v_out := v_out || jsonb_build_object('level', 'error', 'key', 'whitelist_payments',
      'text', format('%s przelewów ponad 15 000 zł poszło na rachunek spoza białej listy VAT — zawiadomienie ZAW-NR do urzędu skarbowego w 7 dni od zlecenia przelewu; skonsultuj z biurem.', v_n),
      'tab', 'external', 'section', 'deadlines');
  END IF;

  SELECT count(*) INTO v_n FROM private.vat_whitelist_payments(p_company_id, p_today - 90) p
  WHERE p.verdict IS NULL OR p.verdict = 'error';
  IF v_n > 0 THEN
    v_out := v_out || jsonb_build_object('level', 'warning', 'key', 'whitelist_unchecked',
      'text', format('%s przelewów ponad 15 000 zł z ostatnich 90 dni bez sprawdzenia rachunku na białej liście VAT.', v_n),
      'tab', 'external', 'section', 'deadlines');
  END IF;

  SELECT count(*) INTO v_n
  FROM public.invoices i
  LEFT JOIN public.ksef_invoice_upo u ON u.invoice_id = i.id
  WHERE i.my_company_id = p_company_id AND i.ksef_status = 'accepted' AND nullif(i.ksef_reference_number, '') IS NOT NULL
    AND u.upo_xml IS NULL;
  IF v_n > 0 THEN
    v_out := v_out || jsonb_build_object('level', 'info', 'key', 'upo_missing',
      'text', format('%s faktur przyjętych przez KSeF bez zapisanego UPO (urzędowe poświadczenie odbioru).', v_n),
      'tab', 'local', 'section', NULL);
  END IF;
  RETURN v_out;
END;
$$;
REVOKE ALL ON FUNCTION private.finance_whitelist_quality(uuid, date) FROM PUBLIC, anon, authenticated;

-- 4. Centrum finansów: dodane ostrzeżenia (bez innych zmian względem 20261117140000) -------------------------------
CREATE OR REPLACE FUNCTION public.get_finance_center(p_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Europe/Warsaw')::date;
  v_week0 date;
  v_until date;
  v_month date;
  v_prev date;
  v_expected_month date;
  v_company record;
  v_cash jsonb;
  v_as_of date;
  v_opening numeric;
  v_items jsonb;
  v_obligations jsonb;
  v_vat jsonb;
  v_cit jsonb;
  v_rate smallint;
  v_quality jsonb := '[]'::jsonb;
  v_checklist jsonb;
  v_ksef record;
  v_ksef_found boolean;
  v_n integer;
  v_d date;
  v_has_vat boolean;
BEGIN
  PERFORM private.require_finance_company(p_company_id, false);
  SELECT c.id, c.name INTO v_company FROM public.my_companies c WHERE c.id = p_company_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Nie znaleziono działalności.'; END IF;

  v_week0 := date_trunc('week', v_today::timestamp)::date;
  v_until := v_week0 + 13 * 7 - 1;
  v_month := date_trunc('month', v_today::timestamp)::date;
  v_prev := (v_month - interval '1 month')::date;
  -- Wyciąg za poprzedni miesiąc oczekiwany od 6. dnia miesiąca.
  v_expected_month := CASE WHEN extract(day FROM v_today) > 5 THEN v_prev ELSE (v_month - interval '2 months')::date END;

  -- Gotówka: ostatni wyciąg każdego rachunku.
  WITH st AS (
    SELECT s.*, private.finance_account_digits(s.account_number) AS acc
    FROM public.bank_statements s
    WHERE s.my_company_id = p_company_id AND s.processed AND s.validation_status = 'valid'
  ), keyed AS (
    SELECT st.*, coalesce(st.acc,
      (SELECT min(x.acc) FROM st x WHERE x.account_type IS NOT DISTINCT FROM st.account_type AND x.acc IS NOT NULL
       HAVING count(DISTINCT x.acc) = 1),
      'typ:' || coalesce(st.account_type, 'regular')) AS akey
    FROM st
  ), latest AS (
    SELECT DISTINCT ON (k.akey) k.akey, k.account_type, coalesce(k.currency, 'PLN') AS currency, k.closing_balance,
      k.statement_year, k.statement_month,
      (make_date(k.statement_year, k.statement_month, 1) + interval '1 month - 1 day')::date AS as_of
    FROM keyed k
    ORDER BY k.akey, k.statement_year DESC, k.statement_month DESC, (k.import_format = 'MT940') DESC, (k.acc IS NOT NULL) DESC
  )
  SELECT
    coalesce(jsonb_agg(jsonb_build_object(
      'key', l.akey,
      'label', CASE WHEN l.account_type = 'vat' THEN 'Rachunek VAT' ELSE 'Rachunek bieżący' END
               || CASE WHEN l.akey LIKE 'typ:%' THEN '' ELSE ' •• ' || right(l.akey, 4) END,
      'account_type', coalesce(l.account_type, 'regular'), 'currency', l.currency, 'balance', l.closing_balance,
      'as_of', l.as_of, 'statement_year', l.statement_year, 'statement_month', l.statement_month)
      ORDER BY l.account_type NULLS FIRST, l.akey), '[]'::jsonb),
    min(l.as_of) FILTER (WHERE l.currency = 'PLN'),
    round(coalesce(sum(l.closing_balance) FILTER (WHERE l.currency = 'PLN'), 0), 2)
  INTO v_cash, v_as_of, v_opening
  FROM latest l;

  -- Otwarte pozycje i ZUS/podatki w horyzoncie prognozy.
  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'kind', i.kind, 'direction', i.direction, 'id', i.item_id, 'invoice_id', i.invoice_id, 'label', i.label,
      'counterparty', i.counterparty, 'issue_date', i.issue_date, 'due_date', i.due_date, 'amount', i.amount,
      'currency', i.currency, 'estimated', i.estimated, 'note', i.note,
      'days_overdue', CASE WHEN i.due_date < v_today THEN v_today - i.due_date END)
      ORDER BY i.due_date NULLS LAST, i.amount DESC), '[]'::jsonb)
  INTO v_items
  FROM private.finance_open_items(p_company_id, v_today, v_until) i;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'kind', o.kind, 'form', o.form, 'period_kind', o.period_kind, 'period_start', o.period_start, 'label', o.label,
      'due_date', o.due_date, 'amount', o.amount, 'estimated', o.estimated, 'status', o.status, 'overdue', o.overdue)
      ORDER BY o.due_date, o.kind, o.form), '[]'::jsonb)
  INTO v_obligations
  FROM private.finance_obligations_due(p_company_id, v_today - 120, v_until) o;

  -- VAT: poprzedni i bieżący miesiąc (gdy działalność ma obowiązek VAT miesięczny).
  v_has_vat := EXISTS (SELECT 1 FROM public.finance_obligation_settings s
                       WHERE s.my_company_id = p_company_id AND s.enabled AND s.kind = 'vat' AND s.period_kind = 'month');
  IF v_has_vat THEN
    SELECT jsonb_agg(jsonb_build_object(
        'period_start', m.period_start, 'output_vat', e.output_vat, 'input_vat', e.input_vat, 'carried', e.carried,
        'estimate', e.estimate, 'sales_count', e.sales_count, 'cost_count', e.cost_count,
        'foreign_count', e.foreign_count,
        'declared', d.amount_due,
        'paid', coalesce((SELECT sum(fp.amount) FROM public.finance_declaration_payments fp WHERE fp.declaration_id = d.id), 0),
        'due_date', (SELECT o.due_date FROM private.finance_obligations(p_company_id, m.period_start, m.period_start + 120) o
                     WHERE o.kind = 'vat' AND o.period_kind = 'month' AND o.period_start = m.period_start LIMIT 1))
        ORDER BY m.period_start)
    INTO v_vat
    FROM (VALUES (v_prev), (v_month)) AS m(period_start)
    CROSS JOIN LATERAL private.finance_vat_due(p_company_id, m.period_start) e
    LEFT JOIN LATERAL (
      SELECT fd.id, fd.amount_due FROM public.finance_declarations fd
      WHERE fd.my_company_id = p_company_id AND fd.kind = 'vat' AND fd.period_kind = 'month' AND fd.period_start = m.period_start
      ORDER BY fd.amount_due IS NULL, fd.created_at LIMIT 1
    ) d ON true;
  END IF;

  -- CIT: orientacyjna rezerwa od początku roku.
  SELECT t.cit_rate INTO v_rate FROM public.finance_company_tax_settings t WHERE t.my_company_id = p_company_id;
  SELECT jsonb_build_object(
      'year', extract(year FROM v_today)::int, 'rate', v_rate,
      'revenue_net', b.revenue_net, 'costs_net', b.costs_net, 'result', round(b.revenue_net - b.costs_net, 2),
      'tax', CASE WHEN v_rate IS NULL THEN NULL ELSE round(greatest(b.revenue_net - b.costs_net, 0) * v_rate / 100.0, 2) END,
      'paid', b.paid,
      'reserve', CASE WHEN v_rate IS NULL THEN NULL
                      ELSE round(greatest(greatest(b.revenue_net - b.costs_net, 0) * v_rate / 100.0 - b.paid, 0), 2) END)
  INTO v_cit
  FROM private.finance_cit_basis(p_company_id, extract(year FROM v_today)::int) b;

  -- Kompletność danych.
  SELECT count(*) INTO v_n FROM jsonb_array_elements(v_cash) a;
  IF v_n = 0 THEN
    v_quality := v_quality || jsonb_build_object('level', 'error', 'key', 'no_statements',
      'text', 'Brak wczytanych wyciągów — CRM nie zna stanu rachunków ani zapłat.', 'tab', 'external', 'section', 'statements');
  ELSE
    v_quality := v_quality || coalesce((
      SELECT jsonb_agg(jsonb_build_object('level', 'error', 'key', 'statement_missing:' || (a ->> 'key'),
        'text', format('%s: ostatni wyciąg za %s — brakuje %s.', a ->> 'label',
                       lpad(a ->> 'statement_month', 2, '0') || '/' || (a ->> 'statement_year'),
                       CASE WHEN make_date((a ->> 'statement_year')::int, (a ->> 'statement_month')::int, 1) + interval '1 month' = v_expected_month
                            THEN to_char(v_expected_month, 'MM/YYYY')
                            ELSE to_char(make_date((a ->> 'statement_year')::int, (a ->> 'statement_month')::int, 1) + interval '1 month', 'MM/YYYY')
                                 || '–' || to_char(v_expected_month, 'MM/YYYY') END),
        'tab', 'external', 'section', 'statements'))
      FROM jsonb_array_elements(v_cash) a
      WHERE make_date((a ->> 'statement_year')::int, (a ->> 'statement_month')::int, 1) < v_expected_month), '[]'::jsonb);
  END IF;

  SELECT c.is_active, c.auto_sync_enabled, c.auto_sync_last_success_at, c.auto_sync_last_error INTO v_ksef
  FROM public.ksef_credentials c
  WHERE c.my_company_id = p_company_id AND c.is_active AND NOT coalesce(c.is_test_environment, false)
  ORDER BY c.auto_sync_last_success_at DESC NULLS LAST LIMIT 1;
  v_ksef_found := FOUND;
  IF v_ksef_found AND coalesce(v_ksef.auto_sync_enabled, false)
     AND (v_ksef.auto_sync_last_success_at IS NULL OR v_ksef.auto_sync_last_success_at < now() - interval '26 hours') THEN
    v_quality := v_quality || jsonb_build_object('level', 'error', 'key', 'ksef_stale',
      'text', 'KSeF: ostatnia udana synchronizacja ' || coalesce(to_char(v_ksef.auto_sync_last_success_at AT TIME ZONE 'Europe/Warsaw', 'DD.MM.YYYY HH24:MI'), 'nigdy')
              || coalesce(' — ostatni błąd: ' || left(v_ksef.auto_sync_last_error, 160), '')
              || '. Faktury z KSeF po tej dacie nie są w CRM.',
      'tab', 'ksef', 'section', NULL);
  ELSIF NOT v_ksef_found THEN
    v_quality := v_quality || jsonb_build_object('level', 'info', 'key', 'ksef_missing',
      'text', 'KSeF nie jest skonfigurowany dla tej działalności — faktury kosztowe i sprzedaż spoza CRM nie są pobierane.',
      'tab', 'ksef', 'section', NULL);
  END IF;

  SELECT count(*) INTO v_n FROM public.ksef_local_sales_sync_issues si
  JOIN public.ksef_invoices k ON k.id = si.ksef_invoice_id WHERE k.my_company_id = p_company_id;
  IF v_n > 0 THEN
    v_quality := v_quality || jsonb_build_object('level', 'warning', 'key', 'ksef_sales_issues',
      'text', format('%s faktur sprzedaży z KSeF nie połączyło się z fakturami CRM (np. inna kwota) — zapłaty z KSeF nie trafiają do CRM.', v_n),
      'tab', 'local', 'section', NULL);
  END IF;

  SELECT count(*) INTO v_n FROM jsonb_array_elements(v_items) i WHERE i ->> 'kind' = 'receivable_ksef_paid';
  IF v_n > 0 THEN
    v_quality := v_quality || jsonb_build_object('level', 'warning', 'key', 'ksef_paid_conflict',
      'text', format('%s faktur CRM jest w KSeF zapłaconych, a w CRM nie — nie liczę ich do należności, do wyjaśnienia.', v_n),
      'tab', 'local', 'section', NULL);
  END IF;

  SELECT count(*), min(t.transaction_date) INTO v_n, v_d
  FROM public.bank_transactions t JOIN public.bank_statements s ON s.id = t.statement_id
  WHERE s.my_company_id = p_company_id AND s.processed AND s.validation_status = 'valid'
    AND t.canonical_transaction_id IS NULL AND coalesce(t.accounting_review_status, 'pending') = 'pending'
    AND coalesce(t.match_status, 'unmatched') IN ('unmatched', 'partial');
  IF v_n > 0 THEN
    v_quality := v_quality || jsonb_build_object('level', 'warning', 'key', 'open_operations',
      'text', format('%s operacji bankowych bez dopasowania i wyjaśnienia (najstarsza z %s).', v_n, to_char(v_d, 'DD.MM.YYYY')),
      'tab', 'external', 'section', 'reconciliation');
  END IF;

  SELECT count(*) INTO v_n FROM jsonb_array_elements(v_items) i
  WHERE i ->> 'kind' = 'payable' AND i ->> 'due_date' IS NULL AND i ->> 'note' IS DISTINCT FROM 'dokument spoza KSeF';
  IF v_n > 0 THEN
    v_quality := v_quality || jsonb_build_object('level', 'warning', 'key', 'payables_no_due',
      'text', format('%s nieopłaconych faktur kosztowych bez terminu płatności — nie ma ich w prognozie tygodniowej.', v_n),
      'tab', 'external', 'section', 'deadlines');
  END IF;

  SELECT count(*) INTO v_n FROM jsonb_array_elements(v_obligations) o WHERE (o ->> 'overdue')::boolean;
  IF v_n > 0 THEN
    v_quality := v_quality || jsonb_build_object('level', 'warning', 'key', 'obligations_unassigned',
      'text', format('%s obowiązków ZUS i podatkowych po terminie bez przypisanego przelewu — przypisz zapłatę w uzgodnieniu wyciągu albo zapłać.', v_n),
      'tab', 'external', 'section', 'deadlines');
  END IF;

  SELECT count(*) INTO v_n FROM private.finance_obligations(p_company_id, v_today - 120, v_today) o WHERE o.amount_missing;
  IF v_n > 0 THEN
    v_quality := v_quality || jsonb_build_object('level', 'info', 'key', 'declarations_no_amount',
      'text', format('%s deklaracji z ostatnich 4 miesięcy bez kwoty — prognoza używa szacunku.', v_n),
      'tab', 'external', 'section', 'declarations');
  END IF;

  -- Biała lista VAT i UPO (20261117150000).
  v_quality := v_quality || private.finance_whitelist_quality(p_company_id, v_today);

  -- Zamknięcie poprzedniego miesiąca.
  SELECT jsonb_build_object(
    'period_year', extract(year FROM v_prev)::int, 'period_month', extract(month FROM v_prev)::int,
    'items', jsonb_build_array(
      (SELECT jsonb_build_object('key', 'statements', 'label', 'Wyciągi wszystkich rachunków wczytane',
         'done', count(*) > 0 AND bool_and(make_date((a ->> 'statement_year')::int, (a ->> 'statement_month')::int, 1) >= v_prev),
         'detail', format('%s z %s rachunków', count(*) FILTER (WHERE make_date((a ->> 'statement_year')::int, (a ->> 'statement_month')::int, 1) >= v_prev), count(*)),
         'tab', 'external', 'section', 'statements')
       FROM jsonb_array_elements(v_cash) a),
      (SELECT jsonb_build_object('key', 'operations', 'label', 'Operacje dopasowane lub wyjaśnione',
         'done', EXISTS (SELECT 1 FROM public.bank_statements s0 WHERE s0.my_company_id = p_company_id
                           AND make_date(s0.statement_year, s0.statement_month, 1) = v_prev AND s0.processed) AND count(t.id) = 0,
         'detail', CASE WHEN NOT EXISTS (SELECT 1 FROM public.bank_statements s0 WHERE s0.my_company_id = p_company_id
                                           AND make_date(s0.statement_year, s0.statement_month, 1) = v_prev AND s0.processed)
                          THEN 'brak wyciągu za miesiąc'
                        WHEN count(t.id) = 0 THEN NULL ELSE format('%s do wyjaśnienia', count(t.id)) END,
         'tab', 'external', 'section', 'reconciliation')
       FROM public.bank_transactions t JOIN public.bank_statements s ON s.id = t.statement_id
       WHERE s.my_company_id = p_company_id AND make_date(s.statement_year, s.statement_month, 1) = v_prev
         AND s.processed AND s.validation_status = 'valid' AND t.canonical_transaction_id IS NULL
         AND coalesce(t.accounting_review_status, 'pending') = 'pending'
         AND coalesce(t.match_status, 'unmatched') IN ('unmatched', 'partial')),
      jsonb_build_object('key', 'ksef', 'label', 'KSeF pobrany po końcu miesiąca',
         'done', CASE WHEN NOT v_ksef_found THEN NULL
                      ELSE v_ksef.auto_sync_last_success_at IS NOT NULL
                           AND (v_ksef.auto_sync_last_success_at AT TIME ZONE 'Europe/Warsaw')::date >= v_month END,
         'detail', CASE WHEN NOT v_ksef_found THEN 'KSeF nieskonfigurowany — nie dotyczy'
                        WHEN v_ksef.auto_sync_last_success_at IS NULL THEN 'brak udanej synchronizacji'
                        ELSE 'ostatnia: ' || to_char(v_ksef.auto_sync_last_success_at AT TIME ZONE 'Europe/Warsaw', 'DD.MM.YYYY') END,
         'tab', 'ksef', 'section', NULL),
      (SELECT jsonb_build_object('key', 'declarations', 'label', 'Deklaracje za miesiąc z kwotami',
         'done', count(*) FILTER (WHERE o.amount_due IS NULL) = 0,
         'detail', CASE WHEN count(*) = 0 THEN 'brak obowiązków miesięcznych'
                        ELSE format('%s z %s z kwotą', count(*) FILTER (WHERE o.amount_due IS NOT NULL), count(*)) END,
         'tab', 'external', 'section', 'declarations')
       FROM private.finance_obligations(p_company_id, v_prev, v_prev + 400) o
       WHERE o.period_kind = 'month' AND o.period_start = v_prev),
      jsonb_build_object('key', 'handoff', 'label', 'Przekazany księgowej',
         'done', EXISTS (SELECT 1 FROM public.accounting_month_handoffs h WHERE h.my_company_id = p_company_id
                           AND h.period_year = extract(year FROM v_prev)::int AND h.period_month = extract(month FROM v_prev)::int),
         'detail', (SELECT 'przekazany ' || to_char(max(h.delivered_at) AT TIME ZONE 'Europe/Warsaw', 'DD.MM.YYYY')
                    FROM public.accounting_month_handoffs h WHERE h.my_company_id = p_company_id
                      AND h.period_year = extract(year FROM v_prev)::int AND h.period_month = extract(month FROM v_prev)::int
                    HAVING count(*) > 0),
         'tab', 'external', 'section', 'accountant'),
      jsonb_build_object('key', 'locked', 'label', 'Miesiąc zamknięty',
         'done', EXISTS (SELECT 1 FROM public.finance_period_locks l WHERE l.my_company_id = p_company_id AND l.unlocked_at IS NULL
                           AND l.period_year = extract(year FROM v_prev)::int AND l.period_month = extract(month FROM v_prev)::int),
         'detail', NULL, 'tab', 'external', 'section', 'accountant')
    ))
  INTO v_checklist;

  RETURN jsonb_build_object(
    'company_id', p_company_id, 'company_name', v_company.name, 'today', v_today,
    'can_manage', public.finance_company_manageable(p_company_id),
    'cash', jsonb_build_object('accounts', v_cash, 'as_of', v_as_of, 'total', v_opening,
                               'days_old', CASE WHEN v_as_of IS NULL THEN NULL ELSE v_today - v_as_of END),
    'items', v_items,
    'obligations', v_obligations,
    'vat', v_vat,
    'cit', v_cit,
    'forecast', jsonb_build_object('week0', v_week0, 'until', v_until, 'weeks', 13),
    'quality', v_quality,
    'checklist', v_checklist,
    'tax_settings', jsonb_build_object('cit_rate', v_rate));
END;
$$;
REVOKE ALL ON FUNCTION public.get_finance_center(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_finance_center(uuid) TO authenticated, service_role;

-- 5. Kontrola -------------------------------------------------------------------------------------------------------------
DO $$
BEGIN
  IF private.vat_whitelist_verdict(NULL, 'Czynny', '12102035410000550204086815', true) <> 'ok'
     OR private.vat_whitelist_verdict(NULL, 'Czynny', '12102035410000550204086815', false) <> 'not_listed'
     OR private.vat_whitelist_verdict(NULL, NULL, NULL, NULL) <> 'not_found'
     OR private.vat_whitelist_nip('DE123456789') IS NOT NULL
     OR private.vat_whitelist_account('PL 12 1020 3541 0000 5502 0408 6815') <> '12102035410000550204086815' THEN
    RAISE EXCEPTION 'Ocena białej listy nie działa.';
  END IF;
  IF has_function_privilege('anon', 'public.get_vat_whitelist_status(uuid)', 'EXECUTE')
     OR has_table_privilege('authenticated', 'public.finance_vat_whitelist_checks', 'INSERT')
     OR has_table_privilege('authenticated', 'public.ksef_invoice_upo', 'INSERT')
     OR has_table_privilege('authenticated', 'public.ksef_invoice_upo', 'UPDATE')
     OR has_table_privilege('anon', 'public.ksef_invoice_upo', 'SELECT') THEN
    RAISE EXCEPTION 'Uprawnienia białej listy lub UPO są zbyt szerokie.';
  END IF;
END $$;

COMMIT;
