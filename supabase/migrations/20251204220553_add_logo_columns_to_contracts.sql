/*
  # Dodanie kolumn logo i stopki do tabeli contracts

  1. Nowe kolumny:
    - show_header_logo (boolean) - czy pokazywać logo w nagłówku
    - header_logo_url (text) - URL logo nagłówka
    - header_logo_height (integer) - wysokość logo nagłówka w px
    - header_logo_align (text) - wyrównanie logo (start/center/end)
    - show_center_logo (boolean) - czy pokazywać logo centralne
    - center_logo_url (text) - URL logo centralnego
    - center_logo_height (integer) - wysokość logo centralnego w px
    - show_footer (boolean) - czy pokazywać stopkę
    - footer_content (text) - zawartość HTML stopki

  2. Bezpieczeństwo:
    - Te same RLS policies co dla pozostałych kolumn
*/

-- Dodaj kolumny do tabeli contracts
ALTER TABLE contracts 
ADD COLUMN IF NOT EXISTS show_header_logo boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS header_logo_url text,
ADD COLUMN IF NOT EXISTS header_logo_height integer DEFAULT 50,
ADD COLUMN IF NOT EXISTS header_logo_align text DEFAULT 'start',
ADD COLUMN IF NOT EXISTS show_center_logo boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS center_logo_url text,
ADD COLUMN IF NOT EXISTS center_logo_height integer DEFAULT 100,
ADD COLUMN IF NOT EXISTS show_footer boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS footer_content text;