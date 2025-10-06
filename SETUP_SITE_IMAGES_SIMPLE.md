# 🚨 WAŻNE: Utwórz tabelę site_images w Supabase

## System edycji obrazów jest gotowy, ale potrzebujesz tabeli w bazie!

### Krok 1: Otwórz SQL Editor w Supabase

1. Zaloguj się do **supabase.com**
2. Wybierz swój projekt
3. Kliknij **SQL Editor** w menu po lewej

### Krok 2: Skopiuj i wklej ten SQL

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

### Krok 3: Kliknij "Run" lub Ctrl+Enter

SQL zostanie wykonany i tabela zostanie utworzona!

### Krok 4: Testuj system

1. Zaloguj się jako admin na stronie (`/crm/login`)
2. Kliknij w menu użytkownika (prawy górny róg)
3. Wybierz "Edytuj obrazy strony"
4. Zobaczysz złote ikony edycji przy Hero i Dividerach
5. Kliknij ikonę, wklej URL obrazu (np. z Pexels)
6. Zapisz - gotowe!

## Skąd wziąć darmowe obrazy?

- **Pexels**: https://www.pexels.com/ (darmowe, wysokiej jakości)
- **Unsplash**: https://unsplash.com/ (darmowe, profesjonalne)
- **Pixabay**: https://pixabay.com/ (darmowe)

## Format URL:

Użyj bezpośredniego linku do obrazu:
```
✅ https://images.pexels.com/photos/123456/pexels-photo-123456.jpeg
❌ https://www.pexels.com/photo/example-123456/ (to link do strony, nie do obrazu)
```

## Troubleshooting:

**Problem: "Błąd podczas zapisywania obrazu"**
- Sprawdź czy wykonałeś SQL powyżej
- Sprawdź czy jesteś zalogowany jako admin

**Problem: "Nie widzę ikon edycji"**
- Sprawdź czy włączyłeś tryb edycji (menu użytkownika → "Edytuj obrazy strony")
- Odśwież stronę (Ctrl+Shift+R)

**Problem: "Obraz nie ładuje się"**
- Sprawdź czy URL jest bezpośrednim linkiem do obrazu
- Upewnij się, że URL zaczyna się od `https://`
