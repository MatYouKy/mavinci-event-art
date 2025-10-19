# 📱 Mavinci Mobile - Instrukcja Setup

## Czym jest Mavinci Mobile?

Aplikacja mobilna React Native pozwalająca pracownikom na:
- 📊 Przeglądanie nadchodzących wydarzeń
- ✅ Zarządzanie zadaniami w terenie
- 👥 Dostęp do informacji o klientach
- 🔔 Otrzymywanie powiadomień push (w przygotowaniu)

**Używa tej samej bazy Supabase co aplikacja webowa!** 🔗

## 🚀 Szybki start (3 kroki)

### 1. Przejdź do folderu mobile

```bash
cd mobile
```

### 2. Zainstaluj zależności

```bash
npm install
```

**⚠️ Uwaga:** Aplikacja używa **Expo SDK 54**. Upewnij się że masz najnowszą wersję **Expo Go** na telefonie!

### 3. Skopiuj konfigurację Supabase

```bash
# Skopiuj przykładowy plik
cp .env.example .env

# Edytuj .env i wklej dane z głównego projektu
```

**WAŻNE:** Użyj **dokładnie tych samych** wartości co w głównym projekcie (plik `.env` w root)!

```env
# mobile/.env
EXPO_PUBLIC_SUPABASE_URL=https://twoj-projekt.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=twoj-anon-key
```

### 4. Uruchom aplikację

```bash
npm start
```

Pokaże się QR code - zeskanuj go w aplikacji **Expo Go** na telefonie!

## 📱 Instalacja Expo Go

Zainstaluj **Expo Go** na swoim telefonie:

- **Android**: https://play.google.com/store/apps/details?id=host.exp.exponent
- **iOS**: https://apps.apple.com/app/expo-go/id982107779

## 🎯 Testowanie

### 1. Zeskanuj QR code
Po uruchomieniu `npm start` zobaczysz QR code w terminalu.

### 2. Zaloguj się
Użyj **tych samych danych** co do CRM webowego!

### 3. Sprawdź Dashboard
Powinieneś zobaczyć swoje wydarzenia i zadania.

## 🏗️ Struktura mobile/

```
mobile/
├── src/
│   ├── contexts/          # AuthContext (Supabase)
│   ├── lib/              # Supabase client + typy
│   ├── navigation/       # React Navigation setup
│   ├── screens/          # Ekrany aplikacji
│   └── theme/            # Kolory, spacing, typografia
├── App.tsx               # Entry point
├── package.json
└── README.md             # Pełna dokumentacja
```

## 🎨 Design System

Aplikacja mobilna używa **identycznej kolorystyki** co web:

```typescript
// Główne kolory
primary.gold: '#d3bb73'       // Złoty
secondary.burgundy: '#800020'  // Bordowy
background.primary: '#0f1119'  // Tło

// Tekst
text.primary: '#e5e4e2'
text.secondary: '#b0b0b0'
```

Theme znajduje się w: `mobile/src/theme/`

## 🔐 Autentykacja

Mobile używa **Supabase Auth** z persystencją sesji:

```typescript
// Logowanie (jak w web)
await supabase.auth.signInWithPassword({ email, password });

// Sesja zapisywana w AsyncStorage
// Automatyczne przywracanie po ponownym uruchomieniu ✅
```

## 📊 Dane z bazy

Mobile korzysta z **tych samych tabel** co web:

✅ `employees` - dane pracownika
✅ `events` - wydarzenia
✅ `tasks` - zadania
✅ `clients` - klienci
✅ Row Level Security (RLS) działa tak samo!

## 🚧 Status funkcjonalności

### ✅ Gotowe:
- Logowanie (Supabase Auth)
- Dashboard z wydarzeniami i zadaniami
- Pull-to-refresh
- Ekran ustawień z wylogowaniem
- Bottom Tab Navigation

### 🏗️ W przygotowaniu:
- Kalendarz wydarzeń
- Pełna lista zadań z filtrowaniem
- Lista klientów
- Szczegóły wydarzeń/zadań
- Powiadomienia push
- Upload zdjęć

## 🛠️ Komendy

```bash
# Development
npm start              # Uruchom Expo dev server
npm run android        # Uruchom na emulatorze Android
npm run ios            # Uruchom na symulatorze iOS (macOS only)

# Production
eas build --platform android    # Build APK
eas build --platform ios        # Build IPA
```

## 🆘 Rozwiązywanie problemów

### "Cannot connect to Metro"
```bash
npm start -- --clear
```

### "Module not found"
```bash
rm -rf node_modules
npm install
npm start
```

### "Expo Go crashes"
1. Sprawdź czy `.env` ma poprawne dane Supabase
2. Upewnij się że używasz najnowszej wersji Expo Go
3. Restartuj Expo server (`npm start -- --clear`)

### "Cannot sign in"
1. Sprawdź czy `EXPO_PUBLIC_SUPABASE_URL` jest prawidłowy
2. Sprawdź czy `EXPO_PUBLIC_SUPABASE_ANON_KEY` jest prawidłowy
3. Sprawdź czy masz konto w CRM (zarejestrowane przez admina)

## 📚 Dokumentacja

- [📖 Pełny README](./mobile/README.md) - Szczegółowa dokumentacja
- [🚀 Quick Start](./mobile/QUICK_START.md) - Start w 5 minut
- [🏠 Główny README](./README.md) - Dokumentacja całego projektu

## 🎯 Następne kroki

Po uruchomieniu aplikacji mobilnej możesz:

1. **Rozwijać nowe ekrany**
   - Kalendarz: `mobile/src/screens/CalendarScreen.tsx`
   - Zadania: `mobile/src/screens/TasksScreen.tsx`
   - Klienci: `mobile/src/screens/ClientsScreen.tsx`

2. **Dodać powiadomienia push**
   - Expo Notifications
   - Supabase Realtime webhooks

3. **Zaimplementować offline mode**
   - AsyncStorage dla lokalnych danych
   - Queue dla akcji offline

4. **Dodać upload zdjęć**
   - Expo Image Picker
   - Supabase Storage

## 💡 Wskazówki

- **Współdzielone typy**: Typy TypeScript są w `src/lib/supabase.ts` (zarówno web jak i mobile)
- **Theme**: Kolory i style są w `src/theme/` - łatwo je modyfikować!
- **Hot Reload**: Zapisz plik - aplikacja odświeża się automatycznie ⚡
- **Debugowanie**: W Expo Go wstrząśnij telefonem → Dev Menu → Remote JS Debugging

## ✅ Checklist przed rozpoczęciem

- [ ] Zainstalowałem zależności (`npm install`)
- [ ] Skopiowałem `.env` z poprawnymi danymi Supabase
- [ ] Zainstalowałem Expo Go na telefonie
- [ ] Uruchomiłem `npm start`
- [ ] Zeskanowałem QR code
- [ ] Zalogowałem się używając danych z CRM

---

**Powodzenia z rozwojem aplikacji mobilnej! 🚀📱**

Pytania? Sprawdź [pełną dokumentację](./mobile/README.md)
