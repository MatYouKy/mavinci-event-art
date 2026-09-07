BEGIN;

CREATE OR REPLACE FUNCTION public.get_bank_transaction_document_picker_items(
  p_transaction_id uuid
)
RETURNS TABLE (
  document_source text,
  document_id uuid,
  document_number text,
  gross_amount numeric,
  outstanding_amount numeric,
  issue_date date,
  due_date date,
  counterparty_name text,
  currency text,
  payment_status text,
  payment_method text,
  is_matched boolean,
  is_matchable boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_company_id uuid;
  v_direction text;
  v_can_view_personnel boolean;
BEGIN
  SELECT bs.my_company_id, bt.transaction_type
  INTO v_company_id, v_direction
  FROM public.bank_transactions bt
  JOIN public.bank_statements bs ON bs.id = bt.statement_id
  WHERE bt.id = p_transaction_id;

  IF NOT FOUND OR v_company_id IS NULL THEN RETURN; END IF;
  IF auth.role() <> 'service_role' AND NOT (
    public.finance_can_view() AND public.finance_company_visible(v_company_id)
  ) THEN RETURN; END IF;

  v_can_view_personnel := auth.role() = 'service_role'
    OR public.can_view_personnel_contracts();

  RETURN QUERY
  WITH documents AS (
    SELECT
      'invoice'::text AS source,
      i.id,
      i.invoice_number::text AS number,
      ABS(public.bank_document_due_amount(i.id, NULL, NULL))::numeric AS gross,
      GREATEST(
        ABS(public.bank_document_due_amount(i.id, NULL, NULL)) - COALESCE(i.paid_amount, 0),
        0
      )::numeric AS outstanding,
      i.issue_date,
      i.payment_due_date AS due,
      i.buyer_name::text AS counterparty,
      UPPER(COALESCE(i.currency_code, 'PLN'))::text AS document_currency,
      COALESCE(i.payment_status::text, i.status::text, 'unpaid') AS status,
      i.payment_method::text AS method,
      EXISTS (
        SELECT 1 FROM public.bank_transaction_invoice_matches match
        WHERE match.invoice_id = i.id
      ) AS matched,
      (
        COALESCE(i.paid_amount, 0) < ABS(public.bank_document_due_amount(i.id, NULL, NULL)) - 0.01
        AND NOT EXISTS (
          SELECT 1 FROM public.bank_transaction_invoice_matches match
          WHERE match.invoice_id = i.id
        )
      ) AS matchable,
      CASE
        WHEN i.invoice_type = 'corrective' AND COALESCE(i.total_gross, 0) < 0 THEN 'debit'
        ELSE 'credit'
      END::text AS direction
    FROM public.invoices i
    WHERE i.my_company_id = v_company_id
      AND i.status NOT IN ('draft', 'cancelled', 'proforma')
      AND i.invoice_type <> 'proforma'
      AND NOT EXISTS (
        SELECT 1 FROM public.ksef_invoices ki
        WHERE ki.invoice_id = i.id
          AND NULLIF(ki.ksef_reference_number, '') IS NOT NULL
      )

    UNION ALL

    SELECT
      'ksef'::text,
      ki.id,
      COALESCE(ki.invoice_number, ki.ksef_reference_number, 'bez numeru')::text,
      ABS(public.bank_document_due_amount(NULL, ki.id, NULL))::numeric,
      GREATEST(
        ABS(public.bank_document_due_amount(NULL, ki.id, NULL))
          - COALESCE((
            SELECT SUM(payment.amount)
            FROM public.ksef_invoice_payments payment
            WHERE payment.ksef_invoice_id = ki.id
          ), 0),
        0
      )::numeric,
      ki.issue_date,
      ki.payment_due_date,
      CASE WHEN ki.invoice_type::text = 'issued' THEN ki.buyer_name ELSE ki.seller_name END,
      UPPER(COALESCE(ki.currency, 'PLN'))::text,
      COALESCE(ki.payment_status, 'unpaid')::text,
      ki.payment_method::text,
      EXISTS (
        SELECT 1 FROM public.bank_transaction_invoice_matches match
        WHERE match.ksef_invoice_id = ki.id
      ),
      (
        NOT EXISTS (
          SELECT 1 FROM public.bank_transaction_invoice_matches match
          WHERE match.ksef_invoice_id = ki.id
        )
        AND (
          ki.payment_status = 'paid'
          OR ABS(public.bank_document_due_amount(NULL, ki.id, NULL))
            - COALESCE((
              SELECT SUM(payment.amount)
              FROM public.ksef_invoice_payments payment
              WHERE payment.ksef_invoice_id = ki.id
            ), 0) > 0.01
        )
      ),
      CASE
        WHEN ki.invoice_type::text = 'issued'
          AND COALESCE(ki.amount_to_pay_gross, ki.gross_amount, 0) >= 0 THEN 'credit'
        WHEN ki.invoice_type::text = 'issued' THEN 'debit'
        WHEN COALESCE(ki.amount_to_pay_gross, ki.gross_amount, 0) >= 0 THEN 'debit'
        ELSE 'credit'
      END::text
    FROM public.ksef_invoices ki
    WHERE ki.my_company_id = v_company_id
      AND ki.sync_status::text <> 'error'

    UNION ALL

    SELECT
      'external'::text,
      ei.id,
      COALESCE(ei.invoice_number, 'bez numeru')::text,
      ABS(public.bank_document_due_amount(NULL, NULL, ei.id))::numeric,
      GREATEST(
        ABS(public.bank_document_due_amount(NULL, NULL, ei.id)) - COALESCE(ei.paid_amount, 0),
        0
      )::numeric,
      ei.invoice_date,
      NULL::date,
      ei.seller_name::text,
      UPPER(COALESCE(ei.currency, 'PLN'))::text,
      COALESCE(ei.payment_status, 'unpaid')::text,
      ei.payment_method::text,
      EXISTS (
        SELECT 1 FROM public.bank_transaction_invoice_matches match
        WHERE match.external_invoice_id = ei.id
      ),
      (
        NOT EXISTS (
          SELECT 1 FROM public.bank_transaction_invoice_matches match
          WHERE match.external_invoice_id = ei.id
        )
        AND (
          ei.payment_status = 'paid'
          OR COALESCE(ei.paid_amount, 0) < ABS(public.bank_document_due_amount(NULL, NULL, ei.id)) - 0.01
        )
      ),
      CASE WHEN COALESCE(ei.amount_gross, 0) >= 0 THEN 'debit' ELSE 'credit' END::text
    FROM public.external_invoices ei
    WHERE (ei.my_company_id = v_company_id OR ei.my_company_id IS NULL)
      AND ei.payment_status <> 'cancelled'

    UNION ALL

    SELECT
      'personnel'::text,
      payment.id,
      CONCAT(
        COALESCE(contract.contract_number, 'Umowa bez numeru'),
        ' · ',
        CASE payment.payment_type
          WHEN 'salary' THEN 'Wynagrodzenie'
          WHEN 'advance' THEN 'Zaliczka'
          WHEN 'tax' THEN 'Podatek'
          WHEN 'zus' THEN 'ZUS'
          WHEN 'reimbursement' THEN 'Zwrot kosztów'
          ELSE 'Inna opłata'
        END
      )::text,
      ABS(payment.amount)::numeric,
      CASE WHEN payment.bank_transaction_id IS NULL THEN ABS(payment.amount) ELSE 0 END::numeric,
      payment.payment_date,
      payment.payment_date,
      COALESCE(payment.recipient_name, contract.party_name)::text,
      UPPER(COALESCE(payment.currency, 'PLN'))::text,
      CASE WHEN payment.bank_transaction_id IS NULL THEN 'unpaid' ELSE 'paid' END::text,
      'bank_transfer'::text,
      payment.bank_transaction_id IS NOT NULL,
      payment.bank_transaction_id IS NULL,
      'debit'::text
    FROM public.personnel_contract_payments payment
    JOIN public.personnel_contracts contract ON contract.id = payment.personnel_contract_id
    WHERE v_can_view_personnel
      AND (contract.my_company_id = v_company_id OR contract.my_company_id IS NULL)
  )
  SELECT
    document.source,
    document.id,
    document.number,
    document.gross,
    document.outstanding,
    document.issue_date,
    document.due,
    document.counterparty,
    document.document_currency,
    document.status,
    document.method,
    document.matched,
    document.matchable
  FROM documents document
  WHERE document.direction = v_direction
  ORDER BY document.issue_date DESC NULLS LAST, document.number;
END;
$$;

REVOKE ALL ON FUNCTION public.get_bank_transaction_document_picker_items(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_bank_transaction_document_picker_items(uuid)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.get_bank_transaction_document_picker_items(uuid) IS
  'Pelna lista dokumentow zgodnych z dzialalnoscia i kierunkiem wybranej transakcji, uzywana przez reczny selektor z filtrami.';

NOTIFY pgrst, 'reload schema';

COMMIT;
