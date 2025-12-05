# Napraw "Unauthorized: Invalid relay secret"

## Problem

Worker dostaje requesty z Edge Function, ale sekret autoryzacyjny się nie zgadza.

## Rozwiązanie Krok po Kroku

### Krok 1: Sprawdź sekret na VPS

Na VPS uruchom:

```bash
cd ~/smtp-relay-worker
./check-config.sh
```

**Jeśli nie masz `check-config.sh`, uruchom to:**

```bash
cat .env | grep RELAY_SECRET
```

Skopiuj wartość (np. `abc123def456...`).

### Krok 2: Sprawdź zmienne w Supabase

1. Idź do **Supabase Dashboard**
2. Wybierz swój projekt
3. **Settings** → **Edge Functions** → **Environment Variables**
4. Znajdź `SMTP_RELAY_SECRET`

### Krok 3: Porównaj sekrety

**Na VPS (z .env):**
```
RELAY_SECRET=abc123def456...
```

**W Supabase (SMTP_RELAY_SECRET):**
```
abc123def456...
```

**MUSZĄ BYĆ IDENTYCZNE!**

### Krok 4: Jeśli się różnią - napraw

#### Opcja A: Zmień w Supabase (zalecane)

1. W Supabase Dashboard edytuj `SMTP_RELAY_SECRET`
2. Wklej **dokładnie** wartość z `.env` na VPS
3. Zapisz
4. **Poczekaj 30-60 sekund** aż się załaduje

#### Opcja B: Zmień na VPS

1. Na VPS:
```bash
cd ~/smtp-relay-worker
nano .env
```

2. Zmień `RELAY_SECRET` na taki sam jak w Supabase

3. Zapisz (Ctrl+O, Enter, Ctrl+X)

4. Restart workera:
```bash
npm run pm2:restart
```

### Krok 5: Sprawdź także SMTP_RELAY_URL

W Supabase upewnij się że masz:

**Zmienna 1:**
```
Name: SMTP_RELAY_URL
Value: http://YOUR-VPS-IP:3001
```

**Zmienna 2:**
```
Name: SMTP_RELAY_SECRET
Value: <dokładnie-taki-jak-w-.env>
```

### Krok 6: Testuj

1. Poczekaj 1 minutę (zmienne w Supabase potrzebują czasu)
2. Spróbuj wysłać email z CRM
3. Sprawdź logi na VPS:

```bash
pm2 logs smtp-relay-worker
```

Powinieneś zobaczyć:
```
📧 [2025-12-05...] Sending email to: recipient@example.com
✅ Email sent successfully. MessageId: ...
```

## Częste Błędy

### ❌ Spacje na końcu sekretu

```bash
# ZŁE (spacja na końcu)
RELAY_SECRET=abc123def456

# DOBRE (bez spacji)
RELAY_SECRET=abc123def456
```

### ❌ Enter w środku sekretu

```bash
# ZŁE (multi-line)
RELAY_SECRET=abc123
def456

# DOBRE (jedna linia)
RELAY_SECRET=abc123def456
```

### ❌ Cudzysłowy

```bash
# ZŁE (z cudzysłowami)
RELAY_SECRET="abc123def456"

# DOBRE (bez cudzysłowów)
RELAY_SECRET=abc123def456
```

## Quick Fix - Wygeneruj nowy sekret dla obu

### Na VPS:

```bash
# Wygeneruj nowy
NEW_SECRET=$(openssl rand -hex 32)
echo "Nowy sekret: $NEW_SECRET"

# Zastąp w .env
cd ~/smtp-relay-worker
sed -i "s/RELAY_SECRET=.*/RELAY_SECRET=$NEW_SECRET/" .env

# Restart
npm run pm2:restart

# Pokaż sekret do skopiowania
cat .env | grep RELAY_SECRET
```

### W Supabase:

1. Skopiuj nowy sekret z outputu powyżej
2. Settings → Edge Functions → Environment Variables
3. Edytuj `SMTP_RELAY_SECRET`
4. Wklej nowy sekret
5. Zapisz
6. Poczekaj 1 minutę

## Weryfikacja

### Test autoryzacji:

```bash
# Na VPS
source .env
curl -X POST http://localhost:3001/api/send-email \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $RELAY_SECRET" \
  -d '{"test": "data"}'
```

**Jeśli działa lokalnie**, problem jest w Supabase.

**Powinieneś zobaczyć:**
```json
{"success":false,"error":"Missing required fields: smtpConfig, to, subject, body"}
```

To jest OK! (błąd o brakujących polach, nie o autoryzacji)

**NIE powinieneś zobaczyć:**
```json
{"success":false,"error":"Unauthorized: Invalid relay secret"}
```

## Dalej nie działa?

Sprawdź logi workera w czasie rzeczywistym:

```bash
pm2 logs smtp-relay-worker --lines 100
```

Wyślij email z CRM i patrz na logi. Powinieneś zobaczyć request przychodzący.

Jeśli nie widzisz requestów:
- Sprawdź `SMTP_RELAY_URL` w Supabase (czy wskazuje na prawidłowe IP)
- Sprawdź firewall na VPS
- Sprawdź czy worker działa: `pm2 status`
