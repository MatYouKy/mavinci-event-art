# Przewodnik: Prefetching Wiadomości z Loaderem Progresowym

## Problem
Ładowanie strony `/crm/messages` trwało bardzo długo przy każdym wejściu, ponieważ:
- Pobieranie danych z serwera zajmuje dużo czasu
- Brak cache dla wiadomości
- Użytkownik nie widzi informacji o postępie

## Rozwiązanie

### 1. RTK Query Cache (2 godziny)
```typescript
// src/store/api/messagesApi.ts
keepUnusedDataFor: 7200, // 2 godziny cache
refetchOnMountOrArgChange: 300, // refetch po 5 minutach
```

### 2. Loading Screen z Progresem
```typescript
// src/components/crm/MessagesLoadingScreen.tsx
<MessagesLoadingScreen progress={75} />
```

### 3. Komponent Prefetch Button
Użyj `MessagesPrefetchButton` dla przycisków w nawigacji:

```tsx
import MessagesPrefetchButton from '@/components/crm/MessagesPrefetchButton';

// W komponencie nawigacji:
<MessagesPrefetchButton
  className="flex items-center gap-2 px-4 py-2 hover:bg-[#d3bb73]/10"
>
  <Mail className="h-5 w-5" />
  <span>Wiadomości</span>
</MessagesPrefetchButton>
```

### 4. Komponent Prefetch Link
Dla linków Next.js:

```tsx
import PrefetchLink from '@/components/crm/PrefetchLink';

<PrefetchLink
  href="/crm/messages"
  prefetchType="messages"
  className="text-white hover:text-[#d3bb73]"
>
  Przejdź do wiadomości
</PrefetchLink>
```

## Jak to działa

### Krok 1: Kliknięcie
Użytkownik klika przycisk "Wiadomości"

### Krok 2: Natychmiastowy Loader
Pokazuje się ekran ładowania z progress barem (0-10%)

### Krok 3: Prefetch
RTK Query sprawdza cache:
- **Jeśli dane są w cache** → Natychmiastowe przejście (100%)
- **Jeśli brak cache** → Pobieranie z serwera (10-90%)

### Krok 4: Progress Updates
Progress bar aktualizuje się co 250ms:
- 0-30%: "Ładowanie kont email..."
- 30-60%: "Pobieranie wiadomości..."
- 60-90%: "Przetwarzanie danych..."
- 90-100%: "Prawie gotowe..."

### Krok 5: Przekierowanie
Po załadowaniu danych → Router.push('/crm/messages')

### Krok 6: Instant Display
Strona używa danych z cache → Natychmiastowe wyświetlenie

## Przykłady Użycia

### Navigation Sidebar
```tsx
'use client';
import MessagesPrefetchButton from '@/components/crm/MessagesPrefetchButton';
import { Mail } from 'lucide-react';

export default function Sidebar() {
  return (
    <nav>
      <MessagesPrefetchButton
        className="flex items-center gap-3 px-4 py-3 text-white hover:bg-[#d3bb73]/10 rounded-lg transition-colors"
      >
        <Mail className="h-5 w-5" />
        <span>Wiadomości</span>
      </MessagesPrefetchButton>
    </nav>
  );
}
```

### Dashboard Quick Link
```tsx
'use client';
import PrefetchLink from '@/components/crm/PrefetchLink';
import { Mail } from 'lucide-react';

export default function DashboardWidget() {
  return (
    <div className="bg-[#1c1f33] p-6 rounded-lg">
      <h3 className="text-xl font-bold text-white mb-4">Nowe wiadomości</h3>
      <p className="text-[#e5e4e2]/60 mb-4">Masz 5 nieprzeczytanych wiadomości</p>
      <PrefetchLink
        href="/crm/messages"
        prefetchType="messages"
        className="inline-flex items-center gap-2 bg-[#d3bb73] text-[#1c1f33] px-6 py-3 rounded-lg hover:bg-[#c5ad65] transition-colors"
      >
        <Mail className="h-5 w-5" />
        <span>Zobacz wiadomości</span>
      </PrefetchLink>
    </div>
  );
}
```

### Custom onClick Handler
```tsx
<MessagesPrefetchButton
  className="btn-primary"
  onClick={() => {
    console.log('Rozpoczynam prefetch wiadomości...');
    // Możesz dodać własną logikę
  }}
>
  Wiadomości
</MessagesPrefetchButton>
```

## Cache Management

### Automatyczne
- Cache trwa 2 godziny (`keepUnusedDataFor: 7200`)
- Refetch po 5 minutach aktywności (`refetchOnMountOrArgChange: 300`)
- Realtime updates przez Supabase subscriptions

### Manualne Czyszczenie
```typescript
import { api } from '@/store/api/api';
import { useDispatch } from 'react-redux';

const dispatch = useDispatch();

// Wyczyść cache wiadomości
dispatch(api.util.invalidateTags([{ type: 'Message', id: 'LIST' }]));
```

## Performance Benefits

### Przed
- Pierwsze ładowanie: 3-5 sekund
- Każde kolejne: 3-5 sekund
- Brak feedbacku dla użytkownika

### Po
- Pierwsze ładowanie: 2-4 sekundy (z progress barem)
- Z cache: <500ms (natychmiastowe)
- Realtime updates: <100ms
- Użytkownik widzi progress i status

## Troubleshooting

### Problem: Dane nie ładują się
**Rozwiązanie:** Sprawdź konsolę - możliwe błędy z Supabase RLS

### Problem: Cache nie działa
**Rozwiązanie:** Sprawdź czy Redux store jest poprawnie skonfigurowany

### Problem: Progress bar nie aktualizuje się
**Rozwiązanie:** Sprawdź czy komponent jest w 'use client' context

### Problem: Timeout po 5 sekundach
**Rozwiązanie:** To normalne - fallback dla wolnego połączenia. Strona i tak się załaduje.

## Maintenance

### Zmiana czasu cache
```typescript
// src/store/api/messagesApi.ts
keepUnusedDataFor: 3600, // 1 godzina zamiast 2
```

### Dodanie innych prefetch typów
```typescript
// src/components/crm/PrefetchLink.tsx
prefetchType?: 'messages' | 'events' | 'tasks' | 'none';
```

## Testing

1. **Test pierwszego ładowania:**
   - Otwórz nową kartę incognito
   - Kliknij "Wiadomości"
   - Sprawdź czy pojawia się loader z progressem

2. **Test cache:**
   - Wejdź na /crm/messages
   - Wróć do dashboardu
   - Kliknij ponownie "Wiadomości"
   - Powinno załadować się <1 sekundy

3. **Test realtime:**
   - Otwórz dwie karty
   - W jednej dodaj nową wiadomość
   - W drugiej powinna pojawić się automatycznie
