/*
  # Dodanie stawki VAT i pozycji faktury do KSeF

  1. Zmiany
    - Dodanie kolumny `vat_rate` (text, główna stawka VAT na fakturze np. "23%", "0%", "zw")
    - Dodanie kolumny `invoice_items` (jsonb[], pozycje faktury z XML)
    - Dodanie indeksu dla wydajności

  2. Security
    - RLS nie zmienia się - działa na podstawie istniejących polityk
*/

-- Dodanie kolumny dla stawki VAT
ALTER TABLE ksef_invoices
ADD COLUMN IF NOT EXISTS vat_rate text,
ADD COLUMN IF NOT EXISTS invoice_items jsonb;

-- Indeks dla wydajności
CREATE INDEX IF NOT EXISTS idx_ksef_invoices_vat_rate ON ksef_invoices(vat_rate);

-- Komentarze
COMMENT ON COLUMN ksef_invoices.vat_rate IS 'Główna stawka VAT na fakturze (np. "23%", "8%", "0%", "zw")';
COMMENT ON COLUMN ksef_invoices.invoice_items IS 'Pozycje faktury jako tablica obiektów JSON';
