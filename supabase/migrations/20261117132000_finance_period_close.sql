-- Finanse, krok 2: zamknięcie miesiąca — 2026-11-17.
--
-- CO I DLACZEGO
-- Po przekazaniu miesiąca księgowej dokumenty i dopasowania z tego miesiąca dało się dalej zmieniać — księgi biura
-- i CRM mogły się rozjechać bez śladu. Zamknięty miesiąc (finance_period_locks, osobno dla każdej działalności):
--  • wyciągi i operacje bankowe z miesiąca wyciągu: bez wczytywania i usuwania wyciągów, bez przypinania, odpinania
--    i wyjaśniania operacji, bez przypisywania przelewów do deklaracji (zmiany techniczne — plik i wersja parsera wyciągu,
--    powiązanie przelewów własnych, przeliczenie stanu dopasowania — bez blokady);
--  • faktury CRM z datą wystawienia w miesiącu: bez wystawiania, usuwania, anulowania i zmiany numeru, dat, kwot, nabywcy
--    i pozycji (zapłata, wysyłka do KSeF, PDF i notatki — bez zmian, bo dotyczą późniejszych zdarzeń; szkic i pro forma
--    nie są dokumentem księgowym — bez blokady);
--  • dokumenty spoza KSeF z datą w miesiącu: bez usuwania i zmiany kwot, dat, numeru i sprzedawcy.
-- Zamyka i otwiera „Zarządzanie finansami” działalności; ponowne otwarcie wymaga uzasadnienia i zostaje w historii
-- (kto, kiedy, dlaczego) — po zmianach miesiąc przekazuje się księgowej ponownie.
-- Zmiana zablokowana w zamkniętym miesiącu kończy się komunikatem z nazwą miesiąca, także w funkcjach bazy.
-- Plik można uruchomić ponownie.
BEGIN;

-- 1. Zamknięcia ---------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.finance_period_locks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  my_company_id uuid NOT NULL REFERENCES public.my_companies(id) ON DELETE CASCADE,
  period_year integer NOT NULL CHECK (period_year BETWEEN 2000 AND 2100),
  period_month integer NOT NULL CHECK (period_month BETWEEN 1 AND 12),
  locked_at timestamptz NOT NULL DEFAULT now(),
  locked_by uuid,
  lock_note text,
  unlocked_at timestamptz,
  unlocked_by uuid,
  unlock_reason text,
  CONSTRAINT finance_period_locks_unlock_reason CHECK (unlocked_at IS NULL OR length(btrim(coalesce(unlock_reason, ''))) >= 10)
);
CREATE UNIQUE INDEX IF NOT EXISTS finance_period_locks_active
  ON public.finance_period_locks (my_company_id, period_year, period_month) WHERE unlocked_at IS NULL;
COMMENT ON TABLE public.finance_period_locks IS
  'Zamknięte miesiące działalności (po przekazaniu księgowej) i historia ponownych otwarć z uzasadnieniem.';
ALTER TABLE public.finance_period_locks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS finance_period_locks_read ON public.finance_period_locks;
CREATE POLICY finance_period_locks_read ON public.finance_period_locks FOR SELECT TO authenticated
  USING (public.finance_company_visible(my_company_id));
REVOKE ALL ON public.finance_period_locks FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.finance_period_locks TO authenticated;
GRANT ALL ON public.finance_period_locks TO service_role;

CREATE OR REPLACE FUNCTION private.finance_period_locked(p_company_id uuid, p_date date)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT p_company_id IS NOT NULL AND p_date IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.finance_period_locks l
    WHERE l.my_company_id = p_company_id AND l.unlocked_at IS NULL
      AND l.period_year = extract(year FROM p_date)::int AND l.period_month = extract(month FROM p_date)::int);
$$;
REVOKE ALL ON FUNCTION private.finance_period_locked(uuid, date) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.raise_finance_period_locked(p_company_id uuid, p_date date, p_what text)
RETURNS void
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF private.finance_period_locked(p_company_id, p_date)
     AND coalesce(current_setting('mavinci.finance_period_lock_bypass', true), '') <> 'on' THEN
    RAISE EXCEPTION 'Miesiąc % jest zamknięty (przekazany księgowej) — zablokowane: %. Aby to zmienić, otwórz miesiąc w „Dla księgowej” z uzasadnieniem.',
      to_char(p_date, 'MM/YYYY'), p_what USING ERRCODE = '42501';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION private.raise_finance_period_locked(uuid, date, text) FROM PUBLIC, anon, authenticated;

-- Miesiąc i działalność operacji bankowej = miesiąc jej wyciągu.
CREATE OR REPLACE FUNCTION private.bank_transaction_period(p_transaction_id uuid)
RETURNS TABLE (company_id uuid, period date)
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT s.my_company_id, make_date(s.statement_year, s.statement_month, 1)
  FROM public.bank_transactions t JOIN public.bank_statements s ON s.id = t.statement_id
  WHERE t.id = p_transaction_id;
$$;
REVOKE ALL ON FUNCTION private.bank_transaction_period(uuid) FROM PUBLIC, anon, authenticated;

-- 2. Strażnicy ----------------------------------------------------------------------------------------------------------
-- SECURITY DEFINER jak pozostali strażnicy w private: zapis z aplikacji (authenticated) i z funkcji serwera (service_role,
-- bez dostępu do schematu private) wywołuje private.raise_finance_period_locked z uprawnieniami właściciela.
CREATE OR REPLACE FUNCTION private.guard_finance_period_bank_statement()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_row public.bank_statements%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN v_row := OLD; ELSE v_row := NEW; END IF;
  -- Zmiany techniczne (plik, ścieżka, wersja parsera, komunikat walidacji) bez blokady.
  IF TG_OP = 'UPDATE' AND NOT (
       NEW.my_company_id IS DISTINCT FROM OLD.my_company_id OR NEW.statement_year IS DISTINCT FROM OLD.statement_year
    OR NEW.statement_month IS DISTINCT FROM OLD.statement_month OR NEW.account_number IS DISTINCT FROM OLD.account_number
    OR NEW.account_type IS DISTINCT FROM OLD.account_type OR NEW.currency IS DISTINCT FROM OLD.currency
    OR NEW.opening_balance IS DISTINCT FROM OLD.opening_balance OR NEW.closing_balance IS DISTINCT FROM OLD.closing_balance
    OR NEW.processed IS DISTINCT FROM OLD.processed OR NEW.validation_status IS DISTINCT FROM OLD.validation_status
    OR NEW.transactions_count IS DISTINCT FROM OLD.transactions_count) THEN
    RETURN NEW;
  END IF;
  PERFORM private.raise_finance_period_locked(v_row.my_company_id, make_date(v_row.statement_year, v_row.statement_month, 1),
    CASE TG_OP WHEN 'INSERT' THEN 'wczytanie wyciągu' WHEN 'DELETE' THEN 'usunięcie wyciągu' ELSE 'zmiana wyciągu' END);
  IF TG_OP = 'UPDATE' AND (NEW.my_company_id IS DISTINCT FROM OLD.my_company_id OR NEW.statement_year IS DISTINCT FROM OLD.statement_year
     OR NEW.statement_month IS DISTINCT FROM OLD.statement_month) THEN
    PERFORM private.raise_finance_period_locked(OLD.my_company_id, make_date(OLD.statement_year, OLD.statement_month, 1), 'przeniesienie wyciągu');
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION private.guard_finance_period_bank_transaction()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_company uuid;
  v_period date;
BEGIN
  SELECT s.my_company_id, make_date(s.statement_year, s.statement_month, 1) INTO v_company, v_period
  FROM public.bank_statements s WHERE s.id = CASE WHEN TG_OP = 'DELETE' THEN OLD.statement_id ELSE NEW.statement_id END;
  IF TG_OP = 'UPDATE' AND NOT (
       NEW.accounting_review_status IS DISTINCT FROM OLD.accounting_review_status
    OR NEW.accounting_category IS DISTINCT FROM OLD.accounting_category
    OR NEW.accounting_subtype IS DISTINCT FROM OLD.accounting_subtype
    OR NEW.accounting_note IS DISTINCT FROM OLD.accounting_note
    OR NEW.private_transfer_detected IS DISTINCT FROM OLD.private_transfer_detected
    OR NEW.private_transfer_owner IS DISTINCT FROM OLD.private_transfer_owner
    OR NEW.amount IS DISTINCT FROM OLD.amount OR NEW.transaction_date IS DISTINCT FROM OLD.transaction_date
    OR NEW.statement_id IS DISTINCT FROM OLD.statement_id) THEN
    -- Przeliczenia stanu dopasowania (match_status, allocated_amount…) i techniczne powiązania przelewów własnych
    -- (paired_bank_transaction_id — przepinane przy wczytywaniu wyciągu innego miesiąca) — bez blokady.
    RETURN NEW;
  END IF;
  PERFORM private.raise_finance_period_locked(v_company, v_period,
    CASE TG_OP WHEN 'INSERT' THEN 'dodanie operacji bankowej' WHEN 'DELETE' THEN 'usunięcie operacji bankowej'
               ELSE 'wyjaśnianie lub zmiana operacji bankowej' END);
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION private.guard_finance_period_transaction_link()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_company uuid;
  v_period date;
BEGIN
  SELECT p.company_id, p.period INTO v_company, v_period
  FROM private.bank_transaction_period(CASE WHEN TG_OP = 'DELETE' THEN OLD.bank_transaction_id ELSE NEW.bank_transaction_id END) p;
  PERFORM private.raise_finance_period_locked(v_company, v_period,
    CASE TG_TABLE_NAME WHEN 'finance_declaration_payments' THEN 'przypisanie przelewu do deklaracji'
                       ELSE 'przypinanie i odpinanie dokumentów operacji' END);
  IF TG_OP = 'UPDATE' AND NEW.bank_transaction_id IS DISTINCT FROM OLD.bank_transaction_id THEN
    SELECT p.company_id, p.period INTO v_company, v_period FROM private.bank_transaction_period(OLD.bank_transaction_id) p;
    PERFORM private.raise_finance_period_locked(v_company, v_period, 'przeniesienie dopasowania');
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

-- Dokument księgowy = faktura poza szkicem i proformą (proforma: status, typ albo znacznik is_proforma).
CREATE OR REPLACE FUNCTION private.invoice_is_accounting_document(p_status text, p_invoice_type text, p_is_proforma boolean)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public
AS $$
  SELECT coalesce(p_status, '') NOT IN ('draft', 'proforma')
     AND coalesce(p_invoice_type, '') <> 'proforma'
     AND NOT coalesce(p_is_proforma, false);
$$;
REVOKE ALL ON FUNCTION private.invoice_is_accounting_document(text, text, boolean) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.guard_finance_period_invoice()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_old_document boolean;
  v_new_document boolean;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    v_old_document := private.invoice_is_accounting_document(OLD.status, OLD.invoice_type, OLD.is_proforma);
  END IF;
  IF TG_OP <> 'DELETE' THEN
    v_new_document := private.invoice_is_accounting_document(NEW.status, NEW.invoice_type, NEW.is_proforma);
  END IF;
  -- Szkic i proforma nie są dokumentem księgowym — można je dodawać, zmieniać i usuwać także w zamkniętym miesiącu.
  IF TG_OP = 'DELETE' THEN
    IF v_old_document THEN
      PERFORM private.raise_finance_period_locked(OLD.my_company_id, OLD.issue_date, 'usunięcie faktury ' || coalesce(nullif(OLD.invoice_number, ''), 'bez numeru'));
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF v_new_document THEN
      PERFORM private.raise_finance_period_locked(NEW.my_company_id, NEW.issue_date, 'wystawienie faktury z datą w tym miesiącu');
    END IF;
    RETURN NEW;
  END IF;
  IF NOT v_old_document AND NOT v_new_document THEN RETURN NEW; END IF;
  IF v_old_document IS DISTINCT FROM v_new_document
     OR NEW.invoice_number IS DISTINCT FROM OLD.invoice_number OR NEW.issue_date IS DISTINCT FROM OLD.issue_date
     OR NEW.sale_date IS DISTINCT FROM OLD.sale_date OR NEW.total_net IS DISTINCT FROM OLD.total_net
     OR NEW.total_vat IS DISTINCT FROM OLD.total_vat OR NEW.total_gross IS DISTINCT FROM OLD.total_gross
     OR NEW.buyer_name IS DISTINCT FROM OLD.buyer_name OR NEW.buyer_nip IS DISTINCT FROM OLD.buyer_nip
     OR NEW.invoice_type IS DISTINCT FROM OLD.invoice_type OR NEW.my_company_id IS DISTINCT FROM OLD.my_company_id
     OR NEW.currency_code IS DISTINCT FROM OLD.currency_code
     OR (NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled')
     OR (OLD.status = 'cancelled' AND NEW.status IS DISTINCT FROM 'cancelled') THEN
    PERFORM private.raise_finance_period_locked(OLD.my_company_id, OLD.issue_date, 'zmiana faktury ' || coalesce(nullif(OLD.invoice_number, ''), 'bez numeru'));
    PERFORM private.raise_finance_period_locked(NEW.my_company_id, NEW.issue_date, 'zmiana faktury ' || coalesce(nullif(NEW.invoice_number, ''), 'bez numeru'));
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION private.guard_finance_period_invoice_item()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_invoice record;
BEGIN
  SELECT i.my_company_id, i.issue_date, i.status, i.invoice_type, i.is_proforma, i.invoice_number INTO v_invoice
  FROM public.invoices i WHERE i.id = CASE WHEN TG_OP = 'DELETE' THEN OLD.invoice_id ELSE NEW.invoice_id END;
  IF FOUND AND private.invoice_is_accounting_document(v_invoice.status, v_invoice.invoice_type, v_invoice.is_proforma) THEN
    PERFORM private.raise_finance_period_locked(v_invoice.my_company_id, v_invoice.issue_date,
      'zmiana pozycji faktury ' || coalesce(nullif(v_invoice.invoice_number, ''), 'bez numeru'));
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION private.guard_finance_period_external_invoice()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM private.raise_finance_period_locked(OLD.my_company_id, OLD.invoice_date, 'usunięcie dokumentu spoza KSeF');
    RETURN OLD;
  END IF;
  IF TG_OP = 'INSERT' THEN
    PERFORM private.raise_finance_period_locked(NEW.my_company_id, NEW.invoice_date, 'dodanie dokumentu spoza KSeF z datą w tym miesiącu');
    RETURN NEW;
  END IF;
  IF NEW.amount_gross IS DISTINCT FROM OLD.amount_gross OR NEW.amount_net IS DISTINCT FROM OLD.amount_net
     OR NEW.invoice_date IS DISTINCT FROM OLD.invoice_date OR NEW.invoice_number IS DISTINCT FROM OLD.invoice_number
     OR NEW.seller_name IS DISTINCT FROM OLD.seller_name OR NEW.seller_nip IS DISTINCT FROM OLD.seller_nip
     OR NEW.currency IS DISTINCT FROM OLD.currency OR NEW.document_kind IS DISTINCT FROM OLD.document_kind
     OR NEW.my_company_id IS DISTINCT FROM OLD.my_company_id THEN
    PERFORM private.raise_finance_period_locked(OLD.my_company_id, OLD.invoice_date, 'zmiana dokumentu spoza KSeF');
    PERFORM private.raise_finance_period_locked(NEW.my_company_id, NEW.invoice_date, 'zmiana dokumentu spoza KSeF');
  END IF;
  RETURN NEW;
END;
$$;

DO $$
DECLARE v_fn text;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY['guard_finance_period_bank_statement', 'guard_finance_period_bank_transaction',
    'guard_finance_period_transaction_link', 'guard_finance_period_invoice', 'guard_finance_period_invoice_item',
    'guard_finance_period_external_invoice'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION private.%I() FROM PUBLIC, anon, authenticated', v_fn);
  END LOOP;
END $$;

DROP TRIGGER IF EXISTS guard_finance_period ON public.bank_statements;
CREATE TRIGGER guard_finance_period BEFORE INSERT OR UPDATE OR DELETE ON public.bank_statements
  FOR EACH ROW EXECUTE FUNCTION private.guard_finance_period_bank_statement();
DROP TRIGGER IF EXISTS guard_finance_period ON public.bank_transactions;
CREATE TRIGGER guard_finance_period BEFORE INSERT OR UPDATE OR DELETE ON public.bank_transactions
  FOR EACH ROW EXECUTE FUNCTION private.guard_finance_period_bank_transaction();
DROP TRIGGER IF EXISTS guard_finance_period ON public.bank_transaction_invoice_matches;
CREATE TRIGGER guard_finance_period BEFORE INSERT OR UPDATE OR DELETE ON public.bank_transaction_invoice_matches
  FOR EACH ROW EXECUTE FUNCTION private.guard_finance_period_transaction_link();
DROP TRIGGER IF EXISTS guard_finance_period ON public.finance_declaration_payments;
CREATE TRIGGER guard_finance_period BEFORE INSERT OR UPDATE OR DELETE ON public.finance_declaration_payments
  FOR EACH ROW EXECUTE FUNCTION private.guard_finance_period_transaction_link();
DROP TRIGGER IF EXISTS guard_finance_period ON public.invoices;
CREATE TRIGGER guard_finance_period BEFORE INSERT OR UPDATE OR DELETE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION private.guard_finance_period_invoice();
DROP TRIGGER IF EXISTS guard_finance_period ON public.invoice_items;
CREATE TRIGGER guard_finance_period BEFORE INSERT OR UPDATE OR DELETE ON public.invoice_items
  FOR EACH ROW EXECUTE FUNCTION private.guard_finance_period_invoice_item();
DROP TRIGGER IF EXISTS guard_finance_period ON public.external_invoices;
CREATE TRIGGER guard_finance_period BEFORE INSERT OR UPDATE OR DELETE ON public.external_invoices
  FOR EACH ROW EXECUTE FUNCTION private.guard_finance_period_external_invoice();

-- 3. Zamykanie i otwieranie ----------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lock_finance_period(p_company_id uuid, p_year integer, p_month integer, p_note text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_id uuid;
  v_today date := (now() AT TIME ZONE 'Europe/Warsaw')::date;
BEGIN
  PERFORM private.require_finance_company(p_company_id, true);
  IF p_month NOT BETWEEN 1 AND 12 OR p_year NOT BETWEEN 2000 AND 2100 THEN RAISE EXCEPTION 'Nieprawidłowy miesiąc.'; END IF;
  IF make_date(p_year, p_month, 1) > date_trunc('month', v_today)::date THEN
    RAISE EXCEPTION 'Nie zamyka się miesiąca, który jeszcze się nie zaczął.';
  END IF;
  SELECT id INTO v_id FROM public.finance_period_locks
  WHERE my_company_id = p_company_id AND period_year = p_year AND period_month = p_month AND unlocked_at IS NULL;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  INSERT INTO public.finance_period_locks (my_company_id, period_year, period_month, locked_by, lock_note)
  VALUES (p_company_id, p_year, p_month, public.current_invoice_employee_id(), nullif(btrim(p_note), ''))
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.lock_finance_period(uuid, integer, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lock_finance_period(uuid, integer, integer, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.unlock_finance_period(p_company_id uuid, p_year integer, p_month integer, p_reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM private.require_finance_company(p_company_id, true);
  IF length(btrim(coalesce(p_reason, ''))) < 10 THEN
    RAISE EXCEPTION 'Podaj uzasadnienie ponownego otwarcia (co najmniej 10 znaków) — zostaje w historii.';
  END IF;
  UPDATE public.finance_period_locks
  SET unlocked_at = now(), unlocked_by = public.current_invoice_employee_id(), unlock_reason = btrim(p_reason)
  WHERE my_company_id = p_company_id AND period_year = p_year AND period_month = p_month AND unlocked_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Miesiąc % nie jest zamknięty.', lpad(p_month::text, 2, '0') || '/' || p_year; END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.unlock_finance_period(uuid, integer, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.unlock_finance_period(uuid, integer, integer, text) TO authenticated, service_role;

-- Stan miesięcy roku: zamknięcie, przekazanie księgowej i historia otwarć.
CREATE OR REPLACE FUNCTION public.get_finance_periods(p_company_id uuid, p_year integer)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM private.require_finance_company(p_company_id, false);
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'month', m,
      'locked', l.id IS NOT NULL,
      'locked_at', l.locked_at,
      'locked_by_name', (SELECT nullif(btrim(concat_ws(' ', e.name, e.surname)), '') FROM public.employees e WHERE e.id = l.locked_by),
      'lock_note', l.lock_note,
      'handed_over_at', (SELECT max(h.delivered_at) FROM public.accounting_month_handoffs h
                         WHERE h.my_company_id = p_company_id AND h.period_year = p_year AND h.period_month = m),
      'reopenings', coalesce((
        SELECT jsonb_agg(jsonb_build_object('unlocked_at', u.unlocked_at, 'reason', u.unlock_reason,
          'by_name', (SELECT nullif(btrim(concat_ws(' ', e.name, e.surname)), '') FROM public.employees e WHERE e.id = u.unlocked_by))
          ORDER BY u.unlocked_at DESC)
        FROM public.finance_period_locks u
        WHERE u.my_company_id = p_company_id AND u.period_year = p_year AND u.period_month = m AND u.unlocked_at IS NOT NULL), '[]'::jsonb)
    ) ORDER BY m)
    FROM generate_series(1, 12) m
    LEFT JOIN public.finance_period_locks l
      ON l.my_company_id = p_company_id AND l.period_year = p_year AND l.period_month = m AND l.unlocked_at IS NULL), '[]'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION public.get_finance_periods(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_finance_periods(uuid, integer) TO authenticated, service_role;

-- 4. Kontrola -------------------------------------------------------------------------------------------------------------
DO $$
BEGIN
  IF (SELECT count(*) FROM pg_trigger WHERE tgname = 'guard_finance_period' AND NOT tgisinternal) <> 7 THEN
    RAISE EXCEPTION 'Brakuje strażników zamkniętego miesiąca (oczekiwano 7 tabel).';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname = 'private' AND p.proname LIKE 'guard\_finance\_period\_%' AND NOT p.prosecdef) THEN
    RAISE EXCEPTION 'Strażnicy zamkniętego miesiąca muszą działać jako właściciel (SECURITY DEFINER).';
  END IF;
  IF has_function_privilege('anon', 'public.lock_finance_period(uuid, integer, integer, text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.unlock_finance_period(uuid, integer, integer, text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.get_finance_periods(uuid, integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Zamykanie miesięcy dostępne bez logowania.';
  END IF;
END $$;

COMMIT;
