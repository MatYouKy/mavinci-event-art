BEGIN;

-- Adres jest ustawieniem firmy. Kod PIN Saldeo celowo nie jest zapisywany
-- w bazie; użytkownik podaje go dopiero przy wysyłce dokumentów.
ALTER TABLE public.my_companies
  ADD COLUMN IF NOT EXISTS saldeo_document_email text,
  ADD COLUMN IF NOT EXISTS accountant_email text;

COMMENT ON COLUMN public.my_companies.saldeo_document_email IS
  'Dedykowany adres dokumentów SaldeoSMART, np. firma@dok.saldeo.pl. PIN nie jest przechowywany.';

COMMENT ON COLUMN public.my_companies.accountant_email IS
  'Adres osoby lub biura księgowego otrzymującego kompletne miesięczne uzgodnienie i wyciągi.';

CREATE TABLE IF NOT EXISTS public.saldeo_delivery_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  my_company_id uuid NOT NULL REFERENCES public.my_companies(id) ON DELETE CASCADE,
  period_month integer NOT NULL CHECK (period_month BETWEEN 1 AND 12),
  period_year integer NOT NULL CHECK (period_year >= 2000),
  source_type text NOT NULL CHECK (source_type IN (
    'external_invoice',
    'local_invoice',
    'bank_supporting_document'
  )),
  source_id uuid NOT NULL,
  saldeo_document_type text NOT NULL CHECK (saldeo_document_type IN ('FK', 'DS', 'P', 'DW', 'U')),
  delivered_to text NOT NULL,
  email_message_id text,
  original_file_name text,
  sent_by uuid DEFAULT auth.uid(),
  delivered_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS saldeo_delivery_log_period_idx
  ON public.saldeo_delivery_log(my_company_id, period_year, period_month, delivered_at DESC);

CREATE INDEX IF NOT EXISTS saldeo_delivery_log_source_idx
  ON public.saldeo_delivery_log(source_type, source_id, delivered_at DESC);

ALTER TABLE public.saldeo_delivery_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS saldeo_delivery_log_read ON public.saldeo_delivery_log;
CREATE POLICY saldeo_delivery_log_read
  ON public.saldeo_delivery_log FOR SELECT TO authenticated
  USING (
    public.finance_can_view()
    AND public.finance_company_visible(my_company_id)
  );

DROP POLICY IF EXISTS saldeo_delivery_log_manage ON public.saldeo_delivery_log;
CREATE POLICY saldeo_delivery_log_manage
  ON public.saldeo_delivery_log FOR ALL TO authenticated
  USING (
    public.finance_can_manage()
    AND public.finance_company_visible(my_company_id)
  )
  WITH CHECK (
    public.finance_can_manage()
    AND public.finance_company_visible(my_company_id)
  );

REVOKE ALL ON public.saldeo_delivery_log FROM anon, authenticated;
GRANT SELECT, INSERT ON public.saldeo_delivery_log TO authenticated;

-- Osobny dziennik pełnego przekazania miesiąca. Nie zastępuje historii
-- wiadomości e-mail; zapisuje stan uzgodnienia, który użytkownik zatwierdził.
CREATE TABLE IF NOT EXISTS public.accounting_month_handoffs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  my_company_id uuid NOT NULL REFERENCES public.my_companies(id) ON DELETE CASCADE,
  period_month integer NOT NULL CHECK (period_month BETWEEN 1 AND 12),
  period_year integer NOT NULL CHECK (period_year >= 2000),
  delivered_to text NOT NULL,
  email_message_id text,
  transaction_count integer NOT NULL DEFAULT 0 CHECK (transaction_count >= 0),
  statement_count integer NOT NULL DEFAULT 0 CHECK (statement_count >= 0),
  matched_relation_count integer NOT NULL DEFAULT 0 CHECK (matched_relation_count >= 0),
  saldeo_document_count integer NOT NULL DEFAULT 0 CHECK (saldeo_document_count >= 0),
  unresolved_count integer NOT NULL DEFAULT 0 CHECK (unresolved_count >= 0),
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  sent_by uuid DEFAULT auth.uid(),
  delivered_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS accounting_month_handoffs_period_idx
  ON public.accounting_month_handoffs(my_company_id, period_year, period_month, delivered_at DESC);

ALTER TABLE public.accounting_month_handoffs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS accounting_month_handoffs_read ON public.accounting_month_handoffs;
CREATE POLICY accounting_month_handoffs_read
  ON public.accounting_month_handoffs FOR SELECT TO authenticated
  USING (
    public.finance_can_view()
    AND public.finance_company_visible(my_company_id)
  );

DROP POLICY IF EXISTS accounting_month_handoffs_manage ON public.accounting_month_handoffs;
CREATE POLICY accounting_month_handoffs_manage
  ON public.accounting_month_handoffs FOR ALL TO authenticated
  USING (
    public.finance_can_manage()
    AND public.finance_company_visible(my_company_id)
  )
  WITH CHECK (
    public.finance_can_manage()
    AND public.finance_company_visible(my_company_id)
  );

REVOKE ALL ON public.accounting_month_handoffs FROM anon, authenticated;
GRANT SELECT, INSERT ON public.accounting_month_handoffs TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
