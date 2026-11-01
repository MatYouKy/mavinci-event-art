-- Uzgadnianie wyciągów bankowych — jedna, przejrzysta ścieżka.
--
-- 1. Dwa wyciągi (PDF i MT940) tego samego rachunku i miesiąca dają JEDNĄ potwierdzoną listę operacji.
--    Operacją główną jest wiersz z MT940 (pełne tytuły, rachunek kontrahenta), wiersz z PDF zostaje
--    jako potwierdzenie (canonical_transaction_id → operacja główna). Rozliczenia i wyjaśnienia
--    zapisane dotąd na kopii PDF są przenoszone na operację główną.
-- 2. Blokady podwójnego rozliczenia na poziomie tabel (niezależnie od ekranu czy funkcji):
--    – operacja nie może być rozliczona ponad swoją kwotę,
--    – faktura nie może być opłacona z wyciągu ponad należność — liczone razem z jej kopiami
--      w innych źródłach (KSeF, CRM, dokumenty spoza KSeF),
--    – nie można rozliczać kopii operacji, transferu VAT ani roboczej kopii faktury bez numeru KSeF.
-- 3. Automatyczne reguły (reconcile_bank_month) — zawsze z zapisanym powodem, każdą decyzję można cofnąć:
--    pewne rozliczenia wykonuje sama, prawdopodobne zapisuje jako propozycje do zatwierdzenia.
--    Decyzja człowieka jest ostateczna: cofnięte dopasowanie, odrzucona propozycja i cofnięte wyjaśnienie
--    z reguły nie wracają przy kolejnym uzgodnieniu.
-- Plik można bezpiecznie uruchomić ponownie (IF NOT EXISTS / CREATE OR REPLACE).
BEGIN;

-- 0. Normalizacja tekstu z wyciągów ---------------------------------------------------------
-- MT940 z PKO ma zepsute polskie znaki (np. „URZˇD”, „SPӣKA”, „˙” zamiast spacji).
-- Daty (15.04.2026, 2026-04-15) są usuwane — inaczej numer faktury „04-2026” trafiałby w datę operacji.
CREATE OR REPLACE FUNCTION private.bank_norm(p_value text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = pg_catalog AS $$
  SELECT btrim(regexp_replace(
    translate(upper(regexp_replace(coalesce(p_value, ''),
      '\m[0-9]{1,2}\.[0-9]{1,2}\.([0-9]{4}|[0-9]{2})\M|\m[0-9]{4}-[0-9]{2}-[0-9]{2}\M', ' ', 'g')),
      'ĄĆĘŁŃÓŚŹŻˇ˙Ӣӣ¦¬¯³¹ÊÆÑŒŸ¿ÄÖÜÉÁÍÚ',
      'ACELNOSZZA OOSZZLAECNSZZAOUEAIU'),
    '[^A-Z0-9]+', ' ', 'g'))
$$;

-- Numer dokumentu w tytule przelewu: jako osobne słowa („INV/53/2026” ↔ „53/2026”) albo — dla
-- długich numerów — w tekście bez separatorów („FV56/2026” ↔ „FV/56/2026”).
-- Numery wyglądające jak data („04-2026”, „2/09/2026”) nie są szukane w tytułach — zbyt łatwo o fałszywe trafienie.
CREATE OR REPLACE FUNCTION private.bank_number_usable(p_number text)
RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = pg_catalog AS $$
  SELECT c ~ '[0-9]' AND (length(c) >= 5 OR (length(c) >= 4 AND c ~ '[A-Z]'))
    AND NOT (n ~ '^0[0-9] 20[0-9]{2}$' OR n ~ '^[0-9]{1,2} (0?[1-9]|1[0-2]) 20[0-9]{2}$')
  FROM (SELECT private.bank_norm(p_number) AS n, replace(private.bank_norm(p_number), ' ', '') AS c) x
$$;

CREATE OR REPLACE FUNCTION private.bank_number_hit(p_text_norm text, p_text_compact text, p_number text)
RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = pg_catalog AS $$
  SELECT private.bank_number_usable(p_number) AND (
    position(' ' || n || ' ' IN ' ' || coalesce(p_text_norm, '') || ' ') > 0
    OR (length(replace(n, ' ', '')) >= 8 AND position(replace(n, ' ', '') IN coalesce(p_text_compact, '')) > 0)
  )
  FROM (SELECT private.bank_norm(p_number) AS n) x
$$;

-- 1. Potwierdzona lista operacji ------------------------------------------------------------
ALTER TABLE public.bank_transactions
  ADD COLUMN IF NOT EXISTS canonical_transaction_id uuid REFERENCES public.bank_transactions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_confirmation text NOT NULL DEFAULT 'single_source',
  ADD COLUMN IF NOT EXISTS accounting_explained_by text;

DO $c$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bank_transactions_source_confirmation_check') THEN
    ALTER TABLE public.bank_transactions ADD CONSTRAINT bank_transactions_source_confirmation_check
      CHECK (source_confirmation IN ('single_source', 'confirmed', 'unconfirmed'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bank_transactions_canonical_not_self') THEN
    ALTER TABLE public.bank_transactions ADD CONSTRAINT bank_transactions_canonical_not_self
      CHECK (canonical_transaction_id IS NULL OR canonical_transaction_id <> id);
  END IF;
END
$c$;

CREATE INDEX IF NOT EXISTS idx_bank_transactions_canonical
  ON public.bank_transactions(canonical_transaction_id) WHERE canonical_transaction_id IS NOT NULL;

COMMENT ON COLUMN public.bank_transactions.canonical_transaction_id IS
  'Kopia operacji z drugiego wyciągu (PDF/MT940): wskazuje operację główną. Rozliczenia tylko na operacji głównej.';
COMMENT ON COLUMN public.bank_transactions.source_confirmation IS
  'single_source – wgrano jeden format; confirmed – operacja jest w obu wyciągach; unconfirmed – brak jej w drugim wyciągu.';
COMMENT ON COLUMN public.bank_transactions.accounting_explained_by IS
  'Kto wyjaśnił operację bez faktury: rule:<nazwa> (reguła automatyczna) albo NULL/user (użytkownik).';

-- Przeniesienie danych z kopii na operację główną.
CREATE OR REPLACE FUNCTION private.merge_bank_transaction_copy(p_canonical uuid, p_copy uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  c public.bank_transactions%ROWTYPE;
  p public.bank_transactions%ROWTYPE;
  v_c_alloc boolean;
  v_p_alloc boolean;
BEGIN
  SELECT * INTO c FROM public.bank_transactions WHERE id = p_canonical FOR UPDATE;
  SELECT * INTO p FROM public.bank_transactions WHERE id = p_copy FOR UPDATE;
  IF c.id IS NULL OR p.id IS NULL THEN RETURN 'missing'; END IF;
  IF p.canonical_transaction_id = c.id THEN RETURN 'already'; END IF;
  IF c.canonical_transaction_id IS NOT NULL OR p.canonical_transaction_id IS NOT NULL THEN RETURN 'conflict'; END IF;

  v_c_alloc := EXISTS (SELECT 1 FROM public.bank_transaction_invoice_matches WHERE bank_transaction_id = c.id)
            OR EXISTS (SELECT 1 FROM public.personnel_contract_payments WHERE bank_transaction_id = c.id);
  v_p_alloc := EXISTS (SELECT 1 FROM public.bank_transaction_invoice_matches WHERE bank_transaction_id = p.id)
            OR EXISTS (SELECT 1 FROM public.personnel_contract_payments WHERE bank_transaction_id = p.id);
  -- Oba wiersze rozliczone osobno albo rozliczenie na transferze VAT — zostawiamy do decyzji człowieka.
  IF v_p_alloc AND (v_c_alloc OR c.paired_bank_transaction_id IS NOT NULL) THEN RETURN 'conflict'; END IF;

  IF v_p_alloc THEN
    UPDATE public.bank_transaction_invoice_matches SET bank_transaction_id = c.id WHERE bank_transaction_id = p.id;
    UPDATE public.personnel_contract_payments SET bank_transaction_id = c.id WHERE bank_transaction_id = p.id;
  END IF;
  UPDATE public.bank_transaction_supporting_documents SET bank_transaction_id = c.id WHERE bank_transaction_id = p.id;
  IF NOT EXISTS (SELECT 1 FROM public.accounting_document_followups WHERE bank_transaction_id = c.id) THEN
    UPDATE public.accounting_document_followups SET bank_transaction_id = c.id WHERE bank_transaction_id = p.id;
  END IF;
  UPDATE public.bank_counterparty_mapping_templates SET source_transaction_id = c.id WHERE source_transaction_id = p.id;
  UPDATE public.bank_reconciliation_proposals SET status = 'superseded', decided_at = now()
  WHERE bank_transaction_id = p.id AND status = 'open';

  IF coalesce(c.accounting_review_status, 'pending') <> 'explained' AND p.accounting_review_status = 'explained' THEN
    UPDATE public.bank_transactions
    SET accounting_review_status = p.accounting_review_status,
        accounting_category = p.accounting_category,
        accounting_subtype = p.accounting_subtype,
        accounting_note = coalesce(p.accounting_note, c.accounting_note),
        accounting_reviewed_at = p.accounting_reviewed_at,
        accounting_explained_by = p.accounting_explained_by
    WHERE id = c.id;
  ELSIF c.accounting_note IS NULL AND p.accounting_note IS NOT NULL THEN
    UPDATE public.bank_transactions SET accounting_note = p.accounting_note WHERE id = c.id;
  END IF;
  IF p.private_transfer_detected AND NOT c.private_transfer_detected THEN
    UPDATE public.bank_transactions
    SET private_transfer_detected = true, private_transfer_owner = coalesce(c.private_transfer_owner, p.private_transfer_owner)
    WHERE id = c.id;
  END IF;

  UPDATE public.bank_transactions SET canonical_transaction_id = c.id, source_confirmation = 'confirmed' WHERE id = p.id;
  UPDATE public.bank_transactions SET source_confirmation = 'confirmed' WHERE id = c.id;
  RETURN 'merged';
END;
$$;

-- Parowanie obu wyciągów miesiąca: najpierw po saldzie po operacji (jednoznaczne), potem — gdy bank
-- inaczej ułożył operacje z jednego dnia — po kwocie, kierunku i kolejności w granicach 3 dni.
CREATE OR REPLACE FUNCTION public.confirm_bank_statement_sources(p_company_id uuid, p_year integer, p_month integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_kind text;
  v_mt uuid[];
  v_pdf uuid[];
  r record;
  v_result text;
  v_merged integer;
  v_already integer;
  v_conflicts integer;
  v_summary jsonb := '[]'::jsonb;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND NOT (public.finance_can_manage() AND public.finance_company_visible(p_company_id)) THEN
    RAISE EXCEPTION 'Brak uprawnień do uzgadniania wyciągów.' USING ERRCODE = '42501';
  END IF;

  FOREACH v_kind IN ARRAY ARRAY['regular', 'vat'] LOOP
    SELECT array_agg(s.id) FILTER (WHERE s.import_format = 'MT940'),
           array_agg(s.id) FILTER (WHERE s.import_format IS DISTINCT FROM 'MT940')
    INTO v_mt, v_pdf
    FROM public.bank_statements s
    WHERE s.my_company_id = p_company_id AND s.statement_year = p_year AND s.statement_month = p_month
      AND s.processed AND s.validation_status = 'valid'
      AND (CASE WHEN s.account_type = 'vat' THEN 'vat' ELSE 'regular' END) = v_kind;

    IF v_mt IS NULL AND v_pdf IS NULL THEN CONTINUE; END IF;

    IF v_mt IS NULL OR v_pdf IS NULL THEN
      UPDATE public.bank_transactions t SET source_confirmation = 'single_source'
      WHERE t.statement_id = ANY(coalesce(v_mt, v_pdf)) AND t.canonical_transaction_id IS NULL
        AND t.source_confirmation <> 'single_source'
        AND NOT EXISTS (SELECT 1 FROM public.bank_transactions x WHERE x.canonical_transaction_id = t.id);
      v_summary := v_summary || jsonb_build_object('kind', v_kind, 'formats', 1,
        'transactions', (SELECT count(*) FROM public.bank_transactions WHERE statement_id = ANY(coalesce(v_mt, v_pdf))));
      CONTINUE;
    END IF;

    v_merged := 0; v_already := 0; v_conflicts := 0;
    FOR r IN
      WITH a AS (
        SELECT t.id, t.amount, t.transaction_type, t.source_balance_after AS bal, t.source_index, t.transaction_date
        FROM public.bank_transactions t WHERE t.statement_id = ANY(v_mt)
      ), b AS (
        SELECT t.id, t.amount, t.transaction_type, t.source_balance_after AS bal, t.source_index, t.transaction_date
        FROM public.bank_transactions t WHERE t.statement_id = ANY(v_pdf)
      ), ar AS (
        SELECT a.*, row_number() OVER (PARTITION BY amount, transaction_type, bal ORDER BY source_index, id) AS rn
        FROM a WHERE bal IS NOT NULL
      ), br AS (
        SELECT b.*, row_number() OVER (PARTITION BY amount, transaction_type, bal ORDER BY source_index, id) AS rn
        FROM b WHERE bal IS NOT NULL
      ), p1 AS (
        SELECT ar.id AS mt_id, br.id AS pdf_id
        FROM ar JOIN br ON ar.amount = br.amount AND ar.transaction_type = br.transaction_type
          AND ar.bal = br.bal AND ar.rn = br.rn
          AND abs(ar.transaction_date - br.transaction_date) <= 7
      ), a2 AS (
        SELECT a.*, row_number() OVER (PARTITION BY amount, transaction_type ORDER BY transaction_date, source_index, id) AS rn
        FROM a WHERE id NOT IN (SELECT mt_id FROM p1)
      ), b2 AS (
        SELECT b.*, row_number() OVER (PARTITION BY amount, transaction_type ORDER BY transaction_date, source_index, id) AS rn
        FROM b WHERE id NOT IN (SELECT pdf_id FROM p1)
      ), p2 AS (
        SELECT a2.id AS mt_id, b2.id AS pdf_id
        FROM a2 JOIN b2 ON a2.amount = b2.amount AND a2.transaction_type = b2.transaction_type AND a2.rn = b2.rn
          AND abs(a2.transaction_date - b2.transaction_date) <= 3
      )
      SELECT * FROM p1 UNION ALL SELECT * FROM p2
    LOOP
      v_result := private.merge_bank_transaction_copy(r.mt_id, r.pdf_id);
      IF v_result = 'merged' THEN v_merged := v_merged + 1;
      ELSIF v_result = 'already' THEN v_already := v_already + 1;
      ELSE v_conflicts := v_conflicts + 1;
      END IF;
    END LOOP;

    -- Operacje bez pary w drugim wyciągu (oba pliki są, a operacji brakuje w jednym z nich).
    UPDATE public.bank_transactions t SET source_confirmation = 'unconfirmed'
    WHERE t.statement_id = ANY(v_mt || v_pdf) AND t.canonical_transaction_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM public.bank_transactions x WHERE x.canonical_transaction_id = t.id)
      AND t.source_confirmation <> 'unconfirmed';

    v_summary := v_summary || jsonb_build_object(
      'kind', v_kind, 'formats', 2,
      'merged', v_merged, 'already', v_already, 'conflicts', v_conflicts,
      'mt940', (SELECT count(*) FROM public.bank_transactions WHERE statement_id = ANY(v_mt)),
      'pdf', (SELECT count(*) FROM public.bank_transactions WHERE statement_id = ANY(v_pdf)),
      'unconfirmed', (SELECT count(*) FROM public.bank_transactions
                      WHERE statement_id = ANY(v_mt || v_pdf) AND source_confirmation = 'unconfirmed'));
  END LOOP;

  -- Transfery między rachunkiem bieżącym i VAT: para zawsze między operacjami głównymi.
  CREATE TEMP TABLE IF NOT EXISTS recon_pairs (a uuid, b uuid) ON COMMIT DROP;
  TRUNCATE recon_pairs;
  INSERT INTO recon_pairs
  SELECT DISTINCT coalesce(x.canonical_transaction_id, x.id), coalesce(y.canonical_transaction_id, y.id)
  FROM public.bank_transactions x
  JOIN public.bank_transactions y ON y.id = x.paired_bank_transaction_id
  JOIN public.bank_statements s ON s.id = x.statement_id
  WHERE s.my_company_id = p_company_id AND s.statement_year = p_year AND s.statement_month = p_month
    AND (x.canonical_transaction_id IS NOT NULL OR y.canonical_transaction_id IS NOT NULL);
  IF EXISTS (SELECT 1 FROM recon_pairs) THEN
    UPDATE public.bank_transactions t SET paired_bank_transaction_id = NULL
    WHERE t.paired_bank_transaction_id IS NOT NULL
      AND (t.id IN (SELECT a FROM recon_pairs UNION SELECT b FROM recon_pairs)
        OR t.paired_bank_transaction_id IN (SELECT a FROM recon_pairs UNION SELECT b FROM recon_pairs)
        OR coalesce(t.canonical_transaction_id, t.id) IN (SELECT a FROM recon_pairs UNION SELECT b FROM recon_pairs));
    UPDATE public.bank_transactions t SET paired_bank_transaction_id = rp.b
    FROM (SELECT DISTINCT ON (a) a, b FROM recon_pairs WHERE a <> b ORDER BY a, b) rp
    WHERE t.id = rp.a
      AND NOT EXISTS (SELECT 1 FROM public.bank_transactions z WHERE z.paired_bank_transaction_id = rp.b);
  END IF;

  RETURN v_summary;
END;
$$;

-- Usunięcie wyciągu z operacjami głównymi: kopia z drugiego wyciągu przejmuje rozliczenia i wyjaśnienia.
-- Przejęcie wykonujemy przy usuwaniu pliku wyciągu (zanim baza usunie jego operacje).
CREATE OR REPLACE FUNCTION private.promote_bank_transaction_copy_for(p_transaction_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  o public.bank_transactions%ROWTYPE;
  v_copy uuid;
BEGIN
  SELECT * INTO o FROM public.bank_transactions WHERE id = p_transaction_id;
  IF NOT FOUND OR o.canonical_transaction_id IS NOT NULL THEN RETURN NULL; END IF;
  SELECT id INTO v_copy FROM public.bank_transactions WHERE canonical_transaction_id = o.id ORDER BY id LIMIT 1;
  IF v_copy IS NULL THEN RETURN NULL; END IF;

  -- Kopia staje się operacją główną (para VAT wraca po usunięciu — restore_bank_transfer_pairs).
  UPDATE public.bank_transactions
  SET canonical_transaction_id = NULL, source_confirmation = 'single_source',
      accounting_review_status = o.accounting_review_status, accounting_category = o.accounting_category,
      accounting_subtype = o.accounting_subtype, accounting_note = o.accounting_note,
      accounting_reviewed_at = o.accounting_reviewed_at, accounting_explained_by = o.accounting_explained_by,
      private_transfer_detected = o.private_transfer_detected, private_transfer_owner = o.private_transfer_owner
  WHERE id = v_copy;
  UPDATE public.bank_transactions SET canonical_transaction_id = v_copy WHERE canonical_transaction_id = o.id AND id <> v_copy;
  UPDATE public.bank_transactions SET paired_bank_transaction_id = v_copy WHERE paired_bank_transaction_id = o.id AND id <> v_copy;
  UPDATE public.bank_transaction_invoice_matches SET bank_transaction_id = v_copy WHERE bank_transaction_id = o.id;
  UPDATE public.personnel_contract_payments SET bank_transaction_id = v_copy WHERE bank_transaction_id = o.id;
  UPDATE public.bank_transaction_supporting_documents SET bank_transaction_id = v_copy WHERE bank_transaction_id = o.id;
  IF NOT EXISTS (SELECT 1 FROM public.accounting_document_followups WHERE bank_transaction_id = v_copy) THEN
    UPDATE public.accounting_document_followups SET bank_transaction_id = v_copy WHERE bank_transaction_id = o.id;
  END IF;
  UPDATE public.bank_counterparty_mapping_templates SET source_transaction_id = v_copy WHERE source_transaction_id = o.id;
  UPDATE public.bank_reconciliation_proposals SET status = 'superseded', decided_at = now()
  WHERE bank_transaction_id = o.id AND status = 'open';
  RETURN v_copy;
END;
$$;

CREATE OR REPLACE FUNCTION private.promote_statement_copies()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT t.id FROM public.bank_transactions t
    WHERE t.statement_id = OLD.id AND t.canonical_transaction_id IS NULL
      AND EXISTS (SELECT 1 FROM public.bank_transactions c WHERE c.canonical_transaction_id = t.id)
  LOOP
    PERFORM private.promote_bank_transaction_copy_for(r.id);
  END LOOP;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS promote_statement_copies ON public.bank_statements;
CREATE TRIGGER promote_statement_copies BEFORE DELETE ON public.bank_statements
  FOR EACH ROW EXECUTE FUNCTION private.promote_statement_copies();

-- Usuwanie pojedynczej operacji: kopia → operacja główna traci potwierdzenie; operacja główna z kopią
-- przekazuje kopii wyjaśnienia (rozliczenia trzeba najpierw cofnąć albo usunąć cały plik).
CREATE OR REPLACE FUNCTION private.promote_bank_transaction_copy()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF OLD.canonical_transaction_id IS NOT NULL THEN
    UPDATE public.bank_transactions c SET source_confirmation = 'single_source'
    WHERE c.id = OLD.canonical_transaction_id
      AND NOT EXISTS (SELECT 1 FROM public.bank_transactions x WHERE x.canonical_transaction_id = c.id AND x.id <> OLD.id);
    RETURN OLD;
  END IF;
  IF EXISTS (SELECT 1 FROM public.bank_transactions c WHERE c.canonical_transaction_id = OLD.id) THEN
    IF EXISTS (SELECT 1 FROM public.bank_transaction_invoice_matches m WHERE m.bank_transaction_id = OLD.id)
       OR EXISTS (SELECT 1 FROM public.personnel_contract_payments p WHERE p.bank_transaction_id = OLD.id) THEN
      RAISE EXCEPTION 'Ta operacja ma rozliczenia i kopię w drugim wyciągu. Usuń cały plik wyciągu albo najpierw cofnij rozliczenia.'
        USING ERRCODE = '23514';
    END IF;
    PERFORM private.promote_bank_transaction_copy_for(OLD.id);
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS promote_bank_transaction_copy ON public.bank_transactions;
CREATE TRIGGER promote_bank_transaction_copy BEFORE DELETE ON public.bank_transactions
  FOR EACH ROW EXECUTE FUNCTION private.promote_bank_transaction_copy();

-- Po usunięciu: druga strona transferu VAT wskazuje już przejętą kopię — przywracamy parę w obie strony.
CREATE OR REPLACE FUNCTION private.restore_bank_transfer_pairs()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  UPDATE public.bank_transactions c SET paired_bank_transaction_id = x.id
  FROM public.bank_transactions x
  WHERE x.paired_bank_transaction_id = c.id AND c.paired_bank_transaction_id IS NULL AND x.id <> c.id
    AND NOT EXISTS (SELECT 1 FROM public.bank_transactions z WHERE z.paired_bank_transaction_id = x.id);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS restore_bank_transfer_pairs ON public.bank_transactions;
CREATE TRIGGER restore_bank_transfer_pairs AFTER DELETE ON public.bank_transactions
  FOR EACH STATEMENT EXECUTE FUNCTION private.restore_bank_transfer_pairs();

-- 2. Blokady podwójnego rozliczenia -----------------------------------------------------------
-- Kontrola sumy płatności KSeF: zapis płatności z dopasowania bankowego to „wstaw albo zaktualizuj”
-- (ON CONFLICT bank_match_id). Dotąd kontrola liczyła wtedy tę samą płatność dwa razy (starą i nową),
-- więc zmiana kwoty lub przeniesienie dopasowania faktury KSeF kończyły się błędem.
CREATE OR REPLACE FUNCTION public.validate_ksef_invoice_payment_amount()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
DECLARE
  v_due numeric(14,2);
  v_other_payments numeric(14,2);
BEGIN
  SELECT ABS(COALESCE(ki.amount_to_pay_gross, ki.gross_amount, 0))
  INTO v_due
  FROM public.ksef_invoices ki
  WHERE ki.id = NEW.ksef_invoice_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Nie znaleziono dokumentu KSeF'; END IF;
  IF NEW.amount <= 0 THEN RAISE EXCEPTION 'Kwota platnosci musi byc dodatnia'; END IF;

  SELECT COALESCE(SUM(kp.amount), 0)
  INTO v_other_payments
  FROM public.ksef_invoice_payments kp
  WHERE kp.ksef_invoice_id = NEW.ksef_invoice_id
    AND (TG_OP = 'INSERT' OR kp.id <> NEW.id)
    AND (NEW.bank_match_id IS NULL OR kp.bank_match_id IS DISTINCT FROM NEW.bank_match_id);

  IF v_other_payments + NEW.amount > v_due + 0.01 THEN
    RAISE EXCEPTION 'Suma platnosci przekracza kwote dokumentu KSeF';
  END IF;
  RETURN NEW;
END;
$$;

-- Robocza kopia faktury sprzedaży: wpis KSeF bez numeru KSeF, gdy ta sama faktura ma już wpis z numerem.
CREATE OR REPLACE FUNCTION private.ksef_invoice_is_shadow(p_ksef_invoice_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.ksef_invoices k
    JOIN public.ksef_invoices r ON r.id <> k.id AND r.my_company_id IS NOT DISTINCT FROM k.my_company_id
      AND r.invoice_type = k.invoice_type AND nullif(r.ksef_reference_number, '') IS NOT NULL
      AND r.sync_status IS DISTINCT FROM 'error'
      AND (r.invoice_id = k.invoice_id
        OR (replace(private.bank_norm(r.invoice_number), ' ', '') = replace(private.bank_norm(k.invoice_number), ' ', '')
            AND length(replace(private.bank_norm(k.invoice_number), ' ', '')) >= 3
            AND abs(abs(coalesce(r.amount_to_pay_gross, r.gross_amount, 0)) - abs(coalesce(k.amount_to_pay_gross, k.gross_amount, 0))) <= 0.01))
    WHERE k.id = p_ksef_invoice_id AND nullif(k.ksef_reference_number, '') IS NULL
  )
$$;

-- Ta sama faktura w różnych źródłach: KSeF ↔ faktura CRM (powiązanie) oraz ten sam numer, strona,
-- kontrahent (NIP, gdy jest) i kwota w KSeF / CRM / dokumentach spoza KSeF.
CREATE OR REPLACE FUNCTION private.bank_document_twins(p_source text, p_document_id uuid)
RETURNS TABLE (source text, document_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  WITH docs AS (
    SELECT 'ksef'::text AS source, k.id, k.my_company_id AS company_id,
           CASE WHEN k.invoice_type::text = 'issued' THEN 'issued' ELSE 'received' END AS side,
           replace(private.bank_norm(k.invoice_number), ' ', '') AS num,
           regexp_replace(CASE WHEN k.invoice_type::text = 'issued' THEN coalesce(k.buyer_nip, '') ELSE coalesce(k.seller_nip, '') END, '\D', '', 'g') AS nip,
           abs(coalesce(k.amount_to_pay_gross, k.gross_amount, 0)) AS amount,
           k.invoice_id AS local_invoice_id
    FROM public.ksef_invoices k
    UNION ALL
    SELECT 'invoice', i.id, i.my_company_id, 'issued', replace(private.bank_norm(i.invoice_number), ' ', ''),
           regexp_replace(coalesce(i.buyer_nip, ''), '\D', '', 'g'), abs(coalesce(i.total_gross, 0)), i.id
    FROM public.invoices i
    WHERE i.status NOT IN ('draft', 'cancelled') AND i.invoice_type <> 'proforma'
    UNION ALL
    SELECT 'external', e.id, e.my_company_id, 'received', replace(private.bank_norm(e.invoice_number), ' ', ''),
           regexp_replace(coalesce(e.seller_nip, ''), '\D', '', 'g'), abs(coalesce(e.amount_gross, 0)), NULL::uuid
    FROM public.external_invoices e
    WHERE e.payment_status <> 'cancelled'
  ), seed AS (
    SELECT * FROM docs WHERE docs.source = p_source AND docs.id = p_document_id
  )
  SELECT d.source, d.id
  FROM docs d JOIN seed s ON d.company_id IS NOT DISTINCT FROM s.company_id AND d.side = s.side
  WHERE (length(s.num) >= 3 AND d.num = s.num AND (d.nip = s.nip OR d.nip = '' OR s.nip = '')
         AND abs(d.amount - s.amount) <= 0.01)
     OR (s.local_invoice_id IS NOT NULL AND d.local_invoice_id = s.local_invoice_id)
  UNION
  SELECT p_source, p_document_id
$$;

CREATE OR REPLACE FUNCTION private.money_pl(p_value numeric)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = pg_catalog AS $$
  SELECT replace(to_char(round(coalesce(p_value, 0), 2), 'FM999999999990.00'), '.', ',') || ' zł'
$$;

CREATE OR REPLACE FUNCTION private.guard_bank_match_integrity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_bt public.bank_transactions%ROWTYPE;
  v_allocated numeric;
  v_due numeric;
  v_paid numeric;
  v_number text;
BEGIN
  SELECT * INTO v_bt FROM public.bank_transactions WHERE id = NEW.bank_transaction_id;
  IF NOT FOUND THEN RETURN NEW; END IF;

  IF v_bt.canonical_transaction_id IS NOT NULL THEN
    RAISE EXCEPTION 'Ta operacja to kopia z drugiego wyciągu (PDF/MT940). Rozliczaj operację potwierdzoną — jedną dla obu plików.'
      USING ERRCODE = '23514';
  END IF;
  IF v_bt.paired_bank_transaction_id IS NOT NULL THEN
    RAISE EXCEPTION 'To przeniesienie między rachunkiem bieżącym a VAT, a nie płatność faktury.' USING ERRCODE = '23514';
  END IF;

  SELECT coalesce(sum(m.amount), 0) INTO v_allocated
  FROM public.bank_transaction_invoice_matches m
  WHERE m.bank_transaction_id = NEW.bank_transaction_id AND m.id <> NEW.id;
  v_allocated := v_allocated + coalesce((
    SELECT sum(p.amount) FROM public.personnel_contract_payments p WHERE p.bank_transaction_id = NEW.bank_transaction_id
  ), 0);
  IF v_allocated + NEW.amount > abs(v_bt.amount) + 0.01 THEN
    RAISE EXCEPTION 'Operacja z % na % byłaby rozliczona ponad swoją kwotę (przypisano już %).',
      to_char(v_bt.transaction_date, 'DD.MM.YYYY'), private.money_pl(abs(v_bt.amount)), private.money_pl(v_allocated)
      USING ERRCODE = '23514';
  END IF;

  -- Przeniesienie istniejącego rozliczenia na inną operację (scalanie wyciągów, usunięcie pliku):
  -- dokument i kwota się nie zmieniają, więc sprawdzamy tylko operację.
  IF TG_OP = 'UPDATE' AND NEW.amount = OLD.amount
     AND NEW.document_amount IS NOT DISTINCT FROM OLD.document_amount
     AND NEW.invoice_id IS NOT DISTINCT FROM OLD.invoice_id
     AND NEW.ksef_invoice_id IS NOT DISTINCT FROM OLD.ksef_invoice_id
     AND NEW.external_invoice_id IS NOT DISTINCT FROM OLD.external_invoice_id THEN
    RETURN NEW;
  END IF;

  IF NEW.ksef_invoice_id IS NOT NULL AND private.ksef_invoice_is_shadow(NEW.ksef_invoice_id) THEN
    SELECT invoice_number INTO v_number FROM public.ksef_invoices WHERE id = NEW.ksef_invoice_id;
    RAISE EXCEPTION 'Faktura % w tej pozycji to robocza kopia bez numeru KSeF. Rozlicz wpis z numerem KSeF.', coalesce(v_number, '')
      USING ERRCODE = '23514';
  END IF;

  v_due := abs(coalesce(public.bank_document_due_amount(NEW.invoice_id, NEW.ksef_invoice_id, NEW.external_invoice_id), 0));
  SELECT coalesce(sum(coalesce(m.document_amount, m.amount)), 0) INTO v_paid
  FROM public.bank_transaction_invoice_matches m
  JOIN private.bank_document_twins(NEW.document_source, coalesce(NEW.ksef_invoice_id, NEW.invoice_id, NEW.external_invoice_id)) t
    ON (t.source = 'ksef' AND m.ksef_invoice_id = t.document_id)
    OR (t.source = 'invoice' AND m.invoice_id = t.document_id)
    OR (t.source = 'external' AND m.external_invoice_id = t.document_id)
  WHERE m.id <> NEW.id;
  IF v_due > 0 AND v_paid + coalesce(NEW.document_amount, NEW.amount) > v_due + 0.01 THEN
    RAISE EXCEPTION 'Ta faktura (albo jej kopia w innym źródle) jest już opłacona z wyciągu: % z %. Druga płatność nie może jej rozliczyć ponownie.',
      private.money_pl(v_paid), private.money_pl(v_due) USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS bank_match_integrity_guard ON public.bank_transaction_invoice_matches;
CREATE TRIGGER bank_match_integrity_guard
  BEFORE INSERT OR UPDATE OF bank_transaction_id, amount, document_amount, invoice_id, ksef_invoice_id, external_invoice_id
  ON public.bank_transaction_invoice_matches
  FOR EACH ROW EXECUTE FUNCTION private.guard_bank_match_integrity();

CREATE OR REPLACE FUNCTION private.guard_personnel_bank_allocation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_bt public.bank_transactions%ROWTYPE;
  v_allocated numeric;
BEGIN
  IF NEW.bank_transaction_id IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW.bank_transaction_id IS NOT DISTINCT FROM OLD.bank_transaction_id
     AND NEW.amount IS NOT DISTINCT FROM OLD.amount THEN
    RETURN NEW;
  END IF;
  SELECT * INTO v_bt FROM public.bank_transactions WHERE id = NEW.bank_transaction_id;
  IF NOT FOUND THEN RETURN NEW; END IF;
  IF v_bt.canonical_transaction_id IS NOT NULL THEN
    RAISE EXCEPTION 'Ta operacja to kopia z drugiego wyciągu (PDF/MT940). Rozliczaj operację potwierdzoną.' USING ERRCODE = '23514';
  END IF;
  IF v_bt.paired_bank_transaction_id IS NOT NULL THEN
    RAISE EXCEPTION 'To przeniesienie między rachunkiem bieżącym a VAT, a nie wypłata.' USING ERRCODE = '23514';
  END IF;
  SELECT coalesce(sum(m.amount), 0) INTO v_allocated
  FROM public.bank_transaction_invoice_matches m WHERE m.bank_transaction_id = NEW.bank_transaction_id;
  v_allocated := v_allocated + coalesce((
    SELECT sum(p.amount) FROM public.personnel_contract_payments p
    WHERE p.bank_transaction_id = NEW.bank_transaction_id AND p.id <> NEW.id
  ), 0);
  IF v_allocated + NEW.amount > abs(v_bt.amount) + 0.01 THEN
    RAISE EXCEPTION 'Operacja z % na % byłaby rozliczona ponad swoją kwotę (przypisano już %).',
      to_char(v_bt.transaction_date, 'DD.MM.YYYY'), private.money_pl(abs(v_bt.amount)), private.money_pl(v_allocated)
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS personnel_bank_allocation_guard ON public.personnel_contract_payments;
CREATE TRIGGER personnel_bank_allocation_guard
  BEFORE INSERT OR UPDATE OF bank_transaction_id, amount ON public.personnel_contract_payments
  FOR EACH ROW EXECUTE FUNCTION private.guard_personnel_bank_allocation();

-- 3. Propozycje i historia uzgodnień ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.bank_reconciliation_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_transaction_id uuid NOT NULL REFERENCES public.bank_transactions(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('allocate', 'choose', 'hint')),
  rule text NOT NULL,
  documents jsonb NOT NULL DEFAULT '[]'::jsonb,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'accepted', 'rejected', 'superseded')),
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  decided_by uuid
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_bank_reconciliation_open_proposal
  ON public.bank_reconciliation_proposals(bank_transaction_id) WHERE status = 'open';
COMMENT ON TABLE public.bank_reconciliation_proposals IS
  'Propozycje reguł uzgadniania: allocate – dokumenty do zatwierdzenia, choose – wybór jednego z kilku, hint – wskazówka bez dokumentu.';

CREATE TABLE IF NOT EXISTS public.bank_reconciliation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  my_company_id uuid NOT NULL REFERENCES public.my_companies(id) ON DELETE CASCADE,
  statement_year integer NOT NULL,
  statement_month integer NOT NULL CHECK (statement_month BETWEEN 1 AND 12),
  summary jsonb NOT NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bank_reconciliation_runs_period
  ON public.bank_reconciliation_runs(my_company_id, statement_year, statement_month, created_at DESC);

ALTER TABLE public.bank_reconciliation_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_reconciliation_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bank_reconciliation_proposals_read ON public.bank_reconciliation_proposals;
CREATE POLICY bank_reconciliation_proposals_read ON public.bank_reconciliation_proposals
  FOR SELECT TO authenticated
  USING (public.finance_can_view() AND EXISTS (
    SELECT 1 FROM public.bank_transactions bt JOIN public.bank_statements bs ON bs.id = bt.statement_id
    WHERE bt.id = bank_reconciliation_proposals.bank_transaction_id AND public.finance_company_visible(bs.my_company_id)));
DROP POLICY IF EXISTS sales_finance_private ON public.bank_reconciliation_proposals;
CREATE POLICY sales_finance_private ON public.bank_reconciliation_proposals AS RESTRICTIVE FOR ALL TO authenticated
  USING (public.invoice_finance_scope() <> 'sales') WITH CHECK (public.invoice_finance_scope() <> 'sales');
DROP POLICY IF EXISTS bank_reconciliation_runs_read ON public.bank_reconciliation_runs;
CREATE POLICY bank_reconciliation_runs_read ON public.bank_reconciliation_runs
  FOR SELECT TO authenticated
  USING (public.finance_can_view() AND public.finance_company_visible(my_company_id));
DROP POLICY IF EXISTS sales_finance_private ON public.bank_reconciliation_runs;
CREATE POLICY sales_finance_private ON public.bank_reconciliation_runs AS RESTRICTIVE FOR ALL TO authenticated
  USING (public.invoice_finance_scope() <> 'sales') WITH CHECK (public.invoice_finance_scope() <> 'sales');
REVOKE INSERT, UPDATE, DELETE ON public.bank_reconciliation_proposals, public.bank_reconciliation_runs FROM anon, authenticated;
GRANT SELECT ON public.bank_reconciliation_proposals, public.bank_reconciliation_runs TO authenticated;

-- 4. Dokumenty do uzgodnienia (KSeF, CRM, spoza KSeF) ------------------------------------------
-- due – kwota do zapłaty; bank_paid – zapłacone z wyciągu; manual_paid – oznaczone ręcznie (bez wyciągu);
-- twin_key – ta sama faktura w różnych źródłach liczy się raz.
CREATE OR REPLACE FUNCTION private.bank_reconciliation_documents(p_company_id uuid)
RETURNS TABLE (
  source text, document_id uuid, number text, ksef_ref text, party text, nip text, side text, dir text,
  currency text, issue_date date, due_date date, due numeric, bank_paid numeric, manual_paid numeric,
  manual_date date, payment_status text, local_invoice_id uuid, is_shadow boolean,
  num_norm text, num_compact text, num_ok boolean, party_token text, twin_key text
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  WITH bank AS (
    SELECT m.ksef_invoice_id, m.invoice_id, m.external_invoice_id,
           sum(coalesce(m.document_amount, m.amount)) AS amount
    FROM public.bank_transaction_invoice_matches m
    GROUP BY 1, 2, 3
  ), kp AS (
    SELECT p.ksef_invoice_id,
           sum(p.amount) AS total,
           sum(p.amount) FILTER (WHERE p.bank_match_id IS NOT NULL) AS bank,
           max(p.payment_date) FILTER (WHERE p.bank_match_id IS NULL) AS manual_date
    FROM public.ksef_invoice_payments p
    GROUP BY 1
  ), ksef0 AS (
    SELECT k.*, replace(private.bank_norm(k.invoice_number), ' ', '') AS num,
           abs(coalesce(k.amount_to_pay_gross, k.gross_amount, 0)) AS abs_amount
    FROM public.ksef_invoices k
    WHERE k.my_company_id = p_company_id AND k.sync_status IS DISTINCT FROM 'error'
  ), ksef AS (
    SELECT 'ksef'::text AS source, k.id, k.invoice_number AS number, nullif(k.ksef_reference_number, '') AS ksef_ref,
           CASE WHEN k.invoice_type::text = 'issued' THEN k.buyer_name ELSE k.seller_name END AS party,
           regexp_replace(CASE WHEN k.invoice_type::text = 'issued' THEN coalesce(k.buyer_nip, '') ELSE coalesce(k.seller_nip, '') END, '\D', '', 'g') AS nip,
           CASE WHEN k.invoice_type::text = 'issued' THEN 'issued' ELSE 'received' END AS side,
           CASE
             WHEN k.invoice_type::text = 'issued' AND coalesce(k.amount_to_pay_gross, k.gross_amount, 0) >= 0 THEN 'credit'
             WHEN k.invoice_type::text = 'issued' THEN 'debit'
             WHEN coalesce(k.amount_to_pay_gross, k.gross_amount, 0) >= 0 THEN 'debit'
             ELSE 'credit'
           END AS dir,
           upper(coalesce(k.currency, 'PLN')) AS currency, k.issue_date, k.payment_due_date AS due_date,
           k.abs_amount AS due,
           coalesce(b.amount, 0) AS bank_paid,
           CASE WHEN k.payment_status = 'paid' THEN greatest(k.abs_amount - coalesce(kp.bank, 0), 0)
                ELSE greatest(coalesce(kp.total, 0) - coalesce(kp.bank, 0), 0) END AS manual_paid,
           coalesce(kp.manual_date, k.payment_date::date) AS manual_date,
           k.payment_status, k.invoice_id AS local_invoice_id,
           (nullif(k.ksef_reference_number, '') IS NULL AND EXISTS (
              SELECT 1 FROM ksef0 r
              WHERE r.id <> k.id AND r.invoice_type = k.invoice_type AND nullif(r.ksef_reference_number, '') IS NOT NULL
                AND (r.invoice_id = k.invoice_id OR (length(k.num) >= 3 AND r.num = k.num AND abs(r.abs_amount - k.abs_amount) <= 0.01))
           )) AS is_shadow
    FROM ksef0 k
    LEFT JOIN bank b ON b.ksef_invoice_id = k.id AND b.invoice_id IS NULL AND b.external_invoice_id IS NULL
    LEFT JOIN kp ON kp.ksef_invoice_id = k.id
  ), crm AS (
    SELECT 'invoice'::text AS source, i.id, i.invoice_number, nullif(i.ksef_reference_number, ''),
           i.buyer_name, regexp_replace(coalesce(i.buyer_nip, ''), '\D', '', 'g'), 'issued',
           CASE WHEN i.invoice_type = 'corrective' AND i.total_gross < 0 THEN 'debit' ELSE 'credit' END,
           upper(coalesce(i.currency_code, 'PLN')), i.issue_date, i.payment_due_date,
           public.bank_document_due_amount(i.id, NULL, NULL) AS due,
           coalesce(b.amount, 0) AS bank_paid,
           CASE
             WHEN EXISTS (SELECT 1 FROM ksef0 k WHERE k.invoice_id = i.id AND nullif(k.ksef_reference_number, '') IS NOT NULL) THEN 0
             WHEN i.status = 'paid' OR i.payment_status = 'paid'
               THEN greatest(public.bank_document_due_amount(i.id, NULL, NULL) - coalesce(b.amount, 0), 0)
             ELSE coalesce(i.manual_paid_amount, 0)
           END,
           i.paid_date, coalesce(i.payment_status, i.status), i.id, false
    FROM public.invoices i
    LEFT JOIN bank b ON b.invoice_id = i.id
    WHERE i.my_company_id = p_company_id AND i.status NOT IN ('draft', 'cancelled', 'proforma')
      AND i.invoice_type <> 'proforma'
  ), ext AS (
    SELECT 'external'::text AS source, e.id, e.invoice_number, NULL::text, e.seller_name,
           regexp_replace(coalesce(e.seller_nip, ''), '\D', '', 'g'), 'received',
           CASE WHEN coalesce(e.amount_gross, 0) >= 0 THEN 'debit' ELSE 'credit' END,
           upper(coalesce(e.currency, 'PLN')), e.invoice_date, NULL::date,
           abs(coalesce(e.amount_gross, 0)) AS due,
           coalesce(b.amount, 0) AS bank_paid,
           CASE WHEN e.payment_status = 'paid'
                THEN greatest(abs(coalesce(e.amount_gross, 0)) - coalesce(b.amount, 0), 0)
                ELSE coalesce(e.manual_paid_amount, 0) END,
           e.payment_date, e.payment_status, NULL::uuid, false
    FROM public.external_invoices e
    LEFT JOIN bank b ON b.external_invoice_id = e.id
    WHERE e.my_company_id = p_company_id AND e.payment_status <> 'cancelled' AND NOT e.payment_amount_needs_review
  ), all_docs AS (
    SELECT * FROM ksef UNION ALL SELECT * FROM crm UNION ALL SELECT * FROM ext
  )
  SELECT d.source, d.id, d.number, d.ksef_ref, d.party, d.nip, d.side, d.dir, d.currency, d.issue_date, d.due_date,
         d.due, d.bank_paid, d.manual_paid, d.manual_date, d.payment_status, d.local_invoice_id, d.is_shadow,
         private.bank_norm(d.number), replace(private.bank_norm(d.number), ' ', ''),
         private.bank_number_usable(d.number),
         coalesce((
           SELECT w FROM regexp_split_to_table(private.bank_norm(d.party), ' ') WITH ORDINALITY AS t(w, o)
           WHERE length(w) >= 4 AND w NOT IN ('SPOLKA', 'SPOLKI', 'FIRMA', 'USLUGI', 'HANDLOWA', 'HANDEL', 'PRZEDSIEBIORSTWO',
             'PPHU', 'GRUPA', 'POLSKA', 'POLSKIE', 'OGRANICZONA', 'ODPOWIEDZIALNOSCIA', 'AKCYJNA', 'KOMANDYTOWA', 'JAWNA',
             'CYWILNA', 'HOTEL', 'HOTELS', 'STUDIO', 'CENTRUM', 'AGENCJA')
           ORDER BY o LIMIT 1), '') AS party_token,
         CASE
           WHEN d.local_invoice_id IS NOT NULL THEN 'L:' || d.local_invoice_id::text
           WHEN length(replace(private.bank_norm(d.number), ' ', '')) >= 3
             THEN d.side || ':' || replace(private.bank_norm(d.number), ' ', '') || ':' || round(d.due, 2)::text
           ELSE d.source || ':' || d.id::text
         END AS twin_key
  FROM all_docs d
$$;

-- 5. Reguły kategorii (operacje bez faktury) ---------------------------------------------------
CREATE OR REPLACE FUNCTION private.bank_category_rule(p_norm text, p_compact text, p_counterparty_norm text,
  p_direction text, p_amount numeric)
RETURNS TABLE (category text, subtype text, rule text, note text)
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog AS $$
BEGIN
  IF p_norm ~ '(^| )IDC( |$)' THEN RETURN; END IF; -- podzielona płatność (split payment) to nie podatek
  IF p_norm ~ '(^| )ZUS( |$)' OR p_compact LIKE '%ZAKLADUBEZPIECZENSPOLECZNYCH%' THEN
    RETURN QUERY SELECT 'tax_or_zus', 'zus_payment', 'zus', 'Płatność ZUS — w tytule przelewu jest „ZUS”.';
  ELSIF p_compact ~ 'N[0-9]{10}[0-9]{2}[MKRP][0-9]{0,2}' OR p_compact LIKE '%URZADSKARBOWY%'
        OR p_compact ~ '(PIT4R|VAT7|JPKV7|CIT8|PIT36|PIT5L|PIT5)' THEN
    IF p_compact LIKE '%PIT4R%' THEN
      RETURN QUERY SELECT 'tax_or_zus', 'pit4_payment', 'podatek', 'Płatność PIT-4R — przelew podatkowy do urzędu skarbowego.';
    ELSIF p_compact ~ '(VAT7|JPKV7)' THEN
      RETURN QUERY SELECT 'tax_or_zus', 'vat7_payment', 'podatek', 'Płatność VAT-7 — przelew podatkowy do urzędu skarbowego.';
    ELSIF p_direction = 'credit' THEN
      RETURN QUERY SELECT 'tax_or_zus', 'other', 'podatek', 'Wpływ z urzędu skarbowego (zwrot podatku).';
    ELSE
      RETURN QUERY SELECT 'tax_or_zus', 'other', 'podatek', 'Przelew do urzędu skarbowego.';
    END IF;
  ELSIF p_direction = 'debit' AND p_amount <= 50 AND coalesce(p_counterparty_norm, '') = ''
        AND p_norm ~ '^(OPL|OPLATA|PROWIZJA|PROW)( |$)' THEN
    RETURN QUERY SELECT 'bank_fee', 'bank_fee', 'oplata_bankowa', 'Opłata lub prowizja bankowa (tytuł banku, bez kontrahenta).';
  END IF;
END;
$$;

-- 6. Propozycje -------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.add_bank_proposal(p_transaction_id uuid, p_kind text, p_rule text,
  p_documents jsonb, p_reason text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  -- Odrzucona przez człowieka propozycja nie wraca przy kolejnym uzgodnieniu.
  IF EXISTS (
    SELECT 1 FROM public.bank_reconciliation_proposals
    WHERE bank_transaction_id = p_transaction_id AND status = 'rejected' AND rule = p_rule
      AND documents @> p_documents AND p_documents @> documents
  ) THEN
    RETURN false;
  END IF;
  INSERT INTO public.bank_reconciliation_proposals (bank_transaction_id, kind, rule, documents, reason)
  VALUES (p_transaction_id, p_kind, p_rule, coalesce(p_documents, '[]'::jsonb), p_reason)
  ON CONFLICT (bank_transaction_id) WHERE status = 'open' DO UPDATE
    SET kind = EXCLUDED.kind, rule = EXCLUDED.rule, documents = EXCLUDED.documents,
        reason = EXCLUDED.reason, created_at = now();
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION private.bank_proposal_document(p_doc jsonb, p_amount numeric, p_evidence text DEFAULT NULL)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
  SELECT jsonb_strip_nulls(jsonb_build_object(
    'source', p_doc ->> 'source', 'id', p_doc ->> 'document_id', 'number', p_doc ->> 'number', 'party', p_doc ->> 'party',
    'amount', round(p_amount, 2), 'due', round((p_doc ->> 'due')::numeric, 2), 'open', round((p_doc ->> 'open_bank')::numeric, 2),
    'manual', (p_doc ->> 'open_bank')::numeric <= 0.009 AND (p_doc ->> 'manual_open')::numeric > 0.009,
    'due_date', p_doc ->> 'due_date', 'issue_date', p_doc ->> 'issue_date', 'evidence', p_evidence))
$$;

-- 7. Uzgodnienie miesiąca --------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reconcile_bank_month(p_company_id uuid, p_year integer, p_month integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_sources jsonb;
  t record;
  d record;
  v_hits integer;
  v_open_sum numeric;
  v_manual_sum numeric;
  v_docs jsonb;
  v_amount numeric;
  v_cat record;
  v_evidence text;
  v_n_all integer;
  v_n_evid integer;
  v_done boolean;
  v_match_id uuid;
  v_auto integer := 0;
  v_auto_manual integer := 0;
  v_auto_explained integer := 0;
  v_proposals integer := 0;
  v_choices integer := 0;
  v_hints integer := 0;
  v_errors integer := 0;
  v_ids uuid[];
  v_rejected uuid[];
  v_amounts numeric[];
  v_n integer;
  v_mask integer;
  v_sum numeric;
  v_count integer;
  v_found integer;
  v_best integer;
  v_summary jsonb;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND NOT (public.finance_can_manage() AND public.finance_company_visible(p_company_id)) THEN
    RAISE EXCEPTION 'Brak uprawnień do uzgadniania wyciągów.' USING ERRCODE = '42501';
  END IF;
  IF p_month NOT BETWEEN 1 AND 12 THEN RAISE EXCEPTION 'Nieprawidłowy miesiąc.'; END IF;

  v_sources := public.confirm_bank_statement_sources(p_company_id, p_year, p_month);

  UPDATE public.bank_reconciliation_proposals pr SET status = 'superseded', decided_at = now()
  FROM public.bank_transactions bt JOIN public.bank_statements s ON s.id = bt.statement_id
  WHERE pr.bank_transaction_id = bt.id AND pr.status = 'open'
    AND s.my_company_id = p_company_id AND s.statement_year = p_year AND s.statement_month = p_month;

  -- Dokumenty: jeden reprezentant na fakturę (KSeF z numerem > KSeF > spoza KSeF > CRM), bez roboczych kopii.
  DROP TABLE IF EXISTS pg_temp.recon_docs;
  CREATE TEMP TABLE recon_docs ON COMMIT DROP AS
  SELECT x.*,
         greatest(x.due - x.group_bank - x.group_manual, 0) AS open_bank,
         least(x.group_manual, greatest(x.due - x.group_bank, 0)) AS manual_open
  FROM (
    SELECT src.*,
           sum(src.bank_paid) OVER (PARTITION BY src.twin_key) AS group_bank,
           max(src.manual_paid) OVER (PARTITION BY src.twin_key) AS group_manual,
           row_number() OVER (PARTITION BY src.twin_key ORDER BY src.is_shadow,
             (src.source = 'ksef' AND src.ksef_ref IS NOT NULL) DESC, (src.source = 'ksef') DESC,
             (src.source = 'external') DESC, src.document_id) = 1 AS is_rep
    FROM private.bank_reconciliation_documents(p_company_id) src
  ) x;
  DELETE FROM recon_docs WHERE NOT is_rep OR is_shadow OR due <= 0.009;

  -- Rachunki kontrahentów poznane z wcześniejszych rozliczeń (IBAN → NIP).
  DROP TABLE IF EXISTS pg_temp.recon_iban;
  CREATE TEMP TABLE recon_iban ON COMMIT DROP AS
  SELECT DISTINCT regexp_replace(bt.counterparty_account, '\D', '', 'g') AS iban,
         regexp_replace(coalesce(
           CASE WHEN k.invoice_type::text = 'issued' THEN k.buyer_nip ELSE k.seller_nip END, e.seller_nip, i.buyer_nip, ''), '\D', '', 'g') AS nip
  FROM public.bank_transaction_invoice_matches m
  JOIN public.bank_transactions bt ON bt.id = m.bank_transaction_id
  LEFT JOIN public.ksef_invoices k ON k.id = m.ksef_invoice_id
  LEFT JOIN public.external_invoices e ON e.id = m.external_invoice_id
  LEFT JOIN public.invoices i ON i.id = m.invoice_id
  WHERE length(regexp_replace(coalesce(bt.counterparty_account, ''), '\D', '', 'g')) >= 20;
  DELETE FROM recon_iban WHERE length(nip) <> 10;

  -- Operacje główne miesiąca z tekstem z obu wyciągów.
  DROP TABLE IF EXISTS pg_temp.recon_tx;
  CREATE TEMP TABLE recon_tx ON COMMIT DROP AS
  SELECT bt.id, bt.transaction_date AS date, abs(bt.amount) AS amount, bt.transaction_type AS dir,
         upper(coalesce(bt.currency, 'PLN')) AS currency,
         greatest(abs(bt.amount) - coalesce((SELECT sum(m.amount) FROM public.bank_transaction_invoice_matches m WHERE m.bank_transaction_id = bt.id), 0)
           - coalesce((SELECT sum(p.amount) FROM public.personnel_contract_payments p WHERE p.bank_transaction_id = bt.id), 0), 0) AS remaining,
         private.bank_norm(concat_ws(' ', bt.title, bt.raw_description, bt.counterparty_name, bt.raw_counterparty, bt.reference_number,
           (SELECT string_agg(concat_ws(' ', c.title, c.raw_description, c.counterparty_name, c.raw_counterparty), ' ')
            FROM public.bank_transactions c WHERE c.canonical_transaction_id = bt.id))) AS text_norm,
         private.bank_norm(coalesce(nullif(btrim(bt.counterparty_name), ''), bt.raw_counterparty)) AS counterparty_norm,
         regexp_replace(coalesce(bt.counterparty_account, ''), '\D', '', 'g') AS iban,
         bt.accounting_review_status = 'explained' AS explained,
         coalesce(bt.accounting_explained_by, '') AS explained_by,
         bt.paired_bank_transaction_id IS NOT NULL OR bt.private_transfer_detected AS transfer
  FROM public.bank_transactions bt
  JOIN public.bank_statements s ON s.id = bt.statement_id
  WHERE s.my_company_id = p_company_id AND s.statement_year = p_year AND s.statement_month = p_month
    AND s.processed AND s.validation_status = 'valid' AND bt.canonical_transaction_id IS NULL;
  ALTER TABLE recon_tx ADD COLUMN text_compact text;
  UPDATE recon_tx SET text_compact = replace(text_norm, ' ', '');

  FOR t IN SELECT * FROM recon_tx WHERE remaining > 0.009 AND NOT explained AND NOT transfer ORDER BY date, id LOOP
    v_done := false;
    -- Dokumenty, które człowiek odrzucił dla tej operacji (propozycja lub cofnięte dopasowanie), nie wracają.
    SELECT coalesce(array_agg(DISTINCT (e ->> 'id')::uuid), '{}'::uuid[]) INTO v_rejected
    FROM public.bank_reconciliation_proposals pr, jsonb_array_elements(pr.documents) e
    WHERE pr.bank_transaction_id = t.id AND pr.status = 'rejected' AND e ? 'id';

    -- Reguła 1–2: numer(y) dokumentu w tytule przelewu.
    SELECT count(*), coalesce(sum(rd.open_bank), 0), coalesce(sum(rd.manual_open), 0)
    INTO v_hits, v_open_sum, v_manual_sum
    FROM recon_docs rd
    WHERE rd.dir = t.dir AND rd.currency = t.currency AND NOT (rd.document_id = ANY(v_rejected)) AND rd.num_ok
      AND (rd.open_bank > 0.009 OR rd.manual_open > 0.009)
      AND (position(' ' || rd.num_norm || ' ' IN ' ' || t.text_norm || ' ') > 0
           OR (length(rd.num_compact) >= 8 AND position(rd.num_compact IN t.text_compact) > 0));

    IF v_hits = 1 THEN
      SELECT * INTO d FROM recon_docs rd
      WHERE rd.dir = t.dir AND rd.currency = t.currency AND NOT (rd.document_id = ANY(v_rejected)) AND rd.num_ok
        AND (rd.open_bank > 0.009 OR rd.manual_open > 0.009)
        AND (position(' ' || rd.num_norm || ' ' IN ' ' || t.text_norm || ' ') > 0
             OR (length(rd.num_compact) >= 8 AND position(rd.num_compact IN t.text_compact) > 0))
      LIMIT 1;
      v_done := true;
      IF abs(d.open_bank - t.remaining) <= 0.01 AND d.manual_open <= 0.009 THEN
        BEGIN
          PERFORM public.match_bank_transaction_to_document(t.id, d.source, d.document_id, t.remaining, 0.99, 'automatic',
            ARRAY['Reguła „numer i kwota”: w tytule przelewu jest numer ' || coalesce(d.number, ''),
                  'Kwota ' || private.money_pl(t.remaining) || ' = kwota do zapłaty']);
          UPDATE recon_docs SET open_bank = open_bank - t.remaining WHERE twin_key = d.twin_key;
          v_auto := v_auto + 1;
        EXCEPTION WHEN OTHERS THEN
          v_errors := v_errors + 1;
          IF private.add_bank_proposal(t.id, 'allocate', 'numer_i_kwota', jsonb_build_array(private.bank_proposal_document(to_jsonb(d), t.remaining)),
               'Numer ' || coalesce(d.number, '') || ' i kwota się zgadzają, ale automatyczne rozliczenie zatrzymała kontrola: ' || SQLERRM) THEN
            v_proposals := v_proposals + 1;
          END IF;
        END;
      ELSIF abs(d.manual_open - t.remaining) <= 0.01 AND d.open_bank <= 0.009 AND d.source = 'ksef' THEN
        -- Faktura oznaczona ręcznie jako opłacona — wyciąg to potwierdza: ręczny wpis zastępuje powiązanie z wyciągiem.
        BEGIN
          SELECT (public.reconcile_paid_ksef_invoice_with_bank_transaction(t.id, d.document_id, t.remaining, 0.99,
            ARRAY['Reguła „opłacona ręcznie — potwierdzona wyciągiem”: numer ' || coalesce(d.number, '') || ' w tytule, kwota ' || private.money_pl(t.remaining)])).id
          INTO v_match_id;
          UPDATE public.bank_transaction_invoice_matches SET match_method = 'automatic' WHERE id = v_match_id;
          UPDATE recon_docs SET manual_open = greatest(manual_open - t.remaining, 0) WHERE twin_key = d.twin_key;
          v_auto_manual := v_auto_manual + 1;
        EXCEPTION WHEN OTHERS THEN
          v_errors := v_errors + 1;
          IF private.add_bank_proposal(t.id, 'allocate', 'oplacona_recznie', jsonb_build_array(private.bank_proposal_document(to_jsonb(d), t.remaining)),
               'Faktura ' || coalesce(d.number, '') || ' jest oznaczona ręcznie jako opłacona, a przelew ją potwierdza. Automatyczne powiązanie zatrzymała kontrola: ' || SQLERRM) THEN
            v_proposals := v_proposals + 1;
          END IF;
        END;
      ELSIF abs(d.manual_open - t.remaining) <= 0.01 AND d.open_bank <= 0.009 THEN
        IF private.add_bank_proposal(t.id, 'allocate', 'oplacona_recznie', jsonb_build_array(private.bank_proposal_document(to_jsonb(d), t.remaining)),
             'Faktura ' || coalesce(d.number, '') || ' jest oznaczona ręcznie jako opłacona. Przelew z jej numerem i tą samą kwotą to potwierdza — zatwierdź, aby powiązać płatność z wyciągiem.') THEN
          v_proposals := v_proposals + 1;
        END IF;
      ELSIF t.remaining < d.open_bank - 0.01 THEN
        IF private.add_bank_proposal(t.id, 'allocate', 'numer_czesciowa', jsonb_build_array(private.bank_proposal_document(to_jsonb(d), t.remaining)),
             'W tytule jest numer ' || coalesce(d.number, '') || ', ale przelew (' || private.money_pl(t.remaining) || ') jest mniejszy niż kwota do zapłaty (' ||
             private.money_pl(d.open_bank) || '). To może być zaliczka lub płatność częściowa.') THEN
          v_proposals := v_proposals + 1;
        END IF;
      ELSE
        IF private.add_bank_proposal(t.id, 'hint', 'numer_inna_kwota', jsonb_build_array(private.bank_proposal_document(to_jsonb(d), least(t.remaining, d.open_bank + d.manual_open))),
             'W tytule jest numer ' || coalesce(d.number, '') || ', ale przelew (' || private.money_pl(t.remaining) || ') jest większy niż pozostało do zapłaty (' ||
             private.money_pl(d.open_bank + d.manual_open) || '). Sprawdź, czy przelew nie obejmuje kilku dokumentów.') THEN
          v_hints := v_hints + 1;
        END IF;
      END IF;
    ELSIF v_hits > 1 THEN
      v_done := true;
      SELECT jsonb_agg(private.bank_proposal_document(to_jsonb(rd), CASE WHEN rd.open_bank > 0.009 THEN rd.open_bank ELSE rd.manual_open END) ORDER BY rd.due_date NULLS LAST, rd.number)
      INTO v_docs
      FROM recon_docs rd
      WHERE rd.dir = t.dir AND rd.currency = t.currency AND NOT (rd.document_id = ANY(v_rejected)) AND rd.num_ok
        AND (rd.open_bank > 0.009 OR rd.manual_open > 0.009)
        AND (position(' ' || rd.num_norm || ' ' IN ' ' || t.text_norm || ' ') > 0
             OR (length(rd.num_compact) >= 8 AND position(rd.num_compact IN t.text_compact) > 0));
      IF abs(v_open_sum - t.remaining) <= 0.01 AND v_manual_sum <= 0.009 THEN
        -- Płatność zbiorcza z numerami wszystkich faktur w tytule (np. koszyk Allegro).
        BEGIN
          FOR d IN SELECT * FROM recon_docs rd
                   WHERE rd.dir = t.dir AND rd.currency = t.currency AND NOT (rd.document_id = ANY(v_rejected)) AND rd.num_ok AND rd.open_bank > 0.009
                     AND (position(' ' || rd.num_norm || ' ' IN ' ' || t.text_norm || ' ') > 0
                          OR (length(rd.num_compact) >= 8 AND position(rd.num_compact IN t.text_compact) > 0))
          LOOP
            PERFORM public.match_bank_transaction_to_document(t.id, d.source, d.document_id, d.open_bank, 0.99, 'automatic',
              ARRAY['Reguła „kilka numerów w tytule”: ' || v_hits || ' faktur, suma = kwota przelewu ' || private.money_pl(t.remaining),
                    'Numer ' || coalesce(d.number, '') || ' w tytule przelewu']);
            UPDATE recon_docs SET open_bank = 0 WHERE twin_key = d.twin_key;
          END LOOP;
          v_auto := v_auto + 1;
        EXCEPTION WHEN OTHERS THEN
          v_errors := v_errors + 1;
          IF private.add_bank_proposal(t.id, 'allocate', 'kilka_numerow', v_docs,
               'W tytule są numery ' || v_hits || ' faktur, a ich suma równa się przelewowi. Automatyczne rozliczenie zatrzymała kontrola: ' || SQLERRM) THEN
            v_proposals := v_proposals + 1;
          END IF;
        END;
      ELSIF abs(v_open_sum + v_manual_sum - t.remaining) <= 0.01 THEN
        IF private.add_bank_proposal(t.id, 'allocate', 'kilka_numerow', v_docs,
             'W tytule są numery ' || v_hits || ' faktur, ich suma równa się przelewowi (część jest oznaczona ręcznie jako opłacona).') THEN
          v_proposals := v_proposals + 1;
        END IF;
      ELSE
        IF private.add_bank_proposal(t.id, 'choose', 'kilka_numerow', v_docs,
             'W tytule są numery kilku faktur, ale ich suma (' || private.money_pl(v_open_sum + v_manual_sum) || ') nie równa się przelewowi (' ||
             private.money_pl(t.remaining) || '). Wybierz właściwe dokumenty.') THEN
          v_choices := v_choices + 1;
        END IF;
      END IF;
    END IF;

    -- Reguła 3: operacje bez faktury rozpoznawane po tytule (ZUS, podatki, opłaty bankowe).
    IF NOT v_done AND t.explained_by NOT LIKE 'rejected:%' THEN
      SELECT * INTO v_cat FROM private.bank_category_rule(t.text_norm, t.text_compact, t.counterparty_norm, t.dir, t.amount) LIMIT 1;
      IF v_cat.category IS NOT NULL THEN
        UPDATE public.bank_transactions
        SET accounting_review_status = 'explained', accounting_category = v_cat.category, accounting_subtype = v_cat.subtype,
            accounting_note = coalesce(accounting_note, v_cat.note), accounting_reviewed_at = now(),
            accounting_explained_by = 'rule:' || v_cat.rule
        WHERE id = t.id;
        v_auto_explained := v_auto_explained + 1;
        v_done := true;
      END IF;
    END IF;

    -- Reguła 4: zgodna kwota (i kontrahent) — zawsze do zatwierdzenia przez człowieka.
    IF NOT v_done THEN
      SELECT count(*),
             count(*) FILTER (WHERE (length(rd.nip) = 10 AND position(rd.nip IN t.text_compact) > 0)
               OR EXISTS (SELECT 1 FROM recon_iban ri WHERE ri.iban = t.iban AND ri.nip = rd.nip)
               OR (rd.party_token <> '' AND position(' ' || rd.party_token || ' ' IN ' ' || t.text_norm || ' ') > 0))
      INTO v_n_all, v_n_evid
      FROM recon_docs rd
      WHERE rd.dir = t.dir AND rd.currency = t.currency AND NOT (rd.document_id = ANY(v_rejected))
        AND (abs(rd.open_bank - t.remaining) <= 0.01 OR (rd.open_bank <= 0.009 AND abs(rd.manual_open - t.remaining) <= 0.01));

      IF v_n_evid = 1 OR v_n_all = 1 THEN
        SELECT rd.*, CASE
                 WHEN length(rd.nip) = 10 AND position(rd.nip IN t.text_compact) > 0 THEN 'NIP ' || rd.nip || ' w treści przelewu'
                 WHEN EXISTS (SELECT 1 FROM recon_iban ri WHERE ri.iban = t.iban AND ri.nip = rd.nip) THEN 'ten sam rachunek kontrahenta co we wcześniejszych płatnościach'
                 WHEN rd.party_token <> '' AND position(' ' || rd.party_token || ' ' IN ' ' || t.text_norm || ' ') > 0 THEN 'nazwa kontrahenta („' || rd.party_token || '”) w przelewie'
               END AS ev
        INTO d
        FROM recon_docs rd
        WHERE rd.dir = t.dir AND rd.currency = t.currency AND NOT (rd.document_id = ANY(v_rejected))
          AND (abs(rd.open_bank - t.remaining) <= 0.01 OR (rd.open_bank <= 0.009 AND abs(rd.manual_open - t.remaining) <= 0.01))
        ORDER BY ((length(rd.nip) = 10 AND position(rd.nip IN t.text_compact) > 0)
               OR EXISTS (SELECT 1 FROM recon_iban ri WHERE ri.iban = t.iban AND ri.nip = rd.nip)
               OR (rd.party_token <> '' AND position(' ' || rd.party_token || ' ' IN ' ' || t.text_norm || ' ') > 0)) DESC
        LIMIT 1;
        v_evidence := d.ev;
        IF v_evidence IS NOT NULL OR v_n_all = 1 THEN
          IF private.add_bank_proposal(t.id, 'allocate', CASE WHEN v_evidence IS NOT NULL THEN 'kwota_i_kontrahent' ELSE 'tylko_kwota' END,
               jsonb_build_array(private.bank_proposal_document(to_jsonb(d), t.remaining, v_evidence)),
               CASE WHEN v_evidence IS NOT NULL
                 THEN 'Kwota ' || private.money_pl(t.remaining) || ' = do zapłaty za ' || coalesce(d.number, 'dokument') || '; potwierdza to ' || v_evidence || '.'
                 ELSE 'Kwota ' || private.money_pl(t.remaining) || ' = do zapłaty za ' || coalesce(d.number, 'dokument') || ' (jedyny taki dokument), ale kontrahent nie jest potwierdzony — sprawdź przed zatwierdzeniem.'
               END) THEN
            v_proposals := v_proposals + 1;
          END IF;
          v_done := true;
        END IF;
      END IF;

      IF NOT v_done AND v_n_all > 1 THEN
        SELECT jsonb_agg(x.doc ORDER BY x.evid DESC, x.dist) INTO v_docs
        FROM (
          SELECT private.bank_proposal_document(to_jsonb(rd), t.remaining) AS doc,
                 ((length(rd.nip) = 10 AND position(rd.nip IN t.text_compact) > 0)
                  OR EXISTS (SELECT 1 FROM recon_iban ri WHERE ri.iban = t.iban AND ri.nip = rd.nip)
                  OR (rd.party_token <> '' AND position(' ' || rd.party_token || ' ' IN ' ' || t.text_norm || ' ') > 0)) AS evid,
                 abs(coalesce(rd.due_date, rd.issue_date, t.date) - t.date) AS dist
          FROM recon_docs rd
          WHERE rd.dir = t.dir AND rd.currency = t.currency AND NOT (rd.document_id = ANY(v_rejected))
            AND (abs(rd.open_bank - t.remaining) <= 0.01 OR (rd.open_bank <= 0.009 AND abs(rd.manual_open - t.remaining) <= 0.01))
          ORDER BY 2 DESC, 3 LIMIT 5
        ) x;
        IF private.add_bank_proposal(t.id, 'choose', 'kwota_wiele', v_docs,
             v_n_all || ' dokumentów ma tę samą kwotę do zapłaty (' || private.money_pl(t.remaining) || '). Wybierz właściwy.') THEN
          v_choices := v_choices + 1;
        END IF;
        v_done := true;
      END IF;
    END IF;

    -- Reguła 5: płatność zbiorcza (Allegro, PayU, Przelewy24…) — suma kilku faktur z okolicy daty.
    IF NOT v_done AND t.dir = 'debit' AND t.text_compact ~ '(ALLEGRO|PAYU|PRZELEWY24|TPAY|DOTPAY)' THEN
      SELECT array_agg(x.document_id ORDER BY x.dist), array_agg(x.open_bank ORDER BY x.dist)
      INTO v_ids, v_amounts
      FROM (
        SELECT rd.document_id, rd.open_bank, abs(coalesce(rd.issue_date, t.date) - t.date) AS dist
        FROM recon_docs rd
        WHERE rd.dir = 'debit' AND rd.currency = t.currency AND rd.open_bank > 0.009 AND rd.open_bank < t.remaining
          AND NOT (rd.document_id = ANY(v_rejected))
          AND coalesce(rd.issue_date, t.date) BETWEEN t.date - 10 AND t.date + 21
        ORDER BY 3 LIMIT 14
      ) x;
      v_n := coalesce(array_length(v_ids, 1), 0);
      v_found := 0; v_best := NULL;
      IF v_n >= 2 THEN
        FOR v_mask IN 1 .. (1 << v_n) - 1 LOOP
          v_sum := 0; v_count := 0;
          FOR i IN 1 .. v_n LOOP
            IF (v_mask >> (i - 1)) & 1 = 1 THEN v_sum := v_sum + v_amounts[i]; v_count := v_count + 1; END IF;
          END LOOP;
          IF v_count BETWEEN 2 AND 6 AND abs(v_sum - t.remaining) <= 0.01 THEN
            v_found := v_found + 1;
            IF v_best IS NULL THEN v_best := v_mask; END IF;
            EXIT WHEN v_found > 1;
          END IF;
        END LOOP;
      END IF;
      IF v_found = 1 THEN
        SELECT jsonb_agg(private.bank_proposal_document(to_jsonb(rd), rd.open_bank) ORDER BY rd.issue_date) INTO v_docs
        FROM recon_docs rd
        WHERE rd.document_id IN (SELECT v_ids[i] FROM generate_series(1, v_n) i WHERE (v_best >> (i - 1)) & 1 = 1);
        IF private.add_bank_proposal(t.id, 'allocate', 'platnosc_zbiorcza', v_docs,
             'Płatność zbiorcza: suma ' || jsonb_array_length(v_docs) || ' faktur z okolic daty przelewu równa się kwocie ' ||
             private.money_pl(t.remaining) || '. Sprawdź, czy to jeden koszyk zakupów.') THEN
          v_proposals := v_proposals + 1;
        END IF;
        v_done := true;
      ELSIF v_found > 1 THEN
        IF private.add_bank_proposal(t.id, 'hint', 'platnosc_zbiorcza', '[]'::jsonb,
             'Płatność zbiorcza: kilka różnych zestawów faktur daje kwotę ' || private.money_pl(t.remaining) || '. Wybierz dokumenty ręcznie.') THEN
          v_hints := v_hints + 1;
        END IF;
        v_done := true;
      END IF;
    END IF;

    -- Wskazówka: tytuł wskazuje fakturę, której nie ma w systemie.
    IF NOT v_done AND t.text_norm ~ '(^| )(FV|FA|FS|FK|FAKTURA|FAKTURY|INV|INVOICE)( |[0-9])' THEN
      IF private.add_bank_proposal(t.id, 'hint', 'brak_dokumentu',
           '[]'::jsonb,
           CASE WHEN t.dir = 'credit'
             THEN 'Tytuł wpłaty wskazuje fakturę, ale nie ma jej w CRM ani w KSeF (albo jest już w całości rozliczona). Sprawdź fakturę sprzedaży.'
             ELSE 'Tytuł przelewu wskazuje fakturę, której nie ma w systemie (albo jest już w całości rozliczona). Dodaj dokument kosztowy lub poczekaj na KSeF.'
           END) THEN
        v_hints := v_hints + 1;
      END IF;
    END IF;
  END LOOP;

  v_summary := jsonb_build_object(
    'sources', v_sources,
    'auto_matched', v_auto,
    'auto_confirmed_manual', v_auto_manual,
    'auto_explained', v_auto_explained,
    'proposals', v_proposals,
    'choices', v_choices,
    'hints', v_hints,
    'stopped_by_guard', v_errors,
    'transactions', (SELECT count(*) FROM recon_tx),
    'open_after', (SELECT count(*) FROM public.bank_transactions bt JOIN public.bank_statements s ON s.id = bt.statement_id
                   WHERE s.my_company_id = p_company_id AND s.statement_year = p_year AND s.statement_month = p_month
                     AND s.processed AND s.validation_status = 'valid' AND bt.canonical_transaction_id IS NULL
                     AND bt.match_status <> 'matched' AND bt.accounting_review_status <> 'explained'
                     AND bt.paired_bank_transaction_id IS NULL AND NOT bt.private_transfer_detected));

  INSERT INTO public.bank_reconciliation_runs (my_company_id, statement_year, statement_month, summary, created_by)
  VALUES (p_company_id, p_year, p_month, v_summary, public.current_invoice_employee_id());

  RETURN v_summary;
END;
$$;

-- 8. Decyzje człowieka -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.accept_bank_reconciliation_proposal(p_proposal_id uuid, p_document_index integer DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_proposal public.bank_reconciliation_proposals%ROWTYPE;
  v_company uuid;
  v_doc jsonb;
  v_docs jsonb;
  v_reason text;
  v_count integer := 0;
BEGIN
  SELECT * INTO v_proposal FROM public.bank_reconciliation_proposals WHERE id = p_proposal_id FOR UPDATE;
  IF NOT FOUND OR v_proposal.status <> 'open' THEN
    RAISE EXCEPTION 'Propozycja jest już nieaktualna. Odśwież uzgodnienie.';
  END IF;
  SELECT s.my_company_id INTO v_company
  FROM public.bank_transactions bt JOIN public.bank_statements s ON s.id = bt.statement_id
  WHERE bt.id = v_proposal.bank_transaction_id;
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND NOT (public.finance_can_manage() AND public.finance_company_visible(v_company)) THEN
    RAISE EXCEPTION 'Brak uprawnień do rozliczania płatności.' USING ERRCODE = '42501';
  END IF;
  IF v_proposal.kind = 'hint' THEN
    RAISE EXCEPTION 'To tylko wskazówka — wybierz dokument ręcznie.';
  END IF;

  IF v_proposal.kind = 'choose' THEN
    IF p_document_index IS NULL OR p_document_index < 0 OR p_document_index >= jsonb_array_length(v_proposal.documents) THEN
      RAISE EXCEPTION 'Wybierz jeden dokument z listy.';
    END IF;
    v_docs := jsonb_build_array(v_proposal.documents -> p_document_index);
  ELSE
    v_docs := v_proposal.documents;
  END IF;

  v_reason := 'Zatwierdzona propozycja: ' || v_proposal.reason;
  FOR v_doc IN SELECT value FROM jsonb_array_elements(v_docs) LOOP
    IF coalesce((v_doc ->> 'manual')::boolean, false) AND v_doc ->> 'source' = 'ksef' THEN
      PERFORM public.reconcile_paid_ksef_invoice_with_bank_transaction(v_proposal.bank_transaction_id,
        (v_doc ->> 'id')::uuid, (v_doc ->> 'amount')::numeric, 1, ARRAY[v_reason]);
    ELSIF coalesce((v_doc ->> 'manual')::boolean, false) AND v_doc ->> 'source' = 'external' THEN
      PERFORM public.reconcile_external_invoice_with_bank_transaction(v_proposal.bank_transaction_id,
        (v_doc ->> 'id')::uuid, (v_doc ->> 'amount')::numeric, (v_doc ->> 'amount')::numeric, 1, ARRAY[v_reason]);
    ELSE
      PERFORM public.match_bank_transaction_to_document(v_proposal.bank_transaction_id, v_doc ->> 'source',
        (v_doc ->> 'id')::uuid, (v_doc ->> 'amount')::numeric, 1, 'manual', ARRAY[v_reason]);
    END IF;
    v_count := v_count + 1;
  END LOOP;

  UPDATE public.bank_reconciliation_proposals
  SET status = 'accepted', decided_at = now(), decided_by = public.current_invoice_employee_id()
  WHERE id = p_proposal_id;
  RETURN jsonb_build_object('matched_documents', v_count);
END;
$$;

CREATE OR REPLACE FUNCTION public.reject_bank_reconciliation_proposal(p_proposal_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_company uuid;
BEGIN
  SELECT s.my_company_id INTO v_company
  FROM public.bank_reconciliation_proposals p
  JOIN public.bank_transactions bt ON bt.id = p.bank_transaction_id
  JOIN public.bank_statements s ON s.id = bt.statement_id
  WHERE p.id = p_proposal_id;
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND NOT (public.finance_can_manage() AND public.finance_company_visible(v_company)) THEN
    RAISE EXCEPTION 'Brak uprawnień.' USING ERRCODE = '42501';
  END IF;
  UPDATE public.bank_reconciliation_proposals
  SET status = 'rejected', decided_at = now(), decided_by = public.current_invoice_employee_id()
  WHERE id = p_proposal_id AND status = 'open';
END;
$$;

-- Cofnięcie wyjaśnienia operacji (np. reguły automatycznej).
CREATE OR REPLACE FUNCTION public.clear_bank_transaction_explanation(p_transaction_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_company uuid;
BEGIN
  SELECT s.my_company_id INTO v_company
  FROM public.bank_transactions bt JOIN public.bank_statements s ON s.id = bt.statement_id
  WHERE bt.id = p_transaction_id;
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND NOT (public.finance_can_manage() AND public.finance_company_visible(v_company)) THEN
    RAISE EXCEPTION 'Brak uprawnień.' USING ERRCODE = '42501';
  END IF;
  -- Cofnięta reguła jest zapamiętana (rejected:<reguła>), żeby kolejne uzgodnienie jej nie powtórzyło.
  UPDATE public.bank_transactions
  SET accounting_review_status = 'pending', accounting_category = 'other', accounting_subtype = NULL,
      accounting_note = CASE WHEN accounting_explained_by LIKE 'rule:%' THEN NULL ELSE accounting_note END,
      accounting_reviewed_at = NULL,
      accounting_explained_by = CASE WHEN accounting_explained_by LIKE 'rule:%'
        THEN 'rejected:' || substr(accounting_explained_by, 6) ELSE NULL END
  WHERE id = p_transaction_id AND paired_bank_transaction_id IS NULL;
END;
$$;

-- Cofnięcie dopasowania: dokument wraca do puli, a ta para (operacja–dokument) nie wraca automatycznie.
CREATE OR REPLACE FUNCTION public.undo_bank_match(p_transaction_id uuid, p_match_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_match public.bank_transaction_invoice_matches%ROWTYPE;
  v_number text;
  v_deleted integer;
BEGIN
  SELECT * INTO v_match FROM public.bank_transaction_invoice_matches
  WHERE id = p_match_id AND bank_transaction_id = p_transaction_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Dopasowanie już nie istnieje. Odśwież widok.'; END IF;
  SELECT coalesce(k.invoice_number, i.invoice_number, e.invoice_number) INTO v_number
  FROM (SELECT 1) x
  LEFT JOIN public.ksef_invoices k ON k.id = v_match.ksef_invoice_id
  LEFT JOIN public.invoices i ON i.id = v_match.invoice_id
  LEFT JOIN public.external_invoices e ON e.id = v_match.external_invoice_id;

  v_deleted := public.unmatch_bank_transaction(p_transaction_id, p_match_id); -- sprawdza uprawnienia
  INSERT INTO public.bank_reconciliation_proposals (bank_transaction_id, kind, rule, documents, reason, status, decided_at, decided_by)
  VALUES (p_transaction_id, 'allocate', 'cofniete',
    jsonb_build_array(jsonb_build_object('source', v_match.document_source,
      'id', coalesce(v_match.ksef_invoice_id, v_match.invoice_id, v_match.external_invoice_id),
      'number', v_number, 'amount', v_match.amount)),
    'Dopasowanie cofnięte przez użytkownika' || CASE WHEN v_match.match_method = 'automatic' THEN ' (było automatyczne).' ELSE '.' END,
    'rejected', now(), public.current_invoice_employee_id());
  RETURN v_deleted;
END;
$$;

-- 9. Widok miesiąca dla ekranu „Uzgodnienie wyciągów” ------------------------------------------
CREATE OR REPLACE FUNCTION public.get_bank_reconciliation_month(p_company_id uuid, p_year integer, p_month integer)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
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
           coalesce((SELECT sum(m.amount) FROM public.bank_transaction_invoice_matches m WHERE m.bank_transaction_id = t.id), 0)
           + coalesce((SELECT sum(p.amount) FROM public.personnel_contract_payments p WHERE p.bank_transaction_id = t.id), 0) AS alloc
    FROM public.bank_transactions t JOIN st ON st.id = t.statement_id
    WHERE t.canonical_transaction_id IS NULL
  ), rows AS (
    SELECT tx.*, pr.id AS proposal_id, pr.kind AS proposal_kind,
      CASE
        WHEN tx.paired_bank_transaction_id IS NOT NULL OR tx.private_transfer_detected
             OR (tx.accounting_review_status = 'explained' AND tx.accounting_category = 'own_transfer') THEN 'transfer'
        WHEN tx.alloc >= abs(tx.amount) - 0.01 THEN 'matched'
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
          SELECT jsonb_agg(jsonb_build_object(
            'match_id', m.id, 'source', m.document_source,
            'document_id', coalesce(m.ksef_invoice_id, m.invoice_id, m.external_invoice_id),
            'number', coalesce(k.invoice_number, i.invoice_number, e.invoice_number),
            'party', coalesce(CASE WHEN k.invoice_type::text = 'issued' THEN k.buyer_name ELSE k.seller_name END, i.buyer_name, e.seller_name),
            'amount', m.amount, 'method', m.match_method, 'reasons', m.match_reasons, 'created_at', m.created_at)
            ORDER BY m.created_at)
          FROM public.bank_transaction_invoice_matches m
          LEFT JOIN public.ksef_invoices k ON k.id = m.ksef_invoice_id
          LEFT JOIN public.invoices i ON i.id = m.invoice_id
          LEFT JOIN public.external_invoices e ON e.id = m.external_invoice_id
          WHERE m.bank_transaction_id = r.id), '[]'::jsonb),
        'personnel', coalesce((
          SELECT jsonb_agg(jsonb_build_object('id', p.id, 'recipient', p.recipient_name, 'amount', p.amount, 'title', p.title))
          FROM public.personnel_contract_payments p WHERE p.bank_transaction_id = r.id), '[]'::jsonb),
        'explanation', CASE WHEN r.accounting_review_status = 'explained' THEN jsonb_build_object(
          'category', r.accounting_category, 'subtype', r.accounting_subtype, 'note', r.accounting_note,
          'by', coalesce(r.accounting_explained_by, 'user')) END,
        'proposal', r.proposal)
        ORDER BY r.transaction_date, r.source_index NULLS LAST, r.id)
      FROM rows r), '[]'::jsonb),
    -- Faktury oznaczone ręcznie jako opłacone w tym miesiącu, bez potwierdzenia w wyciągu.
    'paid_without_statement', coalesce((
      SELECT jsonb_agg(jsonb_build_object('source', d.source, 'id', d.document_id, 'number', d.number, 'party', d.party,
        'side', d.side, 'due', round(d.due, 2), 'manual_paid', round(d.manual_paid, 2), 'payment_date', d.manual_date)
        ORDER BY d.manual_date, d.number)
      FROM docs d
      WHERE d.manual_paid > 0.009 AND NOT d.is_shadow AND d.manual_date BETWEEN v_from AND v_to
        AND NOT (d.source = 'invoice' AND EXISTS (SELECT 1 FROM docs k WHERE k.source = 'ksef' AND k.local_invoice_id = d.document_id))), '[]'::jsonb),
    -- Robocze kopie faktur sprzedaży (wpis KSeF bez numeru obok wpisu z numerem) — nie rozliczamy ich.
    'shadow_documents', coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', d.document_id, 'number', d.number, 'party', d.party, 'due', round(d.due, 2),
        'payment_status', d.payment_status, 'issue_date', d.issue_date) ORDER BY d.issue_date DESC, d.number)
      FROM docs d WHERE d.is_shadow), '[]'::jsonb),
    -- Nieopłacone faktury z terminem w tym miesiącu lub wcześniej (bez płatności z wyciągu i ręcznej).
    'unpaid_due', coalesce((
      SELECT jsonb_agg(jsonb_build_object('source', d.source, 'id', d.document_id, 'number', d.number, 'party', d.party,
        'side', d.side, 'due', round(d.due, 2), 'open', round(greatest(d.due - d.bank_paid - d.manual_paid, 0), 2),
        'due_date', d.due_date, 'issue_date', d.issue_date) ORDER BY d.due_date, d.number)
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
$$;

-- 10. Uprawnienia ------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION private.bank_norm(text), private.bank_number_usable(text), private.bank_number_hit(text, text, text),
  private.merge_bank_transaction_copy(uuid, uuid), private.promote_bank_transaction_copy(), private.restore_bank_transfer_pairs(),
  private.promote_bank_transaction_copy_for(uuid), private.promote_statement_copies(),
  private.ksef_invoice_is_shadow(uuid), private.bank_document_twins(text, uuid), private.money_pl(numeric),
  private.guard_bank_match_integrity(), private.guard_personnel_bank_allocation(),
  private.bank_reconciliation_documents(uuid), private.bank_category_rule(text, text, text, text, numeric),
  private.add_bank_proposal(uuid, text, text, jsonb, text), private.bank_proposal_document(jsonb, numeric, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.confirm_bank_statement_sources(uuid, integer, integer),
  public.reconcile_bank_month(uuid, integer, integer),
  public.accept_bank_reconciliation_proposal(uuid, integer),
  public.reject_bank_reconciliation_proposal(uuid),
  public.clear_bank_transaction_explanation(uuid),
  public.undo_bank_match(uuid, uuid),
  public.get_bank_reconciliation_month(uuid, integer, integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_bank_statement_sources(uuid, integer, integer),
  public.reconcile_bank_month(uuid, integer, integer),
  public.accept_bank_reconciliation_proposal(uuid, integer),
  public.reject_bank_reconciliation_proposal(uuid),
  public.clear_bank_transaction_explanation(uuid),
  public.undo_bank_match(uuid, uuid),
  public.get_bank_reconciliation_month(uuid, integer, integer)
  TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
