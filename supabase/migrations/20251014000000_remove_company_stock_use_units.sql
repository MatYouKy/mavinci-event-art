/*
  # Usunięcie pola company_stock_quantity - używaj equipment_units

  ## Opis zmian
  To pole było redundantne - stan magazynowy powinien być obliczany automatycznie
  na podstawie jednostek w tabeli `equipment_units`.

  ## Zmiany
  1. Usunięcie kolumny `company_stock_quantity` z tabeli `equipment_stock`
  2. Utworzenie widoku `equipment_stock_summary` który automatycznie liczy jednostki
  3. Widok pokazuje:
     - Całkowitą liczbę jednostek
     - Dostępne jednostki (available)
     - Jednostki w użyciu (in_use)
     - Zarezerwowane (reserved)
     - Uszkodzone (damaged)
     - W serwisie (in_service)

  ## Notatki
  - Stan magazynowy jest teraz zawsze dokładny i zgodny z rzeczywistością
  - Nie ma możliwości rozbieżności między stanem a jednostkami
  - UI powinien pobierać dane z widoku equipment_stock_summary
*/

-- Usuń kolumnę company_stock_quantity jeśli istnieje
ALTER TABLE equipment_stock
DROP COLUMN IF EXISTS company_stock_quantity;

-- Utwórz widok który automatycznie liczy jednostki dla każdego sprzętu
CREATE OR REPLACE VIEW equipment_stock_summary AS
SELECT
  es.equipment_id,
  es.total_quantity,
  es.available_quantity,
  es.reserved_quantity,
  es.in_use_quantity,
  es.min_stock_level,
  -- Liczba jednostek z equipment_units
  COALESCE(COUNT(eu.id), 0) AS total_units,
  COALESCE(SUM(CASE WHEN eu.status = 'available' THEN 1 ELSE 0 END), 0) AS available_units,
  COALESCE(SUM(CASE WHEN eu.status = 'in_use' THEN 1 ELSE 0 END), 0) AS in_use_units,
  COALESCE(SUM(CASE WHEN eu.status = 'reserved' THEN 1 ELSE 0 END), 0) AS reserved_units,
  COALESCE(SUM(CASE WHEN eu.status = 'damaged' THEN 1 ELSE 0 END), 0) AS damaged_units,
  COALESCE(SUM(CASE WHEN eu.status = 'in_service' THEN 1 ELSE 0 END), 0) AS in_service_units,
  -- Jednostki "na firmie" (available + damaged + in_service)
  COALESCE(SUM(CASE WHEN eu.status IN ('available', 'damaged', 'in_service') THEN 1 ELSE 0 END), 0) AS company_units
FROM
  equipment_stock es
  LEFT JOIN equipment_units eu ON eu.equipment_id = es.equipment_id
GROUP BY
  es.equipment_id,
  es.total_quantity,
  es.available_quantity,
  es.reserved_quantity,
  es.in_use_quantity,
  es.min_stock_level;

COMMENT ON VIEW equipment_stock_summary IS 'Widok łączący equipment_stock z rzeczywistą liczbą jednostek z equipment_units. Stan magazynowy jest obliczany automatycznie.';
