/*
  # Storage dla zdjęć sprzętu wynajmu od podwykonawców

  1. Bucket
    - Utworzenie bucketu rental-equipment-images (publiczny)
    
  2. Polityki
    - Wszyscy mogą czytać (SELECT)
    - Zalogowani użytkownicy mogą wgrywać (INSERT) - RLS sprawdzi uprawnienia w aplikacji
    - Zalogowani użytkownicy mogą usuwać (DELETE) - RLS sprawdzi uprawnienia w aplikacji
*/

-- Utwórz bucket (jeśli nie istnieje)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'rental-equipment-images',
  'rental-equipment-images',
  true,
  10485760, -- 10MB
  ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO NOTHING;

-- Usuń istniejące polityki jeśli istnieją
DROP POLICY IF EXISTS "Public can view rental equipment images" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload rental images" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can delete rental images" ON storage.objects;

-- Polityka SELECT (wszyscy mogą czytać)
CREATE POLICY "Public can view rental equipment images"
ON storage.objects FOR SELECT
USING (bucket_id = 'rental-equipment-images');

-- Polityka INSERT (zalogowani użytkownicy)
CREATE POLICY "Authenticated users can upload rental images"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'rental-equipment-images');

-- Polityka DELETE (zalogowani użytkownicy)
CREATE POLICY "Authenticated users can delete rental images"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'rental-equipment-images');
