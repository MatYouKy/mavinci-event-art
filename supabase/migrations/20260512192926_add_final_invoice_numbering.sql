/*
  # Add final invoice numbering

  1. Changes
    - Add `last_final_number` (integer, default 0) to `my_companies` for separate counter for final invoices
    - Update `generate_invoice_number(p_invoice_type, p_my_company_id)` to support 'final' type
      returning a FIN-prefixed number using the dedicated counter

  2. Notes
    - Final invoices are still stored with `invoice_type = 'vat'` in `invoices` table,
      only the generated number uses the FIN prefix to distinguish them
    - Separate counter prevents gaps/duplicates in the regular VAT sequence
*/

ALTER TABLE my_companies
  ADD COLUMN IF NOT EXISTS last_final_number integer DEFAULT 0 NOT NULL;

CREATE OR REPLACE FUNCTION public.generate_invoice_number(p_invoice_type text, p_my_company_id uuid DEFAULT NULL::uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
v_year integer;
v_year_text text;
v_next_number integer;
v_prefix text;
v_company_prefix text;
v_invoice_number text;
v_lead_prefix text;
v_used_numbers integer[];
v_max_used integer;
v_candidate integer;
v_counter_col text;
BEGIN
IF p_my_company_id IS NOT NULL THEN
SELECT invoice_numbering_year, invoice_prefix
INTO v_year, v_company_prefix
FROM my_companies
WHERE id = p_my_company_id;

IF NOT FOUND THEN
RAISE EXCEPTION 'Company not found: %', p_my_company_id;
END IF;

IF v_year IS NULL OR v_year != EXTRACT(YEAR FROM CURRENT_DATE)::integer THEN
v_year := EXTRACT(YEAR FROM CURRENT_DATE)::integer;
UPDATE my_companies SET
invoice_numbering_year = v_year,
last_invoice_number = 0,
last_proforma_number = 0,
last_advance_number = 0,
last_corrective_number = 0,
last_final_number = 0,
updated_at = now()
WHERE id = p_my_company_id;
END IF;
v_year_text := v_year::text;

CASE p_invoice_type
WHEN 'proforma' THEN v_prefix := 'PRO'; v_counter_col := 'last_proforma_number';
WHEN 'advance' THEN v_prefix := 'ZAL'; v_counter_col := 'last_advance_number';
WHEN 'corrective' THEN v_prefix := 'KOR'; v_counter_col := 'last_corrective_number';
WHEN 'final' THEN v_prefix := 'FIN'; v_counter_col := 'last_final_number';
ELSE v_prefix := ''; v_counter_col := 'last_invoice_number';
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

EXECUTE format('UPDATE my_companies SET %I = GREATEST(%I, $1), updated_at = now() WHERE id = $2',
v_counter_col, v_counter_col)
USING v_next_number, p_my_company_id;

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

ELSE
DECLARE
v_settings_id uuid;
BEGIN
SELECT id, current_year, last_invoice_number + 1
INTO v_settings_id, v_year, v_next_number
FROM invoice_settings
ORDER BY created_at
LIMIT 1;

IF v_year != EXTRACT(YEAR FROM CURRENT_DATE)::integer THEN
v_year := EXTRACT(YEAR FROM CURRENT_DATE)::integer;
v_next_number := 1;
UPDATE invoice_settings
SET current_year = v_year, last_invoice_number = 0
WHERE id = v_settings_id;
END IF;

CASE p_invoice_type
WHEN 'proforma' THEN v_prefix := 'PRO';
WHEN 'advance' THEN v_prefix := 'ZAL';
WHEN 'corrective' THEN v_prefix := 'KOR';
WHEN 'final' THEN v_prefix := 'FIN';
ELSE v_prefix := '';
END CASE;

IF v_prefix != '' THEN
v_invoice_number := v_prefix || '/' || v_next_number || '/' || v_year;
ELSE
v_invoice_number := v_next_number || '/' || v_year;
END IF;

UPDATE invoice_settings
SET last_invoice_number = v_next_number, updated_at = now()
WHERE id = v_settings_id;

RETURN v_invoice_number;
END;
END IF;
END;
$function$;