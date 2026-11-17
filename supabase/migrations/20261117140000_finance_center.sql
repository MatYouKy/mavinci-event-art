-- Finanse, krok 3: Centrum finansów — jeden odczyt „na dziś” dla działalności — 2026-11-17.
--
-- CO I DLACZEGO
-- Pulpit finansowy liczy wynik i rentowność, ale nie odpowiada na pytania „ile mamy pieniędzy, kto nam i komu my
-- jesteśmy winni, ile odłożyć na podatki i czy starczy na najbliższe tygodnie” — ani nie ostrzega, że dane są niepełne.
-- get_finance_center(działalność) zbiera to w jednym miejscu (CRM, później natywnie na Macu):
--  1. Gotówka: saldo końcowe ostatniego wyciągu każdego rachunku (bieżący, VAT; ten sam rachunek z MT940 i PDF liczony
--     raz, numer rachunku znormalizowany do 26 cyfr), z datą salda.
--  2. Należności i zobowiązania z wiekowaniem (bez terminu, w terminie, 1–30, 31–60, 61–90, ponad 90 dni po terminie):
--     faktury CRM (bez proform), faktury sprzedaży tylko z KSeF, faktury kosztowe z KSeF (pozostała kwota po płatnościach
--     KSeF) i nieopłacone dokumenty spoza KSeF. Faktura CRM, którą KSeF ma jako zapłaconą, a nie jest z nią połączona,
--     nie wchodzi do należności — trafia na listę do wyjaśnienia.
--  3. Podatki: szacunek VAT miesiąca (należny z faktur sprzedaży minus naliczony z faktur kosztowych — wg daty wystawienia,
--     tylko PLN — minus nadwyżka przeniesiona z poprzednich miesięcy), orientacyjna rezerwa CIT od początku roku (stawka 9% / 19% ustawiana w CRM; przychody netto z faktur minus
--     koszty netto z KSeF i dokumentów spoza KSeF, minus zaliczki zapłacone — bez wynagrodzeń, amortyzacji i kosztów
--     niestanowiących kosztu podatkowego; kwotę zaliczki ustala biuro) i najbliższe ZUS i podatki z kalendarza obowiązków.
--  4. Prognoza 13 tygodni od salda z wyciągów: należności, pro formy, harmonogramy płatności wydarzeń bez faktury, umowy
--     stałe, wynagrodzenia z umów personelu (miesięczne, wypłata do 10. następnego miesiąca), faktury kosztowe oraz ZUS
--     i podatki (kwota z deklaracji, a bez niej — szacunek VAT albo ostatnia zapłata tego obowiązku). Pozycje po terminie
--     osobno: należności (domyślnie nieliczone), zobowiązania i obowiązki bez potwierdzenia zapłaty.
--  5. Kompletność danych: brakujące wyciągi, przestój KSeF, faktury KSeF niepołączone z CRM, operacje do wyjaśnienia,
--     faktury kosztowe bez terminu, ZUS i podatki bez przypisanego przelewu, deklaracje bez kwoty.
--  6. Zamknięcie poprzedniego miesiąca: wyciągi, wyjaśnione operacje, KSeF, deklaracje, przekazanie księgowej, blokada.
-- Odczyt: „Podgląd finansów” działalności; stawka CIT: „Zarządzanie finansami”. Funkcje private.* bez kontroli
-- uprawnień — woła je tylko get_finance_center (kontrola na wejściu).
-- Wymaga: 20261117130000, 20261117132000. Plik można uruchomić ponownie.
BEGIN;

DO $$
BEGIN
  IF to_regprocedure('private.finance_obligations(uuid, date, date)') IS NULL
     OR to_regprocedure('private.local_invoice_outstanding(public.invoices)') IS NULL
     OR to_regclass('public.finance_period_locks') IS NULL THEN
    RAISE EXCEPTION 'Najpierw zastosuj migracje 20261117130000_finance_deadlines.sql i 20261117132000_finance_period_close.sql.';
  END IF;
END $$;

-- 1. Ustawienia podatkowe działalności ------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.finance_company_tax_settings (
  my_company_id uuid PRIMARY KEY REFERENCES public.my_companies(id) ON DELETE CASCADE,
  cit_rate smallint CHECK (cit_rate IS NULL OR cit_rate IN (9, 19)),
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.finance_company_tax_settings IS
  'Stawka CIT działalności (9% mały podatnik / 19%) — do orientacyjnej rezerwy CIT w Centrum finansów.';
ALTER TABLE public.finance_company_tax_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS finance_company_tax_settings_read ON public.finance_company_tax_settings;
CREATE POLICY finance_company_tax_settings_read ON public.finance_company_tax_settings FOR SELECT TO authenticated
  USING (public.finance_company_visible(my_company_id));
REVOKE ALL ON public.finance_company_tax_settings FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.finance_company_tax_settings TO authenticated;
GRANT ALL ON public.finance_company_tax_settings TO service_role;

CREATE OR REPLACE FUNCTION public.save_finance_tax_settings(p_company_id uuid, p_cit_rate integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM private.require_finance_company(p_company_id, true);
  IF p_cit_rate IS NOT NULL AND p_cit_rate NOT IN (9, 19) THEN
    RAISE EXCEPTION 'Stawka CIT: 9%% (mały podatnik) albo 19%%.';
  END IF;
  INSERT INTO public.finance_company_tax_settings (my_company_id, cit_rate, updated_by, updated_at)
  VALUES (p_company_id, p_cit_rate, public.current_invoice_employee_id(), now())
  ON CONFLICT (my_company_id) DO UPDATE
  SET cit_rate = excluded.cit_rate, updated_by = excluded.updated_by, updated_at = now();
END;
$$;
REVOKE ALL ON FUNCTION public.save_finance_tax_settings(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_finance_tax_settings(uuid, integer) TO authenticated, service_role;

-- 2. Pomocnicze -------------------------------------------------------------------------------------------------------------
-- Numer rachunku z wyciągu: same cyfry, ostatnie 26 (MT940 bywa z „/PL”, PDF bez numeru).
CREATE OR REPLACE FUNCTION private.finance_account_digits(p_account text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $$
  SELECT nullif(right(regexp_replace(coalesce(p_account, ''), '[^0-9]', '', 'g'), 26), '');
$$;
REVOKE ALL ON FUNCTION private.finance_account_digits(text) FROM PUBLIC, anon, authenticated;

-- Szacunek VAT miesiąca: należny z faktur sprzedaży (CRM bez proform i szkiców — faktura końcowa: VAT pozostały po
-- zaliczkach; sprzedaż tylko z KSeF) minus naliczony (faktury kosztowe KSeF, faktury spoza KSeF z kwotą netto).
-- Data: wystawienia faktury. Tylko PLN — pozostałe waluty liczone osobno (foreign_count).
CREATE OR REPLACE FUNCTION private.finance_vat_estimate(p_company_id uuid, p_month date)
RETURNS TABLE (output_vat numeric, input_vat numeric, sales_count integer, cost_count integer, foreign_count integer)
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $$
  WITH bounds AS (
    SELECT date_trunc('month', p_month::timestamp)::date AS d1, (date_trunc('month', p_month::timestamp) + interval '1 month')::date AS d2
  ), sales AS (
    SELECT coalesce(i.currency_code, 'PLN') AS currency,
      CASE WHEN i.invoice_type = 'final'
        THEN coalesce(nullif(i.settlement_summary ->> 'remainingVat', '')::numeric, i.total_vat)
        ELSE i.total_vat END AS vat
    FROM public.invoices i CROSS JOIN bounds b
    WHERE i.my_company_id = p_company_id AND i.issue_date >= b.d1 AND i.issue_date < b.d2
      AND i.status NOT IN ('draft', 'cancelled') AND NOT coalesce(i.is_proforma, false) AND i.invoice_type <> 'proforma'
    UNION ALL
    SELECT coalesce(k.currency, 'PLN'), k.vat_amount
    FROM public.ksef_invoices k CROSS JOIN bounds b
    WHERE k.my_company_id = p_company_id AND k.invoice_type = 'issued' AND k.invoice_id IS NULL
      AND k.issue_date >= b.d1 AND k.issue_date < b.d2
      AND NOT EXISTS (SELECT 1 FROM public.invoices i
                      WHERE i.my_company_id = k.my_company_id AND nullif(i.invoice_number, '') = nullif(k.invoice_number, ''))
  ), costs AS (
    SELECT coalesce(k.currency, 'PLN') AS currency, k.vat_amount AS vat
    FROM public.ksef_invoices k CROSS JOIN bounds b
    WHERE k.my_company_id = p_company_id AND k.invoice_type = 'received' AND k.issue_date >= b.d1 AND k.issue_date < b.d2
    UNION ALL
    SELECT coalesce(x.currency, 'PLN'), x.amount_gross - x.amount_net
    FROM public.external_invoices x CROSS JOIN bounds b
    WHERE x.my_company_id = p_company_id AND x.document_kind = 'invoice' AND x.payment_status <> 'cancelled'
      AND x.amount_net IS NOT NULL AND x.amount_gross IS NOT NULL
      AND x.invoice_date >= b.d1 AND x.invoice_date < b.d2
  )
  SELECT round(coalesce((SELECT sum(s.vat) FROM sales s WHERE s.currency = 'PLN'), 0), 2),
         round(coalesce((SELECT sum(c.vat) FROM costs c WHERE c.currency = 'PLN'), 0), 2),
         (SELECT count(*) FROM sales s WHERE s.currency = 'PLN')::integer,
         (SELECT count(*) FROM costs c WHERE c.currency = 'PLN')::integer,
         ((SELECT count(*) FROM sales s WHERE s.currency <> 'PLN') + (SELECT count(*) FROM costs c WHERE c.currency <> 'PLN'))::integer;
$$;
REVOKE ALL ON FUNCTION private.finance_vat_estimate(uuid, date) FROM PUBLIC, anon, authenticated;

-- VAT do zapłaty za miesiąc z nadwyżką naliczonego z poprzednich miesięcy (przeniesienie, do 12 miesięcy wstecz).
-- Miesiąc z deklaracją z kwotą albo z zapłatą przerywa łańcuch (nadwyżki z deklaracji CRM nie zna — liczy od zera).
-- estimate < 0 = nadwyżka do przeniesienia na następny miesiąc.
CREATE OR REPLACE FUNCTION private.finance_vat_due(p_company_id uuid, p_month date)
RETURNS TABLE (output_vat numeric, input_vat numeric, carried numeric, estimate numeric,
               sales_count integer, cost_count integer, foreign_count integer)
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_month date := date_trunc('month', p_month::timestamp)::date;
  v_m date;
  v_surplus numeric := 0;
  v_known boolean;
  r record;
BEGIN
  FOR v_m IN
    SELECT g::date FROM generate_series((v_month - interval '12 months')::timestamp, (v_month - interval '1 month')::timestamp,
                                        interval '1 month') g
  LOOP
    SELECT EXISTS (
      SELECT 1 FROM public.finance_declarations d
      WHERE d.my_company_id = p_company_id AND d.kind = 'vat' AND d.period_kind = 'month' AND d.period_start = v_m
        AND (d.amount_due IS NOT NULL
             OR EXISTS (SELECT 1 FROM public.finance_declaration_payments fp WHERE fp.declaration_id = d.id))) INTO v_known;
    IF v_known THEN
      v_surplus := 0;
    ELSE
      SELECT * INTO r FROM private.finance_vat_estimate(p_company_id, v_m);
      v_surplus := greatest(v_surplus - (r.output_vat - r.input_vat), 0);
    END IF;
  END LOOP;
  SELECT * INTO r FROM private.finance_vat_estimate(p_company_id, v_month);
  output_vat := r.output_vat;
  input_vat := r.input_vat;
  carried := round(v_surplus, 2);
  estimate := round(r.output_vat - r.input_vat - v_surplus, 2);
  sales_count := r.sales_count;
  cost_count := r.cost_count;
  foreign_count := r.foreign_count;
  RETURN NEXT;
END;
$$;
REVOKE ALL ON FUNCTION private.finance_vat_due(uuid, date) FROM PUBLIC, anon, authenticated;

-- Podstawa orientacyjnej rezerwy CIT od początku roku: przychody netto z faktur (zaliczki rozliczone fakturą końcową
-- liczone raz — w fakturze końcowej) minus koszty netto (faktury kosztowe KSeF, dokumenty spoza KSeF bez umów i not
-- uznaniowych), oraz zaliczki CIT zapłacone w roku (przelewy przypisane do deklaracji CIT miesięcznych i kwartalnych).
CREATE OR REPLACE FUNCTION private.finance_cit_basis(p_company_id uuid, p_year integer)
RETURNS TABLE (revenue_net numeric, costs_net numeric, paid numeric)
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $$
  WITH bounds AS (SELECT make_date(p_year, 1, 1) AS d1, make_date(p_year + 1, 1, 1) AS d2)
  SELECT
    round(coalesce((
      SELECT sum(i.total_net) FROM public.invoices i CROSS JOIN bounds b
      WHERE i.my_company_id = p_company_id AND i.issue_date >= b.d1 AND i.issue_date < b.d2
        AND i.status NOT IN ('draft', 'cancelled') AND NOT coalesce(i.is_proforma, false) AND i.invoice_type <> 'proforma'
        AND coalesce(i.currency_code, 'PLN') = 'PLN'
        AND NOT (i.invoice_type = 'advance' AND EXISTS (
          SELECT 1 FROM public.invoices f
          CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(f.settled_invoices) = 'array'
                                                       THEN f.settled_invoices ELSE '[]'::jsonb END) settled
          WHERE f.invoice_type = 'final' AND f.status NOT IN ('draft', 'cancelled') AND settled ->> 'id' = i.id::text))
    ), 0) + coalesce((
      SELECT sum(k.net_amount) FROM public.ksef_invoices k CROSS JOIN bounds b
      WHERE k.my_company_id = p_company_id AND k.invoice_type = 'issued' AND k.invoice_id IS NULL
        AND k.issue_date >= b.d1 AND k.issue_date < b.d2 AND coalesce(k.currency, 'PLN') = 'PLN'
        AND NOT EXISTS (SELECT 1 FROM public.invoices i
                        WHERE i.my_company_id = k.my_company_id AND nullif(i.invoice_number, '') = nullif(k.invoice_number, ''))
    ), 0), 2),
    round(coalesce((
      SELECT sum(k.net_amount) FROM public.ksef_invoices k CROSS JOIN bounds b
      WHERE k.my_company_id = p_company_id AND k.invoice_type = 'received'
        AND k.issue_date >= b.d1 AND k.issue_date < b.d2 AND coalesce(k.currency, 'PLN') = 'PLN'
    ), 0) + coalesce((
      SELECT sum(coalesce(x.amount_net, x.amount_gross)) FROM public.external_invoices x CROSS JOIN bounds b
      WHERE x.my_company_id = p_company_id AND x.payment_status <> 'cancelled'
        AND x.document_kind IN ('invoice', 'receipt', 'insurance_policy', 'debit_note', 'other')
        AND x.invoice_date >= b.d1 AND x.invoice_date < b.d2 AND coalesce(x.currency, 'PLN') = 'PLN'
    ), 0), 2),
    round(coalesce((
      SELECT sum(fp.amount) FROM public.finance_declarations d
      JOIN public.finance_declaration_payments fp ON fp.declaration_id = d.id
      CROSS JOIN bounds b
      WHERE d.my_company_id = p_company_id AND d.kind = 'cit' AND d.period_kind IN ('month', 'quarter')
        AND d.period_start >= b.d1 AND d.period_start < b.d2
    ), 0), 2);
$$;
REVOKE ALL ON FUNCTION private.finance_cit_basis(uuid, integer) FROM PUBLIC, anon, authenticated;

-- 3. Otwarte pozycje (należności, zobowiązania, plany) ----------------------------------------------------------------
-- amount = kwota pozostała (dodatnia), direction in/out. Faktury i pro formy — wszystkie otwarte (także z terminem po
-- horyzoncie, do sald należności i zobowiązań); plany (harmonogramy, umowy stałe, wynagrodzenia) — z terminem do p_until.
CREATE OR REPLACE FUNCTION private.finance_open_items(p_company_id uuid, p_today date, p_until date)
RETURNS TABLE (
  kind text, direction text, item_id uuid, invoice_id uuid, label text, counterparty text,
  issue_date date, due_date date, amount numeric, currency text, estimated boolean, note text
)
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $$
  -- Faktury sprzedaży CRM (bez proform). Faktura, którą KSeF ma jako zapłaconą, a CRM nie — osobno, do wyjaśnienia.
  SELECT CASE WHEN ks.paid THEN 'receivable_ksef_paid' ELSE 'receivable' END, 'in', i.id, i.id, i.invoice_number,
    i.buyer_name, i.issue_date, i.payment_due_date, private.local_invoice_outstanding(i),
    coalesce(i.currency_code, 'PLN'), false,
    CASE WHEN ks.paid THEN 'KSeF: zapłacona — CRM: niezapłacona' END
  FROM public.invoices i
  LEFT JOIN LATERAL (
    SELECT coalesce(bool_or(k.payment_status = 'paid'), false) AS paid
    FROM public.ksef_invoices k
    WHERE k.invoice_type = 'issued'
      AND (k.invoice_id = i.id
           OR (k.invoice_id IS NULL AND k.my_company_id = i.my_company_id
               AND nullif(k.invoice_number, '') = nullif(i.invoice_number, '')))
  ) ks ON true
  WHERE i.my_company_id = p_company_id AND NOT coalesce(i.is_proforma, false) AND i.invoice_type <> 'proforma'
    AND i.status IN ('issued', 'sent', 'overdue')
    AND coalesce(i.payment_status, 'unpaid') IN ('unpaid', 'partially_paid', 'overdue')
    AND private.local_invoice_outstanding(i) > 0.009
  UNION ALL
  -- Faktury sprzedaży wystawione poza CRM (tylko w KSeF).
  SELECT 'receivable', 'in', k.id, NULL, coalesce(k.invoice_number, k.ksef_reference_number), k.buyer_name,
    k.issue_date, k.payment_due_date, pay.remaining, coalesce(k.currency, 'PLN'), false, 'faktura z KSeF'
  FROM public.ksef_invoices k
  CROSS JOIN LATERAL (
    SELECT round(coalesce(k.amount_to_pay_gross, k.gross_amount, 0)
      - coalesce((SELECT sum(p.amount) FROM public.ksef_invoice_payments p WHERE p.ksef_invoice_id = k.id), 0), 2) AS remaining
  ) pay
  WHERE k.my_company_id = p_company_id AND k.invoice_type = 'issued' AND k.invoice_id IS NULL
    AND coalesce(k.payment_status, 'unpaid') IN ('unpaid', 'overdue') AND pay.remaining > 0.009
    AND NOT EXISTS (SELECT 1 FROM public.invoices i
                    WHERE i.my_company_id = k.my_company_id AND nullif(i.invoice_number, '') = nullif(k.invoice_number, ''))
  UNION ALL
  -- Pro formy niezamienione na fakturę (wezwanie do zapłaty, nie należność księgowa).
  SELECT 'proforma', 'in', i.id, i.id, i.invoice_number, i.buyer_name, i.issue_date, i.payment_due_date,
    private.local_invoice_outstanding(i), coalesce(i.currency_code, 'PLN'), false, 'pro forma'
  FROM public.invoices i
  WHERE i.my_company_id = p_company_id AND (coalesce(i.is_proforma, false) OR i.invoice_type = 'proforma')
    AND i.status NOT IN ('draft', 'cancelled') AND i.proforma_converted_to_invoice_id IS NULL
    AND coalesce(i.payment_status, 'unpaid') IN ('unpaid', 'partially_paid', 'overdue')
    AND private.local_invoice_outstanding(i) > 0.009
  UNION ALL
  -- Harmonogram płatności wydarzenia, dla którego nie ma jeszcze faktury.
  SELECT 'milestone', 'in', m.id, NULL, concat_ws(' — ', e.name, nullif(btrim(m.label), '')), NULL, NULL, m.due_date,
    round(m.amount - coalesce(m.paid_amount, 0), 2), 'PLN', true, 'harmonogram płatności wydarzenia'
  FROM public.event_payment_milestones m
  JOIN public.events e ON e.id = m.event_id
  WHERE e.my_company_id = p_company_id AND e.status::text <> 'cancelled'
    AND m.status IN ('planned', 'overdue') AND m.invoice_id IS NULL
    AND m.amount - coalesce(m.paid_amount, 0) > 0.009
    AND (m.due_date IS NULL OR m.due_date <= p_until)
  UNION ALL
  -- Faktury kosztowe z KSeF (pozostała kwota po płatnościach zapisanych przy fakturze).
  SELECT 'payable', 'out', k.id, NULL, coalesce(k.invoice_number, k.ksef_reference_number), k.seller_name,
    k.issue_date, k.payment_due_date, pay.remaining, coalesce(k.currency, 'PLN'), false,
    CASE k.payment_due_source WHEN 'supplier_default' THEN 'termin dostawcy' WHEN 'manual' THEN 'termin wpisany w CRM' END
  FROM public.ksef_invoices k
  CROSS JOIN LATERAL (
    SELECT round(coalesce(k.amount_to_pay_gross, k.gross_amount, 0)
      - coalesce((SELECT sum(p.amount) FROM public.ksef_invoice_payments p WHERE p.ksef_invoice_id = k.id), 0), 2) AS remaining
  ) pay
  WHERE k.my_company_id = p_company_id AND k.invoice_type = 'received'
    AND coalesce(k.payment_status, 'unpaid') IN ('unpaid', 'overdue') AND pay.remaining > 0.009
  UNION ALL
  -- Nieopłacone dokumenty spoza KSeF (bez terminu w CRM).
  SELECT 'payable', 'out', x.id, NULL, coalesce(nullif(x.invoice_number, ''), x.label), x.seller_name, x.invoice_date, NULL,
    round(abs(coalesce(x.amount_gross, x.amount_net, 0)) - coalesce(x.paid_amount, 0), 2), coalesce(x.currency, 'PLN'), false,
    'dokument spoza KSeF'
  FROM public.external_invoices x
  WHERE x.my_company_id = p_company_id AND x.payment_status IN ('unpaid', 'partially_paid')
    AND x.document_kind NOT IN ('credit_note', 'contract')
    AND abs(coalesce(x.amount_gross, x.amount_net, 0)) - coalesce(x.paid_amount, 0) > 0.009
  UNION ALL
  -- Umowy stałe: okresy niezapłacone. Umowa „z fakturą” — tylko przyszłe okresy (bieżącą fakturę liczą faktury kosztowe).
  SELECT CASE c.direction WHEN 'income' THEN 'recurring_income' ELSE 'recurring_cost' END,
    CASE c.direction WHEN 'income' THEN 'in' ELSE 'out' END, c.id, NULL,
    c.title || ' — ' || private.recurring_contract_period_label(c.billing_cycle, p.period_start),
    c.counterparty_name, NULL, p.due_date, round(p.amount - p.paid, 2), c.currency, c.expects_invoice, 'umowa stała'
  FROM public.finance_recurring_contracts c
  CROSS JOIN LATERAL private.recurring_contract_periods(c.id, p_until) p
  WHERE c.my_company_id = p_company_id
    AND p.amount - p.paid > 0.009
    AND p.due_date BETWEEN p_today - 60 AND p_until
    AND (NOT c.expects_invoice OR p.period_start > p_today)
  UNION ALL
  -- Wynagrodzenia z miesięcznych umów personelu: wypłata do 10. następnego miesiąca; pomija miesiąc z zapisaną wypłatą.
  SELECT 'payroll', 'out', pc.id, NULL,
    'Wynagrodzenie ' || to_char(mo.month_start, 'MM/YYYY') || coalesce(' — ' || nullif(btrim(pc.party_name), ''), ''),
    pc.party_name, NULL, (mo.month_start + interval '1 month' + interval '9 days')::date,
    round(amt.amount, 2), coalesce(pc.currency, 'PLN'), true,
    CASE WHEN pc.status = 'draft' THEN 'umowa w przygotowaniu — szacunek' ELSE 'szacunek z umowy' END
  FROM public.personnel_contracts pc
  CROSS JOIN LATERAL (
    SELECT coalesce(pc.planned_net_amount,
      (SELECT pp.amount FROM public.personnel_contract_payments pp
       WHERE pp.personnel_contract_id = pc.id AND pp.amount > 0 ORDER BY pp.payment_date DESC LIMIT 1),
      pc.gross_value) AS amount
  ) amt
  CROSS JOIN LATERAL generate_series(
    date_trunc('month', greatest(pc.start_date, p_today - 45)::timestamp),
    date_trunc('month', least(coalesce(pc.end_date, p_until), p_until)::timestamp),
    interval '1 month') AS mo_raw(month_start)
  CROSS JOIN LATERAL (SELECT mo_raw.month_start::date AS month_start) mo
  WHERE pc.my_company_id = p_company_id AND pc.settlement_cycle = 'monthly' AND pc.status IN ('active', 'draft')
    AND pc.contract_kind IN ('employment', 'mandate') AND pc.start_date IS NOT NULL
    AND amt.amount > 0.009
    AND (mo.month_start + interval '1 month' + interval '9 days')::date BETWEEN p_today - 30 AND p_until
    AND NOT EXISTS (
      SELECT 1 FROM public.personnel_contract_payments pp
      WHERE pp.personnel_contract_id = pc.id
        AND pp.payment_date BETWEEN (mo.month_start + interval '20 days')::date
                                AND (mo.month_start + interval '1 month' + interval '15 days')::date);
$$;
REVOKE ALL ON FUNCTION private.finance_open_items(uuid, date, date) FROM PUBLIC, anon, authenticated;

-- ZUS i podatki do zapłaty: kwota z deklaracji minus zapłata; bez kwoty — szacunek VAT miesiąca albo ostatnia zapłata
-- tego samego obowiązku (amount NULL — kwoty nie da się oszacować, np. VAT za miesiąc, który jeszcze się nie zaczął). Stan „unconfirmed” = termin po ostatnim wyciągu
-- (nie wiadomo, czy zapłacone).
CREATE OR REPLACE FUNCTION private.finance_obligations_due(p_company_id uuid, p_from date, p_to date)
RETURNS TABLE (
  kind text, form text, period_kind text, period_start date, label text, due_date date, amount numeric,
  estimated boolean, status text, overdue boolean
)
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT o.kind, o.form, o.period_kind, o.period_start, o.label, o.due_date,
    round(CASE
      WHEN o.amount_due IS NOT NULL THEN greatest(o.amount_due - o.paid, 0)
      WHEN o.kind = 'vat' AND o.period_kind = 'month'
           AND o.period_start > date_trunc('month', (now() AT TIME ZONE 'Europe/Warsaw')::date::timestamp)::date THEN NULL
      WHEN o.kind = 'vat' AND o.period_kind = 'month' THEN greatest(v.estimate - o.paid, 0)
      WHEN prev.amount IS NOT NULL THEN greatest(prev.amount - o.paid, 0)
      END, 2),
    o.amount_due IS NULL, o.status, o.overdue
  FROM private.finance_obligations(p_company_id, p_from, p_to) o
  LEFT JOIN LATERAL private.finance_vat_due(p_company_id, o.period_start) v
    ON o.kind = 'vat' AND o.period_kind = 'month' AND o.amount_due IS NULL
  LEFT JOIN LATERAL (
    SELECT sum(fp.amount) AS amount
    FROM public.finance_declaration_payments fp
    WHERE fp.declaration_id = (
      SELECT d.id FROM public.finance_declarations d
      WHERE d.my_company_id = p_company_id AND d.kind = o.kind AND d.form = o.form AND d.period_kind = o.period_kind
        AND d.period_start < o.period_start
        AND EXISTS (SELECT 1 FROM public.finance_declaration_payments f2 WHERE f2.declaration_id = d.id)
      ORDER BY d.period_start DESC LIMIT 1)
  ) prev ON o.amount_due IS NULL AND NOT (o.kind = 'vat' AND o.period_kind = 'month')
  WHERE o.status IN ('unpaid', 'partial', 'unconfirmed');
$$;
REVOKE ALL ON FUNCTION private.finance_obligations_due(uuid, date, date) FROM PUBLIC, anon, authenticated;

-- 4. Centrum finansów ---------------------------------------------------------------------------------------------------
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
  IF private.finance_account_digits('/PL12102035410000550204086815') <> '12102035410000550204086815'
     OR private.finance_account_digits(NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'Normalizacja numeru rachunku nie działa.';
  END IF;
  IF has_function_privilege('anon', 'public.get_finance_center(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.save_finance_tax_settings(uuid, integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'private.finance_open_items(uuid, date, date)', 'EXECUTE')
     OR has_table_privilege('authenticated', 'public.finance_company_tax_settings', 'INSERT') THEN
    RAISE EXCEPTION 'Uprawnienia Centrum finansów są zbyt szerokie.';
  END IF;
END $$;

COMMIT;
