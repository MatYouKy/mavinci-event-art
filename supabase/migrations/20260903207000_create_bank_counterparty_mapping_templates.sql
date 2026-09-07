/*
  # Szablony rozpoznawania kontrahentów z opisów bankowych

  Pozwalają przypisać nieczytelny alias terminala lub operatora płatności
  do właściwej nazwy prawnej kontrahenta i opcjonalnie jego NIP-u.
*/

CREATE TABLE IF NOT EXISTS public.bank_counterparty_mapping_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  my_company_id uuid REFERENCES public.my_companies(id) ON DELETE CASCADE,
  alias_pattern text NOT NULL,
  normalized_alias text NOT NULL,
  counterparty_name text NOT NULL,
  counterparty_nip text,
  source_transaction_id uuid REFERENCES public.bank_transactions(id) ON DELETE SET NULL,
  is_active boolean NOT NULL DEFAULT true,
  usage_count integer NOT NULL DEFAULT 0,
  last_used_at timestamptz,
  created_by uuid DEFAULT public.current_invoice_employee_id() REFERENCES public.employees(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bank_counterparty_mapping_alias_length CHECK (char_length(normalized_alias) >= 4),
  CONSTRAINT bank_counterparty_mapping_nip_check CHECK (
    counterparty_nip IS NULL OR counterparty_nip ~ '^[0-9]{10}$'
  ),
  CONSTRAINT bank_counterparty_mapping_company_alias_unique UNIQUE (my_company_id, normalized_alias)
);

CREATE INDEX IF NOT EXISTS idx_bank_counterparty_mapping_normalized_alias
  ON public.bank_counterparty_mapping_templates(normalized_alias)
  WHERE is_active;

ALTER TABLE public.bank_counterparty_mapping_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bank_counterparty_mapping_read ON public.bank_counterparty_mapping_templates;
CREATE POLICY bank_counterparty_mapping_read ON public.bank_counterparty_mapping_templates
  FOR SELECT TO authenticated USING (
    public.finance_can_view()
    AND (my_company_id IS NULL OR public.finance_company_visible(my_company_id))
  );

DROP POLICY IF EXISTS bank_counterparty_mapping_manage ON public.bank_counterparty_mapping_templates;
CREATE POLICY bank_counterparty_mapping_manage ON public.bank_counterparty_mapping_templates
  FOR ALL TO authenticated
  USING (
    my_company_id IS NOT NULL
    AND public.finance_can_manage()
    AND public.finance_company_visible(my_company_id)
  )
  WITH CHECK (
    my_company_id IS NOT NULL
    AND public.finance_can_manage()
    AND public.finance_company_visible(my_company_id)
  );

REVOKE ALL ON public.bank_counterparty_mapping_templates FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bank_counterparty_mapping_templates TO authenticated;

DROP TRIGGER IF EXISTS trg_touch_bank_counterparty_mapping_updated_at
  ON public.bank_counterparty_mapping_templates;
CREATE TRIGGER trg_touch_bank_counterparty_mapping_updated_at
BEFORE UPDATE ON public.bank_counterparty_mapping_templates
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.bank_counterparty_mapping_templates (
  my_company_id,
  alias_pattern,
  normalized_alias,
  counterparty_name,
  counterparty_nip
) VALUES (
  NULL,
  'OLSZTYN PL HOTEL WARMI NSKI',
  'OLSZTYNPLHOTELWARMINSKI',
  '"MAZUR-TOURIST" Sp. z o.o. UL. KOŁOBRZESKA 1',
  '7390200330'
)
ON CONFLICT DO NOTHING;

COMMENT ON TABLE public.bank_counterparty_mapping_templates IS
  'Ręcznie potwierdzone aliasy z opisów bankowych używane do identyfikacji prawnych nazw kontrahentów.';
COMMENT ON COLUMN public.bank_counterparty_mapping_templates.alias_pattern IS
  'Czytelny fragment opisu bankowego, np. nazwa hotelu widoczna na terminalu.';
COMMENT ON COLUMN public.bank_counterparty_mapping_templates.normalized_alias IS
  'Alias bez spacji, znaków specjalnych i polskich znaków, używany do porównania.';

NOTIFY pgrst, 'reload schema';
