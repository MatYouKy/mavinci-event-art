/*
  # Safe permanent employee deletion

  An administrator can permanently remove a former employee in one database
  transaction. Event authorship and required historical author fields are
  reassigned to the administrator performing the operation. Assignment rows
  are removed and optional historical references are cleared.
*/

CREATE OR REPLACE FUNCTION public.delete_employee_completely(p_employee_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_catalog, pg_temp
AS $$
DECLARE
  v_admin_id uuid := auth.uid();
  v_target_name text;
  v_admin_name text;
  v_fk record;
  v_affected bigint;
  v_reassigned bigint := 0;
  v_removed_relations bigint := 0;
  v_cleared_relations bigint := 0;
BEGIN
  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'Musisz być zalogowany, aby usunąć pracownika.';
  END IF;

  IF p_employee_id IS NULL THEN
    RAISE EXCEPTION 'Nie wskazano pracownika do usunięcia.';
  END IF;

  IF p_employee_id = v_admin_id THEN
    RAISE EXCEPTION 'Nie możesz usunąć własnego konta.';
  END IF;

  SELECT COALESCE(NULLIF(BTRIM(CONCAT_WS(' ', name, surname)), ''), email, id::text)
  INTO v_admin_name
  FROM public.employees
  WHERE id = v_admin_id
    AND is_active = true
    AND (
      role = 'admin'
      OR access_level = 'admin'
      OR 'admin' = ANY(COALESCE(permissions, ARRAY[]::text[]))
    );

  IF v_admin_name IS NULL THEN
    RAISE EXCEPTION 'Tylko administrator może trwale usuwać pracowników.';
  END IF;

  SELECT COALESCE(NULLIF(BTRIM(CONCAT_WS(' ', name, surname)), ''), email, id::text)
  INTO v_target_name
  FROM public.employees
  WHERE id = p_employee_id
  FOR UPDATE;

  IF v_target_name IS NULL THEN
    RAISE EXCEPTION 'Nie znaleziono pracownika.';
  END IF;

  -- This is the business-critical ownership rule requested for events.
  UPDATE public.events
  SET created_by = v_admin_id
  WHERE created_by = p_employee_id;
  GET DIAGNOSTICS v_affected = ROW_COUNT;
  v_reassigned := v_reassigned + v_affected;

  -- Resolve every single-column FK that still blocks deleting employees.
  -- CASCADE and SET NULL relations are intentionally left to PostgreSQL.
  FOR v_fk IN
    SELECT
      n.nspname AS schema_name,
      c.relname AS table_name,
      a.attname AS column_name,
      a.attnotnull AS is_not_null,
      con.confdeltype AS delete_action
    FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a
      ON a.attrelid = con.conrelid
     AND a.attnum = con.conkey[1]
    WHERE con.contype = 'f'
      AND con.confrelid = 'public.employees'::regclass
      AND array_length(con.conkey, 1) = 1
      AND con.confdeltype IN ('a', 'r')
      AND NOT (n.nspname = 'public' AND c.relname = 'events' AND a.attname = 'created_by')
  LOOP
    IF NOT v_fk.is_not_null THEN
      EXECUTE format(
        'UPDATE %I.%I SET %I = NULL WHERE %I = $1',
        v_fk.schema_name,
        v_fk.table_name,
        v_fk.column_name,
        v_fk.column_name
      ) USING p_employee_id;
      GET DIAGNOSTICS v_affected = ROW_COUNT;
      v_cleared_relations := v_cleared_relations + v_affected;
    ELSIF v_fk.column_name LIKE '%\_by' ESCAPE '\' THEN
      -- Preserve invoices, reports and audit history that require an author.
      EXECUTE format(
        'UPDATE %I.%I SET %I = $2 WHERE %I = $1',
        v_fk.schema_name,
        v_fk.table_name,
        v_fk.column_name,
        v_fk.column_name
      ) USING p_employee_id, v_admin_id;
      GET DIAGNOSTICS v_affected = ROW_COUNT;
      v_reassigned := v_reassigned + v_affected;
    ELSE
      -- Required employee/driver/assignee rows represent memberships and
      -- operational assignments belonging to the removed employee.
      EXECUTE format(
        'DELETE FROM %I.%I WHERE %I = $1',
        v_fk.schema_name,
        v_fk.table_name,
        v_fk.column_name
      ) USING p_employee_id;
      GET DIAGNOSTICS v_affected = ROW_COUNT;
      v_removed_relations := v_removed_relations + v_affected;
    END IF;
  END LOOP;

  -- Removing auth.users also removes the employees row and all CASCADE-bound
  -- credentials, sessions, notification recipients and personal assignments.
  DELETE FROM auth.users WHERE id = p_employee_id;

  IF FOUND = false THEN
    -- Older/imported employees may not have an auth.users row.
    DELETE FROM public.employees WHERE id = p_employee_id;
  END IF;

  IF EXISTS (SELECT 1 FROM public.employees WHERE id = p_employee_id) THEN
    RAISE EXCEPTION 'Nie udało się usunąć rekordu pracownika.';
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'employee_name', v_target_name,
    'reassigned_to', v_admin_name,
    'reassigned_records', v_reassigned,
    'removed_relations', v_removed_relations,
    'cleared_relations', v_cleared_relations
  );
END;
$$;

REVOKE ALL ON FUNCTION public.delete_employee_completely(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_employee_completely(uuid) TO authenticated;

COMMENT ON FUNCTION public.delete_employee_completely(uuid) IS
  'Permanently deletes a former employee and safely resolves employee foreign keys in one transaction.';
