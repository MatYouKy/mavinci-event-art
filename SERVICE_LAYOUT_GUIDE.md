# ServiceLayout - Przewodnik użycia

## Opis

`ServiceLayout` to komponent wrapper dla stron usług, wzorowany na sukcesie `OfferLayout`. Automatycznie dodaje:

- ✅ **Edytowalną sekcję Hero** z zarządzaniem obrazem
- ✅ **PageLayout** z SEO i Schema.org
- ✅ **CategoryBreadcrumb** (okruszki nawigacyjne)
- ✅ **Jednolity design** dla wszystkich stron usług
- ✅ **WebsiteEditButton** integracja

## Lokalizacja

```
src/app/uslugi/ServiceLayout.tsx
```

## Struktura

```tsx
interface ServiceLayoutProps {
  children: React.ReactNode;  // Treść strony usługi
  pageSlug: string;           // Slug dla SEO (np. 'uslugi/streaming')
  section: string;            // Sekcja hero (np. 'streaming')
}
```

## Przykład użycia

### PRZED - Stara struktura strony usługi:

```tsx
'use client';

import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import { CategoryBreadcrumb } from '@/components/CategoryBreadcrumb';

export default function StreamingPage() {
  return (
    <>
      <Navbar />
      <div className="min-h-screen bg-[#0f1119]">
        {/* ❌ Ręczne hero */}
        <section className="relative h-[60vh]">
          <div style={{ backgroundImage: 'url(...)' }} />
          {/* ... */}
        </section>

        {/* ❌ Ręczne breadcrumbs */}
        <section className="px-6 pt-6">
          <div className="mx-auto max-w-7xl">
            <CategoryBreadcrumb pageSlug="/uslugi" />
          </div>
        </section>

        {/* Treść strony */}
        <section className="px-6 py-20">
          {/* ... */}
        </section>
      </div>
      <Footer />
    </>
  );
}
```

### PO - Z ServiceLayout:

```tsx
'use client';

import ServiceLayout from '@/app/uslugi/ServiceLayout';

export default function StreamingPage() {
  return (
    <ServiceLayout
      pageSlug="uslugi/streaming"
      section="streaming-hero"
    >
      {/* ✅ Tylko treść strony */}
      <section className="px-6 py-20">
        <div className="mx-auto max-w-7xl">
          <h2 className="text-3xl font-light text-[#e5e4e2] mb-8">
            Profesjonalny Streaming
          </h2>
          {/* ... */}
        </div>
      </section>
    </ServiceLayout>
  );
}
```

## Korzyści

### 1. Mniej kodu
- ❌ **PRZED:** ~100 linii boilerplate (Navbar, Hero, Breadcrumb, Footer)
- ✅ **PO:** ~10 linii wrappera

### 2. Edytowalne Hero
```tsx
// ✅ Automatyczne zarządzanie obrazem hero z Website Edit Mode
<EditableHeroSectionServer
  section="streaming-hero"
  pageSlug="uslugi/streaming"
/>
```

### 3. Spójny design
- Wszystkie strony usług wyglądają tak samo
- Łatwe globalne zmiany (edytujesz tylko ServiceLayout)

### 4. SEO i Schema.org
```tsx
// ✅ Automatyczne przez PageLayout
<PageLayout pageSlug="uslugi/streaming">
  {/* Canonical, Open Graph, Twitter Cards, JSON-LD */}
</PageLayout>
```

## Migracja istniejących stron

### Krok 1: Import ServiceLayout

```tsx
import ServiceLayout from '@/app/uslugi/ServiceLayout';
```

### Krok 2: Usuń boilerplate

Usuń:
- `<Navbar />`
- `<Footer />`
- Sekcję hero (zostanie zastąpiona przez EditableHeroSectionServer)
- `<CategoryBreadcrumb />` (zostanie dodany automatycznie)

### Krok 3: Opakuj treść

```tsx
export default function MyServicePage() {
  return (
    <ServiceLayout
      pageSlug="uslugi/moja-usluga"
      section="moja-usluga-hero"
    >
      {/* Zostaw tylko unikalną treść strony */}
    </ServiceLayout>
  );
}
```

## Przykłady dla różnych stron

### 1. Strona pojedynczej usługi (uslugi/[slug]/page.tsx)

```tsx
'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import ServiceLayout from '@/app/uslugi/ServiceLayout';

export default function ServiceDetailPage() {
  const params = useParams();
  const [service, setService] = useState<any>(null);

  useEffect(() => {
    // Load service data
  }, [params.slug]);

  if (!service) return null;

  return (
    <ServiceLayout
      pageSlug={`uslugi/${service.slug}`}
      section={`${service.slug}-hero`}
    >
      <section className="px-6 py-20">
        <div className="mx-auto max-w-7xl">
          <h2 className="text-3xl font-light text-[#e5e4e2] mb-6">
            {service.name}
          </h2>
          {/* Service details */}
        </div>
      </section>
    </ServiceLayout>
  );
}
```

### 2. Katalog usług (uslugi/page.tsx)

```tsx
'use client';

import ServiceLayout from '@/app/uslugi/ServiceLayout';

export default function UslugiPage() {
  return (
    <ServiceLayout
      pageSlug="uslugi"
      section="uslugi-hero"
    >
      {/* Hero już jest w ServiceLayout */}

      <section className="px-6 py-20">
        <div className="mx-auto max-w-7xl">
          {/* Search filters */}
          {/* Service grid */}
        </div>
      </section>

      {/* CTA Section */}
    </ServiceLayout>
  );
}
```

### 3. Custom strona usługi

```tsx
'use client';

import ServiceLayout from '@/app/uslugi/ServiceLayout';

export default function CustomServicePage() {
  return (
    <ServiceLayout
      pageSlug="uslugi/custom-service"
      section="custom-service-hero"
    >
      {/* Multiple sections */}
      <section className="px-6 py-20">
        <div className="mx-auto max-w-7xl">
          <h2>Sekcja 1</h2>
        </div>
      </section>

      <section className="bg-[#1c1f33] px-6 py-20">
        <div className="mx-auto max-w-7xl">
          <h2>Sekcja 2</h2>
        </div>
      </section>

      {/* CTA */}
    </ServiceLayout>
  );
}
```

## Zarządzanie obrazem Hero

### Z Website Edit Mode:

1. Zaloguj się do CRM
2. Włącz **Website Edit Mode**
3. Przejdź na stronę usługi
4. Kliknij **⋮** na Hero image
5. Wybierz opcję:
   - **Wgraj Zdjęcie** - upload nowego obrazu
   - **Ustaw Pozycję** - dopasuj pozycję (Desktop/Mobile)
   - **Ustaw Przezroczystość** - overlay
   - **Usuń Zdjęcie** - ukryj hero

### Z bazy danych:

```sql
-- Sprawdź istniejące hero images
SELECT section, name, image_url
FROM site_images
WHERE section LIKE '%hero%';

-- Dodaj nowy hero image dla usługi
INSERT INTO site_images (
  section,
  name,
  desktop_url,
  alt_text,
  opacity
) VALUES (
  'streaming-hero',
  'Streaming Hero',
  'https://...',
  'Profesjonalny streaming',
  0.2
);
```

## Customizacja

### Zmiana koloru tła:

```tsx
// W ServiceLayout.tsx
<div className="min-h-screen bg-[#CUSTOM_COLOR]">
  {/* ... */}
</div>
```

### Zmiana wysokości Hero:

```tsx
// W EditableHeroSectionServer lub lokalnie:
<EditableHeroSectionServer
  section={section}
  pageSlug={pageSlug}
  className="h-[70vh]" // Custom height
/>
```

### Wyłączenie Breadcrumb:

```tsx
// Dodaj prop do ServiceLayout
interface ServiceLayoutProps {
  showBreadcrumb?: boolean; // default: true
}

// W komponencie:
{showBreadcrumb && (
  <section className="px-6 pt-6">
    <CategoryBreadcrumb pageSlug={pageSlug} />
  </section>
)}
```

## Porównanie z OfferLayout

| Feature | OfferLayout | ServiceLayout |
|---------|-------------|---------------|
| Cel | Strony ofert | Strony usług |
| Hero Image | ✅ Edytowalny | ✅ Edytowalny |
| Breadcrumb | ✅ | ✅ |
| PageLayout | ✅ | ✅ |
| SEO | ✅ Auto | ✅ Auto |
| Design | Oferty | Usługi |

## Best Practices

### 1. Nazwowanie sekcji hero:

```tsx
// ✅ DOBRZE - opisowa nazwa
section="streaming-hero"
section="naglosnienie-hero"
section="konferencje-hero"

// ❌ ŹLE - generyczna nazwa
section="hero"
section="service-hero"
```

### 2. PageSlug zgodny z URL:

```tsx
// ✅ DOBRZE
pageSlug="uslugi/streaming"  // URL: /uslugi/streaming

// ❌ ŹLE
pageSlug="streaming"          // Nie pasuje do URL
```

### 3. Responsywność:

```tsx
// ✅ Używaj utility classes
<div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">

// ❌ Nie hardcoduj rozmiarów
<div style={{ width: '1200px' }}>
```

## Troubleshooting

### Problem: Hero image się nie wyświetla

**Rozwiązanie:**
1. Sprawdź czy rekord istnieje w bazie:
```sql
SELECT * FROM site_images WHERE section = 'your-section-hero';
```
2. Sprawdź czy `is_active = true`
3. Sprawdź czy URL obrazu jest poprawny

### Problem: Breadcrumb pokazuje złą ścieżkę

**Rozwiązanie:**
```tsx
// Upewnij się że pageSlug pasuje do struktury URL
<ServiceLayout pageSlug="uslugi/streaming" ... />
// nie
<ServiceLayout pageSlug="streaming" ... />
```

### Problem: SEO meta tags się nie aktualizują

**Rozwiązanie:**
- `PageLayout` używa `pageSlug` do generowania meta tags
- Upewnij się że dane w bazie `page_metadata` są aktualne
- Wyczyść cache przeglądarki (Ctrl+Shift+R)

## Przyszłe rozszerzenia

Możliwe dodatkowe props:

```tsx
interface ServiceLayoutProps {
  children: React.ReactNode;
  pageSlug: string;
  section: string;

  // Opcjonalne:
  showBreadcrumb?: boolean;      // default: true
  heroHeight?: string;           // default: '60vh'
  backgroundColor?: string;      // default: '#0f1119'
  maxWidth?: string;             // default: '7xl'
}
```

## Podsumowanie

✅ **ServiceLayout** to prosty, potężny wrapper dla stron usług
✅ Redukuje boilerplate kod o ~90%
✅ Zapewnia spójny design
✅ Ułatwia zarządzanie treścią przez Website Edit Mode
✅ Automatyczne SEO i Schema.org
✅ Łatwa migracja istniejących stron

**Używaj wszędzie gdzie masz strony usług!**
