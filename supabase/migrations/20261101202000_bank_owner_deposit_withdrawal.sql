-- Wyjaśnienia operacji bankowych: „Wpłata własna” i „Wypłata własna” (2026-11-01).
--
-- Wpłata gotówki we wpłatomacie (środki właściciela) nie miała właściwego rodzaju wyjaśnienia — „Inne wyjaśnienie”
-- zostawia operację do kontroli. Nowe rodzaje (kategoria own_transfer, bez dokumentu) zamykają operację jako
-- przeniesienie środków własnych, więc nie wraca na listę „do zrobienia”:
--   owner_deposit    — wpłata własnych środków właściciela (wpływ),
--   owner_withdrawal — wypłata środków na potrzeby własne właściciela (wydatek).
-- Plik można bezpiecznie uruchomić ponownie.
BEGIN;

ALTER TABLE public.bank_transactions DROP CONSTRAINT IF EXISTS bank_transactions_accounting_subtype_check;
ALTER TABLE public.bank_transactions ADD CONSTRAINT bank_transactions_accounting_subtype_check CHECK (
  accounting_subtype IS NULL OR accounting_subtype = ANY (ARRAY[
    'automatic_vat_transfer', 'vat7_payment', 'pit4_payment', 'zus_payment', 'payroll_payment', 'bank_fee',
    'own_transfer', 'cash_settlement', 'owner_deposit', 'owner_withdrawal', 'supplier_invoice_missing', 'other'
  ]::text[]));

COMMIT;
