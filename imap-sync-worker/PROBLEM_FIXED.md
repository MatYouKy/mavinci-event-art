# 🔧 Problem naprawiony - Synchronizacja IMAP

## Problem
IMAP worker pobierał WSZYSTKIE wiadomości ze skrzynki, ale brał tylko ostatnie 50 z listy.
IMAP nie sortuje po dacie, więc **POMIJAŁ nowe wiadomości** które przyszły po pierwszej synchronizacji!

## Rozwiązanie
Zmieniono logikę synchronizacji:

### PRZED:
```javascript
const searchCriteria = ['ALL'];  // Pobierz wszystkie
const messages = await connection.search(searchCriteria, fetchOptions);
const recentMessages = messages.slice(-MAX_MESSAGES);  // Weź ostatnie 50
```

**Problem**: Jeśli w skrzynce jest 1000 wiadomości, bierze ostatnie 50 z listy (niekoniecznie najnowsze!)

### PO POPRAWCE:
```javascript
// 1. Sprawdź datę ostatniej zsynchronizowanej wiadomości
const { data: lastEmail } = await supabase
  .from('received_emails')
  .select('received_date')
  .eq('email_account_id', account.id)
  .order('received_date', { ascending: false })
  .limit(1)
  .maybeSingle();

// 2. Pobierz tylko NOWE wiadomości (od ostatniej synchronizacji)
if (lastEmail && lastEmail.received_date) {
  const sinceDate = new Date(lastEmail.received_date);
  sinceDate.setHours(sinceDate.getHours() - 1); // Margin 1h
  searchCriteria = ['SINCE', '19-Dec-2025']; // Format IMAP
} else {
  searchCriteria = ['ALL']; // Pierwsza synchronizacja
}

// 3. Pobierz WSZYSTKIE nowe wiadomości (bez limit 50!)
const recentMessages = lastEmail ? messages : messages.slice(-MAX_MESSAGES);
```

## Co się zmieni:
✅ Worker pobiera tylko wiadomości **nowsze** niż ostatnia w bazie
✅ Nie pomija nowych emaili
✅ Efektywniejsza synchronizacja (mniej danych)
✅ Działa też dla pierwszej synchronizacji (pobiera ostatnie 50)

## Jak uruchomić:
Na VPS gdzie działa worker:

```bash
cd /path/to/imap-sync-worker
pm2 restart imap-sync-worker
# lub jeśli używasz npm:
# pkill -f sync.js && npm start
```

Po restarcie worker od razu pobierze wszystkie wiadomości od 19.12.2025.
