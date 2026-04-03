/*
  # Dodanie formy płatności do faktur KSeF

  1. Zmiany
    - Dodanie kolumny `payment_method` (text, forma płatności z XML FA(2))
    - Dodanie kolumny `payment_due_date` (date, termin płatności)
    - Dodanie kolumny `payment_date` (date, data zapłaty jeśli podana w XML)
    - Dodanie kolumny `bank_account_number` (text, numer rachunku bankowego)
    - Dodanie indeksów dla wydajności

  2. Kody form płatności (FA(2))
    - '1' - Gotówka
    - '2' - Karta płatnicza
    - '3' - Bon/Kupon
    - '4' - Czek
    - '5' - Kredyt kupiecki
    - '6' - Przelew
    - '7' - Inne (kompensata, potrącenie)

  3. Security
    - RLS nie zmienia się - działa na podstawie istniejących polityk
*/

-- Dodanie kolumn dla metadanych płatności
ALTER TABLE ksef_invoices
ADD COLUMN IF NOT EXISTS payment_method text,
ADD COLUMN IF NOT EXISTS payment_due_date date,
ADD COLUMN IF NOT EXISTS payment_date date,
ADD COLUMN IF NOT EXISTS bank_account_number text;

-- Indeksy dla wydajności
CREATE INDEX IF NOT EXISTS idx_ksef_invoices_payment_method ON ksef_invoices(payment_method);
CREATE INDEX IF NOT EXISTS idx_ksef_invoices_payment_due_date ON ksef_invoices(payment_due_date);

-- Komentarze
COMMENT ON COLUMN ksef_invoices.payment_method IS 'Forma płatności: 1-gotówka, 2-karta, 3-bon, 4-czek, 5-kredyt, 6-przelew, 7-inne';
COMMENT ON COLUMN ksef_invoices.payment_due_date IS 'Termin płatności z faktury';
COMMENT ON COLUMN ksef_invoices.payment_date IS 'Data zapłaty jeśli była podana w XML';
COMMENT ON COLUMN ksef_invoices.bank_account_number IS 'Numer rachunku bankowego z faktury';
