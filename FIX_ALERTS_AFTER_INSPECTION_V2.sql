-- ============================================
-- NAPRAWA V2: Poprawione duplikowanie alertów
-- ============================================

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
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE vehicle_alerts;
EXCEPTION
  WHEN duplicate_object THEN NULL;
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
  current_policy RECORD;
  alert_needed boolean;
  days_until_expiry integer;
BEGIN
  -- Usuń stary alert dla tego TYPU ubezpieczenia dla tego pojazdu
  DELETE FROM vehicle_alerts
  WHERE vehicle_id = COALESCE(NEW.vehicle_id, OLD.vehicle_id)
  AND alert_type = 'insurance'
  AND message LIKE UPPER(COALESCE(NEW.type, OLD.type)) || '%';

  -- Jeśli operacja to DELETE, zakończ tutaj
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  -- Znajdź aktualną (najważniejszą) polisę dla tego TYPU
  -- Priorytet: 1) aktywna z najdłuższą datą końcową
  SELECT id, end_date, type, status
  INTO current_policy
  FROM insurance_policies
  WHERE vehicle_id = NEW.vehicle_id
  AND type = NEW.type
  AND status IN ('active', 'expired')
  ORDER BY
    CASE WHEN status = 'active' THEN 0 ELSE 1 END,
    end_date DESC,
    created_at DESC
  LIMIT 1;

  -- Jeśli nie ma polisy, zakończ
  IF current_policy.id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Oblicz dni do wygaśnięcia
  days_until_expiry := current_policy.end_date - CURRENT_DATE;

  -- Utwórz alert TYLKO jeśli:
  -- 1. Polisa wygasa w ciągu 21 dni LUB już wygasła
  -- 2. Status to 'active' (nie ma sensu alertować o wygasłej jeśli już jest nowa)
  IF (days_until_expiry <= 21 OR current_policy.status = 'expired') AND current_policy.status != 'cancelled' THEN
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
      'insurance',
      CASE
        WHEN days_until_expiry < 0 THEN 'critical'
        WHEN days_until_expiry <= 7 THEN 'high'
        WHEN days_until_expiry <= 14 THEN 'medium'
        ELSE 'low'
      END,
      CASE
        WHEN days_until_expiry < 0 THEN 'Ubezpieczenie przeterminowane!'
        ELSE 'Ubezpieczenie wygasa wkrótce'
      END,
      UPPER(current_policy.type) || ' - ' ||
      CASE
        WHEN days_until_expiry < 0 THEN 'przeterminowane ' || ABS(days_until_expiry) || ' dni temu'
        ELSE 'wygasa za ' || days_until_expiry || ' dni'
      END || ' (' || to_char(current_policy.end_date, 'DD.MM.YYYY') || ')',
      'Shield',
      days_until_expiry < 0,
      current_policy.end_date,
      current_policy.id,
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
