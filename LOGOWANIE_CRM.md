# 🔐 Instrukcja logowania do CRM Mavinci

---

## ✅ Konto administratora jest GOTOWE!

Konto zostało utworzone automatycznie w bazie danych.

### 🔑 Dane logowania:

**Email:** admin@mavinci.pl
**Hasło:** Mavinci2025!

### 🌐 Strona logowania:

```
http://localhost:3000/crm/login
```

---

## 📋 Jak się zalogować:

1. Otwórz: http://localhost:3000/crm/login
2. Wpisz email: **admin@mavinci.pl**
3. Wpisz hasło: **Mavinci2025!**
4. Kliknij "Zaloguj się"

**To wszystko!** Zostaniesz automatycznie przekierowany do panelu CRM.

---

## 👥 Jak dodawać nowych użytkowników?

**WAŻNE:** Rejestracja publiczna jest WYŁĄCZONA. Tylko administrator może tworzyć konta.

### Sposób 1: Przez SQL (obecnie)

W Supabase Dashboard → SQL Editor:

```sql
-- 1. Utwórz użytkownika w auth.users
INSERT INTO auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at,
  confirmation_token,
  email_change,
  email_change_token_new,
  recovery_token
)
SELECT
  '00000000-0000-0000-0000-000000000000',
  gen_random_uuid(),
  'authenticated',
  'authenticated',
  'nowy@email.pl',  -- ← ZMIEŃ EMAIL
  crypt('HasloUzytkownika123!', gen_salt('bf')),  -- ← ZMIEŃ HASŁO
  NOW(),
  '{"provider":"email","providers":["email"],"role":"user"}'::jsonb,
  '{"full_name":"Imię Nazwisko"}'::jsonb,  -- ← ZMIEŃ DANE
  NOW(),
  NOW(),
  '',
  '',
  '',
  ''
WHERE NOT EXISTS (
  SELECT 1 FROM auth.users WHERE email = 'nowy@email.pl'  -- ← ZMIEŃ EMAIL
);

-- 2. Pobierz ID utworzonego użytkownika
SELECT id, email FROM auth.users WHERE email = 'nowy@email.pl';  -- ← ZMIEŃ EMAIL

-- 3. Dodaj do tabeli employees (użyj ID z poprzedniego zapytania)
INSERT INTO employees (
  id,
  name,
  surname,
  email,
  phone_number,
  role,
  access_level,
  occupation,
  permissions,
  is_active,
  created_at,
  updated_at
) VALUES (
  'ID_UŻYTKOWNIKA_Z_POPRZEDNIEGO_ZAPYTANIA',  -- ← WKLEJ ID
  'Imię',  -- ← ZMIEŃ
  'Nazwisko',  -- ← ZMIEŃ
  'nowy@email.pl',  -- ← ZMIEŃ EMAIL
  '+48 123 456 789',  -- ← ZMIEŃ TELEFON
  'operator',  -- lub: admin, manager, lead
  'operator',  -- lub: admin, manager, lead, guest
  'Stanowisko',  -- ← ZMIEŃ
  jsonb_build_object(
    'can_manage_employees', false,
    'can_manage_clients', true,
    'can_manage_events', true,
    'can_manage_offers', true,
    'can_manage_equipment', false,
    'can_view_reports', false,
    'can_manage_settings', false
  ),
  true,
  NOW(),
  NOW()
);
```

### Sposób 2: Panel administratora (planowany)

Funkcja dodawania użytkowników przez panel CRM będzie dodana w przyszłości.

---

## 🛠️ Rozwiązywanie problemów

### Problem: "Invalid login credentials"

**Przyczyna:** Nieprawidłowy email lub hasło.

**Rozwiązanie:**
1. Upewnij się że używasz: **admin@mavinci.pl** / **Mavinci2025!**
2. Sprawdź czy CAPS LOCK nie jest włączony
3. Skopiuj hasło zamiast przepisywać (końcowe wykrzyknik!)

### Problem: Przekierowuje do niewłaściwej bazy Supabase

**Przyczyna:** Serwer dev cache'uje stare zmienne środowiskowe.

**Rozwiązanie:**
1. Zatrzymaj serwer (Ctrl+C)
2. Sprawdź `.env`: powinno być `0ec90b57d6e95fcbda19832f`
3. Uruchom ponownie: `npm run dev`
4. Wyczyść cache przeglądarki (Ctrl+Shift+R)

### Problem: Konto nie istnieje

**Rozwiązanie:** Wykonaj SQL z sekcji "Jak dodawać nowych użytkowników"

---

## 📊 Stan systemu:

✅ Konto admina utworzone
✅ 4 klientów
✅ 4 pracowników
✅ 4 wydarzenia
✅ 40+ atrakcji z cenami
✅ System ofert dla sprzedawców
✅ Generator PDF
✅ Audyt cen dla admina
✅ Rejestracja publiczna WYŁĄCZONA

---

## 🔒 Bezpieczeństwo

- ✅ Rejestracja publiczna wyłączona
- ✅ Tylko admin może tworzyć konta
- ✅ Hasła są hashowane (bcrypt)
- ✅ RLS (Row Level Security) włączone
- ✅ Polityki bezpieczeństwa skonfigurowane

---

**Gotowe do użycia!** Zaloguj się i zacznij pracę z systemem CRM.
