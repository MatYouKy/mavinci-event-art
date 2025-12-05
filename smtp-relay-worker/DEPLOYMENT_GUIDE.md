# SMTP Relay Worker - Pełna Instrukcja Wdrożenia

## Krok 1: Przygotowanie VPS

### 1.1 Zaloguj się na VPS

```bash
ssh user@your-vps-ip
```

### 1.2 Zainstaluj Node.js (jeśli nie masz)

```bash
# Ubuntu/Debian
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Sprawdź wersję
node -v  # powinno być v18+
npm -v
```

### 1.3 Zainstaluj PM2 globalnie

```bash
sudo npm install -g pm2
```

## Krok 2: Wgranie Workera na VPS

### Opcja A: Przez Git (zalecane)

```bash
# Na VPS
cd ~
git clone https://github.com/your-username/your-repo.git
cd your-repo/smtp-relay-worker
```

### Opcja B: Przez rsync

```bash
# Na swoim komputerze (w katalogu projektu)
rsync -avz smtp-relay-worker/ user@your-vps-ip:/home/user/smtp-relay-worker/

# Potem na VPS
ssh user@your-vps-ip
cd ~/smtp-relay-worker
```

## Krok 3: Konfiguracja Workera

### 3.1 Zainstaluj zależności

```bash
cd ~/smtp-relay-worker
npm install
```

### 3.2 Utwórz plik .env

```bash
cp .env.example .env
```

### 3.3 Wygeneruj sekretny klucz

```bash
openssl rand -hex 32
```

Skopiuj wygenerowany string.

### 3.4 Edytuj .env

```bash
nano .env
```

Wklej:
```env
PORT=3001
RELAY_SECRET=<wygenerowany-sekret-z-kroku-3.3>
```

Zapisz (Ctrl+O, Enter, Ctrl+X).

### 3.5 Nadaj uprawnienia testowemu skryptowi

```bash
chmod +x test-relay.sh
```

## Krok 4: Uruchomienie Workera

### 4.1 Uruchom przez PM2

```bash
npm run pm2:start
```

### 4.2 Sprawdź status

```bash
pm2 status
```

Powinieneś zobaczyć:
```
┌────┬─────────────────────┬─────────┬─────────┬─────────┬──────────┐
│ id │ name                │ status  │ restart │ uptime  │ cpu      │
├────┼─────────────────────┼─────────┼─────────┼─────────┼──────────┤
│ 0  │ smtp-relay-worker   │ online  │ 0       │ 0s      │ 0%       │
└────┴─────────────────────┴─────────┴─────────┴─────────┴──────────┘
```

### 4.3 Zobacz logi

```bash
pm2 logs smtp-relay-worker
```

Powinieneś zobaczyć:
```
┌─────────────────────────────────────────────┐
│  📮 SMTP Relay Worker                      │
├─────────────────────────────────────────────┤
│  Port: 3001                                │
│  Status: ✅ Running                         │
...
```

### 4.4 Test lokalny

```bash
curl http://localhost:3001/health
```

Odpowiedź:
```json
{"status":"ok","service":"smtp-relay-worker","timestamp":"2025-12-05T..."}
```

### 4.5 Test z autoryzacją (opcjonalny)

```bash
./test-relay.sh
```

## Krok 5: Konfiguracja Firewall (opcjonalnie)

Jeśli chcesz ograniczyć dostęp tylko do Supabase:

```bash
# Ubuntu/Debian z ufw
sudo ufw allow from <supabase-ip> to any port 3001
sudo ufw reload
```

Lub pozostaw otwarty dla wszystkich (worker wymaga autoryzacji):

```bash
sudo ufw allow 3001
sudo ufw reload
```

## Krok 6: Konfiguracja Supabase

### 6.1 Znajdź IP swojego VPS

```bash
curl ifconfig.me
```

### 6.2 Dodaj zmienne środowiskowe w Supabase

1. Idź do Supabase Dashboard
2. Wybierz projekt
3. Settings → Edge Functions → Environment Variables
4. Dodaj 2 nowe zmienne:

**Zmienna 1:**
```
Name: SMTP_RELAY_URL
Value: http://YOUR-VPS-IP:3001
```

**Zmienna 2:**
```
Name: SMTP_RELAY_SECRET
Value: <ten-sam-sekret-co-w-.env>
```

### 6.3 Redeploy Edge Functions

Edge Functions automatycznie pobiorą nowe zmienne środowiskowe przy następnym wywołaniu.

Możesz wymusić redeploy przez Supabase CLI (opcjonalnie):
```bash
supabase functions deploy send-email
supabase functions deploy send-invoice-email
supabase functions deploy send-offer-email
```

## Krok 7: Testowanie End-to-End

### 7.1 Test z CRM

1. Zaloguj się do CRM
2. Idź do Wiadomości (Messages)
3. Spróbuj wysłać email
4. Sprawdź logi na VPS:

```bash
pm2 logs smtp-relay-worker --lines 50
```

### 7.2 Test z curl (bezpośredni)

```bash
curl -X POST http://YOUR-VPS-IP:3001/api/send-email \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR-RELAY-SECRET" \
  -d '{
    "smtpConfig": {
      "host": "smtp.gmail.com",
      "port": 587,
      "username": "your-email@gmail.com",
      "password": "your-app-password",
      "from": "your-email@gmail.com",
      "fromName": "Test User"
    },
    "to": "recipient@example.com",
    "subject": "Test Email from SMTP Relay",
    "body": "<p>Hello from SMTP Relay Worker!</p>"
  }'
```

## Krok 8: Auto-restart po rebootcie serwera

### 8.1 Dodaj PM2 do autostartu

```bash
pm2 startup
```

Skopiuj i uruchom komendę którą wyświetli PM2.

### 8.2 Zapisz obecną konfigurację

```bash
pm2 save
```

Teraz worker będzie startował automatycznie po restarcie VPS.

## Krok 9: Monitorowanie

### Zobacz status
```bash
pm2 status
```

### Zobacz logi (live)
```bash
pm2 logs smtp-relay-worker
```

### Zobacz ostatnie 100 linii
```bash
pm2 logs smtp-relay-worker --lines 100
```

### Restart workera
```bash
pm2 restart smtp-relay-worker
```

### Stop workera
```bash
pm2 stop smtp-relay-worker
```

## Troubleshooting

### Problem: Worker nie startuje

**Sprawdź logi:**
```bash
pm2 logs smtp-relay-worker --err
```

**Sprawdź czy port jest wolny:**
```bash
lsof -i :3001
```

**Sprawdź .env:**
```bash
cat .env
# Upewnij się że RELAY_SECRET jest ustawiony
```

### Problem: 401 Unauthorized

**Sprawdź czy sekret się zgadza:**
```bash
# Na VPS
cat ~/smtp-relay-worker/.env | grep RELAY_SECRET

# W Supabase Dashboard
# Settings → Edge Functions → Environment Variables
# Sprawdź SMTP_RELAY_SECRET
```

### Problem: Connection timeout z Edge Function

**Sprawdź firewall:**
```bash
sudo ufw status
```

**Sprawdź czy worker działa:**
```bash
pm2 status
curl http://localhost:3001/health
```

**Sprawdź IP w Supabase:**
```bash
# Upewnij się że SMTP_RELAY_URL wskazuje na prawidłowy IP
curl ifconfig.me  # To jest twoje publiczne IP
```

### Problem: SMTP błędy

**Zobacz szczegółowe logi:**
```bash
pm2 logs smtp-relay-worker --lines 200
```

**Sprawdź dane SMTP:**
- Host
- Port (587 dla TLS, 465 dla SSL)
- Username
- Password
- Czy serwer SMTP pozwala na połączenia z VPS?

### Problem: Email nie wysyła się

**Sprawdź logi Edge Function w Supabase:**
1. Supabase Dashboard
2. Edge Functions
3. Wybierz funkcję (np. send-email)
4. Logs

**Sprawdź logi workera:**
```bash
pm2 logs smtp-relay-worker --lines 50
```

## Bezpieczeństwo

1. **Silny RELAY_SECRET** - użyj długiego losowego stringa
2. **Firewall** - ogranicz dostęp do portu 3001
3. **HTTPS** - rozważ reverse proxy (nginx) z SSL
4. **Regularne aktualizacje** - `npm update` co jakiś czas
5. **Monitoruj logi** - sprawdzaj regularnie czy nie ma podejrzanych requestów

## Utrzymanie

### Aktualizacja workera

```bash
cd ~/smtp-relay-worker
git pull  # jeśli używasz git
npm install  # jeśli były zmiany w package.json
pm2 restart smtp-relay-worker
```

### Backup konfiguracji

```bash
# Backup .env
cp ~/smtp-relay-worker/.env ~/smtp-relay-worker/.env.backup

# Backup PM2 config
pm2 save
```

### Sprawdzenie używania zasobów

```bash
pm2 monit
```
