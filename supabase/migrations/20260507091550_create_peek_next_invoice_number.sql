/*
  # Add peek_next_invoice_number read-only function

  1. New Function
    - `peek_next_invoice_number(p_invoice_type, p_my_company_id)` returns text
    - Returns the first free invoice number without mutating any state
    - Scans both `invoices.invoice_number` and `ksef_invoices.invoice_number` for the
      current year and for the given company, picking the lowest unused integer.

  2. Purpose
    - Fixes refresh-button bug where each click permanently incremented
      `my_companies.last_invoice_number`, producing n+1 instead of the first
      actually free number.

  3. Security
    - SECURITY DEFINER, fixed search_path
    - Read-only; no table writes
*/

CREATE OR REPLACE FUNCTION public.peek_next_invoice_number(
  p_invoice_type text,
  p_my_company_id uuid
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_year integer;
  v_company_prefix text;
  v_prefix text;
  v_next_number integer;
  v_pattern text;
  v_invoice_number text;
BEGIN
  SELECT invoice_numbering_year, invoice_prefix
  INTO v_year, v_company_prefix
  FROM my_companies
  WHERE id = p_my_company_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Company not found: %', p_my_company_id;
  END IF;

  IF v_year IS NULL OR v_year != EXTRACT(YEAR FROM CURRENT_DATE)::integer THEN
    v_year := EXTRACT(YEAR FROM CURRENT_DATE)::integer;
  END IF;

  CASE p_invoice_type
    WHEN 'proforma' THEN v_prefix := 'PRO';
    WHEN 'advance' THEN v_prefix := 'ZAL';
    WHEN 'corrective' THEN v_prefix := 'KOR';
    ELSE v_prefix := '';
  END CASE;

  IF v_prefix != '' THEN
    IF v_company_prefix IS NOT NULL AND v_company_prefix != '' THEN
      v_pattern := '^' || v_prefix || '/' || v_company_prefix || '/([0-9]+)/' || v_year || '$';
    ELSE
      v_pattern := '^' || v_prefix || '/([0-9]+)/' || v_year || '$';
    END IF;
  ELSE
    IF v_company_prefix IS NOT NULL AND v_company_prefix != '' THEN
      v_pattern := '^' || v_company_prefix || '/([0-9]+)/' || v_year || '$';
    ELSE
      v_pattern := '^([0-9]+)/' || v_year || '$';
    END IF;
  END IF;

  WITH used_numbers AS (
    SELECT (regexp_match(invoice_number, v_pattern))[1]::integer AS n
    FROM invoices
    WHERE my_company_id = p_my_company_id
      AND invoice_number ~ v_pattern
    UNION
    SELECT (regexp_match(invoice_number, v_pattern))[1]::integer AS n
    FROM ksef_invoices
    WHERE my_company_id = p_my_company_id
      AND invoice_type = 'issued'
      AND invoice_number ~ v_pattern
  ),
  candidates AS (
    SELECT generate_series(1, COALESCE((SELECT MAX(n) FROM used_numbers), 0) + 1) AS n
  )
  SELECT MIN(c.n)
  INTO v_next_number
  FROM candidates c
  LEFT JOIN used_numbers u ON u.n = c.n
  WHERE u.n IS NULL;

  IF v_next_number IS NULL THEN
    v_next_number := 1;
  END IF;

  IF v_prefix != '' THEN
    IF v_company_prefix IS NOT NULL AND v_company_prefix != '' THEN
      v_invoice_number := v_prefix || '/' || v_company_prefix || '/' || v_next_number || '/' || v_year;
    ELSE
      v_invoice_number := v_prefix || '/' || v_next_number || '/' || v_year;
    END IF;
  ELSE
    IF v_company_prefix IS NOT NULL AND v_company_prefix != '' THEN
      v_invoice_number := v_company_prefix || '/' || v_next_number || '/' || v_year;
    ELSE
      v_invoice_number := v_next_number || '/' || v_year;
    END IF;
  END IF;

  RETURN v_invoice_number;
END;
$$;

GRANT EXECUTE ON FUNCTION public.peek_next_invoice_number(text, uuid) TO authenticated;
