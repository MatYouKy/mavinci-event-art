/*
  # Dodanie obsługi PDF do szablonów stron ofert
  
  1. Zmiany
    - Dodanie kolumny `pdf_url` do tabeli `offer_page_templates` dla przechowywania linku do PDF strony
    - Utworzenie storage bucket `offer-template-pages` dla plików PDF szablonów
    
  2. Security
    - Pracownicy z uprawnieniami `offers_manage` lub `website_edit` mogą zarządzać plikami
    - Storage bucket jest prywatny
*/

-- Dodaj kolumnę pdf_url do offer_page_templates
ALTER TABLE offer_page_templates 
ADD COLUMN IF NOT EXISTS pdf_url text;

COMMENT ON COLUMN offer_page_templates.pdf_url IS 'URL do pliku PDF szablonu strony w storage';

-- Utworzenie storage bucket dla stron szablonów
INSERT INTO storage.buckets (id, name, public)
VALUES ('offer-template-pages', 'offer-template-pages', false)
ON CONFLICT (id) DO NOTHING;

-- Storage policies dla offer-template-pages
CREATE POLICY "Authenticated can manage offer template pages"
ON storage.objects FOR ALL
TO authenticated
USING (bucket_id = 'offer-template-pages')
WITH CHECK (bucket_id = 'offer-template-pages');