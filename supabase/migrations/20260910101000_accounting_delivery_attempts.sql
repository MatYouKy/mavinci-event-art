BEGIN;

CREATE TABLE IF NOT EXISTS public.accounting_delivery_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  my_company_id uuid NOT NULL REFERENCES public.my_companies(id),
  recipient text NOT NULL,
  delivery_key text NOT NULL,
  delivery_kind text NOT NULL CHECK (delivery_kind IN ('saldeo_document', 'accountant_report')),
  status text NOT NULL DEFAULT 'sending' CHECK (status IN ('sending', 'sent', 'uncertain')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  sent_by uuid NOT NULL DEFAULT auth.uid(),
  email_message_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (my_company_id, recipient, delivery_key)
);
ALTER TABLE public.accounting_delivery_attempts ENABLE ROW LEVEL SECURITY;
CREATE POLICY accounting_delivery_attempts_read ON public.accounting_delivery_attempts
  FOR SELECT TO authenticated USING (public.finance_can_view() AND public.finance_company_visible(my_company_id));
REVOKE ALL ON public.accounting_delivery_attempts FROM anon, authenticated;
GRANT SELECT ON public.accounting_delivery_attempts TO authenticated;

-- Rezerwacja poprzedza SMTP. Po utracie odpowiedzi nie ma automatycznego retry.
-- Klucz pliku oznacza dokument, nie paczkę ani hash zmiennej adnotacji.
CREATE OR REPLACE FUNCTION public.claim_accounting_delivery(
  p_company_id uuid, p_recipient text, p_items jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_item jsonb;
  v_recipient text := lower(trim(p_recipient));
  v_key text;
  v_kind text;
  v_existing public.accounting_delivery_attempts%ROWTYPE;
  v_id uuid;
  v_claimed jsonb := '[]'::jsonb;
  v_sent jsonb := '[]'::jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.finance_can_manage() OR NOT public.finance_company_visible(p_company_id) THEN
    RAISE EXCEPTION 'Brak uprawnień do przekazania dokumentów tej działalności';
  END IF;
  IF v_recipient IS NULL OR v_recipient !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 50 THEN
    RAISE EXCEPTION 'Nieprawidłowy odbiorca lub zakres rezerwacji';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_company_id::text || ':' || v_recipient, 0));
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    v_kind := v_item->>'kind';
    v_key := v_item->>'key';
    IF v_kind NOT IN ('saldeo_document', 'accountant_report') OR v_key IS NULL OR length(v_key) > 200
      OR coalesce((v_item->'metadata'->>'period_month')::integer, 0) NOT BETWEEN 1 AND 12
      OR coalesce((v_item->'metadata'->>'period_year')::integer, 0) NOT BETWEEN 2000 AND 2100 THEN
      RAISE EXCEPTION 'Nieprawidłowe dane rezerwacji wysyłki';
    END IF;
    IF v_kind = 'saldeo_document' THEN
      IF v_item->'metadata'->>'source_type' NOT IN ('external_invoice', 'local_invoice', 'bank_supporting_document')
        OR v_item->'metadata'->>'saldeo_document_type' NOT IN ('FK', 'DS', 'P')
        OR v_key <> 'file:' || (v_item->'metadata'->>'source_type') || ':' || ((v_item->'metadata'->>'source_id')::uuid)::text THEN
        RAISE EXCEPTION 'Nieprawidłowy klucz dokumentu';
      END IF;
      IF EXISTS (SELECT 1 FROM public.saldeo_delivery_log l WHERE l.my_company_id = p_company_id
        AND l.source_type = v_item->'metadata'->>'source_type' AND l.source_id = (v_item->'metadata'->>'source_id')::uuid) THEN
        v_sent := v_sent || jsonb_build_array(v_key);
        CONTINUE;
      END IF;
    ELSIF v_key !~ '^report:[a-f0-9]{64}$' THEN
      RAISE EXCEPTION 'Nieprawidłowy klucz raportu';
    END IF;
    SELECT * INTO v_existing FROM public.accounting_delivery_attempts
      WHERE my_company_id = p_company_id AND recipient = v_recipient AND delivery_key = v_key FOR UPDATE;
    IF FOUND THEN
      IF v_existing.status = 'sent' THEN
        v_sent := v_sent || jsonb_build_array(v_key);
        CONTINUE;
      END IF;
      RAISE EXCEPTION 'Wysyłka % ma niepotwierdzony wynik. Sprawdź historię poczty i odbiór w Saldeo przed ponowną wysyłką.', v_key;
    END IF;
    INSERT INTO public.accounting_delivery_attempts (my_company_id, recipient, delivery_key, delivery_kind, metadata, sent_by)
      VALUES (p_company_id, v_recipient, v_key, v_kind, v_item->'metadata', auth.uid()) RETURNING id INTO v_id;
    v_claimed := v_claimed || jsonb_build_array(jsonb_build_object('id', v_id, 'key', v_key));
  END LOOP;
  RETURN jsonb_build_object('claimed', v_claimed, 'already_sent', v_sent);
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_accounting_delivery(
  p_attempt_ids uuid[], p_status text, p_email_message_id text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_row public.accounting_delivery_attempts%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NOT public.finance_can_manage() OR p_status NOT IN ('sent', 'uncertain')
    OR coalesce(array_length(p_attempt_ids, 1), 0) NOT BETWEEN 1 AND 50 THEN
    RAISE EXCEPTION 'Nieprawidłowe zakończenie wysyłki';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(p_attempt_ids) AS requested(id) WHERE NOT EXISTS (
    SELECT 1 FROM public.accounting_delivery_attempts a WHERE a.id = requested.id AND a.sent_by = auth.uid()
      AND public.finance_company_visible(a.my_company_id))) THEN
    RAISE EXCEPTION 'Brak uprawnień do rezerwacji wysyłki';
  END IF;
  FOR v_row IN SELECT * FROM public.accounting_delivery_attempts WHERE id = ANY(p_attempt_ids) ORDER BY id FOR UPDATE LOOP
    IF v_row.status = 'sent' THEN CONTINUE; END IF;
    IF v_row.status <> 'sending' THEN RAISE EXCEPTION 'Niepewna wysyłka wymaga ręcznego sprawdzenia'; END IF;
    IF p_status = 'sent' AND v_row.delivery_kind = 'saldeo_document' THEN
      INSERT INTO public.saldeo_delivery_log (my_company_id, period_month, period_year, source_type, source_id,
        saldeo_document_type, delivered_to, email_message_id, original_file_name, sent_by)
      VALUES (v_row.my_company_id, (v_row.metadata->>'period_month')::integer, (v_row.metadata->>'period_year')::integer,
        v_row.metadata->>'source_type', (v_row.metadata->>'source_id')::uuid, v_row.metadata->>'saldeo_document_type',
        v_row.recipient, p_email_message_id, v_row.metadata->>'filename', auth.uid());
    ELSIF p_status = 'sent' THEN
      INSERT INTO public.accounting_month_handoffs (my_company_id, period_month, period_year, delivered_to, email_message_id,
        transaction_count, statement_count, matched_relation_count, saldeo_document_count, unresolved_count, snapshot, sent_by)
      VALUES (v_row.my_company_id, (v_row.metadata->>'period_month')::integer, (v_row.metadata->>'period_year')::integer,
        v_row.recipient, p_email_message_id, (v_row.metadata->>'transaction_count')::integer, (v_row.metadata->>'statement_count')::integer,
        (v_row.metadata->>'matched_relation_count')::integer, (v_row.metadata->>'saldeo_document_count')::integer,
        (v_row.metadata->>'unresolved_count')::integer, coalesce(v_row.metadata->'snapshot', '{}'::jsonb), auth.uid());
    END IF;
    UPDATE public.accounting_delivery_attempts SET status = p_status, email_message_id = p_email_message_id, updated_at = now() WHERE id = v_row.id;
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_accounting_delivery(uuid, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_accounting_delivery(uuid[], text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_accounting_delivery(uuid, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_accounting_delivery(uuid[], text, text) TO authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
