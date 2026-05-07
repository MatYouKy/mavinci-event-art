/*
  # Fix peek_next_invoice_number pattern matching

  1. Problem
    - Previous version returned "1/2026" even when 13-19, 31-33, 36 existed.
    - Variable interpolation inside regexp_match in PL/pgSQL CTE mis-behaved.

  2. Fix
    - Parse all invoice_numbers for the company and strip known affixes in
      SQL directly, comparing year suffix with string equality.
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
  v_year_text text;
  v_company_prefix text;
  v_prefix text;
  v_lead_prefix text;
  v_next_number integer;
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
  v_year_text := v_year::text;

  CASE p_invoice_type
    WHEN 'proforma' THEN v_prefix := 'PRO';
    WHEN 'advance' THEN v_prefix := 'ZAL';
    WHEN 'corrective' THEN v_prefix := 'KOR';
    ELSE v_prefix := '';
  END CASE;

  IF v_prefix != '' THEN
    IF v_company_prefix IS NOT NULL AND v_company_prefix != '' THEN
      v_lead_prefix := v_prefix || '/' || v_company_prefix || '/';
    ELSE
      v_lead_prefix := v_prefix || '/';
    END IF;
  ELSE
    IF v_company_prefix IS NOT NULL AND v_company_prefix != '' THEN
      v_lead_prefix := v_company_prefix || '/';
    ELSE
      v_lead_prefix := '';
    END IF;
  END IF;

  WITH combined AS (
    SELECT invoice_number
    FROM invoices
    WHERE my_company_id = p_my_company_id
    UNION ALL
    SELECT invoice_number
    FROM ksef_invoices
    WHERE my_company_id = p_my_company_id
      AND invoice_type = 'issued'
  ),
  stripped AS (
    SELECT
      CASE
        WHEN v_lead_prefix = '' THEN invoice_number
        WHEN invoice_number LIKE v_lead_prefix || '%' THEN substring(invoice_number from length(v_lead_prefix) + 1)
        ELSE NULL
      END AS after_prefix
    FROM combined
  ),
  parts AS (
    SELECT
      after_prefix,
      split_part(after_prefix, '/', 1) AS num_text,
      split_part(after_prefix, '/', 2) AS year_text
    FROM stripped
    WHERE after_prefix IS NOT NULL
  ),
  used_numbers AS (
    SELECT DISTINCT num_text::integer AS n
    FROM parts
    WHERE year_text = v_year_text
      AND num_text ~ '^[0-9]+$'
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
