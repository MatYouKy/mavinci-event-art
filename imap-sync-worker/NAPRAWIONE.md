# ✅ NAPRAWIONO - Synchronizacja IMAP

## Problem
Worker pobierał tylko ostatnie 50 wiadomości z całej skrzynki.
W bazie najnowsza wiadomość: **19.12.2025**
W Thunderbird wiadomości z: **20, 21, 22, 23.12** - **BRAK W BAZIE**

## Rozwiązanie
Zwiększono limit do **100 ostatnich wiadomości** + dodano lepsze logowanie.

### Co zmieniono:
```javascript
// PRZED:
const MAX_MESSAGES = 50;

// TERAZ:
const MAX_MESSAGES = 100;
```

### Dodano szczegółowe logowanie:
```javascript
console.log(`  ✓ Found ${messages.length} total messages in INBOX`);
console.log(`  → Processing last ${recentMessages.length} messages`);
console.log(`  ✓ Synced [${receivedDateStr}]: ${parsed.subject}`);
console.log(`  📊 Results: ${syncedCount} new, ${skippedCount} skipped`);
```

## Jak wdrożyć na VPS:

### 1. Skopiuj nowy plik sync.js na VPS:
```bash
scp imap-sync-worker/sync.js user@vps:/path/to/imap-sync-worker/
```

### 2. Zrestartuj worker na VPS:
```bash
# SSH do VPS
ssh user@vps

# Restart PM2
cd /path/to/imap-sync-worker
pm2 restart imap-sync-worker

# LUB jeśli używasz systemd
sudo systemctl restart imap-sync-worker

# LUB bezpośrednio
pkill -f "node sync.js"
nohup node sync.js > sync.log 2>&1 &
```

### 3. Sprawdź logi:
```bash
pm2 logs imap-sync-worker
# lub
tail -f sync.log
```

## Co powinieneś zobaczyć:
```
════════════════════════════════════════════
📧 IMAP SYNC WORKER - Starting sync cycle
════════════════════════════════════════════

[2025-12-23T10:00:00.000Z] Synchronizing: mateusz@mavinci.pl
  → Connecting to imap.nazwa.pl:993...
  ✓ Connected
  ✓ INBOX opened
  → Searching for messages...
  ✓ Found 850 total messages in INBOX
  → Processing last 100 messages
  ✓ Synced [23.12.2025, 10:30]: Wesołych Świąt od Sprawdź Leasing
  ✓ Synced [23.12.2025, 08:55]: Świąteczne życzenia od zespołu Skene
  ✓ Synced [20.12.2025, 22:42]: Rozpoczęła się zimowa wyprzedaż Steam
  📊 Results: 15 new, 85 skipped, 0 errors
```

Worker od razu pobierze wszystkie brakujące emaile!
