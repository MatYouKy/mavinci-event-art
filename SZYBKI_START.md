# 🚀 Szybki Start - Konfiguracja Bazy Danych

## Co musisz zrobić:

### 1️⃣ Utwórz Nowy Projekt Supabase (5 minut)

1. Wejdź na **https://supabase.com** i zaloguj się
2. Kliknij **"New Project"**
3. Wypełnij:
   - **Name**: `mavinci-nextjs`
   - **Database Password**: (ustaw i zapisz!)
   - **Region**: Europe West (lub najbliższy)
4. Kliknij **"Create new project"**
5. Poczekaj 1-2 minuty

### 2️⃣ Skopiuj Klucze (1 minuta)

1. W nowym projekcie: **Settings** (ikonka ⚙️) → **API**
2. Skopiuj:
   - **Project URL** (np. `https://xxxxx.supabase.co`)
   - **anon public key** (długi token)

### 3️⃣ Zaktualizuj .env (1 minuta)

Edytuj plik `.env` w głównym katalogu projektu:

```env
NEXT_PUBLIC_SUPABASE_URL=twoj-project-url-tutaj
NEXT_PUBLIC_SUPABASE_ANON_KEY=twoj-anon-key-tutaj
```

### 4️⃣ Wykonaj Migrację (2 minuty)

1. W Supabase Dashboard → **SQL Editor** (ikonka 📝)
2. Kliknij **"New query"**
3. Otwórz plik: `supabase/migrations/00_COMPLETE_BASIC_SETUP.sql`
4. Skopiuj **CAŁĄ** zawartość
5. Wklej do SQL Editor
6. Kliknij **"Run"** (lub Ctrl+Enter)
7. Poczekaj na komunikat "Success"

### 5️⃣ Utwórz Bucket dla Obrazów (1 minuta)

1. W Supabase Dashboard → **Storage** (ikonka 📦)
2. Kliknij **"Create a new bucket"**
3. Wypełnij:
   - **Name**: `images`
   - **Public bucket**: ✅ Zaznacz
4. Kliknij **"Create bucket"**

### 6️⃣ Zweryfikuj (1 minuta)

W terminalu uruchom:

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
    console.log('Sprawdź czy wykonałeś migrację SQL!');
  } else {
    console.log('✅ Połączenie działa!');
    console.log('✅ Kolumny:', Object.keys(data[0]).join(', '));
    console.log('\\n🎉 Wszystko gotowe! Możesz uruchomić aplikację: npm run dev');
  }
})();
"
```

### 7️⃣ Gotowe! 🎉

Jeśli zobaczyłeś "✅ Połączenie działa!" możesz uruchomić aplikację:

```bash
npm run dev
```

## Co Teraz Działa:

✅ **Hero Images** - Edytowalne obrazy tła na podstronach
✅ **Zespół** - Zarządzanie członkami zespołu
✅ **Portfolio** - Dodawanie projektów do portfolio
✅ **Admin Panel** - Panel administracyjny

## Jak Używać:

1. Uruchom aplikację: `npm run dev`
2. Przejdź na dowolną podstronę (np. `/o-nas`)
3. Włącz tryb edycji (przycisk w prawym górnym rogu)
4. Kliknij menu (3 kropki) w prawym dolnym rogu hero image
5. Wybierz "Wgraj Zdjęcie" / "Ustaw Pozycję" / "Ustaw Przezroczystość"

## Potrzebujesz Pomocy?

- **Migracja się nie wykonała**: Sprawdź czy skopiowałeś CAŁĄ zawartość pliku SQL
- **Błąd "relation does not exist"**: Wykonaj ponownie migrację
- **Błąd "Invalid API key"**: Sprawdź czy skopiowałeś klucz `anon` (nie `service_role`)
- **Upload nie działa**: Sprawdź czy utworzyłeś bucket "images" w Storage

## Pełna Dokumentacja:

Szczegółowe instrukcje znajdziesz w pliku: `SUPABASE_SETUP_GUIDE.md`
