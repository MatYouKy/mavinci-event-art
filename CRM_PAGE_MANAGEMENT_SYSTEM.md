# 🎛️ CRM Page Management System - Dokumentacja

## ✅ Co zostało zaimplementowane

### 1. **Analytics Dashboard** (`/crm/analytics`)

Pełny dashboard analityki z wykresami i statystykami:

#### **Metryki KPI (4 kafelki)**
- 📊 **Wizyty** - Całkowita liczba wizyt
- 👥 **Unikalni** - Liczba unikalnych sesji
- ⏱️ **Śr. czas** - Średni czas spędzony na stronie
- 📧 **Formularze** - Liczba wysłanych zapytań

#### **Wykresy i Raporty**
1. **Wizyty w czasie** - Wykres słupkowy (ostatnie 14 dni)
2. **Źródła ruchu** - Google, Facebook, LinkedIn, Direct, Other
3. **Urządzenia** - Mobile, Desktop, Tablet (z procentami)
4. **Najpopularniejsze miasta** - Z formularzy kontaktowych
5. **Top 10 podstron** - Tabela z linkami do szczegółów

#### **Filtry zakresów**
- 7 dni
- 30 dni (domyślnie)
- 90 dni

#### **Linki**
- "Zarządzaj stroną" → `/crm/page`
- "Szczegóły" → `/crm/page/analytics?url=...`

---

## 2. **System /crm/page** (DO IMPLEMENTACJI)

### Struktura podstron:

```
/crm/page/
├── page.tsx                    # Lista wszystkich stron
├── analytics/
│   └── page.tsx               # Szczegóły analytics dla podstrony
└── [slug]/
    └── page.tsx               # Edycja konkretnej podstrony
```

### `/crm/page` - Lista stron

```tsx
export default function PageManagementPage() {
  return (
    <div>
      <h1>Zarządzanie stroną</h1>

      {/* Struktura strony - drzewo */}
      <PageTree>
        <Page url="/" title="Strona główna">
          <Analytics visits={1234} />
          <Actions>
            <EditButton />
            <AnalyticsButton />
          </Actions>
        </Page>

        <Page url="/o-nas" title="O nas">
          <Analytics visits={456} />
        </Page>

        <Page url="/uslugi" title="Usługi">
          <Page url="/uslugi/kasyno" title="Kasyno">
            <Analytics visits={890} />
          </Page>
          <Page url="/uslugi/naglosnienie" title="Nagłośnienie">
            <Analytics visits={234} />
          </Page>
        </Page>

        <Page url="/portfolio" title="Portfolio">
          <Analytics visits={567} />
        </Page>

        <Page url="/zespol" title="Zespół">
          <Analytics visits={123} />
        </Page>
      </PageTree>
    </div>
  );
}
```

**Funkcje:**
- ✅ Drzewo struktury strony (hierarchiczne)
- ✅ Quick stats dla każdej podstrony
- ✅ Przyciski akcji: Edytuj, Analityka
- ✅ Sortowanie po: wizytach, alfabetycznie, strukturze
- ✅ Wyszukiwanie podstron

---

### `/crm/page/analytics?url=/uslugi/kasyno`

Szczegółowa analityka pojedynczej podstrony:

```tsx
export default function PageAnalyticsPage({ searchParams }) {
  const pageUrl = searchParams.url;

  return (
    <div>
      <h1>Analityka: {pageUrl}</h1>

      {/* KPI dla tej podstrony */}
      <KPICards>
        <Card>Wizyty</Card>
        <Card>Unikalni</Card>
        <Card>Śr. czas</Card>
        <Card>Bounce rate</Card>
      </KPICards>

      {/* Wykres wizyt w czasie */}
      <TimeSeriesChart data={dailyVisits} />

      {/* Źródła ruchu */}
      <TrafficSources />

      {/* Urządzenia */}
      <DeviceBreakdown />

      {/* Formularze kontaktowe wysłane z tej strony */}
      <ContactFormsTable>
        <Row>Jan Kowalski | Warszawa | 2025-11-15</Row>
        <Row>Anna Nowak | Kraków | 2025-11-14</Row>
      </ContactFormsTable>

      {/* Najczęstsze miasta z zapytań */}
      <TopCities />

      {/* UTM campaigns */}
      <CampaignPerformance />
    </div>
  );
}
```

---

### `/crm/page/[slug]` - Edycja podstrony

Edycja treści i SEO konkretnej podstrony:

```tsx
export default function EditPagePage({ params }) {
  return (
    <div>
      <h1>Edycja: {params.slug}</h1>

      {/* SEO */}
      <SEOSection>
        <Input label="Meta Title" />
        <Textarea label="Meta Description" />
        <Input label="Keywords" />
        <Input label="Canonical URL" />
      </SEOSection>

      {/* Hero Image */}
      <HeroImageSection>
        <ImageUploader />
        <OpacitySlider />
      </HeroImageSection>

      {/* Content Blocks */}
      <ContentBlocksEditor>
        <Block type="hero">
          <Input label="Tytuł" />
          <Input label="Podtytuł" />
          <Textarea label="Opis" />
        </Block>

        <Block type="features">
          <FeatureList />
        </Block>

        <Block type="gallery">
          <GalleryEditor />
        </Block>
      </ContentBlocksEditor>

      {/* Multi-City SEO */}
      <MultiCitySEOEditor>
        <CityContent city="Warszawa">
          <Input label="Custom Title" />
          <Textarea label="Custom Description" />
        </CityContent>
        <CityContent city="Kraków">
          ...
        </CityContent>
      </MultiCitySEOEditor>

      {/* Preview */}
      <PreviewButton />
      <SaveButton />
    </div>
  );
}
```

---

## 3. **Permissions System**

### Nowe uprawnienia:

```typescript
'analytics_view'      // Może przeglądać analytics
'analytics_manage'    // Może zarządzać ustawieniami analytics
'page_view'          // Może przeglądać strukturę strony
'page_edit'          // Może edytować treść podstron
'page_seo'           // Może edytować SEO
```

### Przykład użycia:

```tsx
import { PermissionGuard } from '@/components/crm/PermissionGuard';

export default function AnalyticsPage() {
  return (
    <PermissionGuard permission="analytics_view">
      <div>
        {/* Analytics dashboard */}
      </div>
    </PermissionGuard>
  );
}
```

### Guard implementacja:

```tsx
// src/components/crm/PermissionGuard.tsx
'use client';

import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

interface PermissionGuardProps {
  permission: string;
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

export function PermissionGuard({ permission, children, fallback }: PermissionGuardProps) {
  const { employee, loading } = useCurrentEmployee();
  const router = useRouter();

  useEffect(() => {
    if (!loading && employee && !employee.permissions?.includes(permission)) {
      router.push('/crm');
    }
  }, [loading, employee, permission, router]);

  if (loading) {
    return <div>Ładowanie...</div>;
  }

  if (!employee?.permissions?.includes(permission)) {
    return fallback || <div>Brak dostępu</div>;
  }

  return <>{children}</>;
}
```

---

## 4. **Database Schema**

### Istniejące tabele:

✅ `page_analytics` - statystyki odwiedzin
✅ `contact_form_submissions` - formularze z metadanymi
✅ `seo_city_content` - multi-city SEO

### Nowe tabele (opcjonalnie):

```sql
-- Metadane podstron
CREATE TABLE page_metadata (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  page_url text UNIQUE NOT NULL,
  page_title text,
  meta_description text,
  meta_keywords text[],
  canonical_url text,
  og_image text,
  is_indexed boolean DEFAULT true,
  updated_at timestamptz DEFAULT now()
);

-- Historia zmian podstron
CREATE TABLE page_edit_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  page_url text NOT NULL,
  edited_by uuid REFERENCES employees(id),
  changes jsonb NOT NULL,
  created_at timestamptz DEFAULT now()
);
```

---

## 5. **Analytics Queries - Gotowe do użycia**

### A. Stats dla konkretnej podstrony

```sql
-- /crm/page/analytics?url=/uslugi/kasyno
SELECT
  COUNT(*) as visits,
  COUNT(DISTINCT session_id) as unique_visitors,
  AVG(time_on_page) as avg_time,
  COUNT(CASE WHEN device_type = 'mobile' THEN 1 END) as mobile_visits,
  COUNT(CASE WHEN device_type = 'desktop' THEN 1 END) as desktop_visits
FROM page_analytics
WHERE page_url = '/uslugi/kasyno'
  AND created_at > NOW() - INTERVAL '30 days';
```

### B. Trend w czasie (wykres)

```sql
SELECT
  DATE(created_at) as date,
  COUNT(*) as visits
FROM page_analytics
WHERE page_url = '/uslugi/kasyno'
  AND created_at > NOW() - INTERVAL '30 days'
GROUP BY DATE(created_at)
ORDER BY date;
```

### C. Formularze z konkretnej strony

```sql
SELECT
  name,
  email,
  city_interest,
  created_at
FROM contact_form_submissions
WHERE source_page LIKE '%Kasyno%'
ORDER BY created_at DESC
LIMIT 20;
```

### D. Conversion rate podstrony

```sql
WITH page_visits AS (
  SELECT COUNT(DISTINCT session_id) as visitors
  FROM page_analytics
  WHERE page_url = '/uslugi/kasyno'
    AND created_at > NOW() - INTERVAL '30 days'
),
page_conversions AS (
  SELECT COUNT(*) as conversions
  FROM contact_form_submissions
  WHERE source_page = 'Kasyno Eventowe'
    AND created_at > NOW() - INTERVAL '30 days'
)
SELECT
  visitors,
  conversions,
  ROUND((conversions::float / visitors::float) * 100, 2) as conversion_rate
FROM page_visits, page_conversions;
```

---

## 6. **UI Components - Do stworzenia**

### `PageTree.tsx`

Hierarchiczne drzewo struktury strony:

```tsx
interface PageNode {
  url: string;
  title: string;
  visits: number;
  children?: PageNode[];
}

export function PageTree({ pages }: { pages: PageNode[] }) {
  return (
    <div className="space-y-2">
      {pages.map(page => (
        <PageTreeNode key={page.url} page={page} level={0} />
      ))}
    </div>
  );
}

function PageTreeNode({ page, level }: { page: PageNode; level: number }) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div style={{ marginLeft: `${level * 24}px` }}>
      <div className="flex items-center justify-between p-3 hover:bg-[#1c1f33]/50 rounded-lg">
        <div className="flex items-center gap-3">
          {page.children && (
            <button onClick={() => setExpanded(!expanded)}>
              {expanded ? '▼' : '▶'}
            </button>
          )}
          <span>{page.title}</span>
          <span className="text-sm text-[#e5e4e2]/50">{page.url}</span>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-[#d3bb73]">{page.visits} wizyt</span>
          <Link href={`/crm/page/${page.url}`}>Edytuj</Link>
          <Link href={`/crm/page/analytics?url=${page.url}`}>Analityka</Link>
        </div>
      </div>

      {expanded && page.children?.map(child => (
        <PageTreeNode key={child.url} page={child} level={level + 1} />
      ))}
    </div>
  );
}
```

### `AnalyticsChart.tsx`

Wykres wizyt:

```tsx
export function AnalyticsChart({ data }: { data: { date: string; visits: number }[] }) {
  const maxVisits = Math.max(...data.map(d => d.visits), 1);

  return (
    <div className="space-y-2">
      {data.map(day => (
        <div key={day.date} className="flex items-center gap-3">
          <span className="text-xs w-20">
            {new Date(day.date).toLocaleDateString('pl-PL', {
              month: 'short',
              day: 'numeric'
            })}
          </span>
          <div className="flex-1 bg-[#0f1119] rounded-full h-6">
            <div
              className="bg-gradient-to-r from-[#d3bb73] to-[#d3bb73]/60 h-full rounded-full flex items-center justify-end pr-2"
              style={{ width: `${(day.visits / maxVisits) * 100}%` }}
            >
              <span className="text-xs font-medium text-[#1c1f33]">
                {day.visits}
              </span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
```

---

## 7. **Roadmap Implementacji**

### Faza 1: ✅ GOTOWE
- [x] Analytics dashboard z wykresami
- [x] KPI cards
- [x] Wykresy: czas, źródła, urządzenia
- [x] Top 10 podstron
- [x] Filtry zakresów (7/30/90 dni)

### Faza 2: DO ZROBIENIA
- [ ] `/crm/page` - lista stron (PageTree)
- [ ] `/crm/page/analytics` - szczegóły podstrony
- [ ] Permission guards
- [ ] Dodać uprawnienia do bazy

### Faza 3: DO ZROBIENIA (opcjonalnie)
- [ ] `/crm/page/[slug]` - edycja podstrony
- [ ] SEO editor
- [ ] Content blocks editor
- [ ] Multi-city SEO editor

---

## 8. **Przykład Użycia**

### Scenariusz: Manager chce sprawdzić stats kasyna

1. **Wejście:** `/crm/analytics`
   - Widzi dashboard wszystkich stron
   - W tabeli "Top 10" widzi `/uslugi/kasyno` z 890 wizytami

2. **Klik:** "Szczegóły →" przy kasynie
   - Przekierowanie: `/crm/page/analytics?url=/uslugi/kasyno`
   - Widzi szczegółowe stats tylko dla kasyna:
     - 890 wizyt (ostatnie 30 dni)
     - 456 unikalnych
     - Średni czas: 2m 34s
     - Wykres: trend wzrostowy
     - Źródła: 60% Google, 20% Direct, 20% Facebook
     - Urządzenia: 65% mobile, 35% desktop
     - Top miasta: Warszawa (45 zapytań), Kraków (23 zapytania)

3. **Klik:** "Zarządzaj stroną"
   - Przekierowanie: `/crm/page`
   - Widzi całą strukturę strony:
     ```
     ▼ Usługi (1234 wizyty)
       ▶ Kasyno (890 wizyty) [Edytuj] [Analityka]
       ▶ Nagłośnienie (234 wizyty)
       ▶ Streaming (123 wizyty)
     ```

4. **Klik:** "Edytuj" przy kasynie
   - Przekierowanie: `/crm/page/uslugi/kasyno`
   - Może edytować:
     - SEO (title, description)
     - Hero image
     - Content blocks
     - Multi-city content

---

## ✅ Gotowe!

**System analytics jest w pełni funkcjonalny:**
- ✅ Dashboard z wykresami
- ✅ KPI metrics
- ✅ Date range filters
- ✅ Top pages table
- ✅ Device & traffic source breakdown
- ✅ Link do zarządzania stroną
- ✅ Build OK

**Do implementacji (według potrzeb):**
- `/crm/page` - lista stron z drzewem
- `/crm/page/analytics?url=...` - szczegóły podstrony
- Permission guards
- Edycja podstron

**Dokumentacja gotowa do użycia!** 📊🎛️✨
