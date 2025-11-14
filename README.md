# Mavinci CRM - Kompletny System Zarządzania Wydarzeniami

System zarządzania klientami, wydarzeniami i zasobami z aplikacją webową (Next.js) i mobilną (React Native).

## 🏗️ Struktura projektu

```
project/
├── src/                    # 🌐 Aplikacja webowa (Next.js 14)
│   ├── app/               # Next.js App Router
│   ├── components/        # Komponenty React
│   ├── lib/              # Biblioteki (Supabase, permissions)
│   └── contexts/         # React Contexts (Auth, EditMode)
│
├── mobile/                # 📱 Aplikacja mobilna (React Native + Expo)
│   ├── src/
│   │   ├── screens/      # Ekrany mobilne
│   │   ├── navigation/   # React Navigation
│   │   ├── theme/        # Współdzielona kolorystyka
│   │   └── lib/          # Supabase client
│   └── README.md         # Dokumentacja mobile
│
├── imap-sync-worker/      # 📧 Worker do synchronizacji emaili
│   └── sync.js
│
├── supabase/              # 🗄️ Baza danych (Supabase)
│   └── migrations/       # Migracje SQL
│
└── public/               # Statyczne pliki
```

## 🚀 Szybki start

### Aplikacja webowa

```bash
# Zainstaluj zależności
npm install

# Skonfiguruj .env (Supabase credentials)
cp .env.example .env

# Uruchom dev server
npm run dev

# Build produkcyjny
npm run build
```

Aplikacja będzie dostępna na `http://localhost:3000`

### Aplikacja mobilna

```bash
cd mobile

# Zainstaluj zależności
npm install

# Skonfiguruj .env (te same dane Supabase!)
cp .env.example .env

# Uruchom Expo
npm start
```

Zeskanuj QR code w aplikacji Expo Go (Android/iOS)

📖 [Pełna dokumentacja mobile →](./mobile/README.md)

## 🎨 Design System

Obie aplikacje (web + mobile) używają **tej samej kolorystyki**:

### Kolory główne

- 🟡 **Złoty** (`#d3bb73`) - Akcent, przyciski, linki
- 🟥 **Bordowy** (`#800020`) - Akcent wtórny
- ⬛ **Ciemne tło** (`#0f1119`) - Główne tło
- ◼️ **Ciemniejsze** (`#1c1f33`) - Karty, panele

### Typografia

- Font sizes: 12-40px (8px scale)
- Font weights: 300-700
- Line heights: 1.2-1.75

## 🗄️ Baza danych (Supabase)

### Główne tabele:

- `employees` - Pracownicy + autentykacja
- `clients` - Klienci (firmy/osoby)
- `events` - Wydarzenia
- `tasks` - Zadania
- `equipment_items` - Sprzęt
- `vehicles` - Flota
- `offers` - Oferty
- `contracts` - Umowy
- `notifications` - Powiadomienia

### Row Level Security (RLS)

Wszystkie tabele chronione przez RLS! 🔒

## 🔐 Autentykacja

### Web

- Email/hasło przez Supabase Auth
- Protected routes przez middleware
- Session management w AuthContext

### Mobile

- Email/hasło przez Supabase Auth
- Sesja w AsyncStorage (persystencja)
- Automatyczne odświeżanie tokenów

**Używaj tych samych danych logowania w obu aplikacjach!**

## 📱 Aplikacja mobilna - Funkcjonalności

### ✅ Zaimplementowane:

- 🔐 Logowanie
- 📊 Dashboard (wydarzenia + zadania)
- 👤 Ustawienia + profil
- 🔄 Pull-to-refresh
- 🎨 Współdzielony design system

### 🚧 Do zrobienia:

- 📅 Kalendarz wydarzeń
- ✅ Lista zadań z filtrowaniem
- 👥 Lista klientów
- 📝 Szczegóły wydarzeń/zadań
- 🔔 Powiadomienia push
- 📷 Upload zdjęć
- 📄 Podgląd dokumentów

## 🛠️ Stack technologiczny

### Frontend Web

- **Framework**: Next.js 14 (App Router)
- **UI**: React 18, TailwindCSS
- **State**: Redux Toolkit, React Context
- **Forms**: Formik + Yup
- **Icons**: Lucide React

### Frontend Mobile

- **Framework**: React Native + Expo (~50.0)
- **Navigation**: React Navigation 6
- **UI**: React Native Components
- **Icons**: Lucide React Native

### Backend & Database

- **BaaS**: Supabase (PostgreSQL)
- **Auth**: Supabase Auth
- **Storage**: Supabase Storage
- **Realtime**: Supabase Realtime

### Workers

- **Email Sync**: Node.js IMAP worker

## 📦 Deployment

### Web (Next.js)

```bash
# Build
npm run build

# Deploy (Vercel recommended)
vercel deploy
```

### Mobile (Expo)

```bash
cd mobile

# Android APK
eas build --platform android

# iOS IPA (requires Apple Developer account)
eas build --platform ios
```

## 🔧 Konfiguracja

### Environment Variables

**Web** (`.env`):

```env
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=xxx
```

**Mobile** (`mobile/.env`):

```env
EXPO_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=xxx
```

**Używaj tych samych wartości dla web i mobile!** ⚠️

### ⚠️ Git & Mobile

**WAŻNE:** Folder `mobile/.expo/` jest **automatycznie ignorowany** przez Git!

Expo podczas uruchamiania generuje pliki cache w `mobile/.expo/`. Są one już dodane do `.gitignore` i **nie powinny** być commitowane.

Jeśli `git status` pokazuje zmiany w:

- `mobile/.expo/**` → Ignoruj
- `mobile/yarn.lock` → Ignoruj (używamy npm)
- `mobile/.metro-health-check*` → Ignoruj

## 📚 Dokumentacja

- [📱 Mobile App](./mobile/README.md) - Pełna dokumentacja aplikacji mobilnej
- [🚀 Mobile Quick Start](./mobile/QUICK_START.md) - Szybki start w 5 minut
- [📧 IMAP Sync](./imap-sync-worker/README.md) - Worker do synchronizacji emaili
- [🗄️ Database Schema](./supabase/migrations/) - Struktura bazy danych

## 🤝 Współdzielone zasoby

### Theme / Kolorystyka

- Web: `/src/index.css` (TailwindCSS)
- Mobile: `/mobile/src/theme/colors.ts`

### Typy (TypeScript)

- Web: `/src/lib/supabase.ts`
- Mobile: `/mobile/src/lib/supabase.ts`

### Logika biznesowa

- Permissions: `/src/lib/permissions.ts`
- Event access: `/src/lib/eventPermissions.ts`

## 🎯 Roadmap

### Q1 2025

- ✅ Podstawowa aplikacja mobilna
- ✅ Synchronizacja emaili IMAP
- ✅ System uprawnień
- 🚧 Powiadomienia push mobile
- 🚧 Offline mode w mobile

### Q2 2025

- 📅 Pełny kalendarz w mobile
- 📊 Raporty i statystyki
- 🔔 Zaawansowane powiadomienia
- 📱 Tablet support

## 📄 Licencja

© 2025 Mavinci. Wszystkie prawa zastrzeżone.

---

**Pytania?** Sprawdź dokumentację w poszczególnych folderach lub skontaktuj się z zespołem dev.
