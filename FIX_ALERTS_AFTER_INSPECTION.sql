-- ============================================
-- NAPRAWA: Automatyczne tworzenie alertów po kontroli technicznej
-- ============================================

-- Funkcja tworząca alert po dodaniu kontroli technicznej
CREATE OR REPLACE FUNCTION create_inspection_alert()
RETURNS TRIGGER AS $$
BEGIN
  -- Usuń stare alerty o przeglądzie dla tego pojazdu
  DELETE FROM vehicle_alerts
  WHERE vehicle_id = NEW.vehicle_id
  AND alert_type = 'inspection';

  -- Utwórz nowy alert jeśli kontrola wygasa w ciągu 30 dni
  IF NEW.valid_until <= CURRENT_DATE + INTERVAL '30 days' THEN
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
        WHEN NEW.valid_until < CURRENT_DATE THEN 'critical'
        WHEN NEW.valid_until <= CURRENT_DATE + INTERVAL '7 days' THEN 'high'
        WHEN NEW.valid_until <= CURRENT_DATE + INTERVAL '30 days' THEN 'medium'
        ELSE 'low'
      END,
      CASE
        WHEN NEW.inspection_type = 'technical_inspection' THEN
          CASE WHEN NEW.valid_until < CURRENT_DATE THEN 'Przegląd techniczny przeterminowany!' ELSE 'Przegląd techniczny wkrótce' END
        ELSE
          CASE WHEN NEW.valid_until < CURRENT_DATE THEN 'Przegląd okresowy przeterminowany!' ELSE 'Przegląd okresowy wkrótce' END
      END,
      'Przegląd ' ||
      CASE WHEN NEW.inspection_type = 'technical_inspection' THEN 'techniczny' ELSE 'okresowy' END ||
      ' ważny do ' || to_char(NEW.valid_until, 'DD.MM.YYYY') ||
      CASE
        WHEN NEW.valid_until < CURRENT_DATE THEN ' - PRZETERMINOWANY'
        ELSE ' (' || (NEW.valid_until - CURRENT_DATE) || ' dni)'
      END,
      'FileText',
      NEW.valid_until < CURRENT_DATE,
      NEW.valid_until,
      NEW.id,
      true
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger uruchamiający funkcję po dodaniu lub aktualizacji kontroli
DROP TRIGGER IF EXISTS trigger_create_inspection_alert ON periodic_inspections;
CREATE TRIGGER trigger_create_inspection_alert
  AFTER INSERT OR UPDATE ON periodic_inspections
  FOR EACH ROW
  EXECUTE FUNCTION create_inspection_alert();

-- Włącz realtime dla vehicle_alerts
ALTER PUBLICATION supabase_realtime ADD TABLE vehicle_alerts;

COMMENT ON FUNCTION create_inspection_alert IS 'Automatycznie tworzy alert po dodaniu kontroli technicznej';
