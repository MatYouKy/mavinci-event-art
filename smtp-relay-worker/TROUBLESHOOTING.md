# 🔧 Rozwiązywanie problemów

## Błąd: "Unauthorized: Invalid relay secret"

### Diagnoza:
Worker otrzymuje request, ale sekret autoryzacyjny się nie zgadza.

### Rozwiązanie:

#### 1. Na VPS sprawdź sekret:
```bash
cd ~/smtp-relay-worker
cat .env | grep RELAY_SECRET
```

Skopiuj **cały** sekret.

#### 2. W Supabase Dashboard:

1. Settings → Edge Functions → Environment Variables
2. Znajdź: `SMTP_RELAY_SECRET`
3. Kliknij **Edit**
4. Wklej **DOKŁADNIE** ten sam sekret
5. **Zapisz**
6. **Poczekaj 60-90 sekund**

#### 3. Restart workera:
```bash
npm run pm2:restart
pm2 logs smtp-relay-worker
```

#### 4. Test:
```bash
./test-local.sh
```

---

## Błąd: "SMTP_RELAY_URL not configured"

### Diagnoza:
Edge Function nie ma zmiennej środowiskowej.

### Rozwiązanie:

W Supabase Dashboard (Settings → Edge Functions → Environment Variables):

**Zmienna 1:**
```
Name: SMTP_RELAY_URL
Value: http://TWOJE-IP-VPS:3005
```

Sprawdź swoje IP:
```bash
curl ifconfig.me
```

**Zmienna 2:**
```
Name: SMTP_RELAY_SECRET
Value: <twój-sekret-z-.env>
```

---

## Worker nie odpowiada

### Test 1: Czy worker działa?
```bash
pm2 status
```

Jeśli nie działa:
```bash
npm run pm2:start
```

### Test 2: Czy port jest otwarty?
```bash
curl http://localhost:3005/health
```

Jeśli nie działa:
```bash
# Sprawdź co używa portu
lsof -i :3005

# Sprawdź .env
cat .env | grep PORT
```

### Test 3: Czy firewall przepuszcza?
```bash
sudo ufw status
```

Jeśli port 3005 jest zablokowany:
```bash
sudo ufw allow 3005/tcp
sudo ufw reload
```

---

## SMTP Connection Failed

### Możliwe przyczyny:

#### 1. Zły host/port
```bash
pm2 logs smtp-relay-worker --lines 50
```

Sprawdź w logach:
```
SMTP: smtp.example.com:587
```

#### 2. Zły login/hasło
Edge Function wysyła dane SMTP z bazy:
```sql
SELECT * FROM employee_email_accounts WHERE id = 'xxx';
```

#### 3. VPS nie może połączyć się ze SMTP
```bash
telnet smtp.example.com 587
```

Jeśli nie działa - problem z firewallem VPS lub SMTP server.

---

## Request nie dociera do workera

### Sprawdź logi w czasie rzeczywistym:
```bash
pm2 logs smtp-relay-worker --lines 0
```

Wyślij testowy email z CRM.

### Jeśli nic nie widzisz w logach:

#### 1. Sprawdź SMTP_RELAY_URL w Supabase
Musi wskazywać na prawidłowy IP i port:
```
http://123.45.67.89:3005
```

#### 2. Sprawdź czy IP jest publiczne
```bash
curl ifconfig.me
```

#### 3. Sprawdź Edge Function logi
W Supabase Dashboard:
- Edge Functions → send-email → Logs

Szukaj błędów connect/timeout.

---

## Długość sekretu się różni

### Problem:
```
Provided length: 63
Expected length: 64
```

To oznacza że sekrety są **różne**!

### Rozwiązanie:

#### Opcja A: Wygeneruj nowy (zalecane)

Na VPS:
```bash
cd ~/smtp-relay-worker
NEW_SECRET=$(openssl rand -hex 32)
echo "RELAY_SECRET=$NEW_SECRET" > .env.tmp
echo "PORT=3005" >> .env.tmp
mv .env.tmp .env
npm run pm2:restart
echo "Nowy sekret: $NEW_SECRET"
```

Skopiuj sekret i wklej do Supabase (SMTP_RELAY_SECRET).

#### Opcja B: Użyj istniejącego

Uruchom:
```bash
./compare-secrets.sh
```

Skopiuj i wklej do Supabase.

---

## "First 10 chars match: false"

### Problem:
Pierwsze znaki sekretów się różnią = całkowicie różne sekrety.

### Rozwiązanie:
Użyj skryptu porównującego:
```bash
./compare-secrets.sh
```

Skopiuj **dokładnie** to co wyświetli i wklej do Supabase.

**UWAGA:** Nie dodawaj:
- Spacji na końcu
- Enterów
- Cudzysłowów
- Żadnych innych znaków

---

## Zmienne w Supabase się nie ładują

### Problem:
Zaktualizowałeś zmienne, ale wciąż błąd.

### Rozwiązanie:
1. **Poczekaj 2-3 minuty** (zmienne muszą się załadować)
2. Sprawdź czy na pewno zapisałeś (kliknij Save)
3. Odśwież stronę w Supabase Dashboard
4. Sprawdź czy zmienne są widoczne

---

## Test autoryzacji lokalnie

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

### Oczekiwana odpowiedź:
```json
{
  "success": false,
  "error": "Missing required fields: smtpConfig, to, subject, body"
}
```

Lub podobny błąd SMTP (nie autoryzacji!).

### Jeśli dostaniesz:
```json
{
  "success": false,
  "error": "Unauthorized: Invalid relay secret"
}
```

Problem jest w workerze - sprawdź .env.

---

## Dalej nie działa?

### Zbierz informacje:

```bash
cd ~/smtp-relay-worker

echo "=== VPS INFO ==="
curl ifconfig.me
echo ""

echo "=== WORKER STATUS ==="
pm2 status

echo "=== PORT ==="
cat .env | grep PORT

echo "=== SECRET (first 10) ==="
cat .env | grep RELAY_SECRET | cut -c1-30

echo "=== HEALTH CHECK ==="
curl http://localhost:3005/health

echo "=== LAST LOGS ==="
pm2 logs smtp-relay-worker --lines 20 --nostream
```

Skopiuj output i sprawdź co jest nie tak.
