/*
  # Add RPC to get invoice settings for invoice creation

  ## Changes
  1. Create RPC that returns only necessary invoice_settings fields
  2. Requires finances_manage OR invoices_manage permission
  3. Used when creating invoices to populate seller data
  
  ## Security
  - Only exposes company info needed for invoices
  - Requires authentication
  - Checks permissions
*/

-- Create function to get invoice settings for creation
CREATE OR REPLACE FUNCTION get_invoice_settings_for_creation()
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
  IF NOT EXISTS (
    SELECT 1
    FROM employees
    WHERE id = auth.uid()
      AND (
        'finances_manage' = ANY(permissions) OR
        'invoices_manage' = ANY(permissions)
      )
  ) THEN
    RAISE EXCEPTION 'Permission denied: invoices_manage or finances_manage required';
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
