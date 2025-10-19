# 📋 Git & Mobile - Przewodnik

## 🚨 Szybkie rozwiązania problemów

### npm install: EACCES permission denied

```bash
# Wyczyść cache i spróbuj ponownie:
npm cache clean --force
npm install

# Jeśli nie działa - usuń cache całkowicie:
rm -rf ~/.npm/_cacache
npm cache verify
npm install
```

### Warningi EBADENGINE - IGNORUJ!

```
npm warn EBADENGINE Unsupported engine...
```
**To są tylko ostrzeżenia!** npm je ignoruje. Instalacja powinna się udać.

---

## Problem: Expo generuje pliki które pojawiają się w `git status`

### Co się dzieje?

Po uruchomieniu `npm start` w folderze `mobile/`, Expo automatycznie generuje:
- `mobile/.expo/` - cache Metro bundlera
- `mobile/.metro-health-check*` - pliki tymczasowe
- `mobile/yarn.lock` - jeśli użyjesz yarn (a nie npm)

Te pliki **NIE POWINNY** być commitowane do Git!

---

## ✅ Rozwiązanie

### 1. Upewnij się że `.gitignore` jest poprawny

Plik `.gitignore` w głównym projekcie powinien zawierać:

```gitignore
# Expo (mobile)
mobile/.expo/
mobile/dist/
mobile/web-build/
mobile/.metro-health-check*
mobile/yarn.lock

# Expo generated files
**/.expo/
```

✅ To już jest dodane!

### 2. Sprawdź status Git

```bash
git status
```

Jeśli widzisz:
```
modified:   mobile/.expo/...
untracked:  mobile/.expo/...
```

To są pliki które powinny być zignorowane!

### 3. Wyczyść cache Git

Jeśli pliki `.expo/` były już dodane do Git wcześniej:

```bash
# Usuń z indeksu (ale zostaw lokalnie)
git rm -r --cached mobile/.expo/

# Usuń yarn.lock jeśli był dodany
git rm --cached mobile/yarn.lock

# Dodaj zmiany
git add .gitignore

# Commit
git commit -m "fix: ignore Expo generated files"
```

---

## 🔍 Dlaczego `package.json` i `deploy.sh` się zmieniają?

### Problem z `package.json`

Jeśli używasz **yarn** do deploy (`yarn deploy`), może on:
1. Sortować dependencies alfabetycznie
2. Aktualizować wersje z `^` na konkretne
3. Dodawać pole `resolutions`

**Rozwiązanie:**
```bash
# Użyj npm zamiast yarn
npm run deploy

# Lub zablokuj auto-sort w package.json
# Dodaj do package.json:
"prettier": {
  "sortPackageJson": false
}
```

### Problem z `deploy.sh`

Jeśli `deploy.sh` się zmienia, sprawdź:

1. **Line endings (CRLF vs LF)**
   ```bash
   # Sprawdź
   file deploy.sh

   # Napraw na LF
   dos2unix deploy.sh
   # lub
   sed -i 's/\r$//' deploy.sh
   ```

2. **Uprawnienia (chmod)**
   ```bash
   # Skrypt automatycznie robi chmod +x
   # Git może to śledzić - dodaj do .gitattributes:
   *.sh text eol=lf
   ```

---

## 📦 Co powinno być commitowane?

### ✅ TAK - commituj:
- `mobile/src/**` - kod źródłowy
- `mobile/package.json` - dependencies
- `mobile/app.json` - konfiguracja Expo
- `mobile/tsconfig.json` - TypeScript config
- `mobile/README.md` - dokumentacja
- `mobile/.env.example` - przykładowa konfiguracja

### ❌ NIE - ignoruj:
- `mobile/.expo/**` - cache Expo
- `mobile/node_modules/` - zależności npm
- `mobile/.env` - twoje dane (secrets!)
- `mobile/dist/` - buildy
- `mobile/yarn.lock` - używamy npm
- `mobile/.metro-health-check*` - pliki tymczasowe

---

## 🛠️ Komendy pomocnicze

### Sprawdź co jest zignorowane:

```bash
git check-ignore -v mobile/.expo/
# Powinno zwrócić: .gitignore:28:mobile/.expo/
```

### Zobacz różnice ignorując whitespace:

```bash
git diff -w
git diff --ignore-all-space
```

### Zresetuj zmiany w plikach generated:

```bash
# Reset package.json jeśli yarn go zmienił
git checkout HEAD -- package.json

# Reset wszystkich plików mobile/.expo/
git clean -fd mobile/.expo/
```

### Sprawdź historię pliku:

```bash
git log --follow --oneline -- mobile/.expo/
```

---

## 🎯 Best Practices

### 1. Używaj npm, nie yarn (w mobile)

```bash
# W mobile/ używaj:
npm install
npm start

# Unikaj:
yarn install  # tworzy yarn.lock!
yarn start
```

### 2. Commituj tylko źródła

```bash
# Przed commitem sprawdź:
git status

# Upewnij się że nie ma:
# - mobile/.expo/
# - mobile/yarn.lock
# - mobile/.metro-health-check*
```

### 3. Używaj .gitattributes

Plik `.gitattributes` w projekcie oznacza pliki generated:

```gitattributes
mobile/.expo/** linguist-generated=true
mobile/yarn.lock linguist-generated=true
```

Git diff będzie je pomijać!

---

## 🆘 SOS: Przypadkowo commitnąłem `.expo/`

### Krok 1: Usuń z historii (ostatni commit)

```bash
# Jeśli jeszcze nie pushowałeś:
git reset --soft HEAD~1
git rm -r --cached mobile/.expo/
git add .gitignore
git commit -m "fix: ignore Expo generated files"
```

### Krok 2: Jeśli już pushowałeś

```bash
# UWAGA: zmienia historię, wymaga force push!
git rm -r --cached mobile/.expo/
git add .gitignore
git commit -m "fix: remove Expo cache from git"
git push --force-with-lease
```

### Krok 3: Wyczyść dla wszystkich

```bash
# Każdy w zespole musi zrobić:
git pull
git clean -fdx mobile/.expo/
```

---

## ✅ Checklist przed deploy

Przed `yarn deploy` lub `npm run deploy`:

- [ ] Sprawdziłem `git status` - brak plików `.expo/`
- [ ] Plik `.gitignore` zawiera `mobile/.expo/`
- [ ] Używam `npm` (nie `yarn`) w mobile/
- [ ] `package.json` nie ma niechcianych zmian
- [ ] `deploy.sh` ma LF endings (nie CRLF)

---

## 📚 Więcej informacji

- [Git dokumentacja: .gitignore](https://git-scm.com/docs/gitignore)
- [Git dokumentacja: .gitattributes](https://git-scm.com/docs/gitattributes)
- [Expo dokumentacja: .gitignore](https://docs.expo.dev/guides/using-git/)

---

**TL;DR:**
1. `.gitignore` już ignoruje `mobile/.expo/` ✅
2. Nie używaj `yarn` w mobile/ (tylko `npm`) ✅
3. Jeśli widzisz zmiany w `.expo/` → zignoruj je ✅
