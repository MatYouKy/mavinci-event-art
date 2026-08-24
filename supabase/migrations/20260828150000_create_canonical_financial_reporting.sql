/*
  # Kanoniczny raport finansowy

  Jedno źródło prawdy dla finansów:
  - rozdziela wynik memoriałowy od faktycznych przepływów,
  - nie dubluje faktur lokalnych zsynchronizowanych z KSeF,
  - rozlicza zaliczki fakturą końcową,
  - uwzględnia KSeF, koszty wydarzeń, dokumenty spoza KSeF,
    transakcje gotówkowe i ręczne wypłaty (w tym wynagrodzenia),
  - pozwala klasyfikować koszty i analizować pozycje dokumentów.
*/

CREATE TABLE IF NOT EXISTS public.finance_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  kind text NOT NULL DEFAULT 'expense' CHECK (kind IN ('expense', 'income', 'both')),
  color text NOT NULL DEFAULT '#d3bb73',
  sort_order integer NOT NULL DEFAULT 100,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.finance_categories (code, name, kind, color, sort_order) VALUES
  ('personnel', 'Wynagrodzenia i wypłaty', 'expense', '#a78bfa', 10),
  ('subcontractors', 'Podwykonawcy', 'expense', '#f59e0b', 20),
  ('equipment_purchase', 'Zakup sprzętu', 'expense', '#60a5fa', 30),
  ('equipment_rental', 'Wynajem sprzętu', 'expense', '#38bdf8', 40),
  ('transport', 'Transport i logistyka', 'expense', '#22d3ee', 50),
  ('fuel', 'Paliwo', 'expense', '#fb7185', 60),
  ('accommodation', 'Noclegi', 'expense', '#f472b6', 70),
  ('catering', 'Wyżywienie', 'expense', '#84cc16', 80),
  ('marketing', 'Marketing i reklama', 'expense', '#e879f9', 90),
  ('software', 'Oprogramowanie i subskrypcje', 'expense', '#818cf8', 100),
  ('office', 'Biuro i administracja', 'expense', '#94a3b8', 110),
  ('taxes', 'Podatki i składki', 'expense', '#f97316', 120),
  ('insurance', 'Ubezpieczenia', 'expense', '#2dd4bf', 130),
  ('service', 'Serwis i naprawy', 'expense', '#facc15', 140),
  ('sales', 'Sprzedaż usług', 'income', '#34d399', 10),
  ('internal_transfer', 'Transfer wewnętrzny', 'both', '#64748b', 900),
  ('other', 'Pozostałe / niesklasyfikowane', 'both', '#9ca3af', 999)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  kind = EXCLUDED.kind,
  color = EXCLUDED.color,
  sort_order = EXCLUDED.sort_order;

CREATE TABLE IF NOT EXISTS public.financial_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  my_company_id uuid REFERENCES public.my_companies(id) ON DELETE SET NULL,
  event_id uuid REFERENCES public.events(id) ON DELETE SET NULL,
  employee_id uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  category_id uuid REFERENCES public.finance_categories(id) ON DELETE SET NULL,
  direction text NOT NULL DEFAULT 'expense' CHECK (direction IN ('income', 'expense')),
  entry_type text NOT NULL DEFAULT 'other'
    CHECK (entry_type IN ('payroll', 'contractor', 'purchase', 'reimbursement', 'cash', 'other')),
  title text NOT NULL,
  amount_net numeric(14,2),
  amount_gross numeric(14,2) NOT NULL CHECK (amount_gross > 0),
  currency text NOT NULL DEFAULT 'PLN',
  recognition_date date NOT NULL DEFAULT CURRENT_DATE,
  payment_date date,
  status text NOT NULL DEFAULT 'paid' CHECK (status IN ('planned', 'incurred', 'paid', 'cancelled')),
  payment_method text NOT NULL DEFAULT 'transfer'
    CHECK (payment_method IN ('transfer', 'cash', 'card', 'blik', 'compensation', 'other')),
  document_number text,
  document_url text,
  notes text,
  created_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_financial_entries_company_date
  ON public.financial_entries(my_company_id, recognition_date DESC);
CREATE INDEX IF NOT EXISTS idx_financial_entries_payment_date
  ON public.financial_entries(payment_date DESC) WHERE status = 'paid';
CREATE INDEX IF NOT EXISTS idx_financial_entries_employee
  ON public.financial_entries(employee_id) WHERE employee_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.financial_source_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type text NOT NULL CHECK (source_type IN (
    'ksef_invoice', 'external_invoice', 'event_cost', 'bank_transaction', 'local_invoice'
  )),
  source_id uuid NOT NULL,
  category_id uuid NOT NULL REFERENCES public.finance_categories(id) ON DELETE CASCADE,
  assigned_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(source_type, source_id)
);

CREATE INDEX IF NOT EXISTS idx_financial_source_categories_source
  ON public.financial_source_categories(source_type, source_id);

-- Pola rozliczenia faktury końcowej były dotąd używane przez aplikację,
-- ale nie wszystkie środowiska miały je zapisane w migracjach.
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS settled_invoices jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS settlement_summary jsonb;

ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_invoice_type_check;
ALTER TABLE public.invoices
  ADD CONSTRAINT invoices_invoice_type_check
  CHECK (invoice_type IN ('vat', 'proforma', 'advance', 'final', 'corrective'));

-- Zapewnia zgodny schemat dokumentów kosztowych spoza KSeF również na nowych instalacjach.
CREATE TABLE IF NOT EXISTS public.external_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_name text NOT NULL,
  seller_nip text,
  invoice_number text NOT NULL,
  label text,
  invoice_date date NOT NULL,
  payment_method text,
  amount_net numeric(14,2),
  amount_gross numeric(14,2),
  currency text NOT NULL DEFAULT 'PLN',
  file_url text,
  notes text,
  subscription_id uuid,
  period_year integer,
  period_month integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.external_invoices
  ADD COLUMN IF NOT EXISTS my_company_id uuid REFERENCES public.my_companies(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS event_id uuid REFERENCES public.events(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS category_id uuid REFERENCES public.finance_categories(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS payment_status text NOT NULL DEFAULT 'paid',
  ADD COLUMN IF NOT EXISTS payment_date date;

UPDATE public.external_invoices
SET payment_date = invoice_date
WHERE payment_status = 'paid' AND payment_date IS NULL;

DO $$ BEGIN
  ALTER TABLE public.external_invoices
    ADD CONSTRAINT external_invoices_payment_status_check
    CHECK (payment_status IN ('unpaid', 'partially_paid', 'paid', 'cancelled'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE public.event_costs
  ADD COLUMN IF NOT EXISTS my_company_id uuid REFERENCES public.my_companies(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS ksef_invoice_id uuid REFERENCES public.ksef_invoices(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS external_invoice_id uuid REFERENCES public.external_invoices(id) ON DELETE SET NULL;

UPDATE public.event_costs ec
SET my_company_id = e.my_company_id
FROM public.events e
WHERE e.id = ec.event_id AND ec.my_company_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_event_costs_ksef_unique
  ON public.event_costs(ksef_invoice_id) WHERE ksef_invoice_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_event_costs_external_unique
  ON public.event_costs(external_invoice_id) WHERE external_invoice_id IS NOT NULL;

ALTER TABLE public.event_cash_transactions
  ADD COLUMN IF NOT EXISTS my_company_id uuid REFERENCES public.my_companies(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS invoice_id uuid REFERENCES public.invoices(id) ON DELETE SET NULL;

UPDATE public.event_cash_transactions ect
SET my_company_id = e.my_company_id
FROM public.events e
WHERE e.id = ect.event_id AND ect.my_company_id IS NULL;

CREATE OR REPLACE FUNCTION public.fill_financial_company_from_event()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.my_company_id IS NULL AND NEW.event_id IS NOT NULL THEN
    SELECT e.my_company_id INTO NEW.my_company_id FROM public.events e WHERE e.id = NEW.event_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_event_costs_fill_company ON public.event_costs;
CREATE TRIGGER trg_event_costs_fill_company
  BEFORE INSERT OR UPDATE OF event_id, my_company_id ON public.event_costs
  FOR EACH ROW EXECUTE FUNCTION public.fill_financial_company_from_event();

DROP TRIGGER IF EXISTS trg_event_cash_fill_company ON public.event_cash_transactions;
CREATE TRIGGER trg_event_cash_fill_company
  BEFORE INSERT OR UPDATE OF event_id, my_company_id ON public.event_cash_transactions
  FOR EACH ROW EXECUTE FUNCTION public.fill_financial_company_from_event();

DROP TRIGGER IF EXISTS trg_financial_entries_fill_company ON public.financial_entries;
CREATE TRIGGER trg_financial_entries_fill_company
  BEFORE INSERT OR UPDATE OF event_id, my_company_id ON public.financial_entries
  FOR EACH ROW EXECUTE FUNCTION public.fill_financial_company_from_event();

CREATE OR REPLACE FUNCTION public.finance_can_view()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.employees e
    WHERE (e.id = auth.uid() OR e.auth_user_id = auth.uid())
      AND (
        e.role::text = 'admin'
        OR e.access_level::text = 'admin'
        OR 'admin' = ANY(COALESCE(e.permissions, '{}'::text[]))
        OR 'finances_manage' = ANY(COALESCE(e.permissions, '{}'::text[]))
        OR 'invoices_manage' = ANY(COALESCE(e.permissions, '{}'::text[]))
        OR 'invoices_view' = ANY(COALESCE(e.permissions, '{}'::text[]))
        OR 'ksef_manage' = ANY(COALESCE(e.permissions, '{}'::text[]))
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.finance_can_manage()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.employees e
    WHERE (e.id = auth.uid() OR e.auth_user_id = auth.uid())
      AND (
        e.role::text = 'admin'
        OR e.access_level::text = 'admin'
        OR 'admin' = ANY(COALESCE(e.permissions, '{}'::text[]))
        OR 'finances_manage' = ANY(COALESCE(e.permissions, '{}'::text[]))
        OR 'invoices_manage' = ANY(COALESCE(e.permissions, '{}'::text[]))
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.finance_company_visible(p_company_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.employees e
    WHERE (e.id = auth.uid() OR e.auth_user_id = auth.uid())
      AND public.finance_can_view()
      AND (
        e.role::text = 'admin'
        OR e.access_level::text = 'admin'
        OR 'admin' = ANY(COALESCE(e.permissions, '{}'::text[]))
        OR cardinality(COALESCE(e.my_company_ids, '{}'::uuid[])) = 0
        OR p_company_id = ANY(COALESCE(e.my_company_ids, '{}'::uuid[]))
      )
  );
$$;

ALTER TABLE public.finance_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_source_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.external_invoices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS finance_categories_read ON public.finance_categories;
CREATE POLICY finance_categories_read ON public.finance_categories
  FOR SELECT TO authenticated USING (public.finance_can_view());
DROP POLICY IF EXISTS finance_categories_manage ON public.finance_categories;
CREATE POLICY finance_categories_manage ON public.finance_categories
  FOR ALL TO authenticated USING (public.finance_can_manage()) WITH CHECK (public.finance_can_manage());

DROP POLICY IF EXISTS financial_entries_read ON public.financial_entries;
CREATE POLICY financial_entries_read ON public.financial_entries
  FOR SELECT TO authenticated USING (
    public.finance_can_view() AND public.finance_company_visible(my_company_id)
  );
DROP POLICY IF EXISTS financial_entries_manage ON public.financial_entries;
CREATE POLICY financial_entries_manage ON public.financial_entries
  FOR ALL TO authenticated USING (
    public.finance_can_manage() AND public.finance_company_visible(my_company_id)
  ) WITH CHECK (
    public.finance_can_manage() AND public.finance_company_visible(my_company_id)
  );

DROP POLICY IF EXISTS financial_source_categories_read ON public.financial_source_categories;
CREATE POLICY financial_source_categories_read ON public.financial_source_categories
  FOR SELECT TO authenticated USING (public.finance_can_view());
DROP POLICY IF EXISTS financial_source_categories_manage ON public.financial_source_categories;
CREATE POLICY financial_source_categories_manage ON public.financial_source_categories
  FOR ALL TO authenticated USING (public.finance_can_manage()) WITH CHECK (public.finance_can_manage());

DROP POLICY IF EXISTS external_invoices_finance_read ON public.external_invoices;
CREATE POLICY external_invoices_finance_read ON public.external_invoices
  FOR SELECT TO authenticated USING (
    public.finance_can_view() AND public.finance_company_visible(my_company_id)
  );
DROP POLICY IF EXISTS external_invoices_finance_manage ON public.external_invoices;
CREATE POLICY external_invoices_finance_manage ON public.external_invoices
  FOR ALL TO authenticated USING (
    public.finance_can_manage() AND public.finance_company_visible(my_company_id)
  ) WITH CHECK (
    public.finance_can_manage() AND public.finance_company_visible(my_company_id)
  );

CREATE OR REPLACE FUNCTION public.finance_detect_category(
  p_source_type text,
  p_source_id uuid,
  p_text text,
  p_default text DEFAULT 'other'
)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT fc.code
      FROM public.financial_source_categories fsc
      JOIN public.finance_categories fc ON fc.id = fsc.category_id
      WHERE fsc.source_type = p_source_type AND fsc.source_id = p_source_id
      LIMIT 1
    ),
    CASE
      WHEN lower(COALESCE(p_text, '')) ~ '(wynagrodz|pensj|wypłat|umowa zlecen|lista płac)' THEN 'personnel'
      WHEN lower(COALESCE(p_text, '')) ~ '(podwykon|dj |fotograf|kamerzyst|hostess|ochron|technik)' THEN 'subcontractors'
      WHEN lower(COALESCE(p_text, '')) ~ '(zakup.*sprzęt|kolumn|mikrofon|oświetlen|ekran led|projektor|komputer|laptop|tablet)' THEN 'equipment_purchase'
      WHEN lower(COALESCE(p_text, '')) ~ '(wynajem|rental)' THEN 'equipment_rental'
      WHEN lower(COALESCE(p_text, '')) ~ '(paliw|benzyn|diesel|orlen|circle k|bp )' THEN 'fuel'
      WHEN lower(COALESCE(p_text, '')) ~ '(transport|kurier|parking|autostrad|logistyk|taxi)' THEN 'transport'
      WHEN lower(COALESCE(p_text, '')) ~ '(hotel|nocleg|apartament)' THEN 'accommodation'
      WHEN lower(COALESCE(p_text, '')) ~ '(catering|restaurac|jedzenie|wyżywienie)' THEN 'catering'
      WHEN lower(COALESCE(p_text, '')) ~ '(reklam|marketing|facebook|google ads|meta ads)' THEN 'marketing'
      WHEN lower(COALESCE(p_text, '')) ~ '(subskrypc|software|oprogramowan|hosting|domena|licencj|apple.com/bill)' THEN 'software'
      WHEN lower(COALESCE(p_text, '')) ~ '(ubezpiec|polisa| oc | ac )' THEN 'insurance'
      WHEN lower(COALESCE(p_text, '')) ~ '(serwis|napraw|warsztat|części)' THEN 'service'
      WHEN lower(COALESCE(p_text, '')) ~ '(zus|podatek|urząd skarbow|vat|pit|cit)' THEN 'taxes'
      WHEN lower(COALESCE(p_text, '')) ~ '(przelew własny|transfer wewnętrzny|zasilenie rachunku)' THEN 'internal_transfer'
      ELSE p_default
    END
  );
$$;

CREATE OR REPLACE FUNCTION public.get_financial_report(
  p_date_from date,
  p_date_to date,
  p_company_ids uuid[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_employee record;
  v_unrestricted boolean;
  v_allowed_companies uuid[];
  v_result jsonb;
BEGIN
  IF p_date_from IS NULL OR p_date_to IS NULL OR p_date_from > p_date_to THEN
    RAISE EXCEPTION 'Nieprawidłowy zakres dat';
  END IF;

  SELECT e.id, e.role::text AS role, e.access_level::text AS access_level,
         COALESCE(e.permissions, '{}'::text[]) AS permissions,
         COALESCE(e.my_company_ids, '{}'::uuid[]) AS my_company_ids
  INTO v_employee
  FROM public.employees e
  WHERE e.id = auth.uid() OR e.auth_user_id = auth.uid()
  LIMIT 1;

  IF v_employee.id IS NULL OR NOT public.finance_can_view() THEN
    RAISE EXCEPTION 'Brak uprawnień do raportu finansowego';
  END IF;

  v_unrestricted := v_employee.role = 'admin'
    OR v_employee.access_level = 'admin'
    OR 'admin' = ANY(v_employee.permissions)
    OR cardinality(v_employee.my_company_ids) = 0;
  v_allowed_companies := v_employee.my_company_ids;

  WITH
  recognized_local AS (
    SELECT i.*,
      CASE WHEN i.invoice_type = 'final'
        THEN COALESCE(NULLIF(i.settlement_summary->>'remainingGross', '')::numeric, i.total_gross)
        ELSE i.total_gross END AS cash_value
    FROM public.invoices i
    WHERE (
        i.issue_date BETWEEN p_date_from AND p_date_to
        OR COALESCE(i.paid_date, i.issue_date) BETWEEN p_date_from AND p_date_to
      )
      AND i.status NOT IN ('draft', 'cancelled')
      AND COALESCE(i.is_proforma, false) = false
      AND i.invoice_type <> 'proforma'
      AND (p_company_ids IS NULL OR cardinality(p_company_ids) = 0 OR i.my_company_id = ANY(p_company_ids))
      AND (v_unrestricted OR i.my_company_id = ANY(v_allowed_companies))
      AND NOT (
        i.invoice_type = 'advance' AND EXISTS (
          SELECT 1
          FROM public.invoices f
          CROSS JOIN LATERAL jsonb_array_elements(
            CASE WHEN jsonb_typeof(f.settled_invoices) = 'array' THEN f.settled_invoices ELSE '[]'::jsonb END
          ) settled
          WHERE f.invoice_type = 'final'
            AND f.status NOT IN ('draft', 'cancelled')
            AND settled->>'id' = i.id::text
        )
      )
  ),
  local_invoice_rows AS (
    SELECT i.my_company_id AS company_id, i.event_id, i.issue_date AS entry_date,
      NULL::date AS movement_date, 'revenue_accrual'::text AS metric,
      i.total_gross::numeric AS amount, 'sales'::text AS category_code,
      COALESCE(i.invoice_number, 'Faktura sprzedaży') AS item_label,
      'local_invoice'::text AS source_type, i.id AS source_id
    FROM recognized_local i
    WHERE i.issue_date BETWEEN p_date_from AND p_date_to
  ),
  local_cash_fallback AS (
    SELECT i.my_company_id AS company_id, i.event_id,
      COALESCE(i.paid_date, i.issue_date) AS entry_date,
      COALESCE(i.paid_date, i.issue_date) AS movement_date,
      'revenue_cash_fallback'::text AS metric, GREATEST(i.cash_value, 0)::numeric AS amount,
      'sales'::text AS category_code, COALESCE(i.invoice_number, 'Wpłata') AS item_label,
      'local_invoice'::text AS source_type, i.id AS source_id
    FROM recognized_local i
    WHERE i.status = 'paid'
      AND COALESCE(i.paid_date, i.issue_date) BETWEEN p_date_from AND p_date_to
  ),
  ksef_base AS (
    SELECT k.*
    FROM public.ksef_invoices k
    WHERE (
        COALESCE(k.issue_date, k.ksef_issued_at::date) BETWEEN p_date_from AND p_date_to
        OR COALESCE(k.payment_date, k.issue_date, k.ksef_issued_at::date) BETWEEN p_date_from AND p_date_to
        OR EXISTS (
          SELECT 1 FROM public.ksef_invoice_payments kp
          WHERE kp.ksef_invoice_id = k.id
            AND kp.payment_date BETWEEN p_date_from AND p_date_to
        )
      )
      AND (p_company_ids IS NULL OR cardinality(p_company_ids) = 0 OR k.my_company_id = ANY(p_company_ids))
      AND (v_unrestricted OR k.my_company_id = ANY(v_allowed_companies))
      AND k.invoice_id IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.invoices i
        WHERE i.my_company_id IS NOT DISTINCT FROM k.my_company_id
          AND NULLIF(i.invoice_number, '') = NULLIF(k.invoice_number, '')
      )
  ),
  ksef_rows AS (
    SELECT k.my_company_id AS company_id, ec.event_id,
      COALESCE(k.issue_date, k.ksef_issued_at::date) AS entry_date, NULL::date AS movement_date,
      CASE WHEN k.invoice_type = 'issued' THEN 'revenue_accrual' ELSE 'cost_accrual' END AS metric,
      COALESCE(k.gross_amount, 0)::numeric AS amount,
      CASE WHEN k.invoice_type = 'issued' THEN 'sales'
        ELSE public.finance_detect_category('ksef_invoice', k.id, concat_ws(' ', k.seller_name, k.invoice_items::text), 'other') END AS category_code,
      CASE WHEN k.invoice_type = 'issued' THEN COALESCE(k.invoice_number, 'Sprzedaż KSeF')
        ELSE COALESCE(k.invoice_items->0->>'name', k.seller_name, 'Koszt KSeF') END AS item_label,
      'ksef_invoice'::text AS source_type, k.id AS source_id
    FROM ksef_base k
    LEFT JOIN public.event_costs ec ON ec.ksef_invoice_id = k.id
    WHERE COALESCE(k.issue_date, k.ksef_issued_at::date) BETWEEN p_date_from AND p_date_to
  ),
  ksef_payment_rows AS (
    SELECT k.my_company_id AS company_id, ec.event_id, kp.payment_date AS entry_date,
      kp.payment_date AS movement_date,
      CASE WHEN k.invoice_type = 'issued' THEN 'revenue_cash_fallback' ELSE 'cost_cash_fallback' END AS metric,
      kp.amount::numeric AS amount,
      CASE WHEN k.invoice_type = 'issued' THEN 'sales'
        ELSE public.finance_detect_category('ksef_invoice', k.id, concat_ws(' ', k.seller_name, k.invoice_items::text), 'other') END AS category_code,
      COALESCE(k.invoice_number, 'Płatność KSeF') AS item_label,
      'ksef_invoice'::text AS source_type, k.id AS source_id
    FROM ksef_base k
    JOIN public.ksef_invoice_payments kp ON kp.ksef_invoice_id = k.id
    LEFT JOIN public.event_costs ec ON ec.ksef_invoice_id = k.id
    WHERE kp.payment_date BETWEEN p_date_from AND p_date_to
    UNION ALL
    SELECT k.my_company_id, ec.event_id, COALESCE(k.payment_date, k.issue_date, k.ksef_issued_at::date),
      COALESCE(k.payment_date, k.issue_date, k.ksef_issued_at::date),
      CASE WHEN k.invoice_type = 'issued' THEN 'revenue_cash_fallback' ELSE 'cost_cash_fallback' END,
      COALESCE(k.gross_amount, 0)::numeric,
      CASE WHEN k.invoice_type = 'issued' THEN 'sales'
        ELSE public.finance_detect_category('ksef_invoice', k.id, concat_ws(' ', k.seller_name, k.invoice_items::text), 'other') END,
      COALESCE(k.invoice_number, 'Płatność KSeF'), 'ksef_invoice', k.id
    FROM ksef_base k
    LEFT JOIN public.event_costs ec ON ec.ksef_invoice_id = k.id
    WHERE k.payment_status = 'paid'
      AND COALESCE(k.payment_date, k.issue_date, k.ksef_issued_at::date) BETWEEN p_date_from AND p_date_to
      AND NOT EXISTS (SELECT 1 FROM public.ksef_invoice_payments kp WHERE kp.ksef_invoice_id = k.id)
  ),
  external_rows AS (
    SELECT x.my_company_id AS company_id, x.event_id, x.invoice_date AS entry_date,
      NULL::date AS movement_date, 'cost_accrual'::text AS metric,
      COALESCE(x.amount_gross, x.amount_net, 0)::numeric AS amount,
      COALESCE(fc.code, public.finance_detect_category('external_invoice', x.id, concat_ws(' ', x.label, x.seller_name, x.notes), 'other')) AS category_code,
      COALESCE(x.label, x.seller_name, 'Koszt spoza KSeF') AS item_label,
      'external_invoice'::text AS source_type, x.id AS source_id
    FROM public.external_invoices x
    LEFT JOIN public.finance_categories fc ON fc.id = x.category_id
    WHERE x.invoice_date BETWEEN p_date_from AND p_date_to
      AND x.payment_status <> 'cancelled'
      AND (p_company_ids IS NULL OR cardinality(p_company_ids) = 0 OR x.my_company_id = ANY(p_company_ids))
      AND (v_unrestricted OR x.my_company_id = ANY(v_allowed_companies))
  ),
  external_cash AS (
    SELECT x.my_company_id, x.event_id, COALESCE(x.payment_date, x.invoice_date),
      COALESCE(x.payment_date, x.invoice_date), 'cost_cash_fallback',
      COALESCE(x.amount_gross, x.amount_net, 0)::numeric,
      COALESCE(fc.code, public.finance_detect_category('external_invoice', x.id, concat_ws(' ', x.label, x.seller_name, x.notes), 'other')),
      COALESCE(x.label, x.seller_name, 'Płatność spoza KSeF'), 'external_invoice', x.id
    FROM public.external_invoices x
    LEFT JOIN public.finance_categories fc ON fc.id = x.category_id
    WHERE x.payment_status = 'paid'
      AND COALESCE(x.payment_date, x.invoice_date) BETWEEN p_date_from AND p_date_to
      AND (p_company_ids IS NULL OR cardinality(p_company_ids) = 0 OR x.my_company_id = ANY(p_company_ids))
      AND (v_unrestricted OR x.my_company_id = ANY(v_allowed_companies))
  ),
  event_cost_rows AS (
    SELECT ec.my_company_id, ec.event_id, ec.cost_date, NULL::date, 'cost_accrual', ec.amount::numeric,
      COALESCE(fc.code, public.finance_detect_category('event_cost', ec.id, concat_ws(' ', ecc.name, ec.name, ec.description, ec.notes), 'other')),
      ec.name, 'event_cost', ec.id
    FROM public.event_costs ec
    LEFT JOIN public.event_cost_categories ecc ON ecc.id = ec.category_id
    LEFT JOIN public.finance_categories fc ON lower(fc.name) = lower(ecc.name)
    WHERE ec.status IN ('approved', 'paid')
      AND ec.cost_date BETWEEN p_date_from AND p_date_to
      AND ec.ksef_invoice_id IS NULL AND ec.external_invoice_id IS NULL
      AND (p_company_ids IS NULL OR cardinality(p_company_ids) = 0 OR ec.my_company_id = ANY(p_company_ids))
      AND (v_unrestricted OR ec.my_company_id = ANY(v_allowed_companies))
  ),
  event_cost_cash AS (
    SELECT ec.my_company_id, ec.event_id, COALESCE(ec.payment_date, ec.cost_date),
      COALESCE(ec.payment_date, ec.cost_date), 'cost_cash_fallback', ec.amount::numeric,
      public.finance_detect_category('event_cost', ec.id, concat_ws(' ', ecc.name, ec.name, ec.description, ec.notes), 'other'),
      ec.name, 'event_cost', ec.id
    FROM public.event_costs ec
    LEFT JOIN public.event_cost_categories ecc ON ecc.id = ec.category_id
    WHERE ec.status = 'paid'
      AND COALESCE(ec.payment_date, ec.cost_date) BETWEEN p_date_from AND p_date_to
      AND ec.ksef_invoice_id IS NULL AND ec.external_invoice_id IS NULL
      AND (p_company_ids IS NULL OR cardinality(p_company_ids) = 0 OR ec.my_company_id = ANY(p_company_ids))
      AND (v_unrestricted OR ec.my_company_id = ANY(v_allowed_companies))
  ),
  manual_rows AS (
    SELECT fe.my_company_id, fe.event_id, fe.recognition_date, NULL::date,
      CASE WHEN fe.direction = 'income' THEN 'revenue_accrual' ELSE 'cost_accrual' END,
      fe.amount_gross::numeric, COALESCE(fc.code, 'other'), fe.title, 'financial_entry', fe.id
    FROM public.financial_entries fe
    LEFT JOIN public.finance_categories fc ON fc.id = fe.category_id
    WHERE fe.status IN ('incurred', 'paid')
      AND fe.recognition_date BETWEEN p_date_from AND p_date_to
      AND (p_company_ids IS NULL OR cardinality(p_company_ids) = 0 OR fe.my_company_id = ANY(p_company_ids))
      AND (v_unrestricted OR fe.my_company_id = ANY(v_allowed_companies))
  ),
  manual_cash AS (
    SELECT fe.my_company_id, fe.event_id, COALESCE(fe.payment_date, fe.recognition_date),
      COALESCE(fe.payment_date, fe.recognition_date),
      CASE WHEN fe.direction = 'income' THEN 'manual_cash_income' ELSE 'manual_cash_expense' END,
      fe.amount_gross::numeric, COALESCE(fc.code, 'other'), fe.title, 'financial_entry', fe.id
    FROM public.financial_entries fe
    LEFT JOIN public.finance_categories fc ON fc.id = fe.category_id
    WHERE fe.status = 'paid'
      AND COALESCE(fe.payment_date, fe.recognition_date) BETWEEN p_date_from AND p_date_to
      AND fe.payment_method = 'cash'
      AND (p_company_ids IS NULL OR cardinality(p_company_ids) = 0 OR fe.my_company_id = ANY(p_company_ids))
      AND (v_unrestricted OR fe.my_company_id = ANY(v_allowed_companies))
  ),
  event_cash_rows AS (
    SELECT ect.my_company_id, ect.event_id, ect.transaction_date, ect.transaction_date,
      CASE WHEN ect.transaction_type = 'income' THEN 'manual_cash_income' ELSE 'manual_cash_expense' END,
      ect.amount::numeric,
      public.finance_detect_category('event_cost', ect.id, concat_ws(' ', ect.category, ect.description, ect.notes),
        CASE WHEN ect.transaction_type = 'income' THEN 'sales' ELSE 'other' END),
      ect.description, 'event_cash', ect.id
    FROM public.event_cash_transactions ect
    WHERE ect.confirmed = true AND ect.invoice_id IS NULL
      AND ect.transaction_date BETWEEN p_date_from AND p_date_to
      AND (p_company_ids IS NULL OR cardinality(p_company_ids) = 0 OR ect.my_company_id = ANY(p_company_ids))
      AND (v_unrestricted OR ect.my_company_id = ANY(v_allowed_companies))
  ),
  bank_rows AS (
    SELECT bs.my_company_id AS company_id,
      NULL::uuid AS event_id,
      bt.transaction_date AS entry_date,
      bt.transaction_date AS movement_date,
      CASE WHEN bt.transaction_type = 'credit' THEN 'bank_cash_income' ELSE 'bank_cash_expense' END AS metric,
      ABS(bt.amount)::numeric AS amount,
      public.finance_detect_category('bank_transaction', bt.id, concat_ws(' ', bt.counterparty_name, bt.title),
        CASE WHEN bt.transaction_type = 'credit' THEN 'sales' ELSE 'other' END) AS category_code,
      COALESCE(bt.title, bt.counterparty_name, 'Transakcja bankowa') AS item_label,
      'bank_transaction'::text AS source_type,
      bt.id AS source_id
    FROM public.bank_transactions bt
    JOIN public.bank_statements bs ON bs.id = bt.statement_id
    WHERE bt.transaction_date BETWEEN p_date_from AND p_date_to
      AND bs.processed = true
      AND (p_company_ids IS NULL OR cardinality(p_company_ids) = 0 OR bs.my_company_id = ANY(p_company_ids))
      AND (v_unrestricted OR bs.my_company_id = ANY(v_allowed_companies))
  ),
  fallback_rows AS (
    SELECT * FROM local_cash_fallback
    UNION ALL SELECT * FROM ksef_payment_rows
    UNION ALL SELECT * FROM external_cash
    UNION ALL SELECT * FROM event_cost_cash
  ),
  filtered_fallback AS (
    SELECT f.*
    FROM fallback_rows f
    WHERE NOT EXISTS (
      SELECT 1 FROM public.bank_statements bs
      WHERE bs.processed = true
        AND bs.my_company_id IS NOT DISTINCT FROM f.company_id
        AND bs.statement_year = EXTRACT(YEAR FROM f.movement_date)::integer
        AND bs.statement_month = EXTRACT(MONTH FROM f.movement_date)::integer
    )
  ),
  ledger AS (
    SELECT * FROM local_invoice_rows
    UNION ALL SELECT * FROM ksef_rows
    UNION ALL SELECT * FROM external_rows
    UNION ALL SELECT * FROM event_cost_rows
    UNION ALL SELECT * FROM manual_rows
    UNION ALL SELECT * FROM filtered_fallback
    UNION ALL SELECT br.* FROM bank_rows br WHERE br.category_code <> 'internal_transfer'
    UNION ALL SELECT * FROM manual_cash
    UNION ALL SELECT * FROM event_cash_rows
  ),
  month_series AS (
    SELECT generate_series(date_trunc('month', p_date_from::timestamp), date_trunc('month', p_date_to::timestamp), interval '1 month')::date AS month
  ),
  monthly AS (
    SELECT ms.month,
      COALESCE(SUM(l.amount) FILTER (WHERE l.metric = 'revenue_accrual'), 0) AS invoiced_revenue,
      COALESCE(SUM(l.amount) FILTER (WHERE l.metric = 'cost_accrual'), 0) AS incurred_costs,
      COALESCE(SUM(l.amount) FILTER (WHERE l.metric IN ('bank_cash_income','revenue_cash_fallback','manual_cash_income')), 0) AS cash_revenue,
      COALESCE(SUM(l.amount) FILTER (WHERE l.metric IN ('bank_cash_expense','cost_cash_fallback','manual_cash_expense')), 0) AS cash_costs
    FROM month_series ms
    LEFT JOIN ledger l ON date_trunc('month', COALESCE(l.movement_date, l.entry_date)::timestamp)::date = ms.month
    GROUP BY ms.month ORDER BY ms.month
  ),
  companies AS (
    SELECT l.company_id, COALESCE(mc.name, 'Nieprzypisana działalność') AS company_name,
      COALESCE(SUM(l.amount) FILTER (WHERE l.metric = 'revenue_accrual'), 0) AS invoiced_revenue,
      COALESCE(SUM(l.amount) FILTER (WHERE l.metric = 'cost_accrual'), 0) AS incurred_costs,
      COALESCE(SUM(l.amount) FILTER (WHERE l.metric IN ('bank_cash_income','revenue_cash_fallback','manual_cash_income')), 0) AS cash_revenue,
      COALESCE(SUM(l.amount) FILTER (WHERE l.metric IN ('bank_cash_expense','cost_cash_fallback','manual_cash_expense')), 0) AS cash_costs
    FROM ledger l LEFT JOIN public.my_companies mc ON mc.id = l.company_id
    GROUP BY l.company_id, mc.name
  ),
  profitability_areas AS (
    SELECT COALESCE(ec.name, 'Bez kategorii wydarzenia') AS area_name,
      COALESCE(ec.color, '#9ca3af') AS color,
      COALESCE(SUM(l.amount) FILTER (WHERE l.metric = 'revenue_accrual'), 0) AS revenue,
      COALESCE(SUM(l.amount) FILTER (WHERE l.metric = 'cost_accrual'), 0) AS costs,
      COALESCE(SUM(l.amount) FILTER (WHERE l.metric = 'revenue_accrual'), 0)
        - COALESCE(SUM(l.amount) FILTER (WHERE l.metric = 'cost_accrual'), 0) AS profit
    FROM ledger l
    JOIN public.events e ON e.id = l.event_id
    LEFT JOIN public.event_categories ec ON ec.id = e.category_id
    WHERE l.metric IN ('revenue_accrual', 'cost_accrual')
    GROUP BY ec.name, ec.color
    ORDER BY profit DESC
  ),
  cost_categories AS (
    SELECT l.category_code, COALESCE(fc.name, 'Pozostałe / niesklasyfikowane') AS category_name,
      COALESCE(fc.color, '#9ca3af') AS color, SUM(l.amount) AS amount
    FROM ledger l LEFT JOIN public.finance_categories fc ON fc.code = l.category_code
    WHERE l.metric = 'cost_accrual'
    GROUP BY l.category_code, fc.name, fc.color
    ORDER BY amount DESC
  ),
  recognized_local_items AS (
    SELECT ii.name AS item_name, SUM(ii.value_gross)::numeric AS amount
    FROM recognized_local i JOIN public.invoice_items ii ON ii.invoice_id = i.id
    WHERE i.issue_date BETWEEN p_date_from AND p_date_to
    GROUP BY ii.name
  ),
  ksef_revenue_items AS (
    SELECT COALESCE(item->>'name', 'Usługa') AS item_name,
      SUM(COALESCE(NULLIF(item->>'value_gross','')::numeric, NULLIF(item->>'value_net','')::numeric, 0))::numeric AS amount
    FROM ksef_base k CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(k.invoice_items) = 'array' THEN k.invoice_items ELSE '[]'::jsonb END
    ) item
    WHERE k.invoice_type = 'issued'
      AND COALESCE(k.issue_date, k.ksef_issued_at::date) BETWEEN p_date_from AND p_date_to
    GROUP BY COALESCE(item->>'name', 'Usługa')
  ),
  revenue_items AS (
    SELECT item_name, SUM(amount) AS amount FROM (
      SELECT * FROM recognized_local_items UNION ALL SELECT * FROM ksef_revenue_items
    ) x GROUP BY item_name ORDER BY amount DESC LIMIT 30
  ),
  ksef_expense_items AS (
    SELECT COALESCE(item->>'name', 'Pozycja kosztowa') AS item_name,
      SUM(COALESCE(NULLIF(item->>'value_gross','')::numeric, NULLIF(item->>'value_net','')::numeric, 0))::numeric AS amount
    FROM ksef_base k CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(k.invoice_items) = 'array' THEN k.invoice_items ELSE '[]'::jsonb END
    ) item
    WHERE k.invoice_type = 'received'
      AND COALESCE(k.issue_date, k.ksef_issued_at::date) BETWEEN p_date_from AND p_date_to
    GROUP BY COALESCE(item->>'name', 'Pozycja kosztowa')
  ),
  other_expense_items AS (
    SELECT item_label AS item_name, SUM(amount) AS amount
    FROM ledger WHERE metric = 'cost_accrual' AND source_type <> 'ksef_invoice'
    GROUP BY item_label
  ),
  expense_items AS (
    SELECT item_name, SUM(amount) AS amount FROM (
      SELECT * FROM ksef_expense_items UNION ALL SELECT * FROM other_expense_items
    ) x GROUP BY item_name ORDER BY amount DESC LIMIT 50
  ),
  outstanding_local AS (
    SELECT COALESCE(SUM(CASE WHEN i.status = 'paid' THEN 0 ELSE GREATEST(i.cash_value, 0) END), 0) AS amount,
      COALESCE(SUM(CASE WHEN i.status <> 'paid' AND i.payment_due_date < CURRENT_DATE THEN GREATEST(i.cash_value, 0) ELSE 0 END), 0) AS overdue
    FROM recognized_local i
  ),
  outstanding_ksef AS (
    SELECT COALESCE(SUM(GREATEST(COALESCE(k.gross_amount,0) - COALESCE(p.paid,0),0)),0) AS amount,
      COALESCE(SUM(CASE WHEN k.payment_due_date < CURRENT_DATE THEN GREATEST(COALESCE(k.gross_amount,0)-COALESCE(p.paid,0),0) ELSE 0 END),0) AS overdue
    FROM ksef_base k
    LEFT JOIN (SELECT ksef_invoice_id, SUM(amount) paid FROM public.ksef_invoice_payments GROUP BY ksef_invoice_id) p ON p.ksef_invoice_id=k.id
    WHERE k.invoice_type='issued' AND k.payment_status <> 'paid'
  ),
  totals AS (
    SELECT
      COALESCE(SUM(amount) FILTER (WHERE metric='revenue_accrual'),0) invoiced_revenue,
      COALESCE(SUM(amount) FILTER (WHERE metric='cost_accrual'),0) incurred_costs,
      COALESCE(SUM(amount) FILTER (WHERE metric IN ('bank_cash_income','revenue_cash_fallback','manual_cash_income')),0) cash_revenue,
      COALESCE(SUM(amount) FILTER (WHERE metric IN ('bank_cash_expense','cost_cash_fallback','manual_cash_expense')),0) cash_costs
    FROM ledger
  )
  SELECT jsonb_build_object(
    'date_from', p_date_from,
    'date_to', p_date_to,
    'totals', jsonb_build_object(
      'invoiced_revenue', t.invoiced_revenue,
      'cash_revenue', t.cash_revenue,
      'incurred_costs', t.incurred_costs,
      'cash_costs', t.cash_costs,
      'operating_result', t.invoiced_revenue - t.incurred_costs,
      'cash_result', t.cash_revenue - t.cash_costs,
      'outstanding_receivables', ol.amount + ok.amount,
      'overdue_receivables', ol.overdue + ok.overdue
    ),
    'months', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'key', to_char(month,'YYYY-MM'), 'label', to_char(month,'TMMon'),
      'invoiced_revenue', invoiced_revenue, 'incurred_costs', incurred_costs,
      'cash_revenue', cash_revenue, 'cash_costs', cash_costs,
      'operating_result', invoiced_revenue-incurred_costs, 'cash_result', cash_revenue-cash_costs
    ) ORDER BY month) FROM monthly), '[]'::jsonb),
    'companies', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'company_id', company_id, 'company_name', company_name,
      'invoiced_revenue', invoiced_revenue, 'incurred_costs', incurred_costs,
      'cash_revenue', cash_revenue, 'cash_costs', cash_costs,
      'operating_result', invoiced_revenue-incurred_costs, 'cash_result', cash_revenue-cash_costs
    ) ORDER BY company_name) FROM companies), '[]'::jsonb),
    'profitability_areas', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'name', area_name, 'color', color, 'revenue', revenue, 'costs', costs,
      'profit', profit,
      'margin_percent', CASE WHEN revenue > 0 THEN ROUND((profit / revenue) * 100, 1) ELSE 0 END
    )) FROM profitability_areas), '[]'::jsonb),
    'cost_categories', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'code', cc.category_code, 'name', cc.category_name, 'color', cc.color, 'amount', cc.amount
    )) FROM cost_categories cc), '[]'::jsonb),
    'revenue_items', COALESCE((SELECT jsonb_agg(jsonb_build_object('name',item_name,'amount',amount)) FROM revenue_items), '[]'::jsonb),
    'expense_items', COALESCE((SELECT jsonb_agg(jsonb_build_object('name',item_name,'amount',amount)) FROM expense_items), '[]'::jsonb),
    'quality', jsonb_build_object(
      'unassigned_company', (SELECT COUNT(*) FROM ledger WHERE company_id IS NULL AND metric IN ('revenue_accrual','cost_accrual')),
      'unclassified_costs', (SELECT COUNT(*) FROM ledger lq WHERE lq.metric='cost_accrual' AND lq.category_code='other'),
      'unmatched_bank_transactions', (SELECT COUNT(*) FROM bank_rows brq WHERE brq.source_id IN (
        SELECT bt.id FROM public.bank_transactions bt WHERE bt.matched_invoice_id IS NULL
      ) AND brq.category_code <> 'internal_transfer'),
      'bank_months', (SELECT COUNT(DISTINCT (bs.statement_year,bs.statement_month,bs.my_company_id)) FROM public.bank_statements bs
        WHERE bs.processed=true AND make_date(bs.statement_year,bs.statement_month,1) BETWEEN date_trunc('month',p_date_from)::date AND date_trunc('month',p_date_to)::date),
      'deduplicated_ksef_links', (SELECT COUNT(*) FROM public.ksef_invoices k WHERE k.invoice_id IS NOT NULL AND COALESCE(k.issue_date,k.ksef_issued_at::date) BETWEEN p_date_from AND p_date_to)
    )
  ) INTO v_result
  FROM totals t CROSS JOIN outstanding_local ol CROSS JOIN outstanding_ksef ok;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_financial_report(date,date,uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_financial_report(date,date,uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finance_can_view() TO authenticated;
GRANT EXECUTE ON FUNCTION public.finance_can_manage() TO authenticated;
GRANT EXECUTE ON FUNCTION public.finance_company_visible(uuid) TO authenticated;

COMMENT ON FUNCTION public.get_financial_report(date,date,uuid[]) IS
  'Kanoniczny raport finansowy: memoriał, cash flow, firmy, kategorie i pozycje do analizy AI.';
