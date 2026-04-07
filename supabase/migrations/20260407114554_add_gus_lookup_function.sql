/*
  # Add GUS Company Lookup Function

  1. New Functions
    - `lookup_company_by_nip` - Fetches company data from Polish government API (Biała Lista VAT)

  2. Purpose
    - Allows automatic company data retrieval by NIP during invoice creation
    - Uses client-side API call instead of database HTTP extension

  3. Security
    - Function returns empty result as placeholder
    - Actual GUS lookup will be done client-side using existing gus.ts library
*/

-- Placeholder function for GUS lookup (client-side implementation preferred)
CREATE OR REPLACE FUNCTION lookup_company_by_nip(p_nip text)
RETURNS TABLE(
  nip text,
  name text,
  regon text,
  street text,
  postal_code text,
  city text
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- This is a placeholder function
  -- Actual GUS lookup is done client-side using the API in src/lib/gus.ts
  -- This function exists for compatibility but returns no results
  RETURN;
END;
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION lookup_company_by_nip(text) TO authenticated;

-- Add comment
COMMENT ON FUNCTION lookup_company_by_nip IS 'Placeholder for GUS lookup - actual implementation uses client-side API calls';
