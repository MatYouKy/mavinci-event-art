# Naprawa błędu 403 Forbidden - CORS Configuration

## Problem

Formularz kontaktowy zwraca 403 Forbidden po deploy na mavinci.pl

## Przyczyna

Supabase domyślnie blokuje żądania z nieznanych domen (CORS protection)

## Rozwiązanie - Dodaj domenę do Supabase

### KROK 1: Zaloguj się do Supabase Dashboard

1. Przejdź do: https://supabase.com/dashboard
2. Zaloguj się swoim kontem
3. Wybierz projekt: fuuljhhuhfojtmmfmskq

### KROK 2: Otwórz ustawienia CORS

1. W lewym menu kliknij: **Settings** (ikona zębatki)
2. Następnie kliknij: **API**
3. Przewiń w dół do sekcji: **CORS Configuration**

### KROK 3: Dodaj swoją domenę

W polu **Allowed Origins** dodaj:

```
https://mavinci.pl
```

**WAŻNE:**

- Dodaj również `http://localhost:3000` jeśli testujesz lokalnie
- Możesz dodać wiele domen, każda w nowej linii

**Przykład:**

```
https://mavinci.pl
http://localhost:3000
http://localhost:3001
```

### KROK 4: Zapisz zmiany

1. Kliknij przycisk **Save**
2. Poczekaj ~30 sekund na propagację zmian

### KROK 5: Test

1. Odśwież stronę: https://mavinci.pl
2. Wypełnij formularz kontaktowy
3. Kliknij "Wyślij wiadomość"
4. Powinno działać! ✅

---

## Alternatywne rozwiązanie (jeśli powyższe nie pomaga)

### Sprawdź czy zmienne środowiskowe są dostępne:

**Na VPS wykonaj:**

```bash
# Zaloguj się na VPS
ssh user@mavinci.pl

# Przejdź do katalogu projektu
cd /path/to/project

# Sprawdź .env
cat .env

# Powinno pokazać:
# NEXT_PUBLIC_SUPABASE_URL=https://fuuljhhuhfojtmmfmskq.supabase.co
# NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

**Jeśli .env jest pusty lub nie istnieje:**

```bash
# Skopiuj z lokalnego komputera
scp .env user@mavinci.pl:/path/to/project/.env

# Zrestartuj aplikację
pm2 restart mavinci
# LUB
sudo systemctl restart mavinci
```

---

## Debugging

### 1. Sprawdź console przeglądarki (F12)

**Szukaj błędów:**

```
Access to fetch at 'https://fuuljhhuhfojtmmfmskq.supabase.co'
from origin 'https://mavinci.pl' has been blocked by CORS policy
```

**Jeśli widzisz ten błąd = CORS nie jest skonfigurowany!**

### 2. Sprawdź Request Headers

W DevTools (F12) → Network → kliknij żądanie POST

**Sprawdź czy są:**

- `Origin: https://mavinci.pl`
- `Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...`

**Jeśli brakuje Authorization = zmienne środowiskowe nie działają!**

### 3. Test z curl

```bash
curl -X POST 'https://fuuljhhuhfojtmmfmskq.supabase.co/rest/v1/contact_messages' \
  -H "apikey: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ1dWxqaGh1aGZvanRtbWZtc2txIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk5NDI5NjEsImV4cCI6MjA3NTUxODk2MX0.xe8_YUgENMeXwuLSZVatAfDBZLi5lcfyV3sHjaD8dmE" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ1dWxqaGh1aGZvanRtbWZtc2txIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk5NDI5NjEsImV4cCI6MjA3NTUxODk2MX0.xe8_YUgENMeXwuLSZVatAfDBZLi5lcfyV3sHjaD8dmE" \
  -H "Content-Type: application/json" \
  -d '{"name":"Test","email":"test@test.com","message":"Test message"}'
```

**Jeśli zwraca 201 = API działa, problem jest z CORS!**
**Jeśli zwraca 403 = problem z kluczem API lub RLS!**

---

## Checklist

- [ ] Dodaj https://mavinci.pl do CORS w Supabase Dashboard
- [ ] Zapisz zmiany
- [ ] Poczekaj 30 sekund
- [ ] Odśwież stronę
- [ ] Wypełnij formularz
- [ ] Test - powinno działać!

---

## Jeśli nadal nie działa

### Sprawdź RLS policies:

W Supabase Dashboard:

1. Table Editor → contact_messages
2. Kliknij zakładkę "Policies"
3. Sprawdź czy jest policy: "Anyone can send contact messages"
4. Powinna mieć:
   - Command: INSERT
   - Roles: anon, authenticated
   - Policy: true

---

## Szybka diagnoza

**403 Forbidden może oznaczać:**

1. ❌ **CORS nie skonfigurowany** → Dodaj domenę w Supabase
2. ❌ **Brak zmiennych env** → Skopiuj .env na VPS i zrestartuj
3. ❌ **RLS blokuje** → Sprawdź policies (już jest OK)
4. ❌ **Klucz API niepoprawny** → Sprawdź czy NEXT_PUBLIC_SUPABASE_ANON_KEY jest poprawny

**W 99% przypadków to CORS!**
