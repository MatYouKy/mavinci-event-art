/*
  # Fix peek_next_invoice_number - use dynamic SQL

  1. Problem
    - PL/pgSQL variable references inside CTE predicates were not resolving correctly
    - Function always returned 1/2026 regardless of existing numbers
  2. Fix
    - Rewrite using EXECUTE with parameterized dynamic SQL to guarantee variable binding
    - Compute used numbers into a simple array, then scan for first gap
*/

CREATE OR REPLACE FUNCTION public.peek_next_invoice_number(p_invoice_type text, p_my_company_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_year integer;
  v_year_text text;
  v_company_prefix text;
  v_prefix text;
  v_lead_prefix text;
  v_next_number integer;
  v_invoice_number text;
  v_used_numbers integer[];
  v_max_used integer;
  v_candidate integer;
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

  EXECUTE $q$
    WITH combined AS (
      SELECT invoice_number FROM invoices WHERE my_company_id = $1
      UNION ALL
      SELECT invoice_number FROM ksef_invoices WHERE my_company_id = $1 AND invoice_type = 'issued'
    ),
    stripped AS (
      SELECT CASE
        WHEN $2 = '' THEN invoice_number
        WHEN invoice_number LIKE $2 || '%' THEN substring(invoice_number FROM length($2) + 1)
        ELSE NULL
      END AS after_prefix
      FROM combined
    ),
    parts AS (
      SELECT
        split_part(after_prefix, '/', 1) AS num_text,
        split_part(after_prefix, '/', 2) AS year_text
      FROM stripped
      WHERE after_prefix IS NOT NULL
    )
    SELECT COALESCE(array_agg(DISTINCT num_text::integer ORDER BY num_text::integer), ARRAY[]::integer[])
    FROM parts
    WHERE year_text = $3 AND num_text ~ '^[0-9]+$'
  $q$
  INTO v_used_numbers
  USING p_my_company_id, v_lead_prefix, v_year_text;

  v_max_used := COALESCE((SELECT MAX(n) FROM unnest(v_used_numbers) AS n), 0);

  v_candidate := 1;
  WHILE v_candidate <= v_max_used + 1 LOOP
    IF NOT (v_candidate = ANY(v_used_numbers)) THEN
      v_next_number := v_candidate;
      EXIT;
    END IF;
    v_candidate := v_candidate + 1;
  END LOOP;

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
$function$;

GRANT EXECUTE ON FUNCTION public.peek_next_invoice_number(text, uuid) TO authenticated;
