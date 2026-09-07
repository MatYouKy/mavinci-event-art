BEGIN;

-- Poprzednia wersja funkcji wybierała kolumny przez nieistniejący alias
-- `company`, mimo że my_companies ma w zapytaniu alias `mc`.
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
  FROM public.bank_statements AS bs
  JOIN public.my_companies AS mc ON mc.id = bs.my_company_id
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

REVOKE ALL ON FUNCTION public.classify_private_bank_transfer() FROM PUBLIC;

NOTIFY pgrst, 'reload schema';

COMMIT;
