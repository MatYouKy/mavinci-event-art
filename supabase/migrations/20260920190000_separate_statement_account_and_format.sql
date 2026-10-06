-- Account kind and file format are independent. Keep the originals from both
-- PDF and MT940 for current as well as VAT accounts. Do not rewrite old imports.
BEGIN;

DROP INDEX IF EXISTS public.idx_bank_statements_unique;

CREATE UNIQUE INDEX idx_bank_statements_unique
  ON public.bank_statements (
    statement_month,
    statement_year,
    my_company_id,
    account_type,
    (regexp_replace(COALESCE(account_number, ''), '[^0-9]', '', 'g')),
    (COALESCE(
      NULLIF(UPPER(import_format), ''),
      NULLIF(UPPER(file_type), ''),
      CASE WHEN account_type = 'mt940' THEN 'MT940' ELSE 'PDF' END
    ))
  );

COMMENT ON INDEX public.idx_bank_statements_unique IS
  'One source per company, month, account kind, account number and import format; PDF and MT940 coexist for both current and VAT accounts.';

COMMIT;
