/*
  # Fix invoice number generation with SECURITY DEFINER

  ## Changes
  1. Recreate generate_invoice_number function with SECURITY DEFINER
  2. This allows the function to bypass RLS policies
  
  ## Security
  - Function only updates invoice_settings table (safe)
  - No user input affects the update logic
  - Only increments counters and formats strings
*/

-- Drop and recreate function with SECURITY DEFINER
CREATE OR REPLACE FUNCTION public.generate_invoice_number(p_invoice_type text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER  -- Run with owner's privileges, bypassing RLS
SET search_path = public
AS $function$
DECLARE
  v_year integer;
  v_next_number integer;
  v_prefix text;
  v_invoice_number text;
  v_settings_id uuid;
BEGIN
  SELECT id, current_year, last_invoice_number + 1
  INTO v_settings_id, v_year, v_next_number
  FROM invoice_settings
  ORDER BY created_at
  LIMIT 1;

  -- Reset counter if new year
  IF v_year != EXTRACT(YEAR FROM CURRENT_DATE)::integer THEN
    v_year := EXTRACT(YEAR FROM CURRENT_DATE)::integer;
    v_next_number := 1;

    UPDATE invoice_settings
    SET current_year = v_year,
        last_invoice_number = 0
    WHERE id = v_settings_id;
  END IF;

  -- Set prefix based on invoice type
  CASE p_invoice_type
    WHEN 'proforma' THEN v_prefix := 'PRO';
    WHEN 'advance' THEN v_prefix := 'ZAL';
    WHEN 'corrective' THEN v_prefix := 'KOR';
    ELSE v_prefix := '';
  END CASE;

  -- Format invoice number
  IF v_prefix != '' THEN
    v_invoice_number := v_prefix || '/' || v_next_number || '/' || v_year;
  ELSE
    v_invoice_number := v_next_number || '/' || v_year;
  END IF;

  -- Update counter
  UPDATE invoice_settings
  SET last_invoice_number = v_next_number,
      updated_at = now()
  WHERE id = v_settings_id;

  RETURN v_invoice_number;
END;
$function$;
