-- ============================================
-- NAPRAWA V4: System alertów z ciągłością ochrony
-- ============================================
-- WYMAGANIA: Musisz mieć zastosowane te migracje:
--   - 20251021240000_create_vehicle_alerts.sql (tabela vehicle_alerts)
--   - 20251021220000_create_periodic_inspections.sql (tabela periodic_inspections)
--   - 20251021210000_add_insurance_details.sql (tabela insurance_policies)

-- Sprawdź czy wymagane tabele istnieją
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'vehicle_alerts') THEN
    RAISE EXCEPTION 'Tabela vehicle_alerts nie istnieje! Uruchom najpierw migrację 20251021240000_create_vehicle_alerts.sql';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'periodic_inspections') THEN
    RAISE EXCEPTION 'Tabela periodic_inspections nie istnieje! Uruchom najpierw migrację floty.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'insurance_policies') THEN
    RAISE EXCEPTION 'Tabela insurance_policies nie istnieje! Uruchom najpierw migrację floty.';
  END IF;

  RAISE NOTICE 'Wszystkie wymagane tabele istnieją - kontynuuję...';
END $$;

-- Usuń stary trigger
DROP TRIGGER IF EXISTS trigger_create_inspection_alert ON periodic_inspections;

-- Funkcja tworząca alert TYLKO dla NAJNOWSZEJ kontroli
CREATE OR REPLACE FUNCTION create_inspection_alert()
RETURNS TRIGGER AS $$
DECLARE
  latest_inspection_id uuid;
  latest_valid_until date;
  latest_inspection_type text;
BEGIN
  -- Znajdź NAJNOWSZĄ kontrolę dla tego pojazdu
  SELECT id, valid_until, inspection_type
  INTO latest_inspection_id, latest_valid_until, latest_inspection_type
  FROM periodic_inspections
  WHERE vehicle_id = NEW.vehicle_id
  ORDER BY inspection_date DESC, created_at DESC
  LIMIT 1;

  -- Usuń WSZYSTKIE alerty o przeglądzie dla tego pojazdu
  DELETE FROM vehicle_alerts
  WHERE vehicle_id = NEW.vehicle_id
  AND alert_type = 'inspection';

  -- Utwórz alert TYLKO jeśli ta kontrola jest najnowsza I wygasa w ciągu 30 dni
  IF latest_inspection_id = NEW.id AND latest_valid_until <= CURRENT_DATE + INTERVAL '30 days' THEN
    INSERT INTO vehicle_alerts (
      vehicle_id,
      alert_type,
      priority,
      title,
      message,
      icon,
      is_blocking,
      due_date,
      related_id,
      is_active
    )
    VALUES (
      NEW.vehicle_id,
      'inspection',
      CASE
        WHEN latest_valid_until < CURRENT_DATE THEN 'critical'
        WHEN latest_valid_until <= CURRENT_DATE + INTERVAL '7 days' THEN 'high'
        WHEN latest_valid_until <= CURRENT_DATE + INTERVAL '30 days' THEN 'medium'
        ELSE 'low'
      END,
      CASE
        WHEN latest_inspection_type = 'technical_inspection' THEN
          CASE WHEN latest_valid_until < CURRENT_DATE THEN 'Zbliżający się przegląd' ELSE 'Zbliżający się przegląd' END
        ELSE
          CASE WHEN latest_valid_until < CURRENT_DATE THEN 'Zbliżający się przegląd' ELSE 'Zbliżający się przegląd' END
      END,
      'Przegląd ' ||
      CASE WHEN latest_inspection_type = 'technical_inspection' THEN 'okresowy' ELSE 'okresowy' END ||
      ' - za ' || (latest_valid_until - CURRENT_DATE) || ' dni (' || to_char(latest_valid_until, 'DD.MM.YYYY') || ')',
      'FileText',
      latest_valid_until < CURRENT_DATE,
      latest_valid_until,
      latest_inspection_id,
      true
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger uruchamiający funkcję TYLKO po INSERT (nie UPDATE)
CREATE TRIGGER trigger_create_inspection_alert
  AFTER INSERT ON periodic_inspections
  FOR EACH ROW
  EXECUTE FUNCTION create_inspection_alert();

-- Włącz realtime dla vehicle_alerts (jeśli nie było)
-- Sprawdź najpierw czy tabela istnieje
DO $$
BEGIN
  -- Jeśli tabela nie istnieje, pomiń ten krok
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public'
    AND table_name = 'vehicle_alerts'
  ) THEN
    RAISE NOTICE 'Tabela vehicle_alerts nie istnieje - uruchom najpierw migrację 20251021240000_create_vehicle_alerts.sql';
    RETURN;
  END IF;

  -- Dodaj do realtime jeśli nie jest już dodana
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE vehicle_alerts;
    RAISE NOTICE 'Dodano vehicle_alerts do realtime';
  EXCEPTION
    WHEN duplicate_object THEN
      RAISE NOTICE 'vehicle_alerts już jest w realtime';
    WHEN undefined_table THEN
      RAISE NOTICE 'Tabela vehicle_alerts nie istnieje';
  END;
END $$;

-- Wyczyść duplikaty alertów
WITH ranked_alerts AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY vehicle_id, alert_type
           ORDER BY created_at DESC
         ) as rn
  FROM vehicle_alerts
  WHERE alert_type = 'inspection'
)
DELETE FROM vehicle_alerts
WHERE id IN (
  SELECT id FROM ranked_alerts WHERE rn > 1
);

-- ============================================
-- ALERTY DLA UBEZPIECZEŃ - SYSTEM INTELIGENTNY PER TYP
-- ============================================
-- Alert pojawia się 21 dni przed końcem każdego typu osobno (OC, AC, NNW)
-- Dodanie nowego ubezpieczenia tego samego typu usuwa stary alert

-- Usuń stare triggery
DROP TRIGGER IF EXISTS trigger_create_insurance_alert ON insurance_policies;

-- Funkcja zarządzająca alertami ubezpieczeń PER TYP
CREATE OR REPLACE FUNCTION manage_insurance_alerts()
RETURNS TRIGGER AS $$
DECLARE
  v_vehicle_id uuid;
  v_type text;
  current_coverage_end date;
  gap_found boolean;
  alert_policy RECORD;
  days_until_expiry integer;
BEGIN
  -- Określ vehicle_id i type z triggera
  v_vehicle_id := COALESCE(NEW.vehicle_id, OLD.vehicle_id);
  v_type := COALESCE(NEW.type, OLD.type);

  -- Usuń wszystkie alerty tego typu dla tego pojazdu
  DELETE FROM vehicle_alerts
  WHERE vehicle_id = v_vehicle_id
  AND alert_type = 'insurance'
  AND message LIKE UPPER(v_type) || '%';

  -- Jeśli operacja to DELETE, zakończ tutaj (alert już usunięty)
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  -- KLUCZOWA LOGIKA: Sprawdź ciągłość pokrycia
  -- 1. Weź wszystkie aktywne polisy tego typu, posortowane po end_date
  -- 2. Sprawdź czy jest luka w pokryciu
  -- 3. Jeśli TAK - stwórz alert dla polisy przed luką

  current_coverage_end := NULL;
  gap_found := false;
  alert_policy := NULL;

  -- Iteruj przez wszystkie polisy w kolejności chronologicznej (po end_date)
  FOR alert_policy IN
    SELECT id, start_date, end_date, type, status, policy_number
    FROM insurance_policies
    WHERE vehicle_id = v_vehicle_id
    AND type = v_type
    AND status IN ('active', 'expired')
    ORDER BY end_date ASC
  LOOP
    -- Pierwsza polisa - ustaw koniec pokrycia
    IF current_coverage_end IS NULL THEN
      current_coverage_end := alert_policy.end_date;

      -- Sprawdź czy ta pierwsza polisa wygasa w ciągu 21 dni
      days_until_expiry := alert_policy.end_date - CURRENT_DATE;

      -- Sprawdź czy jest następna polisa która przejmuje
      IF EXISTS (
        SELECT 1 FROM insurance_policies
        WHERE vehicle_id = v_vehicle_id
        AND type = v_type
        AND status = 'active'
        AND id != alert_policy.id
        AND start_date <= alert_policy.end_date + INTERVAL '1 day'
        AND end_date > alert_policy.end_date
      ) THEN
        -- Jest kontynuacja - nie twórz alertu, kontynuuj sprawdzanie
        CONTINUE;
      ELSE
        -- Brak kontynuacji - potencjalny alert
        IF days_until_expiry <= 21 AND alert_policy.status != 'cancelled' THEN
          gap_found := true;
          EXIT; -- Znaleźliśmy polisę do alertu
        END IF;
      END IF;
    END IF;
  END LOOP;

  -- Jeśli znaleziono lukę lub kończącą się polisę bez kontynuacji, stwórz alert
  IF gap_found AND alert_policy.id IS NOT NULL THEN
    days_until_expiry := alert_policy.end_date - CURRENT_DATE;

    INSERT INTO vehicle_alerts (
      vehicle_id,
      alert_type,
      priority,
      title,
      message,
      icon,
      is_blocking,
      due_date,
      related_id,
      is_active
    )
    VALUES (
      v_vehicle_id,
      'insurance',
      CASE
        WHEN days_until_expiry < 0 THEN 'critical'
        WHEN days_until_expiry <= 7 THEN 'high'
        WHEN days_until_expiry <= 14 THEN 'medium'
        ELSE 'low'
      END,
      CASE
        WHEN days_until_expiry < 0 THEN 'Brak ubezpieczenia!'
        ELSE 'Ubezpieczenie wygasa wkrótce'
      END,
      UPPER(alert_policy.type) || ' - ' ||
      CASE
        WHEN days_until_expiry < 0 THEN 'brak ochrony od ' || ABS(days_until_expiry) || ' dni'
        ELSE 'wygasa za ' || days_until_expiry || ' dni'
      END || ' (' || to_char(alert_policy.end_date, 'DD.MM.YYYY') || ')',
      'Shield',
      days_until_expiry < 0,
      alert_policy.end_date,
      alert_policy.id,
      true
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger dla INSERT i UPDATE
DROP TRIGGER IF EXISTS trigger_manage_insurance_alerts_insert_update ON insurance_policies;
CREATE TRIGGER trigger_manage_insurance_alerts_insert_update
  AFTER INSERT OR UPDATE ON insurance_policies
  FOR EACH ROW
  EXECUTE FUNCTION manage_insurance_alerts();

-- Trigger dla DELETE
DROP TRIGGER IF EXISTS trigger_manage_insurance_alerts_delete ON insurance_policies;
CREATE TRIGGER trigger_manage_insurance_alerts_delete
  AFTER DELETE ON insurance_policies
  FOR EACH ROW
  EXECUTE FUNCTION manage_insurance_alerts();

COMMENT ON FUNCTION create_inspection_alert IS 'Tworzy alert tylko dla najnowszej kontroli, zapobiega duplikatom';
COMMENT ON FUNCTION manage_insurance_alerts IS 'Zarządza alertami ubezpieczeń per typ (OC/AC/NNW) - alert 21 dni przed końcem, usuwany po dodaniu nowego tego samego typu';
