-- ============================================
-- TEST TRIGGERA UBEZPIECZEŃ V4 FINAL
-- ============================================
-- Ten skrypt pomoże Ci zrozumieć jak działa trigger

-- Krok 1: Pokaż wszystkie polisy OC dla pojazdu
-- ZMIEŃ 'PASSAT' na swoją rejestrację
SELECT
  v.registration_number as "Pojazd",
  ip.policy_number as "Nr polisy",
  ip.start_date as "Od",
  ip.end_date as "Do",
  (ip.end_date - CURRENT_DATE) as "Dni do końca",
  ip.status as "Status",
  ip.id as "ID"
FROM insurance_policies ip
JOIN vehicles v ON v.id = ip.vehicle_id
WHERE v.registration_number LIKE '%PASSAT%'
AND ip.type = 'oc'
ORDER BY ip.end_date ASC;

-- Krok 2: Symulacja logiki triggera dla konkretnego pojazdu
DO $$
DECLARE
  v_vehicle_id uuid;
  v_type text := 'oc';
  alert_policy RECORD;
  days_until_expiry integer;
  gap_found boolean := false;
  current_coverage_end date := NULL;
BEGIN
  -- Znajdź ID pojazdu (ZMIEŃ PASSAT na swoje)
  SELECT id INTO v_vehicle_id
  FROM vehicles
  WHERE registration_number LIKE '%PASSAT%'
  LIMIT 1;

  RAISE NOTICE '========================================';
  RAISE NOTICE 'SYMULACJA TRIGGERA dla vehicle_id: %', v_vehicle_id;
  RAISE NOTICE '========================================';

  -- Iteruj przez polisy jak robi to trigger
  FOR alert_policy IN
    SELECT id, policy_number, start_date, end_date, type, status
    FROM insurance_policies
    WHERE vehicle_id = v_vehicle_id
    AND type = v_type
    AND status IN ('active', 'expired')
    ORDER BY end_date ASC
  LOOP
    RAISE NOTICE '';
    RAISE NOTICE '--- Sprawdzam polisę: % ---', alert_policy.policy_number;
    RAISE NOTICE 'Data końca: %', alert_policy.end_date;
    RAISE NOTICE 'Dni do końca: %', (alert_policy.end_date - CURRENT_DATE);

    IF current_coverage_end IS NULL THEN
      current_coverage_end := alert_policy.end_date;
      days_until_expiry := alert_policy.end_date - CURRENT_DATE;

      RAISE NOTICE 'To jest pierwsza polisa (najwcześniej się kończy)';

      -- Sprawdź czy jest następna
      IF EXISTS (
        SELECT 1 FROM insurance_policies
        WHERE vehicle_id = v_vehicle_id
        AND type = v_type
        AND status = 'active'
        AND id != alert_policy.id
        AND start_date <= alert_policy.end_date + INTERVAL '1 day'
        AND end_date > alert_policy.end_date
      ) THEN
        RAISE NOTICE '✓ Jest polisa przejmująca - BRAK ALERTU';
        gap_found := false;
      ELSE
        RAISE NOTICE '✗ Brak polisy przejmującej!';

        IF days_until_expiry <= 21 AND alert_policy.status != 'cancelled' THEN
          RAISE NOTICE '✗ Wygasa w ciągu 21 dni (%) - BĘDZIE ALERT!', days_until_expiry;
          gap_found := true;
        ELSE
          RAISE NOTICE '✓ Wygasa za więcej niż 21 dni (%) - brak alertu', days_until_expiry;
          gap_found := false;
        END IF;
      END IF;

      EXIT; -- Sprawdzamy tylko pierwszą (najwcześniej kończącą się)
    END IF;
  END LOOP;

  RAISE NOTICE '';
  RAISE NOTICE '========================================';
  IF gap_found THEN
    RAISE NOTICE 'WYNIK: ALERT ZOSTANIE UTWORZONY';
    RAISE NOTICE 'Polisa: % kończy się %', alert_policy.policy_number, alert_policy.end_date;
  ELSE
    RAISE NOTICE 'WYNIK: BRAK ALERTU (jest ciągłość ochrony)';
  END IF;
  RAISE NOTICE '========================================';
END $$;

-- Krok 3: Pokaż aktualne alerty
SELECT
  v.registration_number as "Pojazd",
  va.title as "Tytuł",
  va.message as "Wiadomość",
  va.priority as "Priorytet",
  va.created_at as "Utworzony"
FROM vehicle_alerts va
JOIN vehicles v ON v.id = va.vehicle_id
WHERE v.registration_number LIKE '%PASSAT%'
AND va.alert_type = 'insurance'
ORDER BY va.created_at DESC;

-- Krok 4: Test manualny - wymuś ponowne uruchomienie triggera
-- UWAGA: To zaktualizuje polisę i wywoła trigger!
-- Odkomentuj i uruchom jeśli chcesz przetestować:

/*
UPDATE insurance_policies
SET updated_at = now()
WHERE vehicle_id = (
  SELECT id FROM vehicles WHERE registration_number LIKE '%PASSAT%' LIMIT 1
)
AND type = 'oc';
*/

-- Krok 5: Szczegółowa analiza ciągłości
WITH policies AS (
  SELECT
    v.registration_number,
    ip.policy_number,
    ip.start_date,
    ip.end_date,
    ip.status,
    (ip.end_date - CURRENT_DATE) as days_left,
    LAG(ip.end_date) OVER (ORDER BY ip.end_date) as prev_end,
    LEAD(ip.start_date) OVER (ORDER BY ip.end_date) as next_start,
    ip.start_date - LAG(ip.end_date) OVER (ORDER BY ip.end_date) as gap_before
  FROM insurance_policies ip
  JOIN vehicles v ON v.id = ip.vehicle_id
  WHERE v.registration_number LIKE '%PASSAT%'
  AND ip.type = 'oc'
  AND ip.status IN ('active', 'expired')
)
SELECT
  registration_number as "Pojazd",
  policy_number as "Polisa",
  start_date as "Od",
  end_date as "Do",
  days_left as "Dni do końca",
  prev_end as "Poprzednia kończy",
  next_start as "Następna zaczyna",
  CASE
    WHEN gap_before IS NULL THEN 'Pierwsza'
    WHEN gap_before <= 1 THEN '✓ Ciągłość'
    ELSE '✗ Luka ' || gap_before || ' dni'
  END as "Status ciągłości"
FROM policies
ORDER BY end_date;
