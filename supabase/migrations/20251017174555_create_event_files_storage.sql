/*
  # Storage dla plików wydarzeń

  1. Storage Bucket
    - Utworzenie bucketu `event-files`
    - Publiczny dostęp do odczytu
    
  2. Storage Policies
    - Użytkownicy uwierzytelnieni mogą uploadować pliki do swoich wydarzeń
    - Wszyscy mogą czytać pliki
    - Tylko uprawnie ni użytkownicy mogą usuwać
*/

-- Utwórz bucket dla plików wydarzeń
INSERT INTO storage.buckets (id, name, public)
VALUES ('event-files', 'event-files', true)
ON CONFLICT (id) DO NOTHING;

-- Polityka: wszyscy mogą czytać
CREATE POLICY "Public can view event files"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'event-files');

-- Polityka: uwierzytelnieni użytkownicy mogą uploadować
CREATE POLICY "Authenticated users can upload event files"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'event-files'
  AND auth.uid() IS NOT NULL
);

-- Polityka: użytkownicy mogą aktualizować swoje pliki lub jeśli mają uprawnienia
CREATE POLICY "Users can update their event files"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'event-files'
  AND auth.uid() IS NOT NULL
)
WITH CHECK (
  bucket_id = 'event-files'
  AND auth.uid() IS NOT NULL
);

-- Polityka: użytkownicy mogą usuwać swoje pliki lub jeśli mają uprawnienia
CREATE POLICY "Users can delete their event files"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'event-files'
  AND auth.uid() IS NOT NULL
);
