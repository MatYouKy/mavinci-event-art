/* Konto prywatne działalności i lokalne oznaczanie przelewów własnych. */

ALTER TABLE public.my_companies
  ADD COLUMN IF NOT EXISTS private_bank_account text,
  ADD COLUMN IF NOT EXISTS private_bank_account_owner text;

ALTER TABLE public.bank_transactions
  ADD COLUMN IF NOT EXISTS private_transfer_detected boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS private_transfer_owner text;

CREATE INDEX IF NOT EXISTS idx_bank_transactions_private_transfer
  ON public.bank_transactions (statement_id, transaction_date)
  WHERE private_transfer_detected;

CREATE OR REPLACE FUNCTION public.bank_transaction_contains_account(
  p_private_account text,
  p_counterparty_account text,
  p_counterparty_name text,
  p_title text,
  p_reference_number text
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  WITH normalized AS (
    SELECT
      regexp_replace(COALESCE(p_private_account, ''), '[^0-9]', '', 'g') AS account_number,
      regexp_replace(
        CONCAT_WS(' ', p_counterparty_account, p_counterparty_name, p_title, p_reference_number),
        '[^0-9]',
        '',
        'g'
      ) AS transaction_digits
  )
  SELECT length(account_number) >= 16
    AND position(account_number IN transaction_digits) > 0
  FROM normalized;
$$;

CREATE OR REPLACE FUNCTION public.classify_private_bank_transfer()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_private_account text;
  v_private_owner text;
  v_is_private boolean := false;
  v_was_private boolean := false;
  v_auto_note_prefix constant text := '[AUTO] Przelew prywatny';
BEGIN
  SELECT mc.private_bank_account, mc.private_bank_account_owner
    INTO v_private_account, v_private_owner
  FROM public.bank_statements bs
  JOIN public.my_companies mc ON mc.id = bs.my_company_id
  WHERE bs.id = NEW.statement_id;

  v_is_private := COALESCE(public.bank_transaction_contains_account(
    v_private_account,
    NEW.counterparty_account,
    NEW.counterparty_name,
    NEW.title,
    NEW.reference_number
  ), false);

  IF TG_OP = 'UPDATE' THEN
    v_was_private := COALESCE(OLD.private_transfer_detected, false);
  END IF;

  NEW.private_transfer_detected := v_is_private;
  NEW.private_transfer_owner := CASE
    WHEN v_is_private THEN COALESCE(NULLIF(btrim(v_private_owner), ''), 'Konto prywatne')
    ELSE NULL
  END;

  IF v_is_private THEN
    NEW.accounting_category := 'own_transfer';
    NEW.accounting_review_status := 'explained';
    NEW.accounting_reviewed_at := COALESCE(NEW.accounting_reviewed_at, now());

    IF NEW.accounting_note IS NULL
      OR btrim(NEW.accounting_note) = ''
      OR NEW.accounting_note LIKE v_auto_note_prefix || '%'
    THEN
      NEW.accounting_note := v_auto_note_prefix || CASE
        WHEN NULLIF(btrim(v_private_owner), '') IS NOT NULL
          THEN ' — konto: ' || btrim(v_private_owner)
        ELSE ''
      END;
    END IF;
  ELSIF v_was_private AND COALESCE(NEW.accounting_note, '') LIKE v_auto_note_prefix || '%' THEN
    NEW.accounting_note := NULL;
    NEW.accounting_category := 'other';
    NEW.accounting_review_status := 'pending';
    NEW.accounting_reviewed_at := NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS classify_private_bank_transfer_trigger ON public.bank_transactions;
CREATE TRIGGER classify_private_bank_transfer_trigger
BEFORE INSERT OR UPDATE OF statement_id, counterparty_account, counterparty_name, title, reference_number
ON public.bank_transactions
FOR EACH ROW
EXECUTE FUNCTION public.classify_private_bank_transfer();

CREATE OR REPLACE FUNCTION public.refresh_private_bank_transfers_for_company()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.bank_transactions AS bt
    SET title = bt.title
    FROM public.bank_statements AS bs
    WHERE bs.id = bt.statement_id
      AND bs.my_company_id = NEW.id;
  ELSIF regexp_replace(COALESCE(OLD.private_bank_account, ''), '[^0-9]', '', 'g')
      IS DISTINCT FROM regexp_replace(COALESCE(NEW.private_bank_account, ''), '[^0-9]', '', 'g')
    OR COALESCE(OLD.private_bank_account_owner, '') IS DISTINCT FROM COALESCE(NEW.private_bank_account_owner, '')
  THEN
    UPDATE public.bank_transactions AS bt
    SET title = bt.title
    FROM public.bank_statements AS bs
    WHERE bs.id = bt.statement_id
      AND bs.my_company_id = NEW.id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS refresh_private_bank_transfers_for_company_trigger ON public.my_companies;
CREATE TRIGGER refresh_private_bank_transfers_for_company_trigger
AFTER INSERT OR UPDATE OF private_bank_account, private_bank_account_owner
ON public.my_companies
FOR EACH ROW
EXECUTE FUNCTION public.refresh_private_bank_transfers_for_company();

UPDATE public.bank_transactions AS bt
SET title = bt.title
FROM public.bank_statements AS bs
JOIN public.my_companies AS mc ON mc.id = bs.my_company_id
WHERE bs.id = bt.statement_id
  AND NULLIF(regexp_replace(COALESCE(mc.private_bank_account, ''), '[^0-9]', '', 'g'), '') IS NOT NULL;

COMMENT ON COLUMN public.my_companies.private_bank_account IS 'Prywatny rachunek używany wyłącznie do lokalnego rozpoznawania przelewów własnych.';
COMMENT ON COLUMN public.my_companies.private_bank_account_owner IS 'Nazwa właściciela prywatnego rachunku wyświetlana przy rozpoznanym przelewie.';
COMMENT ON COLUMN public.bank_transactions.private_transfer_detected IS 'Transakcja lokalnie rozpoznana jako przelew do lub z prywatnego rachunku przypisanego działalności.';
COMMENT ON COLUMN public.bank_transactions.private_transfer_owner IS 'Właściciel prywatnego rachunku zapisany w chwili klasyfikacji transakcji.';

REVOKE ALL ON FUNCTION public.bank_transaction_contains_account(text, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.classify_private_bank_transfer() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.refresh_private_bank_transfers_for_company() FROM PUBLIC;

NOTIFY pgrst, 'reload schema';
