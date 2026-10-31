BEGIN;

-- Optional user-entered bank evidence. Invoice totals and paid_amount remain
-- in the document currency; this field is not an FX conversion or allocation.
ALTER TABLE public.external_invoices
  ADD COLUMN IF NOT EXISTS bank_debit_amount_pln numeric(15,2);

ALTER TABLE public.external_invoices
  ADD CONSTRAINT external_invoices_bank_debit_amount_pln_check
  CHECK (bank_debit_amount_pln IS NULL OR (
    bank_debit_amount_pln > 0 AND bank_debit_amount_pln < 10000000000000
  ));

COMMENT ON COLUMN public.external_invoices.bank_debit_amount_pln IS
  'Optional manually entered total PLN debited from the bank account for this document so far. Separate from invoice-currency totals, paid_amount, tax FX rates and confirmed bank matches; never copied or inferred from an invoice scan.';

COMMIT;
