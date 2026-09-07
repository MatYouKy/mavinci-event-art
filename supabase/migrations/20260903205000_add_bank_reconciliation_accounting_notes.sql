/* Opisy księgowe płatności oraz dokumentów używane podczas uzgodnienia. */

ALTER TABLE public.bank_transactions
  ADD COLUMN IF NOT EXISTS accounting_note text,
  ADD COLUMN IF NOT EXISTS accounting_category text NOT NULL DEFAULT 'other',
  ADD COLUMN IF NOT EXISTS accounting_review_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS accounting_reviewed_at timestamptz;

ALTER TABLE public.bank_transactions DROP CONSTRAINT IF EXISTS bank_transactions_accounting_category_check;
ALTER TABLE public.bank_transactions ADD CONSTRAINT bank_transactions_accounting_category_check
CHECK (accounting_category IN ('bank_fee', 'tax_or_zus', 'payroll', 'own_transfer', 'cash', 'foreign_purchase', 'other'));

ALTER TABLE public.bank_transactions DROP CONSTRAINT IF EXISTS bank_transactions_accounting_review_status_check;
ALTER TABLE public.bank_transactions ADD CONSTRAINT bank_transactions_accounting_review_status_check
CHECK (accounting_review_status IN ('pending', 'explained'));

ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS accounting_note text;
ALTER TABLE public.ksef_invoices ADD COLUMN IF NOT EXISTS accounting_note text;
ALTER TABLE public.external_invoices ADD COLUMN IF NOT EXISTS accounting_note text;

COMMENT ON COLUMN public.bank_transactions.accounting_note IS 'Ręczne wyjaśnienie księgowe płatności, niezależne od tytułu operacji bankowej.';
COMMENT ON COLUMN public.bank_transactions.accounting_review_status IS 'Status ręcznej kontroli pozycji, która może nie wymagać faktury.';
COMMENT ON COLUMN public.invoices.accounting_note IS 'Notatka pomocnicza do uzgodnienia dokumentu CRM.';
COMMENT ON COLUMN public.ksef_invoices.accounting_note IS 'Notatka pomocnicza do uzgodnienia dokumentu KSeF.';
COMMENT ON COLUMN public.external_invoices.accounting_note IS 'Notatka pomocnicza do uzgodnienia dokumentu spoza KSeF.';
