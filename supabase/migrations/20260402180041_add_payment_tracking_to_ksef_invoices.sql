/*
  # Dodanie śledzenia płatności do faktur KSeF

  1. Zmiany w tabeli ksef_invoices
    - Dodanie kolumny `payment_due_date` (date, termin płatności)
    - Dodanie kolumny `payment_status` (enum: paid, unpaid, overdue)
    - Dodanie kolumny `payment_date` (timestamptz, data faktycznej płatności)
    - Dodanie kolumn seller_nip, buyer_nip, seller_address, buyer_address
    - Dodanie indeksów dla wydajności

  2. Funkcje pomocnicze
    - Automatyczna aktualizacja statusu płatności na overdue gdy minie termin

  3. Security
    - RLS nie zmienia się - działa na podstawie istniejących polityk
*/

-- Dodanie kolumn dla szczegółów kontrahentów
ALTER TABLE ksef_invoices
ADD COLUMN IF NOT EXISTS seller_nip text,
ADD COLUMN IF NOT EXISTS buyer_nip text,
ADD COLUMN IF NOT EXISTS seller_address text,
ADD COLUMN IF NOT EXISTS buyer_address text;

-- Dodanie kolumn dla śledzenia płatności
ALTER TABLE ksef_invoices
ADD COLUMN IF NOT EXISTS payment_due_date date,
ADD COLUMN IF NOT EXISTS payment_status text DEFAULT 'unpaid' CHECK (payment_status IN ('paid', 'unpaid', 'overdue')),
ADD COLUMN IF NOT EXISTS payment_date timestamptz;

-- Indeksy dla wydajności
CREATE INDEX IF NOT EXISTS idx_ksef_invoices_payment_status ON ksef_invoices(payment_status);
CREATE INDEX IF NOT EXISTS idx_ksef_invoices_payment_due_date ON ksef_invoices(payment_due_date) WHERE payment_status != 'paid';
CREATE INDEX IF NOT EXISTS idx_ksef_invoices_seller_nip ON ksef_invoices(seller_nip);
CREATE INDEX IF NOT EXISTS idx_ksef_invoices_buyer_nip ON ksef_invoices(buyer_nip);

-- Funkcja do automatycznej aktualizacji statusu płatności na overdue
CREATE OR REPLACE FUNCTION update_overdue_invoices()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE ksef_invoices
  SET payment_status = 'overdue'
  WHERE payment_status = 'unpaid'
    AND payment_due_date < CURRENT_DATE
    AND payment_due_date IS NOT NULL;
END;
$$;

-- Komentarze
COMMENT ON COLUMN ksef_invoices.payment_due_date IS 'Termin płatności faktury';
COMMENT ON COLUMN ksef_invoices.payment_status IS 'Status płatności: paid (opłacona), unpaid (nieopłacona), overdue (po terminie)';
COMMENT ON COLUMN ksef_invoices.payment_date IS 'Data faktycznej płatności faktury';
COMMENT ON COLUMN ksef_invoices.seller_nip IS 'NIP sprzedawcy';
COMMENT ON COLUMN ksef_invoices.buyer_nip IS 'NIP nabywcy';
