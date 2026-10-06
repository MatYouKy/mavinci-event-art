BEGIN;

ALTER TABLE public.my_companies
  ADD COLUMN IF NOT EXISTS tax_office_bank_account text,
  ADD COLUMN IF NOT EXISTS zus_bank_account text;

ALTER TABLE public.my_companies
  ADD CONSTRAINT my_companies_tax_office_account_valid CHECK (
    tax_office_bank_account IS NULL OR (
      tax_office_bank_account ~ '^[0-9]{26}$'
      AND mod((substr(tax_office_bank_account, 3) || '2521' || substr(tax_office_bank_account, 1, 2))::numeric, 97) = 1
    )
  ),
  ADD CONSTRAINT my_companies_zus_account_valid CHECK (
    zus_bank_account IS NULL OR (
      zus_bank_account ~ '^[0-9]{26}$'
      AND mod((substr(zus_bank_account, 3) || '2521' || substr(zus_bank_account, 1, 2))::numeric, 97) = 1
    )
  );

COMMENT ON COLUMN public.my_companies.tax_office_bank_account IS
  'Rachunek odbiorcy podatków (NRB), nie własny rachunek VAT. Używany lokalnie do pomijania płatności wychodzących w analizie dokumentów bankowych.';
COMMENT ON COLUMN public.my_companies.zus_bank_account IS
  'Rachunek składkowy ZUS (NRB), używany lokalnie do pomijania płatności wychodzących w analizie dokumentów bankowych.';

-- Dotychczasowe RLS i uprawnienia my_companies pozostają bez zmian.
-- Nie zmieniamy transakcji, statusów księgowych ani zapisanych dopasowań.
NOTIFY pgrst, 'reload schema';
COMMIT;
