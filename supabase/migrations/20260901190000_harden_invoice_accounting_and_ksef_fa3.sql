BEGIN;

-- Księgowy snapshot dokumentu. Pola te nie mogą się zmienić po przyjęciu przez KSeF.
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS currency_code text NOT NULL DEFAULT 'PLN',
  ADD COLUMN IF NOT EXISTS correction_type smallint,
  ADD COLUMN IF NOT EXISTS order_total_net numeric(14,2),
  ADD COLUMN IF NOT EXISTS order_total_vat numeric(14,2),
  ADD COLUMN IF NOT EXISTS order_total_gross numeric(14,2),
  ADD COLUMN IF NOT EXISTS payment_status text NOT NULL DEFAULT 'unpaid',
  ADD COLUMN IF NOT EXISTS paid_amount numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS paid_at timestamptz,
  ADD COLUMN IF NOT EXISTS buyer_is_private_person boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS buyer_contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS bank_name text,
  ADD COLUMN IF NOT EXISTS bank_swift_code text,
  ADD COLUMN IF NOT EXISTS seller_email text,
  ADD COLUMN IF NOT EXISTS seller_phone text,
  ADD COLUMN IF NOT EXISTS footer_note text,
  ADD COLUMN IF NOT EXISTS signature_name text,
  ADD COLUMN IF NOT EXISTS website text;

-- ADD COLUMN IF NOT EXISTS nie zmienia typu już istniejącej kolumny.
-- Konwersja jest wykonywana wyłącznie wtedy, gdy każda wartość jest jednoznaczna.
DO $$
DECLARE
  v_invalid text;
BEGIN
  SELECT string_agg(DISTINCT correction_type::text, ', ')
  INTO v_invalid
  FROM public.invoices
  WHERE NULLIF(BTRIM(correction_type::text), '') IS NOT NULL
    AND BTRIM(correction_type::text) !~ '^[123]$';

  IF v_invalid IS NOT NULL THEN
    RAISE EXCEPTION 'Nieprawidłowe historyczne wartości correction_type: %', v_invalid;
  END IF;
END;
$$;

ALTER TABLE public.invoices
  ALTER COLUMN correction_type TYPE smallint
  USING NULLIF(BTRIM(correction_type::text), '')::smallint;

ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_payment_status_check;
ALTER TABLE public.invoices
  ADD CONSTRAINT invoices_payment_status_check
  CHECK (payment_status IN (
    'unpaid', 'partially_paid', 'paid', 'overdue',
    'refund_due', 'partially_refunded', 'refunded'
  ));

ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_paid_amount_check;
ALTER TABLE public.invoices
  ADD CONSTRAINT invoices_paid_amount_check CHECK (paid_amount >= 0);

ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_status_check;
ALTER TABLE public.invoices
  ADD CONSTRAINT invoices_status_check
  CHECK (status IN ('draft', 'proforma', 'issued', 'sent', 'paid', 'overdue', 'cancelled'));

ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_proforma_status_check;
ALTER TABLE public.invoices
  ADD CONSTRAINT invoices_proforma_status_check
  CHECK (
    (is_proforma = true AND status IN ('draft', 'proforma', 'cancelled'))
    OR
    (is_proforma = false AND status IN ('draft', 'issued', 'sent', 'paid', 'overdue', 'cancelled'))
  );

-- Status operacyjny wydarzenia nie jest dowodem zapłaty. Stare dwukierunkowe
-- triggery mogły oznaczyć wszystkie dokumenty jako opłacone po zmianie eventu
-- albo zamknąć event po zapłacie jednej faktury.
DROP TRIGGER IF EXISTS trg_event_settled_sync_invoices ON public.events;
DROP TRIGGER IF EXISTS trg_invoice_paid_sync_event ON public.invoices;

CREATE OR REPLACE FUNCTION public.normalize_invoice_payment_state()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_due numeric(14,2);
  v_is_refund boolean;
BEGIN
  v_due := CASE
    WHEN NEW.invoice_type = 'final' AND NEW.settlement_summary IS NOT NULL
      THEN GREATEST(COALESCE((NEW.settlement_summary->>'remainingGross')::numeric, 0), 0)
    WHEN NEW.invoice_type = 'corrective'
      THEN ABS(COALESCE(NEW.total_gross, 0))
    ELSE GREATEST(COALESCE(NEW.total_gross, 0), 0)
  END;
  v_is_refund := NEW.invoice_type = 'corrective' AND COALESCE(NEW.total_gross, 0) < 0;

  IF NEW.status IN ('draft', 'cancelled', 'proforma') THEN
    NEW.payment_status := 'unpaid';
    NEW.paid_amount := 0;
    NEW.paid_at := NULL;
    NEW.paid_date := NULL;
  ELSIF v_is_refund AND (NEW.status = 'paid' OR COALESCE(NEW.paid_amount, 0) >= v_due - 0.01) THEN
    NEW.payment_status := 'refunded';
    NEW.paid_amount := v_due;
    NEW.paid_at := COALESCE(NEW.paid_at, NEW.paid_date::timestamptz, now());
    NEW.paid_date := COALESCE(NEW.paid_date, NEW.paid_at::date, CURRENT_DATE);
    NEW.status := 'paid';
  ELSIF v_is_refund AND COALESCE(NEW.paid_amount, 0) > 0 THEN
    NEW.payment_status := 'partially_refunded';
    NEW.paid_at := COALESCE(NEW.paid_at, NEW.paid_date::timestamptz, now());
    NEW.paid_date := COALESCE(NEW.paid_date, NEW.paid_at::date, CURRENT_DATE);
    NEW.status := 'issued';
  ELSIF v_is_refund THEN
    NEW.payment_status := 'refund_due';
    NEW.paid_amount := 0;
    NEW.paid_at := NULL;
    NEW.paid_date := NULL;
    IF NEW.status = 'overdue' THEN NEW.status := 'issued'; END IF;
  ELSIF NEW.status = 'paid' OR (v_due > 0 AND COALESCE(NEW.paid_amount, 0) >= v_due - 0.01) THEN
    NEW.payment_status := 'paid';
    NEW.paid_amount := v_due;
    NEW.paid_at := COALESCE(NEW.paid_at, NEW.paid_date::timestamptz, now());
    NEW.paid_date := COALESCE(NEW.paid_date, NEW.paid_at::date, CURRENT_DATE);
    IF NEW.status NOT IN ('cancelled', 'proforma') THEN NEW.status := 'paid'; END IF;
  ELSIF COALESCE(NEW.paid_amount, 0) > 0 THEN
    NEW.payment_status := 'partially_paid';
    NEW.paid_at := COALESCE(NEW.paid_at, NEW.paid_date::timestamptz, now());
    NEW.paid_date := COALESCE(NEW.paid_date, NEW.paid_at::date, CURRENT_DATE);
    IF NEW.status = 'paid' THEN NEW.status := 'issued'; END IF;
  ELSIF NEW.payment_due_date < CURRENT_DATE AND NEW.status NOT IN ('draft', 'cancelled', 'proforma') THEN
    NEW.payment_status := 'overdue';
    NEW.status := 'overdue';
    NEW.paid_at := NULL;
    NEW.paid_date := NULL;
  ELSE
    NEW.payment_status := 'unpaid';
    NEW.paid_amount := 0;
    NEW.paid_at := NULL;
    NEW.paid_date := NULL;
    IF NEW.status = 'paid' THEN NEW.status := 'issued'; END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_normalize_invoice_payment_state ON public.invoices;
CREATE TRIGGER trg_normalize_invoice_payment_state
BEFORE INSERT OR UPDATE OF status, payment_status, paid_amount, paid_at, paid_date, total_gross,
  settlement_summary, payment_due_date
ON public.invoices
FOR EACH ROW EXECUTE FUNCTION public.normalize_invoice_payment_state();

-- Numery są unikalne w obrębie działalności, a nie globalnie dla wszystkich spółek.
ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_invoice_number_key;
CREATE UNIQUE INDEX IF NOT EXISTS uq_invoices_company_number
  ON public.invoices ((COALESCE(my_company_id, '00000000-0000-0000-0000-000000000000'::uuid)), invoice_number);

ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_currency_code_check;
ALTER TABLE public.invoices
  ADD CONSTRAINT invoices_currency_code_check
  CHECK (currency_code ~ '^[A-Z]{3}$');

ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_correction_type_check;
ALTER TABLE public.invoices
  ADD CONSTRAINT invoices_correction_type_check
  CHECK (correction_type IS NULL OR correction_type IN (1, 2, 3));

DO $$
DECLARE
  v_invalid text;
BEGIN
  SELECT string_agg(DISTINCT COALESCE(vat_rate::text, '<NULL>'), ', ')
  INTO v_invalid
  FROM public.invoice_items
  WHERE vat_rate IS NULL
    OR BTRIM(vat_rate::text) = ''
    OR replace(replace(BTRIM(vat_rate::text), '%', ''), ',', '.')
      !~ '^[+-]?[0-9]+([.][0-9]+)?$';

  IF v_invalid IS NOT NULL THEN
    RAISE EXCEPTION 'Nie można jednoznacznie przeliczyć historycznych stawek VAT: %', v_invalid;
  END IF;
END;
$$;

-- Trigger ma vat_rate w klauzuli UPDATE OF, więc PostgreSQL wymaga jego
-- chwilowego zdjęcia na czas samej zmiany typu kolumny.
DROP TRIGGER IF EXISTS trigger_calculate_invoice_item_values ON public.invoice_items;

ALTER TABLE public.invoice_items ALTER COLUMN vat_rate DROP DEFAULT;
ALTER TABLE public.invoice_items
  ALTER COLUMN vat_rate TYPE numeric(6,3)
  USING replace(replace(BTRIM(vat_rate::text), '%', ''), ',', '.')::numeric;
ALTER TABLE public.invoice_items ALTER COLUMN vat_rate SET DEFAULT 23;

CREATE TRIGGER trigger_calculate_invoice_item_values
BEFORE INSERT OR UPDATE OF quantity, price_net, vat_rate,
  before_quantity, before_price_net, after_quantity, after_price_net
ON public.invoice_items
FOR EACH ROW
EXECUTE FUNCTION public.calculate_invoice_item_values();

ALTER TABLE public.invoice_items
  ADD COLUMN IF NOT EXISTS vat_code text,
  ADD COLUMN IF NOT EXISTS vat_exemption_reason text;

UPDATE public.invoice_items
SET vat_code = CASE vat_rate
  WHEN 23 THEN '23'
  WHEN 8 THEN '8'
  WHEN 5 THEN '5'
  WHEN 0 THEN '0'
  ELSE vat_rate::text
END
WHERE vat_code IS NULL;

ALTER TABLE public.invoice_items ALTER COLUMN vat_code SET DEFAULT '23';
ALTER TABLE public.invoice_items ALTER COLUMN vat_code SET NOT NULL;
ALTER TABLE public.invoice_items DROP CONSTRAINT IF EXISTS invoice_items_vat_code_check;
ALTER TABLE public.invoice_items
  ADD CONSTRAINT invoice_items_vat_code_check
  CHECK (vat_code IN ('23', '8', '5', '0', '0 KR', '0 WDT', '0 EX', 'zw', 'np I', 'np II', 'oo'));

ALTER TABLE public.invoice_items DROP CONSTRAINT IF EXISTS invoice_items_vat_exemption_reason_check;
ALTER TABLE public.invoice_items
  ADD CONSTRAINT invoice_items_vat_exemption_reason_check
  CHECK (vat_code <> 'zw' OR NULLIF(BTRIM(vat_exemption_reason), '') IS NOT NULL);

-- Lokalny rejestr wysłanych dokumentów przechowuje dokładny XML potrzebny
-- m.in. do późniejszego wyliczenia kodu weryfikującego QR.
ALTER TABLE public.ksef_invoices
  ADD COLUMN IF NOT EXISTS invoice_number text,
  ADD COLUMN IF NOT EXISTS seller_name text,
  ADD COLUMN IF NOT EXISTS buyer_name text,
  ADD COLUMN IF NOT EXISTS net_amount numeric(14,2),
  ADD COLUMN IF NOT EXISTS vat_amount numeric(14,2),
  ADD COLUMN IF NOT EXISTS gross_amount numeric(14,2),
  ADD COLUMN IF NOT EXISTS amount_to_pay_gross numeric(14,2),
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'PLN',
  ADD COLUMN IF NOT EXISTS issue_date date,
  ADD COLUMN IF NOT EXISTS settled_invoices jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS settlement_summary jsonb,
  ADD COLUMN IF NOT EXISTS my_company_id uuid REFERENCES public.my_companies(id) ON DELETE SET NULL;

-- Pełna wartość zamówienia jest innym pojęciem niż kwota zaliczki z P_15.
CREATE TABLE IF NOT EXISTS public.invoice_order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  position_number integer NOT NULL CHECK (position_number > 0),
  name text NOT NULL,
  unit text NOT NULL DEFAULT 'szt.',
  quantity numeric(14,4) NOT NULL CHECK (quantity > 0),
  price_net numeric(14,4) NOT NULL CHECK (price_net >= 0),
  vat_rate numeric(6,3) NOT NULL DEFAULT 23,
  vat_code text NOT NULL DEFAULT '23' CHECK (vat_code IN ('23', '8', '5', '0', '0 KR', '0 WDT', '0 EX', 'zw', 'np I', 'np II', 'oo')),
  vat_exemption_reason text,
  value_net numeric(14,2) NOT NULL,
  vat_amount numeric(14,2) NOT NULL,
  value_gross numeric(14,2) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(invoice_id, position_number),
  CHECK (vat_code <> 'zw' OR NULLIF(BTRIM(vat_exemption_reason), '') IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_invoice_order_items_invoice_id
  ON public.invoice_order_items(invoice_id);

INSERT INTO public.invoice_order_items (
  invoice_id, position_number, name, unit, quantity, price_net,
  vat_rate, vat_code, vat_exemption_reason, value_net, vat_amount, value_gross
)
SELECT
  ii.invoice_id, ii.position_number, ii.name, ii.unit, ii.quantity, ii.price_net,
  ii.vat_rate, ii.vat_code, ii.vat_exemption_reason, ii.value_net, ii.vat_amount, ii.value_gross
FROM public.invoice_items ii
JOIN public.invoices i ON i.id = ii.invoice_id
WHERE i.invoice_type = 'advance'
ON CONFLICT (invoice_id, position_number) DO NOTHING;

UPDATE public.invoices i
SET order_total_net = COALESCE(order_total_net, i.total_net),
    order_total_vat = COALESCE(order_total_vat, i.total_vat),
    order_total_gross = COALESCE(order_total_gross, i.total_gross)
WHERE i.invoice_type = 'advance';

-- Jedna zaliczka może zostać rozliczona tylko raz. Snapshot kwot chroni raporty
-- przed późniejszą zmianą danych źródłowych.
CREATE TABLE IF NOT EXISTS public.invoice_settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  final_invoice_id uuid NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  advance_invoice_id uuid NOT NULL REFERENCES public.invoices(id) ON DELETE RESTRICT,
  settled_net numeric(14,2) NOT NULL,
  settled_vat numeric(14,2) NOT NULL,
  settled_gross numeric(14,2) NOT NULL,
  vat_breakdown jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(advance_invoice_id),
  UNIQUE(final_invoice_id, advance_invoice_id),
  CHECK (final_invoice_id <> advance_invoice_id),
  CHECK (settled_gross >= 0)
);

CREATE INDEX IF NOT EXISTS idx_invoice_settlements_final
  ON public.invoice_settlements(final_invoice_id);

CREATE TABLE IF NOT EXISTS public.invoice_source_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_invoice_id uuid NOT NULL REFERENCES public.invoices(id) ON DELETE RESTRICT,
  target_invoice_id uuid NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  link_type text NOT NULL CHECK (link_type IN ('proforma_to_vat', 'proforma_to_advance')),
  created_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(target_invoice_id),
  UNIQUE(source_invoice_id, target_invoice_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_one_vat_invoice_per_proforma
  ON public.invoice_source_links(source_invoice_id)
  WHERE link_type = 'proforma_to_vat';

CREATE INDEX IF NOT EXISTS idx_invoice_source_links_source
  ON public.invoice_source_links(source_invoice_id);

INSERT INTO public.invoice_settlements (
  final_invoice_id, advance_invoice_id, settled_net, settled_vat, settled_gross
)
SELECT
  f.id,
  (entry->>'id')::uuid,
  COALESCE(NULLIF(entry->>'totalNet', '')::numeric, NULLIF(entry->>'total_net', '')::numeric, 0),
  COALESCE(NULLIF(entry->>'totalVat', '')::numeric, NULLIF(entry->>'total_vat', '')::numeric, 0),
  COALESCE(NULLIF(entry->>'totalGross', '')::numeric, NULLIF(entry->>'total_gross', '')::numeric, 0)
FROM public.invoices f
CROSS JOIN LATERAL jsonb_array_elements(
  CASE WHEN jsonb_typeof(f.settled_invoices) = 'array' THEN f.settled_invoices ELSE '[]'::jsonb END
) entry
WHERE f.invoice_type = 'final'
  AND COALESCE(entry->>'id', '') ~* '^[0-9a-f-]{36}$'
  AND EXISTS (
    SELECT 1 FROM public.invoices a
    WHERE a.id = (entry->>'id')::uuid AND a.invoice_type = 'advance'
  )
ON CONFLICT (advance_invoice_id) DO NOTHING;

ALTER TABLE public.invoice_order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_source_links ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.can_manage_invoices()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.employees e
    WHERE (e.id = auth.uid() OR e.auth_user_id = auth.uid() OR lower(e.email) = lower(COALESCE(auth.jwt()->>'email', '')))
      AND (
        'admin' = ANY(COALESCE(e.permissions, ARRAY[]::text[]))
        OR 'invoices_manage' = ANY(COALESCE(e.permissions, ARRAY[]::text[]))
        OR 'finances_manage' = ANY(COALESCE(e.permissions, ARRAY[]::text[]))
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.can_manage_invoice_company(p_company_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.employees e
    WHERE (e.id = auth.uid() OR e.auth_user_id = auth.uid() OR lower(e.email) = lower(COALESCE(auth.jwt()->>'email', '')))
      AND (
        'admin' = ANY(COALESCE(e.permissions, ARRAY[]::text[]))
        OR 'invoices_manage' = ANY(COALESCE(e.permissions, ARRAY[]::text[]))
        OR 'finances_manage' = ANY(COALESCE(e.permissions, ARRAY[]::text[]))
      )
      AND (
        'admin' = ANY(COALESCE(e.permissions, ARRAY[]::text[]))
        OR cardinality(COALESCE(e.my_company_ids, ARRAY[]::uuid[])) = 0
        OR p_company_id = ANY(COALESCE(e.my_company_ids, ARRAY[]::uuid[]))
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.can_manage_invoice(p_invoice_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.invoices i
    WHERE i.id = p_invoice_id
      AND public.can_manage_invoice_company(i.my_company_id)
  );
$$;

CREATE OR REPLACE FUNCTION public.can_view_invoice_company(p_company_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.employees e
    WHERE (e.id = auth.uid() OR e.auth_user_id = auth.uid() OR lower(e.email) = lower(COALESCE(auth.jwt()->>'email', '')))
      AND (
        'admin' = ANY(COALESCE(e.permissions, ARRAY[]::text[]))
        OR 'invoices_view' = ANY(COALESCE(e.permissions, ARRAY[]::text[]))
        OR 'invoices_manage' = ANY(COALESCE(e.permissions, ARRAY[]::text[]))
        OR 'finances_manage' = ANY(COALESCE(e.permissions, ARRAY[]::text[]))
      )
      AND (
        'admin' = ANY(COALESCE(e.permissions, ARRAY[]::text[]))
        OR cardinality(COALESCE(e.my_company_ids, ARRAY[]::uuid[])) = 0
        OR p_company_id = ANY(COALESCE(e.my_company_ids, ARRAY[]::uuid[]))
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.can_view_invoices()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.employees e
    WHERE (e.id = auth.uid() OR e.auth_user_id = auth.uid() OR lower(e.email) = lower(COALESCE(auth.jwt()->>'email', '')))
      AND (
        'admin' = ANY(COALESCE(e.permissions, ARRAY[]::text[]))
        OR 'invoices_view' = ANY(COALESCE(e.permissions, ARRAY[]::text[]))
        OR 'invoices_manage' = ANY(COALESCE(e.permissions, ARRAY[]::text[]))
        OR 'finances_manage' = ANY(COALESCE(e.permissions, ARRAY[]::text[]))
      )
  );
$$;

REVOKE ALL ON FUNCTION public.can_manage_invoices() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_manage_invoices() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.can_manage_invoice_company(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_manage_invoice_company(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.can_manage_invoice(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_manage_invoice(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.can_view_invoice_company(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_view_invoice_company(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.can_view_invoices() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_view_invoices() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.current_invoice_employee_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT e.id
  FROM public.employees e
  WHERE e.id = auth.uid()
     OR e.auth_user_id = auth.uid()
     OR lower(e.email) = lower(COALESCE(auth.jwt()->>'email', ''))
  ORDER BY
    CASE WHEN e.auth_user_id = auth.uid() THEN 0 WHEN e.id = auth.uid() THEN 1 ELSE 2 END,
    e.created_at
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.current_invoice_employee_id() FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.touch_invoice_child_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_invoice_order_items ON public.invoice_order_items;
CREATE TRIGGER trg_touch_invoice_order_items
BEFORE UPDATE ON public.invoice_order_items
FOR EACH ROW EXECUTE FUNCTION public.touch_invoice_child_updated_at();

DROP POLICY IF EXISTS "View invoice order items" ON public.invoice_order_items;
CREATE POLICY "View invoice order items"
  ON public.invoice_order_items FOR SELECT TO authenticated
  USING (public.can_view_invoices());

DROP POLICY IF EXISTS "View invoice settlements" ON public.invoice_settlements;
CREATE POLICY "View invoice settlements"
  ON public.invoice_settlements FOR SELECT TO authenticated
  USING (public.can_view_invoices());

DROP POLICY IF EXISTS "View invoice source links" ON public.invoice_source_links;
CREATE POLICY "View invoice source links"
  ON public.invoice_source_links FOR SELECT TO authenticated
  USING (public.can_view_invoices());

DROP POLICY IF EXISTS "Manage invoice order items" ON public.invoice_order_items;
CREATE POLICY "Manage invoice order items"
  ON public.invoice_order_items FOR ALL TO authenticated
  USING (public.can_manage_invoice(invoice_id))
  WITH CHECK (public.can_manage_invoice(invoice_id));

DROP POLICY IF EXISTS "Manage invoice settlements" ON public.invoice_settlements;
CREATE POLICY "Manage invoice settlements"
  ON public.invoice_settlements FOR ALL TO authenticated
  USING (public.can_manage_invoice(final_invoice_id))
  WITH CHECK (
    public.can_manage_invoice(final_invoice_id)
    AND public.can_manage_invoice(advance_invoice_id)
  );

DROP POLICY IF EXISTS "Manage invoice source links" ON public.invoice_source_links;
CREATE POLICY "Manage invoice source links"
  ON public.invoice_source_links FOR ALL TO authenticated
  USING (public.can_manage_invoice(target_invoice_id))
  WITH CHECK (
    public.can_manage_invoice(source_invoice_id)
    AND public.can_manage_invoice(target_invoice_id)
  );

-- Treść faktury przyjętej przez KSeF jest niezmienna. Dozwolone pozostają
-- status płatności, PDF, historia oraz metadane synchronizacji.
CREATE OR REPLACE FUNCTION public.protect_ksef_accepted_invoice()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF COALESCE(OLD.ksef_status, '') IN ('pending', 'accepted')
     OR NULLIF(OLD.ksef_reference_number, '') IS NOT NULL THEN
    IF ROW(
      NEW.invoice_number, NEW.invoice_type, NEW.issue_date, NEW.sale_date,
      NEW.event_id, NEW.organization_id, NEW.my_company_id,
      NEW.seller_name, NEW.seller_nip, NEW.seller_street, NEW.seller_postal_code,
      NEW.seller_city, NEW.seller_country, NEW.buyer_name, NEW.buyer_nip,
      NEW.buyer_street, NEW.buyer_postal_code, NEW.buyer_city, NEW.buyer_country,
      NEW.total_net, NEW.total_vat, NEW.total_gross, NEW.currency_code,
      NEW.correction_reason, NEW.correction_type, NEW.corrected_invoice_number,
      NEW.corrected_invoice_issue_date, NEW.corrected_invoice_ksef_number,
      NEW.settled_invoices, NEW.settlement_summary, NEW.order_total_net,
      NEW.order_total_vat, NEW.order_total_gross
    ) IS DISTINCT FROM ROW(
      OLD.invoice_number, OLD.invoice_type, OLD.issue_date, OLD.sale_date,
      OLD.event_id, OLD.organization_id, OLD.my_company_id,
      OLD.seller_name, OLD.seller_nip, OLD.seller_street, OLD.seller_postal_code,
      OLD.seller_city, OLD.seller_country, OLD.buyer_name, OLD.buyer_nip,
      OLD.buyer_street, OLD.buyer_postal_code, OLD.buyer_city, OLD.buyer_country,
      OLD.total_net, OLD.total_vat, OLD.total_gross, OLD.currency_code,
      OLD.correction_reason, OLD.correction_type, OLD.corrected_invoice_number,
      OLD.corrected_invoice_issue_date, OLD.corrected_invoice_ksef_number,
      OLD.settled_invoices, OLD.settlement_summary, OLD.order_total_net,
      OLD.order_total_vat, OLD.order_total_gross
    ) THEN
      RAISE EXCEPTION 'Faktura przyjęta przez KSeF jest niezmienna. Wystaw fakturę korygującą.'
        USING ERRCODE = '55000';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_ksef_accepted_invoice ON public.invoices;
CREATE TRIGGER trg_protect_ksef_accepted_invoice
BEFORE UPDATE ON public.invoices
FOR EACH ROW EXECUTE FUNCTION public.protect_ksef_accepted_invoice();

CREATE OR REPLACE FUNCTION public.protect_ksef_invoice_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF COALESCE(OLD.ksef_status, '') IN ('pending', 'accepted')
     OR NULLIF(OLD.ksef_reference_number, '') IS NOT NULL THEN
    RAISE EXCEPTION 'Faktury wysłanej do KSeF nie można usunąć. Wystaw dokument korygujący.'
      USING ERRCODE = '55000';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_ksef_invoice_delete ON public.invoices;
CREATE TRIGGER trg_protect_ksef_invoice_delete
BEFORE DELETE ON public.invoices
FOR EACH ROW EXECUTE FUNCTION public.protect_ksef_invoice_delete();

CREATE OR REPLACE FUNCTION public.protect_ksef_accepted_invoice_items()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_invoice_id uuid := COALESCE(NEW.invoice_id, OLD.invoice_id);
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.invoices i
    WHERE i.id = v_invoice_id
      AND (
        i.ksef_status IN ('pending', 'accepted')
        OR NULLIF(i.ksef_reference_number, '') IS NOT NULL
      )
  ) THEN
    RAISE EXCEPTION 'Pozycji faktury przyjętej przez KSeF nie można zmieniać. Wystaw fakturę korygującą.'
      USING ERRCODE = '55000';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_ksef_accepted_invoice_items ON public.invoice_items;
CREATE TRIGGER trg_protect_ksef_accepted_invoice_items
BEFORE INSERT OR UPDATE OR DELETE ON public.invoice_items
FOR EACH ROW EXECUTE FUNCTION public.protect_ksef_accepted_invoice_items();

DROP TRIGGER IF EXISTS trg_protect_ksef_accepted_order_items ON public.invoice_order_items;
CREATE TRIGGER trg_protect_ksef_accepted_order_items
BEFORE INSERT OR UPDATE OR DELETE ON public.invoice_order_items
FOR EACH ROW EXECUTE FUNCTION public.protect_ksef_accepted_invoice_items();

-- Podgląd numeru pozostaje niewiążący. Właściwy numer jest rezerwowany dopiero
-- w tej samej transakcji, która zapisuje dokument. Blokada transakcyjna usuwa
-- wyścig pomiędzy równoległymi zapisami dla firmy, typu dokumentu i roku.
CREATE OR REPLACE FUNCTION public.reserve_invoice_number_atomic(
  p_invoice_type text,
  p_my_company_id uuid
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_lock_key text;
BEGIN
  IF p_invoice_type NOT IN ('vat', 'proforma', 'advance', 'corrective', 'final') THEN
    RAISE EXCEPTION 'Nieobsługiwany typ numeracji: %', p_invoice_type;
  END IF;

  v_lock_key := COALESCE(p_my_company_id::text, 'global')
    || '|' || p_invoice_type
    || '|' || EXTRACT(YEAR FROM CURRENT_DATE)::integer::text;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_lock_key, 0));

  RETURN public.generate_invoice_number(p_invoice_type, p_my_company_id);
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_invoice_number_atomic(text, uuid) FROM PUBLIC;

-- Zwykła, zaliczkowa, proforma i korekta powstają razem z pozycjami albo wcale.
CREATE OR REPLACE FUNCTION public.create_invoice_atomic(
  p_invoice jsonb,
  p_items jsonb,
  p_order_items jsonb DEFAULT '[]'::jsonb,
  p_actor uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_invoice_id uuid;
  v_invoice_type text := p_invoice->>'invoice_type';
  v_status text := COALESCE(p_invoice->>'status', 'draft');
  v_invoice_number text;
  v_actor uuid;
  v_source_invoice public.invoices%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NOT public.can_manage_invoice_company((p_invoice->>'my_company_id')::uuid) THEN
    RAISE EXCEPTION 'Brak uprawnień do wystawiania faktur' USING ERRCODE = '42501';
  END IF;

  IF v_invoice_type NOT IN ('vat', 'proforma', 'advance', 'corrective') THEN
    RAISE EXCEPTION 'Nieobsługiwany typ dokumentu: %', v_invoice_type;
  END IF;

  IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Dokument musi zawierać co najmniej jedną pozycję';
  END IF;

  IF v_invoice_type = 'advance'
     AND (jsonb_typeof(p_order_items) <> 'array' OR jsonb_array_length(p_order_items) = 0) THEN
    RAISE EXCEPTION 'Faktura zaliczkowa musi zawierać pełny snapshot zamówienia';
  END IF;

  IF v_invoice_type = 'corrective' AND (
    NULLIF(p_invoice->>'related_invoice_id', '') IS NULL
    OR NULLIF(BTRIM(p_invoice->>'correction_reason'), '') IS NULL
    OR COALESCE((p_invoice->>'correction_type')::integer, 0) NOT IN (1, 2, 3)
  ) THEN
    RAISE EXCEPTION 'Korekta wymaga dokumentu źródłowego, przyczyny i typu korekty';
  END IF;

  v_actor := public.current_invoice_employee_id();
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Nie znaleziono profilu pracownika dla zalogowanego użytkownika'
      USING ERRCODE = '42501';
  END IF;

  IF v_invoice_type = 'corrective' THEN
    SELECT * INTO v_source_invoice
    FROM public.invoices
    WHERE id = NULLIF(p_invoice->>'related_invoice_id', '')::uuid
    FOR UPDATE;

    IF NOT FOUND
       OR v_source_invoice.invoice_type = 'proforma'
       OR v_source_invoice.status IN ('draft', 'cancelled', 'proforma') THEN
      RAISE EXCEPTION 'Korygowany dokument nie istnieje albo nie został wystawiony';
    END IF;
    IF v_source_invoice.my_company_id IS DISTINCT FROM NULLIF(p_invoice->>'my_company_id', '')::uuid THEN
      RAISE EXCEPTION 'Korekta musi być wystawiona przez tę samą spółkę co dokument źródłowy';
    END IF;
  END IF;

  v_invoice_number := CASE
    WHEN COALESCE((p_invoice->>'auto_number')::boolean, false)
      THEN public.reserve_invoice_number_atomic(v_invoice_type, NULLIF(p_invoice->>'my_company_id', '')::uuid)
    ELSE NULLIF(BTRIM(p_invoice->>'invoice_number'), '')
  END;
  IF v_invoice_number IS NULL THEN
    RAISE EXCEPTION 'Numer dokumentu jest wymagany';
  END IF;

  INSERT INTO public.invoices (
    invoice_number, invoice_type, status, is_proforma,
    issue_date, sale_date, payment_due_date, paid_at, payment_status, paid_amount,
    event_id, organization_id, billing_arrangement,
    service_recipient_organization_id, service_recipient_contact_id,
    buyer_is_private_person, buyer_contact_id, my_company_id, created_by,
    buyer_name, buyer_nip, buyer_street, buyer_postal_code, buyer_city,
    buyer_country, buyer_email, buyer_phone, buyer_contact_person,
    seller_name, seller_nip, seller_street, seller_postal_code, seller_city,
    seller_country, seller_email, seller_phone,
    payment_method, bank_name, bank_account, bank_swift_code, issue_place,
    company_logo_url, footer_note, signature_name, website, notes, internal_notes, currency_code,
    order_total_net, order_total_vat, order_total_gross,
    related_invoice_id, correction_reason, correction_type, correction_scope,
    corrected_invoice_number, corrected_invoice_issue_date,
    corrected_invoice_ksef_number, corrected_invoice_was_in_ksef
  ) VALUES (
    v_invoice_number, v_invoice_type, v_status,
    v_invoice_type = 'proforma',
    (p_invoice->>'issue_date')::date, (p_invoice->>'sale_date')::date,
    (p_invoice->>'payment_due_date')::date,
    NULLIF(p_invoice->>'paid_at', '')::timestamptz,
    COALESCE(p_invoice->>'payment_status', 'unpaid'),
    COALESCE((p_invoice->>'paid_amount')::numeric, 0),
    NULLIF(p_invoice->>'event_id', '')::uuid,
    NULLIF(p_invoice->>'organization_id', '')::uuid,
    COALESCE(p_invoice->>'billing_arrangement', 'direct'),
    NULLIF(p_invoice->>'service_recipient_organization_id', '')::uuid,
    NULLIF(p_invoice->>'service_recipient_contact_id', '')::uuid,
    COALESCE((p_invoice->>'buyer_is_private_person')::boolean, false),
    NULLIF(p_invoice->>'buyer_contact_id', '')::uuid,
    NULLIF(p_invoice->>'my_company_id', '')::uuid,
    v_actor,
    p_invoice->>'buyer_name', NULLIF(p_invoice->>'buyer_nip', ''),
    p_invoice->>'buyer_street', p_invoice->>'buyer_postal_code', p_invoice->>'buyer_city',
    COALESCE(p_invoice->>'buyer_country', 'Polska'), p_invoice->>'buyer_email',
    p_invoice->>'buyer_phone', p_invoice->>'buyer_contact_person',
    p_invoice->>'seller_name', p_invoice->>'seller_nip', p_invoice->>'seller_street',
    p_invoice->>'seller_postal_code', p_invoice->>'seller_city',
    COALESCE(p_invoice->>'seller_country', 'Polska'), p_invoice->>'seller_email',
    p_invoice->>'seller_phone', COALESCE(p_invoice->>'payment_method', 'Przelew'),
    p_invoice->>'bank_name', p_invoice->>'bank_account', p_invoice->>'bank_swift_code',
    COALESCE(p_invoice->>'issue_place', ''), p_invoice->>'company_logo_url',
    p_invoice->>'footer_note', p_invoice->>'signature_name', p_invoice->>'website',
    p_invoice->>'notes', p_invoice->>'internal_notes',
    COALESCE(p_invoice->>'currency_code', 'PLN'),
    NULLIF(p_invoice->>'order_total_net', '')::numeric,
    NULLIF(p_invoice->>'order_total_vat', '')::numeric,
    NULLIF(p_invoice->>'order_total_gross', '')::numeric,
    CASE WHEN v_invoice_type = 'corrective'
      THEN v_source_invoice.id
      ELSE NULLIF(p_invoice->>'related_invoice_id', '')::uuid
    END,
    p_invoice->>'correction_reason', NULLIF(p_invoice->>'correction_type', '')::smallint,
    p_invoice->>'correction_scope',
    CASE WHEN v_invoice_type = 'corrective' THEN v_source_invoice.invoice_number END,
    CASE WHEN v_invoice_type = 'corrective' THEN v_source_invoice.issue_date END,
    CASE WHEN v_invoice_type = 'corrective' THEN v_source_invoice.ksef_reference_number END,
    CASE WHEN v_invoice_type = 'corrective' THEN
      v_source_invoice.ksef_status = 'accepted'
      OR NULLIF(v_source_invoice.ksef_reference_number, '') IS NOT NULL
    ELSE false END
  ) RETURNING id INTO v_invoice_id;

  INSERT INTO public.invoice_items (
    invoice_id, position_number, name, unit, quantity, price_net, vat_rate,
    vat_code, vat_exemption_reason, value_net, vat_amount, value_gross,
    before_quantity, before_price_net, after_quantity, after_price_net
  )
  SELECT
    v_invoice_id, x.position_number, x.name, x.unit, x.quantity, x.price_net,
    x.vat_rate, x.vat_code, x.vat_exemption_reason,
    COALESCE(x.value_net, 0), COALESCE(x.vat_amount, 0), COALESCE(x.value_gross, 0),
    x.before_quantity, x.before_price_net, x.after_quantity, x.after_price_net
  FROM jsonb_to_recordset(p_items) AS x(
    position_number integer, name text, unit text, quantity numeric, price_net numeric,
    vat_rate numeric, vat_code text, vat_exemption_reason text,
    value_net numeric, vat_amount numeric, value_gross numeric,
    before_quantity numeric, before_price_net numeric,
    after_quantity numeric, after_price_net numeric
  );

  IF v_invoice_type = 'advance' THEN
    INSERT INTO public.invoice_order_items (
      invoice_id, position_number, name, unit, quantity, price_net, vat_rate,
      vat_code, vat_exemption_reason, value_net, vat_amount, value_gross
    )
    SELECT
      v_invoice_id, x.position_number, x.name, x.unit, x.quantity, x.price_net,
      x.vat_rate, x.vat_code, x.vat_exemption_reason,
      ROUND(x.quantity * x.price_net, 2),
      ROUND(x.quantity * x.price_net * x.vat_rate / 100.0, 2),
      ROUND(x.quantity * x.price_net, 2)
        + ROUND(x.quantity * x.price_net * x.vat_rate / 100.0, 2)
    FROM jsonb_to_recordset(p_order_items) AS x(
      position_number integer, name text, unit text, quantity numeric, price_net numeric,
      vat_rate numeric, vat_code text, vat_exemption_reason text,
      value_net numeric, vat_amount numeric, value_gross numeric
    );

    UPDATE public.invoices i
    SET order_total_net = totals.net,
        order_total_vat = totals.vat,
        order_total_gross = totals.gross,
        updated_at = now()
    FROM (
      SELECT ROUND(SUM(value_net), 2) net,
             ROUND(SUM(vat_amount), 2) vat,
             ROUND(SUM(value_gross), 2) gross
      FROM public.invoice_order_items
      WHERE invoice_id = v_invoice_id
    ) totals
    WHERE i.id = v_invoice_id;
  END IF;

  IF v_status = 'paid' THEN
    UPDATE public.invoices
    SET payment_status = 'paid', paid_amount = total_gross,
        paid_at = COALESCE(paid_at, now())
    WHERE id = v_invoice_id;
  END IF;

  INSERT INTO public.invoice_history (invoice_id, action, changed_by, changes)
  VALUES (
    v_invoice_id, 'created', v_actor,
    jsonb_build_object(
      'invoice_type', v_invoice_type,
      'event_id', p_invoice->'event_id',
      'billing_arrangement', p_invoice->>'billing_arrangement'
    )
  );

  RETURN v_invoice_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_invoice_atomic(jsonb, jsonb, jsonb, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_invoice_atomic(jsonb, jsonb, jsonb, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.convert_proforma_atomic(
  p_proforma_id uuid,
  p_invoice jsonb,
  p_items jsonb,
  p_order_items jsonb DEFAULT '[]'::jsonb,
  p_actor uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_proforma public.invoices%ROWTYPE;
  v_target_id uuid;
  v_target_type text := p_invoice->>'invoice_type';
  v_link_type text;
  v_actor uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.can_manage_invoice(p_proforma_id) THEN
    RAISE EXCEPTION 'Brak uprawnień do konwersji proformy' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_proforma FROM public.invoices WHERE id = p_proforma_id FOR UPDATE;
  IF NOT FOUND OR NOT COALESCE(v_proforma.is_proforma, false) THEN
    RAISE EXCEPTION 'Nie znaleziono proformy';
  END IF;
  IF v_proforma.status = 'cancelled' THEN
    RAISE EXCEPTION 'Anulowanej proformy nie można konwertować';
  END IF;
  IF v_target_type NOT IN ('vat', 'advance') THEN
    RAISE EXCEPTION 'Proformę można przekształcić tylko w fakturę VAT albo zaliczkową';
  END IF;

  v_actor := public.current_invoice_employee_id();
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Nie znaleziono profilu pracownika dla zalogowanego użytkownika'
      USING ERRCODE = '42501';
  END IF;

  v_link_type := CASE WHEN v_target_type = 'vat' THEN 'proforma_to_vat' ELSE 'proforma_to_advance' END;
  IF v_target_type = 'vat' AND EXISTS (
    SELECT 1 FROM public.invoice_source_links
    WHERE source_invoice_id = p_proforma_id AND link_type = 'proforma_to_vat'
  ) THEN
    RAISE EXCEPTION 'Dla tej proformy istnieje już faktura VAT' USING ERRCODE = '23505';
  END IF;

  v_target_id := public.create_invoice_atomic(p_invoice, p_items, p_order_items, v_actor);

  INSERT INTO public.invoice_source_links (
    source_invoice_id, target_invoice_id, link_type, created_by
  ) VALUES (p_proforma_id, v_target_id, v_link_type, v_actor);

  IF v_target_type = 'vat' THEN
    UPDATE public.invoices
    SET proforma_converted_to_invoice_id = v_target_id, updated_at = now()
    WHERE id = p_proforma_id;
  END IF;

  INSERT INTO public.invoice_history (invoice_id, action, changed_by, changes)
  VALUES (
    v_target_id, 'created_from_proforma', v_actor,
    jsonb_build_object(
      'source_proforma_id', p_proforma_id,
      'source_proforma_number', v_proforma.invoice_number,
      'target_type', v_target_type
    )
  );

  RETURN v_target_id;
END;
$$;

REVOKE ALL ON FUNCTION public.convert_proforma_atomic(uuid, jsonb, jsonb, jsonb, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.convert_proforma_atomic(uuid, jsonb, jsonb, jsonb, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.update_invoice_draft_atomic(
  p_invoice_id uuid,
  p_invoice jsonb,
  p_items jsonb,
  p_order_items jsonb DEFAULT '[]'::jsonb,
  p_actor uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_existing public.invoices%ROWTYPE;
  v_invoice_type text := p_invoice->>'invoice_type';
  v_actor uuid;
  v_source_invoice public.invoices%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NOT public.can_manage_invoice(p_invoice_id) THEN
    RAISE EXCEPTION 'Brak uprawnień do edycji faktur' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_existing FROM public.invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Nie znaleziono faktury'; END IF;

  IF v_existing.invoice_type = 'final'
     OR v_existing.status NOT IN ('draft', 'proforma')
     OR v_existing.ksef_status IN ('pending', 'accepted')
     OR NULLIF(v_existing.ksef_reference_number, '') IS NOT NULL THEN
    RAISE EXCEPTION 'Wystawionego dokumentu nie można edytować. Użyj faktury korygującej.'
      USING ERRCODE = '55000';
  END IF;

  IF v_invoice_type NOT IN ('vat', 'proforma', 'advance', 'corrective') THEN
    RAISE EXCEPTION 'Nieobsługiwany typ dokumentu: %', v_invoice_type;
  END IF;
  IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Dokument musi zawierać co najmniej jedną pozycję';
  END IF;
  IF v_invoice_type = 'advance'
     AND (jsonb_typeof(p_order_items) <> 'array' OR jsonb_array_length(p_order_items) = 0) THEN
    RAISE EXCEPTION 'Faktura zaliczkowa musi zawierać pełny snapshot zamówienia';
  END IF;
  IF v_invoice_type = 'corrective' AND (
    NULLIF(p_invoice->>'related_invoice_id', '') IS NULL
    OR NULLIF(BTRIM(p_invoice->>'correction_reason'), '') IS NULL
    OR COALESCE((p_invoice->>'correction_type')::integer, 0) NOT IN (1, 2, 3)
  ) THEN
    RAISE EXCEPTION 'Korekta wymaga dokumentu źródłowego, przyczyny i typu korekty';
  END IF;

  IF NOT public.can_manage_invoice_company(NULLIF(p_invoice->>'my_company_id', '')::uuid) THEN
    RAISE EXCEPTION 'Brak uprawnień do firmy wystawiającej' USING ERRCODE = '42501';
  END IF;

  v_actor := public.current_invoice_employee_id();
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Nie znaleziono profilu pracownika dla zalogowanego użytkownika'
      USING ERRCODE = '42501';
  END IF;

  IF v_invoice_type = 'corrective' THEN
    SELECT * INTO v_source_invoice
    FROM public.invoices
    WHERE id = NULLIF(p_invoice->>'related_invoice_id', '')::uuid
    FOR UPDATE;

    IF NOT FOUND
       OR v_source_invoice.invoice_type = 'proforma'
       OR v_source_invoice.status IN ('draft', 'cancelled', 'proforma') THEN
      RAISE EXCEPTION 'Korygowany dokument nie istnieje albo nie został wystawiony';
    END IF;
    IF v_source_invoice.my_company_id IS DISTINCT FROM NULLIF(p_invoice->>'my_company_id', '')::uuid THEN
      RAISE EXCEPTION 'Korekta musi być wystawiona przez tę samą spółkę co dokument źródłowy';
    END IF;
  END IF;

  UPDATE public.invoices SET
    invoice_number = BTRIM(p_invoice->>'invoice_number'),
    invoice_type = v_invoice_type,
    status = COALESCE(p_invoice->>'status', 'draft'),
    is_proforma = v_invoice_type = 'proforma',
    issue_date = (p_invoice->>'issue_date')::date,
    sale_date = (p_invoice->>'sale_date')::date,
    payment_due_date = (p_invoice->>'payment_due_date')::date,
    paid_at = NULLIF(p_invoice->>'paid_at', '')::timestamptz,
    payment_status = COALESCE(p_invoice->>'payment_status', 'unpaid'),
    paid_amount = COALESCE((p_invoice->>'paid_amount')::numeric, 0),
    event_id = NULLIF(p_invoice->>'event_id', '')::uuid,
    organization_id = NULLIF(p_invoice->>'organization_id', '')::uuid,
    billing_arrangement = COALESCE(p_invoice->>'billing_arrangement', 'direct'),
    service_recipient_organization_id = NULLIF(p_invoice->>'service_recipient_organization_id', '')::uuid,
    service_recipient_contact_id = NULLIF(p_invoice->>'service_recipient_contact_id', '')::uuid,
    buyer_is_private_person = COALESCE((p_invoice->>'buyer_is_private_person')::boolean, false),
    buyer_contact_id = NULLIF(p_invoice->>'buyer_contact_id', '')::uuid,
    my_company_id = NULLIF(p_invoice->>'my_company_id', '')::uuid,
    buyer_name = p_invoice->>'buyer_name',
    buyer_nip = NULLIF(p_invoice->>'buyer_nip', ''),
    buyer_street = p_invoice->>'buyer_street',
    buyer_postal_code = p_invoice->>'buyer_postal_code',
    buyer_city = p_invoice->>'buyer_city',
    buyer_country = COALESCE(p_invoice->>'buyer_country', 'Polska'),
    buyer_email = p_invoice->>'buyer_email',
    buyer_phone = p_invoice->>'buyer_phone',
    seller_name = p_invoice->>'seller_name',
    seller_nip = p_invoice->>'seller_nip',
    seller_street = p_invoice->>'seller_street',
    seller_postal_code = p_invoice->>'seller_postal_code',
    seller_city = p_invoice->>'seller_city',
    seller_country = COALESCE(p_invoice->>'seller_country', 'Polska'),
    seller_email = p_invoice->>'seller_email',
    seller_phone = p_invoice->>'seller_phone',
    payment_method = COALESCE(p_invoice->>'payment_method', 'Przelew'),
    bank_name = p_invoice->>'bank_name',
    bank_account = p_invoice->>'bank_account',
    bank_swift_code = p_invoice->>'bank_swift_code',
    issue_place = COALESCE(p_invoice->>'issue_place', ''),
    footer_note = p_invoice->>'footer_note',
    signature_name = p_invoice->>'signature_name',
    website = p_invoice->>'website',
    notes = CASE WHEN p_invoice ? 'notes' THEN p_invoice->>'notes' ELSE notes END,
    internal_notes = CASE
      WHEN p_invoice ? 'internal_notes' THEN p_invoice->>'internal_notes'
      ELSE internal_notes
    END,
    currency_code = COALESCE(p_invoice->>'currency_code', 'PLN'),
    order_total_net = CASE WHEN v_invoice_type = 'advance' THEN NULLIF(p_invoice->>'order_total_net', '')::numeric END,
    order_total_vat = CASE WHEN v_invoice_type = 'advance' THEN NULLIF(p_invoice->>'order_total_vat', '')::numeric END,
    order_total_gross = CASE WHEN v_invoice_type = 'advance' THEN NULLIF(p_invoice->>'order_total_gross', '')::numeric END,
    related_invoice_id = CASE WHEN v_invoice_type = 'corrective' THEN v_source_invoice.id END,
    correction_reason = CASE WHEN v_invoice_type = 'corrective' THEN p_invoice->>'correction_reason' END,
    correction_type = CASE WHEN v_invoice_type = 'corrective' THEN (p_invoice->>'correction_type')::smallint END,
    correction_scope = CASE WHEN v_invoice_type = 'corrective' THEN p_invoice->>'correction_scope' END,
    corrected_invoice_number = CASE WHEN v_invoice_type = 'corrective' THEN v_source_invoice.invoice_number END,
    corrected_invoice_issue_date = CASE WHEN v_invoice_type = 'corrective' THEN v_source_invoice.issue_date END,
    corrected_invoice_ksef_number = CASE WHEN v_invoice_type = 'corrective' THEN v_source_invoice.ksef_reference_number END,
    corrected_invoice_was_in_ksef = CASE WHEN v_invoice_type = 'corrective' THEN
      v_source_invoice.ksef_status = 'accepted'
      OR NULLIF(v_source_invoice.ksef_reference_number, '') IS NOT NULL
    ELSE false END,
    updated_at = now()
  WHERE id = p_invoice_id;

  DELETE FROM public.invoice_items WHERE invoice_id = p_invoice_id;
  DELETE FROM public.invoice_order_items WHERE invoice_id = p_invoice_id;

  INSERT INTO public.invoice_items (
    invoice_id, position_number, name, unit, quantity, price_net, vat_rate,
    vat_code, vat_exemption_reason, value_net, vat_amount, value_gross,
    before_quantity, before_price_net, after_quantity, after_price_net
  )
  SELECT
    p_invoice_id, x.position_number, x.name, x.unit, x.quantity, x.price_net,
    x.vat_rate, x.vat_code, x.vat_exemption_reason,
    COALESCE(x.value_net, 0), COALESCE(x.vat_amount, 0), COALESCE(x.value_gross, 0),
    x.before_quantity, x.before_price_net, x.after_quantity, x.after_price_net
  FROM jsonb_to_recordset(p_items) AS x(
    position_number integer, name text, unit text, quantity numeric, price_net numeric,
    vat_rate numeric, vat_code text, vat_exemption_reason text,
    value_net numeric, vat_amount numeric, value_gross numeric,
    before_quantity numeric, before_price_net numeric,
    after_quantity numeric, after_price_net numeric
  );

  IF v_invoice_type = 'advance' THEN
    INSERT INTO public.invoice_order_items (
      invoice_id, position_number, name, unit, quantity, price_net, vat_rate,
      vat_code, vat_exemption_reason, value_net, vat_amount, value_gross
    )
    SELECT
      p_invoice_id, x.position_number, x.name, x.unit, x.quantity, x.price_net,
      x.vat_rate, x.vat_code, x.vat_exemption_reason,
      ROUND(x.quantity * x.price_net, 2),
      ROUND(x.quantity * x.price_net * x.vat_rate / 100.0, 2),
      ROUND(x.quantity * x.price_net, 2)
        + ROUND(x.quantity * x.price_net * x.vat_rate / 100.0, 2)
    FROM jsonb_to_recordset(p_order_items) AS x(
      position_number integer, name text, unit text, quantity numeric, price_net numeric,
      vat_rate numeric, vat_code text, vat_exemption_reason text,
      value_net numeric, vat_amount numeric, value_gross numeric
    );

    UPDATE public.invoices i
    SET order_total_net = totals.net,
        order_total_vat = totals.vat,
        order_total_gross = totals.gross,
        updated_at = now()
    FROM (
      SELECT ROUND(SUM(value_net), 2) net,
             ROUND(SUM(vat_amount), 2) vat,
             ROUND(SUM(value_gross), 2) gross
      FROM public.invoice_order_items
      WHERE invoice_id = p_invoice_id
    ) totals
    WHERE i.id = p_invoice_id;
  END IF;

  INSERT INTO public.invoice_history (invoice_id, action, changed_by, changes)
  VALUES (
    p_invoice_id, 'edited', v_actor,
    jsonb_build_object('previous_status', v_existing.status, 'status', p_invoice->>'status')
  );

  RETURN p_invoice_id;
END;
$$;

REVOKE ALL ON FUNCTION public.update_invoice_draft_atomic(uuid, jsonb, jsonb, jsonb, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_invoice_draft_atomic(uuid, jsonb, jsonb, jsonb, uuid) TO authenticated;

-- Atomowe utworzenie faktury końcowej i zarezerwowanie wszystkich zaliczek.
CREATE OR REPLACE FUNCTION public.create_final_invoice_atomic(
  p_invoice jsonb,
  p_items jsonb,
  p_advance_ids uuid[],
  p_actor uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_final_id uuid;
  v_invoice_number text;
  v_advance_count integer;
  v_settled_net numeric(14,2);
  v_settled_vat numeric(14,2);
  v_settled_gross numeric(14,2);
  v_total_net numeric(14,2) := COALESCE((p_invoice->>'total_net')::numeric, 0);
  v_total_vat numeric(14,2) := COALESCE((p_invoice->>'total_vat')::numeric, 0);
  v_total_gross numeric(14,2) := COALESCE((p_invoice->>'total_gross')::numeric, 0);
  v_items_net numeric(14,2);
  v_items_vat numeric(14,2);
  v_items_gross numeric(14,2);
  v_settled_invoices jsonb;
  v_settlement_summary jsonb;
  v_actor uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.can_manage_invoice_company(NULLIF(p_invoice->>'my_company_id', '')::uuid) THEN
    RAISE EXCEPTION 'Brak uprawnień do wystawiania faktur' USING ERRCODE = '42501';
  END IF;

  v_actor := public.current_invoice_employee_id();
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Nie znaleziono profilu pracownika dla zalogowanego użytkownika'
      USING ERRCODE = '42501';
  END IF;

  v_invoice_number := CASE
    WHEN COALESCE((p_invoice->>'auto_number')::boolean, false)
      THEN public.reserve_invoice_number_atomic('final', NULLIF(p_invoice->>'my_company_id', '')::uuid)
    ELSE NULLIF(BTRIM(p_invoice->>'invoice_number'), '')
  END;
  IF v_invoice_number IS NULL THEN
    RAISE EXCEPTION 'Numer faktury końcowej jest wymagany';
  END IF;

  IF COALESCE(cardinality(p_advance_ids), 0) = 0 THEN
    RAISE EXCEPTION 'Faktura końcowa musi rozliczać co najmniej jedną zaliczkę';
  END IF;

  IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Faktura końcowa musi zawierać pozycje';
  END IF;

  SELECT
    ROUND(COALESCE(SUM(x.value_net), 0), 2),
    ROUND(COALESCE(SUM(x.vat_amount), 0), 2),
    ROUND(COALESCE(SUM(x.value_gross), 0), 2)
  INTO v_items_net, v_items_vat, v_items_gross
  FROM jsonb_to_recordset(p_items) AS x(
    value_net numeric, vat_amount numeric, value_gross numeric
  );

  IF ABS(v_items_net - v_total_net) > 0.01
     OR ABS(v_items_vat - v_total_vat) > 0.01
     OR ABS(v_items_gross - v_total_gross) > 0.01 THEN
    RAISE EXCEPTION 'Sumy faktury końcowej nie zgadzają się z jej pozycjami';
  END IF;

  PERFORM 1
  FROM public.invoices
  WHERE id = ANY(p_advance_ids)
  FOR UPDATE;

  SELECT COUNT(*), COALESCE(SUM(total_net), 0), COALESCE(SUM(total_vat), 0), COALESCE(SUM(total_gross), 0)
  INTO v_advance_count, v_settled_net, v_settled_vat, v_settled_gross
  FROM public.invoices
  WHERE id = ANY(p_advance_ids)
    AND invoice_type = 'advance'
    AND status NOT IN ('draft', 'cancelled', 'proforma');

  IF v_advance_count <> cardinality(p_advance_ids) THEN
    RAISE EXCEPTION 'Wybrano zaliczkę w szkicu, anulowaną albo nieistniejącą';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.invoice_settlements s WHERE s.advance_invoice_id = ANY(p_advance_ids)
  ) THEN
    RAISE EXCEPTION 'Co najmniej jedna zaliczka została już rozliczona inną fakturą końcową'
      USING ERRCODE = '23505';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.invoices a
    WHERE a.id = ANY(p_advance_ids)
      AND (
        a.my_company_id IS DISTINCT FROM NULLIF(p_invoice->>'my_company_id', '')::uuid
        OR regexp_replace(COALESCE(a.buyer_nip, ''), '[^0-9]', '', 'g')
           IS DISTINCT FROM regexp_replace(COALESCE(p_invoice->>'buyer_nip', ''), '[^0-9]', '', 'g')
        OR COALESCE(a.currency_code, 'PLN') IS DISTINCT FROM COALESCE(p_invoice->>'currency_code', 'PLN')
        OR a.event_id IS DISTINCT FROM NULLIF(p_invoice->>'event_id', '')::uuid
        OR a.organization_id IS DISTINCT FROM NULLIF(p_invoice->>'organization_id', '')::uuid
      )
  ) THEN
    RAISE EXCEPTION 'Zaliczki muszą dotyczyć tego samego sprzedawcy, nabywcy, waluty, wydarzenia i płatnika';
  END IF;

  IF v_settled_gross > v_total_gross + 0.01 THEN
    RAISE EXCEPTION 'Suma zaliczek przekracza wartość zamówienia';
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', a.id,
    'invoiceNumber', a.invoice_number,
    'invoiceType', a.invoice_type,
    'issueDate', a.issue_date,
    'totalNet', a.total_net,
    'totalVat', a.total_vat,
    'totalGross', a.total_gross,
    'ksefReferenceNumber', a.ksef_reference_number
  ) ORDER BY a.issue_date, a.invoice_number), '[]'::jsonb)
  INTO v_settled_invoices
  FROM public.invoices a
  WHERE a.id = ANY(p_advance_ids);

  v_settlement_summary := jsonb_build_object(
    'invoiceTotalNet', v_total_net,
    'invoiceTotalVat', v_total_vat,
    'invoiceTotalGross', v_total_gross,
    'settledNet', v_settled_net,
    'settledVat', v_settled_vat,
    'settledGross', v_settled_gross,
    'remainingNet', ROUND(v_total_net - v_settled_net, 2),
    'remainingVat', ROUND(v_total_vat - v_settled_vat, 2),
    'remainingGross', ROUND(v_total_gross - v_settled_gross, 2)
  );

  INSERT INTO public.invoices (
    invoice_number, invoice_type, status, is_proforma, issue_date, sale_date,
    payment_due_date, event_id, organization_id, billing_arrangement,
    service_recipient_organization_id, service_recipient_contact_id,
    buyer_is_private_person, buyer_contact_id,
    my_company_id, created_by, total_net, total_vat, total_gross, currency_code,
    payment_method, bank_account, bank_name, bank_swift_code, issue_place,
    notes, internal_notes, settled_invoices, settlement_summary, related_invoice_id,
    buyer_name, buyer_nip, buyer_street, buyer_postal_code, buyer_city,
    buyer_country, buyer_email, buyer_phone, buyer_contact_person,
    seller_name, seller_nip, seller_street, seller_postal_code, seller_city,
    seller_country, seller_email, seller_phone, company_logo_url, footer_note,
    signature_name, website
  ) VALUES (
    v_invoice_number, 'final', 'draft', false,
    (p_invoice->>'issue_date')::date, (p_invoice->>'sale_date')::date,
    (p_invoice->>'payment_due_date')::date,
    NULLIF(p_invoice->>'event_id', '')::uuid,
    NULLIF(p_invoice->>'organization_id', '')::uuid,
    COALESCE(p_invoice->>'billing_arrangement', 'direct'),
    NULLIF(p_invoice->>'service_recipient_organization_id', '')::uuid,
    NULLIF(p_invoice->>'service_recipient_contact_id', '')::uuid,
    COALESCE((p_invoice->>'buyer_is_private_person')::boolean, false),
    NULLIF(p_invoice->>'buyer_contact_id', '')::uuid,
    NULLIF(p_invoice->>'my_company_id', '')::uuid,
    v_actor, v_total_net, v_total_vat, v_total_gross,
    COALESCE(p_invoice->>'currency_code', 'PLN'),
    p_invoice->>'payment_method', p_invoice->>'bank_account', p_invoice->>'bank_name',
    p_invoice->>'bank_swift_code', p_invoice->>'issue_place', p_invoice->>'notes',
    p_invoice->>'internal_notes', v_settled_invoices,
    v_settlement_summary, p_advance_ids[1],
    p_invoice->>'buyer_name', NULLIF(p_invoice->>'buyer_nip', ''), p_invoice->>'buyer_street',
    p_invoice->>'buyer_postal_code', p_invoice->>'buyer_city',
    COALESCE(p_invoice->>'buyer_country', 'Polska'), p_invoice->>'buyer_email',
    p_invoice->>'buyer_phone', p_invoice->>'buyer_contact_person',
    p_invoice->>'seller_name', p_invoice->>'seller_nip', p_invoice->>'seller_street',
    p_invoice->>'seller_postal_code', p_invoice->>'seller_city',
    COALESCE(p_invoice->>'seller_country', 'Polska'), p_invoice->>'seller_email',
    p_invoice->>'seller_phone', p_invoice->>'company_logo_url', p_invoice->>'footer_note',
    p_invoice->>'signature_name', p_invoice->>'website'
  ) RETURNING id INTO v_final_id;

  INSERT INTO public.invoice_items (
    invoice_id, position_number, name, unit, quantity, price_net, vat_rate,
    vat_code, vat_exemption_reason, value_net, vat_amount, value_gross
  )
  SELECT
    v_final_id, x.position_number, x.name, x.unit, x.quantity, x.price_net,
    x.vat_rate, x.vat_code, x.vat_exemption_reason,
    x.value_net, x.vat_amount, x.value_gross
  FROM jsonb_to_recordset(p_items) AS x(
    position_number integer, name text, unit text, quantity numeric,
    price_net numeric, vat_rate numeric, vat_code text,
    vat_exemption_reason text, value_net numeric, vat_amount numeric, value_gross numeric
  );

  SELECT
    ROUND(COALESCE(SUM(value_net), 0), 2),
    ROUND(COALESCE(SUM(vat_amount), 0), 2),
    ROUND(COALESCE(SUM(value_gross), 0), 2)
  INTO v_items_net, v_items_vat, v_items_gross
  FROM public.invoice_items
  WHERE invoice_id = v_final_id;

  IF ABS(v_items_net - v_total_net) > 0.01
     OR ABS(v_items_vat - v_total_vat) > 0.01
     OR ABS(v_items_gross - v_total_gross) > 0.01 THEN
    RAISE EXCEPTION 'Sumy zapisanych pozycji faktury końcowej nie zgadzają się z dokumentem';
  END IF;

  INSERT INTO public.invoice_settlements (
    final_invoice_id, advance_invoice_id, settled_net, settled_vat, settled_gross,
    vat_breakdown, created_by
  )
  SELECT
    v_final_id, a.id, a.total_net, a.total_vat, a.total_gross,
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'vatCode', q.vat_code, 'net', q.net, 'vat', q.vat, 'gross', q.gross
      ) ORDER BY q.vat_code)
      FROM (
        SELECT ii.vat_code, SUM(ii.value_net) net, SUM(ii.vat_amount) vat, SUM(ii.value_gross) gross
        FROM public.invoice_items ii WHERE ii.invoice_id = a.id GROUP BY ii.vat_code
      ) q
    ), '[]'::jsonb),
    v_actor
  FROM public.invoices a
  WHERE a.id = ANY(p_advance_ids);

  INSERT INTO public.invoice_history (invoice_id, action, changed_by, changes)
  VALUES (
    v_final_id, 'final_invoice_created', v_actor,
    jsonb_build_object(
      'settled_invoice_ids', to_jsonb(p_advance_ids),
      'settled_net', v_settled_net,
      'settled_vat', v_settled_vat,
      'settled_gross', v_settled_gross
    )
  );

  RETURN v_final_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_final_invoice_atomic(jsonb, jsonb, uuid[], uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_final_invoice_atomic(jsonb, jsonb, uuid[], uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.begin_ksef_send_atomic(
  p_invoice_id uuid,
  p_actor uuid DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_invoice public.invoices%ROWTYPE;
BEGIN
  SELECT * INTO v_invoice FROM public.invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Nie znaleziono faktury'; END IF;
  IF COALESCE(v_invoice.is_proforma, false) OR v_invoice.invoice_type = 'proforma' THEN
    RAISE EXCEPTION 'Proforma nie jest dokumentem wysyłanym do KSeF';
  END IF;
  IF COALESCE(v_invoice.buyer_is_private_person, false) THEN
    RAISE EXCEPTION 'Faktura konsumencka nie może być wysłana tym przepływem do KSeF';
  END IF;
  IF v_invoice.status = 'cancelled' THEN
    RAISE EXCEPTION 'Anulowanego dokumentu nie można wysłać do KSeF';
  END IF;
  IF v_invoice.ksef_status IN ('pending', 'accepted')
     OR NULLIF(v_invoice.ksef_reference_number, '') IS NOT NULL
     OR EXISTS (
       SELECT 1 FROM public.ksef_invoices k
       WHERE k.invoice_id = p_invoice_id AND k.sync_status = 'synced'
     ) THEN
    RAISE EXCEPTION 'Dokument jest już wysyłany albo został przyjęty przez KSeF';
  END IF;

  UPDATE public.invoices
  SET ksef_status = 'pending', ksef_error = NULL, ksef_sent_at = now(), updated_at = now()
  WHERE id = p_invoice_id;

  INSERT INTO public.invoice_history (invoice_id, action, changed_by, changes)
  VALUES (p_invoice_id, 'ksef_send_started', p_actor, jsonb_build_object('started_at', now()));
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.finish_ksef_send_attempt_failure_atomic(
  p_invoice_id uuid,
  p_error text,
  p_keep_pending boolean,
  p_actor uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_invoice public.invoices%ROWTYPE;
BEGIN
  SELECT * INTO v_invoice FROM public.invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND OR v_invoice.ksef_status = 'accepted' THEN RETURN; END IF;

  UPDATE public.invoices
  SET ksef_status = CASE WHEN p_keep_pending THEN 'pending' ELSE 'rejected' END,
      ksef_error = NULLIF(LEFT(BTRIM(COALESCE(p_error, '')), 2000), ''),
      updated_at = now()
  WHERE id = p_invoice_id;

  INSERT INTO public.invoice_history (invoice_id, action, changed_by, changes)
  VALUES (
    p_invoice_id,
    CASE WHEN p_keep_pending THEN 'ksef_send_uncertain' ELSE 'ksef_send_error' END,
    p_actor,
    jsonb_build_object('error', LEFT(COALESCE(p_error, ''), 2000), 'kept_pending', p_keep_pending)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.begin_ksef_send_atomic(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.begin_ksef_send_atomic(uuid, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.finish_ksef_send_attempt_failure_atomic(uuid, text, boolean, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.finish_ksef_send_attempt_failure_atomic(uuid, text, boolean, uuid) TO service_role;

-- Zapis wyniku zewnętrznej operacji KSeF odbywa się w jednej transakcji:
-- rejestr XML, status faktury oraz historia nigdy nie rozjeżdżają się częściowo.
CREATE OR REPLACE FUNCTION public.persist_ksef_send_result_atomic(
  p_invoice_id uuid,
  p_xml_content text,
  p_ksef_number text,
  p_final_timestamp timestamptz,
  p_rejection_message text,
  p_is_pending boolean,
  p_actor uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_invoice public.invoices%ROWTYPE;
  v_is_rejected boolean := NULLIF(BTRIM(COALESCE(p_rejection_message, '')), '') IS NOT NULL;
  v_amount_to_pay numeric(14,2);
  v_existing_ksef_number text;
BEGIN
  SELECT * INTO v_invoice FROM public.invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Nie znaleziono faktury'; END IF;

  IF p_is_pending AND (v_is_rejected OR NULLIF(BTRIM(COALESCE(p_ksef_number, '')), '') IS NOT NULL) THEN
    RAISE EXCEPTION 'Niespójny oczekujący wynik wysyłki KSeF';
  END IF;

  IF NOT p_is_pending AND NOT v_is_rejected THEN
    IF NULLIF(BTRIM(COALESCE(p_ksef_number, '')), '') IS NULL
       OR p_final_timestamp IS NULL
       OR NULLIF(p_xml_content, '') IS NULL THEN
      RAISE EXCEPTION 'Przyjęta faktura wymaga numeru KSeF, czasu przyjęcia i XML';
    END IF;

    SELECT k.ksef_reference_number
    INTO v_existing_ksef_number
    FROM public.ksef_invoices k
    WHERE k.invoice_id = v_invoice.id AND k.sync_status = 'synced'
    ORDER BY k.synced_at DESC NULLS LAST
    LIMIT 1;

    IF v_existing_ksef_number IS NOT NULL
       AND v_existing_ksef_number IS DISTINCT FROM p_ksef_number THEN
      RAISE EXCEPTION 'Faktura ma już inny numer KSeF: %', v_existing_ksef_number
        USING ERRCODE = '23505';
    END IF;

    v_amount_to_pay := CASE
      WHEN v_invoice.invoice_type = 'final'
        THEN COALESCE((v_invoice.settlement_summary->>'remainingGross')::numeric, v_invoice.total_gross)
      ELSE v_invoice.total_gross
    END;

    INSERT INTO public.ksef_invoices (
      invoice_id, ksef_reference_number, invoice_type, invoice_number,
      seller_name, seller_nip, buyer_name, buyer_nip,
      net_amount, vat_amount, gross_amount, amount_to_pay_gross,
      settlement_summary, settled_invoices, currency, issue_date,
      payment_due_date, xml_content, sync_status, sync_error,
      ksef_issued_at, synced_at, my_company_id
    ) SELECT
      v_invoice.id, p_ksef_number, 'issued', v_invoice.invoice_number,
      v_invoice.seller_name, v_invoice.seller_nip, v_invoice.buyer_name, v_invoice.buyer_nip,
      v_invoice.total_net, v_invoice.total_vat, v_invoice.total_gross, v_amount_to_pay,
      v_invoice.settlement_summary, COALESCE(v_invoice.settled_invoices, '[]'::jsonb),
      v_invoice.currency_code, v_invoice.issue_date, v_invoice.payment_due_date,
      p_xml_content, 'synced', NULL, p_final_timestamp, now(), v_invoice.my_company_id
    WHERE NOT EXISTS (
      SELECT 1 FROM public.ksef_invoices existing
      WHERE existing.invoice_id = v_invoice.id AND existing.sync_status = 'synced'
    );
  END IF;

  UPDATE public.invoices
  SET status = CASE WHEN v_is_rejected OR p_is_pending THEN 'draft' ELSE 'issued' END,
      ksef_status = CASE WHEN v_is_rejected THEN 'rejected' WHEN p_is_pending THEN 'pending' ELSE 'accepted' END,
      ksef_reference_number = CASE WHEN v_is_rejected OR p_is_pending THEN NULL ELSE p_ksef_number END,
      ksef_error = NULLIF(BTRIM(COALESCE(p_rejection_message, '')), ''),
      ksef_sent_at = now(),
      updated_at = now()
  WHERE id = p_invoice_id;

  INSERT INTO public.invoice_history (invoice_id, action, changed_by, changes)
  VALUES (
    p_invoice_id,
    CASE WHEN v_is_rejected THEN 'ksef_send_error'
         WHEN p_is_pending THEN 'ksef_send_pending'
         ELSE 'sent_to_ksef' END,
    p_actor,
    jsonb_build_object(
      'ksef_reference_number', CASE WHEN v_is_rejected OR p_is_pending THEN NULL ELSE p_ksef_number END,
      'sent_at', p_final_timestamp,
      'rejection_message', NULLIF(BTRIM(COALESCE(p_rejection_message, '')), '')
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.persist_ksef_send_result_atomic(uuid, text, text, timestamptz, text, boolean, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.persist_ksef_send_result_atomic(uuid, text, text, timestamptz, text, boolean, uuid) TO service_role;

-- Synchronizacja listy dokumentów wydanych może odnaleźć fakturę wysłaną w
-- przerwanej sesji. Powiązanie obu rekordów musi być atomowe i dopuszczalne
-- wyłącznie wtedy, gdy firma oraz numer dokumentu są zgodne.
CREATE OR REPLACE FUNCTION public.reconcile_local_invoice_with_ksef_atomic(
  p_invoice_id uuid,
  p_ksef_reference_number text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_invoice public.invoices%ROWTYPE;
  v_ksef public.ksef_invoices%ROWTYPE;
BEGIN
  SELECT * INTO v_invoice
  FROM public.invoices
  WHERE id = p_invoice_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Nie znaleziono lokalnej faktury'; END IF;

  SELECT * INTO v_ksef
  FROM public.ksef_invoices
  WHERE ksef_reference_number = NULLIF(BTRIM(p_ksef_reference_number), '')
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Nie znaleziono dokumentu KSeF'; END IF;

  IF v_ksef.invoice_type IS DISTINCT FROM 'issued'
     OR v_ksef.my_company_id IS DISTINCT FROM v_invoice.my_company_id
     OR NULLIF(BTRIM(v_ksef.invoice_number), '') IS DISTINCT FROM NULLIF(BTRIM(v_invoice.invoice_number), '') THEN
    RAISE EXCEPTION 'Dokument KSeF nie odpowiada lokalnej fakturze';
  END IF;

  IF NULLIF(v_invoice.ksef_reference_number, '') IS NOT NULL
     AND v_invoice.ksef_reference_number IS DISTINCT FROM v_ksef.ksef_reference_number THEN
    RAISE EXCEPTION 'Lokalna faktura ma już inny numer KSeF' USING ERRCODE = '23505';
  END IF;
  IF v_ksef.invoice_id IS NOT NULL AND v_ksef.invoice_id IS DISTINCT FROM v_invoice.id THEN
    RAISE EXCEPTION 'Dokument KSeF jest już powiązany z inną fakturą' USING ERRCODE = '23505';
  END IF;

  IF NULLIF(regexp_replace(COALESCE(v_ksef.seller_nip, ''), '[^0-9]', '', 'g'), '') IS NOT NULL
     AND NULLIF(regexp_replace(COALESCE(v_invoice.seller_nip, ''), '[^0-9]', '', 'g'), '') IS NOT NULL
     AND regexp_replace(v_ksef.seller_nip, '[^0-9]', '', 'g')
       IS DISTINCT FROM regexp_replace(v_invoice.seller_nip, '[^0-9]', '', 'g') THEN
    RAISE EXCEPTION 'NIP sprzedawcy w KSeF nie zgadza się z lokalną fakturą';
  END IF;
  IF NULLIF(regexp_replace(COALESCE(v_ksef.buyer_nip, ''), '[^0-9]', '', 'g'), '') IS NOT NULL
     AND NULLIF(regexp_replace(COALESCE(v_invoice.buyer_nip, ''), '[^0-9]', '', 'g'), '') IS NOT NULL
     AND regexp_replace(v_ksef.buyer_nip, '[^0-9]', '', 'g')
       IS DISTINCT FROM regexp_replace(v_invoice.buyer_nip, '[^0-9]', '', 'g') THEN
    RAISE EXCEPTION 'NIP nabywcy w KSeF nie zgadza się z lokalną fakturą';
  END IF;
  IF v_ksef.issue_date IS NOT NULL
     AND v_invoice.issue_date IS NOT NULL
     AND v_ksef.issue_date IS DISTINCT FROM v_invoice.issue_date THEN
    RAISE EXCEPTION 'Data wystawienia w KSeF nie zgadza się z lokalną fakturą';
  END IF;
  IF v_ksef.gross_amount IS NOT NULL
     AND v_invoice.total_gross IS NOT NULL
     AND ABS(
       v_ksef.gross_amount - CASE
         WHEN v_invoice.invoice_type = 'final'
           THEN COALESCE(
             NULLIF(v_invoice.settlement_summary->>'remainingGross', '')::numeric,
             v_invoice.total_gross
           )
         ELSE v_invoice.total_gross
       END
     ) > 0.01 THEN
    RAISE EXCEPTION 'Wartość brutto w KSeF nie zgadza się z lokalną fakturą';
  END IF;

  UPDATE public.ksef_invoices
  SET invoice_id = v_invoice.id,
      sync_status = 'synced',
      sync_error = NULL,
      synced_at = COALESCE(synced_at, now())
  WHERE id = v_ksef.id;

  UPDATE public.invoices
  SET status = CASE WHEN status IN ('draft', 'proforma') THEN 'issued' ELSE status END,
      is_proforma = false,
      ksef_reference_number = v_ksef.ksef_reference_number,
      ksef_status = 'accepted',
      ksef_error = NULL,
      ksef_sent_at = COALESCE(ksef_sent_at, v_ksef.ksef_issued_at, now()),
      updated_at = now()
  WHERE id = v_invoice.id;

  INSERT INTO public.invoice_history (invoice_id, action, changed_by, changes)
  SELECT
    v_invoice.id,
    'ksef_reconciled',
    NULL,
    jsonb_build_object(
      'ksef_reference_number', v_ksef.ksef_reference_number,
      'reconciled_at', now()
    )
  WHERE v_invoice.ksef_reference_number IS DISTINCT FROM v_ksef.ksef_reference_number
     OR v_invoice.ksef_status IS DISTINCT FROM 'accepted'
     OR v_ksef.invoice_id IS DISTINCT FROM v_invoice.id;
END;
$$;

REVOKE ALL ON FUNCTION public.reconcile_local_invoice_with_ksef_atomic(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reconcile_local_invoice_with_ksef_atomic(uuid, text) TO service_role;

COMMIT;
