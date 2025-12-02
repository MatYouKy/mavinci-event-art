/*
  # Dodanie stopki do szablonów umów

  1. Zmiany
    - Dodanie kolumny `footer_content` do `contract_templates`
    - Stopka będzie wyświetlana na każdej stronie dokumentu
*/

ALTER TABLE contract_templates
ADD COLUMN IF NOT EXISTS footer_content text;

COMMENT ON COLUMN contract_templates.footer_content IS 'Treść stopki wyświetlanej na każdej stronie dokumentu';
