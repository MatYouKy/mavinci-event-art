# ✅ Sprawdź zmienne w Supabase

## Edge Function oczekuje DOKŁADNIE tych nazw:

### Zmienna 1: SMTP_RELAY_URL
```
Name:  SMTP_RELAY_URL
Value: http://TWOJE-IP:3005
```

**Przykład:**
```
http://123.45.67.89:3005
```

### Zmienna 2: SMTP_RELAY_SECRET
```
Name:  SMTP_RELAY_SECRET
Value: 7b3c48f92e6a4436ce4b48696b1d7322a8d88c3496df29c3cb7f0dedc342b9f4
```

## ⚠️ CZĘSTE BŁĘDY - Sprawdź czy NIE masz takich nazw:

### ❌ ZŁE NAZWY (nie zadziałają):
- `RELAY_SECRET` (bez SMTP_)
- `SMTP_SECRET` (bez RELAY)
- `RELAY_URL` (bez SMTP_)
- `SMTP_URL` (bez RELAY)
- `SMTP_RELAY` (bez _URL lub _SECRET)

### ✅ PRAWIDŁOWE NAZWY:
- `SMTP_RELAY_URL`
- `SMTP_RELAY_SECRET`

## 🔍 Jak sprawdzić w Supabase:

1. Idź do: https://supabase.com/dashboard
2. Wybierz swój projekt
3. **Settings** → **Edge Functions** → **Environment Variables**
4. Szukaj zmiennych zaczynających się od `SMTP_`

### Co powinieneś zobaczyć:

| Name | Value |
|------|-------|
| `SMTP_RELAY_URL` | `http://123.45.67.89:3005` |
| `SMTP_RELAY_SECRET` | `7b3c48f92e6a4436ce4b48696b1d7322a8d88c3496df29c3cb7f0dedc342b9f4` |

## 🛠️ Jeśli masz złe nazwy:

### Opcja A: Usuń stare i dodaj nowe

1. Usuń wszystkie zmienne związane z relay (np. `RELAY_SECRET`, `SMTP_URL`, etc.)
2. Dodaj **NOWE** zmienne z prawidłowymi nazwami (patrz wyżej)
3. **Poczekaj 60-90 sekund**

### Opcja B: Edytuj istniejące

1. Znajdź zmienną (nawet jeśli ma złą nazwę)
2. Kliknij **Edit**
3. Zmień **Name** na prawidłową (np. `SMTP_RELAY_SECRET`)
4. Zmień **Value** na prawidłową wartość
5. **Save**
6. **Poczekaj 60-90 sekund**

## 📋 Twoja konfiguracja VPS:

```bash
PORT=3005
RELAY_SECRET=7b3c48f92e6a4436ce4b48696b1d7322a8d88c3496df29c3cb7f0dedc342b9f4
```

## 🎯 Konfiguracja Supabase (sprawdź IP):

```bash
# Na VPS - sprawdź swoje IP
curl ifconfig.me
```

Załóżmy że dostaniesz: `123.45.67.89`

Wtedy w Supabase:

```
SMTP_RELAY_URL=http://123.45.67.89:3005
SMTP_RELAY_SECRET=7b3c48f92e6a4436ce4b48696b1d7322a8d88c3496df29c3cb7f0dedc342b9f4
```

## 🧪 Test po ustawieniu:

1. **Poczekaj 90 sekund** (ważne!)
2. Wyślij testowy email z CRM
3. Na VPS sprawdź logi:

```bash
pm2 logs smtp-relay-worker --lines 50
```

### Co powinieneś zobaczyć:

```
🔐 Authorization check:
   Received header: Bearer 7b3c48f92e6a...
   Expected: Bearer 7b3c48f92e6a...
✅ Authorization successful
📧 [2025-12-05...] Sending email to: test@example.com
   Subject: Test Email
   SMTP: smtp.example.com:587
   Attachments: 0
🔌 Verifying SMTP connection...
✅ SMTP connection verified
📮 Sending email...
✅ Email sent successfully. MessageId: <...>
```

## ❌ Jeśli wciąż błąd:

### Błąd: "SMTP_RELAY_URL not configured"
→ Zmienna w Supabase ma złą nazwę lub jej nie ma.

### Błąd: "Unauthorized: Invalid relay secret"
→ Wartość `SMTP_RELAY_SECRET` w Supabase jest inna niż `RELAY_SECRET` na VPS.

### Błąd: "Connection timeout" / "ECONNREFUSED"
→ Zła wartość `SMTP_RELAY_URL` (sprawdź IP i port).

## 📝 Checklist ostateczny:

- [ ] Zmienna nazywa się **DOKŁADNIE** `SMTP_RELAY_URL`
- [ ] Wartość to: `http://IP:3005` (nie `https`, nie końcówka `/`)
- [ ] Zmienna nazywa się **DOKŁADNIE** `SMTP_RELAY_SECRET`
- [ ] Wartość to: `7b3c48f92e6a4436ce4b48696b1d7322a8d88c3496df29c3cb7f0dedc342b9f4`
- [ ] Zapisałeś zmienne w Supabase (kliknąłeś Save)
- [ ] Poczekałeś 90 sekund
- [ ] Worker działa na VPS (`pm2 status`)
- [ ] Port 3005 jest otwarty (`curl http://localhost:3005/health`)

## 🚀 Szybkie kopiuj-wklej:

### Sprawdź IP na VPS:
```bash
curl ifconfig.me
```

### Skopiuj do schowka (Linux/Mac):
```bash
echo "SMTP_RELAY_URL: http://$(curl -s ifconfig.me):3005"
echo "SMTP_RELAY_SECRET: 7b3c48f92e6a4436ce4b48696b1d7322a8d88c3496df29c3cb7f0dedc342b9f4"
```

Skopiuj output i wklej do Supabase.
