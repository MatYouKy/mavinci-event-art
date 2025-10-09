/*
  # Storage Policies for Site Images Bucket
  
  ## Polityki dla bucketu 'site-images'
  
  1. **Public Read Access**
     - Każdy może pobierać/przeglądać pliki
     
  2. **Authenticated Upload Access**
     - Zalogowani użytkownicy mogą przesyłać pliki
     
  3. **Authenticated Update/Delete Access**
     - Zalogowani użytkownicy mogą aktualizować i usuwać pliki
*/

-- Polityka: Publiczny dostęp do odczytu
CREATE POLICY "Public read access for site images"
ON storage.objects FOR SELECT
USING (bucket_id = 'site-images');

-- Polityka: Zalogowani użytkownicy mogą przesyłać pliki
CREATE POLICY "Authenticated users can upload site images"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'site-images');

-- Polityka: Zalogowani użytkownicy mogą aktualizować pliki
CREATE POLICY "Authenticated users can update site images"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'site-images')
WITH CHECK (bucket_id = 'site-images');

-- Polityka: Zalogowani użytkownicy mogą usuwać pliki
CREATE POLICY "Authenticated users can delete site images"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'site-images');

-- Alternatywnie: Anonimowi użytkownicy mogą przesyłać (jeśli potrzebne)
CREATE POLICY "Anyone can upload site images"
ON storage.objects FOR INSERT
TO anon
WITH CHECK (bucket_id = 'site-images');

CREATE POLICY "Anyone can update site images"
ON storage.objects FOR UPDATE
TO anon
USING (bucket_id = 'site-images')
WITH CHECK (bucket_id = 'site-images');

CREATE POLICY "Anyone can delete site images"
ON storage.objects FOR DELETE
TO anon
USING (bucket_id = 'site-images');