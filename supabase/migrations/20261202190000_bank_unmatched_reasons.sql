-- Uzgodnienie wyciągów: dlaczego płatność nie ma dokumentu (docs/bank-reconciliation.md, sekcja 18).
--
-- `get_bank_unmatched_reasons(działalność, rok, miesiąc)` — dla każdej płatności miesiąca, której brakuje dokumentu
-- (w całości albo w części; bez przeniesień własnych i płatności wyjaśnionych), fakty, z których CRM i Mac składają powód
-- (`src/lib/invoices/bankUnmatchedReasons.ts`) — w załączniku „Dopasowane faktury (PDF)”, w uzgodnieniu i w „Brakach
-- dokumentów (CSV)”:
--   * opis braku dokumentu wpisany przez użytkownika (wyjaśnienie „do kontroli”, np. „Brak faktury od dostawcy — szukam
--     faktury w koncie Apple”; uzgodnienie miesiąca pokazuje tylko wyjaśnienia zamknięte),
--   * zapis na liście „Dokumenty do dosłania”,
--   * dokumenty tego kontrahenta w systemie (KSeF, faktury CRM, dokumenty spoza KSeF): ile, ile otwartych, dokument na tę
--     kwotę (otwarty, oznaczony ręcznie albo już rozliczony innym przelewem) i — gdy takiego nie ma — otwarty najbliższy kwotą,
--   * otwarty dokument na tę kwotę od innego kontrahenta (z datą w okolicy płatności),
--   * dokument spoza KSeF tego kontrahenta, którego uzgodnienie nie widzi („częściowo opłacony” bez kwoty zapłaty).
-- Kontrahent: nazwa z dokumentu w treści przelewu (jak w regułach uzgodnienia), ten sam pierwszy wyraz nazwy co kontrahent
-- płatności albo NIP dokumentu w treści przelewu. Tylko odczyt — nic nie zmienia w rozliczeniu.

CREATE OR REPLACE FUNCTION public.get_bank_unmatched_reasons(p_company_id uuid, p_year integer, p_month integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND NOT (public.finance_can_view() AND public.finance_company_visible(p_company_id)) THEN
    RAISE EXCEPTION 'Brak uprawnień do podglądu wyciągów.' USING ERRCODE = '42501';
  END IF;

  WITH tx AS (
    -- Te same operacje co w uzgodnieniu miesiąca (`get_bank_reconciliation_month`), bez przeniesień i wyjaśnionych.
    SELECT t.id, t.transaction_date, t.transaction_type AS dir, upper(coalesce(t.currency, 'PLN')) AS currency,
           abs(t.amount) AS amount, private.bank_transaction_allocated(t.id) AS alloc,
           t.accounting_category, t.accounting_subtype, t.accounting_note,
           private.bank_norm(concat_ws(' ', t.title, t.raw_description, t.counterparty_name, t.raw_counterparty, t.reference_number,
             (SELECT string_agg(concat_ws(' ', c.title, c.raw_description, c.counterparty_name, c.raw_counterparty), ' ')
              FROM public.bank_transactions c WHERE c.canonical_transaction_id = t.id))) AS text_norm
    FROM public.bank_transactions t
    JOIN public.bank_statements s ON s.id = t.statement_id
    WHERE s.my_company_id = p_company_id AND s.statement_year = p_year AND s.statement_month = p_month
      AND s.processed AND s.validation_status = 'valid'
      AND t.canonical_transaction_id IS NULL AND t.paired_bank_transaction_id IS NULL
      AND NOT coalesce(t.private_transfer_detected, false)
      AND t.accounting_review_status IS DISTINCT FROM 'explained'
  ), keyed AS (
    SELECT tx.*, round(greatest(tx.amount - tx.alloc, 0), 2) AS remaining,
           private.bank_transaction_party_label(tx.id) AS party,
           coalesce(private.bank_party_token(private.bank_transaction_party_label(tx.id)), '') AS token,
           ' ' || coalesce(tx.text_norm, '') || ' ' AS padded,
           replace(coalesce(tx.text_norm, ''), ' ', '') AS compact
    FROM tx
    WHERE tx.alloc < tx.amount - 0.01
  ), docs AS (
    SELECT d.source, d.document_id, d.number, d.party, d.nip, d.dir, d.currency, d.issue_date, d.due,
           d.bank_paid, d.manual_paid, coalesce(d.party_token, '') AS party_token, d.pln_amount, d.twin_key,
           round(greatest(d.due - d.bank_paid - d.manual_paid, 0), 2) AS open_amount
    FROM private.bank_reconciliation_documents(p_company_id) d
    WHERE NOT d.is_shadow
  ), party_docs AS (
    SELECT k.id AS tx_id, k.currency AS tx_currency, k.remaining, k.amount AS tx_amount, k.transaction_date AS tx_date,
           d.*,
           CASE WHEN d.currency = k.currency THEN d.due WHEN k.currency = 'PLN' THEN d.pln_amount END AS cmp_due
    FROM keyed k
    JOIN docs d ON d.dir = k.dir
     AND ((d.party_token <> '' AND position(' ' || d.party_token || ' ' IN k.padded) > 0)
          OR (k.token <> '' AND d.party_token = k.token)
          OR (length(d.nip) = 10 AND position(d.nip IN k.compact) > 0))
  ), party_stats AS (
    SELECT p.tx_id, count(DISTINCT p.twin_key) AS total,
           count(DISTINCT p.twin_key) FILTER (WHERE p.open_amount > 0.009) AS open_count,
           (array_agg(p.party ORDER BY p.issue_date DESC NULLS LAST, p.number))[1] AS doc_party
    FROM party_docs p
    GROUP BY p.tx_id
  ), party_exact AS (
    -- Dokument tego kontrahenta na kwotę płatności (całą albo brakującą część; otwarta reszta dokumentu = brakująca część).
    SELECT DISTINCT ON (p.tx_id) p.tx_id, jsonb_strip_nulls(jsonb_build_object(
             'source', p.source, 'id', p.document_id, 'number', p.number, 'party', p.party, 'currency', p.currency,
             'due', round(p.due, 2), 'open', p.open_amount, 'issue_date', p.issue_date,
             'settled', p.bank_paid >= p.due - 0.01,
             'manual', CASE WHEN p.manual_paid > 0.009 AND p.bank_paid < p.due - 0.01 THEN true END)) AS doc
    FROM party_docs p
    WHERE (p.cmp_due IS NOT NULL AND (abs(p.cmp_due - p.remaining) <= 0.01 OR abs(p.cmp_due - p.tx_amount) <= 0.01))
       OR (p.currency = p.tx_currency AND p.open_amount > 0.009 AND abs(p.open_amount - p.remaining) <= 0.01)
    ORDER BY p.tx_id, (p.bank_paid < p.due - 0.01) DESC, abs(coalesce(p.issue_date, p.tx_date) - p.tx_date), p.number
  ), party_nearest AS (
    SELECT DISTINCT ON (p.tx_id) p.tx_id, jsonb_strip_nulls(jsonb_build_object(
             'source', p.source, 'id', p.document_id, 'number', p.number, 'party', p.party, 'currency', p.currency,
             'due', round(p.due, 2), 'open', p.open_amount, 'issue_date', p.issue_date)) AS doc
    FROM party_docs p
    WHERE p.open_amount > 0.009
    ORDER BY p.tx_id,
             abs(coalesce(CASE WHEN p.currency = p.tx_currency THEN p.open_amount END, p.cmp_due, p.due) - p.remaining),
             p.issue_date DESC NULLS LAST, p.number
  ), same_amount AS (
    -- Otwarty dokument na brakującą kwotę od innego kontrahenta, z datą w okolicy płatności.
    SELECT k.id AS tx_id, count(DISTINCT d.twin_key) AS total,
           (array_agg(jsonb_strip_nulls(jsonb_build_object(
              'source', d.source, 'id', d.document_id, 'number', d.number, 'party', d.party, 'currency', d.currency,
              'due', round(d.due, 2), 'open', d.open_amount, 'issue_date', d.issue_date))
            ORDER BY abs(coalesce(d.issue_date, k.transaction_date) - k.transaction_date), d.number))[1] AS doc
    FROM keyed k
    JOIN docs d ON d.dir = k.dir AND d.open_amount > 0.009
     AND ((d.currency = k.currency AND abs(d.open_amount - k.remaining) <= 0.01)
          OR (d.currency <> k.currency AND k.currency = 'PLN' AND d.pln_amount IS NOT NULL AND abs(d.pln_amount - k.remaining) <= 0.01))
     AND coalesce(d.issue_date, k.transaction_date) BETWEEN k.transaction_date - 180 AND k.transaction_date + 45
    WHERE NOT EXISTS (SELECT 1 FROM party_docs p WHERE p.tx_id = k.id AND p.source = d.source AND p.document_id = d.document_id)
    GROUP BY k.id
  ), review AS (
    -- Dokument spoza KSeF tego kontrahenta pomijany przez uzgodnienie: „częściowo opłacony” bez kwoty zapłaty.
    SELECT DISTINCT ON (k.id) k.id AS tx_id, jsonb_strip_nulls(jsonb_build_object(
             'source', 'external', 'id', e.id, 'number', e.invoice_number, 'party', e.seller_name,
             'currency', upper(coalesce(e.currency, 'PLN')), 'due', round(abs(coalesce(e.amount_gross, 0)), 2),
             'issue_date', e.invoice_date)) AS doc
    FROM keyed k
    JOIN public.external_invoices e
      ON e.my_company_id = p_company_id AND e.payment_amount_needs_review AND e.payment_status <> 'cancelled'
     AND CASE WHEN coalesce(e.amount_gross, 0) >= 0 THEN 'debit' ELSE 'credit' END = k.dir
    CROSS JOIN LATERAL (
      SELECT coalesce(private.bank_party_token(e.seller_name), '') AS token,
             regexp_replace(coalesce(e.seller_nip, ''), '\D', '', 'g') AS nip
    ) x
    WHERE (x.token <> '' AND position(' ' || x.token || ' ' IN k.padded) > 0)
       OR (k.token <> '' AND x.token = k.token)
       OR (length(x.nip) = 10 AND position(x.nip IN k.compact) > 0)
    ORDER BY k.id, abs(abs(coalesce(e.amount_gross, 0)) - k.remaining), e.invoice_date DESC NULLS LAST, e.id
  )
  SELECT coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
    'id', k.id,
    'party', nullif(btrim(k.party), ''),
    'token', nullif(k.token, ''),
    'pending_note', CASE WHEN k.accounting_subtype IS NOT NULL AND nullif(btrim(k.accounting_note), '') IS NOT NULL
      THEN jsonb_build_object('category', k.accounting_category, 'subtype', k.accounting_subtype, 'note', btrim(k.accounting_note)) END,
    'followup', CASE WHEN EXISTS (SELECT 1 FROM public.accounting_document_followups f
                                  WHERE f.bank_transaction_id = k.id AND f.active) THEN true END,
    'party_documents', coalesce(ps.total, 0),
    'party_open', coalesce(ps.open_count, 0),
    'party_name', nullif(btrim(ps.doc_party), ''),
    'party_exact', pe.doc,
    'party_nearest', CASE WHEN pe.doc IS NULL THEN pn.doc END,
    'same_amount', sa.doc,
    'same_amount_count', sa.total,
    'needs_review', rv.doc
  )) ORDER BY k.transaction_date, k.id), '[]'::jsonb)
  INTO v_result
  FROM keyed k
  LEFT JOIN party_stats ps ON ps.tx_id = k.id
  LEFT JOIN party_exact pe ON pe.tx_id = k.id
  LEFT JOIN party_nearest pn ON pn.tx_id = k.id
  LEFT JOIN same_amount sa ON sa.tx_id = k.id
  LEFT JOIN review rv ON rv.tx_id = k.id;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_bank_unmatched_reasons(uuid, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_bank_unmatched_reasons(uuid, integer, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_bank_unmatched_reasons(uuid, integer, integer) TO authenticated, service_role;

COMMENT ON FUNCTION public.get_bank_unmatched_reasons(uuid, integer, integer) IS
  'Uzgodnienie wyciągów: fakty o płatnościach miesiąca bez dokumentu (opis braku, „Dokumenty do dosłania”, dokumenty kontrahenta, dokument na tę kwotę) — powody w CRM, na Macu i w „Dopasowanych fakturach (PDF)”. docs/bank-reconciliation.md, sekcja 18.';
