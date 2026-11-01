-- Uzgadnianie wyciągów: ostrożniejsza reguła „zgodna kwota” bez potwierdzenia kontrahenta (2026-11-01).
--
-- Reguła 7 w reconcile_bank_month proponowała jedyny dokument o tej samej kwocie niezależnie od daty i kontrahenta,
-- z tolerancją 1 grosza — np. płatność kartą 57,99 zł na stacji CIRCLE K (22.09) → faktura AKCES plus na 58,00 zł
-- wystawiona 13.08. Dokument bez dowodu powiązania (NIP lub nazwa kontrahenta w przelewie, znany rachunek) jest teraz
-- brany pod uwagę tylko gdy:
--   * kwota zgadza się co do grosza;
--   * data pasuje: płatność kartą — dokument wystawiony od 3 dni przed do 14 dni po zakupie; przelew — dokument
--     wystawiony od 60 dni przed do 7 dni po przelewie albo termin płatności od 30 dni przed do 14 dni po przelewie;
--   * przelew nie ma wyraźnie innego kontrahenta (nazwa z przelewu nie występuje w nazwie z dokumentu i odwrotnie;
--     pośrednicy płatności — Allegro, PayU, Przelewy24, Tpay, PayPal… — nie są traktowani jak kontrahent).
-- Dokumenty z dowodem powiązania — bez zmian. Pozostałe można nadal przypisać ręcznie („Wybierz dokument”).
-- Zmiana działa przy kolejnym uzgodnieniu miesiąca (otwarte propozycje są wtedy zastępowane nowymi).
-- Poprawka punktowa: treść funkcji z bazy (pg_get_functiondef), zmienia się tylko warunek reguły 7 i jej opis.
-- Bez tabel tymczasowych; plik można bezpiecznie uruchomić ponownie.
BEGIN;

CREATE OR REPLACE FUNCTION private.bank_amount_only_plausible(
  p_tx_date date, p_card boolean, p_tx_text text, p_tx_counterparty text,
  p_doc_issue date, p_doc_due date, p_doc_party text, p_doc_party_token text, p_amount_diff numeric)
RETURNS boolean LANGUAGE sql STABLE SET search_path = pg_catalog AS $fn$
  SELECT coalesce(p_amount_diff, 1) <= 0.004
    AND (CASE WHEN p_card
           THEN coalesce(p_doc_issue, p_doc_due) BETWEEN p_tx_date - 3 AND p_tx_date + 14
           ELSE coalesce(p_doc_issue, p_doc_due) BETWEEN p_tx_date - 60 AND p_tx_date + 7
                OR p_doc_due BETWEEN p_tx_date - 30 AND p_tx_date + 14
         END) IS TRUE
    AND NOT coalesce(
      NOT p_card
      AND length(coalesce(p_tx_counterparty, '')) >= 4
      AND coalesce(p_tx_counterparty, '') !~ '(ALLEGRO|PAYU|PRZELEWY24|TPAY|DOTPAY|PAYPAL|STRIPE|BLUE ?MEDIA|AUTOPAY)'
      AND coalesce(p_doc_party_token, '') <> ''
      AND position(' ' || p_doc_party_token || ' ' IN ' ' || coalesce(p_tx_text, '') || ' ') = 0
      AND private.bank_party_token(p_tx_counterparty) <> ''
      AND position(private.bank_party_token(p_tx_counterparty) IN private.bank_norm(p_doc_party)) = 0,
      false);
$fn$;
COMMENT ON FUNCTION private.bank_amount_only_plausible(date, boolean, text, text, date, date, text, text, numeric) IS
  'Uzgadnianie wyciągów, reguła „zgodna kwota”: czy dokument bez dowodu powiązania z przelewem jest wiarygodnym kandydatem (kwota co do grosza, data, brak sprzecznego kontrahenta).';
REVOKE ALL ON FUNCTION private.bank_amount_only_plausible(date, boolean, text, text, date, date, text, text, numeric) FROM PUBLIC, anon, authenticated;
DO $grant$
BEGIN
  EXECUTE format('GRANT EXECUTE ON FUNCTION private.bank_amount_only_plausible(date, boolean, text, text, date, date, text, text, numeric) TO %I',
    (SELECT pg_get_userbyid(p.proowner) FROM pg_proc p WHERE p.oid = 'public.reconcile_bank_month(uuid,integer,integer)'::regprocedure));
END $grant$;

DO $patch$
DECLARE
  v_fn regprocedure := 'public.reconcile_bank_month(uuid,integer,integer)'::regprocedure;
  v_def text := pg_get_functiondef('public.reconcile_bank_month(uuid,integer,integer)'::regprocedure);
  v_new text;
  v_guard text := ' AND ((length(rd.nip) = 10 AND position(rd.nip IN t.text_compact) > 0)'
    || ' OR EXISTS (SELECT 1 FROM recon_iban ri WHERE ri.iban = t.iban AND ri.nip = rd.nip)'
    || ' OR (rd.party_token <> '''' AND position('' '' || rd.party_token || '' '' IN '' '' || t.text_norm || '' '') > 0)'
    || ' OR private.bank_amount_only_plausible(t.date, (t.card_merchant IS NOT NULL OR position(''UZYCIU KARTY'' IN t.text_norm) > 0),'
    || ' t.text_norm, t.counterparty_norm, rd.issue_date, rd.due_date, rd.party, rd.party_token,'
    || ' CASE WHEN rd.open_bank > 0.009 THEN abs(rd.open_bank - t.remaining) ELSE abs(rd.manual_open - t.remaining) END))';
  v_amount text := 'AND (abs(rd.open_bank - t.remaining) <= 0.01 OR (rd.open_bank <= 0.009 AND abs(rd.manual_open - t.remaining) <= 0.01))';
  v_olds text[];
  v_news text[];
  i int;
BEGIN
  IF position('bank_amount_only_plausible' IN v_def) > 0 THEN
    RAISE NOTICE 'reconcile_bank_month ma już poprawkę reguły „zgodna kwota” — pomijam.';
    RETURN;
  END IF;
  v_olds := ARRAY[
    E'      WHERE rd.dir = t.dir AND rd.currency = t.currency AND NOT (rd.document_id = ANY(v_rejected))\n        ' || v_amount || ';',
    E'        WHERE rd.dir = t.dir AND rd.currency = t.currency AND NOT (rd.document_id = ANY(v_rejected))\n          ' || v_amount || E'\n',
    E'          WHERE rd.dir = t.dir AND rd.currency = t.currency AND NOT (rd.document_id = ANY(v_rejected))\n            ' || v_amount || E'\n',
    ' (jedyny taki dokument), ale kontrahent nie jest potwierdzony'
  ];
  v_news := ARRAY[
    E'      WHERE rd.dir = t.dir AND rd.currency = t.currency AND NOT (rd.document_id = ANY(v_rejected))\n        ' || v_amount || E'\n        ' || v_guard || ';',
    E'        WHERE rd.dir = t.dir AND rd.currency = t.currency AND NOT (rd.document_id = ANY(v_rejected))\n          ' || v_amount || E'\n          ' || v_guard || E'\n',
    E'          WHERE rd.dir = t.dir AND rd.currency = t.currency AND NOT (rd.document_id = ANY(v_rejected))\n            ' || v_amount || E'\n            ' || v_guard || E'\n',
    ' (jedyny taki dokument z datą zbliżoną do przelewu), ale kontrahent nie jest potwierdzony'
  ];
  v_new := v_def;
  FOR i IN 1 .. array_length(v_olds, 1) LOOP
    IF (length(v_new) - length(replace(v_new, v_olds[i], ''))) / length(v_olds[i]) <> 1 THEN
      RAISE EXCEPTION 'reconcile_bank_month ma nieoczekiwaną treść (fragment nr % reguły 7). Sprawdź ręcznie.', i;
    END IF;
    v_new := replace(v_new, v_olds[i], v_news[i]);
  END LOOP;
  EXECUTE v_new;
  RAISE NOTICE 'reconcile_bank_month: reguła „zgodna kwota” zaktualizowana (%).', v_fn;
END $patch$;

COMMIT;
