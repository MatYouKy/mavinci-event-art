# IMAP Email Synchronization Setup

## Problem

Supabase Edge Functions (Deno) **nie obsługują bibliotek IMAP** z Node.js. Biblioteki takie jak `imap`, `imap-simple` wymagają natywnych modułów Node.js, które nie działają w środowisku Deno Runtime.

## Rozwiązanie

Aby pobierać emaile przez IMAP, potrzebujesz **zewnętrznego workera Node.js**, który będzie:

1. Łączył się z serwerem IMAP
2. Pobierał nowe emaile
3. Zapisywał je do tabeli `received_emails` w Supabase

## Opcje Implementacji

### Opcja 1: Prosty Node.js Worker (Zalecane)

Stwórz osobny projekt Node.js:

```bash
mkdir imap-sync-worker
cd imap-sync-worker
npm init -y
npm install @supabase/supabase-js imap-simple mailparser dotenv
```

Utwórz plik `sync.js`:

```javascript
const imapSimple = require('imap-simple');
const { simpleParser } = require('mailparser');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function syncAccount(accountId) {
  // Pobierz konfigurację konta
  const { data: account } = await supabase
    .from('employee_email_accounts')
    .select('*')
    .eq('id', accountId)
    .single();

  if (!account) return;

  // Połącz z IMAP
  const connection = await imapSimple.connect({
    imap: {
      user: account.imap_username,
      password: account.imap_password,
      host: account.imap_host,
      port: account.imap_port,
      tls: account.imap_use_ssl,
      tlsOptions: { rejectUnauthorized: false },
    },
  });

  await connection.openBox('INBOX');

  // Pobierz nowe wiadomości (ostatnie 50)
  const messages = await connection.search(['ALL'], {
    bodies: ['HEADER', 'TEXT', ''],
    markSeen: false,
  });

  console.log(`Found ${messages.length} messages`);

  for (const item of messages.slice(-50)) {
    const all = item.parts.find((part) => part.which === '');
    if (!all) continue;

    try {
      const parsed = await simpleParser(all.body);

      // Zapisz do bazy (upsert aby uniknąć duplikatów)
      await supabase.from('received_emails').upsert(
        {
          email_account_id: accountId,
          message_id: parsed.messageId || `${Date.now()}-${Math.random()}`,
          from_address: parsed.from?.text || '',
          to_address: parsed.to?.text || '',
          subject: parsed.subject || '(No subject)',
          body_text: parsed.text || '',
          body_html: parsed.html || '',
          received_date: parsed.date || new Date(),
          has_attachments: parsed.attachments && parsed.attachments.length > 0,
          raw_headers: parsed.headers || {},
        },
        {
          onConflict: 'email_account_id,message_id',
        },
      );

      console.log(`Synced: ${parsed.subject}`);
    } catch (err) {
      console.error('Parse error:', err);
    }
  }

  connection.end();
}

async function syncAll() {
  // Pobierz wszystkie aktywne konta
  const { data: accounts } = await supabase
    .from('employee_email_accounts')
    .select('id')
    .eq('is_active', true);

  for (const account of accounts || []) {
    try {
      await syncAccount(account.id);
    } catch (err) {
      console.error(`Error syncing account ${account.id}:`, err);
    }
  }
}

// Uruchom synchronizację co 5 minut
syncAll();
setInterval(syncAll, 5 * 60 * 1000);
```

Utwórz `.env`:

```
SUPABASE_URL=twoj-url
SUPABASE_SERVICE_ROLE_KEY=twoj-klucz
```

Uruchom:

```bash
node sync.js
```

### Opcja 2: Scheduled Function (Cron Job)

Deploy workera jako:

- **Vercel Cron** (jeśli używasz Vercel)
- **Railway** (prosty hosting dla Node.js)
- **DigitalOcean App Platform**
- **AWS Lambda** z EventBridge

### Opcja 3: Zapier / Make.com

Użyj gotowej integracji no-code:

1. Trigger: "New Email" (IMAP)
2. Action: "Create Row" in Supabase (`received_emails`)

## Konfiguracja w CRM

Po uruchomieniu workera, CRM automatycznie będzie pokazywał:

1. **Wiadomości z formularza** (`contact_messages`)
2. **Odebrane emaile** (`received_emails`) - zsynchronizowane przez workera
3. **Wysłane emaile** (`sent_emails`) - wysłane przez CRM

## Testowanie

Sprawdź czy emaile są synchronizowane:

```sql
SELECT
  from_address,
  subject,
  received_date,
  fetched_at
FROM received_emails
ORDER BY received_date DESC
LIMIT 10;
```

## Alternatywy

Jeśli nie chcesz utrzymywać osobnego workera:

1. **Gmail API** - wymaga OAuth2, ale działa przez HTTPS
2. **Microsoft Graph API** - dla kont Outlook/Office365
3. **Email Forwarding** - przekieruj emaile na webhook który zapisze do bazy
4. **Mailgun/SendGrid Inbound** - odbieraj emaile przez webhook

## Następne Kroki

1. Wybierz metodę synchronizacji
2. Uruchom workera lub skonfiguruj automatyzację
3. Sprawdź tabelę `received_emails`
4. CRM automatycznie pokaże nowe wiadomości
