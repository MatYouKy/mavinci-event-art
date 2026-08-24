/*
  # Complete operational controls for CRM events

  Adds proactive event alerts, canonical payment milestones, immutable contract
  versions, event closeout, resource preflight, integration health and data/security
  quality checks. The existing event remains the source of truth.
*/

CREATE TABLE IF NOT EXISTS public.event_payment_milestones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  label text NOT NULL,
  milestone_type text NOT NULL DEFAULT 'installment'
    CHECK (milestone_type IN ('deposit', 'installment', 'balance', 'other')),
  amount numeric(12,2) NOT NULL CHECK (amount >= 0),
  due_date date NOT NULL,
  status text NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned', 'invoiced', 'paid', 'overdue', 'waived')),
  invoice_id uuid REFERENCES public.invoices(id) ON DELETE SET NULL,
  paid_amount numeric(12,2) NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
  paid_at timestamptz,
  notes text,
  created_by uuid REFERENCES public.employees(id) ON DELETE SET NULL
    DEFAULT public.current_workflow_employee_id(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS event_payment_milestones_event_due_idx
  ON public.event_payment_milestones(event_id, due_date, status);

CREATE TABLE IF NOT EXISTS public.event_closeouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL UNIQUE REFERENCES public.events(id) ON DELETE CASCADE,
  equipment_returned boolean NOT NULL DEFAULT false,
  vehicles_returned boolean NOT NULL DEFAULT false,
  damages_resolved boolean NOT NULL DEFAULT false,
  subcontractors_settled boolean NOT NULL DEFAULT false,
  employee_time_approved boolean NOT NULL DEFAULT false,
  client_balance_settled boolean NOT NULL DEFAULT false,
  documents_archived boolean NOT NULL DEFAULT false,
  lessons_learned text,
  completed_at timestamptz,
  completed_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.contract_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id uuid NOT NULL REFERENCES public.contracts(id) ON DELETE CASCADE,
  version_number integer NOT NULL CHECK (version_number > 0),
  title text NOT NULL,
  content text NOT NULL,
  generated_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL,
  content_hash text,
  changed_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(contract_id, version_number)
);

ALTER TABLE public.contracts
  ADD COLUMN IF NOT EXISTS version_number integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS content_hash text,
  ADD COLUMN IF NOT EXISTS locked_at timestamptz,
  ADD COLUMN IF NOT EXISTS locked_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS company_signed_at timestamptz,
  ADD COLUMN IF NOT EXISTS company_signed_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS supersedes_contract_id uuid REFERENCES public.contracts(id) ON DELETE SET NULL;

UPDATE public.contracts
SET content_hash=md5(COALESCE(content,'') || COALESCE(generated_data::text,''))
WHERE content_hash IS NULL;

CREATE TABLE IF NOT EXISTS public.event_operational_alert_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reminder_days integer[] NOT NULL DEFAULT ARRAY[30,14,7,3,1,0],
  payment_reminder_days integer[] NOT NULL DEFAULT ARRAY[14,7,3,1,0],
  repeat_overdue_daily boolean NOT NULL DEFAULT true,
  alert_owner boolean NOT NULL DEFAULT true,
  alert_event_managers boolean NOT NULL DEFAULT false,
  alert_admins boolean NOT NULL DEFAULT true,
  is_active boolean NOT NULL DEFAULT true,
  updated_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.event_operational_alert_settings
  ALTER COLUMN alert_event_managers SET DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS event_operational_alert_settings_singleton_idx
  ON public.event_operational_alert_settings ((true));

INSERT INTO public.event_operational_alert_settings(id)
SELECT gen_random_uuid()
WHERE NOT EXISTS (SELECT 1 FROM public.event_operational_alert_settings);

UPDATE public.event_operational_alert_settings
SET alert_owner=true, alert_event_managers=false
WHERE alert_owner IS DISTINCT FROM true OR alert_event_managers IS DISTINCT FROM false;

CREATE TABLE IF NOT EXISTS public.event_operational_alert_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  alert_key text NOT NULL UNIQUE,
  notification_id uuid REFERENCES public.notifications(id) ON DELETE SET NULL,
  kind text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.system_health_alert_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_key text NOT NULL UNIQUE,
  notification_id uuid REFERENCES public.notifications(id) ON DELETE SET NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.event_payment_milestones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_closeouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contract_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_operational_alert_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_operational_alert_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_health_alert_log ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_crm_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.employees employee
    WHERE employee.id = public.current_workflow_employee_id()
      AND employee.is_active = true
      AND (employee.role = 'admin' OR employee.access_level = 'admin')
  );
$$;

CREATE OR REPLACE FUNCTION public.can_view_event_commercials(p_event_id uuid, p_manage boolean DEFAULT false)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.employees employee
    WHERE employee.id = public.current_workflow_employee_id()
      AND employee.is_active = true
      AND (
        employee.role = 'admin' OR employee.access_level = 'admin'
        OR EXISTS (SELECT 1 FROM public.events event WHERE event.id=p_event_id AND event.created_by=employee.id)
        OR (p_manage AND (
          'finances_manage'=ANY(COALESCE(employee.permissions,'{}'::text[]))
          OR 'contracts_manage'=ANY(COALESCE(employee.permissions,'{}'::text[]))
          OR 'invoices_manage'=ANY(COALESCE(employee.permissions,'{}'::text[]))
        ))
        OR (NOT p_manage AND (
          'finances_view'=ANY(COALESCE(employee.permissions,'{}'::text[]))
          OR 'finances_manage'=ANY(COALESCE(employee.permissions,'{}'::text[]))
          OR 'contracts_view'=ANY(COALESCE(employee.permissions,'{}'::text[]))
          OR 'contracts_manage'=ANY(COALESCE(employee.permissions,'{}'::text[]))
          OR 'invoices_view'=ANY(COALESCE(employee.permissions,'{}'::text[]))
          OR 'invoices_manage'=ANY(COALESCE(employee.permissions,'{}'::text[]))
        ))
      )
  );
$$;

DROP POLICY IF EXISTS "payment milestones follow event access" ON public.event_payment_milestones;
CREATE POLICY "payment milestones follow event access" ON public.event_payment_milestones
  FOR SELECT TO authenticated USING (public.can_view_event_commercials(event_id, false));
DROP POLICY IF EXISTS "payment milestones are managed" ON public.event_payment_milestones;
CREATE POLICY "payment milestones are managed" ON public.event_payment_milestones
  FOR ALL TO authenticated USING (public.can_view_event_commercials(event_id, true))
  WITH CHECK (public.can_view_event_commercials(event_id, true));

DROP POLICY IF EXISTS "event closeouts follow event access" ON public.event_closeouts;
CREATE POLICY "event closeouts follow event access" ON public.event_closeouts
  FOR SELECT TO authenticated USING (public.can_view_event_workflows(event_id));
DROP POLICY IF EXISTS "event closeouts are managed" ON public.event_closeouts;
CREATE POLICY "event closeouts are managed" ON public.event_closeouts
  FOR ALL TO authenticated USING (public.can_manage_event_workflows(event_id))
  WITH CHECK (public.can_manage_event_workflows(event_id));

DROP POLICY IF EXISTS "contract versions follow contract access" ON public.contract_versions;
CREATE POLICY "contract versions follow contract access" ON public.contract_versions
  FOR SELECT TO authenticated USING (EXISTS (
    SELECT 1 FROM public.contracts contract
    WHERE contract.id = contract_id AND public.can_view_event_commercials(contract.event_id, false)
  ));

DROP POLICY IF EXISTS "operational settings admin read" ON public.event_operational_alert_settings;
CREATE POLICY "operational settings admin read" ON public.event_operational_alert_settings
  FOR SELECT TO authenticated USING (public.is_crm_admin());
DROP POLICY IF EXISTS "operational settings admin write" ON public.event_operational_alert_settings;
CREATE POLICY "operational settings admin write" ON public.event_operational_alert_settings
  FOR ALL TO authenticated USING (public.is_crm_admin())
  WITH CHECK (public.is_crm_admin());

DROP POLICY IF EXISTS "operational alerts follow event access" ON public.event_operational_alert_log;
CREATE POLICY "operational alerts follow event access" ON public.event_operational_alert_log
  FOR SELECT TO authenticated USING (public.can_view_event_workflows(event_id));

DROP POLICY IF EXISTS "system health alerts admin read" ON public.system_health_alert_log;
CREATE POLICY "system health alerts admin read" ON public.system_health_alert_log
  FOR SELECT TO authenticated USING (public.is_crm_admin());

CREATE OR REPLACE FUNCTION public.refresh_event_payment_milestone_status()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'waived' THEN
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  IF NEW.paid_at IS NOT NULL OR (NEW.amount > 0 AND NEW.paid_amount >= NEW.amount) THEN
    NEW.status := 'paid';
    NEW.paid_at := COALESCE(NEW.paid_at, now());
  ELSIF NEW.due_date < CURRENT_DATE THEN
    NEW.status := 'overdue';
  ELSIF NEW.invoice_id IS NOT NULL THEN
    NEW.status := 'invoiced';
  ELSE
    NEW.status := 'planned';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS refresh_event_payment_milestone_status_trigger ON public.event_payment_milestones;
CREATE TRIGGER refresh_event_payment_milestone_status_trigger
  BEFORE INSERT OR UPDATE ON public.event_payment_milestones
  FOR EACH ROW EXECUTE FUNCTION public.refresh_event_payment_milestone_status();

CREATE OR REPLACE FUNCTION public.sync_paid_invoice_to_payment_milestone()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'paid' AND OLD.status IS DISTINCT FROM NEW.status THEN
    UPDATE public.event_payment_milestones
    SET paid_amount = amount, paid_at = COALESCE(NEW.paid_date::timestamptz, now()), status = 'paid'
    WHERE invoice_id = NEW.id AND status <> 'waived';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_paid_invoice_to_payment_milestone_trigger ON public.invoices;
CREATE TRIGGER sync_paid_invoice_to_payment_milestone_trigger
  AFTER UPDATE OF status ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.sync_paid_invoice_to_payment_milestone();

CREATE OR REPLACE FUNCTION public.update_event_closeout_completion()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  IF NEW.equipment_returned AND NEW.vehicles_returned AND NEW.damages_resolved
    AND NEW.subcontractors_settled AND NEW.employee_time_approved
    AND NEW.client_balance_settled AND NEW.documents_archived THEN
    NEW.completed_at := COALESCE(NEW.completed_at, now());
    NEW.completed_by := COALESCE(NEW.completed_by, public.current_workflow_employee_id());
  ELSE
    NEW.completed_at := NULL;
    NEW.completed_by := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS update_event_closeout_completion_trigger ON public.event_closeouts;
CREATE TRIGGER update_event_closeout_completion_trigger
  BEFORE INSERT OR UPDATE ON public.event_closeouts
  FOR EACH ROW EXECUTE FUNCTION public.update_event_closeout_completion();

CREATE OR REPLACE FUNCTION public.snapshot_contract_version()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.content IS DISTINCT FROM NEW.content OR OLD.title IS DISTINCT FROM NEW.title
    OR OLD.generated_data IS DISTINCT FROM NEW.generated_data THEN
    IF OLD.locked_at IS NOT NULL OR OLD.status::text = 'signed_returned' THEN
      RAISE EXCEPTION 'Podpisana umowa jest zablokowana. Utwórz nową wersję dokumentu.';
    END IF;

    INSERT INTO public.contract_versions(
      contract_id, version_number, title, content, generated_data, status, content_hash, changed_by
    ) VALUES (
      OLD.id, OLD.version_number, OLD.title, OLD.content, COALESCE(OLD.generated_data, '{}'::jsonb),
      OLD.status::text, OLD.content_hash, public.current_workflow_employee_id()
    ) ON CONFLICT (contract_id, version_number) DO NOTHING;
    NEW.version_number := OLD.version_number + 1;
  END IF;

  NEW.content_hash := md5(COALESCE(NEW.content,'') || COALESCE(NEW.generated_data::text,''));

  IF NEW.status::text = 'signed_returned' AND OLD.status::text IS DISTINCT FROM 'signed_returned' THEN
    NEW.locked_at := COALESCE(NEW.locked_at, now());
    NEW.locked_by := COALESCE(NEW.locked_by, public.current_workflow_employee_id());
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS snapshot_contract_version_trigger ON public.contracts;
CREATE TRIGGER snapshot_contract_version_trigger
  BEFORE UPDATE ON public.contracts
  FOR EACH ROW EXECUTE FUNCTION public.snapshot_contract_version();

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
    SELECT assignment.employee_id, other_assignment.event_id::text AS conflict_id
    FROM public.employee_assignments assignment
    JOIN public.event_timeline_bounds current_bounds ON current_bounds.event_id=assignment.event_id
    JOIN public.employee_assignments other_assignment ON other_assignment.employee_id=assignment.employee_id
      AND other_assignment.event_id<>assignment.event_id
      AND COALESCE(other_assignment.status,'accepted')<>'rejected'
    JOIN public.event_timeline_bounds other_bounds ON other_bounds.event_id=other_assignment.event_id
    WHERE assignment.event_id=p_event_id
      AND COALESCE(assignment.status,'accepted')='accepted'
      AND current_bounds.timeline_start<other_bounds.timeline_end
      AND other_bounds.timeline_start<current_bounds.timeline_end
    UNION
    SELECT assignment.employee_id, absence.id::text
    FROM public.employee_assignments assignment
    JOIN public.event_timeline_bounds current_bounds ON current_bounds.event_id=assignment.event_id
    JOIN public.employee_absences absence ON absence.employee_id=assignment.employee_id
    WHERE assignment.event_id=p_event_id
      AND COALESCE(assignment.status,'accepted')='accepted'
      AND absence.approval_status::text IN ('approved','pending')
      AND absence.start_date<current_bounds.timeline_end
      AND absence.end_date>current_bounds.timeline_start
  ) conflicts;
  IF employee_conflicts > 0 THEN
    issues := issues || jsonb_build_array(jsonb_build_object('code','employee_conflicts','label',format('Konflikty terminów pracowników: %s', employee_conflicts),'severity','critical','tab','team'));
  END IF;

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
    'issues', issues
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_event_preflight(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
BEGIN
  IF NOT public.can_manage_event_workflows(p_event_id) THEN
    RAISE EXCEPTION 'Brak dostępu do kontroli wydarzenia';
  END IF;
  RETURN public.get_event_preflight_core(p_event_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.event_workflow_requirement_is_met(
  p_event_id uuid,
  p_requirement_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  requirement_key text;
  instance_id_value uuid;
  manually_completed boolean;
BEGIN
  SELECT requirement.requirement_key, instance.id
  INTO requirement_key, instance_id_value
  FROM public.event_workflow_requirements requirement
  JOIN public.event_workflow_stages stage ON stage.id = requirement.stage_id
  JOIN public.event_workflow_instances instance ON instance.template_id = stage.template_id
  WHERE requirement.id = p_requirement_id AND instance.event_id = p_event_id;

  SELECT override.is_completed INTO manually_completed
  FROM public.event_workflow_requirement_overrides override
  WHERE override.instance_id = instance_id_value AND override.requirement_id = p_requirement_id;
  IF manually_completed IS TRUE THEN RETURN true; END IF;

  CASE requirement_key
    WHEN 'event_details_complete' THEN RETURN EXISTS (
      SELECT 1 FROM public.events event WHERE event.id = p_event_id AND event.event_date IS NOT NULL
        AND NULLIF(BTRIM(COALESCE(event.location, '')), '') IS NOT NULL
        AND (event.contact_person_id IS NOT NULL OR event.organization_id IS NOT NULL));
    WHEN 'client_assigned' THEN RETURN EXISTS (
      SELECT 1 FROM public.events event WHERE event.id = p_event_id
        AND (event.contact_person_id IS NOT NULL OR event.organization_id IS NOT NULL));
    WHEN 'offer_accepted' THEN RETURN EXISTS (
      SELECT 1 FROM public.offers offer WHERE offer.event_id = p_event_id AND offer.status::text IN ('accepted','approved','won'));
    WHEN 'contract_signed' THEN RETURN EXISTS (
      SELECT 1 FROM public.contracts contract WHERE contract.event_id = p_event_id
        AND contract.status::text IN ('signed_by_client','signed_returned','completed'));
    WHEN 'deposit_paid' THEN RETURN EXISTS (
      SELECT 1 FROM public.event_payment_milestones milestone WHERE milestone.event_id = p_event_id
        AND milestone.milestone_type = 'deposit' AND milestone.status IN ('paid','waived'));
    WHEN 'final_payment_paid' THEN RETURN NOT EXISTS (
      SELECT 1 FROM public.event_payment_milestones milestone WHERE milestone.event_id = p_event_id
        AND milestone.status NOT IN ('paid','waived'));
    WHEN 'team_assigned' THEN RETURN EXISTS (
      SELECT 1 FROM public.employee_assignments assignment WHERE assignment.event_id = p_event_id
        AND COALESCE(assignment.status,'accepted') = 'accepted');
    WHEN 'equipment_assigned' THEN RETURN EXISTS (SELECT 1 FROM public.event_equipment equipment WHERE equipment.event_id = p_event_id);
    WHEN 'vehicle_assigned' THEN RETURN EXISTS (
      SELECT 1 FROM public.event_vehicles vehicle WHERE vehicle.event_id = p_event_id AND COALESCE(vehicle.status,'planned') <> 'cancelled');
    WHEN 'agenda_ready' THEN RETURN EXISTS (SELECT 1 FROM public.event_agendas agenda WHERE agenda.event_id = p_event_id);
    WHEN 'tasks_complete' THEN RETURN NOT EXISTS (
      SELECT 1 FROM public.tasks task WHERE task.event_id = p_event_id AND task.status::text NOT IN ('completed','cancelled')
        AND NOT EXISTS (SELECT 1 FROM public.event_workflow_tasks workflow_task WHERE workflow_task.task_id = task.id));
    WHEN 'invoice_issued' THEN RETURN EXISTS (
      SELECT 1 FROM public.invoices invoice WHERE invoice.event_id = p_event_id AND invoice.status IN ('issued','sent','paid','overdue'));
    WHEN 'invoice_paid' THEN RETURN EXISTS (SELECT 1 FROM public.invoices invoice WHERE invoice.event_id = p_event_id AND invoice.status = 'paid');
    WHEN 'wedding_card_ready' THEN RETURN EXISTS (
      SELECT 1 FROM public.wedding_cards card WHERE card.event_id = p_event_id AND card.status IN ('submitted','approved'));
    WHEN 'preflight_clear' THEN RETURN COALESCE((public.get_event_preflight_core(p_event_id)->>'ready')::boolean, false);
    WHEN 'closeout_complete' THEN RETURN EXISTS (
      SELECT 1 FROM public.event_closeouts closeout WHERE closeout.event_id = p_event_id AND closeout.completed_at IS NOT NULL);
    ELSE RETURN COALESCE(manually_completed, false);
  END CASE;
END;
$$;

DO $$
DECLARE stage_record record;
BEGIN
  FOR stage_record IN
    SELECT stage.id, stage.name FROM public.event_workflow_stages stage
  LOOP
    IF LOWER(stage_record.name) LIKE '%formal%' THEN
      INSERT INTO public.event_workflow_requirements(stage_id, requirement_key, label, order_index, auto_create_task, task_title)
      SELECT stage_record.id, 'deposit_paid', 'Zaliczka zaksięgowana', 40, true, 'Dopilnuj wpłaty zaliczki'
      WHERE NOT EXISTS (SELECT 1 FROM public.event_workflow_requirements WHERE stage_id = stage_record.id AND requirement_key = 'deposit_paid');
    ELSIF LOWER(stage_record.name) LIKE '%gotowo%' THEN
      INSERT INTO public.event_workflow_requirements(stage_id, requirement_key, label, order_index)
      SELECT stage_record.id, 'preflight_clear', 'Kontrola przed wydarzeniem bez błędów krytycznych', 90
      WHERE NOT EXISTS (SELECT 1 FROM public.event_workflow_requirements WHERE stage_id = stage_record.id AND requirement_key = 'preflight_clear');
    ELSIF LOWER(stage_record.name) LIKE '%rozlicz%' OR LOWER(stage_record.name) LIKE '%zamkni%' THEN
      INSERT INTO public.event_workflow_requirements(stage_id, requirement_key, label, order_index)
      SELECT stage_record.id, 'final_payment_paid', 'Wszystkie płatności rozliczone', 40
      WHERE NOT EXISTS (SELECT 1 FROM public.event_workflow_requirements WHERE stage_id = stage_record.id AND requirement_key = 'final_payment_paid');
      INSERT INTO public.event_workflow_requirements(stage_id, requirement_key, label, order_index)
      SELECT stage_record.id, 'closeout_complete', 'Zamknięcie wydarzenia zakończone', 50
      WHERE NOT EXISTS (SELECT 1 FROM public.event_workflow_requirements WHERE stage_id = stage_record.id AND requirement_key = 'closeout_complete');
    END IF;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.create_event_operational_notification(
  p_event_id uuid, p_alert_key text, p_kind text, p_title text, p_message text, p_type text, p_metadata jsonb
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE notification_id_value uuid;
DECLARE recipient record;
DECLARE settings_record record;
BEGIN
  IF EXISTS (SELECT 1 FROM public.event_operational_alert_log WHERE alert_key = p_alert_key) THEN RETURN false; END IF;

  SELECT * INTO settings_record
  FROM public.event_operational_alert_settings
  WHERE is_active=true
  ORDER BY updated_at DESC
  LIMIT 1;

  INSERT INTO public.notifications(title,message,type,category,action_url,related_entity_type,related_entity_id,metadata,created_at)
  VALUES (p_title,p_message,p_type,'event',format('/crm/events/%s',p_event_id),'event',p_event_id,p_metadata,now())
  RETURNING id INTO notification_id_value;

  FOR recipient IN
    SELECT DISTINCT auth_user.id AS user_id
    FROM public.employees employee
    JOIN auth.users auth_user ON auth_user.id = COALESCE(employee.auth_user_id, employee.id)
    LEFT JOIN public.events event ON event.id = p_event_id
    LEFT JOIN public.employee_assignments assignment ON assignment.event_id = p_event_id AND assignment.employee_id = employee.id
    WHERE employee.is_active = true AND (
      (COALESCE(settings_record.alert_admins,true) AND (employee.role = 'admin' OR employee.access_level = 'admin'))
      OR (COALESCE(settings_record.alert_owner,true)
        AND (employee.id = event.created_by OR employee.auth_user_id = event.created_by))
      OR (COALESCE(settings_record.alert_event_managers,true)
        AND 'events_manage' = ANY(COALESCE(employee.permissions,'{}'::text[])) AND assignment.id IS NOT NULL)
    )
  LOOP
    INSERT INTO public.notification_recipients(notification_id,user_id,is_read)
    VALUES (notification_id_value,recipient.user_id,false)
    ON CONFLICT (notification_id,user_id) DO NOTHING;
  END LOOP;

  INSERT INTO public.event_operational_alert_log(event_id,alert_key,notification_id,kind,details)
  VALUES (p_event_id,p_alert_key,notification_id_value,p_kind,p_metadata);
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.process_event_operational_alerts()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE settings_record record;
DECLARE event_record record;
DECLARE milestone_record record;
DECLARE preflight jsonb;
DECLARE issue_labels text;
DECLARE days_left integer;
DECLARE alert_count integer := 0;
BEGIN
  SELECT * INTO settings_record FROM public.event_operational_alert_settings WHERE is_active = true ORDER BY updated_at DESC LIMIT 1;
  IF settings_record.id IS NULL THEN RETURN 0; END IF;

  alert_count := alert_count + COALESCE(public.notify_overdue_event_workflows(),0);

  UPDATE public.event_payment_milestones SET status = status WHERE status NOT IN ('paid','waived');

  FOR event_record IN
    SELECT event.* FROM public.events event
    WHERE event.status::text NOT IN ('cancelled','completed')
      AND event.event_date >= now() - interval '1 day'
      AND event.event_date <= now() + interval '31 days'
  LOOP
    days_left := (event_record.event_date AT TIME ZONE 'Europe/Warsaw')::date - (now() AT TIME ZONE 'Europe/Warsaw')::date;
    IF days_left = ANY(settings_record.reminder_days) THEN
      preflight := public.get_event_preflight_core(event_record.id);
      IF NOT COALESCE((preflight->>'ready')::boolean,false) THEN
        SELECT string_agg(item->>'label', '; ') INTO issue_labels
        FROM jsonb_array_elements(preflight->'issues') item;
        IF public.create_event_operational_notification(
          event_record.id,
          format('event-readiness:%s:%s',event_record.id,days_left),
          'event_readiness',
          CASE WHEN days_left = 0 THEN 'Wydarzenie dzisiaj — są niezapięte sprawy' ELSE format('Wydarzenie za %s dni — wymaga działania',days_left) END,
          LEFT(COALESCE(issue_labels,'Wydarzenie nie jest gotowe'),900),
          CASE WHEN (preflight->>'critical_count')::integer > 0 THEN 'error' ELSE 'warning' END,
          preflight || jsonb_build_object('kind','event_readiness','days_left',days_left)
        ) THEN alert_count := alert_count + 1; END IF;
      END IF;
    END IF;
  END LOOP;

  FOR milestone_record IN
    SELECT milestone.*, event.name AS event_name
    FROM public.event_payment_milestones milestone
    JOIN public.events event ON event.id = milestone.event_id
    WHERE milestone.status NOT IN ('paid','waived')
  LOOP
    days_left := milestone_record.due_date - CURRENT_DATE;
    IF days_left = ANY(settings_record.payment_reminder_days) OR (days_left < 0 AND settings_record.repeat_overdue_daily) THEN
      IF public.create_event_operational_notification(
        milestone_record.event_id,
        CASE WHEN days_left < 0 THEN format('payment-overdue:%s:%s',milestone_record.id,CURRENT_DATE)
             ELSE format('payment-due:%s:%s',milestone_record.id,days_left) END,
        'payment_due',
        CASE WHEN days_left < 0 THEN 'Płatność po terminie' ELSE format('Termin płatności za %s dni',days_left) END,
        format('„%s” — %s: %s zł, termin %s.',milestone_record.event_name,milestone_record.label,milestone_record.amount,milestone_record.due_date),
        CASE WHEN days_left < 0 THEN 'error' ELSE 'warning' END,
        jsonb_build_object('kind','event_payment','milestone_id',milestone_record.id,'days_left',days_left,'tab','finances')
      ) THEN alert_count := alert_count + 1; END IF;
    END IF;
  END LOOP;
  RETURN alert_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_crm_system_health()
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'generated_at', now(),
    'services', jsonb_build_array(
      jsonb_build_object('key','push','label','Powiadomienia push','failed',(
        SELECT COUNT(*) FROM public.notification_push_deliveries WHERE status='failed' AND created_at > now()-interval '24 hours'
      ),'pending',(
        SELECT COUNT(*) FROM public.notification_push_deliveries WHERE status='processing' AND created_at < now()-interval '15 minutes'
      )),
      jsonb_build_object('key','ksef','label','Synchronizacja KSeF','failed',(
        SELECT COUNT(*) FROM public.ksef_sync_log WHERE status::text='error' AND started_at > now()-interval '24 hours'
      ),'pending',0),
      jsonb_build_object('key','webhooks','label','Webhooki przychodzące','failed',(
        SELECT COUNT(*) FROM public.inbound_events WHERE status='failed' AND created_at > now()-interval '24 hours'
      ),'pending',(
        SELECT COUNT(*) FROM public.inbound_events WHERE status='received' AND created_at < now()-interval '15 minutes'
      )),
      jsonb_build_object('key','email_ai','label','Analiza wiadomości AI','failed',(
        SELECT COUNT(*) FROM public.email_ai_qualifications WHERE status='failed' AND created_at > now()-interval '24 hours'
      ),'pending',(
        SELECT COUNT(*) FROM public.email_ai_qualifications WHERE status IN ('pending','processing') AND created_at < now()-interval '30 minutes'
      ))
    )
  ) WHERE public.is_crm_admin();
$$;

CREATE OR REPLACE FUNCTION public.get_crm_data_quality()
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'duplicate_contact_emails', (SELECT COALESCE(SUM(item.count-1),0) FROM (SELECT COUNT(*) count FROM public.contacts WHERE NULLIF(lower(trim(email)),'') IS NOT NULL GROUP BY lower(trim(email)) HAVING COUNT(*)>1) item),
    'duplicate_contact_phones', (SELECT COALESCE(SUM(item.count-1),0) FROM (SELECT COUNT(*) count FROM public.contacts WHERE NULLIF(regexp_replace(COALESCE(phone,''),'\D','','g'),'') IS NOT NULL GROUP BY regexp_replace(phone,'\D','','g') HAVING COUNT(*)>1) item),
    'duplicate_organization_nips', (SELECT COALESCE(SUM(item.count-1),0) FROM (SELECT COUNT(*) count FROM public.organizations WHERE NULLIF(regexp_replace(COALESCE(nip,''),'\D','','g'),'') IS NOT NULL GROUP BY regexp_replace(nip,'\D','','g') HAVING COUNT(*)>1) item),
    'upcoming_events_missing_contact', (SELECT COUNT(*) FROM public.events WHERE event_date BETWEEN now() AND now()+interval '60 days' AND contact_person_id IS NULL AND organization_id IS NULL AND status::text<>'cancelled'),
    'upcoming_events_missing_location', (SELECT COUNT(*) FROM public.events WHERE event_date BETWEEN now() AND now()+interval '60 days' AND NULLIF(trim(COALESCE(location,'')),'') IS NULL AND status::text<>'cancelled'),
    'upcoming_events_missing_owner', (SELECT COUNT(*) FROM public.events WHERE event_date BETWEEN now() AND now()+interval '60 days' AND created_by IS NULL AND status::text<>'cancelled'),
    'inactive_employees_on_future_events', (SELECT COUNT(DISTINCT assignment.employee_id) FROM public.employee_assignments assignment JOIN public.employees employee ON employee.id=assignment.employee_id JOIN public.events event ON event.id=assignment.event_id WHERE employee.is_active=false AND event.event_date>now() AND COALESCE(assignment.status,'accepted')<>'rejected')
  ) WHERE public.is_crm_admin();
$$;

CREATE OR REPLACE FUNCTION public.get_crm_security_health()
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_catalog
AS $$
  SELECT jsonb_build_object(
    'tables_without_rls', (SELECT COUNT(*) FROM pg_class relation JOIN pg_namespace namespace ON namespace.oid=relation.relnamespace WHERE namespace.nspname='public' AND relation.relkind='r' AND relation.relrowsecurity=false AND relation.relname NOT LIKE 'spatial_ref_sys'),
    'public_storage_buckets', (SELECT COUNT(*) FROM storage.buckets WHERE public=true),
    'active_employees_without_auth_mapping', (SELECT COUNT(*) FROM public.employees WHERE is_active=true AND auth_user_id IS NULL AND id NOT IN (SELECT id FROM auth.users)),
    'security_definer_without_fixed_search_path', (SELECT COUNT(*) FROM pg_proc procedure JOIN pg_namespace namespace ON namespace.oid=procedure.pronamespace WHERE namespace.nspname='public' AND procedure.prosecdef=true AND NOT EXISTS (SELECT 1 FROM unnest(COALESCE(procedure.proconfig,'{}'::text[])) config WHERE config LIKE 'search_path=%'))
  ) WHERE public.is_crm_admin();
$$;

CREATE OR REPLACE FUNCTION public.process_crm_system_health_alerts()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  service_record record;
  recipient record;
  notification_id_value uuid;
  alert_key_value text;
  sent_count integer := 0;
BEGIN
  FOR service_record IN
    SELECT * FROM (
      SELECT 'push'::text AS service_key, 'Powiadomienia push'::text AS service_label,
        (SELECT COUNT(*) FROM public.notification_push_deliveries WHERE status='failed' AND created_at > now()-interval '24 hours')::integer AS failed,
        (SELECT COUNT(*) FROM public.notification_push_deliveries WHERE status='processing' AND created_at < now()-interval '15 minutes')::integer AS pending
      UNION ALL
      SELECT 'ksef', 'Synchronizacja KSeF',
        (SELECT COUNT(*) FROM public.ksef_sync_log WHERE status::text='error' AND started_at > now()-interval '24 hours')::integer, 0
      UNION ALL
      SELECT 'webhooks', 'Webhooki przychodzące',
        (SELECT COUNT(*) FROM public.inbound_events WHERE status='failed' AND created_at > now()-interval '24 hours')::integer,
        (SELECT COUNT(*) FROM public.inbound_events WHERE status='received' AND created_at < now()-interval '15 minutes')::integer
      UNION ALL
      SELECT 'email_ai', 'Analiza wiadomości AI',
        (SELECT COUNT(*) FROM public.email_ai_qualifications WHERE status='failed' AND created_at > now()-interval '24 hours')::integer,
        (SELECT COUNT(*) FROM public.email_ai_qualifications WHERE status IN ('pending','processing') AND created_at < now()-interval '30 minutes')::integer
    ) services
    WHERE services.failed > 0 OR services.pending > 0
  LOOP
    alert_key_value := format('system-health:%s:%s', service_record.service_key, CURRENT_DATE);
    IF EXISTS (SELECT 1 FROM public.system_health_alert_log WHERE alert_key=alert_key_value) THEN
      CONTINUE;
    END IF;

    INSERT INTO public.notifications(title,message,type,category,action_url,metadata,created_at)
    VALUES (
      'Integracja wymaga uwagi',
      format('%s: błędy z ostatnich 24 h: %s, operacje zablokowane w kolejce: %s.',service_record.service_label,service_record.failed,service_record.pending),
      CASE WHEN service_record.failed > 0 THEN 'error' ELSE 'warning' END,
      'system','/crm/settings/system-health',
      jsonb_build_object('kind','system_health','service',service_record.service_key,'failed',service_record.failed,'pending',service_record.pending),now()
    ) RETURNING id INTO notification_id_value;

    FOR recipient IN
      SELECT DISTINCT auth_user.id AS user_id
      FROM public.employees employee
      JOIN auth.users auth_user ON auth_user.id=COALESCE(employee.auth_user_id,employee.id)
      WHERE employee.is_active=true AND (employee.role='admin' OR employee.access_level='admin')
    LOOP
      INSERT INTO public.notification_recipients(notification_id,user_id,is_read)
      VALUES (notification_id_value,recipient.user_id,false)
      ON CONFLICT (notification_id,user_id) DO NOTHING;
    END LOOP;

    INSERT INTO public.system_health_alert_log(alert_key,notification_id,details)
    VALUES (alert_key_value,notification_id_value,jsonb_build_object('service',service_record.service_key,'failed',service_record.failed,'pending',service_record.pending));
    sent_count := sent_count + 1;
  END LOOP;
  RETURN sent_count;
END;
$$;

REVOKE ALL ON FUNCTION public.get_event_preflight(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_event_preflight_core(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_crm_admin() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_view_event_commercials(uuid,boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_event_operational_notification(uuid,text,text,text,text,text,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.process_event_operational_alerts() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_crm_system_health() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_crm_data_quality() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_crm_security_health() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.process_crm_system_health_alerts() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_event_preflight(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_crm_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_view_event_commercials(uuid,boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_crm_system_health() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_crm_data_quality() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_crm_security_health() TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.event_payment_milestones,public.event_closeouts TO authenticated;
GRANT SELECT ON public.contract_versions,public.event_operational_alert_log,public.system_health_alert_log TO authenticated;
GRANT SELECT,UPDATE ON public.event_operational_alert_settings TO authenticated;

DROP TRIGGER IF EXISTS refresh_workflow_after_payment_milestone ON public.event_payment_milestones;
CREATE TRIGGER refresh_workflow_after_payment_milestone
  AFTER INSERT OR UPDATE OR DELETE ON public.event_payment_milestones
  FOR EACH ROW EXECUTE FUNCTION public.refresh_event_workflow_after_related_change();

DROP TRIGGER IF EXISTS refresh_workflow_after_closeout ON public.event_closeouts;
CREATE TRIGGER refresh_workflow_after_closeout
  AFTER INSERT OR UPDATE OR DELETE ON public.event_closeouts
  FOR EACH ROW EXECUTE FUNCTION public.refresh_event_workflow_after_related_change();

DO $schedule_complete_event_controls$
DECLARE job_id bigint;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname='cron') THEN
    FOR job_id IN EXECUTE 'SELECT jobid FROM cron.job WHERE jobname IN (''notify-overdue-event-workflows'',''process-event-operational-alerts'',''process-crm-system-health-alerts'')' LOOP
      EXECUTE 'SELECT cron.unschedule($1)' USING job_id;
    END LOOP;
    EXECUTE 'SELECT cron.schedule($1,$2,$3)'
      USING 'process-event-operational-alerts','20 * * * *','SELECT public.process_event_operational_alerts();';
    EXECUTE 'SELECT cron.schedule($1,$2,$3)'
      USING 'process-crm-system-health-alerts','35 * * * *','SELECT public.process_crm_system_health_alerts();';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Could not schedule complete event controls: %',SQLERRM;
END;
$schedule_complete_event_controls$;

COMMENT ON TABLE public.event_payment_milestones IS 'Canonical schedule of deposits, installments and final balances for an event.';
COMMENT ON FUNCTION public.get_event_preflight(uuid) IS 'One pre-event validation for contracts, payments, people, equipment, vehicles, agenda and tasks.';
