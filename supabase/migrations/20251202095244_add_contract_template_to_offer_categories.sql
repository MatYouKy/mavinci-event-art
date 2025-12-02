/*
  # Powiązanie szablonów umów z kategoriami produktów ofertowych

  1. Zmiany
    - Dodanie kolumny `contract_template_id` do `offer_product_categories`
    - Każda kategoria produktów może mieć przypisany dedykowany szablon umowy
*/

ALTER TABLE offer_product_categories
ADD COLUMN IF NOT EXISTS contract_template_id uuid REFERENCES contract_templates(id) ON DELETE SET NULL;

COMMENT ON COLUMN offer_product_categories.contract_template_id IS 'Szablon umowy przypisany do tej kategorii produktów ofertowych';
