/*
  # Event Phases System - Multi-level Timeline Management

  ## Overview
  Creates comprehensive event phases system with:
  - Configurable phase types (załadunek, montaż, realizacja, demontaż, etc.)
  - Sequential non-overlapping phases for events
  - Individual employee schedules (travel to/from + work time)
  - Resource assignments (equipment, vehicles) with flexible timeframes
  - Soft conflict detection with alternative suggestions
  - Invitation/acceptance workflow for phase participation

  ## Tables Created
  1. event_phase_types - Phase type templates
  2. event_phases - Phase instances for events
  3. event_phase_assignments - Employee participation with individual schedules
  4. event_phase_equipment - Equipment assignments to phases
  5. event_phase_vehicles - Vehicle assignments to phases

  ## Security
  - RLS enabled on all tables
  - Access controlled by existing event permissions
*/

-- =====================================================
-- 1. EVENT PHASE TYPES (Configurable Templates)
-- =====================================================

CREATE TABLE IF NOT EXISTS event_phase_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  color text NOT NULL DEFAULT '#3b82f6',
  icon text,
  default_duration_hours integer DEFAULT 8,
  is_active boolean DEFAULT true,
  sequence_priority integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE event_phase_types ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view active phase types"
  ON event_phase_types FOR SELECT
  USING (is_active = true);

CREATE POLICY "Admin and events_manage can manage phase types"
  ON event_phase_types FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE auth_user_id = auth.uid()
      AND ('admin' = ANY(permissions) OR 'events_manage' = ANY(permissions))
    )
  );

INSERT INTO event_phase_types (name, description, color, sequence_priority, default_duration_hours) VALUES
  ('Załadunek', 'Załadunek sprzętu i przygotowanie', '#3b82f6', 1, 2),
  ('Dojazd', 'Transport do lokalizacji', '#06b6d4', 2, 1),
  ('Montaż', 'Budowa i setup techniczny', '#8b5cf6', 3, 4),
  ('Realizacja', 'Główne wydarzenie', '#10b981', 4, 8),
  ('Demontaż', 'Rozbióra i pakowanie', '#f59e0b', 5, 3),
  ('Powrót', 'Transport powrotny', '#06b6d4', 6, 1),
  ('Rozładunek', 'Rozładunek i składowanie sprzętu', '#3b82f6', 7, 2)
ON CONFLICT DO NOTHING;

-- =====================================================
-- 2. EVENT PHASES (Sequential Time Blocks)
-- =====================================================

CREATE TABLE IF NOT EXISTS event_phases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  phase_type_id uuid NOT NULL REFERENCES event_phase_types(id),
  name text NOT NULL,
  description text,
  start_time timestamptz NOT NULL,
  end_time timestamptz NOT NULL,
  sequence_order integer NOT NULL DEFAULT 1,
  color text,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  created_by uuid REFERENCES employees(id),

  CONSTRAINT valid_time_range CHECK (end_time > start_time)
);

CREATE INDEX idx_event_phases_event ON event_phases(event_id);
CREATE INDEX idx_event_phases_type ON event_phases(phase_type_id);
CREATE INDEX idx_event_phases_time ON event_phases(start_time, end_time);

ALTER TABLE event_phases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view phases of events they can access"
  ON event_phases FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM events e
      WHERE e.id = event_phases.event_id
    )
  );

CREATE POLICY "Users can manage phases of events they can manage"
  ON event_phases FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE auth_user_id = auth.uid()
      AND ('admin' = ANY(permissions) OR 'events_manage' = ANY(permissions))
    )
    OR
    EXISTS (
      SELECT 1 FROM employee_assignments ea
      WHERE ea.event_id = event_phases.event_id
      AND ea.employee_id = auth.uid()
      AND ea.role IN ('coordinator', 'lead')
    )
  );

CREATE OR REPLACE FUNCTION validate_phase_no_overlap()
RETURNS trigger AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM event_phases
    WHERE event_id = NEW.event_id
    AND id != COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid)
    AND (
      (NEW.start_time >= start_time AND NEW.start_time < end_time)
      OR (NEW.end_time > start_time AND NEW.end_time <= end_time)
      OR (NEW.start_time <= start_time AND NEW.end_time >= end_time)
    )
  ) THEN
    RAISE EXCEPTION 'Event phases cannot overlap. Adjust times to prevent conflicts.';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ensure_phases_no_overlap
  BEFORE INSERT OR UPDATE ON event_phases
  FOR EACH ROW
  EXECUTE FUNCTION validate_phase_no_overlap();

-- =====================================================
-- 3. EMPLOYEE PHASE ASSIGNMENTS (Individual Schedules)
-- =====================================================

CREATE TABLE IF NOT EXISTS event_phase_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phase_id uuid NOT NULL REFERENCES event_phases(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,

  assignment_start timestamptz NOT NULL,
  assignment_end timestamptz NOT NULL,
  phase_work_start timestamptz NOT NULL,
  phase_work_end timestamptz NOT NULL,

  invitation_status text NOT NULL DEFAULT 'pending' CHECK (
    invitation_status IN ('pending', 'accepted', 'rejected')
  ),
  invitation_sent_at timestamptz DEFAULT now(),
  invitation_responded_at timestamptz,

  role text,
  travel_to_notes text,
  travel_from_notes text,
  notes text,

  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  created_by uuid REFERENCES employees(id),

  CONSTRAINT valid_assignment_times CHECK (
    assignment_end > assignment_start
    AND phase_work_end > phase_work_start
    AND phase_work_start >= assignment_start
    AND phase_work_end <= assignment_end
  ),
  CONSTRAINT unique_employee_phase UNIQUE (phase_id, employee_id)
);

CREATE INDEX idx_phase_assignments_phase ON event_phase_assignments(phase_id);
CREATE INDEX idx_phase_assignments_employee ON event_phase_assignments(employee_id);
CREATE INDEX idx_phase_assignments_status ON event_phase_assignments(invitation_status);
CREATE INDEX idx_phase_assignments_time ON event_phase_assignments(assignment_start, assignment_end);

ALTER TABLE event_phase_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view phase assignments for accessible events"
  ON event_phase_assignments FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM event_phases ep
      JOIN events e ON e.id = ep.event_id
      WHERE ep.id = event_phase_assignments.phase_id
    )
    OR EXISTS (
      SELECT 1 FROM employees
      WHERE id = event_phase_assignments.employee_id
      AND auth_user_id = auth.uid()
    )
  );

CREATE POLICY "Event managers can create phase assignments"
  ON event_phase_assignments FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees
      WHERE auth_user_id = auth.uid()
      AND ('admin' = ANY(permissions) OR 'events_manage' = ANY(permissions))
    )
  );

CREATE POLICY "Event managers and assigned employees can update assignments"
  ON event_phase_assignments FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE id = event_phase_assignments.employee_id
      AND auth_user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM employees
      WHERE auth_user_id = auth.uid()
      AND ('admin' = ANY(permissions) OR 'events_manage' = ANY(permissions))
    )
  );

CREATE POLICY "Event managers can delete phase assignments"
  ON event_phase_assignments FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE auth_user_id = auth.uid()
      AND ('admin' = ANY(permissions) OR 'events_manage' = ANY(permissions))
    )
  );

-- =====================================================
-- 4. EQUIPMENT PHASE ASSIGNMENTS
-- =====================================================

CREATE TABLE IF NOT EXISTS event_phase_equipment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phase_id uuid NOT NULL REFERENCES event_phases(id) ON DELETE CASCADE,

  equipment_item_id uuid REFERENCES equipment_items(id) ON DELETE CASCADE,
  equipment_kit_id uuid REFERENCES equipment_kits(id) ON DELETE CASCADE,
  cable_id uuid REFERENCES cables(id) ON DELETE CASCADE,

  assigned_start timestamptz NOT NULL,
  assigned_end timestamptz NOT NULL,

  quantity integer DEFAULT 1,
  notes text,

  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  created_by uuid REFERENCES employees(id),

  CONSTRAINT valid_assignment_time CHECK (assigned_end > assigned_start),
  CONSTRAINT one_resource_type CHECK (
    (equipment_item_id IS NOT NULL)::int +
    (equipment_kit_id IS NOT NULL)::int +
    (cable_id IS NOT NULL)::int = 1
  )
);

CREATE INDEX idx_phase_equipment_phase ON event_phase_equipment(phase_id);
CREATE INDEX idx_phase_equipment_item ON event_phase_equipment(equipment_item_id);
CREATE INDEX idx_phase_equipment_kit ON event_phase_equipment(equipment_kit_id);
CREATE INDEX idx_phase_equipment_cable ON event_phase_equipment(cable_id);
CREATE INDEX idx_phase_equipment_time ON event_phase_equipment(assigned_start, assigned_end);

ALTER TABLE event_phase_equipment ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view phase equipment for accessible events"
  ON event_phase_equipment FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM event_phases ep
      WHERE ep.id = event_phase_equipment.phase_id
    )
  );

CREATE POLICY "Event managers can manage phase equipment"
  ON event_phase_equipment FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE auth_user_id = auth.uid()
      AND ('admin' = ANY(permissions) OR 'events_manage' = ANY(permissions) OR 'equipment_manage' = ANY(permissions))
    )
  );

-- =====================================================
-- 5. VEHICLE PHASE ASSIGNMENTS
-- =====================================================

CREATE TABLE IF NOT EXISTS event_phase_vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phase_id uuid NOT NULL REFERENCES event_phases(id) ON DELETE CASCADE,
  vehicle_id uuid NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  driver_id uuid REFERENCES employees(id) ON DELETE SET NULL,

  assigned_start timestamptz NOT NULL,
  assigned_end timestamptz NOT NULL,

  purpose text,
  notes text,

  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  created_by uuid REFERENCES employees(id),

  CONSTRAINT valid_assignment_time CHECK (assigned_end > assigned_start)
);

CREATE INDEX idx_phase_vehicles_phase ON event_phase_vehicles(phase_id);
CREATE INDEX idx_phase_vehicles_vehicle ON event_phase_vehicles(vehicle_id);
CREATE INDEX idx_phase_vehicles_driver ON event_phase_vehicles(driver_id);
CREATE INDEX idx_phase_vehicles_time ON event_phase_vehicles(assigned_start, assigned_end);

ALTER TABLE event_phase_vehicles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view phase vehicles for accessible events"
  ON event_phase_vehicles FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM event_phases ep
      WHERE ep.id = event_phase_vehicles.phase_id
    )
  );

CREATE POLICY "Event managers and fleet managers can manage phase vehicles"
  ON event_phase_vehicles FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE auth_user_id = auth.uid()
      AND (
        'admin' = ANY(permissions)
        OR 'events_manage' = ANY(permissions)
        OR 'fleet_manage' = ANY(permissions)
      )
    )
  );

-- =====================================================
-- 6. HELPER FUNCTIONS FOR CONFLICT DETECTION
-- =====================================================

CREATE OR REPLACE FUNCTION get_employee_phase_conflicts(
  p_employee_id uuid,
  p_start_time timestamptz,
  p_end_time timestamptz,
  p_exclude_assignment_id uuid DEFAULT NULL
)
RETURNS TABLE (
  phase_id uuid,
  event_id uuid,
  event_name text,
  phase_name text,
  assignment_start timestamptz,
  assignment_end timestamptz
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    epa.phase_id,
    ep.event_id,
    e.name as event_name,
    ep.name as phase_name,
    epa.assignment_start,
    epa.assignment_end
  FROM event_phase_assignments epa
  JOIN event_phases ep ON ep.id = epa.phase_id
  JOIN events e ON e.id = ep.event_id
  WHERE epa.employee_id = p_employee_id
  AND epa.id != COALESCE(p_exclude_assignment_id, '00000000-0000-0000-0000-000000000000'::uuid)
  AND (
    (p_start_time >= epa.assignment_start AND p_start_time < epa.assignment_end)
    OR (p_end_time > epa.assignment_start AND p_end_time <= epa.assignment_end)
    OR (p_start_time <= epa.assignment_start AND p_end_time >= epa.assignment_end)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION get_equipment_phase_conflicts(
  p_equipment_item_id uuid,
  p_start_time timestamptz,
  p_end_time timestamptz,
  p_exclude_assignment_id uuid DEFAULT NULL
)
RETURNS TABLE (
  phase_id uuid,
  event_id uuid,
  event_name text,
  phase_name text,
  assigned_start timestamptz,
  assigned_end timestamptz
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    epe.phase_id,
    ep.event_id,
    e.name as event_name,
    ep.name as phase_name,
    epe.assigned_start,
    epe.assigned_end
  FROM event_phase_equipment epe
  JOIN event_phases ep ON ep.id = epe.phase_id
  JOIN events e ON e.id = ep.event_id
  WHERE epe.equipment_item_id = p_equipment_item_id
  AND epe.id != COALESCE(p_exclude_assignment_id, '00000000-0000-0000-0000-000000000000'::uuid)
  AND (
    (p_start_time >= epe.assigned_start AND p_start_time < epe.assigned_end)
    OR (p_end_time > epe.assigned_start AND p_end_time <= epe.assigned_end)
    OR (p_start_time <= epe.assigned_start AND p_end_time >= epe.assigned_end)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION get_alternative_equipment(
  p_equipment_item_id uuid,
  p_start_time timestamptz,
  p_end_time timestamptz
)
RETURNS TABLE (
  item_id uuid,
  name text,
  model text,
  category_name text,
  is_available boolean
) AS $$
BEGIN
  RETURN QUERY
  WITH source_item AS (
    SELECT category_id FROM equipment_items WHERE id = p_equipment_item_id
  )
  SELECT
    ei.id as item_id,
    ei.name,
    ei.model,
    ec.name as category_name,
    NOT EXISTS (
      SELECT 1 FROM event_phase_equipment epe
      WHERE epe.equipment_item_id = ei.id
      AND (
        (p_start_time >= epe.assigned_start AND p_start_time < epe.assigned_end)
        OR (p_end_time > epe.assigned_start AND p_end_time <= epe.assigned_end)
        OR (p_start_time <= epe.assigned_start AND p_end_time >= epe.assigned_end)
      )
    ) as is_available
  FROM equipment_items ei
  JOIN equipment_categories ec ON ec.id = ei.category_id
  WHERE ei.category_id = (SELECT category_id FROM source_item)
  AND ei.id != p_equipment_item_id
  AND ei.status = 'available'
  ORDER BY is_available DESC, ei.name;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- 7. REALTIME
-- =====================================================

ALTER PUBLICATION supabase_realtime ADD TABLE event_phase_types;
ALTER PUBLICATION supabase_realtime ADD TABLE event_phases;
ALTER PUBLICATION supabase_realtime ADD TABLE event_phase_assignments;
ALTER PUBLICATION supabase_realtime ADD TABLE event_phase_equipment;
ALTER PUBLICATION supabase_realtime ADD TABLE event_phase_vehicles;

-- =====================================================
-- 8. UPDATE TRIGGERS
-- =====================================================

CREATE TRIGGER update_event_phase_types_updated_at
  BEFORE UPDATE ON event_phase_types
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_event_phases_updated_at
  BEFORE UPDATE ON event_phases
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_event_phase_assignments_updated_at
  BEFORE UPDATE ON event_phase_assignments
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_event_phase_equipment_updated_at
  BEFORE UPDATE ON event_phase_equipment
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_event_phase_vehicles_updated_at
  BEFORE UPDATE ON event_phase_vehicles
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
