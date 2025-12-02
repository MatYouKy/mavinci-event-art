/*
  # Naprawienie powiązania kategorii w szablonach umów

  1. Zmiany
    - Usunięcie kolumny template_type (jeśli istnieje)
    - Dodanie kolumny event_category_id z powiązaniem do event_categories
    - Umożliwienie wyboru kategorii wydarzenia dla szablonu umowy
*/

-- Usuń starą kolumnę template_type jeśli istnieje
ALTER TABLE contract_templates DROP COLUMN IF EXISTS template_type;

-- Dodaj nową kolumnę z powiązaniem do event_categories
ALTER TABLE contract_templates 
ADD COLUMN IF NOT EXISTS event_category_id uuid REFERENCES event_categories(id) ON DELETE SET NULL;

COMMENT ON COLUMN contract_templates.event_category_id IS 'Kategoria wydarzenia przypisana do tego szablonu umowy';

-- Dodaj indeks dla wydajności
CREATE INDEX IF NOT EXISTS idx_contract_templates_event_category 
ON contract_templates(event_category_id);
