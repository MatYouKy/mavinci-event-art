# Kalendarz Mobile - Implementacja w stylu iPhone

## 📱 Wygląd i Funkcjonalność

### Górna część ekranu
- **Kalendarz miesięczny** z react-native-calendars
- Kolorowe kropki pod datami oznaczające wydarzenia
- Zaznaczenie wybranego dnia kolorem złotym (brand color)
- Możliwość przewijania między miesiącami

### Dolna część ekranu
- **Lista wydarzeń** dla wybranego dnia
- Każde wydarzenie wyświetlane jako karta z:
  - Kolorowym wskaźnikiem statusu (lewa krawędź)
  - Nazwą wydarzenia
  - Badge ze statusem (W trakcie, Potwierdzone, etc.)
  - Godziną rozpoczęcia i zakończenia
  - Lokalizacją
  - Klientem/organizacją
  - Kategorią
- Pull-to-refresh dla odświeżenia wydarzeń
- Empty state gdy brak wydarzeń w danym dniu

## 🔧 Technologie

### Biblioteki
- `react-native-calendars` - Komponent kalendarza
- `@reduxjs/toolkit` - Redux + RTK Query
- `react-redux` - Redux provider

### RTK Query
- Używa tego samego API co wersja webowa (`calendarApi`)
- Automatyczne cachowanie wydarzeń
- Pull-to-refresh odświeża dane

## 🎨 Design

### Kolory
- Tło: Ciemne (#0f1119)
- Akcent: Złoty (#d3bb73) - brand color Mavinci
- Tekst: Jasny (#e5e4e2)
- Statusy: Kolorowe według stanu wydarzenia

### Statusy wydarzeń
- **W trakcie** - Pomarańczowy (warning)
- **Potwierdzone** - Niebieski (info)
- **Zakończone** - Zielony (success)
- **Anulowane** - Czerwony (error)
- **Spotkanie** - Złoty (brand color)

## 📦 Nowe pliki

### Redux Store
- `mobile/src/store/store.ts` - Konfiguracja Redux store
- `mobile/src/store/hooks.ts` - Typed hooks dla Redux

### Komponenty
- `mobile/src/screens/CalendarScreen.tsx` - Główny ekran kalendarza

### Modyfikacje
- `mobile/App.tsx` - Dodano Redux Provider
- `mobile/package.json` - Dodano zależności:
  - `react-native-calendars`
  - `@reduxjs/toolkit`
  - `react-redux`

## 🚀 Instalacja

```bash
cd mobile
npm install
```

## 📱 Użycie

Po instalacji zależności, kalendarz będzie automatycznie dostępny w aplikacji mobilnej.

### Wybór dnia
1. Dotknij datę w kalendarzu
2. Wydarzenia dla tego dnia pojawią się poniżej

### Odświeżenie
1. Pociągnij listę wydarzeń w dół (pull-to-refresh)
2. Wydarzenia zostaną ponownie pobrane z serwera

## ⚡ Performance

- **Cache RTK Query** - Wydarzenia cachowane przez 10 minut
- **useMemo** - Optymalizacja filtrowania wydarzeń
- **FlatList** - Wydajna renderizacja listy
- **Lazy loading** - Ładowanie tylko widocznych elementów

## 🔄 Synchronizacja z Web

Kalendarz mobilny korzysta z tego samego API co wersja webowa:
- `useGetCalendarEventsQuery()` - pobiera events + meetings
- Cache współdzielony między requestami
- Automatyczna synchronizacja przy zmianie danych
