-- Uzgadnianie wyciągów: szczegóły dokumentów przy propozycjach i rozliczeniach (2026-11-01).
--
-- Po zgłoszeniu z pracy na wyciągach: przy kilku dokumentach o tej samej kwocie brakowało danych, żeby wybrać
-- właściwy (np. zaliczka 50% i faktura końcowa na tę samą kwotę), a przy częściowej płatności nie było widać,
-- ile z faktury zostało do zapłaty.
--
-- get_bank_reconciliation_month (ta sama sygnatura i uprawnienia):
--  * dokumenty w propozycjach: data wystawienia, termin płatności, rodzaj faktury (zaliczkowa / rozliczeniowa /
--    korekta / zwykła — z XML KSeF, typu faktury CRM albo rodzaju dokumentu spoza KSeF), stan płatności
--    (zapłacono z wyciągu / ręcznie, data ręcznej płatności);
--  * przy wyborze spośród kilku dokumentów: wskazanie dokumentu oznaczonego ręcznie jako opłacony w dniu przelewu
--    na tę samą kwotę (gdy jest dokładnie jeden taki) i informacja, że dokument wystawiono po dacie przelewu.
--    To tylko podpowiedź — wybór nadal zatwierdza użytkownik; kolejność dokumentów się nie zmienia (wybór po indeksie);
--  * rozliczenia operacji: stan dokumentu po wszystkich płatnościach (należność, zapłacono, pozostało, status),
--    daty i rodzaj — widać częściową płatność faktury.
-- private.bank_document_kind(source, id) — rodzaj dokumentu (kod KSeF RodzajFaktury, typ faktury CRM, rodzaj
-- dokumentu spoza KSeF); wołana tylko z funkcji serwera.
-- Plik można bezpiecznie uruchomić ponownie.
BEGIN;

CREATE OR REPLACE FUNCTION private.bank_document_kind(p_source text, p_id uuid)
RETURNS text LANGUAGE sql STABLE SET search_path = pg_catalog, public AS $kind$
  SELECT CASE p_source
    WHEN 'ksef' THEN (SELECT substring(k.xml_content FROM '<(?:[A-Za-z0-9_]+:)?RodzajFaktury>\s*([A-Z_]+)\s*<')
                      FROM public.ksef_invoices k WHERE k.id = p_id)
    WHEN 'invoice' THEN (SELECT i.invoice_type::text FROM public.invoices i WHERE i.id = p_id)
    WHEN 'external' THEN (SELECT e.document_kind FROM public.external_invoices e WHERE e.id = p_id)
  END;
$kind$;
REVOKE ALL ON FUNCTION private.bank_document_kind(text, uuid) FROM PUBLIC, anon, authenticated;
-- Wykonuje ją właściciel funkcji SECURITY DEFINER get_bank_reconciliation_month (w produkcji ten sam, który uruchamia migrację).
DO $grant$
BEGIN
  EXECUTE format('GRANT EXECUTE ON FUNCTION private.bank_document_kind(text, uuid) TO %I',
    (SELECT pg_get_userbyid(p.proowner) FROM pg_proc p WHERE p.oid = 'public.get_bank_reconciliation_month(uuid,integer,integer)'::regprocedure));
END $grant$;

CREATE OR REPLACE FUNCTION public.get_bank_reconciliation_month(p_company_id uuid, p_year integer, p_month integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_result jsonb;
  v_from date := make_date(p_year, p_month, 1);
  v_to date := (make_date(p_year, p_month, 1) + interval '1 month - 1 day')::date;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND NOT (public.finance_can_view() AND public.finance_company_visible(p_company_id)) THEN
    RAISE EXCEPTION 'Brak uprawnień do podglądu wyciągów.' USING ERRCODE = '42501';
  END IF;

  WITH st AS (
    SELECT s.* FROM public.bank_statements s
    WHERE s.my_company_id = p_company_id AND s.statement_year = p_year AND s.statement_month = p_month
      AND s.processed AND s.validation_status = 'valid'
  ), tx AS (
    SELECT t.*, CASE WHEN st.account_type = 'vat' THEN 'vat' ELSE 'regular' END AS account_kind,
           private.bank_transaction_allocated(t.id) AS alloc
    FROM public.bank_transactions t JOIN st ON st.id = t.statement_id
    WHERE t.canonical_transaction_id IS NULL
  ), rows AS (
    SELECT tx.*, pr.id AS proposal_id, pr.kind AS proposal_kind,
      CASE
        WHEN tx.paired_bank_transaction_id IS NOT NULL OR tx.private_transfer_detected
             OR (tx.accounting_review_status = 'explained' AND tx.accounting_category = 'own_transfer') THEN 'transfer'
        WHEN tx.alloc >= abs(tx.amount) - 0.01 THEN 'matched'
        WHEN tx.accounting_review_status = 'explained' AND pr.kind IN ('allocate', 'choose') THEN CASE WHEN pr.kind = 'allocate' THEN 'proposal' ELSE 'choice' END
        WHEN tx.accounting_review_status = 'explained' THEN 'explained'
        WHEN pr.kind = 'allocate' THEN 'proposal'
        WHEN pr.kind = 'choose' THEN 'choice'
        WHEN tx.alloc > 0.009 THEN 'partial'
        ELSE 'missing'
      END AS status,
      to_jsonb(pr) AS proposal
    FROM tx
    LEFT JOIN public.bank_reconciliation_proposals pr ON pr.bank_transaction_id = tx.id AND pr.status = 'open'
  ), docs AS (
    SELECT * FROM private.bank_reconciliation_documents(p_company_id)
  )
  SELECT jsonb_build_object(
    'company_id', p_company_id, 'year', p_year, 'month', p_month,
    'sources', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', st.id, 'kind', CASE WHEN st.account_type = 'vat' THEN 'vat' ELSE 'regular' END,
        'format', coalesce(st.import_format, st.file_type), 'file_name', st.file_name,
        'transactions_count', (SELECT count(*) FROM public.bank_transactions x WHERE x.statement_id = st.id),
        'opening_balance', st.opening_balance, 'closing_balance', st.closing_balance,
        'confirmed', (SELECT count(*) FROM public.bank_transactions x WHERE x.statement_id = st.id AND x.source_confirmation = 'confirmed'),
        'unconfirmed', (SELECT count(*) FROM public.bank_transactions x WHERE x.statement_id = st.id AND x.source_confirmation = 'unconfirmed'),
        'created_at', st.created_at) ORDER BY st.account_type, st.import_format)
      FROM st), '[]'::jsonb),
    'last_run', (SELECT to_jsonb(r) FROM public.bank_reconciliation_runs r
                 WHERE r.my_company_id = p_company_id AND r.statement_year = p_year AND r.statement_month = p_month
                 ORDER BY r.created_at DESC LIMIT 1),
    'transactions', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', r.id, 'statement_id', r.statement_id, 'date', r.transaction_date, 'amount', abs(r.amount),
        'direction', r.transaction_type, 'currency', coalesce(r.currency, 'PLN'),
        'counterparty', coalesce(nullif(btrim(r.counterparty_name), ''), r.raw_counterparty),
        'counterparty_account', r.counterparty_account, 'title', r.title,
        'source_description', (SELECT string_agg(nullif(concat_ws(' · ', nullif(btrim(c.title), ''), nullif(btrim(c.counterparty_name), '')), ''), ' | ')
                               FROM public.bank_transactions c WHERE c.canonical_transaction_id = r.id),
        'account_kind', r.account_kind, 'source_confirmation', r.source_confirmation,
        'allocated', round(r.alloc, 2), 'remaining', round(greatest(abs(r.amount) - r.alloc, 0), 2),
        'status', r.status,
        'allocations', coalesce((
          SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
            'match_id', m.id, 'source', m.document_source,
            'document_id', coalesce(m.ksef_invoice_id, m.invoice_id, m.external_invoice_id),
            'number', coalesce(k.invoice_number, i.invoice_number, e.invoice_number),
            'party', coalesce(CASE WHEN k.invoice_type::text = 'issued' THEN k.buyer_name ELSE k.seller_name END, i.buyer_name, e.seller_name),
            'amount', m.amount, 'method', m.match_method, 'reasons', m.match_reasons, 'created_at', m.created_at,
            'document_amount', CASE WHEN upper(coalesce(m.document_currency, m.currency)) <> upper(m.currency) THEN m.document_amount END,
            'document_currency', CASE WHEN upper(coalesce(m.document_currency, m.currency)) <> upper(m.currency) THEN upper(m.document_currency) END,
            'exchange_rate', CASE WHEN upper(coalesce(m.document_currency, m.currency)) <> upper(m.currency) THEN m.exchange_rate END,
            'doc_kind', private.bank_document_kind(m.document_source, coalesce(m.ksef_invoice_id, m.invoice_id, m.external_invoice_id)),
            'issue_date', x.issue_date, 'due_date', x.due_date,
            'doc_due', round(x.due, 2), 'doc_paid', round(x.bank_paid + x.manual_paid, 2),
            'doc_open', round(greatest(x.due - x.bank_paid - x.manual_paid, 0), 2),
            'doc_manual', CASE WHEN x.manual_paid > 0.009 THEN round(x.manual_paid, 2) END,
            'doc_status', x.payment_status))
            ORDER BY m.created_at)
          FROM public.bank_transaction_invoice_matches m
          LEFT JOIN public.ksef_invoices k ON k.id = m.ksef_invoice_id
          LEFT JOIN public.invoices i ON i.id = m.invoice_id
          LEFT JOIN public.external_invoices e ON e.id = m.external_invoice_id
          LEFT JOIN docs x ON x.source = m.document_source
                          AND x.document_id = coalesce(m.ksef_invoice_id, m.invoice_id, m.external_invoice_id)
          WHERE m.bank_transaction_id = r.id), '[]'::jsonb),
        'personnel', coalesce((
          SELECT jsonb_agg(jsonb_build_object('id', p.id, 'recipient', p.recipient_name, 'amount', p.amount, 'title', p.title,
            'payment_type', p.payment_type, 'payment_date', p.payment_date, 'contract_id', pc.id, 'contract_number', pc.contract_number,
            'contract_kind', pc.contract_kind, 'method', coalesce(p.bank_match_method, 'manual'), 'reasons', p.bank_match_reasons))
          FROM public.personnel_contract_payments p
          LEFT JOIN public.personnel_contracts pc ON pc.id = p.personnel_contract_id
          WHERE p.bank_transaction_id = r.id), '[]'::jsonb),
        'declarations', coalesce((
          SELECT jsonb_agg(jsonb_build_object('payment_id', f.id, 'declaration_id', d.id, 'kind', d.kind, 'form', d.form,
            'label', private.finance_declaration_label(d.form, d.period_kind, d.period_start),
            'amount', f.amount, 'method', f.match_method, 'reasons', f.match_reasons,
            'amount_due', d.amount_due,
            'status', private.finance_declaration_status(d.amount_due,
              (SELECT sum(x.amount) FROM public.finance_declaration_payments x WHERE x.declaration_id = d.id))) ORDER BY f.created_at)
          FROM public.finance_declaration_payments f JOIN public.finance_declarations d ON d.id = f.declaration_id
          WHERE f.bank_transaction_id = r.id), '[]'::jsonb),
        'explanation', CASE WHEN r.accounting_review_status = 'explained' THEN jsonb_build_object(
          'category', r.accounting_category, 'subtype', r.accounting_subtype, 'note', r.accounting_note,
          'by', coalesce(r.accounting_explained_by, 'user')) END,
        'proposal', CASE WHEN r.proposal IS NULL OR jsonb_typeof(r.proposal->'documents') <> 'array' THEN r.proposal
          ELSE r.proposal || jsonb_build_object('documents', coalesce((
            SELECT jsonb_agg(z.doc || jsonb_strip_nulls(jsonb_build_object(
                'suggested', CASE WHEN z.suggested THEN true END,
                'hint', CASE
                  WHEN z.suggested THEN 'Oznaczona ręcznie jako opłacona w dniu przelewu (' || to_char(r.transaction_date, 'DD.MM.YYYY') || ') na tę samą kwotę.'
                  WHEN z.issued_after THEN 'Wystawiona po dacie przelewu (' || to_char(z.issue_date, 'DD.MM.YYYY') || ').'
                END))
              ORDER BY z.ord)  -- kolejność bez zmian: accept_bank_reconciliation_proposal wybiera po indeksie
            FROM (
              SELECT y.*, (y.choose AND y.date_match AND count(*) FILTER (WHERE y.date_match) OVER () = 1) AS suggested
              FROM (
                SELECT d.ord, x.issue_date,
                  d.doc || jsonb_strip_nulls(jsonb_build_object(
                    'issue_date', coalesce(d.doc->>'issue_date', x.issue_date::text),
                    'due_date', coalesce(d.doc->>'due_date', x.due_date::text),
                    'doc_kind', CASE WHEN d.doc->>'source' IN ('ksef', 'invoice', 'external') AND d.doc ? 'id'
                                     THEN private.bank_document_kind(d.doc->>'source', (d.doc->>'id')::uuid) END,
                    'payment_status', x.payment_status,
                    'paid', CASE WHEN x.document_id IS NOT NULL THEN round(x.bank_paid + x.manual_paid, 2) END,
                    'bank_paid', CASE WHEN x.bank_paid > 0.009 THEN round(x.bank_paid, 2) END,
                    'manual_paid', CASE WHEN x.manual_paid > 0.009 THEN round(x.manual_paid, 2) END,
                    'manual_date', CASE WHEN x.manual_paid > 0.009 THEN x.manual_date END)) AS doc,
                  (r.proposal->>'kind') = 'choose' AS choose,
                  coalesce(x.manual_paid > 0.009 AND x.manual_date = r.transaction_date
                           AND abs(x.manual_paid - coalesce((d.doc->>'amount')::numeric, 0)) <= 0.02, false) AS date_match,
                  coalesce(x.issue_date > r.transaction_date, false) AS issued_after
                FROM jsonb_array_elements(r.proposal->'documents') WITH ORDINALITY AS d(doc, ord)
                LEFT JOIN docs x ON x.source = d.doc->>'source' AND x.document_id::text = d.doc->>'id'
              ) y
            ) z), '[]'::jsonb)) END)
        ORDER BY r.transaction_date, r.source_index NULLS LAST, r.id)
      FROM rows r), '[]'::jsonb),
    -- Deklaracje za poprzedni miesiąc (zwykle płatne w tym) i te, które mają przelew w tym miesiącu.
    'declarations', coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', x.id, 'kind', x.kind, 'form', x.form, 'label', x.label,
        'amount_due', x.amount_due, 'paid', x.paid, 'paid_this_month', x.paid_month,
        'status', private.finance_declaration_status(x.amount_due, x.paid)) ORDER BY x.period_start, x.kind, x.form)
      FROM (
        SELECT d.id, d.kind, d.form, d.period_start, d.amount_due,
               private.finance_declaration_label(d.form, d.period_kind, d.period_start) AS label,
               round(coalesce((SELECT sum(f.amount) FROM public.finance_declaration_payments f WHERE f.declaration_id = d.id), 0), 2) AS paid,
               round(coalesce((SELECT sum(f.amount) FROM public.finance_declaration_payments f
                               JOIN public.bank_transactions bt ON bt.id = f.bank_transaction_id
                               JOIN public.bank_statements s ON s.id = bt.statement_id
                               WHERE f.declaration_id = d.id AND s.statement_year = p_year AND s.statement_month = p_month), 0), 2) AS paid_month
        FROM public.finance_declarations d
        WHERE d.my_company_id = p_company_id
          AND ((d.period_kind = 'month' AND d.period_start = (v_from - interval '1 month')::date)
               OR EXISTS (SELECT 1 FROM public.finance_declaration_payments f
                          JOIN public.bank_transactions bt ON bt.id = f.bank_transaction_id
                          JOIN public.bank_statements s ON s.id = bt.statement_id
                          WHERE f.declaration_id = d.id AND s.statement_year = p_year AND s.statement_month = p_month))
      ) x), '[]'::jsonb),
    'paid_without_statement', coalesce((
      SELECT jsonb_agg(jsonb_build_object('source', d.source, 'id', d.document_id, 'number', d.number, 'party', d.party,
        'side', d.side, 'due', round(d.due, 2), 'manual_paid', round(d.manual_paid, 2), 'payment_date', d.manual_date,
        'currency', d.currency)
        ORDER BY d.manual_date, d.number)
      FROM docs d
      WHERE d.manual_paid > 0.009 AND NOT d.is_shadow AND d.manual_date BETWEEN v_from AND v_to
        AND NOT (d.source = 'invoice' AND EXISTS (SELECT 1 FROM docs k WHERE k.source = 'ksef' AND k.local_invoice_id = d.document_id))), '[]'::jsonb),
    'shadow_documents', coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', d.document_id, 'number', d.number, 'party', d.party, 'due', round(d.due, 2),
        'payment_status', d.payment_status, 'issue_date', d.issue_date) ORDER BY d.issue_date DESC, d.number)
      FROM docs d WHERE d.is_shadow), '[]'::jsonb),
    'unpaid_due', coalesce((
      SELECT jsonb_agg(jsonb_build_object('source', d.source, 'id', d.document_id, 'number', d.number, 'party', d.party,
        'side', d.side, 'due', round(d.due, 2), 'open', round(greatest(d.due - d.bank_paid - d.manual_paid, 0), 2),
        'due_date', d.due_date, 'issue_date', d.issue_date, 'currency', d.currency) ORDER BY d.due_date, d.number)
      FROM (
        SELECT DISTINCT ON (x.twin_key) x.* FROM docs x
        WHERE NOT x.is_shadow AND x.due - x.bank_paid - x.manual_paid > 0.009
          AND coalesce(x.due_date, x.issue_date) <= v_to
          AND coalesce(x.due_date, x.issue_date) >= v_from - interval '6 months'
        ORDER BY x.twin_key, (x.source = 'ksef') DESC
      ) d), '[]'::jsonb)
  ) INTO v_result;
  RETURN v_result;
END;
$function$;

COMMIT;
