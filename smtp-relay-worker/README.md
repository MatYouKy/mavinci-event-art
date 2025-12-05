# SMTP Relay Worker

Worker Node.js który działa na VPS i pośredniczy w wysyłaniu emaili dla Supabase Edge Functions.

## ⚡ Szybki start

```bash
cd ~/smtp-relay-worker

# 1. Sprawdź czy działa
./test-local.sh

# 2. Jeśli błąd autoryzacji
./compare-secrets.sh

# 3. Zobacz pełną checklistę
cat CHECKLIST.md
```

## 🎯 Problem

Supabase Edge Functions działają na Deno Deploy, który **blokuje porty SMTP** (587, 465, 25).
Nie możesz bezpośrednio wysyłać emaili przez SMTP z Edge Functions.

## ✅ Rozwiązanie

```
┌─────────────────┐
│  CRM (Next.js)  │
└────────┬────────┘
         │ HTTP request
         ▼
┌─────────────────────┐
│  Edge Function      │ (Deno Deploy)
│  (send-email)       │ - Nie ma dostępu do SMTP
└────────┬────────────┘
         │ HTTP relay
         ▼
┌─────────────────────┐
│  SMTP Relay Worker  │ (VPS)
│  (smtp-relay-worker)│ - Ma dostęp do SMTP
└────────┬────────────┘
         │ SMTP (587/465)
         ▼
┌─────────────────────┐
│  SMTP Server        │ (h22.seohost.pl)
└─────────────────────┘
```

## 🚀 Funkcje

- ✅ Przyjmuje requesty HTTP z Edge Functions
- ✅ Wysyła emaile przez SMTP (nodemailer)
- ✅ Obsługuje załączniki (base64)
- ✅ Weryfikacja połączenia SMTP
- ✅ Autoryzacja przez sekretny klucz
- ✅ Szczegółowe logowanie
- ✅ Health check endpoint
- ✅ Gotowe do PM2

## 📦 Instalacja

Zobacz [QUICK_START.md](./QUICK_START.md) dla szczegółowej instrukcji.

### Szybkie kroki:

```bash
# 1. Zainstaluj zależności
npm install

# 2. Skonfiguruj .env
cp .env.example .env
nano .env  # Ustaw PORT i RELAY_SECRET

# 3. Uruchom
npm run pm2:start

# 4. Sprawdź
curl http://localhost:3005/health
```

## 🔧 API

### POST /api/send-email

**Headers:**
```
Content-Type: application/json
Authorization: Bearer <RELAY_SECRET>
```

**Body:**
```json
{
  "smtpConfig": {
    "host": "smtp.example.com",
    "port": 587,
    "username": "user@example.com",
    "password": "password",
    "from": "user@example.com",
    "fromName": "User Name"
  },
  "to": "recipient@example.com",
  "subject": "Test Email",
  "body": "<p>HTML content</p>",
  "replyTo": "reply@example.com",
  "attachments": [
    {
      "filename": "document.pdf",
      "content": "base64-encoded-content",
      "contentType": "application/pdf"
    }
  ]
}
```

**Response:**
```json
{
  "success": true,
  "messageId": "<unique-message-id@smtp.server>",
  "message": "Email sent successfully"
}
```

### GET /health

**Response:**
```json
{
  "status": "ok",
  "service": "smtp-relay-worker",
  "timestamp": "2025-12-05T10:30:00.000Z"
}
```

## 🔒 Bezpieczeństwo

1. **Autoryzacja**: Każdy request wymaga `Authorization: Bearer <RELAY_SECRET>`
2. **Firewall**: Ogranicz dostęp do workera tylko z IP Supabase
3. **HTTPS**: Rozważ reverse proxy (nginx) z certyfikatem SSL

## 📊 Monitorowanie

```bash
# Status PM2
pm2 status

# Logi na żywo
pm2 logs smtp-relay-worker

# Restart
pm2 restart smtp-relay-worker

# Stop
pm2 stop smtp-relay-worker
```

## 🐛 Troubleshooting

### Port już zajęty
```bash
# Sprawdź co używa portu
lsof -i :3005

# Zmień port w .env
nano .env
```

### SMTP timeout
- Sprawdź czy VPS ma otwarte porty 587/465 na firewallu
- Sprawdź dane SMTP (host, port, username, password)

### Błąd autoryzacji
- Sprawdź czy `RELAY_SECRET` w `.env` zgadza się z tym w Supabase Edge Functions

## 📝 Wymagania

- Node.js 18+
- npm lub yarn
- PM2 (opcjonalnie, ale zalecane)
- VPS z otwartymi portami SMTP

## 🔗 Powiązane

- `imap-sync-worker` - Worker do synchronizacji emaili (odbieranie)
- `send-email` - Edge Function która używa tego workera
- `send-invoice-email` - Edge Function do wysyłania faktur
- `send-offer-email` - Edge Function do wysyłania ofert
