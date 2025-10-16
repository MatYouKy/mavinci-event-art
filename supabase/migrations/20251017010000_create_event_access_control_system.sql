/*
  # Event Access Control System with Audit Trail

  1. Concept
    - Event AUTHOR (creator) - full control, can do everything
    - INVITED members - see limited info, read-only by default
    - COLLABORATORS - invited members with elevated permissions (can edit specific things)
    - All changes are tracked in audit log

  2. New Tables
    - `event_access_levels` - defines access levels per event assignment
    - `event_audit_log` - comprehensive audit trail of all changes

  3. Changes to employee_assignments
    - Add `access_level_id` - references access_levels table
    - Add `can_edit_event` - can edit basic event info
    - Add `can_edit_agenda` - can edit agenda/timeline
    - Add `can_edit_tasks` - can manage tasks
    - Add `can_edit_files` - can upload/delete files
    - Add `can_edit_equipment` - can manage equipment
    - Add `can_invite_members` - can invite other people
    - Add `can_view_budget` - can see financial info
    - Add `granted_by` - who gave these permissions
    - Add `permissions_updated_at` - when permissions were last changed

  4. Audit Trail
    - Tracks WHO changed WHAT and WHEN
    - Tracks before/after values
    - Tracks context (IP, user agent if available)
*/

-- Step 1: Add access control columns to employee_assignments
ALTER TABLE employee_assignments
  ADD COLUMN IF NOT EXISTS access_level_id uuid REFERENCES access_levels(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS can_edit_event boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS can_edit_agenda boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS can_edit_tasks boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS can_edit_files boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS can_edit_equipment boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS can_invite_members boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS can_view_budget boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS granted_by uuid REFERENCES employees(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS permissions_updated_at timestamptz;

-- Step 2: Create comprehensive audit log table
CREATE TABLE IF NOT EXISTS event_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  action text NOT NULL, -- 'create', 'update', 'delete', 'invite', 'accept', 'reject', 'grant_permission', 'revoke_permission'
  entity_type text NOT NULL, -- 'event', 'task', 'file', 'equipment', 'member', 'permission'
  entity_id text, -- ID of the affected entity
  field_name text, -- specific field that was changed (for updates)
  old_value jsonb, -- previous value
  new_value jsonb, -- new value
  metadata jsonb DEFAULT '{}', -- additional context (IP, user agent, etc.)
  created_at timestamptz DEFAULT now()
);

-- Indexes for audit log
CREATE INDEX IF NOT EXISTS idx_event_audit_log_event_id ON event_audit_log(event_id);
CREATE INDEX IF NOT EXISTS idx_event_audit_log_employee_id ON event_audit_log(employee_id);
CREATE INDEX IF NOT EXISTS idx_event_audit_log_created_at ON event_audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_event_audit_log_action ON event_audit_log(action);
CREATE INDEX IF NOT EXISTS idx_event_audit_log_entity_type ON event_audit_log(entity_type);

-- Enable RLS on audit log
ALTER TABLE event_audit_log ENABLE ROW LEVEL SECURITY;

-- RLS Policies for audit log
-- Event creator and managers can view all audit logs for their events
CREATE POLICY "Users can view audit logs for their events"
  ON event_audit_log FOR SELECT
  TO authenticated
  USING (
    -- Event author can see everything
    EXISTS (
      SELECT 1 FROM events e
      WHERE e.id = event_audit_log.event_id
      AND e.created_by = auth.uid()
    )
    OR
    -- Admins with events_manage can see everything
    EXISTS (
      SELECT 1 FROM employees emp
      WHERE emp.id = auth.uid()
      AND 'events_manage' = ANY(emp.permissions)
    )
    OR
    -- Collaborators with elevated permissions can see logs
    EXISTS (
      SELECT 1 FROM employee_assignments ea
      WHERE ea.event_id = event_audit_log.event_id
      AND ea.employee_id = auth.uid()
      AND (ea.can_edit_event = true OR ea.can_invite_members = true)
    )
  );

-- System can insert audit logs (via triggers)
CREATE POLICY "System can insert audit logs"
  ON event_audit_log FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Step 3: Create helper function to log changes
CREATE OR REPLACE FUNCTION log_event_change()
RETURNS TRIGGER AS $$
BEGIN
  -- Log the change based on the operation
  IF TG_OP = 'INSERT' THEN
    INSERT INTO event_audit_log (
      event_id,
      employee_id,
      action,
      entity_type,
      entity_id,
      new_value,
      metadata
    ) VALUES (
      COALESCE(NEW.event_id, NEW.id),
      auth.uid(),
      'create',
      TG_TABLE_NAME,
      NEW.id::text,
      to_jsonb(NEW),
      jsonb_build_object('table', TG_TABLE_NAME)
    );
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO event_audit_log (
      event_id,
      employee_id,
      action,
      entity_type,
      entity_id,
      old_value,
      new_value,
      metadata
    ) VALUES (
      COALESCE(NEW.event_id, NEW.id),
      auth.uid(),
      'update',
      TG_TABLE_NAME,
      NEW.id::text,
      to_jsonb(OLD),
      to_jsonb(NEW),
      jsonb_build_object('table', TG_TABLE_NAME)
    );
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO event_audit_log (
      event_id,
      employee_id,
      action,
      entity_type,
      entity_id,
      old_value,
      metadata
    ) VALUES (
      COALESCE(OLD.event_id, OLD.id),
      auth.uid(),
      'delete',
      TG_TABLE_NAME,
      OLD.id::text,
      to_jsonb(OLD),
      jsonb_build_object('table', TG_TABLE_NAME)
    );
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Step 4: Create triggers for main tables
DROP TRIGGER IF EXISTS log_events_changes ON events;
CREATE TRIGGER log_events_changes
  AFTER INSERT OR UPDATE OR DELETE ON events
  FOR EACH ROW
  EXECUTE FUNCTION log_event_change();

DROP TRIGGER IF EXISTS log_employee_assignments_changes ON employee_assignments;
CREATE TRIGGER log_employee_assignments_changes
  AFTER INSERT OR UPDATE OR DELETE ON employee_assignments
  FOR EACH ROW
  EXECUTE FUNCTION log_event_change();

DROP TRIGGER IF EXISTS log_tasks_changes ON tasks;
CREATE TRIGGER log_tasks_changes
  AFTER INSERT OR UPDATE OR DELETE ON tasks
  FOR EACH ROW
  WHEN (NEW.event_id IS NOT NULL OR OLD.event_id IS NOT NULL)
  EXECUTE FUNCTION log_event_change();

-- Step 5: Create helper function to check if user can edit event
CREATE OR REPLACE FUNCTION can_user_edit_event(p_event_id uuid, p_user_id uuid)
RETURNS boolean AS $$
BEGIN
  RETURN EXISTS (
    -- User is the event creator
    SELECT 1 FROM events
    WHERE id = p_event_id
    AND created_by = p_user_id
  ) OR EXISTS (
    -- User is admin with events_manage
    SELECT 1 FROM employees
    WHERE id = p_user_id
    AND 'events_manage' = ANY(permissions)
  ) OR EXISTS (
    -- User is a collaborator with can_edit_event permission
    SELECT 1 FROM employee_assignments
    WHERE event_id = p_event_id
    AND employee_id = p_user_id
    AND can_edit_event = true
    AND status = 'accepted'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Step 6: Create helper function to check specific permissions
CREATE OR REPLACE FUNCTION can_user_perform_action(
  p_event_id uuid,
  p_user_id uuid,
  p_action text -- 'edit_event', 'edit_agenda', 'edit_tasks', 'edit_files', 'edit_equipment', 'invite_members', 'view_budget'
)
RETURNS boolean AS $$
BEGIN
  -- Event creator and admins can do everything
  IF EXISTS (
    SELECT 1 FROM events WHERE id = p_event_id AND created_by = p_user_id
  ) OR EXISTS (
    SELECT 1 FROM employees WHERE id = p_user_id AND 'events_manage' = ANY(permissions)
  ) THEN
    RETURN true;
  END IF;

  -- Check specific permission based on action
  RETURN EXISTS (
    SELECT 1 FROM employee_assignments
    WHERE event_id = p_event_id
    AND employee_id = p_user_id
    AND status = 'accepted'
    AND (
      (p_action = 'edit_event' AND can_edit_event = true) OR
      (p_action = 'edit_agenda' AND can_edit_agenda = true) OR
      (p_action = 'edit_tasks' AND can_edit_tasks = true) OR
      (p_action = 'edit_files' AND can_edit_files = true) OR
      (p_action = 'edit_equipment' AND can_edit_equipment = true) OR
      (p_action = 'invite_members' AND can_invite_members = true) OR
      (p_action = 'view_budget' AND can_view_budget = true)
    )
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Step 7: Set default access level for existing assignments (read-only by default)
UPDATE employee_assignments
SET
  access_level_id = (SELECT id FROM access_levels WHERE slug = 'employee' LIMIT 1),
  can_edit_event = false,
  can_edit_agenda = false,
  can_edit_tasks = false,
  can_edit_files = false,
  can_edit_equipment = false,
  can_invite_members = false,
  can_view_budget = false
WHERE access_level_id IS NULL;

-- Step 8: Create view for easy permission checking
CREATE OR REPLACE VIEW event_member_permissions AS
SELECT
  ea.id as assignment_id,
  ea.event_id,
  ea.employee_id,
  e.created_by as event_creator_id,
  ea.employee_id = e.created_by as is_creator,
  ea.role,
  ea.status,
  al.name as access_level_name,
  al.slug as access_level_slug,
  al.config as access_level_config,
  ea.can_edit_event,
  ea.can_edit_agenda,
  ea.can_edit_tasks,
  ea.can_edit_files,
  ea.can_edit_equipment,
  ea.can_invite_members,
  ea.can_view_budget,
  ea.granted_by,
  ea.permissions_updated_at,
  emp.name as employee_name,
  emp.surname as employee_surname,
  emp.nickname as employee_nickname
FROM employee_assignments ea
JOIN events e ON e.id = ea.event_id
LEFT JOIN access_levels al ON al.id = ea.access_level_id
LEFT JOIN employees emp ON emp.id = ea.employee_id;

-- Grant access to the view
GRANT SELECT ON event_member_permissions TO authenticated;
