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

COMMENT ON FUNCTION create_inspection_alert IS 'Tworzy alert tylko dla najnowszej kontroli, zapobiega duplikatom';
