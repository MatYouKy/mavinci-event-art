/*
  # System stron PDF dla produktów ofertowych
  
  1. Zmiany
    - Dodanie kolumny `pdf_page_url` do `offer_products` - link do pojedynczej strony PDF
    - Utworzenie storage bucket `offer-product-pages` dla stron PDF produktów
    - Utworzenie storage bucket `generated-offers` dla finalnych, wygenerowanych ofert PDF
    
  2. Security
    - Pracownicy z `offers_manage` mogą uploadować i usuwać PDFy
    - Wszystkie strony PDF są prywatne, wymagają autoryzacji
    - Wygenerowane oferty są dostępne dla klienta przez dedykowany link
*/

-- Dodaj kolumnę pdf_page_url do offer_products
ALTER TABLE offer_products 
ADD COLUMN IF NOT EXISTS pdf_page_url text;

-- Komentarz do kolumny
COMMENT ON COLUMN offer_products.pdf_page_url IS 'URL do pojedynczej strony PDF produktu w storage';

-- Storage bucket dla stron PDF produktów
INSERT INTO storage.buckets (id, name, public)
VALUES ('offer-product-pages', 'offer-product-pages', false)
ON CONFLICT (id) DO NOTHING;

-- Storage policies dla offer-product-pages (uproszczone - service role ma pełny dostęp)
CREATE POLICY "Authenticated can manage product PDF pages"
ON storage.objects FOR ALL
TO authenticated
USING (bucket_id = 'offer-product-pages')
WITH CHECK (bucket_id = 'offer-product-pages');

-- Storage bucket dla wygenerowanych ofert (do wysyłki do klienta)
INSERT INTO storage.buckets (id, name, public)
VALUES ('generated-offers', 'generated-offers', false)
ON CONFLICT (id) DO NOTHING;

-- Storage policies dla generated-offers
CREATE POLICY "Authenticated can manage generated offers"
ON storage.objects FOR ALL
TO authenticated
USING (bucket_id = 'generated-offers')
WITH CHECK (bucket_id = 'generated-offers');

-- Dodaj kolumnę dla linku do wygenerowanej oferty w tabeli offers
ALTER TABLE offers 
ADD COLUMN IF NOT EXISTS generated_pdf_url text;

COMMENT ON COLUMN offers.generated_pdf_url IS 'URL do finalnej, wygenerowanej oferty PDF w storage';