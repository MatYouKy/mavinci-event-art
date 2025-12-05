# 🔍 Debug Flow - Jak zdiagnozować problem?

## 🎯 Pytanie 1: Czy worker w ogóle działa?

```bash
pm2 status
```

### ✅ Widzisz "online"?
→ Przejdź do **Pytanie 2**

### ❌ Widzisz "stopped" lub "errored"?
```bash
# Start workera
npm run pm2:start

# Sprawdź logi błędów
pm2 logs smtp-relay-worker --err --lines 50
```

**Najczęstsze błędy:**
- `RELAY_SECRET is required` → Brak .env
- `EADDRINUSE` → Port zajęty (zmień PORT w .env)
- `Cannot find module` → Uruchom `npm install`

---

## 🎯 Pytanie 2: Czy worker odpowiada na localhost?

```bash
curl http://localhost:3005/health
```

### ✅ Dostajesz `{"status":"ok"...}`?
→ Przejdź do **Pytanie 3**

### ❌ Connection refused?
```bash
# Sprawdź port w .env
cat .env | grep PORT

# Sprawdź co słucha na porcie
lsof -i :3005

# Restart
pm2 restart smtp-relay-worker
```

---

## 🎯 Pytanie 3: Czy autoryzacja działa lokalnie?

```bash
./test-local.sh
```

### ✅ Widzisz "✅ Autoryzacja działa!"?
→ Przejdź do **Pytanie 4**

### ❌ "❌ Błąd autoryzacji!"?
```bash
# Sprawdź sekret
cat .env | grep RELAY_SECRET

# Sprawdź logi
pm2 logs smtp-relay-worker --lines 30
```

**Szukaj w logach:**
```
🔐 Authorization check:
   Received header: Bearer abc...
   Expected: Bearer xyz...
❌ Secret mismatch
```

Jeśli sekrety się różnią → problem w workerze (.env).

---

## 🎯 Pytanie 4: Czy zmienne w Supabase są ustawione?

W Supabase Dashboard:
```
Settings → Edge Functions → Environment Variables
```

**Sprawdź:**
1. `SMTP_RELAY_URL` - czy istnieje?
2. `SMTP_RELAY_SECRET` - czy istnieje?

### ✅ Obie istnieją?
→ Przejdź do **Pytanie 5**

### ❌ Brak którejś?
Dodaj:
```
Name: SMTP_RELAY_URL
Value: http://TWOJE-IP:3005
```

```
Name: SMTP_RELAY_SECRET
Value: <sekret-z-.env>
```

**Sprawdź IP:**
```bash
curl ifconfig.me
```

**Sprawdź sekret:**
```bash
cd ~/smtp-relay-worker
cat .env | grep RELAY_SECRET
```

---

## 🎯 Pytanie 5: Czy sekrety się zgadzają?

### Na VPS:
```bash
./compare-secrets.sh
```

Skopiuj **cały** sekret.

### W Supabase:
Settings → Edge Functions → Environment Variables → SMTP_RELAY_SECRET

**Porównaj znak po znaku!**

### ✅ Są identyczne?
→ Przejdź do **Pytanie 6**

### ❌ Się różnią?
**Opcja A:** Zmień w Supabase (wklej ten z VPS)
**Opcja B:** Zmień na VPS (wygeneruj nowy i wklej do obu miejsc)

```bash
# Wygeneruj nowy
NEW_SECRET=$(openssl rand -hex 32)
echo "RELAY_SECRET=$NEW_SECRET" > .env.tmp
echo "PORT=3005" >> .env.tmp
mv .env.tmp .env
pm2 restart smtp-relay-worker
echo "Nowy sekret do Supabase: $NEW_SECRET"
```

**POCZEKAJ 60-90 SEKUND** po zmianie w Supabase!

---

## 🎯 Pytanie 6: Czy firewall przepuszcza ruch?

```bash
# Sprawdź firewall
sudo ufw status

# Dodaj port jeśli trzeba
sudo ufw allow 3005/tcp
sudo ufw reload
```

### Test z zewnątrz:
```bash
# Na INNYM komputerze
curl http://TWOJE-IP-VPS:3005/health
```

### ✅ Działa?
→ Przejdź do **Pytanie 7**

### ❌ Timeout?
- Sprawdź firewall VPS
- Sprawdź firewall providera (np. DigitalOcean, AWS Security Groups)
- Sprawdź czy IP w Supabase jest prawidłowy

---

## 🎯 Pytanie 7: Czy requesty docierają do workera?

### Włącz logi w czasie rzeczywistym:
```bash
pm2 logs smtp-relay-worker --lines 0
```

### Wyślij testowy email z CRM

**Co powinieneś zobaczyć:**
```
🔐 Authorization check:
   Received header: Bearer abc123...
   Expected: Bearer abc123...
✅ Authorization successful
📧 [2025-12-05...] Sending email to: test@example.com
```

### ✅ Widzisz to?
→ Worker działa! Przejdź do **Pytanie 8**

### ❌ Nic nie widzisz?
Requesty nie docierają. Sprawdź:

1. **Edge Function logi w Supabase:**
   - Edge Functions → send-email → Logs
   - Szukaj błędów connect/timeout

2. **SMTP_RELAY_URL:**
   ```bash
   echo "Powinno być: http://$(curl -s ifconfig.me):3005"
   ```
   Porównaj z wartością w Supabase.

3. **Test curl z zewnątrz:**
   ```bash
   # Na innym komputerze
   curl http://TWOJE-IP:3005/health
   ```

---

## 🎯 Pytanie 8: Czy SMTP się łączy?

Szukaj w logach:
```
🔌 Verifying SMTP connection...
✅ SMTP connection verified
```

### ✅ Widzisz to?
→ Wszystko działa! Email powinien być wysłany.

### ❌ Widzisz błąd SMTP?

**Możliwe błędy:**

#### "ECONNREFUSED"
```
❌ SMTP verification failed: connect ECONNREFUSED
```
- Zły host/port SMTP
- VPS nie może się połączyć ze SMTP serverem
- Firewall blokuje port 587/465

**Test:**
```bash
telnet smtp.example.com 587
```

#### "Invalid login"
```
❌ SMTP verification failed: Invalid login: 535 Authentication failed
```
- Zły username/password w bazie
- Sprawdź w CRM: ustawienia → email accounts

#### "Timeout"
```
❌ SMTP verification failed: Timeout
```
- Firewall VPS blokuje porty 587/465
```bash
sudo ufw allow 587/tcp
sudo ufw allow 465/tcp
sudo ufw reload
```

---

## 📊 Quick Check - Wszystko na raz

```bash
cd ~/smtp-relay-worker

echo "=== 1. Status PM2 ==="
pm2 status | grep smtp-relay

echo ""
echo "=== 2. Health Check ==="
curl -s http://localhost:3005/health | head -c 100

echo ""
echo "=== 3. Port ==="
cat .env | grep PORT

echo ""
echo "=== 4. Sekret (10 znaków) ==="
cat .env | grep RELAY_SECRET | head -c 30

echo ""
echo "=== 5. IP VPS ==="
curl -s ifconfig.me

echo ""
echo "=== 6. Firewall ==="
sudo ufw status | grep 3005

echo ""
echo "=== 7. Test autoryzacji ==="
./test-local.sh 2>&1 | tail -10

echo ""
echo "=== 8. Ostatnie logi ==="
pm2 logs smtp-relay-worker --nostream --lines 10
```

---

## 🎓 Najczęstsze scenariusze

### Scenario A: "Błąd autoryzacji"
```
1. ./compare-secrets.sh
2. Skopiuj sekret
3. Wklej do Supabase (SMTP_RELAY_SECRET)
4. Poczekaj 90 sekund
5. Restart workera: pm2 restart smtp-relay-worker
```

### Scenario B: "Connection timeout"
```
1. Sprawdź IP: curl ifconfig.me
2. Sprawdź SMTP_RELAY_URL w Supabase
3. Sprawdź firewall: sudo ufw allow 3005/tcp
4. Test: curl http://localhost:3005/health
```

### Scenario C: "Worker offline"
```
1. pm2 logs smtp-relay-worker --err --lines 50
2. Fix błąd (brak .env, port zajęty, etc.)
3. npm run pm2:start
4. pm2 status
```

### Scenario D: "SMTP nie działa"
```
1. Sprawdź dane w CRM (Settings → Email accounts)
2. Test SMTP: telnet smtp.example.com 587
3. Sprawdź firewall: sudo ufw allow 587/tcp
4. Sprawdź logi: pm2 logs smtp-relay-worker
```
