/*
  # Dodanie konfiguracji dynamicznych pól tekstowych do szablonów PDF

  1. Zmiany
    - Dodanie kolumny `text_fields_config` (jsonb) do `offer_page_templates`
      - Struktura: array obiektów z konfiguracją pól:
        {
          "field_name": "client_name",
          "label": "Nazwa klienta",
          "x": 100,
          "y": 200,
          "font_size": 12,
          "font_color": "#000000",
          "max_width": 300,
          "align": "left"
        }
    
  2. Dostępne pola do podstawienia:
    - client_name - nazwa klienta/organizacji
    - client_address - adres klienta
    - client_nip - NIP (dla firm)
    - offer_number - numer oferty
    - offer_date - data oferty
    - seller_name - nazwa sprzedającego (firma)
    - seller_address - adres sprzedającego
    - seller_nip - NIP sprzedającego
    - event_name - nazwa eventu
    - event_date - data eventu
    - total_price - całkowita cena
*/

-- Dodaj kolumnę z konfiguracją pól tekstowych
ALTER TABLE offer_page_templates 
ADD COLUMN IF NOT EXISTS text_fields_config jsonb DEFAULT '[]'::jsonb;

-- Dodaj komentarz
COMMENT ON COLUMN offer_page_templates.text_fields_config IS 
  'Konfiguracja dynamicznych pól tekstowych do nakładania na PDF. Format: array obiektów z polami: field_name, label, x, y, font_size, font_color, max_width, align';
