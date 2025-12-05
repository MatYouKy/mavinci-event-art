# ✅ Checklist - Konfiguracja SMTP Relay

## Krok 1: Sprawdź port workera na VPS

```bash
cd ~/smtp-relay-worker
cat .env | grep PORT
```

**Powinieneś zobaczyć:**
```
PORT=3005
```

Jeśli nie ma lub jest inny - edytuj:
```bash
nano .env
```

Dodaj/zmień:
```
PORT=3005
```

Zapisz (Ctrl+O, Enter, Ctrl+X)

## Krok 2: Sprawdź RELAY_SECRET na VPS

```bash
cd ~/smtp-relay-worker
./compare-secrets.sh
```

**Skopiuj cały sekret!**

## Krok 3: Restart workera

```bash
npm run pm2:restart
pm2 status
```

**Sprawdź czy działa:**
```bash
curl http://localhost:3005/health
```

**Powinieneś zobaczyć:**
```json
{
  "status": "ok",
  "service": "smtp-relay-worker",
  "timestamp": "2025-12-05..."
}
```

## Krok 4: Sprawdź IP swojego VPS

```bash
curl ifconfig.me
```

**Zapisz swoje IP** (np. `123.45.67.89`)

## Krok 5: Konfiguracja w Supabase Dashboard

Idź do: https://supabase.com/dashboard

1. Wybierz swój projekt
2. **Settings** → **Edge Functions** → **Environment Variables**

### Zmienna 1: SMTP_RELAY_URL

```
Name: SMTP_RELAY_URL
Value: http://TWOJE-IP-VPS:3005
```

**WAŻNE:** Zamień `TWOJE-IP-VPS` na IP z kroku 4!

**Przykład:**
```
http://123.45.67.89:3005
```

### Zmienna 2: SMTP_RELAY_SECRET

```
Name: SMTP_RELAY_SECRET
Value: <sekret-z-kroku-2>
```

**Wklej DOKŁADNIE ten sam sekret co w .env na VPS!**

## Krok 6: Poczekaj i wdróż

1. **Zapisz zmienne w Supabase**
2. **Poczekaj 60-90 sekund** (zmienne muszą się załadować)
3. Wdróż funkcję na nowo:

W katalogu projektu:
```bash
npm run build
```

## Krok 7: Test

### Na VPS sprawdź logi:

```bash
pm2 logs smtp-relay-worker --lines 0
```

(zostaw otwarte w terminalu)

### W aplikacji:

Wyślij testowy email (np. contract email)

### Co powinieneś zobaczyć w logach:

```
🔐 Authorization check:
   Received header: Bearer abc123...
   Expected: Bearer abc123...
✅ Authorization successful
📧 [2025-12-05...] Sending email to: recipient@example.com
   Subject: Contract Email
   SMTP: smtp.gmail.com:587
   Attachments: 1
🔌 Verifying SMTP connection...
✅ SMTP connection verified
📮 Sending email...
✅ Email sent successfully. MessageId: <...>
```

## Jeśli wciąż błąd autoryzacji:

### Test lokalny na VPS:

```bash
cd ~/smtp-relay-worker
source .env

curl -X POST http://localhost:3005/api/send-email \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $RELAY_SECRET" \
  -d '{
    "smtpConfig": {
      "host": "test",
      "port": 587,
      "username": "test",
      "password": "test",
      "from": "test@test.com",
      "fromName": "Test"
    },
    "to": "test@test.com",
    "subject": "Test",
    "body": "Test"
  }'
```

**Jeśli to działa lokalnie**, problem jest w zmiennych Supabase.

**Jeśli to NIE działa**, problem jest w workerze.

## Częste problemy:

### ❌ Port 3001 zamiast 3005

Upewnij się że wszędzie jest **3005**:
- `.env` na VPS: `PORT=3005`
- Supabase: `SMTP_RELAY_URL=http://IP:3005`

### ❌ Firewall blokuje port 3005

```bash
sudo ufw allow 3005/tcp
sudo ufw reload
```

### ❌ Worker nie działa

```bash
pm2 status
pm2 restart smtp-relay-worker
pm2 logs smtp-relay-worker
```

### ❌ Różne sekrety

Uruchom ponownie:
```bash
./compare-secrets.sh
```

Skopiuj i wklej sekret do Supabase DOKŁADNIE jak jest.

### ❌ Zmienne w Supabase nie załadowały się

Poczekaj 2 minuty i spróbuj ponownie.

## Debug mode:

Jeśli chcesz zobaczyć dokładnie co przychodzi do workera:

```bash
pm2 logs smtp-relay-worker --lines 100 --raw
```

Próbuj wysłać email i obserwuj logi w czasie rzeczywistym.
