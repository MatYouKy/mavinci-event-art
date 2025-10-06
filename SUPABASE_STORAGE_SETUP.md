# 🚨 WAŻNE: Konfiguracja Supabase Storage dla Upload Obrazów

## MUSISZ wykonać te kroki aby upload działał!

### Sposób 1: Przez interfejs Supabase (ŁATWIEJSZE) ✅

1. Zaloguj się do panelu Supabase (supabase.com)
2. Wybierz swój projekt
3. Przejdź do zakładki **Storage** (ikona folderu w menu po lewej)
4. Kliknij przycisk **"New bucket"** lub **"Create bucket"**
5. Wypełnij formularz:
   - **Name**: `site-images` (dokładnie ta nazwa!)
   - **Public bucket**: ✅ **ZAZNACZ TO!** (bardzo ważne)
   - **File size limit**: 5 MB (opcjonalnie)
   - **Allowed MIME types**: image/jpeg, image/png, image/webp (opcjonalnie)
6. Kliknij **"Create bucket"**
7. Bucket został utworzony!

### Sposób 2: Przez SQL Editor (jeśli sposób 1 nie działa)

Przejdź do **SQL Editor** w Supabase i wykonaj:

```sql
-- Create the storage bucket for site images
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'site-images',
  'site-images',
  true,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/jpg']::text[]
)
ON CONFLICT (id) DO NOTHING;
```

### Następnie: Ustaw polityki dostępu (OBOWIĄZKOWE!)

W **SQL Editor** wykonaj:

```sql
-- Allow authenticated users to upload images
CREATE POLICY IF NOT EXISTS "Authenticated users can upload site images"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'site-images');

-- Allow authenticated users to update images
CREATE POLICY IF NOT EXISTS "Authenticated users can update site images"
ON storage.objects
FOR UPDATE
TO authenticated
USING (bucket_id = 'site-images')
WITH CHECK (bucket_id = 'site-images');

-- Allow authenticated users to delete images
CREATE POLICY IF NOT EXISTS "Authenticated users can delete site images"
ON storage.objects
FOR DELETE
TO authenticated
USING (bucket_id = 'site-images');

-- Allow public access to read images
CREATE POLICY IF NOT EXISTS "Anyone can view site images"
ON storage.objects
FOR SELECT
USING (bucket_id = 'site-images');
```

## Jak sprawdzić czy bucket istnieje?

1. Przejdź do **Storage** w panelu Supabase
2. Powinieneś zobaczyć bucket o nazwie `site-images`
3. Powinieneś móc wejść w ten bucket i zobaczyć pusty folder

## Po wykonaniu tych kroków:

✅ Upload będzie działał! Odśwież stronę i spróbuj ponownie uploadować obraz.

## Jeśli nadal nie działa:

1. Sprawdź czy jesteś zalogowany jako admin na stronie
2. Sprawdź konsolę przeglądarki (F12) i poszukaj dokładnego błędu
3. Sprawdź czy bucket jest **publiczny** (Public bucket = true)
4. Sprawdź czy w pliku `.env` są poprawne dane do Supabase:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`

## Szybkie testy:

Po utworzeniu bucketu możesz przetestować w konsoli przeglądarki (F12):

```javascript
// Test czy bucket istnieje
const { data, error } = await supabase.storage.getBucket('site-images');
console.log('Bucket:', data, 'Error:', error);

// Test upload
const file = new File(['test'], 'test.txt', { type: 'text/plain' });
const { data: uploadData, error: uploadError } = await supabase.storage
  .from('site-images')
  .upload('test/test.txt', file);
console.log('Upload:', uploadData, 'Error:', uploadError);
```
