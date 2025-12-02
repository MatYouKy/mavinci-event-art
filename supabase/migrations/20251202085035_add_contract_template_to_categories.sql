/*
  # Powiązanie szablonów umów z kategoriami wydarzeń

  1. Zmiany
    - Dodanie kolumny `contract_template_id` do `event_categories`
    - Każda kategoria może mieć przypisany dedykowany szablon umowy
*/

-- Dodaj kolumnę do event_categories
ALTER TABLE event_categories 
ADD COLUMN IF NOT EXISTS contract_template_id uuid REFERENCES contract_templates(id) ON DELETE SET NULL;

COMMENT ON COLUMN event_categories.contract_template_id IS 'Szablon umowy przypisany do tej kategorii wydarzenia';
