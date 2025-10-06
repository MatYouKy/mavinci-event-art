# Instrukcja konfiguracji systemu edycji obrazów strony

## Krok 1: Uruchom migracje w Supabase

Przejdź do panelu Supabase → SQL Editor i wykonaj poniższe zapytania:

### 1. Utwórz tabelę site_images

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

-- Policy for public read access (anyone can view active images)
CREATE POLICY "Anyone can view active site images"
  ON site_images
  FOR SELECT
  USING (is_active = true);

-- Policy for authenticated users to view all images (including inactive)
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

-- Create trigger to automatically update updated_at
CREATE TRIGGER trigger_update_site_images_updated_at
  BEFORE UPDATE ON site_images
  FOR EACH ROW
  EXECUTE FUNCTION update_site_images_updated_at();
```

### 2. Dodaj dane przykładowe (opcjonalnie)

```sql
-- Insert Hero section image
INSERT INTO site_images (section, name, description, desktop_url, mobile_url, alt_text, position, order_index)
VALUES
(
  'hero',
  'Hero Background',
  'Main hero section background image on homepage',
  'https://images.pexels.com/photos/1763075/pexels-photo-1763075.jpeg?auto=compress&cs=tinysrgb&w=1920',
  'https://images.pexels.com/photos/1763075/pexels-photo-1763075.jpeg?auto=compress&cs=tinysrgb&w=800',
  'Profesjonalna organizacja eventów biznesowych',
  'center',
  1
);

-- Insert Divider section images
INSERT INTO site_images (section, name, description, desktop_url, mobile_url, alt_text, position, order_index)
VALUES
(
  'divider1',
  'Divider 1 Background',
  'First divider section background',
  'https://images.pexels.com/photos/1540406/pexels-photo-1540406.jpeg?auto=compress&cs=tinysrgb&w=1920',
  'https://images.pexels.com/photos/1540406/pexels-photo-1540406.jpeg?auto=compress&cs=tinysrgb&w=800',
  'Event decoration and setup',
  'center',
  1
),
(
  'divider2',
  'Divider 2 Background',
  'Second divider section background',
  'https://images.pexels.com/photos/2608517/pexels-photo-2608517.jpeg?auto=compress&cs=tinysrgb&w=1920',
  'https://images.pexels.com/photos/2608517/pexels-photo-2608517.jpeg?auto=compress&cs=tinysrgb&w=800',
  'Professional event lighting',
  'center',
  1
),
(
  'divider3',
  'Divider 3 Background',
  'Third divider section background',
  'https://images.pexels.com/photos/1190298/pexels-photo-1190298.jpeg?auto=compress&cs=tinysrgb&w=1920',
  'https://images.pexels.com/photos/1190298/pexels-photo-1190298.jpeg?auto=compress&cs=tinysrgb&w=800',
  'Corporate event venue',
  'center',
  1
),
(
  'divider4',
  'Divider 4 Background',
  'Fourth divider section background',
  'https://images.pexels.com/photos/1157557/pexels-photo-1157557.jpeg?auto=compress&cs=tinysrgb&w=1920',
  'https://images.pexels.com/photos/1157557/pexels-photo-1157557.jpeg?auto=compress&cs=tinysrgb&w=800',
  'Event stage and audio equipment',
  'center',
  1
);
```

## Krok 2: Jak używać systemu edycji obrazów

1. **Zaloguj się jako admin** (przez /crm/login lub /admin/login)

2. **Włącz tryb edycji:**
   - Kliknij w swoje menu użytkownika (awatar/inicjały w prawym górnym rogu)
   - Wybierz opcję "Edytuj obrazy strony"

3. **Edytuj obrazy:**
   - Po włączeniu trybu edycji, przy każdym obrazie na stronie pojawi się złota ikona edycji (ołówek)
   - Kliknij ikonę aby otworzyć edytor
   - Wklej nowy URL obrazu (desktop i opcjonalnie mobile)
   - Zobacz podgląd na żywo
   - Zapisz zmiany

4. **Wyłącz tryb edycji:**
   - Ponownie kliknij w menu użytkownika
   - Wybierz "Wyłącz edycję obrazów"

## Dostępne sekcje do edycji

- `hero` - Tło głównej sekcji hero na stronie głównej
- `divider1` - Pierwsze tło divider
- `divider2` - Drugie tło divider
- `divider3` - Trzecie tło divider
- `divider4` - Czwarte tło divider
- `process` - Tło sekcji proces
- Oraz wiele innych sekcji dla podstron

## Ważne informacje

- Zmiany są natychmiastowe po zapisaniu
- Strona automatycznie się przeładuje po zapisaniu
- Możesz dodać osobne obrazy dla desktop i mobile
- Alt text jest ważny dla SEO i dostępności
