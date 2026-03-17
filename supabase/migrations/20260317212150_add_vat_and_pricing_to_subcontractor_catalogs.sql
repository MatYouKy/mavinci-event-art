/*
  # Dodanie pól VAT i cen netto/brutto do katalogów podwykonawców

  1. Zmiany w tabelach
    - Dodanie pól vat_rate, price_net, price_gross do subcontractor_service_catalog
    - Dodanie pól vat_rate, price_net, price_gross do subcontractor_rental_equipment
    - Dodanie pola is_vat_exempt do subcontractors (informacja czy podwykonawca zwolniony z VAT)

  2. Uwagi
    - price_net - cena netto (podstawa)
    - price_gross - cena brutto (z VAT)
    - vat_rate - stawka VAT w % (0, 5, 8, 23)
    - Niektórzy podwykonawcy są zwolnieni z VAT więc gross = net
*/

-- Dodaj pole is_vat_exempt do podwykonawców
ALTER TABLE subcontractors
ADD COLUMN IF NOT EXISTS is_vat_exempt boolean DEFAULT false;

-- Dodaj pola VAT do subcontractor_service_catalog
ALTER TABLE subcontractor_service_catalog
ADD COLUMN IF NOT EXISTS vat_rate numeric(5,2) DEFAULT 23.00,
ADD COLUMN IF NOT EXISTS price_net numeric(10,2),
ADD COLUMN IF NOT EXISTS price_gross numeric(10,2);

-- Zmigruj istniejące dane (unit_price traktuj jako brutto)
UPDATE subcontractor_service_catalog
SET
  price_gross = unit_price,
  price_net = ROUND(unit_price / 1.23, 2)
WHERE unit_price IS NOT NULL AND price_gross IS NULL;

-- Dodaj pola VAT do subcontractor_rental_equipment
ALTER TABLE subcontractor_rental_equipment
ADD COLUMN IF NOT EXISTS vat_rate numeric(5,2) DEFAULT 23.00,
ADD COLUMN IF NOT EXISTS daily_price_net numeric(10,2),
ADD COLUMN IF NOT EXISTS daily_price_gross numeric(10,2),
ADD COLUMN IF NOT EXISTS weekly_price_net numeric(10,2),
ADD COLUMN IF NOT EXISTS weekly_price_gross numeric(10,2),
ADD COLUMN IF NOT EXISTS monthly_price_net numeric(10,2),
ADD COLUMN IF NOT EXISTS monthly_price_gross numeric(10,2);

-- Zmigruj istniejące dane rental equipment (daily_rental_price jako brutto)
UPDATE subcontractor_rental_equipment
SET
  daily_price_gross = daily_rental_price,
  daily_price_net = ROUND(daily_rental_price / 1.23, 2),
  weekly_price_gross = weekly_rental_price,
  weekly_price_net = ROUND(weekly_rental_price / 1.23, 2),
  monthly_price_gross = monthly_rental_price,
  monthly_price_net = ROUND(monthly_rental_price / 1.23, 2)
WHERE daily_rental_price IS NOT NULL AND daily_price_gross IS NULL;

-- Dodaj komentarze
COMMENT ON COLUMN subcontractor_service_catalog.vat_rate IS 'Stawka VAT w % (0, 5, 8, 23)';
COMMENT ON COLUMN subcontractor_service_catalog.price_net IS 'Cena netto (podstawa opodatkowania)';
COMMENT ON COLUMN subcontractor_service_catalog.price_gross IS 'Cena brutto (z VAT)';

COMMENT ON COLUMN subcontractor_rental_equipment.vat_rate IS 'Stawka VAT w % (0, 5, 8, 23)';
COMMENT ON COLUMN subcontractor_rental_equipment.daily_price_net IS 'Cena dzienna netto';
COMMENT ON COLUMN subcontractor_rental_equipment.daily_price_gross IS 'Cena dzienna brutto';
