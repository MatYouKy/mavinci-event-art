BEGIN;

-- Partner arrangements without an additional contract satisfy the contract check.
-- Keep all other checks and existing function permissions unchanged.
CREATE OR REPLACE FUNCTION public.get_event_preflight_core(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  event_record record;
  issues jsonb := '[]'::jsonb;
  employee_conflicts integer := 0;
  accepted_employee_conflicts integer := 0;
  equipment_conflicts integer := 0;
  vehicle_conflicts integer := 0;
  pending_team integer := 0;
  open_tasks integer := 0;
  category_name text;
BEGIN
  SELECT event.*, category.name AS category_name INTO event_record
  FROM public.events event
  LEFT JOIN public.event_categories category ON category.id = event.category_id
  WHERE event.id = p_event_id;
  category_name := LOWER(COALESCE(event_record.category_name, ''));

  IF NOT EXISTS (
    SELECT 1 FROM public.contracts contract
    WHERE contract.event_id = p_event_id AND contract.status::text IN ('signed_by_client', 'signed_returned')
  ) AND NOT EXISTS (
    SELECT 1 FROM public.event_partner_arrangements arrangement
    WHERE arrangement.event_id = p_event_id
      AND arrangement.enabled
      AND NOT arrangement.include_contract
  ) THEN
    issues := issues || jsonb_build_array(jsonb_build_object('code','contract','label','Brak podpisanej umowy','severity','critical','tab','contract'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.event_payment_milestones milestone WHERE milestone.event_id = p_event_id) THEN
    issues := issues || jsonb_build_array(jsonb_build_object('code','payment_schedule','label','Brak harmonogramu płatności','severity','critical','tab','finances'));
  ELSIF EXISTS (
    SELECT 1 FROM public.event_payment_milestones milestone
    WHERE milestone.event_id = p_event_id AND milestone.milestone_type = 'deposit'
      AND milestone.status NOT IN ('paid','waived')
  ) THEN
    issues := issues || jsonb_build_array(jsonb_build_object('code','deposit','label','Zaliczka nie została zaksięgowana','severity','critical','tab','finances'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.employee_assignments assignment
    WHERE assignment.event_id = p_event_id AND COALESCE(assignment.status, 'accepted') = 'accepted'
  ) THEN
    issues := issues || jsonb_build_array(jsonb_build_object('code','team','label','Brak zaakceptowanego zespołu','severity','critical','tab','team'));
  END IF;

  SELECT COUNT(*) INTO pending_team FROM public.employee_assignments assignment
  WHERE assignment.event_id = p_event_id AND assignment.status = 'pending';
  IF pending_team > 0 THEN
    issues := issues || jsonb_build_array(jsonb_build_object('code','team_pending','label',format('%s osób nie zaakceptowało zaproszenia', pending_team),'severity','warning','tab','team'));
  END IF;

  SELECT COUNT(*)::integer INTO employee_conflicts
  FROM (
    SELECT current_assignment.id::text || ':' || other_assignment.id::text AS conflict_id
    FROM public.event_phase_assignments current_assignment
    JOIN public.event_phases current_phase ON current_phase.id = current_assignment.phase_id
    JOIN public.event_phase_assignments other_assignment ON other_assignment.employee_id = current_assignment.employee_id
      AND other_assignment.id <> current_assignment.id
      AND COALESCE(other_assignment.invitation_status, 'pending') <> 'rejected'
    JOIN public.event_phases other_phase ON other_phase.id = other_assignment.phase_id
      AND other_phase.event_id <> p_event_id
    WHERE current_phase.event_id = p_event_id
      AND COALESCE(current_assignment.invitation_status, 'pending') <> 'rejected'
      AND COALESCE(other_assignment.phase_work_start, other_assignment.assignment_start, other_phase.start_time) < COALESCE(current_assignment.phase_work_end, current_assignment.assignment_end, current_phase.end_time)
      AND COALESCE(other_assignment.phase_work_end, other_assignment.assignment_end, other_phase.end_time) > COALESCE(current_assignment.phase_work_start, current_assignment.assignment_start, current_phase.start_time)
      AND NOT EXISTS (
        SELECT 1
        FROM public.event_employee_conflict_acceptances acceptance
        WHERE acceptance.assignment_a_id = CASE WHEN current_assignment.id::text < other_assignment.id::text THEN current_assignment.id ELSE other_assignment.id END
          AND acceptance.assignment_b_id = CASE WHEN current_assignment.id::text < other_assignment.id::text THEN other_assignment.id ELSE current_assignment.id END
      )

    UNION

    SELECT current_assignment.id::text || ':' || absence.id::text
    FROM public.event_phase_assignments current_assignment
    JOIN public.event_phases current_phase ON current_phase.id = current_assignment.phase_id
    JOIN public.employee_absences absence ON absence.employee_id = current_assignment.employee_id
    WHERE current_phase.event_id = p_event_id
      AND COALESCE(current_assignment.invitation_status, 'pending') <> 'rejected'
      AND absence.approval_status::text IN ('approved','pending')
      AND absence.start_date < COALESCE(current_assignment.phase_work_end, current_assignment.assignment_end, current_phase.end_time)
      AND absence.end_date > COALESCE(current_assignment.phase_work_start, current_assignment.assignment_start, current_phase.start_time)
  ) conflicts;

  IF employee_conflicts > 0 THEN
    issues := issues || jsonb_build_array(jsonb_build_object(
      'code','employee_conflicts',
      'label',format('Nierozwiązane konflikty obsady realizacyjnej: %s', employee_conflicts),
      'severity','critical',
      'tab','team'
    ));
  END IF;

  SELECT COUNT(DISTINCT acceptance.id)::integer INTO accepted_employee_conflicts
  FROM public.event_employee_conflict_acceptances acceptance
  JOIN public.event_phase_assignments assignment_a ON assignment_a.id = acceptance.assignment_a_id
  JOIN public.event_phases phase_a ON phase_a.id = assignment_a.phase_id
  JOIN public.event_phase_assignments assignment_b ON assignment_b.id = acceptance.assignment_b_id
  JOIN public.event_phases phase_b ON phase_b.id = assignment_b.phase_id
  WHERE (phase_a.event_id = p_event_id OR phase_b.event_id = p_event_id)
    AND COALESCE(assignment_a.invitation_status, 'pending') <> 'rejected'
    AND COALESCE(assignment_b.invitation_status, 'pending') <> 'rejected'
    AND COALESCE(assignment_a.phase_work_start, assignment_a.assignment_start, phase_a.start_time)
      < COALESCE(assignment_b.phase_work_end, assignment_b.assignment_end, phase_b.end_time)
    AND COALESCE(assignment_a.phase_work_end, assignment_a.assignment_end, phase_a.end_time)
      > COALESCE(assignment_b.phase_work_start, assignment_b.assignment_start, phase_b.start_time);

  SELECT COUNT(*) INTO equipment_conflicts
  FROM public.offer_equipment_conflicts conflict
  JOIN public.offers offer ON offer.id = conflict.offer_id
  WHERE offer.event_id = p_event_id AND conflict.status::text = 'unresolved';
  IF equipment_conflicts > 0 THEN
    issues := issues || jsonb_build_array(jsonb_build_object('code','equipment_conflicts','label',format('Nierozwiązane konflikty sprzętu: %s', equipment_conflicts),'severity','critical','tab','equipment'));
  END IF;

  SELECT COUNT(*) INTO vehicle_conflicts
  FROM public.vehicle_reservation_conflicts conflict
  WHERE conflict.event_id_1 = p_event_id OR conflict.event_id_2 = p_event_id;
  IF vehicle_conflicts > 0 THEN
    issues := issues || jsonb_build_array(jsonb_build_object('code','vehicle_conflicts','label',format('Konflikty rezerwacji pojazdów: %s', vehicle_conflicts),'severity','critical','tab','logistics'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.event_equipment equipment WHERE equipment.event_id = p_event_id) THEN
    issues := issues || jsonb_build_array(jsonb_build_object('code','equipment','label','Nie przypisano sprzętu','severity','warning','tab','equipment'));
  END IF;

  IF category_name LIKE 'wesel%' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.wedding_cards card
      WHERE card.event_id = p_event_id AND card.status IN ('submitted','approved')
    ) THEN
      issues := issues || jsonb_build_array(jsonb_build_object('code','wedding_card','label','Karta Weselna nie jest gotowa','severity','warning','tab','agenda'));
    END IF;
  ELSIF NOT EXISTS (SELECT 1 FROM public.event_agendas agenda WHERE agenda.event_id = p_event_id) THEN
    issues := issues || jsonb_build_array(jsonb_build_object('code','agenda','label','Nie przygotowano agendy','severity','warning','tab','agenda'));
  END IF;

  SELECT COUNT(*) INTO open_tasks FROM public.tasks task
  WHERE task.event_id = p_event_id
    AND task.status::text NOT IN ('completed','cancelled')
    AND (task.due_date IS NULL OR task.due_date <= event_record.event_date);
  IF open_tasks > 0 THEN
    issues := issues || jsonb_build_array(jsonb_build_object('code','tasks','label',format('Otwarte zadania przed wydarzeniem: %s', open_tasks),'severity','warning','tab','tasks'));
  END IF;

  RETURN jsonb_build_object(
    'event_id', p_event_id,
    'event_date', event_record.event_date,
    'ready', jsonb_array_length(issues) = 0,
    'critical_count', (SELECT COUNT(*) FROM jsonb_array_elements(issues) item WHERE item->>'severity' = 'critical'),
    'warning_count', (SELECT COUNT(*) FROM jsonb_array_elements(issues) item WHERE item->>'severity' = 'warning'),
    'accepted_employee_conflicts', accepted_employee_conflicts,
    'issues', issues
  );
END;
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
    AND NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'event_partner_arrangements'
    ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.event_partner_arrangements;
  END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';
COMMIT;
