# 🔧 Troubleshooting - Mavinci Mobile

## Najczęstsze problemy i rozwiązania

### ❌ Błąd: "Project is incompatible with this version of Expo Go"

**Problem:**

```
ERROR Project is incompatible with this version of Expo Go
• The installed version of Expo Go is for SDK 54.0.0.
• The project you opened uses SDK 50.
```

**Rozwiązanie:**

Aplikacja wymaga **Expo SDK 54**. Upewnij się że:

1. **Masz najnowszą wersję Expo Go na telefonie**
   - Zaktualizuj Expo Go w sklepie
   - [Android](https://play.google.com/store/apps/details?id=host.exp.exponent)
   - [iOS](https://apps.apple.com/app/expo-go/id982107779)

2. **Projekt jest zaktualizowany do SDK 54**

   ```bash
   cd mobile
   cat package.json | grep "expo"
   # Powinno pokazać: "expo": "~54.0.0"
   ```

3. **Przeinstaluj zależności**
   ```bash
   rm -rf node_modules
   npm install
   npm start -- --clear
   ```

---

### ❌ Błąd: "The engine node is incompatible with this module"

**Problem:**

```
error metro-core@0.83.1: The engine "node" is incompatible with this module.
Expected version ">=20.19.4". Got "20.18.1"
```

**Rozwiązanie:**

**1. Najprostsze rozwiązanie - używaj npm zamiast yarn:**

```bash
cd mobile

# ✅ Używaj npm (ignoruje engine warnings)
npm install
npm start

# ❌ NIE używaj yarn
yarn install  # Wyrzuci błąd engine!
```

**2. Dlaczego to działa?**

- Plik `.npmrc` zawiera `engine-strict=false`
- `package.json` ma `overrides` dla Metro 0.80.x (działa z Node 18+)
- Expo SDK 54 oficjalnie wspiera Node 18+

**3. Jeśli MUSISZ używać yarn:**

```bash
# Zignoruj engine warnings
yarn install --ignore-engines

# Lub dodaj do .yarnrc (nie zalecane!)
echo '--ignore-engines true' > .yarnrc
```

**4. Zaktualizuj Node (opcjonalnie):**

```bash
# Sprawdź wersję
node -v

# Jeśli chcesz zaktualizować do 20.19.4+:
nvm install 20.19.4
nvm use 20.19.4

# Lub użyj Node 22 LTS:
nvm install 22
nvm use 22
```

**Zalecenie:** **Używaj npm**, nie yarn! Projekt jest skonfigurowany dla npm.

---

### ❌ Błąd: "EACCES: permission denied" w npm cache

**Problem:**

```
npm error EACCES: permission denied, rename '/Users/.../.npm/_cacache/tmp/...'
npm error File exists: /Users/.../.npm/_cacache/content-v2/sha512/...
```

**Przyczyna:**

- Uszkodzony npm cache
- Konflikt uprawnień w cache
- Poprzednia instalacja przerwana

**Rozwiązanie:**

**1. Wyczyść wszystko i zainstaluj od nowa (NAJPEWNIEJSZE):**

```bash
# Usuń node_modules i cache:
rm -rf node_modules
rm -rf package-lock.json
npm cache clean --force

# Zainstaluj ponownie:
npm install
```

**2. Wyczyść tylko npm cache (szybsze):**

```bash
npm cache clean --force
rm -rf node_modules
npm install
```

**3. Jeśli nadal błąd - usuń cache ręcznie:**

```bash
# macOS/Linux:
rm -rf ~/.npm/_cacache
npm cache verify

# Potem:
rm -rf node_modules
rm -rf package-lock.json
npm install

# Windows:
# Usuń folder: C:\Users\USERNAME\AppData\Local\npm-cache
npm cache verify
rm -rf node_modules
rm -rf package-lock.json
npm install
```

**4. Sprawdź uprawnienia npm:**

```bash
# macOS/Linux:
ls -la ~/.npm

# Jeśli owner jest root:
sudo chown -R $(whoami) ~/.npm
sudo chown -R $(whoami) ~/.config

# Potem:
rm -rf node_modules
npm install
```

**5. Użyj innego cache location (tymczasowo):**

```bash
rm -rf node_modules
npm install --cache /tmp/npm-cache
```

**6. Ostateczność - reinstall npm:**

```bash
# Z nvm (zalecane):
nvm reinstall-packages current

# Lub zaktualizuj npm:
npm install -g npm@latest
```

---

### ❌ Błąd: "Cannot find module 'metro/private/lib/TerminalReporter'"

**Problem:**

```
Error: Cannot find module 'metro/private/lib/TerminalReporter'
Require stack:
- /Users/.../mobile/node_modules/@expo/metro/metro/lib/TerminalReporter.js
```

**Przyczyna:**

- Poprzedni `npm install` zakończył się błędem EACCES
- node_modules są **niepełne** - część pakietów nie zainstalowała się
- Metro nie ma wszystkich zależności

**Rozwiązanie - MUSISZ przeinstalować node_modules:**

```bash
cd mobile

# Usuń wszystko i zainstaluj od nowa:
rm -rf node_modules
rm -rf package-lock.json
npm cache clean --force
npm install

# Po udanej instalacji:
npm start
```

**WAŻNE:**

- `npm install` **MUSI** zakończyć się sukcesem (bez błędów EACCES)
- Jeśli nadal widzisz EACCES - najpierw napraw cache (patrz sekcja wyżej)
- NIE uruchamiaj `npm start` dopóki `npm install` nie przejdzie bez błędów!

---

### ⚠️ Warningi "EBADENGINE" - IGNORUJ!

**Widzisz:**

```
npm warn EBADENGINE Unsupported engine {
npm warn EBADENGINE   package: 'metro-babel-transformer@0.83.1',
npm warn EBADENGINE   required: { node: '>=20.19.4' },
npm warn EBADENGINE   current: { node: 'v20.18.1', npm: '10.8.2' }
}
```

**To jest OK!** ✅

- To są tylko **ostrzeżenia** (warnings), nie błędy
- npm je **ignoruje** dzięki `.npmrc` (`engine-strict=false`)
- Aplikacja **działa poprawnie** z Node 18+, 20.x, 22.x
- Metro 0.80.x (z overrides) wspiera Node 18+

**Ignoruj te warningi!** Instalacja powinna zakończyć się sukcesem.

---

### ❌ Błąd: "Unable to resolve asset"

**Problem:**

```
Unable to resolve asset "./assets/icon.png" from "icon" in your app.json
```

**Rozwiązanie:**

To jest normalne - aplikacja nie wymaga asset'ów do działania w Expo Go!

Jeśli chcesz dodać własne ikony:

```bash
# Stwórz folder assets
mkdir -p mobile/assets

# Dodaj pliki (opcjonalne):
# - icon.png (1024x1024)
# - splash.png (1242x2436)
# - adaptive-icon.png (1024x1024, Android)
```

Następnie odkomentuj w `app.json`:

```json
{
  "expo": {
    "icon": "./assets/icon.png",
    "splash": {
      "image": "./assets/splash.png"
    }
  }
}
```

---

### ❌ Błąd: "Cannot connect to Metro"

**Problem:**
Aplikacja nie łączy się z Metro bundler.

**Rozwiązanie:**

```bash
# Wyczyść cache i restartuj
npm start -- --clear

# Lub usuń kompletnie
rm -rf node_modules
rm -rf .expo
npm install
npm start
```

---

### ❌ Błąd: "Module not found: react-native-svg"

**Problem:**
Brakujące zależności po aktualizacji.

**Rozwiązanie:**

```bash
# Przeinstaluj wszystko
cd mobile
rm -rf node_modules package-lock.json
npm install
```

---

### ❌ Błąd logowania: "Invalid login credentials"

**Problem:**
Nie można się zalogować mimo poprawnych danych.

**Rozwiązanie:**

1. **Sprawdź `.env`**

   ```bash
   cat mobile/.env
   ```

   Upewnij się że:
   - `EXPO_PUBLIC_SUPABASE_URL` jest prawidłowy
   - `EXPO_PUBLIC_SUPABASE_ANON_KEY` jest prawidłowy
   - To są **dokładnie te same** dane co w głównym projekcie

2. **Sprawdź czy konto istnieje**
   - Zaloguj się do aplikacji webowej (CRM)
   - Jeśli działa tam, powinno działać w mobile

3. **Sprawdź połączenie**
   ```bash
   # Testuj połączenie z Supabase
   curl https://twoj-projekt.supabase.co/rest/v1/
   ```

---

### ❌ Aplikacja crashuje po uruchomieniu

**Problem:**
Expo Go zamyka się zaraz po otwarciu.

**Rozwiązanie:**

1. **Wyczyść cache Expo**

   ```bash
   npm start -- --clear
   ```

2. **Sprawdź logi**
   - Wstrząśnij telefonem
   - Developer Menu → Show Element Inspector
   - Sprawdź błędy w konsoli

3. **Reinstaluj Expo Go**
   - Usuń Expo Go z telefonu
   - Zainstaluj ponownie ze sklepu

---

### ❌ Expo Go nie pokazuje QR code

**Problem:**
Po `npm start` nie widać kodu QR.

**Rozwiązanie:**

1. **Sprawdź czy port jest wolny**

   ```bash
   lsof -i :8081
   # Jeśli coś używa portu, zabij proces
   ```

2. **Użyj tunnel mode**

   ```bash
   npm start -- --tunnel
   ```

3. **Sprawdź firewall**
   - Upewnij się że firewall nie blokuje Expo

---

### ❌ "Network request failed" podczas logowania

**Problem:**
Aplikacja nie może połączyć się z Supabase.

**Rozwiązanie:**

1. **Sprawdź połączenie internetowe**
   - Telefon i komputer muszą mieć internet

2. **Sprawdź URL Supabase**

   ```bash
   # Powinna zwrócić status 200
   curl -I https://twoj-projekt.supabase.co
   ```

3. **Użyj tunnel mode**
   ```bash
   # Czasami LAN mode nie działa
   npm start -- --tunnel
   ```

---

### ❌ TypeScript errors

**Problem:**

```
Type error: Cannot find module '@/contexts/AuthContext'
```

**Rozwiązanie:**

```bash
# Sprawdź tsconfig.json
cat mobile/tsconfig.json

# Powinno zawierać:
{
  "compilerOptions": {
    "paths": {
      "@/*": ["./src/*"]
    }
  }
}

# Restart TypeScript server w edytorze
```

---

### ❌ "Invariant Violation: Native module cannot be null"

**Problem:**
Brakuje natywnych modułów.

**Rozwiązanie:**

```bash
# Przeinstaluj expo packages
cd mobile
npx expo install --check
npx expo install --fix

# Restart
npm start -- --clear
```

---

## 🆘 Nadal nie działa?

### Pełny reset:

```bash
cd mobile

# 1. Usuń wszystko
rm -rf node_modules
rm -rf .expo
rm -rf package-lock.json

# 2. Zainstaluj od nowa
npm install

# 3. Wyczyść cache
npm start -- --clear

# 4. Jeśli nadal nie działa, restartuj Expo Go na telefonie
```

### Debug checklist:

- [ ] Mam najnowszą wersję Expo Go (SDK 54)
- [ ] Plik `.env` ma poprawne dane Supabase
- [ ] `npm install` zakończył się sukcesem
- [ ] Port 8081 jest wolny
- [ ] Telefon i komputer są w tej samej sieci (LAN mode)
- [ ] Firewall nie blokuje Expo
- [ ] Mam połączenie z internetem
- [ ] Supabase URL jest dostępny

### Sprawdź wersje:

```bash
# Node version (powinno być 18+)
node -v

# NPM version
npm -v

# Expo CLI (zainstalowane globalnie)
npx expo --version

# Wersje w projekcie
cat mobile/package.json | grep -E "expo|react"
```

---

## 📚 Więcej pomocy

- [Expo Documentation](https://docs.expo.dev/)
- [Expo Troubleshooting](https://docs.expo.dev/troubleshooting/overview/)
- [Supabase Docs](https://supabase.com/docs)
- [React Navigation](https://reactnavigation.org/docs/troubleshooting)

---

## 💡 Wskazówki

### Szybszy development:

```bash
# Użyj tunnel mode jeśli LAN nie działa
npm start -- --tunnel

# Automatyczne odświeżanie
npm start -- --clear

# Dev client zamiast Expo Go (zaawansowane)
npx expo run:android
npx expo run:ios
```

### Debugowanie:

```bash
# Remote debugging (Chrome DevTools)
# Wstrząśnij telefonem → Debug Remote JS

# Expo DevTools w przeglądarce
npm start
# Naciśnij 'd' w terminalu
```

---

**Pytania?** Sprawdź [README.md](./README.md) lub [QUICK_START.md](./QUICK_START.md)
