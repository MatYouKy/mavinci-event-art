-- Zakupy → „Moje wydatki” (`docs/purchases.md`): pracownik z uprawnieniem `finances_purchases` (np. magazynier, który robi zakupy
-- firmową kartą) prowadzi ewidencję swoich zakupów — wprowadza dokumenty spoza KSeF (faktury, paragony z NIP firmy, inne),
-- może przypisać zakup do eventu jako koszt i co miesiąc składa rozliczenie do zatwierdzenia.
--
-- Decyzje właściciela (25.11.2026):
--  - płaci firmowa karta (wspólna), pracownik prowadzi ewidencję swoich zakupów; później może dostać osobną kartę z subkontem;
--  - rozliczenie miesiąca: dokumenty od razu są w Finansach, na koniec miesiąca „Wyślij rozliczenie”, zatwierdza albo zwraca
--    z uwagą osoba z „Finanse — zarządzanie” w działalności (administrator — wszędzie);
--  - przypisując zakup do eventu pracownik widzi wszystkie koszty tego eventu (bez budżetu i przychodów);
--  - event do wyboru — te, które pracownik widzi (jego zakres eventów).
--
-- Model:
--  - dokument = wiersz `external_invoices` z `purchased_by` (kto kupił); plik w buckecie `external-invoices`
--    (`purchases/<pracownik>/<uuid>.<ext>` — zapisuje serwer CRM po sprawdzeniu `purchase_can_record`);
--  - koszt eventu = wiersz `event_costs` z `external_invoice_id` i `from_purchase` (kwota brutto części dokumentu dla eventu,
--    jak przy „Przypisz fakturę kosztową” w podsumowaniu eventu; netto liczy podsumowanie z proporcji dokumentu);
--  - rozliczenie miesiąca = `purchase_settlements` (pracownik × działalność × miesiąc daty dokumentu); brak wiersza — otwarte.
--    Wysłane i zatwierdzone blokują zmiany dokumentów tego miesiąca; zwrócone — znowu do poprawy.
-- Pracownik nie czyta tabel bezpośrednio — wszystko przez funkcje `purchase_*` (SECURITY DEFINER, sprawdzają dostęp).
-- Finanse widzą dokumenty zakupów jak każdy dokument spoza KSeF (Koszty miesiąca, uzgodnienie wyciągów — karta).
-- Powiadomienia: wysłane rozliczenie — zatwierdzający działalności (bez autora); decyzja — pracownik.
-- Plik idempotentny — można go wykonać ponownie.

BEGIN;

-- ─── Kolumny i tabela ─────────────────────────────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.external_invoices ADD COLUMN IF NOT EXISTS purchased_by uuid REFERENCES public.employees(id) ON DELETE SET NULL;
COMMENT ON COLUMN public.external_invoices.purchased_by IS 'Zakupy → „Moje wydatki”: pracownik, który zrobił zakup i rozlicza ten dokument.';
CREATE INDEX IF NOT EXISTS external_invoices_purchased_by_date ON public.external_invoices(purchased_by, my_company_id, invoice_date)
  WHERE purchased_by IS NOT NULL;

ALTER TABLE public.event_costs ADD COLUMN IF NOT EXISTS from_purchase boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.event_costs.from_purchase IS 'Koszt eventu z zakupu pracownika („Moje wydatki”) — zmienia go tylko obieg zakupów.';
CREATE UNIQUE INDEX IF NOT EXISTS event_costs_purchase_document ON public.event_costs(external_invoice_id)
  WHERE from_purchase AND external_invoice_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.purchase_settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  my_company_id uuid NOT NULL REFERENCES public.my_companies(id) ON DELETE CASCADE,
  period_year integer NOT NULL CHECK (period_year BETWEEN 2000 AND 2100),
  period_month integer NOT NULL CHECK (period_month BETWEEN 1 AND 12),
  -- submitted — wysłane do zatwierdzenia, approved — zatwierdzone, returned — zwrócone do poprawy (z uwagą).
  status text NOT NULL CHECK (status IN ('submitted', 'approved', 'returned')),
  employee_note text CHECK (char_length(employee_note) <= 2000),
  decision_note text CHECK (char_length(decision_note) <= 2000),
  document_count integer NOT NULL DEFAULT 0 CHECK (document_count >= 0),
  -- Suma brutto dokumentów w chwili wysłania, według waluty: {"PLN": 123.45}.
  totals jsonb NOT NULL DEFAULT '{}'::jsonb,
  submitted_at timestamptz,
  decided_at timestamptz,
  decided_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT purchase_settlements_period UNIQUE (employee_id, my_company_id, period_year, period_month)
);
CREATE INDEX IF NOT EXISTS purchase_settlements_status ON public.purchase_settlements(status, my_company_id);

DROP TRIGGER IF EXISTS purchase_settlements_updated_at ON public.purchase_settlements;
CREATE TRIGGER purchase_settlements_updated_at BEFORE UPDATE ON public.purchase_settlements
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.purchase_settlements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.purchase_settlements FROM anon, authenticated;
GRANT SELECT ON public.purchase_settlements TO authenticated;
GRANT ALL ON public.purchase_settlements TO service_role;
DROP POLICY IF EXISTS purchase_settlements_read ON public.purchase_settlements;
CREATE POLICY purchase_settlements_read ON public.purchase_settlements FOR SELECT TO authenticated
  USING (employee_id = public.current_invoice_employee_id() OR public.finance_company_manageable(my_company_id));

-- ─── Dostęp ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

-- Zalogowany, aktywny pracownik CRM (nie konto portalu sprzedawcy).
CREATE OR REPLACE FUNCTION private.purchase_actor()
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_actor uuid;
BEGIN
  IF auth.uid() IS NULL OR coalesce(public.current_session_is_seller_portal(), true) THEN
    RAISE EXCEPTION 'Zaloguj się kontem pracownika CRM.' USING ERRCODE = '42501';
  END IF;
  v_actor := public.current_invoice_employee_id();
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Brak aktywnego konta pracownika.' USING ERRCODE = '42501'; END IF;
  RETURN v_actor;
END $$;

-- Zalogowany pracownik może wprowadzać swoje zakupy w działalności: uprawnienie `finances_purchases` (albo administrator), dostęp
-- do działalności, działalność aktywna i z NIP (marki bez NIP nie mają finansów).
CREATE OR REPLACE FUNCTION public.purchase_can_record(p_company uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT p_company IS NOT NULL AND auth.uid() IS NOT NULL AND NOT coalesce(public.current_session_is_seller_portal(), true)
    AND EXISTS (
      SELECT 1 FROM public.employees e
       WHERE e.id = public.current_invoice_employee_id() AND e.is_active
         AND (e.role::text = 'admin' OR e.access_level::text = 'admin'
              OR coalesce(e.permissions, '{}'::text[]) && ARRAY['admin', 'finances_purchases']::text[])
         AND public.employee_can_access_company(e.id, p_company))
    AND EXISTS (SELECT 1 FROM public.my_companies c
                 WHERE c.id = p_company AND coalesce(c.is_active, true) AND btrim(coalesce(c.nip, '')) <> '');
$$;

-- Zatwierdza rozliczenia zakupów działalności: „Finanse — zarządzanie” w tej działalności (administrator — wszędzie).
CREATE OR REPLACE FUNCTION private.purchase_can_approve(p_company uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT p_company IS NOT NULL AND auth.uid() IS NOT NULL AND coalesce(public.finance_company_manageable(p_company), false);
$$;

-- Prawa zalogowanego pracownika do „Zakupów” (menu, przyciski): działalności do zakupów i do zatwierdzania.
CREATE OR REPLACE FUNCTION public.purchases_access()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_actor uuid; v_record jsonb; v_approve jsonb;
BEGIN
  IF auth.uid() IS NULL OR coalesce(public.current_session_is_seller_portal(), true) THEN
    RETURN jsonb_build_object('employee_id', NULL, 'record', false, 'approve', false, 'record_companies', '[]'::jsonb, 'approve_companies', '[]'::jsonb);
  END IF;
  v_actor := public.current_invoice_employee_id();
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name) ORDER BY coalesce(c.is_default, false) DESC, c.name), '[]'::jsonb)
    INTO v_record FROM public.my_companies c WHERE public.purchase_can_record(c.id);
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name) ORDER BY coalesce(c.is_default, false) DESC, c.name), '[]'::jsonb)
    INTO v_approve FROM public.my_companies c
   WHERE coalesce(c.is_active, true) AND btrim(coalesce(c.nip, '')) <> '' AND private.purchase_can_approve(c.id);
  RETURN jsonb_build_object('employee_id', v_actor, 'record', jsonb_array_length(v_record) > 0, 'approve', jsonb_array_length(v_approve) > 0,
    'record_companies', v_record, 'approve_companies', v_approve);
END $$;

CREATE OR REPLACE FUNCTION private.purchase_month_name(p_month integer)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
  SELECT (ARRAY['styczeń', 'luty', 'marzec', 'kwiecień', 'maj', 'czerwiec', 'lipiec', 'sierpień', 'wrzesień', 'październik',
                'listopad', 'grudzień'])[p_month];
$$;

CREATE OR REPLACE FUNCTION private.purchase_money(p_value numeric, p_currency text DEFAULT 'PLN')
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
  SELECT replace(replace(to_char(round(coalesce(p_value, 0), 2), 'FM999G999G999G990D00'), ',', ' '), '.', ',')
    || CASE WHEN coalesce(p_currency, 'PLN') = 'PLN' THEN ' zł' ELSE ' ' || p_currency END;
$$;

-- Stan rozliczenia miesiąca (open — bez wiersza).
CREATE OR REPLACE FUNCTION private.purchase_month_status(p_employee uuid, p_company uuid, p_date date)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT coalesce((SELECT s.status FROM public.purchase_settlements s
                    WHERE s.employee_id = p_employee AND s.my_company_id = p_company
                      AND s.period_year = extract(year FROM p_date)::integer AND s.period_month = extract(month FROM p_date)::integer), 'open');
$$;

-- Zmiana dokumentów miesiąca tylko przy rozliczeniu otwartym albo zwróconym.
CREATE OR REPLACE FUNCTION private.purchase_require_open(p_employee uuid, p_company uuid, p_date date)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_status text := private.purchase_month_status(p_employee, p_company, p_date);
BEGIN
  IF v_status IN ('submitted', 'approved') THEN
    RAISE EXCEPTION 'Rozliczenie zakupów za % % jest już %. Zmiany są możliwe, gdy osoba z finansów zwróci je do poprawy.',
      private.purchase_month_name(extract(month FROM p_date)::integer), extract(year FROM p_date)::integer,
      CASE v_status WHEN 'submitted' THEN 'wysłane' ELSE 'zatwierdzone' END USING ERRCODE = '42501';
  END IF;
END $$;

-- Zmiana dokumentów miesiąca: blokada miesiąca pracownika w tej transakcji (jak przy wysłaniu rozliczenia) i kontrola stanu.
CREATE OR REPLACE FUNCTION private.purchase_lock_month(p_employee uuid, p_company uuid, p_date date)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('purchase-settlement:' || p_employee::text || ':' || p_company::text || ':'
    || extract(year FROM p_date)::integer || '-' || extract(month FROM p_date)::integer, 0));
  PERFORM private.purchase_require_open(p_employee, p_company, p_date);
END $$;

-- Koszty eventu można dopisać tylko do podsumowania w wersji roboczej (jak „Przypisz fakturę kosztową”).
CREATE OR REPLACE FUNCTION private.purchase_require_event_open(p_event uuid)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_status text; v_name text;
BEGIN
  IF p_event IS NULL THEN RETURN; END IF;
  SELECT coalesce((SELECT s.status FROM public.event_settlements s WHERE s.event_id = p_event), 'draft'), e.name
    INTO v_status, v_name FROM public.events e WHERE e.id = p_event;
  IF coalesce(v_status, 'draft') <> 'draft' THEN
    RAISE EXCEPTION 'Podsumowanie eventu „%” jest już wysłane albo zatwierdzone — koszt dopisze osoba z finansów.', coalesce(v_name, '')
      USING ERRCODE = '42501';
  END IF;
END $$;

-- ─── Odczyt ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

-- Dokument zakupu (z kosztem eventu i dopasowaniem do wyciągu).
CREATE OR REPLACE FUNCTION private.purchase_doc_json(p_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT jsonb_build_object(
    'id', x.id, 'company_id', x.my_company_id, 'company_name', c.name, 'kind', x.document_kind,
    'seller_name', x.seller_name, 'seller_nip', x.seller_nip, 'number', x.invoice_number, 'date', x.invoice_date,
    'label', x.label, 'net', x.amount_net, 'gross', x.amount_gross, 'currency', x.currency,
    'payment_method', x.payment_method, 'payment_status', x.payment_status,
    'category_id', x.category_id, 'category_name', fc.name, 'notes', x.notes, 'has_file', x.file_url IS NOT NULL,
    'bank_matched', EXISTS (SELECT 1 FROM public.bank_transaction_invoice_matches m WHERE m.external_invoice_id = x.id),
    'created_at', x.created_at, 'updated_at', x.updated_at,
    'event', CASE WHEN ec.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', ec.event_id, 'name', ev.name, 'date', ev.event_date, 'cost_id', ec.id, 'amount', ec.amount,
      'category_id', ec.category_id, 'category_name', cat.name, 'status', ec.status) END)
  FROM public.external_invoices x
  LEFT JOIN public.my_companies c ON c.id = x.my_company_id
  LEFT JOIN public.finance_categories fc ON fc.id = x.category_id
  LEFT JOIN public.event_costs ec ON ec.external_invoice_id = x.id AND ec.from_purchase
  LEFT JOIN public.events ev ON ev.id = ec.event_id
  LEFT JOIN public.event_cost_categories cat ON cat.id = ec.category_id
  WHERE x.id = p_id;
$$;

CREATE OR REPLACE FUNCTION private.purchase_settlement_json(p_settlement public.purchase_settlements)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT CASE WHEN p_settlement.id IS NULL THEN NULL ELSE jsonb_build_object(
    'id', p_settlement.id, 'status', p_settlement.status, 'employee_note', p_settlement.employee_note,
    'decision_note', p_settlement.decision_note, 'document_count', p_settlement.document_count, 'totals', p_settlement.totals,
    'submitted_at', p_settlement.submitted_at, 'decided_at', p_settlement.decided_at,
    'decided_by_name', (SELECT nullif(btrim(concat_ws(' ', e.name, e.surname)), '') FROM public.employees e WHERE e.id = p_settlement.decided_by))
  END;
$$;

-- Miesiąc zakupów pracownika: działalności (z rozliczeniem), dokumenty i wcześniejsze miesiące do rozliczenia.
-- Bez `p_employee` — własne zakupy; z innym pracownikiem — tylko działalności, w których zalogowany zatwierdza rozliczenia.
CREATE OR REPLACE FUNCTION public.purchase_month(p_year integer, p_month integer, p_employee uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_actor uuid := private.purchase_actor();
  v_employee uuid := coalesce(p_employee, v_actor);
  v_self boolean := coalesce(p_employee, v_actor) = v_actor;
  v_from date; v_to date; v_name text; v_companies uuid[]; v_company_json jsonb; v_docs jsonb; v_pending jsonb;
BEGIN
  IF p_year IS NULL OR p_month IS NULL OR p_year NOT BETWEEN 2000 AND 2100 OR p_month NOT BETWEEN 1 AND 12 THEN
    RAISE EXCEPTION 'Nieprawidłowy miesiąc.';
  END IF;
  v_from := make_date(p_year, p_month, 1);
  v_to := (v_from + interval '1 month')::date;
  SELECT nullif(btrim(concat_ws(' ', e.name, e.surname)), '') INTO v_name FROM public.employees e WHERE e.id = v_employee;
  IF NOT FOUND THEN RAISE EXCEPTION 'Nie znaleziono pracownika.' USING ERRCODE = 'P0002'; END IF;

  IF v_self THEN
    SELECT coalesce(array_agg(c.id), '{}'::uuid[]) INTO v_companies FROM public.my_companies c
     WHERE public.purchase_can_record(c.id)
        OR EXISTS (SELECT 1 FROM public.external_invoices x WHERE x.purchased_by = v_employee AND x.my_company_id = c.id);
    IF cardinality(v_companies) = 0 THEN
      RAISE EXCEPTION 'Brak uprawnienia „Zakupy — własne wydatki”. Nada je administrator w uprawnieniach pracownika.' USING ERRCODE = '42501';
    END IF;
  ELSE
    SELECT coalesce(array_agg(c.id), '{}'::uuid[]) INTO v_companies FROM public.my_companies c
     WHERE private.purchase_can_approve(c.id) AND public.employee_can_access_company(v_employee, c.id);
    IF cardinality(v_companies) = 0 THEN
      RAISE EXCEPTION 'Rozliczenia zakupów pracowników widzi osoba z „Finanse — zarządzanie” w działalności.' USING ERRCODE = '42501';
    END IF;
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', c.id, 'name', c.name,
           'can_record', v_self AND public.purchase_can_record(c.id),
           'can_approve', private.purchase_can_approve(c.id),
           'settlement', private.purchase_settlement_json(s))
         ORDER BY coalesce(c.is_default, false) DESC, c.name), '[]'::jsonb)
    INTO v_company_json
    FROM public.my_companies c
    LEFT JOIN public.purchase_settlements s ON s.employee_id = v_employee AND s.my_company_id = c.id
     AND s.period_year = p_year AND s.period_month = p_month
   WHERE c.id = ANY (v_companies);

  SELECT coalesce(jsonb_agg(private.purchase_doc_json(x.id) ORDER BY x.invoice_date, x.created_at), '[]'::jsonb) INTO v_docs
    FROM public.external_invoices x
   WHERE x.purchased_by = v_employee AND x.my_company_id = ANY (v_companies)
     AND x.invoice_date >= v_from AND x.invoice_date < v_to;

  -- Inne miesiące z dokumentami, które nie są wysłane ani zatwierdzone (przypomnienie o rozliczeniu).
  SELECT coalesce(jsonb_agg(jsonb_build_object('year', m.y, 'month', m.m, 'company_id', m.company, 'count', m.n,
                                               'status', coalesce(s.status, 'open')) ORDER BY m.y DESC, m.m DESC), '[]'::jsonb)
    INTO v_pending
    FROM (SELECT extract(year FROM x.invoice_date)::integer AS y, extract(month FROM x.invoice_date)::integer AS m,
                 x.my_company_id AS company, count(*) AS n
            FROM public.external_invoices x
           WHERE x.purchased_by = v_employee AND x.my_company_id = ANY (v_companies)
             AND (x.invoice_date < v_from OR x.invoice_date >= v_to)
           GROUP BY 1, 2, 3) m
    LEFT JOIN public.purchase_settlements s ON s.employee_id = v_employee AND s.my_company_id = m.company
     AND s.period_year = m.y AND s.period_month = m.m
   WHERE coalesce(s.status, 'open') IN ('open', 'returned');

  RETURN jsonb_build_object('employee', jsonb_build_object('id', v_employee, 'name', coalesce(v_name, 'Pracownik')),
    'self', v_self, 'year', p_year, 'month', p_month, 'companies', v_company_json, 'documents', v_docs, 'pending_months', v_pending);
END $$;

-- Eventy do przypisania zakupu: z tej działalności (albo bez niej), nieanulowane, które zalogowany widzi; bez wyszukiwania —
-- od 120 dni wstecz do 240 dni naprzód, najbliższe dziś na górze.
CREATE OR REPLACE FUNCTION public.purchase_event_options(p_company uuid, p_search text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_actor uuid := private.purchase_actor(); v_q text := nullif(btrim(p_search), ''); v_rows jsonb;
BEGIN
  IF NOT public.purchase_can_record(p_company) AND NOT private.purchase_can_approve(p_company) THEN
    RAISE EXCEPTION 'Brak dostępu do zakupów tej działalności.' USING ERRCODE = '42501';
  END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'name', e.name, 'date', e.event_date, 'end_date', e.event_end_date,
           'status', e.status::text, 'location', e.location) ORDER BY abs(extract(epoch FROM (coalesce(e.event_date, now()) - now())))), '[]'::jsonb)
    INTO v_rows
    FROM (SELECT ev.* FROM public.events ev
           WHERE (ev.my_company_id = p_company OR ev.my_company_id IS NULL)
             AND ev.status::text <> 'cancelled'
             AND (CASE WHEN v_q IS NULL
                       THEN coalesce(ev.event_date, now()) BETWEEN now() - interval '120 days' AND now() + interval '240 days'
                       ELSE ev.name ILIKE '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%' END)
             AND public.current_employee_can_view_event(ev.id)
           ORDER BY abs(extract(epoch FROM (coalesce(ev.event_date, now()) - now())))
           LIMIT 40) e;
  RETURN v_rows;
END $$;

-- Wszystkie koszty eventu (bez budżetu i przychodów) — dla osoby, która przypisuje do niego zakup, albo z finansami eventu.
CREATE OR REPLACE FUNCTION public.purchase_event_costs(p_event uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_actor uuid := private.purchase_actor(); e public.events%ROWTYPE; v_costs jsonb; v_buyer boolean;
BEGIN
  SELECT * INTO e FROM public.events WHERE id = p_event;
  IF NOT FOUND THEN RAISE EXCEPTION 'Nie znaleziono eventu.' USING ERRCODE = 'P0002'; END IF;
  v_buyer := public.current_employee_can_view_event(p_event)
    AND EXISTS (SELECT 1 FROM public.my_companies c WHERE (e.my_company_id IS NULL OR c.id = e.my_company_id) AND public.purchase_can_record(c.id));
  IF NOT coalesce(v_buyer, false) AND NOT coalesce(public.event_finance_can_access(p_event, false), false) THEN
    RAISE EXCEPTION 'Brak dostępu do kosztów tego eventu.' USING ERRCODE = '42501';
  END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', ec.id, 'name', ec.name, 'category_name', cat.name, 'amount', ec.amount, 'currency', coalesce(ec.currency, 'PLN'),
           'date', ec.cost_date, 'status', ec.status, 'from_purchase', ec.from_purchase,
           'created_by_name', nullif(btrim(concat_ws(' ', cr.name, cr.surname)), ''),
           'mine', ec.created_by = v_actor,
           'document', CASE WHEN x.id IS NOT NULL THEN concat_ws(' ', x.seller_name, x.invoice_number)
                            WHEN k.id IS NOT NULL THEN concat_ws(' ', k.seller_name, k.invoice_number) END)
         ORDER BY ec.cost_date, ec.created_at), '[]'::jsonb)
    INTO v_costs
    FROM public.event_costs ec
    LEFT JOIN public.event_cost_categories cat ON cat.id = ec.category_id
    LEFT JOIN public.employees cr ON cr.id = ec.created_by
    LEFT JOIN public.external_invoices x ON x.id = ec.external_invoice_id
    LEFT JOIN public.ksef_invoices k ON k.id = ec.ksef_invoice_id
   WHERE ec.event_id = p_event;
  RETURN jsonb_build_object('event', jsonb_build_object('id', e.id, 'name', e.name, 'date', e.event_date, 'status', e.status::text),
    'settlement_open', coalesce((SELECT s.status FROM public.event_settlements s WHERE s.event_id = p_event), 'draft') = 'draft',
    'costs', v_costs,
    'total', (SELECT coalesce(sum(ec.amount), 0) FROM public.event_costs ec WHERE ec.event_id = p_event AND coalesce(ec.status, '') <> 'rejected'));
END $$;

-- Ścieżka pliku dokumentu zakupu (podpisany adres robi serwer CRM): autor zakupu, zatwierdzający albo dostęp do faktur firmy.
CREATE OR REPLACE FUNCTION public.purchase_document_file(p_id uuid)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_actor uuid := private.purchase_actor(); x public.external_invoices%ROWTYPE;
BEGIN
  SELECT * INTO x FROM public.external_invoices WHERE id = p_id AND purchased_by IS NOT NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Nie znaleziono dokumentu zakupu.' USING ERRCODE = 'P0002'; END IF;
  IF x.purchased_by <> v_actor AND NOT private.purchase_can_approve(x.my_company_id)
     AND NOT coalesce(public.finance_company_level_at_least(x.my_company_id, 'invoices'), false) THEN
    RAISE EXCEPTION 'Brak dostępu do tego dokumentu.' USING ERRCODE = '42501';
  END IF;
  RETURN x.file_url;
END $$;

-- Kategorie do formularza: kosztów firmy (wydatki) i kosztów eventu.
CREATE OR REPLACE FUNCTION public.purchase_categories()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT jsonb_build_object(
    'finance', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'name', f.name, 'code', f.code) ORDER BY f.sort_order, f.name), '[]'::jsonb)
                  FROM public.finance_categories f WHERE f.is_active AND f.kind IN ('expense', 'both') AND f.code <> 'internal_transfer'),
    'event', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name) ORDER BY c.name), '[]'::jsonb)
                FROM public.event_cost_categories c WHERE coalesce(c.is_active, true)))
  WHERE auth.uid() IS NOT NULL;
$$;

-- ─── Zapis dokumentu ──────────────────────────────────────────────────────────────────────────────────────────────────────

-- Zapis zakupu: nowy (`p_id` NULL) albo poprawka własnego dokumentu w otwartym / zwróconym miesiącu. `p_data`:
-- company_id, kind (invoice | receipt | other), seller_name, seller_nip, number, date, label, net, gross, currency,
-- payment_method (Karta | Gotówka | BLIK | Przelew), category_id (kategoria kosztów firmy), notes, file_path
-- (`purchases/<pracownik>/<uuid>.<ext>` — plik zapisany przez serwer CRM; brak klucza — bez zmiany pliku),
-- event_id (NULL — bez eventu), event_amount (brutto części dla eventu, domyślnie całość), event_category_id.
-- Wynik: dokument (`purchase_doc_json`) i `replaced_file` — poprzedni plik do usunięcia przez serwer.
CREATE OR REPLACE FUNCTION public.purchase_save(p_id uuid, p_data jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_actor uuid := private.purchase_actor();
  d jsonb := coalesce(p_data, '{}'::jsonb);
  o public.external_invoices%ROWTYPE;
  v_old_cost public.event_costs%ROWTYPE;
  v_company uuid; v_kind text; v_seller text; v_nip text; v_number text; v_date date; v_label text; v_net numeric; v_gross numeric;
  v_currency text; v_method text; v_category uuid; v_notes text; v_file text; v_file_given boolean := d ? 'file_path';
  v_event uuid; v_event_amount numeric; v_event_category uuid; v_paid boolean; v_id uuid; v_replaced text;
  v_bank boolean := false; v_event_company uuid; v_event_status text; v_name text; v_cost_status text;
  v_cost_name text; v_cost_method text; v_cost_same boolean := false;
BEGIN
  BEGIN
    v_company := nullif(d->>'company_id', '')::uuid;
    v_category := nullif(d->>'category_id', '')::uuid;
    v_event := nullif(d->>'event_id', '')::uuid;
    v_event_category := nullif(d->>'event_category_id', '')::uuid;
    v_date := nullif(d->>'date', '')::date;
    v_net := round(nullif(d->>'net', '')::numeric, 2);
    v_gross := round(nullif(d->>'gross', '')::numeric, 2);
    v_event_amount := round(nullif(d->>'event_amount', '')::numeric, 2);
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'Nieprawidłowe dane zakupu — sprawdź daty, kwoty i wybrane pozycje.';
  END;
  v_kind := coalesce(nullif(d->>'kind', ''), 'receipt');
  v_seller := nullif(btrim(d->>'seller_name'), '');
  v_nip := nullif(upper(regexp_replace(coalesce(d->>'seller_nip', ''), '[\s-]', '', 'g')), '');
  v_number := nullif(btrim(d->>'number'), '');
  v_label := nullif(btrim(d->>'label'), '');
  v_currency := upper(coalesce(nullif(btrim(d->>'currency'), ''), 'PLN'));
  v_method := coalesce(nullif(btrim(d->>'payment_method'), ''), 'Karta');
  v_notes := nullif(btrim(d->>'notes'), '');
  v_file := nullif(btrim(d->>'file_path'), '');

  IF v_company IS NULL THEN RAISE EXCEPTION 'Wybierz działalność, dla której jest zakup.'; END IF;
  IF NOT public.purchase_can_record(v_company) THEN
    RAISE EXCEPTION 'Nie możesz wprowadzać zakupów tej działalności (uprawnienie „Zakupy — własne wydatki” i dostęp do działalności).'
      USING ERRCODE = '42501';
  END IF;
  IF v_kind NOT IN ('invoice', 'receipt', 'other') THEN RAISE EXCEPTION 'Rodzaj dokumentu: faktura, paragon albo inny dowód zakupu.'; END IF;
  IF v_seller IS NULL OR char_length(v_seller) > 200 THEN RAISE EXCEPTION 'Podaj sprzedawcę (do 200 znaków).'; END IF;
  IF v_nip IS NOT NULL AND (char_length(v_nip) > 30 OR v_nip !~ '^[A-Z]{0,2}[0-9A-Z]{5,28}$') THEN
    RAISE EXCEPTION 'NIP sprzedawcy ma nieprawidłowy format.';
  END IF;
  IF v_number IS NULL OR char_length(v_number) > 120 THEN RAISE EXCEPTION 'Podaj numer dokumentu (faktury albo paragonu).'; END IF;
  IF v_date IS NULL OR v_date < DATE '2000-01-01' OR v_date > (now() AT TIME ZONE 'Europe/Warsaw')::date THEN
    RAISE EXCEPTION 'Data zakupu nie może być pusta ani z przyszłości.';
  END IF;
  IF v_label IS NOT NULL AND char_length(v_label) > 200 THEN RAISE EXCEPTION 'Opis zakupu może mieć do 200 znaków.'; END IF;
  IF v_gross IS NULL OR v_gross <= 0 OR v_gross >= 1e10 THEN RAISE EXCEPTION 'Podaj kwotę brutto większą od zera.'; END IF;
  IF v_net IS NOT NULL AND (v_net <= 0 OR v_net > v_gross) THEN RAISE EXCEPTION 'Kwota netto musi być dodatnia i nie większa niż brutto.'; END IF;
  IF v_currency !~ '^[A-Z]{3}$' THEN RAISE EXCEPTION 'Waluta to trzyliterowy kod, np. PLN.'; END IF;
  IF v_method NOT IN ('Karta', 'Gotówka', 'BLIK', 'Przelew') THEN RAISE EXCEPTION 'Sposób zapłaty: karta, gotówka, BLIK albo przelew.'; END IF;
  IF v_notes IS NOT NULL AND char_length(v_notes) > 2000 THEN RAISE EXCEPTION 'Uwagi mogą mieć do 2000 znaków.'; END IF;
  IF v_file IS NOT NULL AND v_file !~ ('^purchases/' || v_actor::text || '/[0-9a-f-]{36}\.(pdf|jpg|jpeg|png|webp)$') THEN
    RAISE EXCEPTION 'Nieprawidłowy plik dokumentu — dodaj go ponownie.';
  END IF;
  IF v_category IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.finance_categories f
                                             WHERE f.id = v_category AND f.is_active AND f.kind IN ('expense', 'both')) THEN
    RAISE EXCEPTION 'Wybierz kategorię kosztów z listy.';
  END IF;

  IF p_id IS NOT NULL THEN
    SELECT * INTO o FROM public.external_invoices WHERE id = p_id FOR UPDATE;
    IF NOT FOUND OR o.purchased_by IS DISTINCT FROM v_actor THEN
      RAISE EXCEPTION 'Nie znaleziono Twojego dokumentu zakupu.' USING ERRCODE = 'P0002';
    END IF;
    PERFORM private.purchase_lock_month(v_actor, o.my_company_id, o.invoice_date);
    v_bank := EXISTS (SELECT 1 FROM public.bank_transaction_invoice_matches m WHERE m.external_invoice_id = o.id);
    IF v_bank AND (o.my_company_id IS DISTINCT FROM v_company OR o.amount_gross IS DISTINCT FROM v_gross
                   OR o.currency IS DISTINCT FROM v_currency OR o.payment_method IS DISTINCT FROM v_method) THEN
      RAISE EXCEPTION 'Dokument jest już powiązany z operacją z wyciągu — działalność, kwotę, walutę i sposób zapłaty zmieni osoba z finansów.'
        USING ERRCODE = '42501';
    END IF;
    SELECT * INTO v_old_cost FROM public.event_costs WHERE external_invoice_id = o.id AND from_purchase FOR UPDATE;
  END IF;
  PERFORM private.purchase_lock_month(v_actor, v_company, v_date);

  -- Event: widoczny dla pracownika, tej działalności (albo bez niej), nieanulowany, kwota w PLN, podsumowanie robocze.
  IF v_event IS NOT NULL THEN
    SELECT e.my_company_id, e.status::text, e.name INTO v_event_company, v_event_status, v_name FROM public.events e WHERE e.id = v_event;
    IF NOT FOUND OR NOT public.current_employee_can_view_event(v_event) THEN
      RAISE EXCEPTION 'Nie znaleziono eventu albo nie masz do niego dostępu.' USING ERRCODE = '42501';
    END IF;
    IF v_event_company IS NOT NULL AND v_event_company <> v_company THEN
      RAISE EXCEPTION 'Event „%” należy do innej działalności niż dokument.', v_name;
    END IF;
    IF v_event_status = 'cancelled' THEN RAISE EXCEPTION 'Event „%” jest anulowany.', v_name; END IF;
    IF v_currency <> 'PLN' THEN RAISE EXCEPTION 'Koszt eventu z dokumentu w walucie innej niż PLN dopisze osoba z finansów.'; END IF;
    v_event_amount := coalesce(v_event_amount, v_gross);
    IF v_event_amount <= 0 OR v_event_amount > v_gross THEN
      RAISE EXCEPTION 'Kwota dla eventu musi być większa od zera i nie większa niż brutto dokumentu.';
    END IF;
    IF v_event_category IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.event_cost_categories c
                                                     WHERE c.id = v_event_category AND coalesce(c.is_active, true)) THEN
      RAISE EXCEPTION 'Wybierz kategorię kosztu eventu z listy.';
    END IF;
  END IF;
  -- Koszt eventu zmienia się (nowy, inny event, kwota, kategoria, data, nazwa, sposób zapłaty albo usunięcie) — podsumowanie
  -- dotkniętego eventu musi być robocze; bez zmian kosztu — wiersza nie ruszamy.
  v_cost_name := left(concat_ws(' — ', coalesce(v_label, 'Zakup'), v_seller), 300);
  v_cost_method := CASE v_method WHEN 'Karta' THEN 'card' WHEN 'Gotówka' THEN 'cash' WHEN 'BLIK' THEN 'blik' ELSE 'transfer' END;
  v_cost_same := v_old_cost.id IS NOT NULL AND v_event IS NOT NULL AND v_event = v_old_cost.event_id
    AND v_event_amount = v_old_cost.amount AND v_event_category IS NOT DISTINCT FROM v_old_cost.category_id
    AND v_date = v_old_cost.cost_date AND v_cost_name = v_old_cost.name AND v_cost_method IS NOT DISTINCT FROM v_old_cost.payment_method;
  IF NOT v_cost_same THEN
    IF v_old_cost.id IS NOT NULL THEN PERFORM private.purchase_require_event_open(v_old_cost.event_id); END IF;
    IF v_event IS NOT NULL THEN PERFORM private.purchase_require_event_open(v_event); END IF;
  END IF;

  v_paid := v_method IN ('Karta', 'Gotówka', 'BLIK');
  IF p_id IS NULL THEN
    INSERT INTO public.external_invoices (my_company_id, document_kind, seller_name, seller_nip, invoice_number, label, invoice_date,
      payment_method, amount_net, amount_gross, currency, category_id, notes, file_url, created_by, purchased_by,
      payment_status, paid_amount, payment_date)
    VALUES (v_company, v_kind, v_seller, v_nip, v_number, v_label, v_date, v_method, v_net, v_gross, v_currency, v_category, v_notes,
      v_file, v_actor, v_actor, CASE WHEN v_paid THEN 'paid' ELSE 'unpaid' END, CASE WHEN v_paid THEN v_gross ELSE 0 END,
      CASE WHEN v_paid THEN v_date END)
    RETURNING id INTO v_id;
  ELSE
    v_id := o.id;
    IF v_file_given AND v_file IS DISTINCT FROM o.file_url THEN v_replaced := o.file_url; END IF;
    UPDATE public.external_invoices SET my_company_id = v_company, document_kind = v_kind, seller_name = v_seller, seller_nip = v_nip,
      invoice_number = v_number, label = v_label, invoice_date = v_date, payment_method = v_method, amount_net = v_net,
      amount_gross = v_gross, currency = v_currency, category_id = v_category, notes = v_notes,
      file_url = CASE WHEN v_file_given THEN v_file ELSE o.file_url END,
      -- Płatność z wyciągu (dopasowanie) zostaje; bez niej — status ze sposobu zapłaty, jak przy nowym dokumencie.
      payment_status = CASE WHEN v_bank THEN o.payment_status WHEN v_paid THEN 'paid' ELSE 'unpaid' END,
      paid_amount = CASE WHEN v_bank THEN o.paid_amount WHEN v_paid THEN v_gross ELSE 0 END,
      payment_date = CASE WHEN v_bank THEN o.payment_date WHEN v_paid THEN v_date END,
      updated_at = now()
     WHERE id = v_id;
  END IF;

  -- Koszt eventu z zakupu.
  IF v_cost_same THEN
    NULL;
  ELSIF v_event IS NULL THEN
    IF v_old_cost.id IS NOT NULL THEN DELETE FROM public.event_costs WHERE id = v_old_cost.id; END IF;
  ELSE
    v_cost_status := CASE WHEN private.purchase_month_status(v_actor, v_company, v_date) = 'approved' THEN 'approved' ELSE 'pending' END;
    IF v_old_cost.id IS NOT NULL THEN
      UPDATE public.event_costs SET event_id = v_event, my_company_id = NULL, name = v_cost_name,
        amount = v_event_amount, currency = 'PLN', cost_date = v_date, category_id = v_event_category, payment_method = v_cost_method,
        payment_date = CASE WHEN v_paid THEN v_date END, paid_by = v_actor, status = v_cost_status,
        description = CASE WHEN v_event_amount < v_gross THEN format('Część dokumentu: %s z %s brutto',
          private.purchase_money(v_event_amount), private.purchase_money(v_gross)) END,
        updated_at = now()
       WHERE id = v_old_cost.id;
    ELSE
      INSERT INTO public.event_costs (event_id, name, description, amount, currency, cost_date, payment_date, paid_by, status,
        payment_method, category_id, external_invoice_id, from_purchase, created_by, notes)
      VALUES (v_event, v_cost_name,
        CASE WHEN v_event_amount < v_gross THEN format('Część dokumentu: %s z %s brutto',
          private.purchase_money(v_event_amount), private.purchase_money(v_gross)) END,
        v_event_amount, 'PLN', v_date, CASE WHEN v_paid THEN v_date END, v_actor, v_cost_status, v_cost_method,
        v_event_category, v_id, true, v_actor, 'Zakup pracownika (Zakupy → Moje wydatki)');
    END IF;
  END IF;

  RETURN jsonb_build_object('document', private.purchase_doc_json(v_id), 'replaced_file', v_replaced);
END $$;

-- Usunięcie własnego dokumentu (miesiąc otwarty / zwrócony, bez dopasowania do wyciągu). Wynik: plik do usunięcia przez serwer.
CREATE OR REPLACE FUNCTION public.purchase_delete(p_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_actor uuid := private.purchase_actor(); o public.external_invoices%ROWTYPE; v_cost public.event_costs%ROWTYPE;
BEGIN
  SELECT * INTO o FROM public.external_invoices WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR o.purchased_by IS DISTINCT FROM v_actor THEN
    RAISE EXCEPTION 'Nie znaleziono Twojego dokumentu zakupu.' USING ERRCODE = 'P0002';
  END IF;
  PERFORM private.purchase_lock_month(v_actor, o.my_company_id, o.invoice_date);
  IF EXISTS (SELECT 1 FROM public.bank_transaction_invoice_matches m WHERE m.external_invoice_id = o.id) THEN
    RAISE EXCEPTION 'Dokument jest powiązany z operacją z wyciągu — usunie go osoba z finansów.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_cost FROM public.event_costs WHERE external_invoice_id = o.id AND from_purchase FOR UPDATE;
  IF v_cost.id IS NOT NULL THEN
    PERFORM private.purchase_require_event_open(v_cost.event_id);
    DELETE FROM public.event_costs WHERE id = v_cost.id;
  END IF;
  DELETE FROM public.external_invoices WHERE id = o.id;
  RETURN o.file_url;
END $$;

-- Dokument usunięty w Finansach — koszt eventu z zakupu znika razem z nim (FK ustawiłby tylko pusty dokument).
CREATE OR REPLACE FUNCTION private.purchase_document_deleted()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF OLD.purchased_by IS NOT NULL THEN
    DELETE FROM public.event_costs WHERE external_invoice_id = OLD.id AND from_purchase;
  END IF;
  RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS purchase_document_deleted ON public.external_invoices;
CREATE TRIGGER purchase_document_deleted BEFORE DELETE ON public.external_invoices
  FOR EACH ROW EXECUTE FUNCTION private.purchase_document_deleted();

-- ─── Rozliczenie miesiąca ─────────────────────────────────────────────────────────────────────────────────────────────────

-- Zatwierdzający działalności (bez wskazanej osoby — autora zdarzenia).
CREATE OR REPLACE FUNCTION private.purchase_approvers(p_company uuid, p_except uuid)
RETURNS uuid[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT coalesce(array_agg(e.id), '{}'::uuid[]) FROM public.employees e
   WHERE e.is_active AND e.auth_user_id IS NOT NULL AND e.id IS DISTINCT FROM p_except
     AND private.employee_finance_company_level(e.id, p_company) = 'finance_manage';
$$;

-- Powiadomienie (bez autora zmiany); błąd zapisu powiadomienia nie cofa operacji.
CREATE OR REPLACE FUNCTION private.purchase_notify(p_recipients uuid[], p_title text, p_message text, p_type text, p_url text, p_meta jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_notice uuid; v_actor uuid := public.current_invoice_employee_id();
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.employees e WHERE e.id = ANY (coalesce(p_recipients, '{}'::uuid[])) AND e.id IS DISTINCT FROM v_actor
                 AND e.is_active AND e.auth_user_id IS NOT NULL) THEN RETURN; END IF;
  BEGIN
    INSERT INTO public.notifications(category, title, message, type, action_url, metadata)
    VALUES ('system', left(p_title, 200), left(p_message, 1000), CASE WHEN p_type IN ('info', 'success', 'warning', 'error') THEN p_type ELSE 'info' END,
            p_url, coalesce(p_meta, '{}'::jsonb) || jsonb_build_object('kind', 'purchases'))
    RETURNING id INTO v_notice;
    INSERT INTO public.notification_recipients(notification_id, user_id, is_read)
    SELECT DISTINCT v_notice, e.auth_user_id, false FROM public.employees e
     WHERE e.id = ANY (p_recipients) AND e.id IS DISTINCT FROM v_actor AND e.is_active AND e.auth_user_id IS NOT NULL
    ON CONFLICT DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Powiadomienie o rozliczeniu zakupów nie zostało zapisane: %', SQLERRM;
  END;
END $$;

-- „Wyślij rozliczenie” — miesiąc z dokumentami (każdy z plikiem) do zatwierdzenia. Wynik: `purchase_month` pracownika.
CREATE OR REPLACE FUNCTION public.purchase_submit(p_company uuid, p_year integer, p_month integer, p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_actor uuid := private.purchase_actor(); v_from date; v_to date; v_count integer; v_missing integer; v_totals jsonb;
  s public.purchase_settlements%ROWTYPE; v_name text; v_company text; v_note text := nullif(btrim(p_note), '');
BEGIN
  IF p_year IS NULL OR p_month IS NULL OR p_year NOT BETWEEN 2000 AND 2100 OR p_month NOT BETWEEN 1 AND 12 THEN
    RAISE EXCEPTION 'Nieprawidłowy miesiąc.';
  END IF;
  IF NOT public.purchase_can_record(p_company) THEN
    RAISE EXCEPTION 'Nie możesz rozliczać zakupów tej działalności.' USING ERRCODE = '42501';
  END IF;
  IF v_note IS NOT NULL AND char_length(v_note) > 2000 THEN RAISE EXCEPTION 'Uwaga może mieć do 2000 znaków.'; END IF;
  v_from := make_date(p_year, p_month, 1);
  v_to := (v_from + interval '1 month')::date;
  IF v_from > (now() AT TIME ZONE 'Europe/Warsaw')::date THEN RAISE EXCEPTION 'Nie można rozliczyć przyszłego miesiąca.'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('purchase-settlement:' || v_actor::text || ':' || p_company::text || ':'
    || p_year || '-' || p_month, 0));
  SELECT * INTO s FROM public.purchase_settlements
   WHERE employee_id = v_actor AND my_company_id = p_company AND period_year = p_year AND period_month = p_month FOR UPDATE;
  IF s.id IS NOT NULL AND s.status IN ('submitted', 'approved') THEN
    RAISE EXCEPTION 'Rozliczenie za % % jest już %.', private.purchase_month_name(p_month), p_year,
      CASE s.status WHEN 'submitted' THEN 'wysłane' ELSE 'zatwierdzone' END;
  END IF;
  SELECT count(*), count(*) FILTER (WHERE x.file_url IS NULL) INTO v_count, v_missing
    FROM public.external_invoices x
   WHERE x.purchased_by = v_actor AND x.my_company_id = p_company AND x.invoice_date >= v_from AND x.invoice_date < v_to;
  IF v_count = 0 THEN RAISE EXCEPTION 'W tym miesiącu nie ma zakupów do rozliczenia.'; END IF;
  IF v_missing > 0 THEN
    RAISE EXCEPTION 'Dodaj zdjęcie albo skan do każdego dokumentu (brakuje: %).', v_missing;
  END IF;
  SELECT coalesce(jsonb_object_agg(t.currency, t.total), '{}'::jsonb) INTO v_totals
    FROM (SELECT x.currency, round(sum(x.amount_gross), 2) AS total FROM public.external_invoices x
           WHERE x.purchased_by = v_actor AND x.my_company_id = p_company AND x.invoice_date >= v_from AND x.invoice_date < v_to
           GROUP BY x.currency) t;
  INSERT INTO public.purchase_settlements (employee_id, my_company_id, period_year, period_month, status, employee_note,
    document_count, totals, submitted_at, decided_at, decided_by, decision_note)
  VALUES (v_actor, p_company, p_year, p_month, 'submitted', v_note, v_count, v_totals, now(), NULL, NULL, NULL)
  ON CONFLICT ON CONSTRAINT purchase_settlements_period DO UPDATE SET status = 'submitted', employee_note = EXCLUDED.employee_note,
    document_count = EXCLUDED.document_count, totals = EXCLUDED.totals, submitted_at = now(), decided_at = NULL, decided_by = NULL,
    decision_note = NULL
  RETURNING * INTO s;

  SELECT nullif(btrim(concat_ws(' ', e.name, e.surname)), '') INTO v_name FROM public.employees e WHERE e.id = v_actor;
  SELECT c.name INTO v_company FROM public.my_companies c WHERE c.id = p_company;
  PERFORM private.purchase_notify(private.purchase_approvers(p_company, v_actor), 'Rozliczenie zakupów do zatwierdzenia',
    format('%s wysłał(a) rozliczenie zakupów za %s %s (%s): %s dok., %s.', coalesce(v_name, 'Pracownik'), private.purchase_month_name(p_month),
      p_year, coalesce(v_company, ''), v_count,
      (SELECT string_agg(private.purchase_money((t.value)::numeric, t.key), ', ' ORDER BY t.key) FROM jsonb_each_text(v_totals) t)),
    'info', format('/crm/purchases?employee=%s&year=%s&month=%s', v_actor, p_year, p_month),
    jsonb_build_object('purchase_settlement_id', s.id, 'employee_id', v_actor, 'year', p_year, 'month', p_month));
  RETURN public.purchase_month(p_year, p_month, NULL);
END $$;

-- Decyzja zatwierdzającego: zatwierdzenie wysłanego rozliczenia albo zwrot do poprawy z uwagą (także cofnięcie zatwierdzenia).
-- Koszty eventów z dokumentów miesiąca: zatwierdzone — „approved”, zwrócone — „pending”. Wynik: `purchase_month` pracownika.
CREATE OR REPLACE FUNCTION public.purchase_decide(p_settlement uuid, p_approve boolean, p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_actor uuid := private.purchase_actor(); s public.purchase_settlements%ROWTYPE; v_from date; v_to date;
  v_note text := nullif(btrim(p_note), ''); v_company text;
BEGIN
  SELECT * INTO s FROM public.purchase_settlements WHERE id = p_settlement FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Nie znaleziono rozliczenia.' USING ERRCODE = 'P0002'; END IF;
  IF NOT private.purchase_can_approve(s.my_company_id) THEN
    RAISE EXCEPTION 'Rozliczenia zakupów zatwierdza osoba z „Finanse — zarządzanie” w działalności.' USING ERRCODE = '42501';
  END IF;
  IF s.employee_id = v_actor AND NOT EXISTS (SELECT 1 FROM public.employees e WHERE e.id = v_actor
                                               AND (e.role::text = 'admin' OR e.access_level::text = 'admin' OR 'admin' = ANY (coalesce(e.permissions, '{}'::text[])))) THEN
    RAISE EXCEPTION 'Własne rozliczenie zatwierdza inna osoba z finansów albo administrator.' USING ERRCODE = '42501';
  END IF;
  IF v_note IS NOT NULL AND char_length(v_note) > 2000 THEN RAISE EXCEPTION 'Uwaga może mieć do 2000 znaków.'; END IF;
  IF coalesce(p_approve, false) THEN
    IF s.status <> 'submitted' THEN RAISE EXCEPTION 'Zatwierdzić można tylko wysłane rozliczenie.'; END IF;
  ELSE
    IF s.status NOT IN ('submitted', 'approved') THEN RAISE EXCEPTION 'To rozliczenie jest już zwrócone do poprawy.'; END IF;
    IF v_note IS NULL THEN RAISE EXCEPTION 'Napisz, co trzeba poprawić — pracownik zobaczy tę uwagę.'; END IF;
  END IF;
  v_from := make_date(s.period_year, s.period_month, 1);
  v_to := (v_from + interval '1 month')::date;
  UPDATE public.purchase_settlements SET status = CASE WHEN p_approve THEN 'approved' ELSE 'returned' END,
    decision_note = v_note, decided_at = now(), decided_by = v_actor
   WHERE id = s.id;
  UPDATE public.event_costs ec SET status = CASE WHEN p_approve THEN 'approved' ELSE 'pending' END, updated_at = now()
    FROM public.external_invoices x
   WHERE ec.external_invoice_id = x.id AND ec.from_purchase AND x.purchased_by = s.employee_id AND x.my_company_id = s.my_company_id
     AND x.invoice_date >= v_from AND x.invoice_date < v_to AND coalesce(ec.status, '') <> 'rejected'
     AND ec.status IS DISTINCT FROM CASE WHEN p_approve THEN 'approved' ELSE 'pending' END;
  SELECT c.name INTO v_company FROM public.my_companies c WHERE c.id = s.my_company_id;
  PERFORM private.purchase_notify(ARRAY[s.employee_id],
    CASE WHEN p_approve THEN 'Rozliczenie zakupów zatwierdzone' ELSE 'Rozliczenie zakupów do poprawy' END,
    CASE WHEN p_approve
      THEN format('Rozliczenie zakupów za %s %s (%s) zostało zatwierdzone.%s', private.purchase_month_name(s.period_month), s.period_year,
                  coalesce(v_company, ''), CASE WHEN v_note IS NOT NULL THEN ' Uwaga: ' || v_note ELSE '' END)
      ELSE format('Rozliczenie zakupów za %s %s (%s) wróciło do poprawy: %s', private.purchase_month_name(s.period_month), s.period_year,
                  coalesce(v_company, ''), v_note) END,
    CASE WHEN p_approve THEN 'success' ELSE 'warning' END,
    format('/crm/purchases?year=%s&month=%s', s.period_year, s.period_month),
    jsonb_build_object('purchase_settlement_id', s.id, 'year', s.period_year, 'month', s.period_month));
  RETURN public.purchase_month(s.period_year, s.period_month, s.employee_id);
END $$;

-- Rozliczenia do przeglądu (zatwierdzający): wysłane, zwrócone i ostatnio zatwierdzone oraz otwarte miesiące z dokumentami
-- (pracownik jeszcze nie wysłał) — działalności, w których zalogowany zatwierdza.
CREATE OR REPLACE FUNCTION public.purchase_review()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_actor uuid := private.purchase_actor(); v_companies uuid[]; v_rows jsonb;
BEGIN
  SELECT coalesce(array_agg(c.id), '{}'::uuid[]) INTO v_companies FROM public.my_companies c WHERE private.purchase_can_approve(c.id);
  IF cardinality(v_companies) = 0 THEN
    RAISE EXCEPTION 'Rozliczenia zakupów pracowników widzi osoba z „Finanse — zarządzanie” w działalności.' USING ERRCODE = '42501';
  END IF;
  WITH months AS (
    SELECT x.purchased_by AS employee_id, x.my_company_id AS company_id, extract(year FROM x.invoice_date)::integer AS y,
           extract(month FROM x.invoice_date)::integer AS m, count(*) AS docs, max(x.updated_at) AS last_change
      FROM public.external_invoices x
     WHERE x.purchased_by IS NOT NULL AND x.my_company_id = ANY (v_companies)
     GROUP BY 1, 2, 3, 4
  ), lines AS (
    SELECT coalesce(s.employee_id, m.employee_id) AS employee_id, coalesce(s.my_company_id, m.company_id) AS company_id,
           coalesce(s.period_year, m.y) AS y, coalesce(s.period_month, m.m) AS mo, coalesce(s.status, 'open') AS status, s.id AS settlement_id,
           coalesce(m.docs, 0) AS docs, s.totals, s.document_count, s.submitted_at, s.decided_at, s.decision_note, s.employee_note, m.last_change
      FROM months m
      FULL JOIN public.purchase_settlements s ON s.employee_id = m.employee_id AND s.my_company_id = m.company_id
       AND s.period_year = m.y AND s.period_month = m.m
     WHERE coalesce(s.my_company_id, m.company_id) = ANY (v_companies)
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'employee_id', r.employee_id, 'employee_name', nullif(btrim(concat_ws(' ', e.name, e.surname)), ''),
           'company_id', r.company_id, 'company_name', c.name, 'year', r.y, 'month', r.mo, 'status', r.status,
           'settlement_id', r.settlement_id, 'documents', r.docs, 'document_count', r.document_count, 'totals', r.totals,
           'submitted_at', r.submitted_at, 'decided_at', r.decided_at, 'decision_note', r.decision_note, 'employee_note', r.employee_note,
           'last_change', r.last_change)
         ORDER BY CASE r.status WHEN 'submitted' THEN 0 WHEN 'open' THEN 1 WHEN 'returned' THEN 2 ELSE 3 END, r.y DESC, r.mo DESC,
                  e.surname, e.name), '[]'::jsonb)
    INTO v_rows
    FROM lines r
    JOIN public.employees e ON e.id = r.employee_id
    JOIN public.my_companies c ON c.id = r.company_id
   WHERE r.status <> 'approved' OR r.decided_at > now() - interval '120 days';
  RETURN v_rows;
END $$;

-- ─── „Dostęp według sekcji” ───────────────────────────────────────────────────────────────────────────────────────────────

-- Zakres `finances_purchases` w sekcji „Wartości finansowe eventów” (moduł `finances`). Treść funkcji bez zmian (wersja
-- z 20261122100000_sales_showcase) poza listą znanych zakresów: + finances_purchases.
CREATE OR REPLACE FUNCTION public.admin_set_employee_section_permissions(p_employee_id uuid, p_module text, p_permissions text[], p_expected_permissions text[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE v_employee public.employees%ROWTYPE; v_current text[]; v_expected text[]; v_next text[];
 v_known constant text[] := ARRAY['events_view','events_view_planning','events_view_operational','events_manage','events_create','event_categories_manage','calendar_view','calendar_manage','calendar_view_accepted_only','tasks_view','tasks_manage','tasks_create','offers_view','offers_manage','offers_create','offers_brochures_view_own','offers_brochures_view_all','contracts_view','contracts_manage','contracts_create','contracts_own_only','offers_own_only','events_own_only','attractions_view','attractions_manage','attractions_create','clients_view','clients_manage','clients_create','contacts_view','contacts_manage','contacts_create','inquiries_view','inquiries_manage','inquiries_view_pool','inquiries_view_own','inquiries_manage_own','inquiries_view_team','inquiries_manage_team','inquiries_view_all','inquiries_manage_all','inquiries_assign','messages_view','messages_manage','messages_assign','marketing_campaigns_view','marketing_campaigns_manage','marketing_campaigns_approve','marketing_social_view','marketing_social_create','marketing_social_approve','marketing_social_publish','materials_view','materials_manage','presentations_view','presentations_manage','chat_view','chat_manage','chat_create_group','webhooks_view','webhooks_manage','equipment_view','equipment_manage','equipment_create','fleet_view','fleet_manage','fleet_create','locations_view','locations_manage','locations_create','subcontractors_manage','time_tracking_view_own','time_tracking_view','time_tracking_manage','mavinci_live_view','mavinci_live_manage','mavinci_live_light_magic','mavinci_live_quiz_show','mavinci_live_familiada','mavinci_live_wedding_show','mavinci_live_streaming','finances_view','finances_manage','finances_purchases','invoices_view','invoices_manage','databases_view','databases_manage','tenders_view','personnel_view','personnel_manage','employees_view','employees_manage','employees_create','employees_permissions','page_view','page_manage','website_edit'];
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.employees e WHERE (e.id=auth.uid() OR e.auth_user_id=auth.uid()) AND e.is_active AND (e.role='admin' OR e.access_level='admin')) THEN
  RAISE EXCEPTION 'Tylko administrator może zmieniać dostęp w ustawieniach aplikacji.' USING ERRCODE='42501';
 END IF;
 IF p_module IS NULL OR p_module !~ '^[a-z_]+$' OR NOT EXISTS(SELECT 1 FROM unnest(v_known) s WHERE starts_with(s,p_module||'_')) THEN
  RAISE EXCEPTION 'Nieznana sekcja.' USING ERRCODE='22023';
 END IF;
 IF p_permissions IS NULL OR p_expected_permissions IS NULL OR EXISTS(SELECT 1 FROM unnest(p_permissions) s WHERE s IS NULL OR NOT (s=ANY(v_known)) OR NOT starts_with(s,p_module||'_')) THEN
  RAISE EXCEPTION 'Nieprawidłowy zakres dla sekcji.' USING ERRCODE='22023';
 END IF;
 SELECT * INTO v_employee FROM public.employees WHERE id=p_employee_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Nie znaleziono pracownika.'; END IF;
 IF v_employee.role='admin' OR v_employee.access_level='admin' THEN RAISE EXCEPTION 'Administrator zachowuje pełny dostęp.' USING ERRCODE='42501'; END IF;
 SELECT coalesce(array_agg(DISTINCT s ORDER BY s),'{}') INTO v_current FROM unnest(coalesce(v_employee.permissions,'{}')) s WHERE starts_with(s,p_module||'_');
 SELECT coalesce(array_agg(DISTINCT s ORDER BY s),'{}') INTO v_expected FROM unnest(p_expected_permissions) s;
 IF v_current IS DISTINCT FROM v_expected THEN RAISE EXCEPTION 'Uprawnienia tej sekcji zmieniono w innym oknie. Otwórz edycję ponownie.' USING ERRCODE='40001'; END IF;
 SELECT coalesce(array_agg(DISTINCT s ORDER BY s),'{}') INTO v_next FROM (
 SELECT s FROM unnest(coalesce(v_employee.permissions,'{}')) s WHERE NOT starts_with(s,p_module||'_')
 UNION SELECT unnest(p_permissions)) scope;
 UPDATE public.employees SET permissions=v_next,role_permissions_inherited=false,updated_at=clock_timestamp() WHERE id=p_employee_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_set_employee_section_permissions(uuid,text,text[],text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_employee_section_permissions(uuid,text,text[],text[]) TO authenticated;

-- ─── Uprawnienia funkcji ──────────────────────────────────────────────────────────────────────────────────────────────────

REVOKE ALL ON FUNCTION private.purchase_actor(), private.purchase_can_approve(uuid), private.purchase_month_name(integer),
  private.purchase_money(numeric, text), private.purchase_month_status(uuid, uuid, date), private.purchase_require_open(uuid, uuid, date),
  private.purchase_require_event_open(uuid), private.purchase_lock_month(uuid, uuid, date), private.purchase_doc_json(uuid), private.purchase_settlement_json(public.purchase_settlements),
  private.purchase_document_deleted(), private.purchase_approvers(uuid, uuid),
  private.purchase_notify(uuid[], text, text, text, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.purchase_can_record(uuid), public.purchases_access(), public.purchase_month(integer, integer, uuid),
  public.purchase_event_options(uuid, text), public.purchase_event_costs(uuid), public.purchase_document_file(uuid),
  public.purchase_categories(), public.purchase_save(uuid, jsonb), public.purchase_delete(uuid),
  public.purchase_submit(uuid, integer, integer, text), public.purchase_decide(uuid, boolean, text), public.purchase_review()
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.purchase_can_record(uuid), public.purchases_access(), public.purchase_month(integer, integer, uuid),
  public.purchase_event_options(uuid, text), public.purchase_event_costs(uuid), public.purchase_document_file(uuid),
  public.purchase_categories(), public.purchase_save(uuid, jsonb), public.purchase_delete(uuid),
  public.purchase_submit(uuid, integer, integer, text), public.purchase_decide(uuid, boolean, text), public.purchase_review()
  TO authenticated, service_role;

COMMIT;
