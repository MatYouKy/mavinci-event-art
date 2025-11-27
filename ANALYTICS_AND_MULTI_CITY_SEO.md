# 📊 Analytics & Multi-City SEO - Instrukcja Integracji

## ✅ Co zostało zaimplementowane

### 1. **Baza Danych - 3 Nowe Tabele**

```sql
page_analytics              -- Statystyki odwiedzin
contact_form_submissions    -- Formularze z metadanymi
seo_city_content           -- Treści dla miast (bez duplikacji)
```

### 2. **Komponenty**

- `ContactFormWithTracking` - Formularz z metadanymi
- `MultiCitySEO` - SEO dla wielu miast
- `usePageAnalytics` - Hook do trackingu

### 3. **Sample Data**

W bazie już są dane dla 6 miast:
- Warszawa
- Kraków
- Wrocław
- Poznań
- Gdańsk (Trójmiasto)
- Katowice (Śląsk)

---

## 🚀 Integracja na Stronie Kasyna

### Krok 1: Dodaj Analytics Tracking

W pliku `/src/app/uslugi/kasyno/page.tsx`:

```tsx
import { usePageAnalytics } from '@/hooks/usePageAnalytics';

export default function KasynoPage() {
  // Na początku komponentu
  usePageAnalytics('Kasyno Eventowe - Mavinci');

  // ... reszta kodu
}
```

**Co to robi:**
- ✅ Trackuje każde wejście na stronę
- ✅ Zapisuje referrer (skąd przyszli)
- ✅ Zapisuje device type (mobile/tablet/desktop)
- ✅ Mierzy czas spędzony na stronie (co 30s update)
- ✅ Zapisuje session ID

---

### Krok 2: Dodaj Formularz Kontaktowy z Tracking

```tsx
import { useState } from 'react';
import ContactFormWithTracking from '@/components/ContactFormWithTracking';

export default function KasynoPage() {
  const [contactFormOpen, setContactFormOpen] = useState(false);
  const [selectedCity, setSelectedCity] = useState('');

  return (
    <>
      {/* Twoja zawartość strony */}

      {/* Button CTA */}
      <button
        onClick={() => setContactFormOpen(true)}
        className="bg-[#d3bb73] text-[#1c1f33] px-8 py-3 rounded-full"
      >
        Skontaktuj się z nami
      </button>

      {/* Formularz */}
      <ContactFormWithTracking
        isOpen={contactFormOpen}
        onClose={() => setContactFormOpen(false)}
        sourcePage="Kasyno Eventowe"
        sourceSection="Hero CTA"
        defaultCity={selectedCity}
        defaultEventType="Kasyno eventowe"
      />
    </>
  );
}
```

**Metadane zapisywane w formularzu:**
- ✅ `source_page` - "Kasyno Eventowe"
- ✅ `source_section` - np. "Hero CTA", "Footer", "Pricing"
- ✅ `city_interest` - miasto wybrane przez użytkownika
- ✅ `event_type` - typ eventu
- ✅ `utm_source`, `utm_medium`, `utm_campaign` - automatycznie z URL
- ✅ `referrer` - skąd przyszli
- ✅ `user_agent` - urządzenie

---

### Krok 3: Dodaj Multi-City SEO

```tsx
import MultiCitySEO from '@/components/MultiCitySEO';

export default function KasynoPage() {
  const [selectedCity, setSelectedCity] = useState('');

  return (
    <>
      <Navbar />

      {/* Multi-City SEO Section - najlepiej zaraz po Hero */}
      <MultiCitySEO
        pageSlug="kasyno"
        onCityChange={(city) => {
          setSelectedCity(city);
          // Możesz też zaktualizować inne części strony
        }}
      />

      {/* Reszta zawartości */}
    </>
  );
}
```

**Co robi komponent Multi-City:**
1. ✅ Pokazuje selector miast (6 miast dostępnych)
2. ✅ Po wyborze miasta:
   - Zmienia `<title>` na dedykowany dla miasta
   - Zmienia meta description
   - Pokazuje lokalny content (landmarks, venues, coverage)
3. ✅ Wspiera parametr URL: `?miasto=Kraków`
4. ✅ Nie duplikuje treści - każde miasto ma unikalny opis

---

## 📊 Analiza Danych

### 1. **Statystyki Odwiedzin**

```sql
-- Top 10 najczęściej odwiedzanych stron
SELECT
  page_url,
  COUNT(*) as visits,
  AVG(time_on_page) as avg_time_seconds,
  COUNT(DISTINCT session_id) as unique_visitors
FROM page_analytics
WHERE created_at > NOW() - INTERVAL '30 days'
GROUP BY page_url
ORDER BY visits DESC
LIMIT 10;
```

### 2. **Źródła Ruchu**

```sql
-- Skąd przychodzą użytkownicy
SELECT
  CASE
    WHEN referrer LIKE '%google%' THEN 'Google'
    WHEN referrer LIKE '%facebook%' THEN 'Facebook'
    WHEN referrer = '' THEN 'Direct'
    ELSE 'Other'
  END as source,
  COUNT(*) as visits
FROM page_analytics
WHERE created_at > NOW() - INTERVAL '7 days'
GROUP BY source
ORDER BY visits DESC;
```

### 3. **Device Type**

```sql
-- Rozkład urządzeń
SELECT
  device_type,
  COUNT(*) as visits,
  ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 2) as percentage
FROM page_analytics
WHERE page_url = '/uslugi/kasyno'
GROUP BY device_type;
```

### 4. **Formularze Kontaktowe**

```sql
-- Najczęstsze miasta w zapytaniach
SELECT
  city_interest,
  COUNT(*) as submissions,
  COUNT(CASE WHEN status = 'converted' THEN 1 END) as converted
FROM contact_form_submissions
WHERE source_page = 'Kasyno Eventowe'
  AND created_at > NOW() - INTERVAL '30 days'
GROUP BY city_interest
ORDER BY submissions DESC;
```

### 5. **Conversion Funnel**

```sql
-- Ile osób otworzyło formularz vs wysłało
SELECT
  DATE(created_at) as date,
  source_page,
  COUNT(*) as submissions,
  COUNT(DISTINCT session_id) as unique_users
FROM contact_form_submissions
GROUP BY DATE(created_at), source_page
ORDER BY date DESC;
```

### 6. **UTM Campaign Performance**

```sql
-- Skuteczność kampanii reklamowych
SELECT
  utm_campaign,
  utm_source,
  utm_medium,
  COUNT(*) as conversions
FROM contact_form_submissions
WHERE utm_campaign IS NOT NULL
  AND created_at > NOW() - INTERVAL '30 days'
GROUP BY utm_campaign, utm_source, utm_medium
ORDER BY conversions DESC;
```

---

## 🎯 Multi-City SEO - Jak Działa

### Struktura URL

```
https://mavinci.pl/uslugi/kasyno             → Pokazuje selector miast
https://mavinci.pl/uslugi/kasyno?miasto=Warszawa  → Auto-load Warszawa
https://mavinci.pl/uslugi/kasyno?miasto=Kraków    → Auto-load Kraków
```

### Meta Tags (dynamiczne)

#### **Warszawa:**
```html
<title>Kasyno Eventowe Warszawa - Profesjonalna Organizacja | Mavinci</title>
<meta name="description" content="Wynajmij stoły do kasyna w Warszawie. Profesjonalna organizacja eventów z kasynem w centrum i całym województwie mazowieckim. 15 lat doświadczenia.">
```

#### **Kraków:**
```html
<title>Kasyno na Event Kraków - Stoły do Pokera i Ruletki | Mavinci</title>
<meta name="description" content="Wynajem kasyna eventowego w Krakowie. Profesjonalne stoły: ruletka, poker, blackjack. Obsługa eventów firmowych w Krakowie i Małopolsce.">
```

### Unikalna Zawartość

Każde miasto ma:
- ✅ Własny H1
- ✅ Własny opis SEO
- ✅ Lokalne landmarks (np. "Stare Miasto", "Rynek")
- ✅ Lokalne venues (np. "ICE Kraków", "Tauron Arena")
- ✅ Zasięg (np. "Kraków i Małopolska")

**Nie ma duplikacji!** Google widzi unikalne treści dla każdego miasta.

---

## 📈 Dashboard Analytics (Opcjonalnie)

Możesz stworzyć prostą stronę `/crm/analytics`:

```tsx
'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';

export default function AnalyticsDashboard() {
  const [stats, setStats] = useState({
    totalVisits: 0,
    uniqueVisitors: 0,
    avgTimeOnPage: 0,
    contactForms: 0,
  });

  useEffect(() => {
    fetchStats();
  }, []);

  const fetchStats = async () => {
    // Total visits (last 30 days)
    const { count: totalVisits } = await supabase
      .from('page_analytics')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString());

    // Unique visitors
    const { data: sessions } = await supabase
      .from('page_analytics')
      .select('session_id')
      .gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString());

    const uniqueVisitors = new Set(sessions?.map(s => s.session_id)).size;

    // Avg time
    const { data: times } = await supabase
      .from('page_analytics')
      .select('time_on_page')
      .gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
      .gt('time_on_page', 0);

    const avgTimeOnPage = times?.reduce((acc, t) => acc + t.time_on_page, 0) / (times?.length || 1);

    // Contact forms
    const { count: contactForms } = await supabase
      .from('contact_form_submissions')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString());

    setStats({
      totalVisits: totalVisits || 0,
      uniqueVisitors,
      avgTimeOnPage: Math.round(avgTimeOnPage || 0),
      contactForms: contactForms || 0,
    });
  };

  return (
    <div className="p-8">
      <h1 className="text-3xl font-light text-[#e5e4e2] mb-8">Analytics Dashboard</h1>

      <div className="grid grid-cols-4 gap-6">
        <div className="bg-[#1c1f33] border border-[#d3bb73]/20 rounded-xl p-6">
          <div className="text-3xl font-light text-[#d3bb73] mb-2">
            {stats.totalVisits}
          </div>
          <div className="text-sm text-[#e5e4e2]/60">Wizyty (30 dni)</div>
        </div>

        <div className="bg-[#1c1f33] border border-[#d3bb73]/20 rounded-xl p-6">
          <div className="text-3xl font-light text-[#d3bb73] mb-2">
            {stats.uniqueVisitors}
          </div>
          <div className="text-sm text-[#e5e4e2]/60">Unikalni</div>
        </div>

        <div className="bg-[#1c1f33] border border-[#d3bb73]/20 rounded-xl p-6">
          <div className="text-3xl font-light text-[#d3bb73] mb-2">
            {stats.avgTimeOnPage}s
          </div>
          <div className="text-sm text-[#e5e4e2]/60">Śr. czas</div>
        </div>

        <div className="bg-[#1c1f33] border border-[#d3bb73]/20 rounded-xl p-6">
          <div className="text-3xl font-light text-[#d3bb73] mb-2">
            {stats.contactForms}
          </div>
          <div className="text-sm text-[#e5e4e2]/60">Formularze</div>
        </div>
      </div>
    </div>
  );
}
```

---

## 🎨 Przykładowe Użycie na Stronie Kasyna

```tsx
// /src/app/uslugi/kasyno/page.tsx

'use client';

import { useState } from 'react';
import { usePageAnalytics } from '@/hooks/usePageAnalytics';
import ContactFormWithTracking from '@/components/ContactFormWithTracking';
import MultiCitySEO from '@/components/MultiCitySEO';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';

export default function KasynoPage() {
  // Analytics tracking
  usePageAnalytics('Kasyno Eventowe - Mavinci');

  const [contactFormOpen, setContactFormOpen] = useState(false);
  const [selectedCity, setSelectedCity] = useState('');
  const [currentSection, setCurrentSection] = useState('hero');

  return (
    <>
      <Navbar />

      <main className="min-h-screen bg-[#0f1119]">
        {/* Hero Section */}
        <section
          className="py-24"
          onMouseEnter={() => setCurrentSection('hero')}
        >
          <div className="max-w-7xl mx-auto px-4 text-center">
            <h1 className="text-5xl font-light text-[#e5e4e2] mb-6">
              Kasyno Eventowe
            </h1>
            <p className="text-xl text-[#e5e4e2]/70 mb-8">
              Profesjonalne stoły do pokera, ruletki i blackjacka
            </p>
            <button
              onClick={() => setContactFormOpen(true)}
              className="bg-[#d3bb73] text-[#1c1f33] px-8 py-3 rounded-full hover:bg-[#d3bb73]/90 transition-colors"
            >
              Skontaktuj się z nami
            </button>
          </div>
        </section>

        {/* Multi-City SEO */}
        <MultiCitySEO
          pageSlug="kasyno"
          onCityChange={setSelectedCity}
        />

        {/* Tables Section */}
        <section
          className="py-16"
          onMouseEnter={() => setCurrentSection('tables')}
        >
          {/* Twoje stoły kasyna */}
        </section>

        {/* Pricing CTA */}
        <section
          className="py-16 text-center"
          onMouseEnter={() => setCurrentSection('pricing')}
        >
          <h2 className="text-3xl mb-6">Zapytaj o wycenę</h2>
          <button
            onClick={() => setContactFormOpen(true)}
            className="bg-[#d3bb73] text-[#1c1f33] px-8 py-3 rounded-full"
          >
            Bezpłatna wycena
          </button>
        </section>
      </main>

      <Footer />

      {/* Contact Form z tracking */}
      <ContactFormWithTracking
        isOpen={contactFormOpen}
        onClose={() => setContactFormOpen(false)}
        sourcePage="Kasyno Eventowe"
        sourceSection={currentSection}
        defaultCity={selectedCity}
        defaultEventType="Kasyno eventowe"
      />
    </>
  );
}
```

---

## ✅ Korzyści

### Analytics:
- ✅ Wiesz ile osób odwiedza stronę kasyna
- ✅ Wiesz skąd przychodzą (Google, Facebook, direct)
- ✅ Wiesz jak długo czytają
- ✅ Wiesz z jakiego urządzenia (mobile 60%? → lepszy mobile!)
- ✅ Wiesz który CTA działa najlepiej

### Contact Form:
- ✅ Wiesz skąd przyszło zapytanie (Hero? Footer? Pricing?)
- ✅ Wiesz które miasto interesuje (Warszawa? Kraków?)
- ✅ Wiesz skąd użytkownik (UTM campaigns)
- ✅ Możesz analizować conversion rate

### Multi-City SEO:
- ✅ Pozycjonujesz dla 6+ miast bez duplikacji
- ✅ Google widzi unikalne treści dla każdego miasta
- ✅ Lokalne słowa kluczowe (np. "Stare Miasto Kraków")
- ✅ Lepszy CTR w wynikach wyszukiwania
- ✅ Użytkownik widzi treści dopasowane do swojego miasta

---

## 🚀 Ready to Go!

**Wszystko gotowe:**
- ✅ Migracja bazy zastosowana
- ✅ Komponenty stworzone
- ✅ Sample data w bazie (6 miast)
- ✅ Przykłady SQL do analiz
- ✅ Dokumentacja gotowa

**Wystarczy zintegrować na stronie kasyna!** 📊🎰🌍
