# Co się zmieniło?

## Problem

Supabase Edge Functions działają na **Deno Deploy**, który **blokuje porty SMTP** (587, 465, 25).

Twoje obecne funkcje próbowały wysyłać emaile bezpośrednio przez SMTP z Edge Functions, co **nie działa**.

## Rozwiązanie

Utworzono **SMTP Relay Worker** - serwer Node.js który działa na VPS i pośredniczy w wysyłaniu emaili.

## Architektura

### PRZED (nie działa):
```
Edge Function → ❌ SMTP (port zablokowany)
```

### PO (działa):
```
Edge Function → HTTP → SMTP Relay Worker → ✅ SMTP
  (Deno Deploy)          (VPS)                (h22.seohost.pl)
```

## Zmiany w kodzie

### 1. Nowy worker: `smtp-relay-worker/`

Utworzono nowy katalog z workerem Node.js:
- `server.js` - główny serwer
- `package.json` - zależności
- `.env.example` - przykładowa konfiguracja
- `README.md` - dokumentacja
- `QUICK_START.md` - szybki start
- `DEPLOYMENT_GUIDE.md` - pełna instrukcja wdrożenia
- `test-relay.sh` - skrypt testowy

### 2. Zaktualizowane Edge Functions

**Zmienione pliki:**
- `supabase/functions/send-email/index.ts`
- `supabase/functions/send-invoice-email/index.ts`
- `supabase/functions/send-offer-email/index.ts`

**Co się zmieniło:**
- Usunięto bezpośrednie wywołania `nodemailer`
- Dodano HTTP request do relay workera
- Funkcje teraz delegują wysyłanie emaili do workera na VPS

### 3. Niezmienione funkcje (działają normalnie)

- `fetch-emails` - czyta z bazy (wypełnianej przez `imap-sync-worker`)
- `generate-contract-pdf` - generuje PDF
- `create-employee` - operacje na bazie
- `create-auth-for-employee` - operacje na auth

## Co musisz zrobić?

### Krok 1: Wgraj worker na VPS

```bash
# Skopiuj katalog smtp-relay-worker na VPS
rsync -avz smtp-relay-worker/ user@your-vps:/home/user/smtp-relay-worker/
```

### Krok 2: Zainstaluj i uruchom

```bash
# Na VPS
cd ~/smtp-relay-worker
npm install

# Skopiuj i edytuj .env
cp .env.example .env
nano .env  # Ustaw PORT=3001 i wygeneruj RELAY_SECRET

# Uruchom przez PM2
npm run pm2:start
```

### Krok 3: Skonfiguruj Supabase

W Supabase Dashboard → Settings → Edge Functions → Environment Variables dodaj:

```
SMTP_RELAY_URL=http://YOUR-VPS-IP:3001
SMTP_RELAY_SECRET=<ten-sam-co-w-.env>
```

### Krok 4: Testuj

```bash
# Na VPS
curl http://localhost:3001/health

# Powinieneś zobaczyć:
# {"status":"ok","service":"smtp-relay-worker",...}
```

Następnie spróbuj wysłać email z CRM.

## Pliki do przejrzenia

1. **`smtp-relay-worker/QUICK_START.md`** - szybki start (5 min)
2. **`smtp-relay-worker/DEPLOYMENT_GUIDE.md`** - pełna instrukcja
3. **`smtp-relay-worker/README.md`** - dokumentacja API

## Korzyści

1. ✅ Funkcje wysyłające emaile **działają**
2. ✅ Wszystkie załączniki **obsługiwane**
3. ✅ Bezpieczna autoryzacja (RELAY_SECRET)
4. ✅ Szczegółowe logowanie
5. ✅ Health check endpoint
6. ✅ Gotowe do PM2 (auto-restart)

## Bezpieczeństwo

- Worker wymaga autoryzacji przez `RELAY_SECRET`
- Możesz ograniczyć firewall tylko do IP Supabase
- Rozważ dodanie nginx z SSL dla HTTPS

## Pytania?

Sprawdź `DEPLOYMENT_GUIDE.md` dla szczegółowej instrukcji wdrożenia.
