/*
  # Test auth context in RPC functions
  
  Create simple test function to verify auth.uid() works in RPC calls
*/

CREATE OR REPLACE FUNCTION test_auth_context()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  current_user_id uuid;
  user_info jsonb;
BEGIN
  current_user_id := auth.uid();
  
  IF current_user_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'user_id', null,
      'message', 'No auth context - user_id is NULL'
    );
  END IF;
  
  SELECT jsonb_build_object(
    'success', true,
    'user_id', current_user_id,
    'employee_exists', EXISTS(SELECT 1 FROM employees WHERE id = current_user_id),
    'employee_data', (
      SELECT jsonb_build_object(
        'name', name,
        'surname', surname,
        'role', role,
        'permissions', permissions
      )
      FROM employees
      WHERE id = current_user_id
    )
  ) INTO user_info;
  
  RETURN user_info;
END;
$$;

COMMENT ON FUNCTION test_auth_context IS 'Test function to verify auth.uid() works correctly in RPC calls';
