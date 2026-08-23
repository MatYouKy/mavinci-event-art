/*
  # Restrict private event folders and expose the event team safely

  - Only admins, managers and the event author may read files from subfolders.
  - Accepted operational participants may read only non-sensitive root files.
  - Event participants may read the limited assignment list used by mobile Team tab.
*/

CREATE OR REPLACE FUNCTION public.can_view_private_event_content(
  p_event_id uuid,
  p_employee_id uuid DEFAULT auth.uid()
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.employees employee
    WHERE employee.id = p_employee_id
      AND employee.is_active = true
      AND (
        employee.role IN ('admin', 'manager')
        OR employee.access_level IN ('admin', 'manager')
      )
  ) OR EXISTS (
    SELECT 1
    FROM public.events event
    WHERE event.id = p_event_id
      AND event.created_by = p_employee_id
  );
$$;

REVOKE ALL ON FUNCTION public.can_view_private_event_content(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_view_private_event_content(uuid, uuid) TO authenticated;

DROP POLICY IF EXISTS "Team members and admins can view files" ON public.event_files;
DROP POLICY IF EXISTS "Managers see all and team sees operational files" ON public.event_files;
DROP POLICY IF EXISTS "Private event files follow folder visibility" ON public.event_files;
CREATE POLICY "Private event files follow folder visibility"
  ON public.event_files
  FOR SELECT TO authenticated
  USING (
    public.can_view_private_event_content(event_id, auth.uid())
    OR (
      folder_id IS NULL
      AND NOT public.is_sensitive_event_document(document_type)
      AND public.is_event_participant(event_id, auth.uid())
    )
  );

DROP POLICY IF EXISTS "Team members and admins can view folders" ON public.event_folders;
DROP POLICY IF EXISTS "Team members and admins can view folders with permission check" ON public.event_folders;
DROP POLICY IF EXISTS "Managers can view all event folders" ON public.event_folders;
DROP POLICY IF EXISTS "Private event folders for managers and author" ON public.event_folders;
CREATE POLICY "Private event folders for managers and author"
  ON public.event_folders
  FOR SELECT TO authenticated
  USING (public.can_view_private_event_content(event_id, auth.uid()));

DROP POLICY IF EXISTS "Authorized users can create folders" ON public.event_folders;
CREATE POLICY "Authorized users can create folders"
  ON public.event_folders
  FOR INSERT TO authenticated
  WITH CHECK (public.can_view_private_event_content(event_id, auth.uid()));

DROP POLICY IF EXISTS "Authorized users can update folders" ON public.event_folders;
CREATE POLICY "Authorized users can update folders"
  ON public.event_folders
  FOR UPDATE TO authenticated
  USING (public.can_view_private_event_content(event_id, auth.uid()))
  WITH CHECK (public.can_view_private_event_content(event_id, auth.uid()));

DROP POLICY IF EXISTS "Authorized users can delete folders" ON public.event_folders;
CREATE POLICY "Authorized users can delete folders"
  ON public.event_folders
  FOR DELETE TO authenticated
  USING (public.can_view_private_event_content(event_id, auth.uid()));

DROP POLICY IF EXISTS "Authorized users can upload files" ON public.event_files;
CREATE POLICY "Authorized users can upload files"
  ON public.event_files
  FOR INSERT TO authenticated
  WITH CHECK (
    public.can_view_private_event_content(event_id, auth.uid())
    OR (
      folder_id IS NULL
      AND NOT public.is_sensitive_event_document(document_type)
      AND public.can_edit_operational_event_files(event_id, auth.uid())
    )
  );

DROP POLICY IF EXISTS "Authorized users can update files" ON public.event_files;
CREATE POLICY "Authorized users can update files"
  ON public.event_files
  FOR UPDATE TO authenticated
  USING (
    public.can_view_private_event_content(event_id, auth.uid())
    OR (
      folder_id IS NULL
      AND NOT public.is_sensitive_event_document(document_type)
      AND public.can_edit_operational_event_files(event_id, auth.uid())
    )
  )
  WITH CHECK (
    public.can_view_private_event_content(event_id, auth.uid())
    OR (
      folder_id IS NULL
      AND NOT public.is_sensitive_event_document(document_type)
      AND public.can_edit_operational_event_files(event_id, auth.uid())
    )
  );

DROP POLICY IF EXISTS "Authorized users can delete files" ON public.event_files;
CREATE POLICY "Authorized users can delete files"
  ON public.event_files
  FOR DELETE TO authenticated
  USING (
    public.can_view_private_event_content(event_id, auth.uid())
    OR (
      folder_id IS NULL
      AND NOT public.is_sensitive_event_document(document_type)
      AND public.can_edit_operational_event_files(event_id, auth.uid())
    )
  );

DROP POLICY IF EXISTS "Event participants can view event team" ON public.employee_assignments;
CREATE POLICY "Event participants can view event team"
  ON public.employee_assignments
  FOR SELECT TO authenticated
  USING (
    employee_id = auth.uid()
    OR public.can_view_private_event_content(event_id, auth.uid())
    OR public.is_event_participant(event_id, auth.uid())
  );

COMMENT ON FUNCTION public.can_view_private_event_content(uuid, uuid) IS
  'True only for active admins/managers or the author of the selected event.';
