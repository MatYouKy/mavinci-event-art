/*
  # Dodanie konfiguracji tabeli wyceny do szablonów

  1. Zmiany
    - Dodanie kolumny `table_config` (jsonb) do offer_page_templates
    - Konfiguracja zawiera:
      - start_y: pozycja Y od góry strony
      - header_color: kolor tła nagłówka (hex)
      - row_bg_color: kolor tła wierszy parzystych (hex)
      - text_color: kolor tekstu (hex)
      - show_unit_price_net: czy pokazać cenę jednostkową netto
      - show_value_net: czy pokazać wartość netto
      - show_value_gross: czy pokazać wartość brutto
      - vat_rate: domyślna stawka VAT (%)

  2. Security
    - Brak zmian w RLS - istniejące polityki obsługują nową kolumnę
*/

-- Dodaj kolumnę table_config do offer_page_templates
ALTER TABLE offer_page_templates
ADD COLUMN IF NOT EXISTS table_config jsonb DEFAULT jsonb_build_object(
  'start_y', 200,
  'header_color', '#d3bb73',
  'row_bg_color', '#f2f2f2',
  'text_color', '#1c1f33',
  'show_unit_price_net', true,
  'show_value_net', true,
  'show_value_gross', true,
  'vat_rate', 23
);

-- Aktualizuj istniejące szablony pricing z domyślną konfiguracją
UPDATE offer_page_templates
SET table_config = jsonb_build_object(
  'start_y', 200,
  'header_color', '#d3bb73',
  'row_bg_color', '#f2f2f2',
  'text_color', '#1c1f33',
  'show_unit_price_net', true,
  'show_value_net', true,
  'show_value_gross', true,
  'vat_rate', 23
)
WHERE type = 'pricing' AND table_config IS NULL;
