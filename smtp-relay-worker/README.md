# SMTP Relay Worker

Worker Node.js który działa na VPS i pośredniczy w wysyłaniu emaili dla Supabase Edge Functions.

## Aktualizacja wysyłki broszur — 20.10.2026

Duże, zapisane PDF-y nie przechodzą już przez JSON/base64 w Edge Function.
CRM przekazuje identyfikator zapisanej wysyłki. Funkcja sprawdza autora, skrzynkę,
odbiorcę i treść, jednorazowo przejmuje próbę, a następnie przekazuje usłudze SMTP
krótkotrwały adres dokładnie tego PDF. Worker pobiera go strumieniowo do prywatnego
pliku tymczasowego i usuwa ten plik po próbie. Odbiorca nadal otrzymuje załącznik,
nie link zamiast załącznika.

Kolejność wdrożenia:

1. Migracja `supabase/migrations/20261020190000_stream_brochure_email_attachments.sql`
   (po wcześniejszych migracjach broszur).
2. Zaktualizuj worker na VPS: `server.js` **oraz** `brochure-attachments.js`.
   W jego istniejącym środowisku dodaj publiczny adres projektu:
   `SUPABASE_URL=https://fuuljhhuhfojtmmfmskq.supabase.co`.
   Nie zmieniaj `RELAY_SECRET`. Uruchom ponownie istniejący proces workera.
3. Wdróż funkcję Supabase `send-email` z `supabase/functions/send-email/index.ts`.
4. Wdróż aplikację Next.js.

Skrypt `smtp-relay-worker/deploy-smtp-relay.sh` kopiuje oba pliki workera.
Jeśli brakuje `SUPABASE_URL`, pobiera wyłącznie publiczny adres projektu
z istniejącej konfiguracji aplikacji na VPS, zachowuje kopię `.env` i pozostawia
sekrety bez zmian. Brak poprawnego adresu zatrzymuje restart. Gotowość jest
potwierdzana przez `/api/capabilities`, nie tylko przez ogólny `/health`.
Skrypt nie generuje PDF ani nie wysyła żadnej wiadomości.

Nowa wersja sprawdza zgodność usługi przed rozpoczęciem wysyłki. Nie stosuje
awaryjnego powrotu do dużych załączników base64 ani nie wysyła bez PDF.
Adresy Storage muszą pochodzić z dokładnie skonfigurowanego projektu, używać HTTPS
i ścieżki podpisanych plików `generated-brochures`; przekierowania są odrzucane.
Limit PDF wynosi 50 MiB. Osobne limity serwera pocztowego nadal obowiązują.

Wynik `not_sent` oznacza potwierdzony błąd przed przyjęciem wiadomości i pozwala
użytkownikowi ponowić próbę. Timeout po rozpoczęciu SMTP nadal oznacza `uncertain`.
Potwierdzenie SMTP jest zapisywane przed archiwizacją załączników; zapis kopii PDF
w folderze Wysłane używa operacji Storage copy, bez pobierania pliku do Edge.
Identyfikator próby i jednorazowe przejęcie chronią przed podwójnym wywołaniem.
Istniejące wpisy `sending` / `uncertain` nie są odblokowywane przez migrację:
ich wynik należy ustalić w logach usługi SMTP lub po identyfikatorze wiadomości.

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
