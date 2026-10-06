/*
  # Prowizje osobowe i rzeczywisty koszt gotówki

  Zachowawczo rozszerza istniejący rejestr event_commissions:
  - nie zmienia historycznych wpisów ani ich polityk dostępu,
  - beneficjent może być powiązany z pracownikiem albo kontaktem,
  - nowa prowizja zapisuje podstawę netto i sposób wypłaty,
  - koszt wypłaty gotówkowej może uwzględniać podatek od dywidendy.
*/

ALTER TABLE public.event_commissions
  ADD COLUMN IF NOT EXISTS contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS base_description text,
  ADD COLUMN IF NOT EXISTS payment_method text NOT NULL DEFAULT 'invoice',
  ADD COLUMN IF NOT EXISTS dividend_tax_rate numeric(5,2) NOT NULL DEFAULT 19,
  ADD COLUMN IF NOT EXISTS company_cost_amount numeric(14,2),
  ADD COLUMN IF NOT EXISTS due_date date,
  ADD COLUMN IF NOT EXISTS paid_at timestamptz;

ALTER TABLE public.event_commissions
  DROP CONSTRAINT IF EXISTS event_commissions_payment_method_check;

ALTER TABLE public.event_commissions
  ADD CONSTRAINT event_commissions_payment_method_check
  CHECK (payment_method IN ('cash_dividend', 'invoice', 'payroll', 'other'));

ALTER TABLE public.event_commissions
  DROP CONSTRAINT IF EXISTS event_commissions_dividend_tax_rate_check;

ALTER TABLE public.event_commissions
  ADD CONSTRAINT event_commissions_dividend_tax_rate_check
  CHECK (dividend_tax_rate >= 0 AND dividend_tax_rate < 100);

CREATE INDEX IF NOT EXISTS idx_event_commissions_employee
  ON public.event_commissions(employee_id, status)
  WHERE employee_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_event_commissions_contact
  ON public.event_commissions(contact_id, status)
  WHERE contact_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_event_commissions_organization
  ON public.event_commissions(organization_id, status)
  WHERE organization_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.calculate_event_commission_cost()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.calculation_type = 'percent' THEN
    NEW.amount := ROUND(
      COALESCE(NEW.base_amount, 0) * COALESCE(NEW.rate, 0) / 100,
      2
    );
  ELSE
    NEW.amount := ROUND(COALESCE(NEW.amount, 0), 2);
  END IF;

  IF NEW.payment_method = 'cash_dividend' THEN
    NEW.company_cost_amount := ROUND(
      NEW.amount / (1 - COALESCE(NEW.dividend_tax_rate, 19) / 100),
      2
    );
  ELSE
    NEW.company_cost_amount := NEW.amount;
  END IF;

  IF NEW.status = 'paid' AND NEW.paid_at IS NULL THEN
    NEW.paid_at := now();
  ELSIF NEW.status <> 'paid' THEN
    NEW.paid_at := NULL;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_calculate_event_commission_cost
  ON public.event_commissions;

CREATE TRIGGER trg_calculate_event_commission_cost
BEFORE INSERT OR UPDATE OF
  calculation_type,
  rate,
  base_amount,
  amount,
  payment_method,
  dividend_tax_rate,
  status
ON public.event_commissions
FOR EACH ROW
EXECUTE FUNCTION public.calculate_event_commission_cost();

COMMENT ON COLUMN public.event_commissions.amount IS
  'Kwota nominalnie należna beneficjentowi.';
COMMENT ON COLUMN public.event_commissions.company_cost_amount IS
  'Koszt ekonomiczny dla spółki. Dla starszych wpisów NULL oznacza koszt równy kwocie nominalnej.';
COMMENT ON COLUMN public.event_commissions.dividend_tax_rate IS
  'Stawka modelowa dla wypłaty cash_dividend; domyślnie 19%.';

NOTIFY pgrst, 'reload schema';
