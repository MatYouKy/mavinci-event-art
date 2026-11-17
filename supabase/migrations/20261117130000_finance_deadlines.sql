-- Finanse, krok 2: kalendarz obowiązków (ZUS i podatki), terminy faktur kosztowych, monity do klientów — 2026-11-17.
--
-- CO I DLACZEGO
-- 1. Kalendarz obowiązków. Terminy ZUS i podatków wynikają z przepisów, a nie z dokumentów, więc CRM liczy je sam:
--    finance_obligation_settings — które obowiązki ma działalność, dzień i miesiąc terminu (spółka: DRA do 15.,
--    PIT-4R i zaliczka CIT do 20., VAT-7 / JPK_V7M do 25. następnego miesiąca, CIT-8 do końca 3. miesiąca po roku).
--    Termin przypadający w sobotę, niedzielę lub święto przechodzi na najbliższy dzień roboczy (Ordynacja podatkowa
--    art. 12 § 5; święta z public_holidays). Przy każdym obowiązku: deklaracja z rejestru „ZUS i podatki” (kwota),
--    zapłata z wyciągu (finance_declaration_payments) i stan: zapłacone, zapłacone bez kwoty z deklaracji, częściowo,
--    niezapłacone, po terminie albo „brak wyciągu” (wyciągi nie sięgają jeszcze terminu — nie da się potwierdzić).
--    Ustawienia startowe: obowiązki, które działalność ma już w rejestrze deklaracji (Mavinci: DRA, PIT-4R, VAT-7,
--    CIT-8 miesięczny i roczny); pozostałe włącza „Zarządzanie finansami” w CRM.
-- 2. Faktury kosztowe bez terminu płatności (64 nieopłacone na dziś — w KSeF faktura nie ma terminu): termin wpisany
--    ręcznie albo domyślny termin dostawcy (finance_supplier_payment_terms, dni od daty wystawienia), uzupełniany też
--    przy pobieraniu nowych faktur. Synchronizacja z KSeF nie nadpisuje terminu wpisanego w CRM, a termin z faktury
--    ma pierwszeństwo — ręcznie zmienia się tylko faktury bez terminu w KSeF.
-- 3. Monity do klientów: dziennik wysłanych przypomnień o płatności (finance_payment_reminder_emails) — wysyłka tym
--    samym e-mailem co faktura (send-invoice-email), wpis po wysłaniu lub zaplanowaniu.
-- 4. get_finance_deadlines(działalność): jeden odczyt dla sekcji „Terminy” w CRM — obowiązki, należności (przeterminowane
--    i z terminem w 14 dni, z ostatnim monitem) i zobowiązania (do zapłaty w 14 dni, po terminie, bez terminu).
-- 5. notify_finance_obligations(): przypomnienia o ZUS i podatkach o 8:05 (ten sam cron co przypomnienia o fakturach):
--    „ZUS i podatki w ciągu 3 dni” (zbiorczo, codziennie) i „po terminie” (każdy obowiązek raz, tylko gdy wyciąg
--    obejmuje termin), do „Zarządzania finansami” działalności.
-- Odczyt: „Podgląd finansów” działalności; zmiany: „Zarządzanie finansami”; monit: „Wystawianie faktur” lub wyżej.
-- Wymaga: 20261117120000, 20261117122000 (finance_reminder_log, private.format_pln). Plik można uruchomić ponownie.
BEGIN;

DO $$
BEGIN
  IF to_regclass('public.finance_reminder_log') IS NULL OR to_regprocedure('private.format_pln(numeric)') IS NULL THEN
    RAISE EXCEPTION 'Najpierw zastosuj migrację 20261117122000_finance_payment_reminders.sql.';
  END IF;
END $$;

-- 0. Dzień roboczy ------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.finance_next_business_day(p_date date)
RETURNS date
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_date date := p_date;
BEGIN
  IF v_date IS NULL THEN RETURN NULL; END IF;
  FOR v_step IN 1..15 LOOP
    EXIT WHEN extract(isodow FROM v_date) < 6
      AND NOT EXISTS (SELECT 1 FROM public.public_holidays h WHERE h.country = 'PL' AND h.holiday_date = v_date);
    v_date := v_date + 1;
  END LOOP;
  RETURN v_date;
END;
$$;
REVOKE ALL ON FUNCTION private.finance_next_business_day(date) FROM PUBLIC, anon, authenticated;

-- 1. Ustawienia obowiązków ----------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.finance_obligation_settings (
  my_company_id uuid NOT NULL REFERENCES public.my_companies(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('zus', 'pit', 'vat', 'cit', 'other')),
  form text NOT NULL CHECK (length(btrim(form)) BETWEEN 2 AND 30),
  period_kind text NOT NULL CHECK (period_kind IN ('month', 'quarter', 'year')),
  enabled boolean NOT NULL DEFAULT true,
  due_day integer NOT NULL CHECK (due_day BETWEEN 1 AND 31),
  due_month_offset integer NOT NULL DEFAULT 1 CHECK (due_month_offset BETWEEN 0 AND 12),
  label text CHECK (label IS NULL OR length(label) <= 120),
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (my_company_id, kind, form, period_kind)
);
COMMENT ON TABLE public.finance_obligation_settings IS
  'Obowiązki ZUS i podatkowe działalności: termin = dzień due_day miesiąca, który jest due_month_offset miesięcy po ostatnim miesiącu okresu (z przesunięciem na dzień roboczy).';
ALTER TABLE public.finance_obligation_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS finance_obligation_settings_read ON public.finance_obligation_settings;
CREATE POLICY finance_obligation_settings_read ON public.finance_obligation_settings FOR SELECT TO authenticated
  USING (public.finance_company_visible(my_company_id));
REVOKE ALL ON public.finance_obligation_settings FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.finance_obligation_settings TO authenticated;
GRANT ALL ON public.finance_obligation_settings TO service_role;

-- Ustawienia startowe: obowiązki, które działalność ma już w rejestrze deklaracji (miesięczne — co najmniej za dwa
-- miesiące, żeby pojedynczy przelew nie włączył np. miesięcznych zaliczek CIT przy kwartalnym rozliczeniu).
INSERT INTO public.finance_obligation_settings (my_company_id, kind, form, period_kind, enabled, due_day, due_month_offset, label)
SELECT d.my_company_id, x.kind, x.form, x.period_kind, true, x.due_day, x.due_month_offset, x.label
FROM public.finance_declarations d
JOIN (VALUES
  ('zus', 'DRA', 'month', 15, 1, 'ZUS (DRA)'),
  ('pit', 'PIT-4R', 'month', 20, 1, 'Zaliczki PIT od wynagrodzeń (PIT-4R)'),
  ('cit', 'CIT-8', 'month', 20, 1, 'Zaliczka CIT'),
  ('vat', 'VAT-7', 'month', 25, 1, 'VAT i JPK_V7M'),
  ('cit', 'CIT-8', 'year', 31, 3, 'Zeznanie CIT-8 i dopłata podatku')
) AS x(kind, form, period_kind, due_day, due_month_offset, label)
  ON x.kind = d.kind AND x.form = d.form AND x.period_kind = d.period_kind
JOIN public.my_companies c ON c.id = d.my_company_id AND c.is_active
GROUP BY d.my_company_id, x.kind, x.form, x.period_kind, x.due_day, x.due_month_offset, x.label
HAVING x.period_kind <> 'month' OR count(DISTINCT d.period_start) >= 2
ON CONFLICT (my_company_id, kind, form, period_kind) DO NOTHING;

CREATE OR REPLACE FUNCTION public.save_finance_obligation_setting(p_company_id uuid, p_kind text, p_form text,
  p_period_kind text, p_enabled boolean, p_due_day integer, p_due_month_offset integer, p_label text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM private.require_finance_company(p_company_id, true);
  IF p_kind NOT IN ('zus', 'pit', 'vat', 'cit', 'other') THEN RAISE EXCEPTION 'Nieznany rodzaj obowiązku.'; END IF;
  IF p_period_kind NOT IN ('month', 'quarter', 'year') THEN RAISE EXCEPTION 'Nieznany rodzaj okresu.'; END IF;
  IF nullif(btrim(p_form), '') IS NULL THEN RAISE EXCEPTION 'Podaj symbol deklaracji (np. DRA, PIT-4R, VAT-7).'; END IF;
  IF p_due_day IS NULL OR p_due_day NOT BETWEEN 1 AND 31 THEN RAISE EXCEPTION 'Dzień terminu musi być od 1 do 31.'; END IF;
  IF coalesce(p_due_month_offset, 1) NOT BETWEEN 0 AND 12 THEN RAISE EXCEPTION 'Przesunięcie terminu: od 0 do 12 miesięcy.'; END IF;
  INSERT INTO public.finance_obligation_settings AS s (my_company_id, kind, form, period_kind, enabled, due_day,
    due_month_offset, label, updated_by, updated_at)
  VALUES (p_company_id, p_kind, upper(btrim(p_form)), p_period_kind, coalesce(p_enabled, true), p_due_day,
    coalesce(p_due_month_offset, 1), nullif(btrim(p_label), ''), public.current_invoice_employee_id(), now())
  ON CONFLICT (my_company_id, kind, form, period_kind) DO UPDATE
  SET enabled = EXCLUDED.enabled, due_day = EXCLUDED.due_day, due_month_offset = EXCLUDED.due_month_offset,
      label = EXCLUDED.label, updated_by = EXCLUDED.updated_by, updated_at = now();
END;
$$;
REVOKE ALL ON FUNCTION public.save_finance_obligation_setting(uuid, text, text, text, boolean, integer, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_finance_obligation_setting(uuid, text, text, text, boolean, integer, integer, text) TO authenticated, service_role;

-- 2. Kalendarz obowiązków -----------------------------------------------------------------------------------------------
-- Bez kontroli uprawnień — wołają ją get_finance_obligations / get_finance_deadlines (kontrola) i przypomnienia (cron).
CREATE OR REPLACE FUNCTION private.finance_obligations(p_company_id uuid, p_from date, p_to date)
RETURNS TABLE (
  kind text, form text, period_kind text, period_start date, label text, setting_label text, due_date date,
  declaration_id uuid, amount_due numeric, paid numeric, status text, overdue boolean, amount_missing boolean
)
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $$
  WITH params AS (
    SELECT (now() AT TIME ZONE 'Europe/Warsaw')::date AS today,
      (SELECT max((make_date(s.statement_year, s.statement_month, 1) + interval '1 month - 1 day')::date)
       FROM public.bank_statements s
       WHERE s.my_company_id = p_company_id AND s.processed AND s.validation_status = 'valid') AS statement_end
  ), periods AS (
    SELECT s.kind, s.form, s.period_kind, s.label AS setting_label, s.due_day, s.due_month_offset, p.period_start::date
    FROM public.finance_obligation_settings s
    CROSS JOIN LATERAL generate_series(
      date_trunc(CASE s.period_kind WHEN 'month' THEN 'month' WHEN 'quarter' THEN 'quarter' ELSE 'year' END,
                 p_from - interval '27 months')::date,
      p_to,
      CASE s.period_kind WHEN 'month' THEN interval '1 month' WHEN 'quarter' THEN interval '3 months' ELSE interval '1 year' END
    ) AS p(period_start)
    WHERE s.my_company_id = p_company_id AND s.enabled
  ), dated AS (
    SELECT periods.*,
      private.finance_next_business_day(
        (x.due_month + (least(periods.due_day, extract(day FROM (x.due_month + interval '1 month - 1 day'))::int) - 1))::date
      ) AS due_date
    FROM periods
    CROSS JOIN LATERAL (
      SELECT (date_trunc('month',
        periods.period_start
        + CASE periods.period_kind WHEN 'month' THEN interval '1 month' WHEN 'quarter' THEN interval '3 months' ELSE interval '1 year' END
        - interval '1 day') + make_interval(months => periods.due_month_offset))::date AS due_month
    ) x
  )
  SELECT dated.kind, dated.form, dated.period_kind, dated.period_start,
    private.finance_declaration_label(dated.form, dated.period_kind, dated.period_start) AS label,
    dated.setting_label, dated.due_date, d.id AS declaration_id, d.amount_due, coalesce(pay.paid, 0) AS paid,
    CASE
      WHEN d.amount_due IS NOT NULL AND coalesce(pay.paid, 0) >= d.amount_due - 0.01 THEN 'paid'
      WHEN d.amount_due IS NULL AND coalesce(pay.paid, 0) > 0 THEN 'paid_no_amount'
      WHEN coalesce(pay.paid, 0) > 0 THEN 'partial'
      WHEN dated.due_date < params.today AND (params.statement_end IS NULL OR params.statement_end < dated.due_date) THEN 'unconfirmed'
      ELSE 'unpaid'
    END AS status,
    dated.due_date < params.today
      AND NOT (d.amount_due IS NOT NULL AND coalesce(pay.paid, 0) >= d.amount_due - 0.01)
      AND NOT (d.amount_due IS NULL AND coalesce(pay.paid, 0) > 0)
      AND params.statement_end IS NOT NULL AND params.statement_end >= dated.due_date AS overdue,
    d.amount_due IS NULL AS amount_missing
  FROM dated
  CROSS JOIN params
  LEFT JOIN public.finance_declarations d
    ON d.my_company_id = p_company_id AND d.kind = dated.kind AND d.form = dated.form
   AND d.period_kind = dated.period_kind AND d.period_start = dated.period_start
  LEFT JOIN LATERAL (
    SELECT sum(fp.amount) AS paid FROM public.finance_declaration_payments fp WHERE fp.declaration_id = d.id
  ) pay ON true
  WHERE dated.due_date BETWEEN p_from AND p_to
  ORDER BY dated.due_date, dated.kind, dated.form;
$$;
REVOKE ALL ON FUNCTION private.finance_obligations(uuid, date, date) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_finance_obligations(p_company_id uuid, p_from date, p_to date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM private.require_finance_company(p_company_id, false);
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from OR p_to - p_from > 800 THEN
    RAISE EXCEPTION 'Nieprawidłowy zakres dat kalendarza obowiązków.';
  END IF;
  RETURN coalesce((SELECT jsonb_agg(to_jsonb(o) ORDER BY o.due_date, o.kind, o.form)
                   FROM private.finance_obligations(p_company_id, p_from, p_to) o), '[]'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION public.get_finance_obligations(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_finance_obligations(uuid, date, date) TO authenticated, service_role;

-- 3. Terminy płatności faktur kosztowych ---------------------------------------------------------------------------------
ALTER TABLE public.ksef_invoices ADD COLUMN IF NOT EXISTS payment_due_source text;
ALTER TABLE public.ksef_invoices DROP CONSTRAINT IF EXISTS ksef_invoices_payment_due_source_check;
ALTER TABLE public.ksef_invoices ADD CONSTRAINT ksef_invoices_payment_due_source_check
  CHECK (payment_due_source IS NULL OR payment_due_source IN ('manual', 'supplier_default'));
COMMENT ON COLUMN public.ksef_invoices.payment_due_source IS
  'Skąd termin płatności: NULL — z faktury w KSeF; manual — wpisany w CRM; supplier_default — domyślny termin dostawcy.';

CREATE TABLE IF NOT EXISTS public.finance_supplier_payment_terms (
  my_company_id uuid NOT NULL REFERENCES public.my_companies(id) ON DELETE CASCADE,
  seller_nip text NOT NULL CHECK (seller_nip ~ '^[0-9]{10}$'),
  seller_name text,
  days integer NOT NULL CHECK (days BETWEEN 0 AND 180),
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (my_company_id, seller_nip)
);
COMMENT ON TABLE public.finance_supplier_payment_terms IS
  'Domyślny termin płatności dostawcy (dni od wystawienia) — dla faktur kosztowych bez terminu w KSeF.';
ALTER TABLE public.finance_supplier_payment_terms ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS finance_supplier_payment_terms_read ON public.finance_supplier_payment_terms;
CREATE POLICY finance_supplier_payment_terms_read ON public.finance_supplier_payment_terms FOR SELECT TO authenticated
  USING (public.finance_company_visible(my_company_id));
REVOKE ALL ON public.finance_supplier_payment_terms FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.finance_supplier_payment_terms TO authenticated;
GRANT ALL ON public.finance_supplier_payment_terms TO service_role;

CREATE OR REPLACE FUNCTION private.ksef_nip_digits(p_nip text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $$
  SELECT nullif(right(regexp_replace(coalesce(p_nip, ''), '[^0-9]', '', 'g'), 10), '');
$$;
REVOKE ALL ON FUNCTION private.ksef_nip_digits(text) FROM PUBLIC, anon, authenticated;

-- Termin z CRM nie znika przy ponownym pobraniu faktury (KSeF jej terminu nie ma); nowa faktura kosztowa bez terminu
-- dostaje domyślny termin dostawcy. Termin z faktury w KSeF zawsze wygrywa.
CREATE OR REPLACE FUNCTION private.keep_ksef_invoice_payment_due()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_days integer;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.payment_due_date IS NULL AND OLD.payment_due_date IS NOT NULL
     AND OLD.payment_due_source IN ('manual', 'supplier_default') THEN
    NEW.payment_due_date := OLD.payment_due_date;
    NEW.payment_due_source := OLD.payment_due_source;
  ELSIF TG_OP = 'UPDATE' AND NEW.payment_due_date IS DISTINCT FROM OLD.payment_due_date
        AND NEW.payment_due_source IS NOT DISTINCT FROM OLD.payment_due_source
        AND OLD.payment_due_source IS NOT NULL
        AND coalesce(current_setting('mavinci.ksef_due_from_crm', true), '') <> 'on' THEN
    -- Termin przyszedł z faktury (np. ponowne pobranie po zmianie w KSeF) — od teraz jest „z faktury”.
    NEW.payment_due_source := NULL;
  END IF;

  IF NEW.payment_due_date IS NULL AND NEW.invoice_type = 'received' AND NEW.my_company_id IS NOT NULL
     AND NEW.issue_date IS NOT NULL THEN
    SELECT t.days INTO v_days FROM public.finance_supplier_payment_terms t
    WHERE t.my_company_id = NEW.my_company_id AND t.seller_nip = private.ksef_nip_digits(NEW.seller_nip);
    IF v_days IS NOT NULL THEN
      NEW.payment_due_date := NEW.issue_date + v_days;
      NEW.payment_due_source := 'supplier_default';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.keep_ksef_invoice_payment_due() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS keep_ksef_invoice_payment_due ON public.ksef_invoices;
CREATE TRIGGER keep_ksef_invoice_payment_due
  BEFORE INSERT OR UPDATE OF payment_due_date, payment_due_source, issue_date, seller_nip, my_company_id
  ON public.ksef_invoices
  FOR EACH ROW EXECUTE FUNCTION private.keep_ksef_invoice_payment_due();

-- Termin faktury bez terminu w KSeF; p_remember — zapamiętaj jako termin dostawcy i uzupełnij jego pozostałe
-- nieopłacone faktury bez terminu. Zwraca liczbę uzupełnionych faktur (z tą włącznie).
CREATE OR REPLACE FUNCTION public.set_ksef_invoice_payment_due(p_invoice_id uuid, p_due_date date, p_remember boolean DEFAULT false)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_invoice public.ksef_invoices%ROWTYPE;
  v_nip text;
  v_days integer;
  v_count integer := 0;
BEGIN
  SELECT * INTO v_invoice FROM public.ksef_invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Nie znaleziono faktury.'; END IF;
  PERFORM private.require_finance_company(v_invoice.my_company_id, true);
  IF v_invoice.payment_due_date IS NOT NULL AND v_invoice.payment_due_source IS NULL THEN
    RAISE EXCEPTION 'Faktura ma termin płatności z KSeF (%) — nie zmienia się go w CRM.', to_char(v_invoice.payment_due_date, 'DD.MM.YYYY');
  END IF;
  IF p_due_date IS NULL AND p_remember THEN RAISE EXCEPTION 'Podaj termin, żeby zapamiętać go dla dostawcy.'; END IF;
  IF p_due_date IS NOT NULL AND v_invoice.issue_date IS NOT NULL AND p_due_date < v_invoice.issue_date THEN
    RAISE EXCEPTION 'Termin płatności nie może być wcześniejszy niż data wystawienia (%).', to_char(v_invoice.issue_date, 'DD.MM.YYYY');
  END IF;

  -- Zmiana z CRM (nie z KSeF) — wyzwalacz nie traktuje jej jak terminu z faktury.
  PERFORM set_config('mavinci.ksef_due_from_crm', 'on', true);
  UPDATE public.ksef_invoices
  SET payment_due_date = p_due_date, payment_due_source = CASE WHEN p_due_date IS NULL THEN NULL ELSE 'manual' END
  WHERE id = p_invoice_id;
  v_count := 1;

  IF coalesce(p_remember, false) THEN
    v_nip := private.ksef_nip_digits(v_invoice.seller_nip);
    IF v_nip IS NULL OR length(v_nip) <> 10 OR v_invoice.invoice_type <> 'received' OR v_invoice.issue_date IS NULL THEN
      RAISE EXCEPTION 'Termin dostawcy można zapamiętać tylko dla faktury kosztowej z NIP dostawcy i datą wystawienia.';
    END IF;
    v_days := p_due_date - v_invoice.issue_date;
    IF v_days > 180 THEN RAISE EXCEPTION 'Domyślny termin dostawcy może mieć najwyżej 180 dni.'; END IF;
    INSERT INTO public.finance_supplier_payment_terms (my_company_id, seller_nip, seller_name, days, updated_by, updated_at)
    VALUES (v_invoice.my_company_id, v_nip, v_invoice.seller_name, v_days, public.current_invoice_employee_id(), now())
    ON CONFLICT (my_company_id, seller_nip) DO UPDATE
    SET days = EXCLUDED.days, seller_name = EXCLUDED.seller_name, updated_by = EXCLUDED.updated_by, updated_at = now();

    UPDATE public.ksef_invoices k
    SET payment_due_date = k.issue_date + v_days, payment_due_source = 'supplier_default'
    WHERE k.my_company_id = v_invoice.my_company_id AND k.invoice_type = 'received' AND k.id <> p_invoice_id
      AND k.payment_due_date IS NULL AND k.issue_date IS NOT NULL AND k.payment_status IN ('unpaid', 'overdue')
      AND private.ksef_nip_digits(k.seller_nip) = v_nip;
    GET DIAGNOSTICS v_days = ROW_COUNT;
    v_count := v_count + v_days;
  END IF;
  PERFORM set_config('mavinci.ksef_due_from_crm', '', true);
  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.set_ksef_invoice_payment_due(uuid, date, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_ksef_invoice_payment_due(uuid, date, boolean) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.delete_finance_supplier_payment_term(p_company_id uuid, p_seller_nip text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM private.require_finance_company(p_company_id, true);
  DELETE FROM public.finance_supplier_payment_terms
  WHERE my_company_id = p_company_id AND seller_nip = private.ksef_nip_digits(p_seller_nip);
END;
$$;
REVOKE ALL ON FUNCTION public.delete_finance_supplier_payment_term(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_finance_supplier_payment_term(uuid, text) TO authenticated, service_role;

-- 4. Monity do klientów ---------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.finance_payment_reminder_emails (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  my_company_id uuid REFERENCES public.my_companies(id) ON DELETE SET NULL,
  recipient text NOT NULL CHECK (length(btrim(recipient)) BETWEEN 3 AND 500),
  scheduled_at timestamptz,
  outstanding numeric(14,2),
  sent_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS finance_payment_reminder_emails_invoice_idx
  ON public.finance_payment_reminder_emails (invoice_id, created_at DESC);
COMMENT ON TABLE public.finance_payment_reminder_emails IS
  'Wysłane (lub zaplanowane) przypomnienia o płatności faktury do klienta — wpis po wysyłce z CRM.';
ALTER TABLE public.finance_payment_reminder_emails ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS finance_payment_reminder_emails_read ON public.finance_payment_reminder_emails;
CREATE POLICY finance_payment_reminder_emails_read ON public.finance_payment_reminder_emails FOR SELECT TO authenticated
  USING (public.finance_company_level_at_least(my_company_id, 'invoices'));
REVOKE ALL ON public.finance_payment_reminder_emails FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.finance_payment_reminder_emails TO authenticated;
GRANT ALL ON public.finance_payment_reminder_emails TO service_role;

CREATE OR REPLACE FUNCTION private.local_invoice_outstanding(p_invoice public.invoices)
RETURNS numeric
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT greatest(round(coalesce(
    CASE WHEN p_invoice.invoice_type = 'final' THEN nullif(p_invoice.settlement_summary ->> 'remainingGross', '')::numeric END,
    p_invoice.total_gross, 0) - coalesce(p_invoice.paid_amount, 0), 2), 0);
$$;
REVOKE ALL ON FUNCTION private.local_invoice_outstanding(public.invoices) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.record_invoice_payment_reminder(p_invoice_id uuid, p_recipient text, p_scheduled_at timestamptz DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_invoice public.invoices%ROWTYPE;
  v_id uuid;
BEGIN
  SELECT * INTO v_invoice FROM public.invoices WHERE id = p_invoice_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Nie znaleziono faktury.'; END IF;
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND NOT public.finance_company_level_at_least(v_invoice.my_company_id, 'invoices_issue') THEN
    RAISE EXCEPTION 'Brak uprawnień do monitów tej działalności.' USING ERRCODE = '42501';
  END IF;
  IF nullif(btrim(p_recipient), '') IS NULL THEN RAISE EXCEPTION 'Brak adresata przypomnienia.'; END IF;
  INSERT INTO public.finance_payment_reminder_emails (invoice_id, my_company_id, recipient, scheduled_at, outstanding, sent_by)
  VALUES (p_invoice_id, v_invoice.my_company_id, left(btrim(p_recipient), 500), p_scheduled_at,
    private.local_invoice_outstanding(v_invoice), public.current_invoice_employee_id())
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.record_invoice_payment_reminder(uuid, text, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_invoice_payment_reminder(uuid, text, timestamptz) TO authenticated, service_role;

-- 5. Odczyt sekcji „Terminy” ----------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_finance_deadlines(p_company_id uuid)
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
    'statement_end', (SELECT max((make_date(s.statement_year, s.statement_month, 1) + interval '1 month - 1 day')::date)
                      FROM public.bank_statements s
                      WHERE s.my_company_id = p_company_id AND s.processed AND s.validation_status = 'valid'),
    'obligations', coalesce((SELECT jsonb_agg(to_jsonb(o) ORDER BY o.due_date, o.kind, o.form)
                             FROM private.finance_obligations(p_company_id, v_today - 400, v_today + 100) o
                             WHERE o.due_date >= v_today OR o.status NOT IN ('paid', 'paid_no_amount')), '[]'::jsonb),
    'receivables', coalesce((
      SELECT jsonb_agg(r ORDER BY r ->> 'due_date', r ->> 'invoice_number') FROM (
        SELECT jsonb_build_object(
          'source', 'local', 'id', i.id, 'invoice_id', i.id, 'invoice_number', i.invoice_number,
          'buyer_name', i.buyer_name, 'buyer_email', i.buyer_email, 'issue_date', i.issue_date,
          'due_date', i.payment_due_date, 'gross', i.total_gross, 'outstanding', private.local_invoice_outstanding(i),
          'currency', coalesce(i.currency_code, 'PLN'), 'event_id', i.event_id, 'pdf_url', i.pdf_url,
          'in_ksef', i.ksef_reference_number IS NOT NULL,
          'days_overdue', greatest(v_today - i.payment_due_date, 0),
          'reminders', (SELECT count(*) FROM public.finance_payment_reminder_emails m WHERE m.invoice_id = i.id),
          'last_reminder_at', (SELECT max(m.created_at) FROM public.finance_payment_reminder_emails m WHERE m.invoice_id = i.id)
        ) AS r
        FROM public.invoices i
        WHERE i.my_company_id = p_company_id AND NOT coalesce(i.is_proforma, false) AND i.invoice_type <> 'proforma'
          AND i.status IN ('issued', 'sent', 'overdue')
          AND coalesce(i.payment_status, 'unpaid') IN ('unpaid', 'partially_paid', 'overdue')
          AND i.payment_due_date IS NOT NULL AND i.payment_due_date <= v_today + 14
          AND private.local_invoice_outstanding(i) > 0
        UNION ALL
        SELECT jsonb_build_object(
          'source', 'ksef', 'id', k.id, 'invoice_id', NULL, 'invoice_number', coalesce(k.invoice_number, k.ksef_reference_number),
          'buyer_name', k.buyer_name, 'buyer_email', NULL, 'issue_date', k.issue_date, 'due_date', k.payment_due_date,
          'gross', k.gross_amount, 'outstanding', coalesce(k.amount_to_pay_gross, k.gross_amount),
          'currency', coalesce(k.currency, 'PLN'), 'event_id', NULL, 'pdf_url', NULL, 'in_ksef', true,
          'days_overdue', greatest(v_today - k.payment_due_date, 0), 'reminders', 0, 'last_reminder_at', NULL)
        FROM public.ksef_invoices k
        WHERE k.my_company_id = p_company_id AND k.invoice_type = 'issued' AND k.invoice_id IS NULL
          AND k.payment_status IN ('unpaid', 'overdue') AND coalesce(k.amount_to_pay_gross, k.gross_amount, 0) > 0
          AND k.payment_due_date IS NOT NULL AND k.payment_due_date <= v_today + 14
        LIMIT 500
      ) x), '[]'::jsonb),
    'payables', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
          'id', k.id, 'invoice_number', coalesce(k.invoice_number, k.ksef_reference_number), 'seller_name', k.seller_name,
          'seller_nip', private.ksef_nip_digits(k.seller_nip), 'issue_date', k.issue_date, 'due_date', k.payment_due_date,
          'due_source', k.payment_due_source, 'amount', coalesce(k.amount_to_pay_gross, k.gross_amount),
          'currency', coalesce(k.currency, 'PLN'), 'bank_account', k.bank_account_number,
          'days_left', k.payment_due_date - v_today,
          'supplier_days', (SELECT t.days FROM public.finance_supplier_payment_terms t
                            WHERE t.my_company_id = p_company_id AND t.seller_nip = private.ksef_nip_digits(k.seller_nip)))
        ORDER BY k.payment_due_date NULLS FIRST, k.issue_date, k.id)
      FROM public.ksef_invoices k
      WHERE k.my_company_id = p_company_id AND k.invoice_type = 'received'
        AND k.payment_status IN ('unpaid', 'overdue') AND coalesce(k.amount_to_pay_gross, k.gross_amount, 0) > 0
        AND (k.payment_due_date IS NULL OR k.payment_due_date <= v_today + 14)), '[]'::jsonb),
    'supplier_terms', coalesce((
      SELECT jsonb_agg(jsonb_build_object('seller_nip', t.seller_nip, 'seller_name', t.seller_name, 'days', t.days)
        ORDER BY t.seller_name, t.seller_nip)
      FROM public.finance_supplier_payment_terms t WHERE t.my_company_id = p_company_id), '[]'::jsonb),
    'settings', coalesce((
      SELECT jsonb_agg(to_jsonb(s) - 'my_company_id' - 'updated_by' ORDER BY s.kind, s.form, s.period_kind)
      FROM public.finance_obligation_settings s WHERE s.my_company_id = p_company_id), '[]'::jsonb)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_finance_deadlines(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_finance_deadlines(uuid) TO authenticated, service_role;

-- 6. Przypomnienia o ZUS i podatkach -------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notify_finance_obligations()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Europe/Warsaw')::date;
  v_company record;
  v_recipients uuid[];
  v_summary record;
  v_key text;
  v_notification uuid;
  v_sent integer := 0;
BEGIN
  FOR v_company IN
    SELECT c.id, c.name FROM public.my_companies c
    WHERE c.is_active AND EXISTS (SELECT 1 FROM public.finance_obligation_settings s WHERE s.my_company_id = c.id AND s.enabled)
    ORDER BY c.name
  LOOP
    SELECT coalesce(array_agg(DISTINCT auth_user.id), '{}') INTO v_recipients
    FROM public.employees employee
    JOIN auth.users auth_user ON auth_user.id = coalesce(employee.auth_user_id, employee.id)
    WHERE employee.is_active = true
      AND private.employee_finance_company_level(employee.id, v_company.id) = 'finance_manage';
    CONTINUE WHEN cardinality(v_recipients) = 0;

    -- Termin w ciągu 3 dni, bez zapłaty na wyciągu.
    v_key := format('obligations-due:%s:%s', v_company.id, v_today);
    IF NOT EXISTS (SELECT 1 FROM public.finance_reminder_log WHERE reminder_key = v_key) THEN
      SELECT count(*) AS n,
        string_agg(format('%s — %s%s', o.label, to_char(o.due_date, 'DD.MM'),
          CASE WHEN o.amount_due IS NULL THEN ' (brak kwoty z deklaracji)'
               ELSE ', ' || private.format_pln(o.amount_due - o.paid) END), '; ' ORDER BY o.due_date, o.label) AS items
      INTO v_summary
      FROM private.finance_obligations(v_company.id, v_today, v_today + 3) o
      WHERE o.status IN ('unpaid', 'partial');
      IF v_summary.n > 0 THEN
        INSERT INTO public.notifications(title, message, type, category, action_url, metadata, created_at)
        VALUES ('ZUS i podatki w ciągu 3 dni — ' || v_company.name, v_summary.items || '.', 'warning', 'system',
          '/crm/invoices?tab=external&section=deadlines',
          jsonb_build_object('kind', 'finance_obligation_reminder', 'reminder', 'due', 'company_id', v_company.id), now())
        RETURNING id INTO v_notification;
        INSERT INTO public.notification_recipients(notification_id, user_id, is_read)
        SELECT v_notification, recipient, false FROM unnest(v_recipients) recipient
        ON CONFLICT (notification_id, user_id) DO NOTHING;
        INSERT INTO public.finance_reminder_log(reminder_key, notification_id, details)
        VALUES (v_key, v_notification, jsonb_build_object('obligations', v_summary.n));
        v_sent := v_sent + 1;
      END IF;
    END IF;

    -- Po terminie (wyciąg obejmuje termin, brak zapłaty) — każdy obowiązek raz.
    SELECT count(*) AS n,
      string_agg(format('%s — termin %s%s', o.label, to_char(o.due_date, 'DD.MM'),
        CASE WHEN o.status = 'partial' THEN ', zapłacono ' || private.format_pln(o.paid) ELSE '' END), '; '
        ORDER BY o.due_date, o.label) AS items,
      array_agg(format('obligation-overdue:%s:%s:%s:%s:%s', v_company.id, o.kind, o.form, o.period_kind, o.period_start)) AS keys
    INTO v_summary
    FROM private.finance_obligations(v_company.id, v_today - 45, v_today - 1) o
    WHERE o.overdue
      AND NOT EXISTS (SELECT 1 FROM public.finance_reminder_log l
                      WHERE l.reminder_key = format('obligation-overdue:%s:%s:%s:%s:%s', v_company.id, o.kind, o.form,
                                                    o.period_kind, o.period_start));
    IF v_summary.n > 0 THEN
      INSERT INTO public.notifications(title, message, type, category, action_url, metadata, created_at)
      VALUES ('ZUS i podatki po terminie — ' || v_company.name,
        v_summary.items || '. Na wyciągu nie ma zapłaty — sprawdź przelew albo przypisz go w uzgodnieniu wyciągu.',
        'error', 'system', '/crm/invoices?tab=external&section=deadlines',
        jsonb_build_object('kind', 'finance_obligation_reminder', 'reminder', 'overdue', 'company_id', v_company.id), now())
      RETURNING id INTO v_notification;
      INSERT INTO public.notification_recipients(notification_id, user_id, is_read)
      SELECT v_notification, recipient, false FROM unnest(v_recipients) recipient
      ON CONFLICT (notification_id, user_id) DO NOTHING;
      INSERT INTO public.finance_reminder_log(reminder_key, notification_id, details)
      SELECT key, v_notification, jsonb_build_object('company_id', v_company.id) FROM unnest(v_summary.keys) key
      ON CONFLICT (reminder_key) DO NOTHING;
      v_sent := v_sent + 1;
    END IF;
  END LOOP;
  RETURN v_sent;
END;
$$;
REVOKE ALL ON FUNCTION public.notify_finance_obligations() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notify_finance_obligations() TO service_role;

DO $$
DECLARE v_job_id bigint;
BEGIN
  FOR v_job_id IN SELECT jobid FROM cron.job WHERE jobname = 'finance-payment-reminders' LOOP
    PERFORM cron.unschedule(v_job_id);
  END LOOP;
  PERFORM cron.schedule('finance-payment-reminders', '5 6,7 * * *',
    $cron$SELECT public.check_and_notify_invoice_payments(), public.notify_finance_obligations() WHERE to_char(now() AT TIME ZONE 'Europe/Warsaw', 'HH24') = '08';$cron$);
END $$;

-- 7. Kontrola -------------------------------------------------------------------------------------------------------------
DO $$
BEGIN
  IF private.finance_next_business_day(DATE '2026-11-15') <> DATE '2026-11-16'
     OR private.finance_next_business_day(DATE '2026-12-25') <> DATE '2026-12-28' THEN
    RAISE EXCEPTION 'Przesunięcie terminu na dzień roboczy nie działa (sprawdź public_holidays dla PL).';
  END IF;
  IF has_function_privilege('anon', 'public.get_finance_deadlines(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.notify_finance_obligations()', 'EXECUTE')
     OR has_table_privilege('authenticated', 'public.finance_obligation_settings', 'INSERT')
     OR has_table_privilege('authenticated', 'public.finance_supplier_payment_terms', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.finance_payment_reminder_emails', 'INSERT') THEN
    RAISE EXCEPTION 'Uprawnienia kalendarza obowiązków są zbyt szerokie.';
  END IF;
END $$;

COMMIT;
