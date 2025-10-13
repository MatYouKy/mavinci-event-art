# Instrukcje Deploy na VPS

## Problem: 403 Forbidden i 404 Not Found po deploy

### Przyczyny:
1. **Brak zmiennych środowiskowych** - Next.js nie ma dostępu do konfiguracji Supabase
2. **Niepoprawna konfiguracja** - zmienne `NEXT_PUBLIC_*` muszą być dostępne w przeglądarce

---

## Rozwiązanie: Ustawienie zmiennych środowiskowych

### Opcja 1: Plik `.env` na serwerze

1. Skopiuj plik `.env` na VPS:
```bash
scp .env twoj-user@twoj-vps:/ścieżka/do/projektu/.env
```

2. Upewnij się że plik zawiera wszystkie zmienne:
```env
NEXT_PUBLIC_SUPABASE_URL=https://fuuljhhuhfojtmmfmskq.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
ADMIN_API_TOKEN=mavinci-admin-secret-2025
NEXT_PUBLIC_ADMIN_API_TOKEN=mavinci-admin-secret-2025
```

3. **WAŻNE**: Po dodaniu `.env` musisz **zrestartować** aplikację:
```bash
# Jeśli używasz PM2:
pm2 restart mavinci

# Jeśli używasz systemd:
sudo systemctl restart mavinci

# Jeśli używasz npm bezpośrednio:
# zabij proces i uruchom ponownie
npm run start
```

---

### Opcja 2: Zmienne środowiskowe w PM2

Jeśli używasz PM2, utwórz plik `ecosystem.config.js`:

```javascript
module.exports = {
  apps: [{
    name: 'mavinci',
    script: 'npm',
    args: 'start',
    env: {
      NODE_ENV: 'production',
      PORT: 3000,
      NEXT_PUBLIC_SUPABASE_URL: 'https://fuuljhhuhfojtmmfmskq.supabase.co',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
      SUPABASE_SERVICE_ROLE_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
      ADMIN_API_TOKEN: 'mavinci-admin-secret-2025',
      NEXT_PUBLIC_ADMIN_API_TOKEN: 'mavinci-admin-secret-2025'
    }
  }]
};
```

Następnie:
```bash
pm2 delete mavinci
pm2 start ecosystem.config.js
pm2 save
```

---

### Opcja 3: Zmienne w Nginx (dla standalone build)

Jeśli używasz `output: 'standalone'` w `next.config.js`, możesz ustawić zmienne w pliku `.env.local`:

```bash
# Na serwerze VPS
cd /ścieżka/do/projektu
nano .env.local

# Wklej:
NEXT_PUBLIC_SUPABASE_URL=https://fuuljhhuhfojtmmfmskq.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

---

## Weryfikacja po deploy

### 1. Sprawdź czy zmienne są dostępne:

```bash
# Zaloguj się na VPS
ssh twoj-user@twoj-vps

# Sprawdź zmienne środowiskowe:
pm2 env 0  # jeśli używasz PM2

# Lub sprawdź plik .env
cat /ścieżka/do/projektu/.env
```

### 2. Sprawdź logi aplikacji:

```bash
# PM2:
pm2 logs mavinci

# systemd:
journalctl -u mavinci -f

# npm (bezpośrednio):
# sprawdź terminal gdzie uruchomiłeś aplikację
```

Szukaj błędów typu:
- `Missing Supabase environment variables!`
- `NEXT_PUBLIC_SUPABASE_URL is undefined`

### 3. Test w przeglądarce:

Otwórz konsolę devtools (F12) i sprawdź:
```javascript
// W konsoli przeglądarki:
console.log('Supabase URL:', process.env.NEXT_PUBLIC_SUPABASE_URL);
```

Jeśli pokazuje `undefined` - zmienne nie są dostępne w przeglądarce!

---

## Typowy proces deploy na VPS

```bash
# 1. Zaloguj się na VPS
ssh twoj-user@twoj-vps

# 2. Przejdź do katalogu projektu
cd /ścieżka/do/projektu

# 3. Pobierz najnowszy kod
git pull origin main

# 4. Zainstaluj zależności
npm install

# 5. WAŻNE: Sprawdź czy jest plik .env
cat .env  # powinien pokazać zmienne

# 6. Zbuduj aplikację
npm run build

# 7. Zrestartuj aplikację
pm2 restart mavinci
# LUB
sudo systemctl restart mavinci

# 8. Sprawdź logi
pm2 logs mavinci --lines 50
```

---

## Debugging - Jeśli nadal nie działa

### Krok 1: Sprawdź czy zmienne są w build
```bash
# Sprawdź czy Next.js widzi zmienne:
npm run build | grep -i "supabase\|env"
```

### Krok 2: Sprawdź output standalone
```bash
# Jeśli używasz standalone:
ls -la .next/standalone/.env
cat .next/standalone/.env
```

### Krok 3: Sprawdź uprawnienia
```bash
# Upewnij się że .env ma prawidłowe uprawnienia:
chmod 644 .env
chown twoj-user:twoj-user .env
```

### Krok 4: Hard restart
```bash
# Zatrzymaj wszystko
pm2 delete all

# Usuń cache Next.js
rm -rf .next

# Zbuduj od nowa
npm run build

# Uruchom ponownie
pm2 start ecosystem.config.js
pm2 save
```

---

## Bezpieczeństwo

⚠️ **WAŻNE**:
- Plik `.env` zawiera klucze API - **NIE COMMITUJ** go do Git!
- Dodaj `.env` do `.gitignore`
- Przechowuj backup `.env` w bezpiecznym miejscu

---

## Szybki checklist

- [ ] Plik `.env` istnieje na VPS
- [ ] Plik `.env` zawiera wszystkie zmienne (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, itd.)
- [ ] Aplikacja została zrestartowana po dodaniu `.env`
- [ ] Logi nie pokazują błędów o brakujących zmiennych
- [ ] Formularz kontaktowy działa (test: wyślij wiadomość)
- [ ] Strona zespołu `/zespol` pokazuje członków zespołu

---

## Wsparcie

Jeśli problemy nadal występują:
1. Sprawdź logi: `pm2 logs mavinci`
2. Sprawdź console przeglądarki (F12)
3. Upewnij się że rebuild został wykonany po zmianach w `.env`
