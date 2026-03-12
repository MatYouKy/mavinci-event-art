/*
  # Add recommended contract clauses to offer products

  1. Changes
    - Add `recommended_contract_clauses` TEXT column to `offer_products`
    - This will store HTML content with recommended contract paragraphs
    - Used for services like streaming that need specific contract terms

  2. Notes
    - NULL by default - not all products need custom clauses
    - Will be used when generating contracts to include product-specific terms
*/

ALTER TABLE offer_products
ADD COLUMN IF NOT EXISTS recommended_contract_clauses TEXT;

COMMENT ON COLUMN offer_products.recommended_contract_clauses IS 'Rekomendowane klauzule umowy (HTML) - automatycznie dodawane do umów zawierających ten produkt';
