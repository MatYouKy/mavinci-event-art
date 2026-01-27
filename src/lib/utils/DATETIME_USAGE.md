# DateTime Utils - Przewodnik użycia

## Problem

Formularz datetime-local w HTML zwraca wartość w formacie lokalnym (np. `"2024-01-27T18:00"`), ale:
- PostgreSQL timestamptz przechowuje daty w UTC
- Konwersja między strefami czasowymi może powodować przesunięcia godzin

Dla Polski (UTC+1 zimą, UTC+2 latem):
- Użytkownik ustawia 18:00 w formularzu
- Bez poprawnej konwersji może być zapisane jako 16:00 UTC
- Przy odczycie wyświetla się 18:00 UTC zamiast 18:00 lokalnego = pokazuje 20:00!

## Rozwiązanie

Używaj funkcji z `@/lib/utils/dateTimeUtils` do wszystkich operacji datetime-local.

## Funkcje

### 1. `utcToLocalDatetimeString(utcDate: string): string`

**Kiedy:** Wyświetlanie daty z bazy danych w datetime-local input

**Przykład:**
```tsx
import { utcToLocalDatetimeString } from '@/lib/utils/dateTimeUtils';

// Dane z bazy danych
const event = { event_date: "2024-01-27T17:00:00Z" }; // UTC

// W datetime-local input
<input
  type="datetime-local"
  value={utcToLocalDatetimeString(event.event_date)}
  // Wyświetli: "2024-01-27T18:00" (CET/UTC+1)
/>
```

### 2. `localDatetimeStringToUTC(localDatetime: string): string | null`

**Kiedy:** Zapisywanie wartości z datetime-local input do bazy danych

**Przykład:**
```tsx
import { localDatetimeStringToUTC } from '@/lib/utils/dateTimeUtils';

const handleSubmit = () => {
  // formData.event_date = "2024-01-27T18:00" (z datetime-local input)

  const dataToSave = {
    event_date: localDatetimeStringToUTC(formData.event_date),
    // Zapisze: "2024-01-27T17:00:00.000Z" (UTC)
  };

  await supabase.from('events').insert(dataToSave);
};
```

### 3. `getCurrentLocalDatetimeString(): string`

**Kiedy:** Ustawianie domyślnej wartości na "teraz" w datetime-local

**Przykład:**
```tsx
import { getCurrentLocalDatetimeString } from '@/lib/utils/dateTimeUtils';

const [formData, setFormData] = useState({
  event_date: getCurrentLocalDatetimeString(), // Bieżąca data/czas w lokalnej strefie
});
```

### 4. `formatDateTimeForDisplay(utcDate: string, includeTime?: boolean): string`

**Kiedy:** Wyświetlanie daty w polskim formacie (nie w input)

**Przykład:**
```tsx
import { formatDateTimeForDisplay } from '@/lib/utils/dateTimeUtils';

const event = { event_date: "2024-01-27T17:00:00Z" };

<p>{formatDateTimeForDisplay(event.event_date)}</p>
// Wyświetli: "27.01.2024, 18:00"

<p>{formatDateTimeForDisplay(event.event_date, false)}</p>
// Wyświetli: "27.01.2024"
```

### 5. `formatDateForDisplay(utcDate: string): string`

**Kiedy:** Wyświetlanie tylko daty bez godziny

**Przykład:**
```tsx
import { formatDateForDisplay } from '@/lib/utils/dateTimeUtils';

const event = { event_date: "2024-01-27T17:00:00Z" };

<p>{formatDateForDisplay(event.event_date)}</p>
// Wyświetli: "27.01.2024"
```

## Kompletny przykład: Formularz edycji wydarzenia

```tsx
import { useState } from 'react';
import { supabase } from '@/lib/supabase/browser';
import {
  utcToLocalDatetimeString,
  localDatetimeStringToUTC
} from '@/lib/utils/dateTimeUtils';

interface Event {
  id: string;
  name: string;
  event_date: string; // UTC ISO string z bazy
  event_end_date: string | null;
}

export function EditEventForm({ event }: { event: Event }) {
  const [formData, setFormData] = useState({
    name: event.name,
    event_date: utcToLocalDatetimeString(event.event_date), // UTC -> lokalny
    event_end_date: utcToLocalDatetimeString(event.event_end_date),
  });

  const handleSubmit = async () => {
    const dataToSave = {
      name: formData.name,
      event_date: localDatetimeStringToUTC(formData.event_date), // lokalny -> UTC
      event_end_date: localDatetimeStringToUTC(formData.event_end_date),
    };

    await supabase
      .from('events')
      .update(dataToSave)
      .eq('id', event.id);
  };

  return (
    <form onSubmit={handleSubmit}>
      <input
        type="text"
        value={formData.name}
        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
      />

      <input
        type="datetime-local"
        value={formData.event_date}
        onChange={(e) => setFormData({ ...formData, event_date: e.target.value })}
      />

      <input
        type="datetime-local"
        value={formData.event_end_date}
        onChange={(e) => setFormData({ ...formData, event_end_date: e.target.value })}
      />

      <button type="submit">Zapisz</button>
    </form>
  );
}
```

## Ważne zasady

1. **ZAWSZE** używaj `utcToLocalDatetimeString()` przy wczytywaniu daty do datetime-local
2. **ZAWSZE** używaj `localDatetimeStringToUTC()` przy zapisywaniu daty do bazy
3. **NIE UŻYWAJ** bezpośrednio `new Date().toISOString()` ani `date.toISOString().slice(0,16)`
4. Te funkcje już uwzględniają polską strefę czasową (CET/CEST)
5. Funkcje zwracają null/'' dla pustych wartości - obsługuj to w formularzach

## Migracja istniejącego kodu

### Przed:
```tsx
// ❌ ŹLE - niepoprawna konwersja
const toLocalDatetimeString = (utcDate: string) => {
  const date = new Date(utcDate);
  return date.toISOString().slice(0, 16); // Zwraca UTC, nie lokalny!
};

// ❌ ŹLE - niepoprawna konwersja
const dataToSave = {
  event_date: new Date(formData.event_date).toISOString(),
};
```

### Po:
```tsx
// ✅ DOBRZE
import { utcToLocalDatetimeString, localDatetimeStringToUTC } from '@/lib/utils/dateTimeUtils';

const dataToSave = {
  event_date: localDatetimeStringToUTC(formData.event_date),
};

<input
  type="datetime-local"
  value={utcToLocalDatetimeString(event.event_date)}
/>
```

## Testowanie

Aby przetestować poprawność konwersji:

1. Ustaw czas 18:00 w formularzu
2. Zapisz do bazy
3. Odśwież stronę
4. Sprawdź czy nadal pokazuje 18:00 (nie 20:00 ani 16:00)

## Import

Możesz importować z dwóch miejsc:

```tsx
// Bezpośrednio
import { utcToLocalDatetimeString } from '@/lib/utils/dateTimeUtils';

// Lub przez główny utils (wygodniejsze)
import { utcToLocalDatetimeString } from '@/lib/utils';
```
