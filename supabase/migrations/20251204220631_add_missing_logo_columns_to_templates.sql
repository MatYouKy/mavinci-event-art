/*
  # Dodanie brakujących kolumn logo do contract_templates

  1. Nowe kolumny:
    - header_logo_align (text) - wyrównanie logo w nagłówku (start/center/end)
    - show_footer (boolean) - czy pokazywać stopkę
*/

ALTER TABLE contract_templates
ADD COLUMN IF NOT EXISTS header_logo_align text DEFAULT 'start',
ADD COLUMN IF NOT EXISTS show_footer boolean DEFAULT false;