# 🔴 NAPRAW SYSTEM OBRAZÓW - KROK PO KROKU

## Problem: Tabela site_images NIE ISTNIEJE w bazie danych

Musisz ją utworzyć ręcznie w Supabase. Oto dokładna instrukcja:

---

## KROK 1: Otwórz Supabase

1. Wejdź na: https://supabase.com
2. Kliknij **"Sign in"** (lub zaloguj się)
3. Wybierz swój projekt z listy

---

## KROK 2: Otwórz SQL Editor

1. W menu po lewej stronie znajdź **"SQL Editor"**
2. Kliknij na **"SQL Editor"**
3. Zobaczysz białe pole tekstowe gdzie możesz wpisać SQL

---

## KROK 3: Skopiuj CAŁY ten SQL

**UWAGA: Skopiuj wszystko od linii `-- Create site_images table` do końca!**

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

---

## KROK 4: Wklej SQL w edytorze

1. Zaznacz cały SQL powyżej (od `-- Create site_images table` do końca)
2. Skopiuj (Ctrl+C lub Cmd+C)
3. Wklej w białym polu w SQL Editor (Ctrl+V lub Cmd+V)

---

## KROK 5: Uruchom SQL

1. Znajdź przycisk **"Run"** w prawym dolnym rogu
2. LUB naciśnij **Ctrl+Enter** (Windows/Linux) lub **Cmd+Enter** (Mac)
3. Poczekaj na komunikat **"Success"** lub zielony komunikat

---

## KROK 6: Sprawdź czy tabela została utworzona

1. W menu po lewej kliknij **"Table Editor"**
2. Powinieneś zobaczyć tabelę o nazwie **"site_images"** na liście
3. Jeśli ją widzisz - **SUKCES!**

---

## KROK 7: Testuj na stronie

1. Odśwież swoją stronę (Ctrl+Shift+R)
2. Zaloguj się jako admin (`/crm/login`)
3. Kliknij w menu użytkownika (prawy górny róg)
4. Wybierz **"Edytuj obrazy strony"**
5. Kliknij złotą ikonę edycji przy Hero
6. Wklej jakiś URL obrazu (np. z Pexels)
7. Kliknij **"Zapisz Zmiany"**
8. Powinno zadziałać bez błędu!

---

## Jeśli nadal nie działa:

### Problem 1: "Success" ale nadal błąd

- Wyloguj się i zaloguj ponownie
- Wyczyść cache przeglądarki (Ctrl+Shift+Delete)
- Spróbuj w trybie incognito

### Problem 2: SQL daje błąd "already exists"

To znaczy że tabela już istnieje! To dobrze. Przejdź do KROK 7.

### Problem 3: SQL daje inny błąd

Skopiuj dokładny komunikat błędu i sprawdź czy:

- Skopiowałeś CAŁY SQL (od początku do końca)
- Nie ma żadnych dodatkowych znaków na początku/końcu
- Wybrałeś właściwy projekt w Supabase

---

## Skąd wziąć darmowe obrazy URL?

### Pexels (zalecane):

1. Wejdź na: https://www.pexels.com/
2. Wyszukaj obraz (np. "business meeting")
3. Kliknij na obraz
4. Kliknij prawym przyciskiem na obrazie → "Copy image address"
5. Wklej ten URL w edytorze obrazów

### Format URL musi być:

```
✅ https://images.pexels.com/photos/123456/pexels-photo-123456.jpeg
✅ https://images.unsplash.com/photo-123456
❌ https://www.pexels.com/photo/example-123456/ (to link do strony!)
```

---

## Podsumowanie:

1. ✅ Skopiuj cały SQL z KROKU 3
2. ✅ Wklej w SQL Editor w Supabase
3. ✅ Kliknij "Run" lub Ctrl+Enter
4. ✅ Sprawdź Table Editor czy tabela istnieje
5. ✅ Odśwież stronę i testuj

**To wszystko! Jeśli wykonasz te kroki, system będzie działał.**
