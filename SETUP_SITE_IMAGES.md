# System edycji obrazów strony - Instrukcja

## ✅ GOTOWE DO UŻYCIA!

System inline editing obrazów z **pełną obsługą file upload** jest już funkcjonalny. Ikony edycji pojawiają się automatycznie gdy włączysz tryb edycji.

## Jak używać (krok po kroku):

### 1. Zaloguj się jako admin
Możesz się zalogować przez:
- `/crm/login` - panel CRM
- `/admin/login` - panel admina

### 2. Włącz tryb edycji obrazów
1. Kliknij w swoje **menu użytkownika** (awatar/inicjały w prawym górnym rogu)
2. Wybierz opcję **"Edytuj obrazy strony"**
3. Ikony edycji pojawią się automatycznie

### 3. Edytuj obrazy - dwa sposoby!

**Sposób 1: Upload własnego obrazu** (zalecane)
- **Złote ikony edycji** (z ołówkiem) pojawią się przy każdym obrazie
- Kliknij ikonę aby otworzyć edytor
- Kliknij przycisk **"Upload"** przy polu Desktop lub Mobile
- Wybierz obraz z dysku
- Obraz zostanie automatycznie uploadowany do Supabase Storage
- Zobacz **podgląd na żywo**
- Kliknij "Zapisz Zmiany"
- Strona automatycznie się przeładuje

**Sposób 2: Użyj URL z internetu**
- Wklej URL obrazu (np. z Pexels) bezpośrednio w pole tekstowe
- Zobacz **podgląd na żywo** (obraz pojawi się od razu po wklejeniu URL)
- Kliknij "Zapisz Zmiany"
- Strona automatycznie się przeładuje

### 4. Wyłącz tryb edycji
- Kliknij ponownie w menu użytkownika
- Wybierz **"Wyłącz edycję obrazów"**

## Dostępne sekcje z ikonami edycji:

- **Hero** - główne tło strony głównej
- **Divider 1** - pierwsze tło separatora
- **Divider 2** - drugie tło separatora

## Wymagana konfiguracja Supabase

### Krok A: Utwórz Storage Bucket (wymagane dla file upload)

1. Przejdź do panelu Supabase → **Storage**
2. Kliknij **"Create bucket"**
3. Nazwa bucketu: `site-images`
4. **Public bucket**: ✅ Zaznacz (obrazy muszą być publiczne)
5. Kliknij "Create bucket"

### Krok B: Ustaw polityki Storage

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

### Krok C: Utwórz tabelę site_images (wymagane dla zapisywania)

Wykonaj poniższe SQL w panelu Supabase → SQL Editor:

### SQL do wykonania (skopiuj i wklej w Supabase):

```sql
-- Create site_images table
CREATE TABLE IF NOT EXISTS site_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  section text NOT NULL,
  name text NOT NULL,
  description text DEFAULT '',
  desktop_url text NOT NULL,
  mobile_url text,
  alt_text text DEFAULT '',
  position text DEFAULT 'center',
  order_index integer DEFAULT 0,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_site_images_section ON site_images(section);
CREATE INDEX IF NOT EXISTS idx_site_images_order ON site_images(order_index);
CREATE INDEX IF NOT EXISTS idx_site_images_active ON site_images(is_active);

-- Enable RLS
ALTER TABLE site_images ENABLE ROW LEVEL SECURITY;

-- Policy for public read access
CREATE POLICY "Anyone can view active site images"
  ON site_images
  FOR SELECT
  USING (is_active = true);

-- Policy for authenticated users to view all images
CREATE POLICY "Authenticated users can view all site images"
  ON site_images
  FOR SELECT
  TO authenticated
  USING (true);

-- Policy for authenticated users to insert images
CREATE POLICY "Authenticated users can insert site images"
  ON site_images
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Policy for authenticated users to update images
CREATE POLICY "Authenticated users can update site images"
  ON site_images
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Policy for authenticated users to delete images
CREATE POLICY "Authenticated users can delete site images"
  ON site_images
  FOR DELETE
  TO authenticated
  USING (true);

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_site_images_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger
CREATE TRIGGER trigger_update_site_images_updated_at
  BEFORE UPDATE ON site_images
  FOR EACH ROW
  EXECUTE FUNCTION update_site_images_updated_at();
```

### Dane przykładowe (opcjonalnie):

```sql
-- Hero image
INSERT INTO site_images (section, name, description, desktop_url, mobile_url, alt_text, position, order_index)
VALUES
('hero', 'Hero Background', 'Main hero section background',
 'https://images.pexels.com/photos/1763075/pexels-photo-1763075.jpeg?auto=compress&cs=tinysrgb&w=1920',
 'https://images.pexels.com/photos/1763075/pexels-photo-1763075.jpeg?auto=compress&cs=tinysrgb&w=800',
 'Profesjonalna organizacja eventów', 'center', 1);

-- Dividers
INSERT INTO site_images (section, name, description, desktop_url, mobile_url, alt_text, position, order_index)
VALUES
('divider1', 'Divider 1', 'First divider background',
 'https://images.pexels.com/photos/1540406/pexels-photo-1540406.jpeg?auto=compress&cs=tinysrgb&w=1920',
 'https://images.pexels.com/photos/1540406/pexels-photo-1540406.jpeg?auto=compress&cs=tinysrgb&w=800',
 'Event decoration', 'center', 1),
('divider2', 'Divider 2', 'Second divider background',
 'https://images.pexels.com/photos/2608517/pexels-photo-2608517.jpeg?auto=compress&cs=tinysrgb&w=1920',
 'https://images.pexels.com/photos/2608517/pexels-photo-2608517.jpeg?auto=compress&cs=tinysrgb&w=800',
 'Professional lighting', 'center', 1);
```

## Rozwiązywanie problemów:

**Problem: Nie widzę ikon edycji**
- Sprawdź czy jesteś zalogowany jako admin
- Sprawdź czy tryb edycji jest włączony (menu użytkownika → "Edytuj obrazy strony")
- Odśwież stronę (Ctrl+Shift+R lub Cmd+Shift+R)

**Problem: Ikony są widoczne, ale nie mogę zapisać zmian**
- Wykonaj SQL w panelu Supabase (patrz sekcja powyżej)
- Sprawdź czy masz uprawnienia w bazie danych

**Problem: Obraz nie ładuje się w podglądzie**
- Sprawdź czy URL jest poprawny
- Upewnij się, że URL zaczyna się od `https://`
- Spróbuj innego obrazu z Pexels

## Wskazówki:

- **Obrazy z Pexels** - zalecane, darmowe i wysokiej jakości
- **URL Desktop** - szerokość minimum 1920px
- **URL Mobile** - szerokość około 800px (opcjonalne)
- **Format** - najlepiej JPG lub WebP
- **Alt text** - ważny dla SEO i dostępności
