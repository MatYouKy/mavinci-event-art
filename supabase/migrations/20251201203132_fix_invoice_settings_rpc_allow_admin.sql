/*
  # Fix invoice settings RPC to allow admin access

  ## Changes
  1. Update get_invoice_settings_for_creation to check for admin role
  2. Admin can access without specific permissions
  
  ## Security
  - Still requires authentication
  - Admin OR finances_manage OR invoices_manage
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
BEGIN
  -- Check if user has permission to create invoices
  -- Allow: admin, finances_manage, or invoices_manage
  IF NOT EXISTS (
    SELECT 1
    FROM employees
    WHERE id = auth.uid()
      AND (
        role = 'admin' OR
        access_level = 'admin' OR
        'finances_manage' = ANY(permissions) OR
        'invoices_manage' = ANY(permissions)
      )
  ) THEN
    RAISE EXCEPTION 'Permission denied: admin, invoices_manage or finances_manage required';
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
