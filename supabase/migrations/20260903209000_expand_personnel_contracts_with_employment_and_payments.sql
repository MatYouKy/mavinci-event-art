BEGIN;

-- Umowa zachowuje dane strony nawet po usunięciu pracownika lub podwykonawcy.
ALTER TABLE public.personnel_contracts
  ADD COLUMN IF NOT EXISTS my_company_id uuid REFERENCES public.my_companies(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS party_name text,
  ADD COLUMN IF NOT EXISTS party_identifier text;

UPDATE public.personnel_contracts contract
SET party_name = concat_ws(' ', employee.name, employee.surname)
FROM public.employees employee
WHERE contract.employee_id = employee.id
  AND NULLIF(btrim(contract.party_name), '') IS NULL;

UPDATE public.personnel_contracts contract
SET party_name = subcontractor.company_name
FROM public.subcontractors subcontractor
WHERE contract.subcontractor_id = subcontractor.id
  AND NULLIF(btrim(contract.party_name), '') IS NULL;

UPDATE public.personnel_contracts
SET party_name = 'Nieznana osoba lub firma'
WHERE NULLIF(btrim(party_name), '') IS NULL;

ALTER TABLE public.personnel_contracts
  ALTER COLUMN party_name SET NOT NULL;

-- Powiązanie jest opcjonalne, ale jednocześnie może istnieć najwyżej jedno.
-- SET NULL chroni historię umowy po usunięciu rekordu osoby z CRM.
ALTER TABLE public.personnel_contracts
  DROP CONSTRAINT IF EXISTS personnel_contracts_exactly_one_party,
  DROP CONSTRAINT IF EXISTS personnel_contracts_contract_kind_check,
  DROP CONSTRAINT IF EXISTS personnel_contracts_employee_id_fkey,
  DROP CONSTRAINT IF EXISTS personnel_contracts_subcontractor_id_fkey;

ALTER TABLE public.personnel_contracts
  ADD CONSTRAINT personnel_contracts_at_most_one_link
    CHECK (num_nonnulls(employee_id, subcontractor_id) <= 1),
  ADD CONSTRAINT personnel_contracts_contract_kind_check
    CHECK (contract_kind IN ('employment', 'mandate', 'specific_work')),
  ADD CONSTRAINT personnel_contracts_employee_id_fkey
    FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE SET NULL,
  ADD CONSTRAINT personnel_contracts_subcontractor_id_fkey
    FOREIGN KEY (subcontractor_id) REFERENCES public.subcontractors(id) ON DELETE SET NULL;

DROP INDEX IF EXISTS public.uq_personnel_contract_number;
CREATE UNIQUE INDEX IF NOT EXISTS uq_personnel_contract_number_per_company
  ON public.personnel_contracts (
    COALESCE(my_company_id, '00000000-0000-0000-0000-000000000000'::uuid),
    lower(contract_number)
  );

CREATE INDEX IF NOT EXISTS idx_personnel_contracts_company
  ON public.personnel_contracts(my_company_id);

CREATE TABLE IF NOT EXISTS public.personnel_contract_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  personnel_contract_id uuid NOT NULL REFERENCES public.personnel_contracts(id) ON DELETE CASCADE,
  payment_date date NOT NULL,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  currency text NOT NULL DEFAULT 'PLN' CHECK (currency ~ '^[A-Z]{3}$'),
  payment_type text NOT NULL DEFAULT 'salary'
    CHECK (payment_type IN ('salary', 'advance', 'tax', 'zus', 'reimbursement', 'other')),
  recipient_name text NOT NULL,
  title text,
  notes text,
  bank_transaction_id uuid REFERENCES public.bank_transactions(id) ON DELETE SET NULL,
  created_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_personnel_contract_payments_contract
  ON public.personnel_contract_payments(personnel_contract_id, payment_date DESC);
CREATE INDEX IF NOT EXISTS idx_personnel_contract_payments_bank_transaction
  ON public.personnel_contract_payments(bank_transaction_id)
  WHERE bank_transaction_id IS NOT NULL;

ALTER TABLE public.personnel_contract_payments ENABLE ROW LEVEL SECURITY;

-- Rejestr wypłat dziedziczy obecną, kadrową granicę dostępu do umów.
-- Nie rozszerzamy widoczności danych płacowych na samo uprawnienie do faktur.
DROP POLICY IF EXISTS "Personnel contract payments are visible to authorized staff"
  ON public.personnel_contract_payments;
CREATE POLICY "Personnel contract payments are visible to authorized staff"
  ON public.personnel_contract_payments FOR SELECT TO authenticated
  USING (public.can_view_personnel_contracts());

DROP POLICY IF EXISTS "Personnel contract payments are managed by authorized staff"
  ON public.personnel_contract_payments;
CREATE POLICY "Personnel contract payments are managed by authorized staff"
  ON public.personnel_contract_payments FOR ALL TO authenticated
  USING (public.can_manage_personnel_contracts())
  WITH CHECK (public.can_manage_personnel_contracts());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.personnel_contract_payments TO authenticated;

DROP TRIGGER IF EXISTS personnel_contracts_set_updated_at ON public.personnel_contracts;
CREATE TRIGGER personnel_contracts_set_updated_at
BEFORE UPDATE ON public.personnel_contracts
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS personnel_contract_payments_set_updated_at ON public.personnel_contract_payments;
CREATE TRIGGER personnel_contract_payments_set_updated_at
BEFORE UPDATE ON public.personnel_contract_payments
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

COMMENT ON COLUMN public.personnel_contracts.party_name IS 'Trwała nazwa strony umowy, niezależna od opcjonalnego powiązania z CRM.';
COMMENT ON COLUMN public.personnel_contracts.party_identifier IS 'Opcjonalny PESEL, NIP lub inny identyfikator strony umowy.';
COMMENT ON TABLE public.personnel_contract_payments IS 'Wynagrodzenia, zaliczki, podatki, ZUS i inne obciążenia związane z umową personelu.';

NOTIFY pgrst, 'reload schema';

COMMIT;
