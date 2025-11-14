# 🎯 System Dedykowanych Tabel dla Każdej Strony

## Co zostało stworzone?

Każda strona ma teraz **2 dedykowane tabele**:

### 1. Tabela Zawartości: `{page}_page`

Przechowuje teksty:

- `hero_title` - Tytuł główny
- `hero_subtitle` - Podtytuł
- `section_title` - Tytuł sekcji
- `section_description` - Opis
- `cta_title`, `cta_description` - Call to action
- `seo_title`, `seo_description`, `seo_keywords` - SEO

### 2. Tabela Obrazów: `{page}_page_images`

Przechowuje obrazy:

- `section` - 'hero', 'gallery', 'background'
- `image_url` - URL obrazu
- `image_metadata` - Pozycja, skala, objectFit
- `opacity` - Przezroczystość (0-1)
- `order_index` - Kolejność

## 📋 Kompletna Lista Tabel

| Strona        | Tabela Zawartości | Tabela Obrazów          |
| ------------- | ----------------- | ----------------------- |
| **Zespół**    | `team_page`       | `team_page_images`      |
| **Home**      | `home_page`       | `home_page_images`      |
| **O Nas**     | `about_page`      | `about_page_images`     |
| **Usługi**    | `services_page`   | `services_page_images`  |
| **Portfolio** | `portfolio_page`  | `portfolio_page_images` |
| **Kontakt**   | `contact_page`    | `contact_page_images`   |

Dodatkowe tabele:

- `team_members` - Członkowie zespołu
- `portfolio_projects` - Projekty
- `admin_users` - Administratorzy

## 🚀 Jak Zastosować Migrację?

### Krok 1: Otwórz Supabase SQL Editor

1. Zaloguj się do Supabase Dashboard
2. Wybierz swój projekt
3. Kliknij **SQL Editor** w menu

### Krok 2: Wykonaj Migrację

1. Otwórz plik: `supabase/migrations/00_COMPLETE_SETUP_WITH_PAGES.sql`
2. Skopiuj **CAŁĄ** zawartość
3. Wklej do SQL Editor
4. Kliknij **Run** (Ctrl+Enter)

### Krok 3: Sprawdź Wynik

Powinieneś zobaczyć: "Success. No rows returned"

## 💡 Jak Używać w Kodzie?

### Pobierz Hero Image:

```typescript
const { data: heroImage } = await supabase
  .from('team_page_images')
  .select('*')
  .eq('section', 'hero')
  .eq('is_active', true)
  .single();
```

### Pobierz Zawartość Strony:

```typescript
const { data: pageContent } = await supabase.from('team_page').select('*').single();
```

### Zaktualizuj Obraz (pozycja/opacity):

```typescript
await supabase
  .from('team_page_images')
  .update({
    opacity: 0.3,
    image_metadata: {
      desktop: {
        position: { posX: 10, posY: 20, scale: 1.2 },
        objectFit: 'cover',
      },
      mobile: {
        position: { posX: 0, posY: 0, scale: 1 },
        objectFit: 'cover',
      },
    },
  })
  .eq('section', 'hero');
```

### Upload Nowego Zdjęcia:

```typescript
// 1. Upload do Supabase Storage
const fileName = `team/${Date.now()}.jpg`;
const { data: uploadData } = await supabase.storage.from('images').upload(fileName, file);

// 2. Pobierz publiczny URL
const {
  data: { publicUrl },
} = supabase.storage.from('images').getPublicUrl(uploadData.path);

// 3. Zapisz w bazie
await supabase.from('team_page_images').update({ image_url: publicUrl }).eq('section', 'hero');
```

## ✅ Zalety

✅ **Separacja** - Każda strona ma własne dane
✅ **Przejrzystość** - Łatwo znaleźć dane konkretnej strony
✅ **Skalowalność** - Dodawaj pola tylko do potrzebnych stron
✅ **Wielość obrazów** - Hero, galeria, tła w jednej tabeli
✅ **Kontrola** - RLS dla każdej tabeli osobno

## 📝 Przykład Implementacji

```typescript
// app/zespol/page.tsx
import { supabase } from '@/lib/supabase';

export default async function TeamPage() {
  // Pobierz zawartość
  const { data: content } = await supabase
    .from('team_page')
    .select('*')
    .single();

  // Pobierz obrazy
  const { data: images } = await supabase
    .from('team_page_images')
    .select('*')
    .eq('is_active', true)
    .order('order_index');

  const heroImage = images?.find(img => img.section === 'hero');

  return (
    <div>
      <PageHeroImage
        section="team"
        imageUrl={heroImage?.image_url}
        opacity={heroImage?.opacity}
        metadata={heroImage?.image_metadata}
      >
        <h1>{content?.hero_title}</h1>
        <p>{content?.hero_subtitle}</p>
      </PageHeroImage>

      {/* Sekcja zespołu */}
      <section>
        <h2>{content?.section_title}</h2>
        <p>{content?.section_description}</p>
        {/* Lista członków zespołu */}
      </section>
    </div>
  );
}
```

## 🔧 Troubleshooting

**"relation team_page_images does not exist"**
→ Wykonaj migrację `00_COMPLETE_SETUP_WITH_PAGES.sql`

**"duplicate key value"**
→ Dane już istnieją, usuń INSERT lub użyj UPSERT

**Upload nie działa**
→ Sprawdź czy bucket "images" istnieje i jest publiczny

**Brak obrazu po zapisie**
→ Sprawdź `is_active = true` i czy `section = 'hero'`
