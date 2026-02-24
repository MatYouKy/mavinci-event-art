/*
  # Migrate Existing Events to Phase System

  ## Purpose
  Creates default phases for all existing events based on their category names.
  Falls back to "Realizacja" phase type if category doesn't match any phase type.

  ## Actions
  1. Create default phase for each event
  2. Migrate existing employee assignments to phase assignments
  3. Create view for phase resource summary

  ## Data Integrity
  - All times preserved from original event data
  - Status field maps to invitation_status (pending/accepted/rejected)
*/

-- Get the default "Realizacja" phase type id for fallback
DO $$
DECLARE
  default_phase_type_id uuid;
BEGIN
  SELECT id INTO default_phase_type_id FROM event_phase_types WHERE name = 'Realizacja' LIMIT 1;

  -- Create default phases for all events
  INSERT INTO event_phases (
    event_id,
    phase_type_id,
    name,
    start_time,
    end_time,
    sequence_order,
    color
  )
  SELECT
    e.id as event_id,
    COALESCE(
      (SELECT pt.id FROM event_phase_types pt WHERE pt.name = ec.name LIMIT 1),
      default_phase_type_id
    ) as phase_type_id,
    COALESCE(ec.name, 'Realizacja') as name,
    e.event_date as start_time,
    COALESCE(e.event_end_date, e.event_date + interval '8 hours') as end_time,
    1 as sequence_order,
    COALESCE(ec.color, '#10b981') as color
  FROM events e
  LEFT JOIN event_categories ec ON ec.id = e.category_id
  WHERE NOT EXISTS (
    SELECT 1 FROM event_phases ep WHERE ep.event_id = e.id
  )
  AND e.event_date IS NOT NULL
  ON CONFLICT DO NOTHING;
END $$;

-- Migrate employee assignments to phase assignments
INSERT INTO event_phase_assignments (
  phase_id,
  employee_id,
  assignment_start,
  assignment_end,
  phase_work_start,
  phase_work_end,
  invitation_status,
  invitation_sent_at,
  invitation_responded_at,
  role,
  notes
)
SELECT
  ep.id as phase_id,
  ea.employee_id,
  ep.start_time as assignment_start,
  ep.end_time as assignment_end,
  ep.start_time as phase_work_start,
  ep.end_time as phase_work_end,
  COALESCE(ea.status, 'accepted') as invitation_status,
  COALESCE(ea.invited_at, ea.created_at) as invitation_sent_at,
  ea.responded_at as invitation_responded_at,
  ea.role,
  ea.notes
FROM employee_assignments ea
JOIN event_phases ep ON ep.event_id = ea.event_id
WHERE ep.sequence_order = 1
AND NOT EXISTS (
  SELECT 1 FROM event_phase_assignments epa
  WHERE epa.phase_id = ep.id AND epa.employee_id = ea.employee_id
)
ON CONFLICT (phase_id, employee_id) DO NOTHING;

-- Create helper view for phase resource summary
CREATE OR REPLACE VIEW event_phase_resource_summary AS
SELECT
  ep.id as phase_id,
  ep.event_id,
  ep.name as phase_name,
  ep.start_time,
  ep.end_time,
  ep.sequence_order,
  COUNT(DISTINCT epa.employee_id) as employee_count,
  COUNT(DISTINCT epe.id) as equipment_count,
  COUNT(DISTINCT epv.id) as vehicle_count,
  COUNT(DISTINCT CASE WHEN epa.invitation_status = 'pending' THEN epa.id END) as pending_invitations,
  COUNT(DISTINCT CASE WHEN epa.invitation_status = 'accepted' THEN epa.id END) as accepted_invitations,
  COUNT(DISTINCT CASE WHEN epa.invitation_status = 'rejected' THEN epa.id END) as rejected_invitations
FROM event_phases ep
LEFT JOIN event_phase_assignments epa ON epa.phase_id = ep.id
LEFT JOIN event_phase_equipment epe ON epe.phase_id = ep.id
LEFT JOIN event_phase_vehicles epv ON epv.phase_id = ep.id
GROUP BY ep.id, ep.event_id, ep.name, ep.start_time, ep.end_time, ep.sequence_order;

GRANT SELECT ON event_phase_resource_summary TO authenticated;
