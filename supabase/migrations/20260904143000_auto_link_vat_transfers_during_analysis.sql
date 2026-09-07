/*
  Automatyczne parowanie jednoznacznych transferow rachunek biezacy <-> VAT
  jako deterministyczny etap uruchamiany przed analiza AI.

  Automatycznie laczymy tylko operacje z tego samego dnia, o identycznej
  kwocie i walucie, przeciwnym kierunku, sygnalem wlasnego rachunku oraz
  z jednym kandydatem po kazdej stronie. Przypadki niejednoznaczne pozostaja
  do recznej kontroli.
*/

BEGIN;

CREATE OR REPLACE FUNCTION public.auto_link_vat_account_transfers_for_period(
  p_statement_month integer,
  p_statement_year integer,
  p_company_id uuid DEFAULT NULL
)
RETURNS TABLE (
  linked_pairs integer,
  linked_transactions integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_pair record;
  v_linked_pairs integer := 0;
BEGIN
  IF p_statement_month NOT BETWEEN 1 AND 12
    OR p_statement_year NOT BETWEEN 2000 AND 2200
  THEN
    RAISE EXCEPTION 'Nieprawidlowy okres analizy';
  END IF;

  IF auth.role() <> 'service_role' AND NOT public.finance_can_manage() THEN
    RAISE EXCEPTION 'Brak uprawnien do automatycznego laczenia transferow'
      USING ERRCODE = '42501';
  END IF;

  -- Analizy tego samego lub sasiedniego okresu nie moga jednoczesnie wybrac
  -- tej samej operacji. Blokada trwa tylko do konca tej transakcji.
  PERFORM pg_advisory_xact_lock(hashtext('auto_link_vat_account_transfers'));

  FOR v_pair IN
    WITH possible_pairs AS MATERIALIZED (
      SELECT
        regular_transaction.id AS regular_transaction_id,
        vat_transaction.id AS vat_transaction_id,
        COUNT(*) OVER (
          PARTITION BY regular_transaction.id
        ) AS regular_candidate_count,
        COUNT(*) OVER (
          PARTITION BY vat_transaction.id
        ) AS vat_candidate_count
      FROM public.bank_transactions regular_transaction
      JOIN public.bank_statements regular_statement
        ON regular_statement.id = regular_transaction.statement_id
       AND regular_statement.account_type <> 'vat'
      JOIN public.my_companies company
        ON company.id = regular_statement.my_company_id
      JOIN public.bank_transactions vat_transaction
        ON vat_transaction.transaction_date = regular_transaction.transaction_date
       AND vat_transaction.transaction_type <> regular_transaction.transaction_type
       AND UPPER(COALESCE(vat_transaction.currency, 'PLN'))
         = UPPER(COALESCE(regular_transaction.currency, 'PLN'))
       AND ABS(ABS(vat_transaction.amount) - ABS(regular_transaction.amount)) <= 0.01
      JOIN public.bank_statements vat_statement
        ON vat_statement.id = vat_transaction.statement_id
       AND vat_statement.account_type = 'vat'
       AND vat_statement.my_company_id = regular_statement.my_company_id
      WHERE regular_statement.processed = true
        AND vat_statement.processed = true
        AND COALESCE(regular_statement.validation_status, 'valid') = 'valid'
        AND COALESCE(vat_statement.validation_status, 'valid') = 'valid'
        AND (
          (
            regular_statement.statement_month = p_statement_month
            AND regular_statement.statement_year = p_statement_year
          )
          OR (
            vat_statement.statement_month = p_statement_month
            AND vat_statement.statement_year = p_statement_year
          )
        )
        AND (p_company_id IS NULL OR regular_statement.my_company_id = p_company_id)
        AND (
          auth.role() = 'service_role'
          OR public.finance_company_visible(regular_statement.my_company_id)
        )
        AND ABS(regular_transaction.amount) > 0.01
        AND COALESCE(regular_transaction.allocated_amount, 0) <= 0.01
        AND COALESCE(vat_transaction.allocated_amount, 0) <= 0.01
        AND COALESCE(regular_transaction.match_status, 'unmatched') <> 'matched'
        AND COALESCE(vat_transaction.match_status, 'unmatched') <> 'matched'
        AND regular_transaction.matched_invoice_id IS NULL
        AND vat_transaction.matched_invoice_id IS NULL
        AND regular_transaction.accounting_review_status <> 'explained'
        AND vat_transaction.accounting_review_status <> 'explained'
        AND regular_transaction.paired_bank_transaction_id IS NULL
        AND vat_transaction.paired_bank_transaction_id IS NULL
        AND (
          (
            LENGTH(regexp_replace(COALESCE(regular_transaction.counterparty_account, ''), '[^0-9]', '', 'g')) >= 8
            AND regexp_replace(COALESCE(regular_transaction.counterparty_account, ''), '[^0-9]', '', 'g')
              = regexp_replace(COALESCE(vat_statement.account_number, ''), '[^0-9]', '', 'g')
          )
          OR (
            LENGTH(regexp_replace(COALESCE(vat_transaction.counterparty_account, ''), '[^0-9]', '', 'g')) >= 8
            AND regexp_replace(COALESCE(vat_transaction.counterparty_account, ''), '[^0-9]', '', 'g')
              = regexp_replace(COALESCE(regular_statement.account_number, ''), '[^0-9]', '', 'g')
          )
          OR (
            LENGTH(regexp_replace(UPPER(company.name), '[^A-Z0-9]', '', 'g')) >= 4
            AND POSITION(
              regexp_replace(UPPER(company.name), '[^A-Z0-9]', '', 'g')
              IN regexp_replace(
                UPPER(CONCAT_WS(
                  ' ',
                  regular_transaction.counterparty_name,
                  regular_transaction.title,
                  vat_transaction.counterparty_name,
                  vat_transaction.title
                )),
                '[^A-Z0-9]',
                '',
                'g'
              )
            ) > 0
          )
          OR regexp_replace(
            UPPER(CONCAT_WS(
              ' ',
              regular_transaction.counterparty_name,
              regular_transaction.title,
              vat_transaction.counterparty_name,
              vat_transaction.title
            )),
            '[^A-Z0-9]',
            '',
            'g'
          ) SIMILAR TO '%(RACHUNEKVAT|KONTOVAT|PRZEKSIEG%VAT|TRANSFERVAT)%'
        )
        AND NOT EXISTS (
          SELECT 1
          FROM public.bank_transaction_invoice_matches match
          WHERE match.bank_transaction_id = regular_transaction.id
        )
        AND NOT EXISTS (
          SELECT 1
          FROM public.bank_transaction_invoice_matches match
          WHERE match.bank_transaction_id = vat_transaction.id
        )
    )
    SELECT
      possible_pair.regular_transaction_id,
      possible_pair.vat_transaction_id
    FROM possible_pairs possible_pair
    WHERE possible_pair.regular_candidate_count = 1
      AND possible_pair.vat_candidate_count = 1
    ORDER BY possible_pair.regular_transaction_id, possible_pair.vat_transaction_id
  LOOP
    PERFORM public.link_vat_account_transactions(
      v_pair.regular_transaction_id,
      v_pair.vat_transaction_id,
      'Automatycznie polaczono podczas analizy wyciagow: transfer pomiedzy rachunkiem biezacym a rachunkiem VAT.'
    );
    v_linked_pairs := v_linked_pairs + 1;
  END LOOP;

  RETURN QUERY
  SELECT v_linked_pairs, v_linked_pairs * 2;
END;
$$;

REVOKE ALL ON FUNCTION public.auto_link_vat_account_transfers_for_period(integer, integer, uuid)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.auto_link_vat_account_transfers_for_period(integer, integer, uuid)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.auto_link_vat_account_transfers_for_period(integer, integer, uuid) IS
  'Automatycznie laczy jednoznaczne, przeciwne operacje tego samego dnia pomiedzy rachunkiem biezacym i VAT podczas analizy wyciagow.';

NOTIFY pgrst, 'reload schema';

COMMIT;
