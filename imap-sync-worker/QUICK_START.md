# Quick Start - IMAP Email Sync Worker

## Dlaczego odebrane emaile nie działają?

Supabase Edge Functions (Deno) **nie obsługują bibliotek IMAP** z Node.js. Dlatego potrzebujesz **osobnego workera Node.js**, który będzie pobierał emaile i zapisywał je do bazy danych.

## Jak uruchomić?

### 1. Skonfiguruj konto email w CRM

Przed uruchomieniem workera, dodaj konto email w CRM:

1. Zaloguj się do CRM
2. Przejdź do: **Pracownicy** → Twój profil → **Konta Email**
3. Dodaj nowe konto email z danymi IMAP:
   - Adres email
   - Host IMAP (np. `imap.gmail.com`)
   - Port IMAP (zwykle `993` dla SSL)
   - Nazwa użytkownika (zwykle Twój email)
   - Hasło (dla Gmaila użyj **App Password**)

### 2. Zainstaluj zależności

```bash
cd imap-sync-worker
npm install
```

### 3. Skonfiguruj zmienne środowiskowe

Skopiuj `.env.example` do `.env`:

```bash
cp .env.example .env
```

Edytuj `.env` i uzupełnij:

```env
SUPABASE_URL=https://twoj-projekt.supabase.co
SUPABASE_SERVICE_ROLE_KEY=twoj-service-role-key

# Opcjonalne - domyślnie 5 minut
SYNC_INTERVAL_MINUTES=5
MAX_MESSAGES_PER_SYNC=50
```

Znajdziesz klucze w:
- **Supabase Dashboard** → Settings → API
- Użyj `service_role` key (nie `anon` key!)

### 4. Testuj połączenie

Przed uruchomieniem workera, przetestuj połączenie:

```bash
node test-connection.js
```

Jeśli test się powiedzie, zobaczysz:

```
✓ ALL TESTS PASSED!
Your IMAP configuration is correct.
You can now run the sync worker with: node sync.js
```

### 5. Uruchom workera

```bash
node sync.js
```

Worker będzie działał w tle i co 5 minut synchronizował emaile.

## Typowe problemy

### Problem: AUTHENTICATIONFAILED

**Rozwiązanie:**
- **Gmail:** Użyj [App Password](https://myaccount.google.com/apppasswords) zamiast hasła
- **Outlook/Office365:** Włącz IMAP w ustawieniach konta
- Sprawdź czy IMAP jest włączony w ustawieniach konta email

### Problem: ETIMEDOUT / ECONNREFUSED

**Rozwiązanie:**
- Sprawdź host i port IMAP
- Standardowe porty:
  - **993** - IMAP z SSL (zalecane)
  - **143** - IMAP bez SSL
- Sprawdź firewall

### Problem: No active email accounts found

**Rozwiązanie:**
- Dodaj konto email w CRM (patrz krok 1)
- Upewnij się, że konto jest aktywne (`is_active = true`)

## Jak uruchomić na serwerze?

### Opcja 1: PM2 (zalecane)

```bash
npm install -g pm2
pm2 start sync.js --name "imap-sync"
pm2 save
pm2 startup
```

### Opcja 2: Systemd Service

Utwórz `/etc/systemd/system/imap-sync.service`:

```ini
[Unit]
Description=IMAP Email Sync Worker
After=network.target

[Service]
Type=simple
User=your-user
WorkingDirectory=/path/to/imap-sync-worker
ExecStart=/usr/bin/node sync.js
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable imap-sync
sudo systemctl start imap-sync
sudo systemctl status imap-sync
```

### Opcja 3: Docker

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY . .
CMD ["node", "sync.js"]
```

```bash
docker build -t imap-sync .
docker run -d --name imap-sync --env-file .env imap-sync
```

## Sprawdzanie czy działa

### 1. Logi workera

Worker pokazuje szczegółowe logi:

```
================================================================================
IMAP SYNC STARTED: 2025-10-15T12:00:00.000Z
================================================================================

Found 1 active email account(s)

[2025-10-15T12:00:00.000Z] Synchronizing: jan@mavinci.pl
  → Connecting to imap.gmail.com:993...
  ✓ Connected
  ✓ INBOX opened
  → Searching for messages...
  ✓ Found 150 messages
  ✓ Synced: Nowa oferta od klienta
  ✓ Synced: Potwierdzenie spotkania

  Summary for jan@mavinci.pl:
    • New messages synced: 10
    • Already in database: 40
    • Errors: 0

================================================================================
SYNC COMPLETED
  • Total messages synced: 10
  • Total errors: 0
  • Next sync in 5 minutes
================================================================================
```

### 2. Sprawdź w bazie danych

W Supabase SQL Editor:

```sql
SELECT
  from_address,
  subject,
  received_date,
  is_read
FROM received_emails
ORDER BY received_date DESC
LIMIT 10;
```

### 3. Sprawdź w CRM

1. Zaloguj się do CRM
2. Przejdź do: **Wiadomości**
3. Wybierz swoje konto email z listy
4. Powinny pojawić się zsynchronizowane emaile

## Alternatywy (jeśli nie chcesz uruchamiać workera)

### 1. Email Forwarding + Webhook

Skonfiguruj przekierowanie emaili na webhook:

```javascript
// Dodaj Edge Function: receive-email
Deno.serve(async (req) => {
  const { from, subject, body } = await req.json();

  await supabase.from('received_emails').insert({
    from_address: from,
    subject: subject,
    body_text: body,
    // ...
  });

  return new Response('OK');
});
```

### 2. Gmail API / Microsoft Graph API

Użyj oficjalnych API zamiast IMAP (wymaga OAuth2).

### 3. Zapier / Make.com

Automatyzacja no-code:
- Trigger: "New Email" (Gmail/Outlook)
- Action: "Create Row" w Supabase

## Wsparcie

Jeśli masz problemy:

1. Uruchom `node test-connection.js` i sprawdź błędy
2. Sprawdź logi workera
3. Sprawdź tabelę `employee_email_accounts` w Supabase
4. Sprawdź czy kolumna `last_sync_status` pokazuje błąd
