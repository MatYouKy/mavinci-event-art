/*
  # Uwagi wymagające wyjaśnienia podczas dopasowania płatności

  Uwaga jest zapisywana atomowo razem z dopasowaniem, trafia do rejestru
  kontroli finansowej i pozostaje także na dokumencie jako notatka księgowa.
*/

BEGIN;

CREATE OR REPLACE FUNCTION public.flag_bank_match_for_explanation(
  p_match_id uuid,
  p_review_note text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_note text := NULLIF(BTRIM(p_review_note), '');
  v_document_source text;
  v_document_id uuid;
  v_company_id uuid;
BEGIN
  IF v_note IS NULL THEN
    RAISE EXCEPTION 'Podaj uwage do dodatkowego wyjasnienia';
  END IF;
  IF CHAR_LENGTH(v_note) > 2000 THEN
    RAISE EXCEPTION 'Uwaga moze miec maksymalnie 2000 znakow';
  END IF;

  SELECT
    m.document_source,
    CASE m.document_source
      WHEN 'invoice' THEN m.invoice_id
      WHEN 'ksef' THEN m.ksef_invoice_id
      WHEN 'external' THEN m.external_invoice_id
    END,
    bs.my_company_id
  INTO v_document_source, v_document_id, v_company_id
  FROM public.bank_transaction_invoice_matches m
  JOIN public.bank_transactions bt ON bt.id = m.bank_transaction_id
  JOIN public.bank_statements bs ON bs.id = bt.statement_id
  WHERE m.id = p_match_id;

  IF NOT FOUND OR v_document_id IS NULL THEN
    RAISE EXCEPTION 'Nie znaleziono dopasowania lub dokumentu';
  END IF;
  IF auth.role() <> 'service_role' AND NOT (
    public.finance_can_manage() AND public.finance_company_visible(v_company_id)
  ) THEN
    RAISE EXCEPTION 'Brak uprawnien do oznaczenia dokumentu' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.financial_payment_review_issues AS issue (
    document_source,
    document_id,
    my_company_id,
    issue_code,
    details
  ) VALUES (
    v_document_source,
    v_document_id,
    v_company_id,
    'manual_match_explanation_required',
    jsonb_build_object(
      'bank_match_id', p_match_id,
      'note', v_note,
      'marked_at', now()
    )
  )
  ON CONFLICT (document_source, document_id, issue_code)
  DO UPDATE SET
    my_company_id = EXCLUDED.my_company_id,
    details = issue.details || EXCLUDED.details,
    resolved_at = NULL,
    resolved_by = NULL;

  IF v_document_source = 'invoice' THEN
    UPDATE public.invoices
    SET accounting_note = CASE
      WHEN NULLIF(BTRIM(accounting_note), '') IS NULL THEN v_note
      WHEN POSITION(v_note IN accounting_note) > 0 THEN accounting_note
      ELSE accounting_note || E'\n' || v_note
    END
    WHERE id = v_document_id;
  ELSIF v_document_source = 'ksef' THEN
    UPDATE public.ksef_invoices
    SET accounting_note = CASE
      WHEN NULLIF(BTRIM(accounting_note), '') IS NULL THEN v_note
      WHEN POSITION(v_note IN accounting_note) > 0 THEN accounting_note
      ELSE accounting_note || E'\n' || v_note
    END
    WHERE id = v_document_id;
  ELSIF v_document_source = 'external' THEN
    UPDATE public.external_invoices
    SET accounting_note = CASE
      WHEN NULLIF(BTRIM(accounting_note), '') IS NULL THEN v_note
      WHEN POSITION(v_note IN accounting_note) > 0 THEN accounting_note
      ELSE accounting_note || E'\n' || v_note
    END
    WHERE id = v_document_id;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.match_bank_transaction_to_documents_with_review(
  p_transaction_id uuid,
  p_documents jsonb,
  p_review_note text
)
RETURNS SETOF public.bank_transaction_invoice_matches
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_result public.bank_transaction_invoice_matches%ROWTYPE;
BEGIN
  FOR v_result IN
    SELECT *
    FROM public.match_bank_transaction_to_documents(p_transaction_id, p_documents)
  LOOP
    PERFORM public.flag_bank_match_for_explanation(v_result.id, p_review_note);
    RETURN NEXT v_result;
  END LOOP;
  RETURN;
END;
$$;

CREATE OR REPLACE FUNCTION public.reconcile_external_invoice_with_bank_transaction_with_review(
  p_transaction_id uuid,
  p_external_invoice_id uuid,
  p_transaction_amount numeric,
  p_document_amount numeric,
  p_review_note text,
  p_confidence numeric DEFAULT NULL,
  p_match_reasons text[] DEFAULT ARRAY[]::text[]
)
RETURNS public.bank_transaction_invoice_matches
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_result public.bank_transaction_invoice_matches%ROWTYPE;
BEGIN
  SELECT *
  INTO v_result
  FROM public.reconcile_external_invoice_with_bank_transaction(
    p_transaction_id,
    p_external_invoice_id,
    p_transaction_amount,
    p_document_amount,
    p_confidence,
    p_match_reasons
  );

  PERFORM public.flag_bank_match_for_explanation(v_result.id, p_review_note);
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.flag_bank_match_for_explanation(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.match_bank_transaction_to_documents_with_review(uuid, jsonb, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reconcile_external_invoice_with_bank_transaction_with_review(uuid, uuid, numeric, numeric, text, numeric, text[]) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.match_bank_transaction_to_documents_with_review(uuid, jsonb, text)
TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reconcile_external_invoice_with_bank_transaction_with_review(uuid, uuid, numeric, numeric, text, numeric, text[])
TO authenticated, service_role;

COMMENT ON FUNCTION public.match_bank_transaction_to_documents_with_review(uuid, jsonb, text)
IS 'Atomowo dopasowuje dokumenty i oznacza je jako wymagajace dodatkowego wyjasnienia.';

COMMIT;
