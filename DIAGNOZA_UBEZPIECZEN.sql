-- ============================================
-- DIAGNOZA SYSTEMU UBEZPIECZEŃ
-- ============================================
-- Pomoże Ci zrozumieć dlaczego alert się pojawia lub nie

-- Krok 1: Pokaż wszystkie aktywne polisy OC dla Passata
SELECT
  ip.id,
  ip.policy_number as "Polisa",
  ip.start_date as "Od",
  ip.end_date as "Do",
  ip.status as "Status",
  (ip.end_date - CURRENT_DATE) as "Dni do końca",
  LEAD(ip.start_date) OVER (ORDER BY ip.end_date) as "Następna zaczyna",
  ip.end_date - LEAD(ip.start_date) OVER (ORDER BY ip.end_date) as "Luka (dni)"
FROM insurance_policies ip
JOIN vehicles v ON v.id = ip.vehicle_id
WHERE v.registration_number LIKE '%PASSAT%'
AND ip.type = 'oc'
AND ip.status IN ('active', 'expired')
ORDER BY ip.end_date;

-- Krok 2: Sprawdź czy jest ciągłość dla wygasającej polisy
-- Zmień policy_number na swoją wygasającą polisę
WITH expiring AS (
  SELECT *
  FROM insurance_policies
  WHERE policy_number = '4123' -- ZMIEŃ NA SWOJĄ!
),
next_policy AS (
  SELECT ip.*
  FROM insurance_policies ip, expiring e
  WHERE ip.vehicle_id = e.vehicle_id
  AND ip.type = e.type
  AND ip.status = 'active'
  AND ip.id != e.id
  AND ip.start_date <= e.end_date + INTERVAL '1 day'
  AND ip.end_date > e.end_date
  ORDER BY ip.start_date ASC, ip.end_date DESC
  LIMIT 1
)
SELECT
  'WYGASAJĄCA' as "Typ",
  e.policy_number as "Polisa",
  e.start_date as "Od",
  e.end_date as "Do",
  (e.end_date - CURRENT_DATE) as "Dni do końca",
  NULL::text as "Przejmuje?"
FROM expiring e
UNION ALL
SELECT
  'PRZEJMUJĄCA' as "Typ",
  np.policy_number,
  np.start_date,
  np.end_date,
  (np.end_date - CURRENT_DATE),
  '✓ TAK' as "Przejmuje?"
FROM next_policy np;

-- Krok 3: Pokaż wszystkie alerty dla Passata
SELECT
  v.registration_number as "Pojazd",
  va.title as "Tytuł",
  va.message as "Wiadomość",
  va.priority as "Priorytet",
  va.due_date as "Data",
  va.created_at as "Utworzony"
FROM vehicle_alerts va
JOIN vehicles v ON v.id = va.vehicle_id
WHERE v.registration_number LIKE '%PASSAT%'
AND va.alert_type = 'insurance'
ORDER BY va.created_at DESC;

-- Krok 4: Symuluj trigger dla Passata (test)
-- Ten query pokaże co trigger "widzi"
DO $$
DECLARE
  v_id uuid;
  expiring_policy RECORD;
  next_policy RECORD;
BEGIN
  -- Znajdź ID Passata
  SELECT id INTO v_id FROM vehicles WHERE registration_number LIKE '%PASSAT%' LIMIT 1;

  RAISE NOTICE 'Vehicle ID: %', v_id;

  -- Znajdź wygasającą polisę OC
  SELECT id, policy_number, end_date, start_date, type, status
  INTO expiring_policy
  FROM insurance_policies
  WHERE vehicle_id = v_id
  AND type = 'oc'
  AND status IN ('active', 'expired')
  AND end_date >= CURRENT_DATE - INTERVAL '30 days'
  ORDER BY end_date ASC, created_at ASC
  LIMIT 1;

  IF expiring_policy.id IS NOT NULL THEN
    RAISE NOTICE 'Wygasająca polisa: % (koniec: %, za % dni)',
      expiring_policy.policy_number,
      expiring_policy.end_date,
      (expiring_policy.end_date - CURRENT_DATE);

    -- Sprawdź czy jest przejmująca
    SELECT id, policy_number, start_date, end_date
    INTO next_policy
    FROM insurance_policies
    WHERE vehicle_id = v_id
    AND type = 'oc'
    AND status = 'active'
    AND id != expiring_policy.id
    AND start_date <= expiring_policy.end_date + INTERVAL '1 day'
    AND end_date > expiring_policy.end_date
    ORDER BY start_date ASC, end_date DESC
    LIMIT 1;

    IF next_policy.id IS NOT NULL THEN
      RAISE NOTICE 'PRZEJMUJĄCA: % (start: %, koniec: %)',
        next_policy.policy_number,
        next_policy.start_date,
        next_policy.end_date;
      RAISE NOTICE '✓ JEST CIĄGŁOŚĆ - BRAK ALERTU';
    ELSE
      RAISE NOTICE '✗ BRAK PRZEJMUJĄCEJ - BĘDZIE ALERT!';
    END IF;
  ELSE
    RAISE NOTICE 'Brak wygasającej polisy OC';
  END IF;
END $$;
