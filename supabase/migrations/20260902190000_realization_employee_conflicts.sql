/*
  Konflikty pracowników realizacyjnych.

  Dostęp do wydarzenia i rola autora/sprzedawcy nie oznaczają obowiązkowej
  obecności na miejscu. Konflikty są więc liczone wyłącznie dla przypisań do
  konkretnych faz timeline. Uzasadnione nakładanie się dwóch realizacji może
  zostać świadomie zaakceptowane i pozostaje zapisane w audycie.
*/

CREATE TABLE IF NOT EXISTS public.event_employee_conflict_acceptances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_a_id uuid NOT NULL REFERENCES public.event_phase_assignments(id) ON DELETE CASCADE,
  assignment_b_id uuid NOT NULL REFERENCES public.event_phase_assignments(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  reason text NOT NULL CHECK (char_length(btrim(reason)) >= 10),
  accepted_by uuid,
  accepted_by_employee_id uuid
    CONSTRAINT event_employee_conflict_acceptances_acceptor_fkey
    REFERENCES public.employees(id) ON DELETE SET NULL,
  accepted_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_employee_conflict_acceptances_distinct_assignments
    CHECK (assignment_a_id <> assignment_b_id),
  CONSTRAINT event_employee_conflict_acceptances_canonical_order
    CHECK (assignment_a_id::text < assignment_b_id::text),
  CONSTRAINT event_employee_conflict_acceptances_unique_pair
    UNIQUE (assignment_a_id, assignment_b_id)
);

CREATE INDEX IF NOT EXISTS idx_event_employee_conflict_acceptances_employee
  ON public.event_employee_conflict_acceptances(employee_id);

ALTER TABLE public.event_employee_conflict_acceptances ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Event managers and assigned employees can view conflict acceptances"
  ON public.event_employee_conflict_acceptances;
CREATE POLICY "Event managers and assigned employees can view conflict acceptances"
  ON public.event_employee_conflict_acceptances
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.employees employee
      WHERE employee.auth_user_id = auth.uid()
        AND (
          employee.id = event_employee_conflict_acceptances.employee_id
          OR 'admin' = ANY(COALESCE(employee.permissions, ARRAY[]::text[]))
          OR 'events_manage' = ANY(COALESCE(employee.permissions, ARRAY[]::text[]))
        )
    )
  );

DROP POLICY IF EXISTS "Event managers can create conflict acceptances"
  ON public.event_employee_conflict_acceptances;
CREATE POLICY "Event managers can create conflict acceptances"
  ON public.event_employee_conflict_acceptances
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.employees employee
      WHERE employee.auth_user_id = auth.uid()
        AND (
          'admin' = ANY(COALESCE(employee.permissions, ARRAY[]::text[]))
          OR 'events_manage' = ANY(COALESCE(employee.permissions, ARRAY[]::text[]))
        )
    )
  );

DROP POLICY IF EXISTS "Event managers can update conflict acceptances"
  ON public.event_employee_conflict_acceptances;
CREATE POLICY "Event managers can update conflict acceptances"
  ON public.event_employee_conflict_acceptances
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.employees employee
      WHERE employee.auth_user_id = auth.uid()
        AND (
          'admin' = ANY(COALESCE(employee.permissions, ARRAY[]::text[]))
          OR 'events_manage' = ANY(COALESCE(employee.permissions, ARRAY[]::text[]))
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.employees employee
      WHERE employee.auth_user_id = auth.uid()
        AND (
          'admin' = ANY(COALESCE(employee.permissions, ARRAY[]::text[]))
          OR 'events_manage' = ANY(COALESCE(employee.permissions, ARRAY[]::text[]))
        )
    )
  );

CREATE OR REPLACE FUNCTION public.get_employee_realization_conflicts(
  p_employee_id uuid,
  p_event_id uuid,
  p_phase_id uuid
)
RETURNS TABLE (
  conflict_type text,
  conflict_id uuid,
  phase_id uuid,
  event_id uuid,
  event_name text,
  phase_name text,
  assignment_start timestamptz,
  assignment_end timestamptz,
  conflict_status text,
  conflict_details jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_phase public.event_phases%ROWTYPE;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.employees employee
    WHERE employee.auth_user_id = auth.uid()
      AND (
        'admin' = ANY(COALESCE(employee.permissions, ARRAY[]::text[]))
        OR 'events_manage' = ANY(COALESCE(employee.permissions, ARRAY[]::text[]))
      )
  ) THEN
    RAISE EXCEPTION 'Brak uprawnień do sprawdzania obsady realizacyjnej';
  END IF;

  SELECT phase.* INTO STRICT v_phase
  FROM public.event_phases phase
  WHERE phase.id = p_phase_id
    AND phase.event_id = p_event_id;

  RETURN QUERY
  SELECT
    'phase'::text,
    other_assignment.id,
    other_phase.id,
    other_phase.event_id,
    other_event.name,
    other_phase.name,
    COALESCE(other_assignment.phase_work_start, other_assignment.assignment_start, other_phase.start_time),
    COALESCE(other_assignment.phase_work_end, other_assignment.assignment_end, other_phase.end_time),
    other_assignment.invitation_status::text,
    jsonb_build_object(
      'role', other_assignment.role,
      'requested_phase_id', v_phase.id,
      'requested_phase_name', v_phase.name,
      'requested_start', v_phase.start_time,
      'requested_end', v_phase.end_time,
      'realization_assignment', true
    )
  FROM public.event_phase_assignments other_assignment
  JOIN public.event_phases other_phase ON other_phase.id = other_assignment.phase_id
  JOIN public.events other_event ON other_event.id = other_phase.event_id
  WHERE other_assignment.employee_id = p_employee_id
    AND other_phase.event_id <> p_event_id
    AND COALESCE(other_assignment.invitation_status, 'pending') <> 'rejected'
    AND COALESCE(other_assignment.phase_work_start, other_assignment.assignment_start, other_phase.start_time) < v_phase.end_time
    AND COALESCE(other_assignment.phase_work_end, other_assignment.assignment_end, other_phase.end_time) > v_phase.start_time

  UNION ALL

  SELECT
    'absence'::text,
    absence.id,
    NULL::uuid,
    NULL::uuid,
    CASE absence.absence_type
      WHEN 'vacation' THEN 'Urlop wypoczynkowy'
      WHEN 'sick_leave' THEN 'Zwolnienie lekarskie'
      WHEN 'unpaid_leave' THEN 'Urlop bezpłatny'
      WHEN 'parental_leave' THEN 'Urlop macierzyński/ojcowski'
      WHEN 'training' THEN 'Szkolenie'
      WHEN 'business_trip' THEN 'Wyjazd służbowy'
      WHEN 'remote_work' THEN 'Praca zdalna'
      ELSE 'Inna nieobecność'
    END,
    NULL::text,
    absence.start_date,
    absence.end_date,
    absence.approval_status::text,
    jsonb_build_object(
      'absence_type', absence.absence_type,
      'all_day', absence.all_day,
      'notes', absence.notes,
      'requested_phase_id', v_phase.id,
      'requested_phase_name', v_phase.name,
      'requested_start', v_phase.start_time,
      'requested_end', v_phase.end_time
    )
  FROM public.employee_absences absence
  WHERE absence.employee_id = p_employee_id
    AND absence.approval_status::text IN ('approved', 'pending')
    AND absence.start_date < v_phase.end_time
    AND absence.end_date > v_phase.start_time;
END;
$$;

CREATE OR REPLACE FUNCTION public.assign_event_employee_to_phases_with_conflict_decision(
  p_event_id uuid,
  p_employee_id uuid,
  p_phase_ids uuid[],
  p_role text DEFAULT 'technician',
  p_accept_conflicts boolean DEFAULT false,
  p_conflict_reason text DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_phase public.event_phases%ROWTYPE;
  v_phase_id uuid;
  v_inserted integer := 0;
  v_conflict_count integer := 0;
  v_created_by uuid;
BEGIN
  IF p_event_id IS NULL OR p_employee_id IS NULL OR COALESCE(cardinality(p_phase_ids), 0) = 0 THEN
    RAISE EXCEPTION 'event_id, employee_id and phase_ids are required';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM unnest(p_phase_ids) AS requested(requested_phase_id)
    LEFT JOIN public.event_phases phase ON phase.id = requested.requested_phase_id
    WHERE phase.id IS NULL OR phase.event_id <> p_event_id
  ) THEN
    RAISE EXCEPTION 'Każdy etap musi należeć do wybranego wydarzenia';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM unnest(p_phase_ids) AS requested(requested_phase_id)
    JOIN public.event_phases phase ON phase.id = requested.requested_phase_id
    JOIN public.employee_absences absence ON absence.employee_id = p_employee_id
      AND absence.approval_status::text IN ('approved', 'pending')
      AND absence.start_date < phase.end_time
      AND absence.end_date > phase.start_time
  ) THEN
    RAISE EXCEPTION 'Pracownik ma nieobecność pokrywającą się z wybranym etapem. Najpierw wyjaśnij nieobecność.';
  END IF;

  SELECT COUNT(*)::integer INTO v_conflict_count
  FROM unnest(p_phase_ids) AS requested(requested_phase_id)
  JOIN public.event_phases phase ON phase.id = requested.requested_phase_id
  JOIN public.event_phase_assignments other_assignment ON other_assignment.employee_id = p_employee_id
    AND COALESCE(other_assignment.invitation_status, 'pending') <> 'rejected'
  JOIN public.event_phases other_phase ON other_phase.id = other_assignment.phase_id
    AND other_phase.event_id <> p_event_id
  WHERE COALESCE(other_assignment.phase_work_start, other_assignment.assignment_start, other_phase.start_time) < phase.end_time
    AND COALESCE(other_assignment.phase_work_end, other_assignment.assignment_end, other_phase.end_time) > phase.start_time;

  IF v_conflict_count > 0 AND NOT COALESCE(p_accept_conflicts, false) THEN
    RAISE EXCEPTION 'Pracownik ma konflikt realizacyjny. Wymagana jest świadoma akceptacja konfliktu.';
  END IF;

  IF v_conflict_count > 0 AND char_length(btrim(COALESCE(p_conflict_reason, ''))) < 10 THEN
    RAISE EXCEPTION 'Podaj uzasadnienie akceptacji konfliktu (minimum 10 znaków).';
  END IF;

  SELECT employee.id INTO v_created_by
  FROM public.employees employee
  WHERE employee.auth_user_id = auth.uid()
  LIMIT 1;

  FOREACH v_phase_id IN ARRAY p_phase_ids LOOP
    SELECT * INTO STRICT v_phase
    FROM public.event_phases
    WHERE id = v_phase_id;

    INSERT INTO public.event_phase_assignments (
      phase_id,
      employee_id,
      assignment_start,
      assignment_end,
      phase_work_start,
      phase_work_end,
      role,
      invitation_status,
      invitation_email_sent,
      created_by
    )
    SELECT
      v_phase.id,
      p_employee_id,
      v_phase.start_time,
      v_phase.end_time,
      v_phase.start_time,
      v_phase.end_time,
      COALESCE(NULLIF(trim(p_role), ''), 'technician'),
      'pending',
      false,
      v_created_by
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.event_phase_assignments assignment
      WHERE assignment.phase_id = v_phase.id
        AND assignment.employee_id = p_employee_id
    );

    v_inserted := v_inserted + CASE WHEN FOUND THEN 1 ELSE 0 END;
  END LOOP;

  IF v_conflict_count > 0 AND COALESCE(p_accept_conflicts, false) THEN
    INSERT INTO public.event_employee_conflict_acceptances (
      assignment_a_id,
      assignment_b_id,
      employee_id,
      reason,
      accepted_by,
      accepted_by_employee_id,
      accepted_at,
      updated_at
    )
    SELECT
      CASE WHEN current_assignment.id::text < other_assignment.id::text
        THEN current_assignment.id ELSE other_assignment.id END,
      CASE WHEN current_assignment.id::text < other_assignment.id::text
        THEN other_assignment.id ELSE current_assignment.id END,
      p_employee_id,
      btrim(p_conflict_reason),
      auth.uid(),
      v_created_by,
      now(),
      now()
    FROM public.event_phase_assignments current_assignment
    JOIN public.event_phases current_phase ON current_phase.id = current_assignment.phase_id
      AND current_phase.event_id = p_event_id
      AND current_phase.id = ANY(p_phase_ids)
    JOIN public.event_phase_assignments other_assignment ON other_assignment.employee_id = current_assignment.employee_id
      AND other_assignment.id <> current_assignment.id
      AND COALESCE(other_assignment.invitation_status, 'pending') <> 'rejected'
    JOIN public.event_phases other_phase ON other_phase.id = other_assignment.phase_id
      AND other_phase.event_id <> p_event_id
    WHERE current_assignment.employee_id = p_employee_id
      AND COALESCE(other_assignment.phase_work_start, other_assignment.assignment_start, other_phase.start_time) < COALESCE(current_assignment.phase_work_end, current_assignment.assignment_end, current_phase.end_time)
      AND COALESCE(other_assignment.phase_work_end, other_assignment.assignment_end, other_phase.end_time) > COALESCE(current_assignment.phase_work_start, current_assignment.assignment_start, current_phase.start_time)
    ON CONFLICT (assignment_a_id, assignment_b_id)
    DO UPDATE SET
      reason = EXCLUDED.reason,
      accepted_by = EXCLUDED.accepted_by,
      accepted_by_employee_id = EXCLUDED.accepted_by_employee_id,
      accepted_at = EXCLUDED.accepted_at,
      updated_at = now();
  END IF;

  RETURN v_inserted;
END;
$$;

REVOKE ALL ON FUNCTION public.get_employee_realization_conflicts(uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.assign_event_employee_to_phases_with_conflict_decision(uuid, uuid, uuid[], text, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_employee_realization_conflicts(uuid, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.assign_event_employee_to_phases_with_conflict_decision(uuid, uuid, uuid[], text, boolean, text) TO authenticated;

COMMENT ON FUNCTION public.get_employee_realization_conflicts(uuid, uuid, uuid) IS
  'Checks absences and overlapping operational phase assignments only; general event access, author and salesperson roles are intentionally ignored.';
COMMENT ON FUNCTION public.assign_event_employee_to_phases_with_conflict_decision(uuid, uuid, uuid[], text, boolean, text) IS
  'Atomically assigns an operational employee and records an auditable decision for justified cross-event overlaps.';

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
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'event_employee_conflict_acceptances'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.event_employee_conflict_acceptances;
  END IF;
END;
$$;
