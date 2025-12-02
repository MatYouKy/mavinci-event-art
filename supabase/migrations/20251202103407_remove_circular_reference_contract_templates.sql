/*
  # Usunięcie cyklicznej referencji między contract_templates i event_categories

  1. Problem
    - Istnieje circular reference:
      - contract_templates.event_category_id → event_categories.id
      - event_categories.contract_template_id → contract_templates.id
    - Powoduje to błąd przy osadzaniu relacji w Supabase
    
  2. Rozwiązanie
    - Usunięcie event_category_id z contract_templates
    - Pozostawienie contract_template_id w event_categories
    - Każda kategoria wydarzenia może mieć przypisany jeden domyślny szablon
    - Szablony nie należą do kategorii, mogą być używane uniwersalnie
*/

-- Usuń indeks
DROP INDEX IF EXISTS idx_contract_templates_event_category;

-- Usuń kolumnę event_category_id z contract_templates
ALTER TABLE contract_templates DROP COLUMN IF EXISTS event_category_id;

COMMENT ON TABLE contract_templates IS 'Szablony umów - uniwersalne, mogą być przypisane do kategorii przez event_categories.contract_template_id';
