# Instrukcja - Konfiguracja Nowej Bazy Danych Supabase

## Krok 1: Utwórz Nowy Projekt Supabase

1. Przejdź na https://supabase.com
2. Zaloguj się lub utwórz konto
3. Kliknij **"New Project"**
4. Wypełnij dane:
   - **Name**: `mavinci-nextjs` (lub dowolna nazwa)
   - **Database Password**: Ustaw silne hasło (zapisz je!)
   - **Region**: Wybierz najbliższy region (np. Europe West)
   - **Pricing Plan**: Free (wystarczy na początek)
5. Kliknij **"Create new project"**
6. Poczekaj 1-2 minuty aż projekt się utworzy

## Krok 2: Pobierz Klucze API

1. W lewym menu kliknij ikonę **"Settings"** (koło zębate)
2. Przejdź do zakładki **"API"**
3. Znajdź sekcję **"Project API keys"**
4. Skopiuj:
   - **Project URL** (coś jak: `https://xxxxx.supabase.co`)
   - **anon public** key (długi token JWT)

## Krok 3: Zaktualizuj Plik .env

Edytuj plik `.env` w głównym katalogu projektu:

```env
NEXT_PUBLIC_SUPABASE_URL=https://twoj-projekt.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=twoj-anon-key-tutaj
```

Zastąp wartości tymi, które skopiowałeś w kroku 2.

## Krok 4: Zastosuj Migracje

Przejdź do **SQL Editor** w Supabase Dashboard i wykonaj po kolei wszystkie migracje z katalogu `supabase/migrations/`:

### 4.1 Podstawowa Struktura

```sql
-- Wykonaj: 20250102000001_initial_schema.sql
```

Otwórz plik `supabase/migrations/20250102000001_initial_schema.sql` i skopiuj całą jego zawartość do SQL Editor, następnie kliknij **Run**.

### 4.2 Metadata Obrazów

```sql
-- Wykonaj: 20250102000002_add_image_metadata.sql
```

Otwórz plik `supabase/migrations/20250102000002_add_image_metadata.sql`, skopiuj zawartość i wykonaj w SQL Editor.

### 4.3 System Team Members

```sql
-- Wykonaj: 20251007065704_create_team_members_table.sql
```

Powtórz proces dla tego pliku.

### 4.4 Site Images z Metadanymi

```sql
-- Wykonaj: 20251007071613_20251006200000_create_site_images_system.sql
```

### 4.5 Portfolio Projects

```sql
-- Wykonaj: 20251007120000_create_portfolio_projects_table.sql
```

### 4.6 Admin Users

```sql
-- Wykonaj: 20251007121500_create_admin_users_system.sql
```

### 4.7 Dodaj Opacity i Metadata

```sql
-- Wykonaj: 20251008150000_add_metadata_and_opacity_to_site_images.sql
```

**WAŻNE**: Ta migracja dodaje kolumny `opacity` i `image_metadata` do tabeli `site_images`, które są wymagane dla PageHeroImage.

## Krok 5: Konfiguracja Storage (Opcjonalnie)

Jeśli chcesz przechowywać obrazy w Supabase Storage:

1. W lewym menu kliknij **"Storage"**
2. Kliknij **"Create a new bucket"**
3. Nazwa: `images`
4. **Public bucket**: Zaznacz (obrazy będą publiczne)
5. Kliknij **"Create bucket"**

## Krok 6: Zweryfikuj Instalację

Uruchom w terminalu:

```bash
node -e "
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

(async () => {
  const { data, error } = await supabase
    .from('site_images')
    .select('*')
    .limit(1);

  if (error) {
    console.log('❌ Błąd:', error.message);
  } else {
    console.log('✅ Połączenie działa! Kolumny:', Object.keys(data[0] || {}));
  }
})();
"
```

Jeśli zobaczysz "✅ Połączenie działa!" oraz listę kolumn zawierającą `opacity` i `image_metadata`, to wszystko jest gotowe!

## Krok 7: Utwórz Administratora (Opcjonalnie)

Jeśli chcesz mieć dostęp do panelu admina:

```bash
npm run create-admin
```

Podaj email i hasło - zostanie utworzony użytkownik w tabeli `admin_users`.

## Co Dalej?

Po zakończeniu konfiguracji:

1. ✅ Aplikacja będzie zapisywać dane do TWOJEJ bazy danych
2. ✅ Upload zdjęć będzie działać
3. ✅ Zapisywanie pozycji i przezroczystości będzie działać
4. ✅ System CRM będzie działać (jeśli zastosowałeś wszystkie migracje)

## Rozwiązywanie Problemów

### "relation does not exist"
Wykonaj odpowiednią migrację SQL dla brakującej tabeli.

### "column does not exist"
Upewnij się, że wykonałeś migrację `20251008150000_add_metadata_and_opacity_to_site_images.sql`.

### "Invalid API key"
Sprawdź czy skopiowałeś poprawny klucz `anon` (nie `service_role`).

### "Not connected to the internet"
Sprawdź czy URL projektu jest poprawny i czy projekt jest aktywny.
