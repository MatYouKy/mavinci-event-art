ALTER TABLE public.offer_products
ADD COLUMN IF NOT EXISTS recommended_contract_clause_category text NOT NULL DEFAULT 'requirements';

ALTER TABLE public.offer_products
DROP CONSTRAINT IF EXISTS offer_products_contract_clause_category_check;

ALTER TABLE public.offer_products
ADD CONSTRAINT offer_products_contract_clause_category_check
CHECK (recommended_contract_clause_category IN ('requirements', 'obligations', 'risks', 'general'));

COMMENT ON COLUMN public.offer_products.recommended_contract_clause_category IS
'Miejsce klauzuli produktu w umowie: wymagania, obowiązki, ryzyka lub postanowienia ogólne.';
