# 🚀 Mavinci Mobile - Quick Start

## Szybki start w 5 minut

### 1. Zainstaluj zależności

```bash
cd mobile
npm install
```

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

### Expo nie uruchamia się?

```bash
# Wyczyść cache
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
