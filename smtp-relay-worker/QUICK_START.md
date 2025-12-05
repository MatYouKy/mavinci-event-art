# SMTP Relay Worker - Szybki Start

## 🎯 Co to jest?

Worker który pośredniczy w wysyłaniu emaili dla Supabase Edge Functions.
Deno Deploy blokuje porty SMTP, więc ten worker na VPS rozwiązuje problem.

## 📦 Instalacja na VPS

### 1. Skopiuj pliki na VPS

```bash
# Na swoim komputerze
scd smtp-relay-worker
rsync -avz . user@your-vps:/home/user/smtp-relay-worker/
```

Lub:

```bash
# Na VPS
cd /home/user/
git clone your-repo.git
cd your-repo/smtp-relay-worker
```

### 2. Zainstaluj zależności

```bash
cd /home/user/smtp-relay-worker
npm install
```

### 3. Skonfiguruj środowisko

```bash
# Skopiuj przykładowy plik
cp .env.example .env

# Wygeneruj silny sekret
openssl rand -hex 32

# Edytuj plik
nano .env
```

Ustaw:
```env
PORT=3005
RELAY_SECRET=<wygenerowany-sekret>
```

### 4. Uruchom worker

#### Opcja A: PM2 (zalecane dla produkcji)

```bash
# Zainstaluj PM2 globalnie (jeśli nie masz)
npm install -g pm2

# Uruchom worker
npm run pm2:start

# Sprawdź status
npm run pm2:status

# Zobacz logi
npm run pm2:logs
```

#### Opcja B: Ręcznie (dla testów)

```bash
npm start
```

### 5. Sprawdź czy działa

```bash
# Health check
curl http://localhost:3005/health

# Powinieneś zobaczyć:
# {"status":"ok","service":"smtp-relay-worker","timestamp":"..."}
```

## 🔧 Konfiguracja Supabase Edge Functions

### 1. Dodaj zmienną środowiskową w Supabase

W dashboard Supabase → Settings → Edge Functions → Environment Variables:

```
SMTP_RELAY_URL=http://your-vps-ip:3005
SMTP_RELAY_SECRET=<ten-sam-sekret-co-w-.env>
```

### 2. Zaktualizuj Edge Function

Edge Function automatycznie będzie używać relay workera.

## 🧪 Testowanie

### Test z curl:

```bash
curl -X POST http://localhost:3005/api/send-email \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-secret-here" \
  -d '{
    "smtpConfig": {
      "host": "smtp.example.com",
      "port": 587,
      "username": "user@example.com",
      "password": "password",
      "from": "user@example.com",
      "fromName": "Test User"
    },
    "to": "recipient@example.com",
    "subject": "Test Email",
    "body": "<p>Hello World</p>"
  }'
```

## 📋 Komendy PM2

```bash
# Start
npm run pm2:start

# Stop
npm run pm2:stop

# Restart
npm run pm2:restart

# Logi (na żywo)
npm run pm2:logs

# Status
npm run pm2:status

# Restart po restarcie serwera
pm2 startup
pm2 save
```

## 🔒 Bezpieczeństwo

1. **Firewall**: Otwórz port tylko dla Supabase/Edge Functions
2. **RELAY_SECRET**: Użyj silnego losowego stringa
3. **HTTPS**: Rozważ reverse proxy (nginx) z SSL

## 🐛 Troubleshooting

### Worker nie startuje
```bash
# Sprawdź czy port jest wolny
lsof -i :3005

# Sprawdź logi
npm run pm2:logs
```

### Błąd autoryzacji
- Sprawdź czy `RELAY_SECRET` jest taki sam w `.env` i Supabase

### SMTP timeout
- Sprawdź czy VPS ma dostęp do portów SMTP (587/465)
- Sprawdź firewall VPS

## 📊 Monitorowanie

```bash
# Status workera
pm2 status

# Logi real-time
pm2 logs smtp-relay-worker --lines 100

# Metryki
pm2 monit
```
