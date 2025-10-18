# 🔐 Resetowanie Hasła - Instrukcja

## 📧 Problem: Maile nie przychodzą

Supabase w trybie **Development** (darmowy plan) **NIE WYSYŁA PRAWDZIWYCH MAILI EMAIL**.

### Dlaczego?

- Supabase domyślnie używa **Inbucket** (lokalny symulator email)
- Maile trafiają do konsoli deweloperskiej Supabase, NIE do prawdziwej skrzynki
- To zabezpieczenie przed spamem w trybie testowym

---

## ✅ ROZWIĄZANIE 1: Sprawdź maile w Supabase Dashboard

### Krok po kroku:

1. **Wejdź na:** https://app.supabase.com/project/fuuljhhuhfojtmmfmskq
2. **Lewy panel:** Authentication → **Email Templates** (lub **Logs**)
3. **Lub:** Authentication → **Users** → znajdź użytkownika → **Send recovery link**
4. **Link pojawi się w konsoli** Supabase (zakładka **Logs** / **Email**)
5. Skopiuj link i wklej w przeglądarce

**Format linka:**
```
https://fuuljhhuhfojtmmfmskq.supabase.co/auth/v1/verify?token=xxx&type=recovery&redirect_to=https://yourdomain.com/crm/reset-password
```

---

## ✅ ROZWIĄZANIE 2: Konfiguruj własny SMTP (ZALECANE dla produkcji)

### Opcje SMTP:

#### **A) Gmail SMTP (proste, darmowe)**

1. **Włącz 2FA** w Gmail
2. **Wygeneruj App Password:**
   - Google Account → Security → 2-Step Verification
   - App passwords → Select app: Mail → Generate
3. **W Supabase Dashboard:**
   - Settings → **Project Settings** → **Auth**
   - SMTP Settings:
     ```
     Host: smtp.gmail.com
     Port: 587
     Username: twoj-email@gmail.com
     Password: [16-znakowy App Password]
     Sender email: twoj-email@gmail.com
     Sender name: Mavinci CRM
     ```
4. **Save**

#### **B) SendGrid (darmowe 100 maili/dzień)**

1. Załóż konto: https://sendgrid.com
2. Wygeneruj API Key
3. W Supabase:
   ```
   Host: smtp.sendgrid.net
   Port: 587
   Username: apikey
   Password: [Twój API Key]
   Sender email: verified@yourdomain.com
   ```

#### **C) Mailgun / AWS SES (profesjonalne)**

- Mailgun: https://www.mailgun.com
- AWS SES: https://aws.amazon.com/ses/

---

## ✅ ROZWIĄZANIE 3: Panel Admina - Zmiana hasła pracownika

Dodałem funkcjonalność resetowania hasła **bezpośrednio przez admina**.

### Jak użyć:

1. Wejdź na: `/crm/employees`
2. Znajdź pracownika
3. Kliknij **"Resetuj hasło"**
4. Wpisz nowe hasło (min. 8 znaków, 1 wielka, 1 mała, 1 cyfra)
5. **Gotowe!** Pracownik może się zalogować nowym hasłem

**Wymaga uprawnień:** `employees_manage` lub `admin`

---

## 🔍 Sprawdź czy masz skonfigurowany SMTP

### W Supabase Dashboard:

1. **Settings** → **Project Settings** → **Auth**
2. Przewiń do **SMTP Settings**
3. Sprawdź czy pola są wypełnione

**Jeśli puste = maile NIE BĘDĄ SIĘ WYSYŁAĆ!**

---

## 📋 Testowanie resetowania hasła

### 1. Test przez stronę logowania:

```
1. Wejdź na: /crm/login
2. Kliknij: "Zapomniałeś hasła?"
3. Wpisz email pracownika (np. marek@mavinci.pl)
4. Kliknij: "Wyślij link resetujący"
```

**Jeśli SMTP skonfigurowany:**
- ✅ Mail przyjdzie na skrzynkę
- ✅ Link w mailu prowadzi do `/crm/reset-password`

**Jeśli SMTP NIE skonfigurowany:**
- ❌ Mail NIE przyjdzie
- ✅ Link jest w Supabase Dashboard (Logs)

### 2. Test przez Supabase Dashboard:

```
1. Authentication → Users
2. Znajdź użytkownika
3. Kliknij "..." → "Send recovery link"
4. Mail wysłany (jeśli SMTP działa)
```

---

## ⚙️ Konfiguracja URL w Supabase

Sprawdź czy **Redirect URLs** są poprawnie skonfigurowane:

### W Supabase Dashboard:

1. **Authentication** → **URL Configuration**
2. **Site URL:** `https://yourdomain.com` (lub `http://localhost:3000` dla dev)
3. **Redirect URLs:** Dodaj:
   ```
   http://localhost:3000/crm/reset-password
   https://yourdomain.com/crm/reset-password
   ```

---

## 🚨 Częste problemy

### Problem 1: "Link wygasł"
**Przyczyna:** Token resetowania ważny tylko 1 godzinę
**Rozwiązanie:** Wygeneruj nowy link

### Problem 2: "Mail nie przychodzi"
**Przyczyna:** Brak SMTP lub email w spam
**Rozwiązanie:**
- Sprawdź folder SPAM
- Skonfiguruj SMTP
- Użyj panelu admina

### Problem 3: "Invalid redirect URL"
**Przyczyna:** URL nie jest w whitelist Supabase
**Rozwiązanie:** Dodaj URL w Authentication → URL Configuration

---

## 💡 Najlepsze rozwiązanie dla Ciebie

### **Dla środowiska deweloperskiego (teraz):**
✅ Używaj **Panelu Admina** do resetowania haseł pracownikom
✅ Lub sprawdzaj linki w **Supabase Logs**

### **Dla środowiska produkcyjnego:**
✅ Skonfiguruj **Gmail SMTP** (najprostsze)
✅ Lub **SendGrid** (bardziej profesjonalne)
✅ Dodaj domeny do **Email Templates** w Supabase

---

## 📖 Dodatkowe materiały

- Supabase SMTP: https://supabase.com/docs/guides/auth/auth-smtp
- Gmail App Passwords: https://support.google.com/accounts/answer/185833
- SendGrid Setup: https://docs.sendgrid.com/for-developers/sending-email/getting-started-smtp

---

## ✅ Co już działa w aplikacji

1. ✅ Strona logowania z opcją "Zapomniałeś hasła?"
2. ✅ Formularz resetowania hasła (`/crm/reset-password`)
3. ✅ Walidacja hasła (8+ znaków, wielka/mała/cyfra)
4. ✅ Obsługa tokenów resetowania
5. ✅ Przekierowanie po sukcesie

**Brakuje tylko:** Konfiguracja SMTP w Supabase!

---

## 🎯 Następne kroki

1. **Teraz (tymczasowo):**
   - Dodaj funkcję resetowania hasła w panelu pracowników
   - Lub używaj Supabase Dashboard

2. **Przed wdrożeniem:**
   - Skonfiguruj SMTP (Gmail lub SendGrid)
   - Przetestuj wysyłkę maili
   - Dostosuj szablon maila (opcjonalnie)

---

**Pytania? Potrzebujesz pomocy z konfiguracją SMTP?**
