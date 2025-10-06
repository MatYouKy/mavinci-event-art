# Supabase Storage - Konfiguracja

## Krok 1: Utwórz bucket w Supabase

1. Przejdź do panelu Supabase → Storage
2. Kliknij "Create bucket"
3. Nazwa bucketu: `site-images`
4. **Public bucket**: Zaznacz (obrazy muszą być publiczne)
5. Kliknij "Create bucket"

## Krok 2: Ustaw polityki dostępu

Przejdź do Supabase → SQL Editor i wykonaj:

```sql
-- Allow authenticated users to upload images
CREATE POLICY "Authenticated users can upload site images"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'site-images');

-- Allow authenticated users to update images
CREATE POLICY "Authenticated users can update site images"
ON storage.objects
FOR UPDATE
TO authenticated
USING (bucket_id = 'site-images')
WITH CHECK (bucket_id = 'site-images');

-- Allow authenticated users to delete images
CREATE POLICY "Authenticated users can delete site images"
ON storage.objects
FOR DELETE
TO authenticated
USING (bucket_id = 'site-images');

-- Allow public access to read images
CREATE POLICY "Anyone can view site images"
ON storage.objects
FOR SELECT
USING (bucket_id = 'site-images');
```

## Gotowe!

System file upload będzie działał automatycznie po wykonaniu powyższych kroków.
