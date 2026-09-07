/*
  A company may have more than one bank account of the same kind. Keep one
  statement per month, company, account kind and actual account number instead
  of limiting the whole company to one statement of each kind.
*/

DROP INDEX IF EXISTS public.idx_bank_statements_unique;

CREATE UNIQUE INDEX idx_bank_statements_unique
  ON public.bank_statements (
    statement_month,
    statement_year,
    my_company_id,
    account_type,
    (regexp_replace(COALESCE(account_number, ''), '[^0-9]', '', 'g'))
  );

COMMENT ON INDEX public.idx_bank_statements_unique
IS 'One statement per company, month, account kind and normalized bank account number; PDF, VAT and MT940 imports may coexist.';
