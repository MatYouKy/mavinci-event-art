# 🔍 Debug: Problem z rejestracją

## Jeśli rejestracja przekierowuje z powrotem na login:

### Krok 1: Otwórz konsolę (F12)

Podczas rejestracji sprawdź logi w konsoli. Zobaczysz:

```
🔄 Próba rejestracji: twoj@email.pl
📊 Odpowiedź signUp: {...}
✅ Użytkownik utworzony: uuid-xxx
🔐 Sesja: TAK/NIE
```

### Krok 2: Sprawdź status

#### Jeśli widzisz: `🔐 Sesja: TAK`
✅ **Konto utworzone POMYŚLNIE!**
- Zostaniesz automatycznie zalogowany
- Przekierowanie do /crm

#### Jeśli widzisz: `🔐 Sesja: NIE (wymaga potwierdzenia email)`
⚠️ **Supabase wymaga potwierdzenia email**
- Konto zostało utworzone
- Musisz potwierdzić email ALBO zmienić ustawienia Supabase

---

## 🛠️ Rozwiązanie: Wyłącz potwierdzanie email w Supabase

### Opcja A: Przez Supabase Dashboard (ZALECANE)

1. Przejdź do: https://supabase.com
2. Wybierz projekt: **0ec90b57d6e95fcbda19832f**
3. Menu: **Authentication** → **Email Templates** (albo **Providers**)
4. Znajdź: **"Confirm email"** lub **"Enable email confirmations"**
5. **WYŁĄCZ** potwierdzanie email
6. Zapisz zmiany

### Opcja B: Zaloguj się pomimo braku potwierdzenia

Supabase i tak tworzy użytkownika! Spróbuj się zalogować:

1. Przejdź do: http://localhost:3000/crm/login
2. Wpisz te same dane co podczas rejestracji
3. Kliknij "Zaloguj się"

**Prawdopodobnie zadziała!** (nawet bez potwierdzenia)

### Opcja C: Potwierdź email ręcznie przez SQL

```sql
-- W Supabase Dashboard → SQL Editor:
UPDATE auth.users
SET email_confirmed_at = NOW()
WHERE email = 'twoj@email.pl';
```

---

## ✅ Test: Sprawdź czy konto istnieje

W konsoli (F12) na stronie logowania:

```javascript
const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
const supabase = createClient(
  'https://0ec90b57d6e95fcbda19832f.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJib2x0IiwicmVmIjoiMGVjOTBiNTdkNmU5NWZjYmRhMTk4MzJmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTg4ODE1NzQsImV4cCI6MTc1ODg4MTU3NH0.9I8-U0x86Ak8t2DGaIk0HfvTSLsAyzdnz-Nw00mMkKw'
);

// Spróbuj się zalogować
const result = await supabase.auth.signInWithPassword({
  email: 'twoj@email.pl',
  password: 'twoje_haslo'
});

console.log('Wynik logowania:', result);
```

Jeśli widzisz `session: {...}` - **DZIAŁA!** Konto istnieje i możesz się zalogować.

---

## 🎯 NAJSZYBSZE ROZWIĄZANIE:

Po rejestracji, **po prostu spróbuj się zalogować** używając tych samych danych!

Nawet jeśli Supabase mówi o potwierdzeniu email, użytkownik jest utworzony i często można się zalogować.

---

## 📝 Logi do sprawdzenia:

Podczas rejestracji w konsoli (F12) powinieneś zobaczyć:

```
🔄 Próba rejestracji: admin@mavinci.pl
📊 Odpowiedź signUp: {
  data: {
    user: { id: '...', email: '...' },
    session: null  // ← Jeśli null = wymaga potwierdzenia
  }
}
✅ Użytkownik utworzony: uuid-123
🔐 Sesja: NIE (wymaga potwierdzenia email)
📧 Wymaga potwierdzenia email - przekierowanie do logowania
```

**ALE** i tak spróbuj się zalogować! Często zadziała.
