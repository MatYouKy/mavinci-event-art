/*
  # Dodanie pól dla edytora WYSIWYG do szablonów umów

  1. Nowe kolumny
    - `content_html` (text) - sformatowana treść HTML z edytora WYSIWYG
    - `logo_positions` (jsonb) - pozycje i konfiguracja logo na stronie A4
      Format: [{ id, url, x, y, width, height, page }]
    - `page_settings` (jsonb) - ustawienia strony A4
      Format: { marginTop, marginBottom, marginLeft, marginRight, pageSize }
      
  2. Zmiany
    - Kolumna `content` będzie przechowywać czysty tekst (bez HTML)
    - Kolumna `content_html` będzie przechowywać sformatowany HTML
*/

-- Dodaj kolumnę content_html dla HTML z edytora
ALTER TABLE contract_templates 
ADD COLUMN IF NOT EXISTS content_html text;

-- Dodaj kolumnę logo_positions dla pozycji grafik
ALTER TABLE contract_templates 
ADD COLUMN IF NOT EXISTS logo_positions jsonb DEFAULT '[]'::jsonb;

-- Dodaj kolumnę page_settings dla ustawień strony A4
ALTER TABLE contract_templates 
ADD COLUMN IF NOT EXISTS page_settings jsonb DEFAULT '{
  "marginTop": 50,
  "marginBottom": 50,
  "marginLeft": 50,
  "marginRight": 50,
  "pageSize": "A4"
}'::jsonb;

COMMENT ON COLUMN contract_templates.content IS 'Czysty tekst szablonu (bez formatowania)';
COMMENT ON COLUMN contract_templates.content_html IS 'Sformatowana treść HTML z edytora WYSIWYG';
COMMENT ON COLUMN contract_templates.logo_positions IS 'Pozycje i konfiguracja logo/grafik na stronie A4';
COMMENT ON COLUMN contract_templates.page_settings IS 'Ustawienia marginesów i formatu strony A4';
