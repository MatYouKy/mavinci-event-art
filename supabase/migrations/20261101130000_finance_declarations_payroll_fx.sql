-- Uzgadnianie wyciągów, część 2: ZUS i podatki, wynagrodzenia, płatności w walutach.
--
-- 1. Deklaracje (DRA, PIT-4R, VAT-7, CIT-8, …) jako rejestr zobowiązań za okres: kwota z deklaracji,
--    pliki (PDF/XML z Płatnika, PUE, e-Deklaracji) i rozbicie na pracowników. Przelew do ZUS lub na
--    mikrorachunek podatkowy z okresem w tytule („ZUS DRA 03.2026”, „N 26M03 PIT-4R”) jest przypisywany
--    do deklaracji za ten okres. Gdy deklaracji jeszcze nie ma, powstaje z adnotacją „brak kwoty
--    z deklaracji”. Podejrzany okres w tytule (np. rok sprzed roku) wymaga wyboru człowieka.
-- 2. Wypłaty z umów kadrowych: kwota + nazwisko lub rachunek odbiorcy + data. Gdy kwota netto jest
--    potwierdzona — powiązanie automatyczne; w przeciwnym razie propozycja, której zatwierdzenie
--    potwierdza netto (zgodnie z istniejącą blokadą kadrową).
-- 3. Dokumenty spoza KSeF w walucie: płatność kartą niesie kwotę oryginalną (MT940: kod 13+3+6 cyfr,
--    PDF: „Kwota oryg.: 44,03 USD”) — porównujemy ją z kwotą faktury w walucie i zapisujemy kurs.
--    Sprzedawcę rozpoznajemy po nazwie w opisie albo z historii („BOLT” → StackBlitz).
-- 4. Każde przypisanie (faktura, wypłata, deklaracja) liczy się do jednego limitu kwoty operacji.
-- Plik można bezpiecznie uruchomić ponownie.
BEGIN;

-- 0. Pomocnicze ---------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.bank_party_token(p_party text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = pg_catalog AS $$
  SELECT coalesce((
    SELECT w FROM regexp_split_to_table(private.bank_norm(p_party), ' ') WITH ORDINALITY AS t(w, o)
    WHERE length(w) >= 4 AND w NOT IN ('SPOLKA', 'SPOLKI', 'FIRMA', 'USLUGI', 'HANDLOWA', 'HANDEL', 'PRZEDSIEBIORSTWO',
      'PPHU', 'GRUPA', 'POLSKA', 'POLSKIE', 'OGRANICZONA', 'ODPOWIEDZIALNOSCIA', 'AKCYJNA', 'KOMANDYTOWA', 'JAWNA',
      'CYWILNA', 'HOTEL', 'HOTELS', 'STUDIO', 'CENTRUM', 'AGENCJA')
    ORDER BY o LIMIT 1), '')
$$;

CREATE OR REPLACE FUNCTION private.iso_currency_code(p_numeric text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = pg_catalog AS $$
  SELECT CASE p_numeric
    WHEN '840' THEN 'USD' WHEN '978' THEN 'EUR' WHEN '826' THEN 'GBP' WHEN '985' THEN 'PLN' WHEN '756' THEN 'CHF'
    WHEN '203' THEN 'CZK' WHEN '752' THEN 'SEK' WHEN '578' THEN 'NOK' WHEN '208' THEN 'DKK' WHEN '348' THEN 'HUF'
    WHEN '702' THEN 'SGD' WHEN '124' THEN 'CAD' WHEN '036' THEN 'AUD' WHEN '392' THEN 'JPY' WHEN '156' THEN 'CNY'
    WHEN '344' THEN 'HKD' WHEN '784' THEN 'AED' WHEN '949' THEN 'TRY' WHEN '980' THEN 'UAH' WHEN '554' THEN 'NZD'
    WHEN '376' THEN 'ILS' WHEN '356' THEN 'INR' WHEN '946' THEN 'RON' WHEN '975' THEN 'BGN'
  END
$$;

-- Płatność kartą: kwota i waluta oryginalna oraz pierwsze słowo nazwy sprzedawcy.
--   MT940 (PKO): „0000000004403840169065 0706 <karta> SINGAPORE SG SUPABASE …” = 44,03 (13 cyfr) + 840 (USD) + 6 cyfr.
--   PDF:         „… Lokalizacja: SUPABASE SINGAPORE SG … Kwota oryg.: 44,03 USD …”.
CREATE OR REPLACE FUNCTION private.bank_card_charge(p_text_norm text)
RETURNS TABLE (amount numeric, currency text, merchant text)
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE SET search_path = pg_catalog AS $$
DECLARE
  v_text text := coalesce(p_text_norm, '');
  m text[];
BEGIN
  m := regexp_match(v_text, '(?:^| )([0-9]{13})([0-9]{3})[0-9]{6}(?: |$)');
  IF m IS NOT NULL AND private.iso_currency_code(m[2]) IS NOT NULL AND m[1]::numeric > 0 THEN
    RETURN QUERY SELECT round(m[1]::numeric / 100, 2), private.iso_currency_code(m[2]),
      coalesce((regexp_match(v_text, '(?:^| )[0-9]{22}(?: [0-9]+)* ([A-Z][A-Z0-9]*)'))[1],
               (regexp_match(v_text, '(?:^| )LOKALIZACJA ([A-Z][A-Z0-9]*)'))[1]);
    RETURN;
  END IF;
  m := regexp_match(v_text, '(?:^| )KWOTA ORYG(?:INALNA)? ([0-9]{1,3}(?: [0-9]{3})*) ([0-9]{2}) ([A-Z]{3})(?: |$)');
  IF m IS NOT NULL THEN
    RETURN QUERY SELECT round((replace(m[1], ' ', '') || '.' || m[2])::numeric, 2), m[3],
      (regexp_match(v_text, '(?:^| )LOKALIZACJA ([A-Z][A-Z0-9]*)'))[1];
  END IF;
END;
$$;

-- Przelew do ZUS albo na mikrorachunek podatkowy: rodzaj, symbol deklaracji i okres z tytułu.
-- Przelew na własny rachunek (np. rachunek VAT → bieżący z tytułem „ZUS DRA …”) nie jest płatnością.
CREATE OR REPLACE FUNCTION private.bank_public_payment(p_text_norm text, p_counterparty_norm text, p_iban text,
  p_own_accounts text[], p_zus_account text, p_tax_account text)
RETURNS TABLE (kind text, form text, period_kind text, period_start date)
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog AS $$
DECLARE
  v_text text := coalesce(p_text_norm, '');
  v_cp text := coalesce(p_counterparty_norm, '');
  v_iban text := coalesce(p_iban, '');
  v_compact text := replace(coalesce(p_text_norm, ''), ' ', '');
  v_zus_account boolean;
  v_tax_account boolean;
  v_recipient text;
  v_form text;
  v_kind text;
  v_period text;
  v_tail text;
  m text[];
BEGIN
  v_zus_account := (v_iban <> '' AND v_iban = coalesce(p_zus_account, '')) OR v_iban ~ '^[0-9]{2}60000002[0-9]{16}$'
    OR v_text ~ '(^| )[0-9]{2} 6000 0002( [0-9]{4}){4}( |$)' OR v_text ~ '(^| )(?:[0-9]{0,2}PL)?[0-9]{2}60000002[0-9]{16}( |$)';
  v_tax_account := (v_iban <> '' AND v_iban = coalesce(p_tax_account, '')) OR v_iban ~ '^[0-9]{2}101000712222[0-9]{12}$'
    OR v_text ~ '(^| )[0-9]{2} 1010 0071 2222( [0-9]{4}){3}( |$)' OR v_text ~ '(^| )(?:[0-9]{0,2}PL)?[0-9]{2}101000712222[0-9]{12}( |$)';

  IF v_iban <> '' AND v_iban = ANY(coalesce(p_own_accounts, '{}'::text[])) THEN RETURN; END IF;
  IF NOT (v_zus_account OR v_tax_account) AND EXISTS (
       SELECT 1 FROM unnest(coalesce(p_own_accounts, '{}'::text[])) a WHERE length(a) = 26 AND position(a IN v_compact) > 0) THEN
    RETURN;
  END IF;

  IF v_zus_account OR v_cp ~ '^ZUS( |$)' OR v_cp LIKE '%ZAKLAD UBEZPIECZEN SPOLECZNYCH%' THEN
    v_recipient := 'zus';
  ELSIF v_tax_account OR v_cp ~ '(URZAD SKARBOWY|SKARBOWY CENTRUM|CENTRUM ROZLICZENIOWE)' THEN
    v_recipient := 'tax';
  ELSE
    RETURN;
  END IF;

  IF v_recipient = 'zus' THEN
    m := regexp_match(v_text, '(?:^| )(?:DRA|ZUS|SKLADKI|SKLADKA)(?: [A-Z]+){0,2} (0?[1-9]|1[0-2]) (20[0-9]{2})(?: |$)');
    IF m IS NOT NULL THEN
      RETURN QUERY SELECT 'zus'::text, 'DRA'::text, 'month'::text, make_date(m[2]::int, m[1]::int, 1);
      RETURN;
    END IF;
    m := regexp_match(v_text, '(?:^| )(?:DRA|ZUS|SKLADKI|SKLADKA)(?: [A-Z]+){0,2} (20[0-9]{2}) (0?[1-9]|1[0-2])(?: |$)');
    RETURN QUERY SELECT 'zus'::text, 'DRA'::text, 'month'::text,
      CASE WHEN m IS NOT NULL THEN make_date(m[1]::int, m[2]::int, 1) END;
    RETURN;
  END IF;

  -- Symbol formularza stoi zwykle tuż za okresem; MT940 potrafi go rozciąć („25M12 PI T 4R”, „VA T 7”).
  m := regexp_match(v_text, '(?:^| )([0-9]{2}(?:M(?:0[1-9]|1[0-2])|R|K0?[1-4]))((?: [A-Z0-9]{1,8}){1,4})');
  v_period := m[1];
  v_tail := replace(coalesce(m[2], ''), ' ', '');
  v_form := CASE
    WHEN v_tail LIKE 'PIT8AR%' THEN 'PIT-8AR' WHEN v_tail LIKE 'PIT4R%' THEN 'PIT-4R' WHEN v_tail LIKE 'PIT36L%' THEN 'PIT-36L'
    WHEN v_tail LIKE 'PIT36%' THEN 'PIT-36' WHEN v_tail LIKE 'PIT28%' THEN 'PIT-28' WHEN v_tail LIKE 'VAT7K%' THEN 'VAT-7K'
    WHEN v_tail LIKE 'JPKV7K%' THEN 'VAT-7K' WHEN v_tail LIKE 'VAT7%' THEN 'VAT-7' WHEN v_tail LIKE 'JPKV7M%' THEN 'VAT-7'
    WHEN v_tail LIKE 'VAT8%' THEN 'VAT-8' WHEN v_tail LIKE 'VAT9M%' THEN 'VAT-9M' WHEN v_tail LIKE 'CIT8%' THEN 'CIT-8'
    WHEN v_tail LIKE 'PPE%' THEN 'PPE' END;
  IF v_form IS NULL THEN
    m := regexp_match(v_text, '(?:^| )(PIT ?4R|PIT ?8AR|PIT ?36L|PIT ?36|PIT ?28|VAT ?7K|VAT ?7|VAT ?8|VAT ?9M|JPK ?V7K|JPK ?V7M|CIT ?8|PPE)(?: |$)');
    v_form := CASE replace(m[1], ' ', '')
      WHEN 'PIT4R' THEN 'PIT-4R' WHEN 'PIT8AR' THEN 'PIT-8AR' WHEN 'PIT36L' THEN 'PIT-36L' WHEN 'PIT36' THEN 'PIT-36'
      WHEN 'PIT28' THEN 'PIT-28' WHEN 'VAT7K' THEN 'VAT-7K' WHEN 'JPKV7K' THEN 'VAT-7K' WHEN 'VAT7' THEN 'VAT-7'
      WHEN 'JPKV7M' THEN 'VAT-7' WHEN 'VAT8' THEN 'VAT-8' WHEN 'VAT9M' THEN 'VAT-9M' WHEN 'CIT8' THEN 'CIT-8'
      WHEN 'PPE' THEN 'PPE' END;
  END IF;
  IF v_form IS NULL THEN RETURN; END IF; -- przelew podatkowy bez symbolu: zostaje samo wyjaśnienie
  v_kind := CASE WHEN v_form LIKE 'VAT%' THEN 'vat' WHEN v_form LIKE 'CIT%' THEN 'cit' ELSE 'pit' END;

  IF v_period IS NULL THEN
    v_period := (regexp_match(v_text, '(?:^| )([0-9]{2}(?:M(?:0[1-9]|1[0-2])|R|K0?[1-4]))(?: |$)'))[1];
  END IF;
  IF v_period ~ '^[0-9]{2}M' THEN
    RETURN QUERY SELECT v_kind, v_form, 'month'::text, make_date(2000 + left(v_period, 2)::int, right(v_period, 2)::int, 1);
  ELSIF v_period ~ '^[0-9]{2}K' THEN
    RETURN QUERY SELECT v_kind, v_form, 'quarter'::text, make_date(2000 + left(v_period, 2)::int, (right(v_period, 1)::int - 1) * 3 + 1, 1);
  ELSIF v_period ~ '^[0-9]{2}R$' THEN
    RETURN QUERY SELECT v_kind, v_form, 'year'::text, make_date(2000 + left(v_period, 2)::int, 1, 1);
  ELSE
    RETURN QUERY SELECT v_kind, v_form, 'month'::text, NULL::date;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION private.finance_period_end(p_period_kind text, p_period_start date)
RETURNS date LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = pg_catalog AS $$
  SELECT (p_period_start + CASE p_period_kind WHEN 'year' THEN interval '1 year' WHEN 'quarter' THEN interval '3 months'
    ELSE interval '1 month' END - interval '1 day')::date
$$;

CREATE OR REPLACE FUNCTION private.finance_declaration_label(p_form text, p_period_kind text, p_period_start date)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = pg_catalog AS $$
  SELECT p_form || ' ' || CASE p_period_kind
    WHEN 'year' THEN 'za ' || to_char(p_period_start, 'YYYY')
    WHEN 'quarter' THEN extract(quarter FROM p_period_start)::int || ' kw. ' || to_char(p_period_start, 'YYYY')
    ELSE to_char(p_period_start, 'MM/YYYY') END
$$;

-- 1. Deklaracje -----------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.finance_declarations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  my_company_id uuid NOT NULL REFERENCES public.my_companies(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('zus', 'pit', 'vat', 'cit', 'other')),
  form text NOT NULL CHECK (length(btrim(form)) BETWEEN 2 AND 30),
  period_kind text NOT NULL DEFAULT 'month' CHECK (period_kind IN ('month', 'quarter', 'year')),
  period_start date NOT NULL,
  amount_due numeric(14,2) CHECK (amount_due IS NULL OR amount_due >= 0),
  due_date date,
  notes text,
  created_from text NOT NULL DEFAULT 'manual' CHECK (created_from IN ('manual', 'payment', 'import')),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT finance_declarations_period_start_first_day CHECK (extract(day FROM period_start) = 1)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_finance_declarations_period
  ON public.finance_declarations(my_company_id, kind, form, period_kind, period_start);
COMMENT ON TABLE public.finance_declarations IS
  'Deklaracje ZUS i podatkowe za okres (DRA, PIT-4R, VAT-7, CIT-8…): kwota z deklaracji, pliki, rozbicie na osoby, płatności z wyciągu.';
COMMENT ON COLUMN public.finance_declarations.amount_due IS 'Kwota do zapłaty z deklaracji. NULL — jeszcze nie wpisana (np. deklaracja założona z przelewu).';
COMMENT ON COLUMN public.finance_declarations.created_from IS 'manual – dodana ręcznie; payment – założona automatycznie z przelewu; import – z pliku.';

CREATE TABLE IF NOT EXISTS public.finance_declaration_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  declaration_id uuid NOT NULL REFERENCES public.finance_declarations(id) ON DELETE RESTRICT,
  bank_transaction_id uuid NOT NULL REFERENCES public.bank_transactions(id) ON DELETE CASCADE,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  match_method text NOT NULL DEFAULT 'manual' CHECK (match_method IN ('automatic', 'manual')),
  match_reasons text[] NOT NULL DEFAULT ARRAY[]::text[],
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (declaration_id, bank_transaction_id)
);
CREATE INDEX IF NOT EXISTS idx_finance_declaration_payments_tx ON public.finance_declaration_payments(bank_transaction_id);

CREATE TABLE IF NOT EXISTS public.finance_declaration_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  declaration_id uuid NOT NULL REFERENCES public.finance_declarations(id) ON DELETE CASCADE,
  personnel_contract_id uuid REFERENCES public.personnel_contracts(id) ON DELETE SET NULL,
  person_name text NOT NULL CHECK (length(btrim(person_name)) > 0),
  social_insured numeric(14,2) NOT NULL DEFAULT 0 CHECK (social_insured >= 0),
  social_payer numeric(14,2) NOT NULL DEFAULT 0 CHECK (social_payer >= 0),
  health numeric(14,2) NOT NULL DEFAULT 0 CHECK (health >= 0),
  funds numeric(14,2) NOT NULL DEFAULT 0 CHECK (funds >= 0),
  pit numeric(14,2) NOT NULL DEFAULT 0 CHECK (pit >= 0),
  amount numeric(14,2) GENERATED ALWAYS AS (social_insured + social_payer + health + funds + pit) STORED,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_finance_declaration_lines_declaration ON public.finance_declaration_lines(declaration_id);
COMMENT ON TABLE public.finance_declaration_lines IS
  'Rozbicie deklaracji na osoby: składki społeczne (ubezpieczony / płatnik), zdrowotna, fundusze (FP, FS, FGŚP), zaliczka PIT.';

CREATE TABLE IF NOT EXISTS public.finance_declaration_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  declaration_id uuid NOT NULL REFERENCES public.finance_declarations(id) ON DELETE CASCADE,
  storage_path text NOT NULL UNIQUE,
  file_name text NOT NULL,
  mime_type text,
  file_size bigint,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

DO $p$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['finance_declarations', 'finance_declaration_payments', 'finance_declaration_lines', 'finance_declaration_files'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_table);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_table || '_read', v_table);
    EXECUTE format('DROP POLICY IF EXISTS sales_finance_private ON public.%I', v_table);
    EXECUTE format('CREATE POLICY sales_finance_private ON public.%I AS RESTRICTIVE FOR ALL TO authenticated
      USING (public.invoice_finance_scope() <> ''sales'') WITH CHECK (public.invoice_finance_scope() <> ''sales'')', v_table);
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE ON public.%I FROM anon, authenticated', v_table);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', v_table);
  END LOOP;
END
$p$;
CREATE POLICY finance_declarations_read ON public.finance_declarations FOR SELECT TO authenticated
  USING (public.finance_can_view() AND public.finance_company_visible(my_company_id));
CREATE POLICY finance_declaration_payments_read ON public.finance_declaration_payments FOR SELECT TO authenticated
  USING (public.finance_can_view() AND EXISTS (SELECT 1 FROM public.finance_declarations d
    WHERE d.id = finance_declaration_payments.declaration_id AND public.finance_company_visible(d.my_company_id)));
CREATE POLICY finance_declaration_lines_read ON public.finance_declaration_lines FOR SELECT TO authenticated
  USING (public.finance_can_view() AND EXISTS (SELECT 1 FROM public.finance_declarations d
    WHERE d.id = finance_declaration_lines.declaration_id AND public.finance_company_visible(d.my_company_id)));
CREATE POLICY finance_declaration_files_read ON public.finance_declaration_files FOR SELECT TO authenticated
  USING (public.finance_can_view() AND EXISTS (SELECT 1 FROM public.finance_declarations d
    WHERE d.id = finance_declaration_files.declaration_id AND public.finance_company_visible(d.my_company_id)));

-- Pliki deklaracji: <firma>/<deklaracja>/<plik>
DO $s$
BEGIN
  IF to_regclass('storage.buckets') IS NULL THEN RETURN; END IF;
  INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  VALUES ('finance-declarations', 'finance-declarations', false, 20971520,
    ARRAY['application/pdf', 'application/xml', 'text/xml', 'application/octet-stream', 'application/zip',
          'image/jpeg', 'image/png', 'image/webp'])
  ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

  EXECUTE 'DROP POLICY IF EXISTS finance_declarations_storage_read ON storage.objects';
  EXECUTE $q$CREATE POLICY finance_declarations_storage_read ON storage.objects FOR SELECT TO authenticated
    USING (bucket_id = 'finance-declarations' AND public.finance_can_view() AND EXISTS (
      SELECT 1 FROM public.finance_declarations d
      WHERE d.id::text = (storage.foldername(name))[2] AND d.my_company_id::text = (storage.foldername(name))[1]
        AND public.finance_company_visible(d.my_company_id)))$q$;
  EXECUTE 'DROP POLICY IF EXISTS finance_declarations_storage_insert ON storage.objects';
  EXECUTE $q$CREATE POLICY finance_declarations_storage_insert ON storage.objects FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'finance-declarations' AND public.finance_can_manage() AND EXISTS (
      SELECT 1 FROM public.finance_declarations d
      WHERE d.id::text = (storage.foldername(name))[2] AND d.my_company_id::text = (storage.foldername(name))[1]
        AND public.finance_company_visible(d.my_company_id)))$q$;
  EXECUTE 'DROP POLICY IF EXISTS finance_declarations_storage_delete ON storage.objects';
  EXECUTE $q$CREATE POLICY finance_declarations_storage_delete ON storage.objects FOR DELETE TO authenticated
    USING (bucket_id = 'finance-declarations' AND public.finance_can_manage() AND EXISTS (
      SELECT 1 FROM public.finance_declarations d
      WHERE d.id::text = (storage.foldername(name))[2] AND d.my_company_id::text = (storage.foldername(name))[1]
        AND public.finance_company_visible(d.my_company_id)))$q$;
END
$s$;

-- Ślad decyzji przy wypłatach (jak match_method / match_reasons przy fakturach).
ALTER TABLE public.personnel_contract_payments
  ADD COLUMN IF NOT EXISTS bank_match_method text,
  ADD COLUMN IF NOT EXISTS bank_match_reasons text[];
DO $c$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'personnel_contract_payments_bank_match_method_check') THEN
    ALTER TABLE public.personnel_contract_payments ADD CONSTRAINT personnel_contract_payments_bank_match_method_check
      CHECK (bank_match_method IS NULL OR bank_match_method IN ('automatic', 'manual'));
  END IF;
END
$c$;

-- 2. Jeden limit kwoty operacji dla faktur, wypłat i deklaracji ------------------------------------
CREATE OR REPLACE FUNCTION private.bank_transaction_allocated(p_transaction_id uuid,
  p_skip_match uuid DEFAULT NULL, p_skip_personnel uuid DEFAULT NULL, p_skip_declaration uuid DEFAULT NULL)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT coalesce((SELECT sum(m.amount) FROM public.bank_transaction_invoice_matches m
                   WHERE m.bank_transaction_id = p_transaction_id AND m.id IS DISTINCT FROM p_skip_match), 0)
       + coalesce((SELECT sum(p.amount) FROM public.personnel_contract_payments p
                   WHERE p.bank_transaction_id = p_transaction_id AND p.id IS DISTINCT FROM p_skip_personnel), 0)
       + coalesce((SELECT sum(f.amount) FROM public.finance_declaration_payments f
                   WHERE f.bank_transaction_id = p_transaction_id AND f.id IS DISTINCT FROM p_skip_declaration), 0)
$$;

CREATE OR REPLACE FUNCTION public.recalculate_bank_transaction_match_state(p_transaction_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE
  v_total numeric(15,2);
  v_invoice_allocated numeric(15,2);
  v_personnel_allocated numeric(15,2);
  v_declaration_allocated numeric(15,2);
  v_invoice_count integer;
  v_personnel_count integer;
  v_declaration_count integer;
  v_declaration_manual boolean;
  v_allocated numeric(15,2);
  v_count integer;
  v_single_ksef uuid;
  v_confidence numeric(4,3);
  v_manual boolean;
BEGIN
  SELECT ABS(bt.amount) INTO v_total FROM public.bank_transactions bt WHERE bt.id = p_transaction_id;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT COALESCE(SUM(bank_match.amount), 0), COUNT(*),
         CASE WHEN COUNT(*) = 1 THEN (ARRAY_AGG(bank_match.ksef_invoice_id))[1] END,
         MAX(bank_match.confidence),
         COALESCE(BOOL_OR(bank_match.match_method IN ('manual', 'legacy')), false)
  INTO v_invoice_allocated, v_invoice_count, v_single_ksef, v_confidence, v_manual
  FROM public.bank_transaction_invoice_matches bank_match
  WHERE bank_match.bank_transaction_id = p_transaction_id;

  SELECT COALESCE(SUM(personnel_payment.amount), 0), COUNT(*)
  INTO v_personnel_allocated, v_personnel_count
  FROM public.personnel_contract_payments personnel_payment
  WHERE personnel_payment.bank_transaction_id = p_transaction_id;

  SELECT COALESCE(SUM(f.amount), 0), COUNT(*), COALESCE(BOOL_OR(f.match_method = 'manual'), false)
  INTO v_declaration_allocated, v_declaration_count, v_declaration_manual
  FROM public.finance_declaration_payments f
  WHERE f.bank_transaction_id = p_transaction_id;

  v_allocated := ROUND(COALESCE(v_invoice_allocated, 0) + COALESCE(v_personnel_allocated, 0) + COALESCE(v_declaration_allocated, 0), 2);
  v_count := COALESCE(v_invoice_count, 0) + COALESCE(v_personnel_count, 0) + COALESCE(v_declaration_count, 0);

  UPDATE public.bank_transactions
  SET allocated_amount = v_allocated,
      matched_document_count = v_count,
      match_status = CASE
        WHEN v_allocated <= 0.009 THEN 'unmatched'
        WHEN v_allocated >= v_total - 0.01 THEN 'matched'
        ELSE 'partial'
      END,
      matched_invoice_id = CASE WHEN v_count = 1 AND v_personnel_count = 0 AND v_declaration_count = 0 THEN v_single_ksef END,
      match_confidence = v_confidence,
      manual_match = v_manual OR v_personnel_count > 0 OR v_declaration_manual
  WHERE id = p_transaction_id;
END;
$function$;

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

  v_allocated := private.bank_transaction_allocated(NEW.bank_transaction_id, NEW.id, NULL, NULL);
  IF v_allocated + NEW.amount > abs(v_bt.amount) + 0.01 THEN
    RAISE EXCEPTION 'Operacja z % na % byłaby rozliczona ponad swoją kwotę (przypisano już %).',
      to_char(v_bt.transaction_date, 'DD.MM.YYYY'), private.money_pl(abs(v_bt.amount)), private.money_pl(v_allocated)
      USING ERRCODE = '23514';
  END IF;

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
  v_allocated := private.bank_transaction_allocated(NEW.bank_transaction_id, NULL, NEW.id, NULL);
  IF v_allocated + NEW.amount > abs(v_bt.amount) + 0.01 THEN
    RAISE EXCEPTION 'Operacja z % na % byłaby rozliczona ponad swoją kwotę (przypisano już %).',
      to_char(v_bt.transaction_date, 'DD.MM.YYYY'), private.money_pl(abs(v_bt.amount)), private.money_pl(v_allocated)
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION private.guard_finance_declaration_payment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_bt public.bank_transactions%ROWTYPE;
  v_company uuid;
  v_declaration_company uuid;
  v_allocated numeric;
BEGIN
  SELECT * INTO v_bt FROM public.bank_transactions WHERE id = NEW.bank_transaction_id;
  IF NOT FOUND THEN RETURN NEW; END IF;
  IF v_bt.canonical_transaction_id IS NOT NULL THEN
    RAISE EXCEPTION 'Ta operacja to kopia z drugiego wyciągu (PDF/MT940). Rozliczaj operację potwierdzoną.' USING ERRCODE = '23514';
  END IF;
  IF v_bt.paired_bank_transaction_id IS NOT NULL THEN
    RAISE EXCEPTION 'To przeniesienie między rachunkiem bieżącym a VAT, a nie płatność deklaracji.' USING ERRCODE = '23514';
  END IF;
  IF v_bt.transaction_type <> 'debit' THEN
    RAISE EXCEPTION 'Płatność deklaracji musi być przelewem wychodzącym.' USING ERRCODE = '23514';
  END IF;
  SELECT s.my_company_id INTO v_company FROM public.bank_statements s WHERE s.id = v_bt.statement_id;
  SELECT d.my_company_id INTO v_declaration_company FROM public.finance_declarations d WHERE d.id = NEW.declaration_id;
  IF v_company IS DISTINCT FROM v_declaration_company THEN
    RAISE EXCEPTION 'Deklaracja i operacja należą do różnych firm.' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.bank_transaction_id IS NOT DISTINCT FROM OLD.bank_transaction_id AND NEW.amount <= OLD.amount THEN
    RETURN NEW;
  END IF;
  v_allocated := private.bank_transaction_allocated(NEW.bank_transaction_id, NULL, NULL, NEW.id);
  IF v_allocated + NEW.amount > abs(v_bt.amount) + 0.01 THEN
    RAISE EXCEPTION 'Operacja z % na % byłaby rozliczona ponad swoją kwotę (przypisano już %).',
      to_char(v_bt.transaction_date, 'DD.MM.YYYY'), private.money_pl(abs(v_bt.amount)), private.money_pl(v_allocated)
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS finance_declaration_payment_guard ON public.finance_declaration_payments;
CREATE TRIGGER finance_declaration_payment_guard
  BEFORE INSERT OR UPDATE OF bank_transaction_id, amount, declaration_id ON public.finance_declaration_payments
  FOR EACH ROW EXECUTE FUNCTION private.guard_finance_declaration_payment();

CREATE OR REPLACE FUNCTION private.sync_finance_declaration_payment_state()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP <> 'DELETE' THEN
    PERFORM public.recalculate_bank_transaction_match_state(NEW.bank_transaction_id);
  END IF;
  IF TG_OP <> 'INSERT' AND (TG_OP = 'DELETE' OR OLD.bank_transaction_id IS DISTINCT FROM NEW.bank_transaction_id) THEN
    PERFORM public.recalculate_bank_transaction_match_state(OLD.bank_transaction_id);
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS finance_declaration_payment_sync ON public.finance_declaration_payments;
CREATE TRIGGER finance_declaration_payment_sync
  AFTER INSERT OR UPDATE OR DELETE ON public.finance_declaration_payments
  FOR EACH ROW EXECUTE FUNCTION private.sync_finance_declaration_payment_state();

-- Scalanie i przejmowanie kopii operacji obejmuje także płatności deklaracji.
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
            OR EXISTS (SELECT 1 FROM public.personnel_contract_payments WHERE bank_transaction_id = c.id)
            OR EXISTS (SELECT 1 FROM public.finance_declaration_payments WHERE bank_transaction_id = c.id);
  v_p_alloc := EXISTS (SELECT 1 FROM public.bank_transaction_invoice_matches WHERE bank_transaction_id = p.id)
            OR EXISTS (SELECT 1 FROM public.personnel_contract_payments WHERE bank_transaction_id = p.id)
            OR EXISTS (SELECT 1 FROM public.finance_declaration_payments WHERE bank_transaction_id = p.id);
  IF v_p_alloc AND (v_c_alloc OR c.paired_bank_transaction_id IS NOT NULL) THEN RETURN 'conflict'; END IF;

  IF v_p_alloc THEN
    UPDATE public.bank_transaction_invoice_matches SET bank_transaction_id = c.id WHERE bank_transaction_id = p.id;
    UPDATE public.personnel_contract_payments SET bank_transaction_id = c.id WHERE bank_transaction_id = p.id;
    UPDATE public.finance_declaration_payments SET bank_transaction_id = c.id WHERE bank_transaction_id = p.id;
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
  UPDATE public.finance_declaration_payments SET bank_transaction_id = v_copy WHERE bank_transaction_id = o.id;
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
       OR EXISTS (SELECT 1 FROM public.personnel_contract_payments p WHERE p.bank_transaction_id = OLD.id)
       OR EXISTS (SELECT 1 FROM public.finance_declaration_payments f WHERE f.bank_transaction_id = OLD.id) THEN
      RAISE EXCEPTION 'Ta operacja ma rozliczenia i kopię w drugim wyciągu. Usuń cały plik wyciągu albo najpierw cofnij rozliczenia.'
        USING ERRCODE = '23514';
    END IF;
    PERFORM private.promote_bank_transaction_copy_for(OLD.id);
  END IF;
  RETURN OLD;
END;
$$;

-- 3. Dokumenty do uzgodnienia (dodana kwota obciążenia w PLN dla dokumentów w walucie) ---------------
DROP FUNCTION IF EXISTS private.bank_reconciliation_documents(uuid);
CREATE FUNCTION private.bank_reconciliation_documents(p_company_id uuid)
RETURNS TABLE (
  source text, document_id uuid, number text, ksef_ref text, party text, nip text, side text, dir text,
  currency text, issue_date date, due_date date, due numeric, bank_paid numeric, manual_paid numeric,
  manual_date date, payment_status text, local_invoice_id uuid, is_shadow boolean,
  num_norm text, num_compact text, num_ok boolean, party_token text, twin_key text, pln_amount numeric
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
           )) AS is_shadow,
           NULL::numeric AS pln_amount
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
           i.paid_date, coalesce(i.payment_status, i.status), i.id, false, NULL::numeric
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
           e.payment_date, e.payment_status, NULL::uuid, false, abs(e.bank_debit_amount_pln)
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
         private.bank_party_token(d.party),
         CASE
           WHEN d.local_invoice_id IS NOT NULL THEN 'L:' || d.local_invoice_id::text
           WHEN length(replace(private.bank_norm(d.number), ' ', '')) >= 3
             THEN d.side || ':' || replace(private.bank_norm(d.number), ' ', '') || ':' || round(d.due, 2)::text
           ELSE d.source || ':' || d.id::text
         END AS twin_key,
         d.pln_amount
  FROM all_docs d
$$;

-- Deklaracja do propozycji: istniejąca (id) albo do założenia przy zatwierdzeniu (bez id).
CREATE OR REPLACE FUNCTION private.finance_declaration_doc(p_company_id uuid, p_kind text, p_form text,
  p_period_kind text, p_period_start date, p_amount numeric)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT jsonb_strip_nulls(jsonb_build_object(
    'source', 'declaration', 'id', d.id,
    'kind', p_kind, 'form', p_form, 'period_kind', p_period_kind, 'period_start', p_period_start,
    'number', private.finance_declaration_label(p_form, p_period_kind, p_period_start),
    'party', CASE WHEN p_kind = 'zus' THEN 'ZUS' ELSE 'Urząd skarbowy' END,
    'amount', round(p_amount, 2),
    'due', d.amount_due,
    'open', CASE WHEN d.amount_due IS NOT NULL THEN round(d.amount_due - coalesce((
      SELECT sum(f.amount) FROM public.finance_declaration_payments f WHERE f.declaration_id = d.id), 0), 2) END,
    'issue_date', p_period_start))
  FROM (SELECT 1) x
  LEFT JOIN public.finance_declarations d ON d.my_company_id = p_company_id AND d.kind = p_kind AND d.form = p_form
    AND d.period_kind = p_period_kind AND d.period_start = p_period_start
$$;

CREATE OR REPLACE FUNCTION private.finance_declaration_ensure(p_company_id uuid, p_kind text, p_form text,
  p_period_kind text, p_period_start date, p_created_from text, p_note text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_id uuid;
BEGIN
  SELECT id INTO v_id FROM public.finance_declarations
  WHERE my_company_id = p_company_id AND kind = p_kind AND form = p_form AND period_kind = p_period_kind
    AND period_start = p_period_start;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  INSERT INTO public.finance_declarations (my_company_id, kind, form, period_kind, period_start, created_from, notes, created_by)
  VALUES (p_company_id, p_kind, p_form, p_period_kind, p_period_start, p_created_from, p_note, public.current_invoice_employee_id())
  ON CONFLICT (my_company_id, kind, form, period_kind, period_start) DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    SELECT id INTO v_id FROM public.finance_declarations
    WHERE my_company_id = p_company_id AND kind = p_kind AND form = p_form AND period_kind = p_period_kind
      AND period_start = p_period_start;
  END IF;
  RETURN v_id;
END;
$$;

-- Operacja wyjaśniona jako ZUS / podatek (zgodność ze starszymi widokami, które czytają accounting_subtype).
CREATE OR REPLACE FUNCTION private.explain_public_payment(p_transaction_id uuid, p_kind text, p_form text, p_label text, p_by text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  UPDATE public.bank_transactions
  SET accounting_review_status = 'explained', accounting_category = 'tax_or_zus',
      accounting_subtype = CASE WHEN p_kind = 'zus' THEN 'zus_payment' WHEN p_form = 'PIT-4R' THEN 'pit4_payment'
                                WHEN p_kind = 'vat' THEN 'vat7_payment' ELSE 'other' END,
      accounting_note = coalesce(accounting_note, 'Płatność ' || p_label || '.'),
      accounting_reviewed_at = now(),
      accounting_explained_by = p_by
  WHERE id = p_transaction_id AND coalesce(accounting_review_status, 'pending') <> 'explained'
$$;

-- 4. Uzgodnienie miesiąca ------------------------------------------------------------------------
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
  v_cat record;
  v_evidence text;
  v_n_all integer;
  v_n_evid integer;
  v_n_near integer;
  v_done boolean;
  v_match_id uuid;
  v_auto integer := 0;
  v_auto_manual integer := 0;
  v_auto_explained integer := 0;
  v_auto_declarations integer := 0;
  v_auto_personnel integer := 0;
  v_auto_fx integer := 0;
  v_proposals integer := 0;
  v_choices integer := 0;
  v_hints integer := 0;
  v_errors integer := 0;
  v_ids uuid[];
  v_rejected uuid[];
  v_rejected_labels text[];
  v_amounts numeric[];
  v_n integer;
  v_mask integer;
  v_sum numeric;
  v_count integer;
  v_found integer;
  v_best integer;
  v_summary jsonb;
  v_own text[];
  v_zus_account text;
  v_tax_account text;
  v_can_personnel boolean;
  v_decl record;
  v_decl_id uuid;
  v_label text;
  v_alt date;
  v_period_end date;
  v_reason text;
  v_rate numeric;
  v_doc_amount numeric;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND NOT (public.finance_can_manage() AND public.finance_company_visible(p_company_id)) THEN
    RAISE EXCEPTION 'Brak uprawnień do uzgadniania wyciągów.' USING ERRCODE = '42501';
  END IF;
  IF p_month NOT BETWEEN 1 AND 12 THEN RAISE EXCEPTION 'Nieprawidłowy miesiąc.'; END IF;
  v_can_personnel := auth.role() IS NOT DISTINCT FROM 'service_role' OR coalesce(public.can_manage_personnel_contracts(), false);

  v_sources := public.confirm_bank_statement_sources(p_company_id, p_year, p_month);

  UPDATE public.bank_reconciliation_proposals pr SET status = 'superseded', decided_at = now()
  FROM public.bank_transactions bt JOIN public.bank_statements s ON s.id = bt.statement_id
  WHERE pr.bank_transaction_id = bt.id AND pr.status = 'open'
    AND s.my_company_id = p_company_id AND s.statement_year = p_year AND s.statement_month = p_month;

  SELECT array_remove(ARRAY[
           nullif(regexp_replace(coalesce(c.bank_account, ''), '\D', '', 'g'), ''),
           nullif(regexp_replace(coalesce(c.vat_bank_account, ''), '\D', '', 'g'), ''),
           nullif(regexp_replace(coalesce(c.private_bank_account, ''), '\D', '', 'g'), '')], NULL),
         nullif(regexp_replace(coalesce(c.zus_bank_account, ''), '\D', '', 'g'), ''),
         nullif(regexp_replace(coalesce(c.tax_office_bank_account, ''), '\D', '', 'g'), '')
  INTO v_own, v_zus_account, v_tax_account
  FROM public.my_companies c WHERE c.id = p_company_id;

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

  -- Sprzedawcy z płatności kartą poznani z wcześniejszych rozliczeń („BOLT” → STACKBLITZ).
  DROP TABLE IF EXISTS pg_temp.recon_card;
  CREATE TEMP TABLE recon_card ON COMMIT DROP AS
  SELECT DISTINCT cc.merchant, private.bank_party_token(e.seller_name) AS party_token
  FROM public.bank_transaction_invoice_matches m
  JOIN public.external_invoices e ON e.id = m.external_invoice_id
  JOIN public.bank_transactions bt ON bt.id = m.bank_transaction_id
  CROSS JOIN LATERAL private.bank_card_charge(private.bank_norm(concat_ws(' ', bt.title, bt.raw_description,
    (SELECT string_agg(concat_ws(' ', c.title, c.raw_description), ' ') FROM public.bank_transactions c WHERE c.canonical_transaction_id = bt.id)))) cc
  WHERE e.my_company_id = p_company_id AND cc.merchant IS NOT NULL;
  DELETE FROM recon_card WHERE party_token = '';

  -- Średni kurs z dotychczasowych płatności walutowych (do sprawdzania przelewów bez kwoty oryginalnej).
  DROP TABLE IF EXISTS pg_temp.recon_fx;
  CREATE TEMP TABLE recon_fx ON COMMIT DROP AS
  SELECT upper(m.document_currency) AS currency, avg(m.exchange_rate) AS rate, count(*) AS n
  FROM public.bank_transaction_invoice_matches m
  JOIN public.bank_transactions bt ON bt.id = m.bank_transaction_id
  JOIN public.bank_statements s ON s.id = bt.statement_id
  WHERE s.my_company_id = p_company_id AND m.exchange_rate IS NOT NULL AND m.exchange_rate > 0
    AND upper(coalesce(m.document_currency, m.currency)) <> upper(m.currency)
    AND bt.transaction_date >= make_date(p_year, p_month, 1) - 180
  GROUP BY 1;

  -- Wypłaty z umów kadrowych czekające na przelew.
  DROP TABLE IF EXISTS pg_temp.recon_pay;
  CREATE TEMP TABLE recon_pay ON COMMIT DROP AS
  SELECT p.id, p.amount, upper(coalesce(p.currency, 'PLN')) AS currency, p.payment_date, p.payment_type,
         coalesce(p.payroll_net_confirmed, false) AS net_confirmed, p.recipient_name, p.title,
         pc.id AS contract_id, pc.contract_number, pc.contract_kind,
         (regexp_match(private.bank_norm(p.recipient_name), '([A-Z0-9]{3,})$'))[1] AS surname,
         (regexp_match(private.bank_norm(translate(upper(p.recipient_name), 'ĄĆĘŁŃÓŚŹŻ', '')), '([A-Z0-9]{4,})$'))[1] AS surname_broken,
         array_remove(ARRAY[nullif(regexp_replace(coalesce(pc.party_bank_account, ''), '\D', '', 'g'), ''),
                            nullif(regexp_replace(coalesce(pp.bank_account, ''), '\D', '', 'g'), '')], NULL) AS ibans,
         false AS linked
  FROM public.personnel_contract_payments p
  JOIN public.personnel_contracts pc ON pc.id = p.personnel_contract_id
  LEFT JOIN public.personnel_people pp ON pp.id = pc.person_id
  WHERE (pc.my_company_id = p_company_id OR pc.my_company_id IS NULL) AND p.bank_transaction_id IS NULL
    AND coalesce(p.payment_method, 'bank') = 'bank' AND p.payment_type NOT IN ('tax', 'zus');

  DROP TABLE IF EXISTS pg_temp.recon_pay_iban;
  CREATE TEMP TABLE recon_pay_iban ON COMMIT DROP AS
  SELECT DISTINCT regexp_replace(bt.counterparty_account, '\D', '', 'g') AS iban, p.personnel_contract_id AS contract_id
  FROM public.personnel_contract_payments p
  JOIN public.bank_transactions bt ON bt.id = p.bank_transaction_id
  WHERE length(regexp_replace(coalesce(bt.counterparty_account, ''), '\D', '', 'g')) >= 20;

  -- Operacje główne miesiąca z tekstem z obu wyciągów.
  DROP TABLE IF EXISTS pg_temp.recon_tx;
  CREATE TEMP TABLE recon_tx ON COMMIT DROP AS
  SELECT bt.id, bt.transaction_date AS date, abs(bt.amount) AS amount, bt.transaction_type AS dir,
         upper(coalesce(bt.currency, 'PLN')) AS currency,
         greatest(abs(bt.amount) - private.bank_transaction_allocated(bt.id), 0) AS remaining,
         private.bank_norm(concat_ws(' ', bt.title, bt.raw_description, bt.counterparty_name, bt.raw_counterparty, bt.reference_number,
           (SELECT string_agg(concat_ws(' ', c.title, c.raw_description, c.counterparty_name, c.raw_counterparty), ' ')
            FROM public.bank_transactions c WHERE c.canonical_transaction_id = bt.id))) AS text_norm,
         private.bank_norm(coalesce(nullif(btrim(bt.counterparty_name), ''), bt.raw_counterparty)) AS counterparty_norm,
         regexp_replace(coalesce(bt.counterparty_account, ''), '\D', '', 'g') AS iban,
         bt.accounting_review_status = 'explained' AS explained,
         coalesce(bt.accounting_category, '') AS category,
         coalesce(bt.accounting_explained_by, '') AS explained_by,
         bt.paired_bank_transaction_id IS NOT NULL OR bt.private_transfer_detected AS transfer
  FROM public.bank_transactions bt
  JOIN public.bank_statements s ON s.id = bt.statement_id
  WHERE s.my_company_id = p_company_id AND s.statement_year = p_year AND s.statement_month = p_month
    AND s.processed AND s.validation_status = 'valid' AND bt.canonical_transaction_id IS NULL;
  ALTER TABLE recon_tx ADD COLUMN text_compact text, ADD COLUMN card_amount numeric, ADD COLUMN card_currency text,
    ADD COLUMN card_merchant text, ADD COLUMN pub_kind text, ADD COLUMN pub_form text, ADD COLUMN pub_period_kind text,
    ADD COLUMN pub_period_start date;
  UPDATE recon_tx SET text_compact = replace(text_norm, ' ', '');
  UPDATE recon_tx r SET card_amount = c.amount, card_currency = c.currency, card_merchant = coalesce(c.merchant, '')
  FROM recon_tx x CROSS JOIN LATERAL private.bank_card_charge(x.text_norm) c
  WHERE x.id = r.id AND r.dir = 'debit';
  UPDATE recon_tx r SET pub_kind = p.kind, pub_form = p.form, pub_period_kind = p.period_kind, pub_period_start = p.period_start
  FROM recon_tx x CROSS JOIN LATERAL private.bank_public_payment(x.text_norm, x.counterparty_norm, x.iban, v_own, v_zus_account, v_tax_account) p
  WHERE x.id = r.id AND r.dir = 'debit';

  DROP TABLE IF EXISTS pg_temp.recon_card_cand;
  CREATE TEMP TABLE recon_card_cand (LIKE recon_docs) ON COMMIT DROP;
  ALTER TABLE recon_card_cand ADD COLUMN doc_open numeric, ADD COLUMN evid boolean, ADD COLUMN dist integer;
  DROP TABLE IF EXISTS pg_temp.recon_fx_cand;
  CREATE TEMP TABLE recon_fx_cand (LIKE recon_docs) ON COMMIT DROP;
  ALTER TABLE recon_fx_cand ADD COLUMN doc_open numeric, ADD COLUMN ref_rate numeric, ADD COLUMN pln_exact boolean,
    ADD COLUMN evid boolean, ADD COLUMN dist integer;
  DROP TABLE IF EXISTS pg_temp.recon_pay_cand;
  CREATE TEMP TABLE recon_pay_cand (LIKE recon_pay) ON COMMIT DROP;
  ALTER TABLE recon_pay_cand ADD COLUMN ev text;

  FOR t IN
    SELECT * FROM recon_tx
    WHERE remaining > 0.009 AND NOT transfer
      AND (NOT explained OR (category = 'tax_or_zus' AND pub_kind IS NOT NULL AND explained_by NOT LIKE 'rejected:%'))
    ORDER BY date, id
  LOOP
    v_done := false;
    -- Dokumenty, które człowiek odrzucił dla tej operacji (propozycja lub cofnięte dopasowanie), nie wracają.
    SELECT coalesce(array_agg(DISTINCT (e ->> 'id')::uuid) FILTER (WHERE e ? 'id'), '{}'::uuid[]),
           coalesce(array_agg(DISTINCT e ->> 'number') FILTER (WHERE e ->> 'source' = 'declaration' AND e ? 'number'), '{}'::text[])
    INTO v_rejected, v_rejected_labels
    FROM public.bank_reconciliation_proposals pr, jsonb_array_elements(pr.documents) e
    WHERE pr.bank_transaction_id = t.id AND pr.status = 'rejected';

    -- Operacja wyjaśniona jako ZUS / podatek bez przypisanej deklaracji: tylko reguła deklaracji.
    IF t.explained THEN
      v_done := false;
    ELSE
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
      ELSIF abs(d.manual_open - t.remaining) <= 0.01 AND d.open_bank <= 0.009 AND d.source IN ('ksef', 'external') THEN
        -- Dokument oznaczony ręcznie jako opłacony — wyciąg to potwierdza: ręczny wpis zastępuje powiązanie z wyciągiem.
        BEGIN
          v_reason := 'Reguła „opłacona ręcznie — potwierdzona wyciągiem”: numer ' || coalesce(d.number, '') || ' w tytule, kwota ' || private.money_pl(t.remaining);
          IF d.source = 'ksef' THEN
            SELECT (public.reconcile_paid_ksef_invoice_with_bank_transaction(t.id, d.document_id, t.remaining, 0.99, ARRAY[v_reason])).id
            INTO v_match_id;
          ELSE
            SELECT (public.reconcile_external_invoice_with_bank_transaction(t.id, d.document_id, t.remaining, t.remaining, 0.99, ARRAY[v_reason])).id
            INTO v_match_id;
          END IF;
          UPDATE public.bank_transaction_invoice_matches SET match_method = 'automatic', match_reasons = ARRAY[v_reason] WHERE id = v_match_id;
          UPDATE recon_docs SET manual_open = greatest(manual_open - t.remaining, 0) WHERE twin_key = d.twin_key;
          v_auto_manual := v_auto_manual + 1;
        EXCEPTION WHEN OTHERS THEN
          v_errors := v_errors + 1;
          IF private.add_bank_proposal(t.id, 'allocate', 'oplacona_recznie', jsonb_build_array(private.bank_proposal_document(to_jsonb(d), t.remaining)),
               'Dokument ' || coalesce(d.number, '') || ' jest oznaczony ręcznie jako opłacony, a przelew go potwierdza. Automatyczne powiązanie zatrzymała kontrola: ' || SQLERRM) THEN
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

    -- Reguła 3: płatność kartą w walucie — kwota oryginalna z wyciągu = kwota dokumentu spoza KSeF w tej walucie.
    IF NOT v_done AND t.card_currency IS NOT NULL AND t.card_currency <> t.currency THEN
      TRUNCATE recon_card_cand;
      INSERT INTO recon_card_cand
      SELECT rd.*,
             CASE WHEN rd.open_bank > 0.009 THEN rd.open_bank ELSE rd.manual_open END AS doc_open,
             (rd.party_token <> '' AND position(' ' || rd.party_token || ' ' IN ' ' || t.text_norm || ' ') > 0)
               OR EXISTS (SELECT 1 FROM recon_card rc WHERE rc.merchant = t.card_merchant AND rc.party_token = rd.party_token) AS evid,
             abs(coalesce(rd.issue_date, t.date) - t.date) AS dist
      FROM recon_docs rd
      WHERE rd.source = 'external' AND rd.dir = 'debit' AND rd.currency = t.card_currency
        AND NOT (rd.document_id = ANY(v_rejected))
        AND (abs(rd.open_bank - t.card_amount) <= 0.01 OR (rd.open_bank <= 0.009 AND abs(rd.manual_open - t.card_amount) <= 0.01))
        AND coalesce(rd.issue_date, t.date) BETWEEN t.date - 45 AND t.date + 10;
      SELECT count(*), count(*) FILTER (WHERE evid), count(*) FILTER (WHERE evid AND dist <= 7)
      INTO v_n_all, v_n_evid, v_n_near FROM recon_card_cand;
      v_rate := round(t.remaining / nullif(t.card_amount, 0), 6);

      IF v_n_near = 1 THEN
        SELECT * INTO d FROM recon_card_cand WHERE evid AND dist <= 7 LIMIT 1;
        v_done := true;
        v_reason := 'Reguła „karta w walucie”: z wyciągu ' || to_char(t.card_amount, 'FM999999990.00') || ' ' || t.card_currency ||
          ' = kwota dokumentu ' || coalesce(d.number, '') || ', sprzedawca ' || coalesce(nullif(d.party_token, ''), d.party, '') ||
          ', kurs banku ' || to_char(v_rate, 'FM990.0000');
        BEGIN
          SELECT (public.reconcile_external_invoice_with_bank_transaction(t.id, d.document_id, t.remaining, t.card_amount, 0.99, ARRAY[v_reason])).id
          INTO v_match_id;
          UPDATE public.bank_transaction_invoice_matches SET match_method = 'automatic', match_reasons = ARRAY[v_reason] WHERE id = v_match_id;
          UPDATE recon_docs SET open_bank = greatest(open_bank - t.card_amount, 0),
                                manual_open = CASE WHEN open_bank <= 0.009 THEN greatest(manual_open - t.card_amount, 0) ELSE manual_open END
          WHERE twin_key = d.twin_key;
          v_auto_fx := v_auto_fx + 1;
        EXCEPTION WHEN OTHERS THEN
          v_errors := v_errors + 1;
          IF private.add_bank_proposal(t.id, 'allocate', 'karta_waluta', jsonb_build_array(
               private.bank_proposal_document(to_jsonb(d), t.remaining, 'sprzedawca w opisie płatności kartą')
               || jsonb_build_object('document_amount', t.card_amount, 'document_currency', t.card_currency, 'rate', v_rate)),
               'Płatność kartą ' || to_char(t.card_amount, 'FM999999990.00') || ' ' || t.card_currency || ' odpowiada dokumentowi ' ||
               coalesce(d.number, '') || ', ale automatyczne rozliczenie zatrzymała kontrola: ' || SQLERRM) THEN
            v_proposals := v_proposals + 1;
          END IF;
        END;
      ELSIF v_n_all >= 1 THEN
        v_done := true;
        SELECT jsonb_agg(private.bank_proposal_document(to_jsonb(c), t.remaining, CASE WHEN c.evid THEN 'sprzedawca w opisie płatności kartą' END)
                 || jsonb_build_object('document_amount', t.card_amount, 'document_currency', t.card_currency, 'rate', v_rate)
                 ORDER BY c.evid DESC, c.dist)
        INTO v_docs FROM (SELECT * FROM recon_card_cand ORDER BY evid DESC, dist LIMIT 5) c;
        IF v_n_all = 1 OR v_n_evid = 1 THEN
          IF private.add_bank_proposal(t.id, 'allocate', 'karta_waluta', jsonb_build_array(v_docs -> 0),
               'Płatność kartą ' || to_char(t.card_amount, 'FM999999990.00') || ' ' || t.card_currency || ' (' || private.money_pl(t.remaining) ||
               ') = kwota dokumentu ' || coalesce(v_docs -> 0 ->> 'number', '') ||
               CASE WHEN v_n_evid = 1 THEN '; data dokumentu jest dalej niż 7 dni od płatności — sprawdź.'
                    ELSE '; sprzedawca nie jest potwierdzony w opisie płatności — sprawdź.' END) THEN
            v_proposals := v_proposals + 1;
          END IF;
        ELSE
          IF private.add_bank_proposal(t.id, 'choose', 'karta_waluta', v_docs,
               v_n_all || ' dokumentów w ' || t.card_currency || ' ma kwotę ' || to_char(t.card_amount, 'FM999999990.00') ||
               ' — wybierz ten, którego dotyczy płatność kartą.') THEN
            v_choices := v_choices + 1;
          END IF;
        END IF;
      ELSE
        v_done := true;
        IF private.add_bank_proposal(t.id, 'hint', 'karta_brak_dokumentu', '[]'::jsonb,
             'Płatność kartą ' || to_char(t.card_amount, 'FM999999990.00') || ' ' || t.card_currency ||
             CASE WHEN coalesce(t.card_merchant, '') <> '' THEN ' (' || t.card_merchant || ')' ELSE '' END ||
             ' — w dokumentach spoza KSeF nie ma faktury w ' || t.card_currency || ' na tę kwotę. Dodaj dokument (kwota w walucie z faktury).') THEN
          v_hints := v_hints + 1;
        END IF;
      END IF;
    END IF;
    END IF; -- t.explained

    -- Reguła 4: przelew do ZUS / na mikrorachunek podatkowy → deklaracja za okres z tytułu.
    IF NOT v_done AND t.pub_kind IS NOT NULL AND t.explained_by NOT LIKE 'rejected:%' THEN
      v_done := true;
      IF t.pub_period_start IS NULL THEN
        v_label := CASE WHEN t.pub_kind = 'zus' THEN 'ZUS' ELSE t.pub_form END;
        PERFORM private.explain_public_payment(t.id, t.pub_kind, t.pub_form, v_label, 'rule:deklaracja');
        IF NOT t.explained THEN v_auto_explained := v_auto_explained + 1; END IF;
        IF t.pub_kind = 'zus' THEN
          v_alt := date_trunc('month', t.date - interval '1 month')::date;
          v_docs := jsonb_build_array(private.finance_declaration_doc(p_company_id, 'zus', 'DRA', 'month', v_alt, t.remaining),
                                      private.finance_declaration_doc(p_company_id, 'zus', 'DRA', 'month', (v_alt - interval '1 month')::date, t.remaining));
          IF private.add_bank_proposal(t.id, 'choose', 'deklaracja_okres', v_docs,
               'Przelew do ZUS bez okresu w tytule. Wybierz deklarację DRA, której dotyczy (zwykle poprzedni miesiąc).') THEN
            v_choices := v_choices + 1;
          END IF;
        END IF;
      ELSE
        v_label := private.finance_declaration_label(t.pub_form, t.pub_period_kind, t.pub_period_start);
        v_period_end := private.finance_period_end(t.pub_period_kind, t.pub_period_start);
        PERFORM private.explain_public_payment(t.id, t.pub_kind, t.pub_form, v_label, 'rule:deklaracja');
        IF NOT t.explained THEN v_auto_explained := v_auto_explained + 1; END IF;

        IF t.date < t.pub_period_start
           OR t.date > v_period_end + (CASE WHEN t.pub_period_kind = 'year' THEN interval '18 months' ELSE interval '9 months' END) THEN
          -- Okres w tytule nie pasuje do daty przelewu (np. „DRA 02.2025” zapłacone w marcu 2026).
          v_alt := CASE WHEN t.pub_period_kind = 'year' THEN make_date(extract(year FROM t.date)::int - 1, 1, 1)
                        ELSE make_date(extract(year FROM t.date)::int, extract(month FROM t.pub_period_start)::int, 1) END;
          IF v_alt > t.date THEN v_alt := (v_alt - interval '1 year')::date; END IF;
          v_docs := jsonb_build_array(private.finance_declaration_doc(p_company_id, t.pub_kind, t.pub_form, t.pub_period_kind, t.pub_period_start, t.remaining));
          IF v_alt <> t.pub_period_start THEN
            v_docs := jsonb_build_array(private.finance_declaration_doc(p_company_id, t.pub_kind, t.pub_form, t.pub_period_kind, v_alt, t.remaining)) || v_docs;
          END IF;
          IF private.add_bank_proposal(t.id, 'choose', 'deklaracja_okres', v_docs,
               'Tytuł wskazuje ' || v_label || ', ale przelew jest z ' || to_char(t.date, 'DD.MM.YYYY') ||
               '. To wygląda na pomyłkę w roku — wybierz właściwy okres.') THEN
            v_choices := v_choices + 1;
          END IF;
        ELSE
          SELECT dcl.*, coalesce((SELECT sum(f.amount) FROM public.finance_declaration_payments f WHERE f.declaration_id = dcl.id), 0) AS paid
          INTO v_decl
          FROM public.finance_declarations dcl
          WHERE dcl.my_company_id = p_company_id AND dcl.kind = t.pub_kind AND dcl.form = t.pub_form
            AND dcl.period_kind = t.pub_period_kind AND dcl.period_start = t.pub_period_start;

          IF (v_decl.id IS NOT NULL AND v_decl.id = ANY(v_rejected)) OR v_label = ANY(v_rejected_labels) THEN
            NULL; -- człowiek odpiął tę deklarację od przelewu — nie wracamy do niej
          ELSIF v_decl.id IS NOT NULL AND v_decl.amount_due IS NOT NULL AND t.remaining > v_decl.amount_due - v_decl.paid + 0.01 THEN
            IF private.add_bank_proposal(t.id, 'allocate', 'deklaracja_nadplata',
                 jsonb_build_array(private.finance_declaration_doc(p_company_id, t.pub_kind, t.pub_form, t.pub_period_kind, t.pub_period_start, t.remaining)),
                 v_label || ': do zapłaty ' || private.money_pl(v_decl.amount_due) || ', zapłacono już ' || private.money_pl(v_decl.paid) ||
                 '. Przelew ' || private.money_pl(t.remaining) || ' przekracza pozostałą kwotę — sprawdź (nadpłata, korekta deklaracji, odsetki).') THEN
              v_proposals := v_proposals + 1;
            END IF;
          ELSE
            BEGIN
              v_decl_id := coalesce(v_decl.id, private.finance_declaration_ensure(p_company_id, t.pub_kind, t.pub_form, t.pub_period_kind,
                t.pub_period_start, 'payment',
                'Założona automatycznie z przelewu z ' || to_char(t.date, 'DD.MM.YYYY') || ' — uzupełnij kwotę z deklaracji i dodaj plik.'));
              INSERT INTO public.finance_declaration_payments (declaration_id, bank_transaction_id, amount, match_method, match_reasons, created_by)
              VALUES (v_decl_id, t.id, t.remaining, 'automatic',
                ARRAY['Reguła „deklaracja z tytułu”: odbiorca ' || CASE WHEN t.pub_kind = 'zus' THEN 'ZUS' ELSE 'urząd skarbowy (mikrorachunek)' END ||
                      ', w tytule ' || v_label] ||
                CASE WHEN v_decl.id IS NULL THEN ARRAY['Deklaracji nie było w rejestrze — założona z tego przelewu, bez kwoty z deklaracji.']
                     WHEN v_decl.amount_due IS NULL THEN ARRAY['Deklaracja nie ma jeszcze kwoty — porównanie z kwotą do zapłaty po jej uzupełnieniu.']
                     ELSE ARRAY['Kwota mieści się w pozostałej do zapłaty: ' || private.money_pl(v_decl.amount_due - v_decl.paid)] END,
                public.current_invoice_employee_id());
              v_auto_declarations := v_auto_declarations + 1;
            EXCEPTION WHEN OTHERS THEN
              v_errors := v_errors + 1;
              IF private.add_bank_proposal(t.id, 'allocate', 'deklaracja',
                   jsonb_build_array(private.finance_declaration_doc(p_company_id, t.pub_kind, t.pub_form, t.pub_period_kind, t.pub_period_start, t.remaining)),
                   'Przelew dotyczy ' || v_label || ', ale automatyczne przypisanie zatrzymała kontrola: ' || SQLERRM) THEN
                v_proposals := v_proposals + 1;
              END IF;
            END;
          END IF;
        END IF;
      END IF;
    END IF;

    -- Reguła 5: operacje bez faktury rozpoznawane po tytule (ZUS/podatek bez symbolu, opłaty bankowe).
    IF NOT v_done AND NOT t.explained AND t.explained_by NOT LIKE 'rejected:%' THEN
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
    IF t.explained THEN v_done := true; END IF;

    -- Reguła 6: wypłata z umowy kadrowej — kwota, odbiorca (nazwisko albo rachunek) i data.
    IF NOT v_done AND t.dir = 'debit' THEN
      TRUNCATE recon_pay_cand;
      INSERT INTO recon_pay_cand
      SELECT rp.*,
             CASE
               WHEN t.iban <> '' AND (t.iban = ANY(rp.ibans) OR EXISTS (SELECT 1 FROM recon_pay_iban pi WHERE pi.contract_id = rp.contract_id AND pi.iban = t.iban))
                 THEN 'rachunek odbiorcy jak przy wcześniejszych wypłatach'
               WHEN EXISTS (SELECT 1 FROM unnest(rp.ibans) i WHERE length(i) >= 20 AND position(i IN t.text_compact) > 0)
                 OR EXISTS (SELECT 1 FROM recon_pay_iban pi WHERE pi.contract_id = rp.contract_id AND position(pi.iban IN t.text_compact) > 0)
                 THEN 'rachunek odbiorcy w treści przelewu'
               WHEN rp.surname IS NOT NULL AND position(' ' || rp.surname || ' ' IN ' ' || t.text_norm || ' ') > 0
                 THEN 'nazwisko „' || rp.surname || '” w przelewie'
               WHEN rp.surname_broken IS NOT NULL AND rp.surname_broken IS DISTINCT FROM rp.surname
                    AND position(' ' || rp.surname_broken || ' ' IN ' ' || t.text_norm || ' ') > 0
                 THEN 'nazwisko w przelewie (bez polskich znaków)'
             END AS ev
      FROM recon_pay rp
      WHERE NOT rp.linked AND rp.currency = t.currency AND abs(rp.amount - t.remaining) <= 0.01
        AND abs(rp.payment_date - t.date) <= 10 AND NOT (rp.id = ANY(v_rejected));
      DELETE FROM recon_pay_cand WHERE ev IS NULL;
      SELECT count(*) INTO v_n_all FROM recon_pay_cand;

      IF v_n_all = 1 THEN
        SELECT * INTO d FROM recon_pay_cand LIMIT 1;
        v_done := true;
        v_reason := 'Reguła „wypłata z umowy”: ' || d.recipient_name || ' (umowa ' || coalesce(d.contract_number, 'bez numeru') || '), kwota ' ||
          private.money_pl(t.remaining) || ', ' || d.ev || ', data wypłaty ' || to_char(d.payment_date, 'DD.MM.YYYY');
        IF (d.payment_type <> 'salary' OR d.net_confirmed) AND v_can_personnel THEN
          BEGIN
            UPDATE public.personnel_contract_payments
            SET bank_transaction_id = t.id, bank_match_method = 'automatic', bank_match_reasons = ARRAY[v_reason]
            WHERE id = d.id AND bank_transaction_id IS NULL;
            UPDATE recon_pay SET linked = true WHERE id = d.id;
            v_auto_personnel := v_auto_personnel + 1;
          EXCEPTION WHEN OTHERS THEN
            v_errors := v_errors + 1;
            IF private.add_bank_proposal(t.id, 'allocate', 'wynagrodzenie', jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
                 'source', 'personnel', 'id', d.id, 'number', d.contract_number, 'party', d.recipient_name, 'amount', round(t.remaining, 2),
                 'issue_date', d.payment_date, 'title', d.title, 'evidence', d.ev))),
                 'Wypłata dla ' || d.recipient_name || ' pasuje, ale automatyczne powiązanie zatrzymała kontrola: ' || SQLERRM) THEN
              v_proposals := v_proposals + 1;
            END IF;
          END;
        ELSE
          IF private.add_bank_proposal(t.id, 'allocate', 'wynagrodzenie', jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
               'source', 'personnel', 'id', d.id, 'number', d.contract_number, 'party', d.recipient_name, 'amount', round(t.remaining, 2),
               'issue_date', d.payment_date, 'title', d.title, 'evidence', d.ev,
               'confirm_net', d.payment_type = 'salary' AND NOT d.net_confirmed))),
               'Wypłata dla ' || d.recipient_name || ' (umowa ' || coalesce(d.contract_number, 'bez numeru') || '): kwota ' ||
               private.money_pl(t.remaining) || ' i ' || d.ev || '.' ||
               CASE WHEN d.payment_type = 'salary' AND NOT d.net_confirmed
                    THEN ' Kwota netto nie jest jeszcze potwierdzona — zatwierdzenie potwierdzi, że to netto przelane na konto.'
                    ELSE ' Powiązanie wymaga uprawnień kadrowych.' END) THEN
            v_proposals := v_proposals + 1;
          END IF;
        END IF;
      ELSIF v_n_all > 1 THEN
        v_done := true;
        SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                 'source', 'personnel', 'id', c.id, 'number', c.contract_number, 'party', c.recipient_name, 'amount', round(t.remaining, 2),
                 'issue_date', c.payment_date, 'title', c.title, 'evidence', c.ev,
                 'confirm_net', c.payment_type = 'salary' AND NOT c.net_confirmed)) ORDER BY abs(c.payment_date - t.date))
        INTO v_docs FROM recon_pay_cand c;
        IF private.add_bank_proposal(t.id, 'choose', 'wynagrodzenie', v_docs,
             v_n_all || ' zapisane wypłaty pasują do tego przelewu. Wybierz właściwą.') THEN
          v_choices := v_choices + 1;
        END IF;
      ELSIF t.text_norm ~ '(^| )(WYNAGRODZ[A-Z]*|PENSJ[A-Z]*|PREMI[A-Z]*|EKWIWALENT|ZLECENI[A-Z]*|DZIELO)( |$)' THEN
        v_done := true;
        IF private.add_bank_proposal(t.id, 'hint', 'wynagrodzenie_bez_wyplaty', '[]'::jsonb,
             'Przelew wygląda na wynagrodzenie, ale w umowach kadrowych nie ma zapisanej wypłaty na ' || private.money_pl(t.remaining) ||
             ' z tą datą. Dodaj wypłatę przy umowie (netto na konto) — przy następnym uzgodnieniu powiążę ją z przelewem.') THEN
          v_hints := v_hints + 1;
        END IF;
      END IF;
    END IF;

    -- Reguła 7: zgodna kwota (i kontrahent) — zawsze do zatwierdzenia przez człowieka.
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

    -- Reguła 8: przelew w PLN za dokument w walucie (bez kwoty oryginalnej w wyciągu).
    IF NOT v_done AND t.dir = 'debit' THEN
      TRUNCATE recon_fx_cand;
      INSERT INTO recon_fx_cand
      SELECT rd.*,
             CASE WHEN rd.open_bank > 0.009 THEN rd.open_bank ELSE rd.manual_open END AS doc_open,
             fx.rate AS ref_rate,
             (rd.pln_amount IS NOT NULL AND abs(rd.pln_amount - t.remaining) <= 0.01) AS pln_exact,
             (length(rd.nip) = 10 AND position(rd.nip IN t.text_compact) > 0)
               OR EXISTS (SELECT 1 FROM recon_iban ri WHERE ri.iban = t.iban AND ri.nip = rd.nip)
               OR (rd.party_token <> '' AND position(' ' || rd.party_token || ' ' IN ' ' || t.text_norm || ' ') > 0) AS evid,
             abs(coalesce(rd.issue_date, t.date) - t.date) AS dist
      FROM recon_docs rd
      LEFT JOIN recon_fx fx ON fx.currency = rd.currency
      WHERE rd.source = 'external' AND rd.dir = 'debit' AND rd.currency <> t.currency
        AND NOT (rd.document_id = ANY(v_rejected)) AND (rd.open_bank > 0.009 OR rd.manual_open > 0.009)
        AND coalesce(rd.issue_date, t.date) BETWEEN t.date - 60 AND t.date + 10;
      DELETE FROM recon_fx_cand c
      WHERE NOT c.pln_exact AND NOT (c.evid AND c.ref_rate IS NOT NULL
        AND abs(t.remaining / nullif(c.doc_open, 0) / c.ref_rate - 1) <= 0.04);
      SELECT count(*), count(*) FILTER (WHERE pln_exact AND evid) INTO v_n_all, v_n_evid FROM recon_fx_cand;

      IF v_n_evid = 1 THEN
        SELECT * INTO d FROM recon_fx_cand WHERE pln_exact AND evid LIMIT 1;
        v_done := true;
        v_reason := 'Reguła „kwota obciążenia w PLN”: dokument ' || coalesce(d.number, '') || ' (' || to_char(d.doc_open, 'FM999999990.00') || ' ' ||
          d.currency || ') ma zapisaną kwotę obciążenia ' || private.money_pl(d.pln_amount) || ' = przelew; kontrahent potwierdzony';
        BEGIN
          SELECT (public.reconcile_external_invoice_with_bank_transaction(t.id, d.document_id, t.remaining, d.doc_open, 0.99, ARRAY[v_reason])).id
          INTO v_match_id;
          UPDATE public.bank_transaction_invoice_matches SET match_method = 'automatic', match_reasons = ARRAY[v_reason] WHERE id = v_match_id;
          UPDATE recon_docs SET open_bank = 0, manual_open = 0 WHERE twin_key = d.twin_key;
          v_auto_fx := v_auto_fx + 1;
        EXCEPTION WHEN OTHERS THEN
          v_errors := v_errors + 1;
        END;
      ELSIF v_n_all >= 1 THEN
        v_done := true;
        SELECT jsonb_agg(private.bank_proposal_document(to_jsonb(c), t.remaining,
                 CASE WHEN c.pln_exact THEN 'zapisana kwota obciążenia w PLN' ELSE 'kurs ' || to_char(t.remaining / c.doc_open, 'FM990.0000') ||
                   ' (średni z ostatnich płatności ' || to_char(c.ref_rate, 'FM990.0000') || ')' END)
                 || jsonb_build_object('document_amount', c.doc_open, 'document_currency', c.currency, 'rate', round(t.remaining / c.doc_open, 6))
                 ORDER BY c.pln_exact DESC, c.dist)
        INTO v_docs FROM (SELECT * FROM recon_fx_cand ORDER BY pln_exact DESC, dist LIMIT 5) c;
        IF private.add_bank_proposal(t.id, CASE WHEN v_n_all = 1 THEN 'allocate' ELSE 'choose' END, 'waluta_kurs',
             CASE WHEN v_n_all = 1 THEN jsonb_build_array(v_docs -> 0) ELSE v_docs END,
             CASE WHEN v_n_all = 1
               THEN 'Przelew ' || private.money_pl(t.remaining) || ' odpowiada dokumentowi w walucie ' || coalesce(v_docs -> 0 ->> 'number', '') ||
                    ' (' || coalesce(v_docs -> 0 ->> 'evidence', '') || '). Sprawdź przed zatwierdzeniem.'
               ELSE v_n_all || ' dokumentów w walucie pasuje do kwoty przelewu po przeliczeniu kursem. Wybierz właściwy.' END) THEN
          IF v_n_all = 1 THEN v_proposals := v_proposals + 1; ELSE v_choices := v_choices + 1; END IF;
        END IF;
      END IF;
    END IF;

    -- Reguła 9: płatność zbiorcza (Allegro, PayU, Przelewy24…) — suma kilku faktur z okolicy daty.
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
    'auto_fx', v_auto_fx,
    'auto_personnel', v_auto_personnel,
    'auto_declarations', v_auto_declarations,
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

-- 5. Decyzje człowieka --------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.accept_bank_reconciliation_proposal(p_proposal_id uuid, p_document_index integer DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_proposal public.bank_reconciliation_proposals%ROWTYPE;
  v_company uuid;
  v_doc jsonb;
  v_docs jsonb;
  v_reason text;
  v_count integer := 0;
  v_declaration uuid;
  v_label text;
  v_kind text;
  v_form text;
  v_payment public.personnel_contract_payments%ROWTYPE;
  v_contract_company uuid;
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
    IF v_doc ->> 'source' = 'declaration' THEN
      v_declaration := nullif(v_doc ->> 'id', '')::uuid;
      IF v_declaration IS NULL THEN
        v_declaration := private.finance_declaration_ensure(v_company, v_doc ->> 'kind', v_doc ->> 'form', v_doc ->> 'period_kind',
          (v_doc ->> 'period_start')::date, 'payment', 'Założona przy zatwierdzeniu płatności — uzupełnij kwotę z deklaracji i dodaj plik.');
      END IF;
      SELECT private.finance_declaration_label(d.form, d.period_kind, d.period_start), d.kind, d.form
      INTO v_label, v_kind, v_form
      FROM public.finance_declarations d WHERE d.id = v_declaration AND d.my_company_id = v_company;
      IF v_label IS NULL THEN RAISE EXCEPTION 'Deklaracja nie należy do tej firmy.'; END IF;
      INSERT INTO public.finance_declaration_payments (declaration_id, bank_transaction_id, amount, match_method, match_reasons, created_by)
      VALUES (v_declaration, v_proposal.bank_transaction_id, (v_doc ->> 'amount')::numeric, 'manual', ARRAY[v_reason],
        public.current_invoice_employee_id());
      PERFORM private.explain_public_payment(v_proposal.bank_transaction_id, v_kind, v_form, v_label, NULL);
    ELSIF v_doc ->> 'source' = 'personnel' THEN
      IF auth.role() IS DISTINCT FROM 'service_role' AND NOT coalesce(public.can_manage_personnel_contracts(), false) THEN
        RAISE EXCEPTION 'Powiązanie wypłaty wymaga uprawnień do umów kadrowych.' USING ERRCODE = '42501';
      END IF;
      SELECT p.* INTO v_payment FROM public.personnel_contract_payments p WHERE p.id = (v_doc ->> 'id')::uuid FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Wypłata nie istnieje. Odśwież uzgodnienie.'; END IF;
      IF v_payment.bank_transaction_id IS NOT NULL THEN RAISE EXCEPTION 'Ta wypłata jest już powiązana z innym przelewem.'; END IF;
      SELECT pc.my_company_id INTO v_contract_company FROM public.personnel_contracts pc WHERE pc.id = v_payment.personnel_contract_id;
      IF v_contract_company IS NOT NULL AND v_contract_company IS DISTINCT FROM v_company THEN
        RAISE EXCEPTION 'Wypłata i przelew należą do różnych firm.';
      END IF;
      IF abs(v_payment.amount - (v_doc ->> 'amount')::numeric) > 0.01 THEN
        RAISE EXCEPTION 'Kwota wypłaty zmieniła się od czasu propozycji. Odśwież uzgodnienie.';
      END IF;
      UPDATE public.personnel_contract_payments
      SET payroll_net_confirmed = CASE WHEN payment_type = 'salary' THEN true ELSE payroll_net_confirmed END,
          bank_transaction_id = v_proposal.bank_transaction_id,
          bank_match_method = 'manual',
          bank_match_reasons = ARRAY[v_reason] ||
            CASE WHEN payment_type = 'salary' AND NOT coalesce(payroll_net_confirmed, false)
                 THEN ARRAY['Zatwierdzenie potwierdziło kwotę netto na konto.'] ELSE ARRAY[]::text[] END
      WHERE id = v_payment.id;
      IF v_payment.personnel_contract_id IS NOT NULL AND v_contract_company IS NULL THEN
        UPDATE public.personnel_contracts SET my_company_id = v_company WHERE id = v_payment.personnel_contract_id;
      END IF;
    ELSIF v_doc ->> 'source' = 'external' AND v_doc ? 'document_amount' THEN
      PERFORM public.reconcile_external_invoice_with_bank_transaction(v_proposal.bank_transaction_id,
        (v_doc ->> 'id')::uuid, (v_doc ->> 'amount')::numeric, (v_doc ->> 'document_amount')::numeric, 1, ARRAY[v_reason]);
    ELSIF coalesce((v_doc ->> 'manual')::boolean, false) AND v_doc ->> 'source' = 'ksef' THEN
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

CREATE OR REPLACE FUNCTION private.require_finance_manage_for_transaction(p_transaction_id uuid)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_company uuid;
BEGIN
  SELECT s.my_company_id INTO v_company
  FROM public.bank_transactions bt JOIN public.bank_statements s ON s.id = bt.statement_id
  WHERE bt.id = p_transaction_id;
  IF v_company IS NULL THEN RAISE EXCEPTION 'Nie znaleziono operacji. Odśwież widok.'; END IF;
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND NOT (public.finance_can_manage() AND public.finance_company_visible(v_company)) THEN
    RAISE EXCEPTION 'Brak uprawnień do rozliczania płatności.' USING ERRCODE = '42501';
  END IF;
  RETURN v_company;
END;
$$;

-- Ręczne przypięcie przelewu do deklaracji (z rejestru albo z operacji).
CREATE OR REPLACE FUNCTION public.link_bank_transaction_to_declaration(p_transaction_id uuid, p_declaration_id uuid, p_amount numeric DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_company uuid;
  v_declaration public.finance_declarations%ROWTYPE;
  v_amount numeric;
  v_id uuid;
BEGIN
  v_company := private.require_finance_manage_for_transaction(p_transaction_id);
  SELECT * INTO v_declaration FROM public.finance_declarations WHERE id = p_declaration_id AND my_company_id = v_company;
  IF NOT FOUND THEN RAISE EXCEPTION 'Deklaracja nie należy do firmy tej operacji.'; END IF;
  SELECT round(coalesce(p_amount, abs(bt.amount) - private.bank_transaction_allocated(bt.id)), 2) INTO v_amount
  FROM public.bank_transactions bt WHERE bt.id = p_transaction_id;
  IF v_amount IS NULL OR v_amount <= 0 THEN RAISE EXCEPTION 'Operacja jest już w całości rozliczona.'; END IF;
  INSERT INTO public.finance_declaration_payments (declaration_id, bank_transaction_id, amount, match_method, match_reasons, created_by)
  VALUES (p_declaration_id, p_transaction_id, v_amount, 'manual', ARRAY['Przypisane ręcznie do deklaracji'], public.current_invoice_employee_id())
  RETURNING id INTO v_id;
  PERFORM private.explain_public_payment(p_transaction_id, v_declaration.kind, v_declaration.form,
    private.finance_declaration_label(v_declaration.form, v_declaration.period_kind, v_declaration.period_start), NULL);
  UPDATE public.bank_reconciliation_proposals SET status = 'superseded', decided_at = now()
  WHERE bank_transaction_id = p_transaction_id AND status = 'open';
  RETURN v_id;
END;
$$;

-- Odpięcie przelewu od deklaracji: para nie wraca automatycznie; pusta deklaracja założona z przelewu znika.
CREATE OR REPLACE FUNCTION public.undo_bank_declaration_payment(p_payment_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_payment public.finance_declaration_payments%ROWTYPE;
  v_declaration public.finance_declarations%ROWTYPE;
BEGIN
  SELECT * INTO v_payment FROM public.finance_declaration_payments WHERE id = p_payment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Przypisanie już nie istnieje. Odśwież widok.'; END IF;
  PERFORM private.require_finance_manage_for_transaction(v_payment.bank_transaction_id);
  SELECT * INTO v_declaration FROM public.finance_declarations WHERE id = v_payment.declaration_id;
  DELETE FROM public.finance_declaration_payments WHERE id = p_payment_id;
  INSERT INTO public.bank_reconciliation_proposals (bank_transaction_id, kind, rule, documents, reason, status, decided_at, decided_by)
  VALUES (v_payment.bank_transaction_id, 'allocate', 'cofniete',
    jsonb_build_array(jsonb_build_object('source', 'declaration', 'id', v_declaration.id,
      'number', private.finance_declaration_label(v_declaration.form, v_declaration.period_kind, v_declaration.period_start),
      'amount', v_payment.amount)),
    'Przypisanie do deklaracji cofnięte przez użytkownika' || CASE WHEN v_payment.match_method = 'automatic' THEN ' (było automatyczne).' ELSE '.' END,
    'rejected', now(), public.current_invoice_employee_id());
  IF v_declaration.created_from = 'payment' AND v_declaration.amount_due IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.finance_declaration_payments WHERE declaration_id = v_declaration.id)
     AND NOT EXISTS (SELECT 1 FROM public.finance_declaration_files WHERE declaration_id = v_declaration.id)
     AND NOT EXISTS (SELECT 1 FROM public.finance_declaration_lines WHERE declaration_id = v_declaration.id) THEN
    DELETE FROM public.finance_declarations WHERE id = v_declaration.id;
  END IF;
END;
$$;

-- Odpięcie wypłaty od przelewu: para nie wraca automatycznie.
CREATE OR REPLACE FUNCTION public.undo_bank_personnel_payment(p_transaction_id uuid, p_payment_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_payment public.personnel_contract_payments%ROWTYPE;
  v_number text;
BEGIN
  PERFORM private.require_finance_manage_for_transaction(p_transaction_id);
  IF auth.role() IS DISTINCT FROM 'service_role' AND NOT coalesce(public.can_manage_personnel_contracts(), false) THEN
    RAISE EXCEPTION 'Odpięcie wypłaty wymaga uprawnień do umów kadrowych.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_payment FROM public.personnel_contract_payments
  WHERE id = p_payment_id AND bank_transaction_id = p_transaction_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Powiązanie już nie istnieje. Odśwież widok.'; END IF;
  SELECT contract_number INTO v_number FROM public.personnel_contracts WHERE id = v_payment.personnel_contract_id;
  UPDATE public.personnel_contract_payments
  SET bank_transaction_id = NULL, bank_match_method = NULL, bank_match_reasons = NULL
  WHERE id = p_payment_id;
  INSERT INTO public.bank_reconciliation_proposals (bank_transaction_id, kind, rule, documents, reason, status, decided_at, decided_by)
  VALUES (p_transaction_id, 'allocate', 'cofniete',
    jsonb_build_array(jsonb_build_object('source', 'personnel', 'id', v_payment.id, 'number', v_number,
      'party', v_payment.recipient_name, 'amount', v_payment.amount)),
    'Powiązanie wypłaty cofnięte przez użytkownika' || CASE WHEN v_payment.bank_match_method = 'automatic' THEN ' (było automatyczne).' ELSE '.' END,
    'rejected', now(), public.current_invoice_employee_id());
END;
$$;

-- 6. Rejestr deklaracji -------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.require_finance_company(p_company_id uuid, p_manage boolean)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' AND NOT (
       (CASE WHEN p_manage THEN public.finance_can_manage() ELSE public.finance_can_view() END)
       AND public.finance_company_visible(p_company_id)) THEN
    RAISE EXCEPTION 'Brak uprawnień do deklaracji tej firmy.' USING ERRCODE = '42501';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.save_finance_declaration(p_id uuid, p_company_id uuid, p_kind text, p_form text,
  p_period_kind text, p_period_start date, p_amount_due numeric, p_due_date date, p_notes text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_start date;
  v_id uuid;
  v_existing uuid;
BEGIN
  PERFORM private.require_finance_company(p_company_id, true);
  IF p_kind NOT IN ('zus', 'pit', 'vat', 'cit', 'other') THEN RAISE EXCEPTION 'Nieznany rodzaj deklaracji.'; END IF;
  IF p_period_kind NOT IN ('month', 'quarter', 'year') THEN RAISE EXCEPTION 'Nieznany rodzaj okresu.'; END IF;
  IF nullif(btrim(p_form), '') IS NULL THEN RAISE EXCEPTION 'Podaj symbol deklaracji (np. DRA, PIT-4R, VAT-7).'; END IF;
  IF p_amount_due IS NOT NULL AND p_amount_due < 0 THEN RAISE EXCEPTION 'Kwota do zapłaty nie może być ujemna.'; END IF;
  v_start := CASE p_period_kind WHEN 'year' THEN date_trunc('year', p_period_start)::date
                                WHEN 'quarter' THEN date_trunc('quarter', p_period_start)::date
                                ELSE date_trunc('month', p_period_start)::date END;

  SELECT id INTO v_existing FROM public.finance_declarations
  WHERE my_company_id = p_company_id AND kind = p_kind AND form = upper(btrim(p_form))
    AND period_kind = p_period_kind AND period_start = v_start;

  IF p_id IS NULL THEN
    IF v_existing IS NOT NULL THEN
      v_id := v_existing; -- np. deklaracja założona wcześniej z przelewu — uzupełniamy ją
      UPDATE public.finance_declarations
      SET amount_due = coalesce(p_amount_due, amount_due), due_date = coalesce(p_due_date, due_date),
          notes = coalesce(nullif(btrim(p_notes), ''), notes), updated_at = now()
      WHERE id = v_id;
    ELSE
      INSERT INTO public.finance_declarations (my_company_id, kind, form, period_kind, period_start, amount_due, due_date, notes, created_from, created_by)
      VALUES (p_company_id, p_kind, upper(btrim(p_form)), p_period_kind, v_start, round(p_amount_due, 2), p_due_date,
        nullif(btrim(p_notes), ''), 'manual', public.current_invoice_employee_id())
      RETURNING id INTO v_id;
    END IF;
  ELSE
    IF v_existing IS NOT NULL AND v_existing <> p_id THEN
      RAISE EXCEPTION 'Deklaracja % już jest w rejestrze.', private.finance_declaration_label(upper(btrim(p_form)), p_period_kind, v_start);
    END IF;
    UPDATE public.finance_declarations
    SET kind = p_kind, form = upper(btrim(p_form)), period_kind = p_period_kind, period_start = v_start,
        amount_due = round(p_amount_due, 2), due_date = p_due_date, notes = nullif(btrim(p_notes), ''), updated_at = now()
    WHERE id = p_id AND my_company_id = p_company_id
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN RAISE EXCEPTION 'Nie znaleziono deklaracji.'; END IF;
  END IF;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_finance_declaration(p_id uuid)
RETURNS text[] LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_company uuid;
  v_paths text[];
BEGIN
  SELECT my_company_id INTO v_company FROM public.finance_declarations WHERE id = p_id;
  IF v_company IS NULL THEN RAISE EXCEPTION 'Nie znaleziono deklaracji.'; END IF;
  PERFORM private.require_finance_company(v_company, true);
  IF EXISTS (SELECT 1 FROM public.finance_declaration_payments WHERE declaration_id = p_id) THEN
    RAISE EXCEPTION 'Deklaracja ma przypisane przelewy. Najpierw odepnij płatności w uzgodnieniu wyciągu.';
  END IF;
  SELECT coalesce(array_agg(storage_path), '{}') INTO v_paths FROM public.finance_declaration_files WHERE declaration_id = p_id;
  DELETE FROM public.finance_declarations WHERE id = p_id;
  RETURN v_paths; -- pliki do usunięcia z magazynu po stronie aplikacji
END;
$$;

CREATE OR REPLACE FUNCTION public.add_finance_declaration_file(p_declaration_id uuid, p_storage_path text, p_file_name text,
  p_mime_type text, p_file_size bigint)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_company uuid;
  v_id uuid;
BEGIN
  SELECT my_company_id INTO v_company FROM public.finance_declarations WHERE id = p_declaration_id;
  IF v_company IS NULL THEN RAISE EXCEPTION 'Nie znaleziono deklaracji.'; END IF;
  PERFORM private.require_finance_company(v_company, true);
  IF p_storage_path NOT LIKE v_company::text || '/' || p_declaration_id::text || '/%' THEN
    RAISE EXCEPTION 'Nieprawidłowa ścieżka pliku.';
  END IF;
  INSERT INTO public.finance_declaration_files (declaration_id, storage_path, file_name, mime_type, file_size, created_by)
  VALUES (p_declaration_id, p_storage_path, left(coalesce(nullif(btrim(p_file_name), ''), 'plik'), 255), p_mime_type, p_file_size,
    public.current_invoice_employee_id())
  RETURNING id INTO v_id;
  UPDATE public.finance_declarations SET updated_at = now() WHERE id = p_declaration_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.remove_finance_declaration_file(p_file_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_company uuid;
  v_path text;
BEGIN
  SELECT d.my_company_id, f.storage_path INTO v_company, v_path
  FROM public.finance_declaration_files f JOIN public.finance_declarations d ON d.id = f.declaration_id
  WHERE f.id = p_file_id;
  IF v_company IS NULL THEN RAISE EXCEPTION 'Nie znaleziono pliku.'; END IF;
  PERFORM private.require_finance_company(v_company, true);
  DELETE FROM public.finance_declaration_files WHERE id = p_file_id;
  RETURN v_path;
END;
$$;

CREATE OR REPLACE FUNCTION public.save_finance_declaration_line(p_id uuid, p_declaration_id uuid, p_contract_id uuid,
  p_person_name text, p_social_insured numeric, p_social_payer numeric, p_health numeric, p_funds numeric, p_pit numeric, p_notes text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_company uuid;
  v_contract_company uuid;
  v_id uuid;
BEGIN
  SELECT my_company_id INTO v_company FROM public.finance_declarations WHERE id = p_declaration_id;
  IF v_company IS NULL THEN RAISE EXCEPTION 'Nie znaleziono deklaracji.'; END IF;
  PERFORM private.require_finance_company(v_company, true);
  IF p_contract_id IS NOT NULL THEN
    SELECT my_company_id INTO v_contract_company FROM public.personnel_contracts WHERE id = p_contract_id;
    IF v_contract_company IS NOT NULL AND v_contract_company <> v_company THEN
      RAISE EXCEPTION 'Umowa należy do innej firmy.';
    END IF;
  END IF;
  IF p_id IS NULL THEN
    INSERT INTO public.finance_declaration_lines (declaration_id, personnel_contract_id, person_name, social_insured, social_payer,
      health, funds, pit, notes, created_by)
    VALUES (p_declaration_id, p_contract_id, btrim(p_person_name), round(coalesce(p_social_insured, 0), 2), round(coalesce(p_social_payer, 0), 2),
      round(coalesce(p_health, 0), 2), round(coalesce(p_funds, 0), 2), round(coalesce(p_pit, 0), 2), nullif(btrim(p_notes), ''),
      public.current_invoice_employee_id())
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.finance_declaration_lines
    SET personnel_contract_id = p_contract_id, person_name = btrim(p_person_name),
        social_insured = round(coalesce(p_social_insured, 0), 2), social_payer = round(coalesce(p_social_payer, 0), 2),
        health = round(coalesce(p_health, 0), 2), funds = round(coalesce(p_funds, 0), 2), pit = round(coalesce(p_pit, 0), 2),
        notes = nullif(btrim(p_notes), ''), updated_at = now()
    WHERE id = p_id AND declaration_id = p_declaration_id
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN RAISE EXCEPTION 'Nie znaleziono pozycji deklaracji.'; END IF;
  END IF;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_finance_declaration_line(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_company uuid;
BEGIN
  SELECT d.my_company_id INTO v_company
  FROM public.finance_declaration_lines l JOIN public.finance_declarations d ON d.id = l.declaration_id WHERE l.id = p_id;
  IF v_company IS NULL THEN RETURN; END IF;
  PERFORM private.require_finance_company(v_company, true);
  DELETE FROM public.finance_declaration_lines WHERE id = p_id;
END;
$$;

-- Osoby z umowami w okresie deklaracji (umowa obowiązująca albo wypłata w okresie lub do 45 dni po nim).
CREATE OR REPLACE FUNCTION public.prefill_finance_declaration_lines(p_declaration_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_declaration public.finance_declarations%ROWTYPE;
  v_end date;
  v_count integer;
BEGIN
  SELECT * INTO v_declaration FROM public.finance_declarations WHERE id = p_declaration_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Nie znaleziono deklaracji.'; END IF;
  PERFORM private.require_finance_company(v_declaration.my_company_id, true);
  v_end := private.finance_period_end(v_declaration.period_kind, v_declaration.period_start);
  INSERT INTO public.finance_declaration_lines (declaration_id, personnel_contract_id, person_name, created_by)
  SELECT v_declaration.id, pc.id, coalesce(nullif(btrim(pc.party_name), ''), 'Osoba bez nazwy'), public.current_invoice_employee_id()
  FROM public.personnel_contracts pc
  WHERE pc.my_company_id = v_declaration.my_company_id AND pc.status <> 'draft'
    AND (v_declaration.kind = 'pit' OR pc.contract_kind IN ('employment', 'mandate'))
    AND ((pc.start_date <= v_end AND (pc.end_date IS NULL OR pc.end_date >= v_declaration.period_start))
         OR EXISTS (SELECT 1 FROM public.personnel_contract_payments p
                    WHERE p.personnel_contract_id = pc.id AND p.payment_type IN ('salary', 'advance')
                      AND p.payment_date BETWEEN v_declaration.period_start AND v_end + 45))
    AND NOT EXISTS (SELECT 1 FROM public.finance_declaration_lines l
                    WHERE l.declaration_id = v_declaration.id AND l.personnel_contract_id = pc.id);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION private.finance_declaration_status(p_amount_due numeric, p_paid numeric)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = pg_catalog AS $$
  SELECT CASE
    WHEN p_amount_due IS NULL AND coalesce(p_paid, 0) > 0.009 THEN 'amount_missing'
    WHEN p_amount_due IS NULL THEN 'draft'
    WHEN p_amount_due <= 0.009 AND coalesce(p_paid, 0) <= 0.009 THEN 'nothing_due'
    WHEN coalesce(p_paid, 0) <= 0.009 THEN 'unpaid'
    WHEN abs(p_paid - p_amount_due) <= 0.01 THEN 'paid'
    WHEN p_paid < p_amount_due THEN 'underpaid'
    ELSE 'overpaid'
  END
$$;

CREATE OR REPLACE FUNCTION private.finance_declaration_json(p_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT jsonb_build_object(
    'id', d.id, 'company_id', d.my_company_id, 'kind', d.kind, 'form', d.form,
    'label', private.finance_declaration_label(d.form, d.period_kind, d.period_start),
    'period_kind', d.period_kind, 'period_start', d.period_start,
    'period_end', private.finance_period_end(d.period_kind, d.period_start),
    'amount_due', d.amount_due, 'due_date', d.due_date, 'notes', d.notes, 'created_from', d.created_from,
    'paid', round(pay.total, 2),
    'status', private.finance_declaration_status(d.amount_due, pay.total),
    'payments', coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', f.id, 'transaction_id', f.bank_transaction_id, 'date', bt.transaction_date,
        'amount', f.amount, 'method', f.match_method, 'reasons', f.match_reasons, 'title', bt.title,
        'statement_year', s.statement_year, 'statement_month', s.statement_month) ORDER BY bt.transaction_date, f.created_at)
      FROM public.finance_declaration_payments f
      JOIN public.bank_transactions bt ON bt.id = f.bank_transaction_id
      JOIN public.bank_statements s ON s.id = bt.statement_id
      WHERE f.declaration_id = d.id), '[]'::jsonb),
    'files', coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', fl.id, 'storage_path', fl.storage_path, 'file_name', fl.file_name,
        'mime_type', fl.mime_type, 'file_size', fl.file_size, 'created_at', fl.created_at) ORDER BY fl.created_at)
      FROM public.finance_declaration_files fl WHERE fl.declaration_id = d.id), '[]'::jsonb),
    'lines', coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', l.id, 'contract_id', l.personnel_contract_id, 'contract_number', pc.contract_number,
        'contract_kind', pc.contract_kind, 'person_name', l.person_name, 'social_insured', l.social_insured, 'social_payer', l.social_payer,
        'health', l.health, 'funds', l.funds, 'pit', l.pit, 'amount', l.amount, 'notes', l.notes) ORDER BY l.person_name, l.created_at)
      FROM public.finance_declaration_lines l
      LEFT JOIN public.personnel_contracts pc ON pc.id = l.personnel_contract_id
      WHERE l.declaration_id = d.id), '[]'::jsonb),
    'lines_total', coalesce((SELECT round(sum(l.amount), 2) FROM public.finance_declaration_lines l WHERE l.declaration_id = d.id), 0))
  FROM public.finance_declarations d
  CROSS JOIN LATERAL (SELECT coalesce(sum(f.amount), 0) AS total FROM public.finance_declaration_payments f WHERE f.declaration_id = d.id) pay
  WHERE d.id = p_id
$$;

CREATE OR REPLACE FUNCTION public.get_finance_declarations(p_company_id uuid, p_year integer)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  PERFORM private.require_finance_company(p_company_id, false);
  RETURN coalesce((
    SELECT jsonb_agg(private.finance_declaration_json(d.id) ORDER BY d.period_start DESC, d.kind, d.form)
    FROM public.finance_declarations d
    WHERE d.my_company_id = p_company_id AND extract(year FROM d.period_start) = p_year), '[]'::jsonb);
END;
$$;

-- 7. Widok miesiąca dla ekranu „Uzgodnienie wyciągów” ------------------------------------------------
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
            'exchange_rate', CASE WHEN upper(coalesce(m.document_currency, m.currency)) <> upper(m.currency) THEN m.exchange_rate END))
            ORDER BY m.created_at)
          FROM public.bank_transaction_invoice_matches m
          LEFT JOIN public.ksef_invoices k ON k.id = m.ksef_invoice_id
          LEFT JOIN public.invoices i ON i.id = m.invoice_id
          LEFT JOIN public.external_invoices e ON e.id = m.external_invoice_id
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
        'proposal', r.proposal)
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
$$;

-- 8. Uprawnienia ----------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION private.bank_party_token(text), private.iso_currency_code(text), private.bank_card_charge(text),
  private.bank_public_payment(text, text, text, text[], text, text), private.finance_period_end(text, date),
  private.finance_declaration_label(text, text, date), private.bank_transaction_allocated(uuid, uuid, uuid, uuid),
  private.guard_finance_declaration_payment(), private.sync_finance_declaration_payment_state(),
  private.bank_reconciliation_documents(uuid), private.finance_declaration_doc(uuid, text, text, text, date, numeric),
  private.finance_declaration_ensure(uuid, text, text, text, date, text, text),
  private.explain_public_payment(uuid, text, text, text, text), private.require_finance_manage_for_transaction(uuid),
  private.require_finance_company(uuid, boolean), private.finance_declaration_status(numeric, numeric),
  private.finance_declaration_json(uuid)
  FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.link_bank_transaction_to_declaration(uuid, uuid, numeric),
  public.undo_bank_declaration_payment(uuid), public.undo_bank_personnel_payment(uuid, uuid),
  public.save_finance_declaration(uuid, uuid, text, text, text, date, numeric, date, text),
  public.delete_finance_declaration(uuid),
  public.add_finance_declaration_file(uuid, text, text, text, bigint), public.remove_finance_declaration_file(uuid),
  public.save_finance_declaration_line(uuid, uuid, uuid, text, numeric, numeric, numeric, numeric, numeric, text),
  public.delete_finance_declaration_line(uuid), public.prefill_finance_declaration_lines(uuid),
  public.get_finance_declarations(uuid, integer),
  public.reconcile_bank_month(uuid, integer, integer), public.accept_bank_reconciliation_proposal(uuid, integer),
  public.get_bank_reconciliation_month(uuid, integer, integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.link_bank_transaction_to_declaration(uuid, uuid, numeric),
  public.undo_bank_declaration_payment(uuid), public.undo_bank_personnel_payment(uuid, uuid),
  public.save_finance_declaration(uuid, uuid, text, text, text, date, numeric, date, text),
  public.delete_finance_declaration(uuid),
  public.add_finance_declaration_file(uuid, text, text, text, bigint), public.remove_finance_declaration_file(uuid),
  public.save_finance_declaration_line(uuid, uuid, uuid, text, numeric, numeric, numeric, numeric, numeric, text),
  public.delete_finance_declaration_line(uuid), public.prefill_finance_declaration_lines(uuid),
  public.get_finance_declarations(uuid, integer),
  public.reconcile_bank_month(uuid, integer, integer), public.accept_bank_reconciliation_proposal(uuid, integer),
  public.get_bank_reconciliation_month(uuid, integer, integer)
  TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
