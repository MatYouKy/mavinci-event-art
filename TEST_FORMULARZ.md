# Test Formularza Kontaktowego - Quick Guide

## ✅ Zmiany zastosowane

### Naprawiono:
1. ✅ RLS policy - anon może INSERT
2. ✅ API key header - zawsze przekazywany
3. ✅ Fallback values - działa bez env vars
4. ✅ Build success

---

## 🧪 Jak przetestować LOKALNIE (bolt.new)

### Krok 1: Odśwież stronę
- Kliknij "Refresh" w podglądzie
- LUB restart dev server

### Krok 2: Znajdź formularz
- Przewiń do sekcji "Kontakt"
- Formularz powinien być widoczny

### Krok 3: Wypełnij
```
Imię: Jan Kowalski
Email: jan@test.com
Telefon: 123456789 (opcjonalne)
Wiadomość: Test wiadomości z formularza
```

### Krok 4: Wyślij
- Kliknij przycisk "Wyślij wiadomość"
- **Oczekiwany rezultat:**
  - 🎉 Confetti animation
  - ✅ Komunikat sukcesu: "Wiadomość wysłana!"
  - ✅ Formularz się wyczyści

### Krok 5: Sprawdź w konsoli
- Otwórz DevTools (F12)
- Console tab
- **Nie powinno być błędów!**
- Network tab → POST request → Status: 201

---

## 🐛 Jeśli NIE DZIAŁA lokalnie:

### 1. Sprawdź console (F12)
**Błędy które mogą się pojawić:**

#### "No API key found"
**Rozwiązanie:**
```bash
# Restart dev server
# Ctrl+C aby zatrzymać
npm run dev
```

#### "RLS policy violation"
**To już naprawione, ale jeśli się pojawi:**
```sql
-- W Supabase SQL Editor
DROP POLICY IF EXISTS "Anyone can send contact messages" ON contact_messages;
CREATE POLICY "Allow anyone to insert contact messages"
ON contact_messages FOR INSERT TO anon, authenticated
WITH CHECK (true);
```

#### "CORS error"
**Nie powinno się pojawić lokalnie**, ale jeśli tak:
- Supabase Dashboard → Settings → API → CORS
- Dodaj: `http://localhost:3000`

### 2. Sprawdź Network tab
- F12 → Network
- Wyślij formularz
- Znajdź POST request do Supabase
- **Status 201 = OK**
- **Status 403 = CORS lub RLS**
- **Status 400 = Bad request / API key**

### 3. Hard refresh
```bash
# Windows/Linux
Ctrl + Shift + R

# Mac
Cmd + Shift + R
```

---

## 🚀 Test na VPS (mavinci.pl)

### Przed testem - WAŻNE:
1. **CORS musi być skonfigurowany w Supabase:**
   - Dashboard → Settings → API → CORS
   - Dodaj: `https://mavinci.pl`
   - Save

2. **Deploy kod na VPS:**
   ```bash
   # Na VPS
   git pull  # lub scp nowe pliki
   npm run build
   pm2 restart mavinci
   ```

3. **Sprawdź .env na VPS:**
   ```bash
   cat .env | grep NEXT_PUBLIC_SUPABASE
   # Powinno pokazać URL i KEY
   ```

### Test:
1. Otwórz: https://mavinci.pl
2. Przewiń do formularza
3. Wypełnij i wyślij
4. **Oczekiwane:**
   - Confetti + sukces
   - Brak błędów w console

---

## 📊 Weryfikacja w bazie danych

### Sprawdź czy wiadomość się zapisała:

**W Supabase Dashboard:**
1. Table Editor
2. Znajdź tabelę: `contact_messages`
3. Sprawdź ostatnie rekordy

**LUB w SQL Editor:**
```sql
SELECT 
  id,
  name,
  email,
  message,
  category,
  created_at
FROM contact_messages
ORDER BY created_at DESC
LIMIT 5;
```

**Twoja wiadomość testowa powinna być widoczna!**

---

## ✅ Checklist testowania

### Lokalnie (bolt.new):
- [ ] Odśwież stronę
- [ ] Znajdź formularz
- [ ] Wypełnij wszystkie pola
- [ ] Wyślij
- [ ] Sprawdź czy pokazał sukces + confetti
- [ ] Sprawdź console - brak błędów
- [ ] Sprawdź Network - status 201

### Na VPS:
- [ ] CORS skonfigurowany w Supabase
- [ ] Kod zdeployowany
- [ ] .env skopiowany
- [ ] Restart aplikacji
- [ ] Test formularza
- [ ] Weryfikacja w bazie

---

## 🎯 Debugowanie błędów

| Błąd | Gdzie | Rozwiązanie |
|------|-------|-------------|
| No API key | Console | Restart dev / Sprawdź kod |
| RLS violation | Console | Policy już naprawiona |
| CORS error | Console | Dodaj domenę w Supabase |
| 403 Forbidden | Network | CORS - dodaj domenę |
| 400 Bad Request | Network | Sprawdź dane formularza |
| 500 Server Error | Network | Problem z Supabase |

---

## 💡 Tips

### Szybki test bez wypełniania:
**W console przeglądarki:**
```javascript
const { supabase } = await import('/src/lib/supabase.js');

await supabase.from('contact_messages').insert([{
  name: 'Test Console',
  email: 'test@console.com',
  message: 'Test z console',
  category: 'general',
  source_page: '/'
}]);
```

### Sprawdź czy client ma API key:
```javascript
console.log(supabase.rest.headers);
// Powinno pokazać: { apikey: "eyJhbGci..." }
```

---

## 📝 Dokumentacja pełna:

- **NAPRAWA_FORMULARZ_KONTAKTOWY.md** - RLS fix
- **NAPRAWA_403_CORS.md** - CORS setup
- **NAPRAWA_API_KEY.md** - API key header
- **PODSUMOWANIE_NAPRAW_FORMULARZ.md** - Overview

---

**Formularz powinien działać! Jeśli nie - sprawdź console i network tab w DevTools.** 🚀
