-- ============================================
-- CZYSZCZENIE I TESTOWANIE NOWEGO SYSTEMU ALERTÓW
-- ============================================
-- Ten plik można uruchomić po zastosowaniu FIX_ALERTS_AFTER_INSPECTION_V2.sql

-- Krok 1: Usuń wszystkie stare alerty ubezpieczeniowe
DELETE FROM vehicle_alerts
WHERE alert_type = 'insurance';

-- Krok 2: Ręcznie przelicz alerty dla wszystkich aktywnych polis
-- Trigger automatycznie to zrobi, wystarczy UPDATE
UPDATE insurance_policies
SET updated_at = now()
WHERE status IN ('active', 'expired');

-- Krok 3: Wyświetl podsumowanie alertów per pojazd i typ
SELECT
  v.registration_number,
  va.message,
  va.priority,
  va.due_date,
  va.created_at
FROM vehicle_alerts va
JOIN vehicles v ON v.id = va.vehicle_id
WHERE va.alert_type = 'insurance'
ORDER BY v.registration_number, va.due_date;

-- Krok 4: Sprawdź duplikaty (powinno być 0)
SELECT
  vehicle_id,
  LEFT(message, 10) as insurance_type,
  COUNT(*) as count
FROM vehicle_alerts
WHERE alert_type = 'insurance'
GROUP BY vehicle_id, LEFT(message, 10)
HAVING COUNT(*) > 1;
