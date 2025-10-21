/*
  # Tabela alertów pojazdów

  1. Nowa tabela: vehicle_alerts
    - id (uuid, primary key)
    - vehicle_id (uuid, foreign key)
    - alert_type (text) - typ alertu
    - priority (text) - 'low', 'medium', 'high', 'critical'
    - title (text)
    - message (text)
    - icon (text) - nazwa ikony Lucide
    - is_blocking (boolean) - czy blokuje użytkowanie
    - is_active (boolean) - czy alert jest aktywny
    - due_date (date, optional) - termin
    - related_id (uuid, optional) - ID powiązanego rekordu
    - created_at, updated_at

  2. Security: RLS enabled
*/

CREATE TABLE IF NOT EXISTS vehicle_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  alert_type text NOT NULL CHECK (alert_type IN ('insurance', 'inspection', 'maintenance', 'repair', 'other')),
  priority text NOT NULL CHECK (priority IN ('low', 'medium', 'high', 'critical')),
  title text NOT NULL,
  message text NOT NULL,
  icon text DEFAULT 'AlertTriangle',
  is_blocking boolean DEFAULT false,
  is_active boolean DEFAULT true,
  due_date date,
  related_id uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE vehicle_alerts ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Fleet managers can view alerts"
  ON vehicle_alerts FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'fleet_manage' = ANY(employees.permissions)
    )
  );

CREATE POLICY "Fleet managers can manage alerts"
  ON vehicle_alerts FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'fleet_manage' = ANY(employees.permissions)
    )
  );

-- Index
CREATE INDEX IF NOT EXISTS idx_vehicle_alerts_vehicle_id ON vehicle_alerts(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_alerts_active ON vehicle_alerts(vehicle_id, is_active) WHERE is_active = true;

-- Funkcja generowania alertów
CREATE OR REPLACE FUNCTION generate_vehicle_alerts()
RETURNS void AS $$
BEGIN
  -- Usuń stare nieaktywne alerty (starsze niż 30 dni)
  DELETE FROM vehicle_alerts
  WHERE is_active = false
  AND updated_at < now() - INTERVAL '30 days';

  -- Dezaktywuj wszystkie alerty (będą regenerowane)
  UPDATE vehicle_alerts SET is_active = false;

  -- ALERTY OC (30 dni przed wygaśnięciem = medium, po terminie = critical + blocking)
  INSERT INTO vehicle_alerts (vehicle_id, alert_type, priority, title, message, icon, is_blocking, due_date, related_id)
  SELECT
    ip.vehicle_id,
    'insurance',
    CASE
      WHEN ip.end_date < CURRENT_DATE THEN 'critical'
      WHEN ip.end_date <= CURRENT_DATE + INTERVAL '7 days' THEN 'high'
      WHEN ip.end_date <= CURRENT_DATE + INTERVAL '30 days' THEN 'medium'
      ELSE 'low'
    END,
    CASE
      WHEN ip.end_date < CURRENT_DATE THEN 'OC wygasło!'
      ELSE 'OC wygasa wkrótce'
    END,
    'Ubezpieczenie OC ważne do ' || to_char(ip.end_date, 'DD.MM.YYYY') ||
    CASE
      WHEN ip.end_date < CURRENT_DATE THEN ' - PRZETERMINOWANE'
      ELSE ' (' || (ip.end_date - CURRENT_DATE) || ' dni)'
    END,
    'Shield',
    ip.end_date < CURRENT_DATE AND ip.blocks_usage,
    ip.end_date,
    ip.id
  FROM insurance_policies ip
  WHERE ip.type = 'oc'
  AND ip.end_date <= CURRENT_DATE + INTERVAL '30 days'
  ON CONFLICT DO NOTHING;

  -- ALERTY AC (informacyjne, 14 dni przed wygaśnięciem)
  INSERT INTO vehicle_alerts (vehicle_id, alert_type, priority, title, message, icon, is_blocking, due_date, related_id)
  SELECT
    ip.vehicle_id,
    'insurance',
    'low',
    'AC wygasa wkrótce',
    'Ubezpieczenie AC ważne do ' || to_char(ip.end_date, 'DD.MM.YYYY') || ' (' || (ip.end_date - CURRENT_DATE) || ' dni)',
    'Shield',
    false,
    ip.end_date,
    ip.id
  FROM insurance_policies ip
  WHERE ip.type = 'ac'
  AND ip.end_date <= CURRENT_DATE + INTERVAL '14 days'
  AND ip.end_date >= CURRENT_DATE
  ON CONFLICT DO NOTHING;

  -- ALERTY PRZEGLĄDÓW (30 dni przed, po terminie = critical + blocking)
  INSERT INTO vehicle_alerts (vehicle_id, alert_type, priority, title, message, icon, is_blocking, due_date, related_id)
  SELECT
    pi.vehicle_id,
    'inspection',
    CASE
      WHEN pi.valid_until < CURRENT_DATE THEN 'critical'
      WHEN pi.valid_until <= CURRENT_DATE + INTERVAL '7 days' THEN 'high'
      WHEN pi.valid_until <= CURRENT_DATE + INTERVAL '30 days' THEN 'medium'
      ELSE 'low'
    END,
    CASE
      WHEN pi.inspection_type = 'technical' THEN
        CASE WHEN pi.valid_until < CURRENT_DATE THEN 'Przegląd techniczny przeterminowany!' ELSE 'Przegląd techniczny wkrótce' END
      ELSE
        CASE WHEN pi.valid_until < CURRENT_DATE THEN 'Przegląd emisji przeterminowany!' ELSE 'Przegląd emisji wkrótce' END
    END,
    'Przegląd ' ||
    CASE WHEN pi.inspection_type = 'technical' THEN 'techniczny' ELSE 'emisji spalin' END ||
    ' ważny do ' || to_char(pi.valid_until, 'DD.MM.YYYY') ||
    CASE
      WHEN pi.valid_until < CURRENT_DATE THEN ' - PRZETERMINOWANY'
      ELSE ' (' || (pi.valid_until - CURRENT_DATE) || ' dni)'
    END,
    'FileText',
    pi.valid_until < CURRENT_DATE,
    pi.valid_until,
    pi.id
  FROM periodic_inspections pi
  WHERE pi.is_current = true
  AND pi.valid_until <= CURRENT_DATE + INTERVAL '30 days'
  ON CONFLICT DO NOTHING;

  -- ALERTY NAPRAW (wysokiej wagi w trakcie)
  INSERT INTO vehicle_alerts (vehicle_id, alert_type, priority, title, message, icon, is_blocking, due_date, related_id)
  SELECT
    mr.vehicle_id,
    'repair',
    'high',
    mr.title,
    'Naprawa wysokiej wagi w trakcie - ' ||
    CASE
      WHEN mr.status = 'scheduled' THEN 'zaplanowana'
      WHEN mr.status = 'in_progress' THEN 'w realizacji'
      ELSE mr.status
    END ||
    CASE WHEN mr.estimated_completion_date IS NOT NULL THEN ' (szacowany termin: ' || to_char(mr.estimated_completion_date, 'DD.MM.YYYY') || ')' ELSE '' END,
    'Wrench',
    mr.blocks_availability,
    mr.estimated_completion_date,
    mr.id
  FROM maintenance_repairs mr
  WHERE mr.severity = 'high'
  AND mr.status IN ('scheduled', 'in_progress')
  ON CONFLICT DO NOTHING;

  -- Oznacz nowe alerty jako aktywne
  UPDATE vehicle_alerts SET is_active = true
  WHERE updated_at >= now() - INTERVAL '1 minute';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Funkcja aktualizacji statusów pojazdów na podstawie alertów
CREATE OR REPLACE FUNCTION update_vehicle_status_from_alerts()
RETURNS void AS $$
BEGIN
  -- Pojazdy z blokirującymi alertami OC
  UPDATE vehicles v
  SET status = 'no_insurance'
  WHERE EXISTS (
    SELECT 1 FROM vehicle_alerts va
    WHERE va.vehicle_id = v.id
    AND va.is_active = true
    AND va.alert_type = 'insurance'
    AND va.is_blocking = true
  )
  AND v.status NOT IN ('sold', 'scrapped', 'inactive');

  -- Pojazdy z przeterminowanym przeglądem
  UPDATE vehicles v
  SET status = 'no_inspection'
  WHERE EXISTS (
    SELECT 1 FROM vehicle_alerts va
    WHERE va.vehicle_id = v.id
    AND va.is_active = true
    AND va.alert_type = 'inspection'
    AND va.is_blocking = true
  )
  AND v.status NOT IN ('sold', 'scrapped', 'inactive', 'no_insurance');

  -- Pojazdy z naprawą wysokiej wagi
  UPDATE vehicles v
  SET status = 'under_repair'
  WHERE EXISTS (
    SELECT 1 FROM vehicle_alerts va
    WHERE va.vehicle_id = v.id
    AND va.is_active = true
    AND va.alert_type = 'repair'
    AND va.is_blocking = true
  )
  AND v.status NOT IN ('sold', 'scrapped', 'inactive', 'no_insurance', 'no_inspection');

  -- Pojazdy bez blokujących alertów -> available (jeśli nie są w użytkowaniu)
  UPDATE vehicles v
  SET status = 'available'
  WHERE NOT EXISTS (
    SELECT 1 FROM vehicle_alerts va
    WHERE va.vehicle_id = v.id
    AND va.is_active = true
    AND va.is_blocking = true
  )
  AND v.status IN ('no_insurance', 'no_inspection', 'under_repair')
  AND NOT EXISTS (
    SELECT 1 FROM vehicle_handovers vh
    WHERE vh.vehicle_id = v.id
    AND vh.returned_at IS NULL
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
