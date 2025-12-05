# 📋 Quick Reference

## Podstawowe komendy

### Status workera
```bash
pm2 status
```

### Logi (na żywo)
```bash
pm2 logs smtp-relay-worker
```

### Logi (ostatnie 50 linii)
```bash
pm2 logs smtp-relay-worker --lines 50 --nostream
```

### Restart
```bash
pm2 restart smtp-relay-worker
```

### Start
```bash
npm run pm2:start
```

### Stop
```bash
pm2 stop smtp-relay-worker
```

---

## Diagnostyka

### Test workera lokalnie
```bash
./test-local.sh
```

### Porównaj sekrety
```bash
./compare-secrets.sh
```

### Sprawdź konfigurację
```bash
./check-config.sh
```

### Sprawdź IP VPS
```bash
curl ifconfig.me
```

### Test portu
```bash
curl http://localhost:3005/health
```

---

## Konfiguracja Supabase

### Edge Functions → Environment Variables

**SMTP_RELAY_URL:**
```
http://TWOJE-IP:3005
```

**SMTP_RELAY_SECRET:**
```
<sekret-z-.env-na-vps>
```

### Jak sprawdzić IP?
```bash
curl ifconfig.me
```

### Jak sprawdzić sekret?
```bash
cd ~/smtp-relay-worker
cat .env | grep RELAY_SECRET
```

---

## Struktura plików

```
smtp-relay-worker/
├── server.js              # Główny serwer
├── package.json           # Zależności
├── .env                   # Konfiguracja (PORT, RELAY_SECRET)
├── ecosystem.config.js    # Konfiguracja PM2
│
├── README.md              # Dokumentacja główna
├── QUICK_START.md         # Szybki start
├── CHECKLIST.md           # Checklist konfiguracji
├── TROUBLESHOOTING.md     # Rozwiązywanie problemów
├── QUICK_REFERENCE.md     # To co czytasz
│
├── test-local.sh          # Test workera lokalnie
├── compare-secrets.sh     # Porównaj sekrety
└── check-config.sh        # Sprawdź konfigurację
```

---

## Częste problemy → Szybkie rozwiązania

### ❌ "Unauthorized: Invalid relay secret"
```bash
./compare-secrets.sh
# Skopiuj sekret i wklej do Supabase
```

### ❌ "SMTP_RELAY_URL not configured"
```bash
# W Supabase dodaj:
# SMTP_RELAY_URL = http://$(curl -s ifconfig.me):3005
```

### ❌ Worker nie odpowiada
```bash
pm2 restart smtp-relay-worker
pm2 logs smtp-relay-worker
```

### ❌ Port zajęty
```bash
lsof -i :3005
# Zmień PORT w .env lub zabij proces
```

### ❌ SMTP timeout
```bash
# Sprawdź firewall VPS
sudo ufw allow 587/tcp
sudo ufw allow 465/tcp
sudo ufw reload
```

---

## Ścieżki

### Worker na VPS
```
~/smtp-relay-worker/
```

### Logi PM2
```
~/.pm2/logs/smtp-relay-worker-out.log
~/.pm2/logs/smtp-relay-worker-error.log
```

---

## Zmienne środowiskowe

### Na VPS (.env)
```bash
PORT=3005
RELAY_SECRET=<64-znakowy-hex>
```

### W Supabase (Edge Functions)
```
SMTP_RELAY_URL=http://IP:3005
SMTP_RELAY_SECRET=<ten-sam-co-na-vps>
```

---

## Przydatne komendy systemowe

### Sprawdź co używa portu
```bash
lsof -i :3005
```

### Kill proces na porcie
```bash
lsof -ti :3005 | xargs kill -9
```

### Firewall - dodaj port
```bash
sudo ufw allow 3005/tcp
sudo ufw reload
```

### Firewall - status
```bash
sudo ufw status numbered
```

---

## Edge Functions które używają workera

1. `send-email` - Ogólna funkcja wysyłania emaili
2. `send-invoice-email` - Wysyłanie faktur
3. `send-offer-email` - Wysyłanie ofert

Wszystkie wymagają:
- `SMTP_RELAY_URL`
- `SMTP_RELAY_SECRET`

---

## Monitorowanie

### Real-time monitoring
```bash
pm2 monit
```

### Metryki
```bash
pm2 describe smtp-relay-worker
```

### Restart na crash
```bash
pm2 startup
pm2 save
```

---

## Aktualizacja workera

```bash
cd ~/smtp-relay-worker

# 1. Zatrzymaj
pm2 stop smtp-relay-worker

# 2. Aktualizuj kod (np. git pull)
# git pull origin main

# 3. Zainstaluj zależności
npm install

# 4. Uruchom
pm2 restart smtp-relay-worker

# 5. Sprawdź
pm2 logs smtp-relay-worker --lines 20
```

---

## Backup konfiguracji

```bash
# Backup .env
cp .env .env.backup

# Restore .env
cp .env.backup .env
pm2 restart smtp-relay-worker
```

---

## Wygeneruj nowy sekret

```bash
# Generuj
openssl rand -hex 32

# Lub automatycznie zaktualizuj
NEW_SECRET=$(openssl rand -hex 32)
echo "RELAY_SECRET=$NEW_SECRET" > .env.tmp
echo "PORT=3005" >> .env.tmp
mv .env.tmp .env
pm2 restart smtp-relay-worker
echo "Nowy sekret: $NEW_SECRET"
```

Pamiętaj aby zaktualizować także w Supabase!
