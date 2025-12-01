/*
  # Improve invoice settings RPC error handling

  ## Changes
  1. Better error messages for debugging
  2. Check if user exists in employees table
  3. Log permission check details
*/

CREATE OR REPLACE FUNCTION public.get_invoice_settings_for_creation()
RETURNS TABLE (
  company_name text,
  company_nip text,
  company_street text,
  company_postal_code text,
  company_city text,
  company_country text,
  bank_account text,
  bank_name text,
  default_payment_method text,
  default_payment_days integer,
  invoice_issue_place text,
  invoice_footer_text text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_employee_exists boolean;
  v_is_admin boolean;
  v_has_permissions boolean;
BEGIN
  -- Get current user ID
  v_user_id := auth.uid();
  
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Check if employee record exists
  SELECT EXISTS (
    SELECT 1 FROM employees WHERE id = v_user_id
  ) INTO v_employee_exists;

  IF NOT v_employee_exists THEN
    RAISE EXCEPTION 'Employee record not found for user %', v_user_id;
  END IF;

  -- Check admin status
  SELECT 
    (role = 'admin' OR access_level = 'admin')
  INTO v_is_admin
  FROM employees
  WHERE id = v_user_id;

  -- Check permissions
  SELECT 
    ('finances_manage' = ANY(permissions) OR 'invoices_manage' = ANY(permissions))
  INTO v_has_permissions
  FROM employees
  WHERE id = v_user_id;

  -- Require admin OR permissions
  IF NOT (v_is_admin OR v_has_permissions) THEN
    RAISE EXCEPTION 'Permission denied: requires admin role or invoices_manage/finances_manage permission';
  END IF;

  -- Return invoice settings
  RETURN QUERY
  SELECT 
    i.company_name,
    i.company_nip,
    i.company_street,
    i.company_postal_code,
    i.company_city,
    i.company_country,
    i.bank_account,
    i.bank_name,
    i.default_payment_method,
    i.default_payment_days,
    i.invoice_issue_place,
    i.invoice_footer_text
  FROM invoice_settings i
  ORDER BY i.created_at
  LIMIT 1;
END;
$$;
