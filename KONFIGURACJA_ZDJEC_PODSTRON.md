# Konfiguracja Zdjęć dla Podstron /usługi

## ✅ Co zostało skonfigurowane w Supabase

### 1. **Storage Bucket: `site-images`**

Bucket został utworzony z następującymi parametrami:

- **Nazwa**: `site-images`
- **Dostęp**: Publiczny (public = true)
- **Limit rozmiaru**: 5 MB (5242880 bajtów)
- **Dozwolone formaty**:
  - image/jpeg
  - image/jpg
  - image/png
  - image/webp

### 2. **Polityki Storage (Storage Policies)**

Utworzone polityki RLS dla bucketu `site-images`:

#### Odczyt (Read):

- ✅ **"Public read access for site images"** - Każdy może przeglądać i pobierać zdjęcia

#### Zapis (Upload/Insert):

- ✅ **"Authenticated users can upload site images"** - Zalogowani użytkownicy mogą przesyłać
- ✅ **"Anyone can upload site images"** - Wszyscy (także niezalogowani) mogą przesyłać

#### Aktualizacja (Update):

- ✅ **"Authenticated users can update site images"** - Zalogowani użytkownicy mogą aktualizować
- ✅ **"Anyone can update site images"** - Wszyscy mogą aktualizować

#### Usuwanie (Delete):

- ✅ **"Authenticated users can delete site images"** - Zalogowani użytkownicy mogą usuwać
- ✅ **"Anyone can delete site images"** - Wszyscy mogą usuwać

### 3. **Tabele w Bazie Danych**

Dla każdej podstrony usług utworzona jest dedykowana tabela:

| Podstrona URL                 | Nazwa Tabeli w Bazie              |
| ----------------------------- | --------------------------------- |
| `/uslugi/konferencje`         | `konferencje_page_images`         |
| `/uslugi/streaming`           | `streaming_page_images`           |
| `/uslugi/integracje`          | `integracje_page_images`          |
| `/uslugi/kasyno`              | `kasyno_page_images`              |
| `/uslugi/symulatory-vr`       | `symulatory-vr_page_images`       |
| `/uslugi/naglosnienie`        | `naglosnienie_page_images`        |
| `/uslugi/quizy-teleturnieje`  | `quizy-teleturnieje_page_images`  |
| `/uslugi/technika-sceniczna`  | `technika-sceniczna_page_images`  |
| `/uslugi/wieczory-tematyczne` | `wieczory-tematyczne_page_images` |
| `/portfolio`                  | `portfolio_page_images`           |

#### Struktura Tabeli (przykład dla `konferencje_page_images`):

```sql
- id (uuid, PRIMARY KEY)
- section (text) - np. 'hero'
- name (text) - Nazwa zdjęcia
- description (text) - Opis zdjęcia
- image_url (text) - URL do zdjęcia w Storage
- alt_text (text) - Tekst alternatywny dla SEO
- order_index (integer) - Kolejność wyświetlania
- is_active (boolean) - Czy zdjęcie jest aktywne
- opacity (numeric) - Przezroczystość warstwy (0.0 - 1.0)
- image_metadata (jsonb) - Metadane pozycji i skalowania
- created_at (timestamptz)
- updated_at (timestamptz)
```

### 4. **Polityki RLS dla Tabel**

Każda tabela ma włączone Row Level Security z politykami:

- ✅ Publiczny odczyt (SELECT)
- ✅ Zalogowani użytkownicy mogą zarządzać wszystkimi operacjami (INSERT, UPDATE, DELETE)

## 🔧 Jak działa system przesyłania zdjęć?

### Proces przesyłania:

1. **Użytkownik wybiera zdjęcie** w interfejsie edycji (gdy `isEditMode = true`)

2. **Kompresja obrazu** (automatyczna jeśli > 2MB):
   - Maksymalna szerokość/wysokość: 1920px
   - Format docelowy: JPEG
   - Jakość dopasowana do limitu 2MB

3. **Upload do Storage**:

   ```typescript
   // Ścieżka: /site-images/{folder}/{timestamp}-{random}.jpg
   // Przykład: /site-images/hero/1234567890-abc123.jpg
   ```

4. **Zapisanie metadanych do tabeli**:
   - URL zdjęcia zapisywany w kolumnie `image_url`
   - Opcjonalnie: `opacity`, `image_metadata`, etc.

5. **Zwrócenie publicznego URL**:
   ```
   https://{project}.supabase.co/storage/v1/object/public/site-images/hero/1234567890-abc123.jpg
   ```

## 📋 Checklist - Co jest potrzebne w Supabase?

### Storage:

- ✅ Bucket `site-images` utworzony
- ✅ Bucket ma status publiczny (public = true)
- ✅ Polityki Storage skonfigurowane
- ✅ Limity rozmiaru ustawione (5MB)

### Database:

- ✅ Tabele dla każdej podstrony utworzone
- ✅ Tabele mają kolumny: `image_url`, `opacity`, `image_metadata`
- ✅ RLS włączone na wszystkich tabelach
- ✅ Polityki RLS skonfigurowane

### Authentication (opcjonalne):

- ⚠️ Jeśli chcesz ograniczyć upload tylko do zalogowanych, wyłącz polityki "Anyone can..."
- ℹ️ Obecnie system pozwala na upload także niezalogowanym użytkownikom

## 🎯 Testowanie

Aby przetestować czy wszystko działa:

1. Przejdź na stronę np. `/uslugi/konferencje`
2. Włącz tryb edycji (przycisk "Tryb Edycji")
3. Kliknij na menu "⋮" na zdjęciu hero
4. Wybierz "Zmień zdjęcie"
5. Wybierz plik obrazu z dysku
6. Zdjęcie powinno:
   - Zostać skompresowane (jeśli > 2MB)
   - Przesłane do Storage
   - Wyświetlone na stronie
   - Zapisane w bazie danych

## 🐛 Możliwe problemy i rozwiązania

### Problem: "Upload failed: new row violates row-level security policy"

**Rozwiązanie**: Sprawdź czy polityki Storage są poprawnie skonfigurowane. Możliwe, że brakuje polityk dla `anon` jeśli użytkownik nie jest zalogowany.

### Problem: "Could not find the 'image_metadata' column"

**Rozwiązanie**: Upewnij się, że wszystkie tabele mają kolumnę `image_metadata` typu `jsonb`.

### Problem: Zdjęcie nie jest widoczne po przesłaniu

**Rozwiązanie**:

1. Sprawdź czy bucket ma ustawienie `public = true`
2. Sprawdź politykę "Public read access"
3. Zweryfikuj URL w bazie danych

## 📚 Dokumentacja kodu

### Główne pliki:

1. **`src/lib/storage.ts`** - Funkcje upload/delete obrazów
2. **`src/components/PageHeroImage.tsx`** - Komponent obsługujący zdjęcia hero dla podstron
3. **`src/lib/siteImages.ts`** - Funkcje pomocnicze dla obrazów

### Przykład użycia w kodzie:

```typescript
import { uploadImage } from '@/lib/storage';

// Przesyłanie zdjęcia
const url = await uploadImage(file, 'hero');

// URL jest gotowy do zapisania w bazie:
// https://{project}.supabase.co/storage/v1/object/public/site-images/hero/...
```

## 🔐 Bezpieczeństwo

**Obecnie**: System pozwala wszystkim użytkownikom na upload, update i delete.

**Zalecenia produkcyjne**:

1. Usuń polityki "Anyone can..." dla INSERT, UPDATE, DELETE
2. Zostaw tylko polityki dla `authenticated` użytkowników
3. Opcjonalnie: Dodaj role-based access control (RBAC)

Aby to zrobić, uruchom w SQL Editor Supabase:

```sql
DROP POLICY "Anyone can upload site images" ON storage.objects;
DROP POLICY "Anyone can update site images" ON storage.objects;
DROP POLICY "Anyone can delete site images" ON storage.objects;
```

---

**Status**: ✅ System jest w pełni skonfigurowany i gotowy do użycia!
