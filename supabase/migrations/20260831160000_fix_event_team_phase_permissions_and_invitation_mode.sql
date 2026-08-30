-- Keep event membership independent from timeline while preserving a dedicated
-- permission for phase editing and the history of invitation/timeline emails.

ALTER TABLE public.employee_assignments
  ADD COLUMN IF NOT EXISTS can_edit_phases boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS invitation_includes_phases boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS timeline_update_email_sent_at timestamptz;

COMMENT ON COLUMN public.employee_assignments.can_edit_phases IS
  'Allows editing event phases/timeline independently from agenda editing.';
COMMENT ON COLUMN public.employee_assignments.invitation_includes_phases IS
  'True when the most recently sent invitation included assigned timeline phases.';
COMMENT ON COLUMN public.employee_assignments.timeline_update_email_sent_at IS
  'When the latest supplementary timeline email was sent.';
