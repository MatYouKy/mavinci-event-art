# Mavinci CRM - IMAP Sync Worker

Ten worker pobiera emaile z serwerów IMAP i synchronizuje je z bazą danych Supabase, aby były dostępne w CRM.

## Wymagania

- Node.js 16+
- VPS z dostępem do internetu
- Dostęp do Supabase (URL + Service Role Key)

## Instalacja na VPS

### 1. Skopiuj pliki na VPS

```bash
# Skopiuj folder imap-sync-worker na swój VPS
scp -r imap-sync-worker user@your-vps:/path/to/
```

### 2. Zainstaluj zależności

```bash
cd imap-sync-worker
npm install
```

### 3. Konfiguracja

Skopiuj przykładowy plik środowiskowy i uzupełnij:

```bash
cp .env.example .env
nano .env
```

Uzupełnij:
```env
SUPABASE_URL=https://twojprojekt.supabase.co
SUPABASE_SERVICE_ROLE_KEY=twoj_service_role_key
SYNC_INTERVAL_MINUTES=5
MAX_MESSAGES_PER_SYNC=50
```

**Gdzie znaleźć klucze:**
1. Wejdź na https://supabase.com
2. Wybierz swój projekt
3. Idź do Settings → API
4. Skopiuj:
   - Project URL → `SUPABASE_URL`
   - service_role key → `SUPABASE_SERVICE_ROLE_KEY`

### 4. Uruchomienie

#### Testowe uruchomienie:
```bash
npm start
```

Powinieneś zobaczyć:
```
================================================================================
MAVINCI IMAP SYNC WORKER
================================================================================
Supabase URL: https://twojprojekt.supabase.co
Sync interval: 5 minutes
Max messages per sync: 50
================================================================================

[2025-10-13T10:30:00.000Z] Synchronizing: biuro@mavinci.pl
  → Connecting to imap.hostinger.pl:993...
  ✓ Connected
  ✓ INBOX opened
  → Searching for messages...
  ✓ Found 150 messages
  ✓ Synced: Zapytanie o ofertę
  ✓ Synced: Potwierdzenie rezerwacji

  Summary for biuro@mavinci.pl:
    • New messages synced: 2
    • Already in database: 48
    • Errors: 0
```

## Uruchomienie jako Service (Daemon)

### Używając PM2 (Zalecane)

```bash
# Zainstaluj PM2 globalnie
npm install -g pm2

# Uruchom worker
pm2 start sync.js --name mavinci-imap-sync

# Dodaj do autostartu (po restarcie VPS)
pm2 startup
pm2 save

# Sprawdź status
pm2 status

# Zobacz logi
pm2 logs mavinci-imap-sync

# Restart
pm2 restart mavinci-imap-sync

# Stop
pm2 stop mavinci-imap-sync
```

### Używając systemd (Ubuntu/Debian)

Stwórz plik `/etc/systemd/system/mavinci-imap-sync.service`:

```ini
[Unit]
Description=Mavinci IMAP Sync Worker
After=network.target

[Service]
Type=simple
User=twoj-user
WorkingDirectory=/path/to/imap-sync-worker
ExecStart=/usr/bin/node sync.js
Restart=always
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

Uruchom:
```bash
sudo systemctl enable mavinci-imap-sync
sudo systemctl start mavinci-imap-sync
sudo systemctl status mavinci-imap-sync

# Zobacz logi
sudo journalctl -u mavinci-imap-sync -f
```

## Konfiguracja

### Częstotliwość synchronizacji

Edytuj `.env`:
```env
# Synchronizuj co 2 minuty
SYNC_INTERVAL_MINUTES=2

# Synchronizuj co 10 minut
SYNC_INTERVAL_MINUTES=10
```

### Limit wiadomości

```env
# Pobierz tylko 20 najnowszych
MAX_MESSAGES_PER_SYNC=20

# Pobierz 100 najnowszych
MAX_MESSAGES_PER_SYNC=100
```

## Monitoring

### Sprawdź czy działa

W bazie danych:
```sql
SELECT
  email_address,
  last_sync_at,
  last_sync_status,
  last_sync_error
FROM employee_email_accounts
WHERE is_active = true;
```

### Sprawdź zsynchronizowane emaile

```sql
SELECT
  from_address,
  subject,
  received_date,
  fetched_at
FROM received_emails
ORDER BY fetched_at DESC
LIMIT 10;
```

## Rozwiązywanie Problemów

### Problem: "Error: Connection timeout"

Sprawdź firewall na VPS:
```bash
# Pozwól na połączenia IMAP (port 993)
sudo ufw allow 993/tcp

# Lub odblokuj wszystkie wychodzące
sudo ufw allow out on eth0
```

### Problem: "Authentication failed"

- Sprawdź login i hasło w tabeli `employee_email_accounts`
- Niektóre serwery wymagają "hasła aplikacji" (Gmail, Outlook)
- Sprawdź czy włączony jest IMAP w ustawieniach konta email

### Problem: "Too many connections"

Niektóre serwery limitują połączenia. Zmniejsz częstotliwość:
```env
SYNC_INTERVAL_MINUTES=10
```

### Problem: Worker się zatrzymuje

Użyj PM2 który automatycznie restartuje:
```bash
pm2 start sync.js --name mavinci-imap-sync --restart-delay=3000
```

## Logs

PM2:
```bash
pm2 logs mavinci-imap-sync
pm2 logs mavinci-imap-sync --lines 100
```

Systemd:
```bash
journalctl -u mavinci-imap-sync -f
journalctl -u mavinci-imap-sync --since "1 hour ago"
```

## Diagnoza: "No active email accounts found"

Jeśli worker pokazuje ten błąd, uruchom skrypt diagnostyczny:

```bash
node check-accounts.js
```

### Możliwe przyczyny:

**1. Brak kont w bazie danych**
- Dodaj konto w CRM: Pracownicy → Twój profil → Konta Email

**2. Konto nie jest aktywne (`is_active = false`)**

Uruchom w Supabase SQL Editor:
```sql
-- Zobacz wszystkie konta
SELECT email_address, is_active FROM employee_email_accounts;

-- Aktywuj wszystkie konta
UPDATE employee_email_accounts SET is_active = true;
```

**3. Zły klucz API**
- Sprawdź czy w `.env` używasz **service_role** key (nie anon!)
- Znajdziesz go w: Supabase Dashboard → Settings → API

**4. Problem z RLS (Row Level Security)**

Dodaj politykę dla service_role w SQL Editor:
```sql
-- Najpierw usuń starą politykę jeśli istnieje
DROP POLICY IF EXISTS "Service role bypass RLS" ON employee_email_accounts;

-- Dodaj nową politykę
CREATE POLICY "Service role bypass RLS"
  ON employee_email_accounts
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
```

Po naprawie zrestartuj workera:
```bash
pm2 restart mavinci-imap-sync
```

## Testowanie

Wyślij email testowy na skonfigurowane konto i poczekaj maksymalnie `SYNC_INTERVAL_MINUTES` minut.

W CRM:
1. Idź do **Wiadomości**
2. Wybierz konto email z listy
3. Sprawdź czy pojawił się nowy email

## Bezpieczeństwo

- **Nie commituj pliku `.env` do git!**
- Service Role Key ma pełne uprawnienia - trzymaj go w tajemnicy
- Zalecamy uruchomienie workera jako dedykowany user (nie root)
- Rozważ VPN między VPS a Supabase w produkcji

## Aktualizacje

```bash
# Zatrzymaj service
pm2 stop mavinci-imap-sync

# Pobierz nową wersję (git pull lub scp)
git pull

# Zainstaluj nowe zależności
npm install

# Restart
pm2 restart mavinci-imap-sync
```
