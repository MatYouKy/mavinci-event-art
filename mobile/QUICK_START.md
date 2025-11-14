# 🚀 Mavinci Mobile - Quick Start

## ⚡ TL;DR - Jeśli coś nie działa:

```bash
cd mobile

# Usuń wszystko i zainstaluj od nowa:
rm -rf node_modules package-lock.json
npm cache clean --force
npm install

# Uruchom:
npm start
```

**Ignoruj warningi EBADENGINE!** To normalne.

---

## Wymagania

- **Node.js** >= 18.0.0 (sprawdź: `node -v`)
- **npm** >= 9.0.0 (sprawdź: `npm -v`)
- **Expo Go** na telefonie (SDK 54)

## Szybki start w 5 minut

### 1. Zainstaluj zależności

```bash
cd mobile
npm install
```

**⚠️ WAŻNE:**

- Aplikacja używa **Expo SDK 54** - zaktualizuj **Expo Go** na telefonie!
- **Używaj `npm`, NIE `yarn`!** (yarn tworzy `yarn.lock` który jest ignorowany przez Git)
- **Ignoruj warningi EBADENGINE** - to normalne ostrzeżenia, npm je ignoruje
- Jeśli widzisz błąd **EACCES** lub **"Cannot find module 'metro/..."** - patrz sekcja "Jeśli coś nie działa" poniżej

### 2. Skonfiguruj Supabase

Skopiuj dane z głównej aplikacji (plik `.env` w głównym projekcie):

```bash
# Utwórz plik .env
cp .env.example .env

# Edytuj .env i dodaj:
EXPO_PUBLIC_SUPABASE_URL=https://twoj-projekt.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=twoj-anon-key
```

### 3. Uruchom aplikację

```bash
npm start
```

### 4. Testuj na telefonie

1. Zainstaluj **Expo Go**:
   - [Android](https://play.google.com/store/apps/details?id=host.exp.exponent)
   - [iOS](https://apps.apple.com/app/expo-go/id982107779)

2. Zeskanuj kod QR z terminala

3. Zaloguj się używając danych z CRM! 🎉

## 🎯 Dane testowe

Jeśli masz już konto w CRM, użyj tych samych danych logowania:

```
Email: twoj@email.com
Hasło: twoje-hasło-crm
```

## 📱 Co zobaczysz?

### ✅ Działające ekrany:

1. **Logowanie** - Autentykacja przez Supabase
2. **Dashboard** - Nadchodzące wydarzenia i zadania
3. **Ustawienia** - Profil i wylogowanie

### 🚧 W przygotowaniu:

- Kalendarz
- Lista zadań
- Lista klientów

## 🆘 Problemy?

### ❌ "Cannot find module 'metro/...'" lub błędy npm?

**Poprzedni `npm install` się nie powiódł!**

```bash
cd mobile
rm -rf node_modules package-lock.json
npm cache clean --force
npm install
npm start
```

### ❌ EACCES permission denied?

```bash
# Napraw cache:
npm cache clean --force
rm -rf ~/.npm/_cacache
npm cache verify

# Przeinstaluj:
cd mobile
rm -rf node_modules package-lock.json
npm install
```

### ⚠️ Warningi EBADENGINE?

**IGNORUJ!** To normalne ostrzeżenia, npm je ignoruje. Instalacja powinna przejść.

### Expo nie uruchamia się?

```bash
# Wyczyść cache Expo:
npm start -- --clear
```

### Błędy z Supabase?

1. Sprawdź czy `.env` ma poprawne dane
2. Upewnij się że używasz **tych samych** danych co w głównej aplikacji
3. Sprawdź połączenie internetowe

### Aplikacja crashuje?

```bash
# Przeinstaluj node_modules
rm -rf node_modules
npm install
npm start -- --clear
```

## 🎨 Design

Aplikacja używa **identycznej kolorystyki** co web:

- 🟡 Złoty: `#d3bb73`
- 🟥 Bordowy: `#800020`
- ⬛ Tło: `#0f1119`

## 🔐 Bezpieczeństwo

- ✅ Supabase Auth
- ✅ Row Level Security (RLS)
- ✅ Szyfrowanie sesji
- ✅ Te same polityki bezpieczeństwa co web

## 📚 Dalsze kroki

Przeczytaj pełny [README.md](./README.md) aby dowiedzieć się więcej o:

- Architekturze projektu
- Buildach produkcyjnych
- Deploymencie
- Rozwijaniu funkcjonalności

---

**Powodzenia! 🚀**
