/*
  # Atomowe dopasowanie jednego przelewu do wielu dokumentow

  Wszystkie wybrane dokumenty sa rozliczane w jednej transakcji bazodanowej.
  Blad dowolnej pozycji wycofuje caly zestaw.
*/

CREATE OR REPLACE FUNCTION public.match_bank_transaction_to_documents(
  p_transaction_id uuid,
  p_documents jsonb
)
RETURNS SETOF public.bank_transaction_invoice_matches
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_item jsonb;
  v_source text;
  v_document_id uuid;
  v_amount numeric(14,2);
  v_ksef_payment_status text;
  v_result public.bank_transaction_invoice_matches%ROWTYPE;
BEGIN
  IF p_documents IS NULL
    OR jsonb_typeof(p_documents) <> 'array'
    OR jsonb_array_length(p_documents) < 1
    OR jsonb_array_length(p_documents) > 20
  THEN
    RAISE EXCEPTION 'Wybierz od 1 do 20 dokumentow';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (
      SELECT item->>'source' AS source, item->>'documentId' AS document_id, COUNT(*) AS item_count
      FROM jsonb_array_elements(p_documents) AS items(item)
      GROUP BY item->>'source', item->>'documentId'
    ) duplicates
    WHERE duplicates.item_count > 1
  ) THEN
    RAISE EXCEPTION 'Ten sam dokument zostal wybrany wiecej niz raz';
  END IF;

  PERFORM 1
  FROM public.bank_transactions
  WHERE id = p_transaction_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Nie znaleziono transakcji'; END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_documents)
  LOOP
    v_source := v_item->>'source';
    IF v_source NOT IN ('invoice', 'ksef', 'external') THEN
      RAISE EXCEPTION 'Nieobslugiwane zrodlo dokumentu';
    END IF;

    BEGIN
      v_document_id := (v_item->>'documentId')::uuid;
      v_amount := ROUND((v_item->>'amount')::numeric, 2);
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'Nieprawidlowe dane wybranego dokumentu';
    END;
    IF v_amount <= 0 THEN RAISE EXCEPTION 'Kwota dokumentu musi byc dodatnia'; END IF;

    IF v_source = 'ksef' THEN
      SELECT payment_status
      INTO v_ksef_payment_status
      FROM public.ksef_invoices
      WHERE id = v_document_id;

      IF v_ksef_payment_status = 'paid' THEN
        SELECT *
        INTO v_result
        FROM public.reconcile_paid_ksef_invoice_with_bank_transaction(
          p_transaction_id,
          v_document_id,
          v_amount,
          1,
          ARRAY['Zbiorcze dopasowanie zatwierdzone przez uzytkownika']
        );
      ELSE
        SELECT *
        INTO v_result
        FROM public.match_bank_transaction_to_document(
          p_transaction_id,
          v_source,
          v_document_id,
          v_amount,
          1,
          'manual',
          ARRAY['Zbiorcze dopasowanie zatwierdzone przez uzytkownika']
        );
      END IF;
    ELSE
      SELECT *
      INTO v_result
      FROM public.match_bank_transaction_to_document(
        p_transaction_id,
        v_source,
        v_document_id,
        v_amount,
        1,
        'manual',
        ARRAY['Zbiorcze dopasowanie zatwierdzone przez uzytkownika']
      );
    END IF;

    RETURN NEXT v_result;
  END LOOP;

  RETURN;
END;
$$;

REVOKE ALL ON FUNCTION public.match_bank_transaction_to_documents(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.match_bank_transaction_to_documents(uuid, jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.match_bank_transaction_to_documents(uuid, jsonb)
IS 'Atomowo dopasowuje jedna transakcje bankowa do wielu wybranych dokumentow.';
