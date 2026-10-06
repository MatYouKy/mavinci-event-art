BEGIN;

-- amount pozostaje kwotą faktycznie należną odbiorcy przelewu.
-- Nie przeliczamy historycznych wynagrodzeń i nie zgadujemy ich kwoty netto.
ALTER TABLE public.personnel_contract_payments
  ADD COLUMN IF NOT EXISTS payroll_total_amount numeric(14,2),
  ADD COLUMN IF NOT EXISTS payroll_net_confirmed boolean NOT NULL DEFAULT false;

ALTER TABLE public.personnel_contract_payments
  ADD CONSTRAINT personnel_payment_payroll_total_check CHECK (
    payroll_total_amount IS NULL
    OR (payment_type = 'salary' AND payroll_total_amount >= amount)
  );

COMMENT ON COLUMN public.personnel_contract_payments.amount IS
  'Kwota do wypłaty odbiorcy i dopasowania z wyciągiem. Dla wynagrodzenia: netto na konto, nie brutto umowy.';
COMMENT ON COLUMN public.personnel_contract_payments.payroll_total_amount IS
  'Opcjonalna kwota źródłowego rozliczenia wynagrodzenia. Różnica względem amount nie określa automatycznie podziału na PIT, ZUS ani koszt pracodawcy.';
COMMENT ON COLUMN public.personnel_contract_payments.payroll_net_confirmed IS
  'Użytkownik potwierdził, że amount wynagrodzenia jest kwotą netto należną na konto. Historyczne wpisy wymagają sprawdzenia przed nowym dopasowaniem.';

CREATE OR REPLACE FUNCTION public.guard_personnel_salary_net_amount()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.bank_transaction_id IS NOT NULL
    AND NEW.bank_transaction_id IS NOT NULL
    AND (
      NEW.amount IS DISTINCT FROM OLD.amount
      OR NEW.currency IS DISTINCT FROM OLD.currency
      OR NEW.payment_type IS DISTINCT FROM OLD.payment_type
    )
  THEN
    RAISE EXCEPTION 'Najpierw usuń dopasowanie bankowe, aby zmienić kwotę, walutę lub rodzaj wypłaty.';
  END IF;

  -- Istniejące powiązania pozostają nietknięte. Nowe powiązanie lub jego
  -- przeniesienie wymaga potwierdzenia netto również przy bezpośrednim UPDATE.
  IF NEW.payment_type = 'salary' AND NOT NEW.payroll_net_confirmed
    AND NEW.bank_transaction_id IS NOT NULL
  THEN
    IF TG_OP = 'INSERT' THEN
      RAISE EXCEPTION 'Potwierdź kwotę netto na konto w rozliczeniu umowy przed dopasowaniem wynagrodzenia.';
    ELSIF NEW.bank_transaction_id IS DISTINCT FROM OLD.bank_transaction_id THEN
      RAISE EXCEPTION 'Potwierdź kwotę netto na konto w rozliczeniu umowy przed dopasowaniem wynagrodzenia.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER guard_personnel_salary_net_amount_trigger
BEFORE INSERT OR UPDATE ON public.personnel_contract_payments
FOR EACH ROW EXECUTE FUNCTION public.guard_personnel_salary_net_amount();

REVOKE ALL ON FUNCTION public.guard_personnel_salary_net_amount() FROM PUBLIC;

NOTIFY pgrst, 'reload schema';
COMMIT;
