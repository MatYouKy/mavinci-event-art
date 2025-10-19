# Mavinci CRM - Aplikacja Mobilna

Aplikacja mobilna React Native dla systemu CRM Mavinci, działająca na Android i iOS.

## 🚀 Technologie

- **React Native** + **Expo** (~50.0.0)
- **TypeScript**
- **React Navigation** (Stack + Bottom Tabs)
- **Supabase** (współdzielona baza z aplikacją webową)
- **Lucide React Native** (ikony)

## 📱 Funkcjonalności

### ✅ Zaimplementowane:
- 🔐 Logowanie (email/hasło przez Supabase Auth)
- 📊 Dashboard z nadchodzącymi wydarzeniami i zadaniami
- 🎨 Współdzielony system kolorów z aplikacją webową
- 📱 Bottom Tab Navigation (5 ekranów)
- 👤 Ekran ustawień z informacjami o użytkowniku
- 🔄 Pull-to-refresh na Dashboard

### 🚧 Do zaimplementowania (placeholder):
- 📅 Kalendarz wydarzeń
- ✅ Lista zadań
- 👥 Lista klientów
- 📝 Szczegóły wydarzeń/zadań/klientów
- 🔔 Powiadomienia push
- 📷 Upload zdjęć
- 📄 Podgląd plików

## 🎨 Design System

Aplikacja używa **tej samej kolorystyki** co aplikacja webowa:

```typescript
// Kolory główne
primary.gold: '#d3bb73'      // Złoty akcent
secondary.burgundy: '#800020' // Bordowy

// Tła
background.primary: '#0f1119'    // Główne tło
background.secondary: '#1c1f33'  // Karty
background.tertiary: '#252842'   // Komponenty

// Tekst
text.primary: '#e5e4e2'     // Główny
text.secondary: '#b0b0b0'   // Wtórny
text.tertiary: '#808080'    // Pomocniczy
```

## 🛠️ Instalacja

### 1. Zainstaluj zależności

```bash
cd mobile
npm install
```

### 2. Skonfiguruj zmienne środowiskowe

Skopiuj `.env.example` do `.env`:

```bash
cp .env.example .env
```

Edytuj `.env` i dodaj swoje dane Supabase:

```env
EXPO_PUBLIC_SUPABASE_URL=https://twoj-projekt.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=twoj-anon-key
```

**Ważne:** Użyj **tych samych** danych co w głównej aplikacji!

### 3. Uruchom aplikację

```bash
# Tryb development
npm start

# Bezpośrednio na Android
npm run android

# Bezpośrednio na iOS (tylko macOS)
npm run ios
```

## 📱 Testowanie

### Expo Go (najłatwiejsze)

1. Zainstaluj **Expo Go** na telefonie:
   - [Android](https://play.google.com/store/apps/details?id=host.exp.exponent)
   - [iOS](https://apps.apple.com/app/expo-go/id982107779)

2. Uruchom `npm start`

3. Zeskanuj QR code w terminalu

### Emulator Android

1. Zainstaluj Android Studio
2. Utwórz Android Virtual Device (AVD)
3. Uruchom: `npm run android`

### Symulator iOS (tylko macOS)

1. Zainstaluj Xcode
2. Uruchom: `npm run ios`

## 🗂️ Struktura projektu

```
mobile/
├── src/
│   ├── contexts/
│   │   └── AuthContext.tsx          # Autentykacja (Supabase)
│   ├── lib/
│   │   └── supabase.ts              # Klient Supabase + typy
│   ├── navigation/
│   │   ├── RootNavigator.tsx        # Główna nawigacja
│   │   └── MainTabNavigator.tsx     # Bottom tabs
│   ├── screens/
│   │   ├── LoginScreen.tsx          # ✅ Logowanie
│   │   ├── DashboardScreen.tsx      # ✅ Dashboard
│   │   ├── CalendarScreen.tsx       # 🚧 Kalendarz
│   │   ├── TasksScreen.tsx          # 🚧 Zadania
│   │   ├── ClientsScreen.tsx        # 🚧 Klienci
│   │   └── SettingsScreen.tsx       # ✅ Ustawienia
│   └── theme/
│       ├── colors.ts                # Kolory (shared z web)
│       ├── spacing.ts               # Spacing (8px grid)
│       ├── typography.ts            # Typografia
│       └── index.ts                 # Theme export
├── App.tsx                          # Entry point
├── app.json                         # Expo config
├── package.json
└── tsconfig.json
```

## 🔐 Autentykacja

Aplikacja używa **Supabase Auth** z persistencją sesji:

```typescript
// Logowanie
await supabase.auth.signInWithPassword({ email, password });

// Wylogowanie
await supabase.auth.signOut();

// Stan autentykacji
const { session, employee } = useAuth();
```

Sesja jest automatycznie zapisywana w `AsyncStorage` i przywracana po ponownym uruchomieniu.

## 📊 Dane z Supabase

Aplikacja korzysta z **tej samej bazy danych** co aplikacja webowa:

### Tabele używane:
- `employees` - pracownicy (logowanie, dane użytkownika)
- `events` - wydarzenia
- `tasks` - zadania
- `clients` - klienci
- `notifications` - powiadomienia

### Row Level Security (RLS):
Wszystkie polityki RLS z aplikacji webowej działają również w mobile! 🔒

## 🚀 Build produkcyjny

### Android (APK)

```bash
# Build development
eas build --platform android --profile development

# Build production
eas build --platform android --profile production
```

### iOS (IPA)

```bash
# Build development
eas build --platform ios --profile development

# Build production
eas build --platform ios --profile production
```

**Uwaga:** Do buildów produkcyjnych potrzebujesz konta [Expo Application Services (EAS)](https://expo.dev/eas).

## 🎯 Następne kroki

1. **Zaimplementuj pełne ekrany**:
   - Kalendarz z widokiem miesięcznym
   - Lista zadań z filtrowaniem
   - Lista klientów z wyszukiwaniem
   - Szczegóły wydarzeń

2. **Dodaj powiadomienia push**:
   - Expo Notifications
   - Integracja z Supabase Realtime

3. **Dodaj offline mode**:
   - AsyncStorage persistence
   - Queue dla akcji offline

4. **Popraw UX**:
   - Animacje (Reanimated)
   - Gesture handling
   - Loading states
   - Error handling

## 📝 Licencja

© 2025 Mavinci. Wszystkie prawa zastrzeżone.
