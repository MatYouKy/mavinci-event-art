-- Nullable parser facts, without changing amounts, allocations or bank sources.
BEGIN;
ALTER TABLE public.bank_transactions
  ADD COLUMN IF NOT EXISTS source_index integer,
  ADD COLUMN IF NOT EXISTS source_balance_before numeric(18,2),
  ADD COLUMN IF NOT EXISTS source_balance_after numeric(18,2),
  ADD COLUMN IF NOT EXISTS source_verified boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.bank_transactions.source_index IS 'Zero-based operation order inside the preserved original PDF or MT940.';
COMMENT ON COLUMN public.bank_transactions.source_balance_before IS 'Balance before this operation, as verified against the original statement.';
COMMENT ON COLUMN public.bank_transactions.source_balance_after IS 'Balance after this operation, as verified against the original statement.';
COMMENT ON COLUMN public.bank_transactions.source_verified IS 'Parser reconciled all source rows with opening and closing statement balances. Never inferred from amount/date alone.';
COMMIT;
