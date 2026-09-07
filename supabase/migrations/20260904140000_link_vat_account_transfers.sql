/*
  # Parowanie transferow pomiedzy rachunkiem biezacym i rachunkiem VAT

  Taki transfer nie wymaga faktury ani deklaracji. Dwie przeciwne operacje
  tej samej firmy sa laczone i wspolnie oznaczane jako wyjasnione.
*/

BEGIN;

ALTER TABLE public.bank_transactions
  ADD COLUMN IF NOT EXISTS paired_bank_transaction_id uuid
  REFERENCES public.bank_transactions(id) ON DELETE SET NULL;

ALTER TABLE public.bank_transactions
  DROP CONSTRAINT IF EXISTS bank_transactions_pair_not_self;
ALTER TABLE public.bank_transactions
  ADD CONSTRAINT bank_transactions_pair_not_self
  CHECK (paired_bank_transaction_id IS NULL OR paired_bank_transaction_id <> id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_bank_transactions_paired_transaction
  ON public.bank_transactions(paired_bank_transaction_id)
  WHERE paired_bank_transaction_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_bank_transactions_vat_pair_lookup
  ON public.bank_transactions(transaction_date, amount, currency, transaction_type)
  WHERE paired_bank_transaction_id IS NULL;

CREATE OR REPLACE FUNCTION public.get_vat_transfer_candidates(p_transaction_id uuid)
RETURNS TABLE (
  transaction_id uuid,
  statement_id uuid,
  transaction_date date,
  amount numeric,
  currency text,
  transaction_type text,
  counterparty_name text,
  title text,
  account_type text,
  account_number text,
  statement_file_name text,
  day_distance integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_transaction public.bank_transactions%ROWTYPE;
  v_company_id uuid;
  v_account_type text;
BEGIN
  SELECT bt.*
  INTO v_transaction
  FROM public.bank_transactions bt
  WHERE bt.id = p_transaction_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Nie znaleziono transakcji';
  END IF;

  SELECT bs.my_company_id, bs.account_type
  INTO v_company_id, v_account_type
  FROM public.bank_statements bs
  WHERE bs.id = v_transaction.statement_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Nie znaleziono wyciagu dla transakcji';
  END IF;
  IF auth.role() <> 'service_role' AND NOT (
    public.finance_can_view() AND public.finance_company_visible(v_company_id)
  ) THEN
    RAISE EXCEPTION 'Brak uprawnien do odczytu transferow' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    candidate.id,
    candidate.statement_id,
    candidate.transaction_date,
    ABS(candidate.amount),
    UPPER(COALESCE(candidate.currency, 'PLN')),
    candidate.transaction_type,
    candidate.counterparty_name,
    candidate.title,
    statement.account_type,
    statement.account_number,
    statement.file_name,
    ABS(candidate.transaction_date - v_transaction.transaction_date)::integer
  FROM public.bank_transactions candidate
  JOIN public.bank_statements statement ON statement.id = candidate.statement_id
  WHERE candidate.id <> p_transaction_id
    AND statement.my_company_id = v_company_id
    AND statement.processed = true
    AND COALESCE(statement.validation_status, 'valid') = 'valid'
    AND (
      (v_account_type = 'vat' AND statement.account_type <> 'vat')
      OR (v_account_type <> 'vat' AND statement.account_type = 'vat')
    )
    AND candidate.transaction_type <> v_transaction.transaction_type
    AND UPPER(COALESCE(candidate.currency, 'PLN')) = UPPER(COALESCE(v_transaction.currency, 'PLN'))
    AND ABS(ABS(candidate.amount) - ABS(v_transaction.amount)) <= 0.01
    AND ABS(candidate.transaction_date - v_transaction.transaction_date) <= 7
    AND COALESCE(candidate.allocated_amount, 0) <= 0.01
    AND COALESCE(candidate.match_status, 'unmatched') <> 'matched'
    AND candidate.matched_invoice_id IS NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.bank_transaction_invoice_matches match
      WHERE match.bank_transaction_id = candidate.id
    )
    AND (
      candidate.accounting_review_status <> 'explained'
      OR candidate.accounting_subtype = 'automatic_vat_transfer'
    )
    AND (
      v_transaction.paired_bank_transaction_id IS NULL
      OR candidate.id = v_transaction.paired_bank_transaction_id
    )
    AND (
      candidate.paired_bank_transaction_id IS NULL
      OR (
        candidate.id = v_transaction.paired_bank_transaction_id
        AND candidate.paired_bank_transaction_id = v_transaction.id
      )
    )
  ORDER BY
    ABS(candidate.transaction_date - v_transaction.transaction_date),
    candidate.transaction_date DESC,
    candidate.created_at DESC
  LIMIT 30;
END;
$$;

CREATE OR REPLACE FUNCTION public.link_vat_account_transactions(
  p_transaction_id uuid,
  p_counterpart_transaction_id uuid,
  p_note text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_left public.bank_transactions%ROWTYPE;
  v_right public.bank_transactions%ROWTYPE;
  v_left_company_id uuid;
  v_right_company_id uuid;
  v_left_account_type text;
  v_right_account_type text;
  v_note text := COALESCE(
    NULLIF(BTRIM(p_note), ''),
    'Automatyczny transfer srodkow pomiedzy rachunkiem biezacym a rachunkiem VAT.'
  );
BEGIN
  IF p_transaction_id = p_counterpart_transaction_id THEN
    RAISE EXCEPTION 'Nie mozna polaczyc transakcji z nia sama';
  END IF;
  IF CHAR_LENGTH(v_note) > 2000 THEN
    RAISE EXCEPTION 'Opis moze miec maksymalnie 2000 znakow';
  END IF;

  PERFORM 1
  FROM public.bank_transactions
  WHERE id IN (p_transaction_id, p_counterpart_transaction_id)
  ORDER BY id
  FOR UPDATE;

  SELECT bt.*
  INTO v_left
  FROM public.bank_transactions bt
  WHERE bt.id = p_transaction_id;

  SELECT bt.*
  INTO v_right
  FROM public.bank_transactions bt
  WHERE bt.id = p_counterpart_transaction_id;

  IF v_left.id IS NULL OR v_right.id IS NULL THEN
    RAISE EXCEPTION 'Nie znaleziono jednej z transakcji';
  END IF;

  SELECT bs.my_company_id, bs.account_type
  INTO v_left_company_id, v_left_account_type
  FROM public.bank_statements bs
  WHERE bs.id = v_left.statement_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Nie znaleziono wyciagu pierwszej transakcji';
  END IF;

  SELECT bs.my_company_id, bs.account_type
  INTO v_right_company_id, v_right_account_type
  FROM public.bank_statements bs
  WHERE bs.id = v_right.statement_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Nie znaleziono wyciagu drugiej transakcji';
  END IF;
  IF v_left_company_id IS DISTINCT FROM v_right_company_id THEN
    RAISE EXCEPTION 'Transakcje naleza do roznych dzialalnosci';
  END IF;
  IF auth.role() <> 'service_role' AND NOT (
    public.finance_can_manage() AND public.finance_company_visible(v_left_company_id)
  ) THEN
    RAISE EXCEPTION 'Brak uprawnien do laczenia transferow' USING ERRCODE = '42501';
  END IF;
  IF NOT (
    (v_left_account_type = 'vat' AND v_right_account_type <> 'vat')
    OR (v_left_account_type <> 'vat' AND v_right_account_type = 'vat')
  ) THEN
    RAISE EXCEPTION 'Jedna operacja musi pochodzic z rachunku VAT, a druga z rachunku biezacego';
  END IF;
  IF v_left.transaction_type = v_right.transaction_type THEN
    RAISE EXCEPTION 'Operacje musza miec przeciwne kierunki';
  END IF;
  IF UPPER(COALESCE(v_left.currency, 'PLN')) <> UPPER(COALESCE(v_right.currency, 'PLN')) THEN
    RAISE EXCEPTION 'Waluty operacji sa rozne';
  END IF;
  IF ABS(ABS(v_left.amount) - ABS(v_right.amount)) > 0.01 THEN
    RAISE EXCEPTION 'Kwoty operacji sa rozne';
  END IF;
  IF ABS(v_left.transaction_date - v_right.transaction_date) > 7 THEN
    RAISE EXCEPTION 'Daty operacji sa oddalone o wiecej niz 7 dni';
  END IF;
  IF COALESCE(v_left.allocated_amount, 0) > 0.01
    OR COALESCE(v_right.allocated_amount, 0) > 0.01
    OR COALESCE(v_left.match_status, 'unmatched') = 'matched'
    OR COALESCE(v_right.match_status, 'unmatched') = 'matched'
    OR v_left.matched_invoice_id IS NOT NULL
    OR v_right.matched_invoice_id IS NOT NULL
  THEN
    RAISE EXCEPTION 'Operacja powiazania z dokumentem nie moze zostac uzyta jako transfer wlasny';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.bank_transaction_invoice_matches match
    WHERE match.bank_transaction_id IN (v_left.id, v_right.id)
  ) THEN
    RAISE EXCEPTION 'Operacja powiazana z dokumentem nie moze zostac uzyta jako transfer wlasny';
  END IF;
  IF v_left.paired_bank_transaction_id IS NOT NULL
    AND v_left.paired_bank_transaction_id <> v_right.id
  THEN
    RAISE EXCEPTION 'Pierwsza operacja jest juz polaczona z innym transferem';
  END IF;
  IF v_right.paired_bank_transaction_id IS NOT NULL
    AND v_right.paired_bank_transaction_id <> v_left.id
  THEN
    RAISE EXCEPTION 'Druga operacja jest juz polaczona z innym transferem';
  END IF;

  UPDATE public.bank_transactions
  SET paired_bank_transaction_id = CASE
        WHEN id = v_left.id THEN v_right.id
        ELSE v_left.id
      END,
      accounting_category = 'own_transfer',
      accounting_subtype = 'automatic_vat_transfer',
      accounting_note = v_note,
      accounting_review_status = 'explained',
      accounting_reviewed_at = now()
  WHERE id IN (v_left.id, v_right.id);
END;
$$;

REVOKE ALL ON FUNCTION public.get_vat_transfer_candidates(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.link_vat_account_transactions(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_vat_transfer_candidates(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.link_vat_account_transactions(uuid, uuid, text) TO authenticated, service_role;

COMMENT ON COLUMN public.bank_transactions.paired_bank_transaction_id IS
  'Przeciwna operacja tego samego transferu pomiedzy wlasnymi rachunkami.';
COMMENT ON FUNCTION public.get_vat_transfer_candidates(uuid) IS
  'Zwraca przeciwne operacje z rachunku biezacego lub VAT o tej samej kwocie, walucie i zblizonej dacie.';
COMMENT ON FUNCTION public.link_vat_account_transactions(uuid, uuid, text) IS
  'Laczy dwie strony transferu rachunek biezacy - rachunek VAT i oznacza obie jako wyjasnione.';

NOTIFY pgrst, 'reload schema';

COMMIT;
