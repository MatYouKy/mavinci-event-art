ALTER TABLE public.events
ADD COLUMN IF NOT EXISTS purchase_order_number text;

COMMENT ON COLUMN public.events.purchase_order_number IS
  'Opcjonalny numer PO lub zamówienia klienta dla konkretnego wydarzenia.';
