BEGIN;

-- Świadoma zgoda na wysłanie pozostałych dokumentów bez brakującego dokumentu
-- kosztowego. Ta lista nie jest rozliczeniem przelewu ani potwierdzeniem wysyłki.
CREATE TABLE public.accounting_document_followups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  my_company_id uuid NOT NULL REFERENCES public.my_companies(id) ON DELETE CASCADE,
  bank_transaction_id uuid NOT NULL UNIQUE
    REFERENCES public.bank_transactions(id) ON DELETE CASCADE,
  period_month integer NOT NULL CHECK (period_month BETWEEN 1 AND 12),
  period_year integer NOT NULL CHECK (period_year BETWEEN 2000 AND 2100),
  acknowledged_by uuid NOT NULL REFERENCES auth.users(id),
  acknowledged_at timestamptz NOT NULL DEFAULT now(),
  transaction_snapshot jsonb NOT NULL CHECK (jsonb_typeof(transaction_snapshot) = 'object'),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX accounting_document_followups_company_period_idx
  ON public.accounting_document_followups(my_company_id, active, period_year, period_month);

COMMENT ON TABLE public.accounting_document_followups IS
  'Brakujące dokumenty do późniejszego dosłania, wskazane świadomie przez użytkownika. Nie oznacza dopasowania, rozliczenia ani dostarczenia do księgowej.';
COMMENT ON COLUMN public.accounting_document_followups.transaction_snapshot IS
  'Dane przelewu w chwili potwierdzenia; zmiana danych wymaga ponownej świadomej akceptacji przed wysyłką. Bez numeru rachunku kontrahenta.';
COMMENT ON COLUMN public.accounting_document_followups.active IS
  'Aktywna pozycja listy do późniejszego dosłania. Wycofanie nie oznacza wysłania dokumentu. Późniejsze dopasowanie nie usuwa pozycji automatycznie.';

ALTER TABLE public.accounting_document_followups ENABLE ROW LEVEL SECURITY;
CREATE POLICY accounting_document_followups_read
  ON public.accounting_document_followups FOR SELECT TO authenticated
  USING (public.finance_can_view() AND public.finance_company_visible(my_company_id));

REVOKE ALL ON public.accounting_document_followups FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.accounting_document_followups TO authenticated;

CREATE OR REPLACE FUNCTION public.acknowledge_accounting_document_followup(
  p_bank_transaction_id uuid,
  p_acknowledged boolean,
  p_expected_snapshot jsonb DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_bank public.bank_transactions%ROWTYPE;
  v_entry public.accounting_document_followups%ROWTYPE;
  v_company_id uuid;
  v_month integer;
  v_year integer;
  v_category text;
  v_subtype text;
  v_statement_only boolean;
  v_snapshot jsonb;
BEGIN
  IF auth.uid() IS NULL OR public.finance_can_manage() IS NOT TRUE THEN
    RAISE EXCEPTION 'Brak uprawnień do potwierdzania brakujących dokumentów';
  END IF;
  IF p_bank_transaction_id IS NULL OR p_acknowledged IS NULL THEN
    RAISE EXCEPTION 'Wskaż przelew i jednoznaczną decyzję o brakującym dokumencie';
  END IF;

  -- Ten sam blokowany rekord jest używany przez uzgadnianie bankowe: nie można
  -- potwierdzić starego stanu, gdy równocześnie zapisywane jest dopasowanie.
  SELECT bt.* INTO v_bank
  FROM public.bank_transactions bt
  JOIN public.bank_statements bs ON bs.id = bt.statement_id
  WHERE bt.id = p_bank_transaction_id
    AND public.finance_company_visible(bs.my_company_id)
  FOR UPDATE OF bt;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Nie znaleziono przelewu lub brak dostępu do jego działalności';
  END IF;

  SELECT bs.my_company_id, bs.statement_month, bs.statement_year
  INTO v_company_id, v_month, v_year
  FROM public.bank_statements bs
  WHERE bs.id = v_bank.statement_id
  FOR SHARE;
  IF NOT FOUND OR v_company_id IS NULL
    OR public.finance_company_visible(v_company_id) IS NOT TRUE THEN
    RAISE EXCEPTION 'Brak dostępu do działalności tego wyciągu';
  END IF;

  SELECT * INTO v_entry
  FROM public.accounting_document_followups
  WHERE bank_transaction_id = p_bank_transaction_id
  FOR UPDATE;
  IF FOUND AND public.finance_company_visible(v_entry.my_company_id) IS NOT TRUE THEN
    RAISE EXCEPTION 'Brak dostępu do zapisanej pozycji brakujących dokumentów';
  END IF;

  -- Wycofanie pozostaje dostępne również po późniejszym dopasowaniu przelewu.
  -- Nie tworzymy pozycji dla decyzji "nie" i nie oznaczamy dokumentu jako wysłany.
  IF NOT p_acknowledged THEN
    IF v_entry.id IS NULL THEN RETURN NULL; END IF;
    UPDATE public.accounting_document_followups
    SET active = false, updated_at = now()
    WHERE id = v_entry.id
    RETURNING * INTO v_entry;
    RETURN to_jsonb(v_entry);
  END IF;

  IF v_bank.transaction_type IS DISTINCT FROM 'debit'
    OR GREATEST(0, ABS(COALESCE(v_bank.amount, 0)) - COALESCE(v_bank.allocated_amount, 0)) <= 0.01 THEN
    RAISE EXCEPTION 'Na listę do dosłania można dodać tylko nierozliczony wydatek';
  END IF;
  IF v_bank.matched_invoice_id IS NOT NULL
    OR COALESCE(v_bank.matched_document_count, 0) > 0
    OR COALESCE(v_bank.allocated_amount, 0) > 0.01
    OR EXISTS (
      SELECT 1 FROM public.bank_transaction_invoice_matches bm
      WHERE bm.bank_transaction_id = p_bank_transaction_id
    )
    OR EXISTS (
      SELECT 1 FROM public.personnel_contract_payments pp
      WHERE pp.bank_transaction_id = p_bank_transaction_id
    ) THEN
    RAISE EXCEPTION 'Ten przelew ma już powiązanie z dokumentem lub wypłatą. Odśwież kontrolę przed wysyłką';
  END IF;

  v_category := btrim(COALESCE(v_bank.accounting_category, ''));
  v_subtype := btrim(COALESCE(v_bank.accounting_subtype, ''));
  -- Jak w kontroli Saldeo: zapisana kategoria ma pierwszeństwo przed starym
  -- podtypem. Nie rozpoznajemy podatku z samego słowa "VAT" w tytule faktury.
  v_statement_only := v_category = 'tax_or_zus'
    OR (v_subtype = 'automatic_vat_transfer' AND v_category IN ('', 'own_transfer'))
    OR (v_category = '' AND v_subtype IN ('vat7_payment', 'pit4_payment', 'zus_payment'));
  IF COALESCE(v_bank.private_transfer_detected, false) OR v_statement_only THEN
    RAISE EXCEPTION 'Operacje prywatne oraz zapisane transfery VAT, VAT, PIT i ZUS nie wymagają osobnego dokumentu do Saldeo';
  END IF;

  -- Jawna lista pól: nie zapisujemy całego rekordu, rachunku kontrahenta,
  -- zawartości wyciągu ani dodatkowych danych z rejestru kadrowego.
  v_snapshot := jsonb_build_object(
    'statement_id', v_bank.statement_id,
    'amount', v_bank.amount,
    'currency', v_bank.currency,
    'transaction_type', v_bank.transaction_type,
    'transaction_date', v_bank.transaction_date,
    'posting_date', v_bank.posting_date,
    'allocated_amount', v_bank.allocated_amount,
    'matched_document_count', v_bank.matched_document_count,
    'matched_invoice_id', v_bank.matched_invoice_id,
    'counterparty_name', v_bank.counterparty_name,
    'title', v_bank.title,
    'raw_description', to_jsonb(v_bank)->'raw_description',
    'reference_number', v_bank.reference_number,
    'accounting_note', v_bank.accounting_note,
    'accounting_category', v_bank.accounting_category,
    'accounting_subtype', v_bank.accounting_subtype,
    'accounting_review_status', v_bank.accounting_review_status,
    'private_transfer_detected', v_bank.private_transfer_detected
  );

  IF p_expected_snapshot IS NULL OR p_expected_snapshot IS DISTINCT FROM v_snapshot THEN
    RAISE EXCEPTION 'Dane przelewu zmieniły się od otwarcia kontroli. Odśwież listę i ponownie potwierdź brak dokumentu';
  END IF;

  INSERT INTO public.accounting_document_followups (
    my_company_id, bank_transaction_id, period_month, period_year,
    acknowledged_by, acknowledged_at, transaction_snapshot, active
  ) VALUES (
    v_company_id, p_bank_transaction_id, v_month, v_year,
    auth.uid(), now(), v_snapshot, true
  )
  ON CONFLICT (bank_transaction_id) DO UPDATE SET
    my_company_id = EXCLUDED.my_company_id,
    period_month = EXCLUDED.period_month,
    period_year = EXCLUDED.period_year,
    acknowledged_by = EXCLUDED.acknowledged_by,
    acknowledged_at = EXCLUDED.acknowledged_at,
    transaction_snapshot = EXCLUDED.transaction_snapshot,
    active = true,
    updated_at = now()
  RETURNING * INTO v_entry;

  RETURN to_jsonb(v_entry);
END;
$$;

REVOKE ALL ON FUNCTION public.acknowledge_accounting_document_followup(uuid, boolean, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.acknowledge_accounting_document_followup(uuid, boolean, jsonb)
  TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
