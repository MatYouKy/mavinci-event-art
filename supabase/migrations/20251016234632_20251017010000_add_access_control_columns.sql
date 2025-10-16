-- Add access control columns to employee_assignments
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

-- Set default access level for existing assignments
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