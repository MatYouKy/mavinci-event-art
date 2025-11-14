# 🔧 Naprawa SMTP - Resetowanie hasła nie działa

## 📊 Status obecny:

- ✅ SMTP włączony w Supabase
- ✅ API zwraca sukces `{"email": "dominika@mavinci.pl"}`
- ❌ Mail NIE przychodzi na skrzynkę

---

## 🔍 Problem: Konfiguracja SMTP

### Obecna konfiguracja (screenshot):

```
Host: h22.seohost.pl
Port: 465
Username: noreply@mavinci.pl
Sender: noreply@mavinci.pl
```

**Port 465 = SMTP z SSL** - Supabase może mieć problem z tym portem!

---

## ⚡ ROZWIĄZANIE 1: Zmień port na 587 (ZALECANE)

### W Supabase Dashboard:

1. **Settings → Authentication → SMTP Settings**
2. **Zmień:**
   ```
   Port: 587  ← ZMIEŃ z 465 na 587!
   ```
3. **Save**
4. **Testuj ponownie**

**Dlaczego?**

- Port **587** = STARTTLS (standard)
- Port **465** = SSL (starszy standard, może nie działać)
- Większość serwerów SMTP wspiera oba, ale 587 jest bardziej uniwersalny

---

## ⚡ ROZWIĄZANIE 2: Sprawdź logi w Supabase

### Krok 1: Sprawdź logi SMTP

1. **W Supabase Dashboard:**
   - Lewy panel: **Logs**
   - Lub: **Logs & Analytics**
2. **Filtruj po:**
   - Type: **Auth**
   - Lub wyszukaj: `smtp` lub `email`
3. **Szukaj błędów:**
   - `Connection timeout`
   - `Authentication failed`
   - `Connection refused`
   - `SSL handshake failed`

**Jeśli widzisz błędy** - skopiuj je i dostosuj konfigurację.

---

## ⚡ ROZWIĄZANIE 3: Test połączenia SMTP z serwera

Sprawdźmy czy seohost.pl SMTP działa z zewnątrz:

### Opcja A: Online test SMTP

1. **Wejdź na:** https://www.gmass.co/smtp-test
2. **Wypełnij:**
   ```
   SMTP Server: h22.seohost.pl
   Port: 587
   Username: noreply@mavinci.pl
   Password: [Twoje hasło]
   From: noreply@mavinci.pl
   To: [Twój testowy email]
   ```
3. **Test**
4. **Jeśli DZIAŁA** = problem w Supabase
5. **Jeśli NIE DZIAŁA** = problem w seohost.pl (zablokowany)

### Opcja B: Test z linii komend (jeśli masz terminal)

```bash
telnet h22.seohost.pl 587
# Powinno pokazać: 220 h22.seohost.pl ESMTP
# Jeśli timeout = port zablokowany
```

---

## ⚡ ROZWIĄZANIE 4: Sprawdź panel seohost.pl

### W panelu hostingowym seohost.pl:

1. **Sprawdź:** Czy skrzynka `noreply@mavinci.pl` istnieje i działa
2. **Sprawdź:** Limity wysyłki (może być limit maili/godzinę)
3. **Sprawdź:** Czy SMTP dostępny z zewnątrz (nie tylko localhost)
4. **Sprawdź:** Czy jest whitelist IP (dodaj IP Supabase jeśli tak)

**IP Supabase (dla whitelisting):**

- Możesz znaleźć w: Supabase Project Settings → General → API
- Lub zapytaj support Supabase o IP ranges

---

## ⚡ ROZWIĄZANIE 5: Alternatywne SMTP (szybki fix)

Jeśli seohost.pl blokuje SMTP, użyj **Gmail** lub **SendGrid**:

### Opcja A: Gmail SMTP (5 minut, darmowe)

1. **Wygeneruj App Password:**
   - https://myaccount.google.com/security
   - Włącz 2FA
   - App passwords → Generate
   - Skopiuj 16-znakowy kod

2. **W Supabase:**

   ```
   Sender name: Mavinci CRM
   Sender email: twoj-gmail@gmail.com

   Host: smtp.gmail.com
   Port: 587
   Username: twoj-gmail@gmail.com
   Password: [App Password bez spacji]
   ```

3. **Save → Testuj**

### Opcja B: SendGrid (100 maili/dzień darmowe)

1. **Załóż konto:** https://sendgrid.com/free/
2. **Wygeneruj API Key:**
   - Settings → API Keys
   - Create → Full Access
   - Skopiuj klucz

3. **Verify sender:**
   - Settings → Sender Authentication
   - Single Sender Verification
   - Verify email

4. **W Supabase:**

   ```
   Sender name: Mavinci CRM
   Sender email: [zweryfikowany email]

   Host: smtp.sendgrid.net
   Port: 587
   Username: apikey
   Password: [Twój API Key]
   ```

5. **Save → Testuj**

---

## 🧪 Testowanie po zmianach

### Test 1: W Supabase Dashboard

1. **Authentication → Users**
2. Kliknij na użytkownika
3. **⋮ → Send magic link**
4. **Sprawdź skrzynkę** (w tym SPAM!)

### Test 2: W aplikacji

1. **/crm/login**
2. **"Nie pamiętasz hasła?"**
3. **Wpisz email**
4. **"Wyślij link resetujący"**
5. **Sprawdź skrzynkę**

### Test 3: Sprawdź logi

1. **Supabase Dashboard → Logs**
2. **Szukaj błędów SMTP**
3. **Jeśli są błędy** - dostosuj konfigurację

---

## 📋 Checklist rozwiązania

- [ ] Zmień port z 465 na 587
- [ ] Sprawdź logi w Supabase (Logs → Auth)
- [ ] Przetestuj SMTP online (gmass.co/smtp-test)
- [ ] Sprawdź panel seohost.pl (limity, whitelist IP)
- [ ] Jeśli nie działa - użyj Gmail lub SendGrid jako backup
- [ ] Testuj w Dashboard (Send magic link)
- [ ] Testuj w aplikacji (/crm/login)
- [ ] Sprawdź folder SPAM!

---

## 🚨 Najczęstsze przyczyny

### 1. Port 465 zamiast 587

**Objaw:** API sukces, mail nie przychodzi
**Fix:** Zmień na port 587

### 2. Seohost.pl blokuje zewnętrzne SMTP

**Objaw:** Connection timeout w logach
**Fix:** Sprawdź panel seohost.pl lub użyj Gmail/SendGrid

### 3. Hasło do SMTP niewłaściwe

**Objaw:** Authentication failed
**Fix:** Zresetuj hasło do skrzynki noreply@mavinci.pl

### 4. Limity wysyłki na serwerze

**Objaw:** Działa raz, potem nie
**Fix:** Sprawdź limity w panelu hostingu

### 5. Mail trafia do SPAM

**Objaw:** Wysyła się, ale użytkownik nie widzi
**Fix:** Sprawdź folder SPAM!

---

## ✅ Oczekiwany rezultat

Po poprawnej konfiguracji:

1. ✅ Użytkownik klika "Nie pamiętasz hasła?"
2. ✅ Wpisuje email
3. ✅ Klika "Wyślij link resetujący"
4. ✅ **Mail przychodzi w ciągu 10-30 sekund**
5. ✅ Użytkownik klika link w mailu
6. ✅ Ustawia nowe hasło
7. ✅ Loguje się!

---

## 💡 Polecam na start:

1. **Zmień port na 587** (najprostsze)
2. **Sprawdź logi w Supabase** (czy są błędy?)
3. **Jeśli nie działa** - użyj Gmail SMTP (5 minut setup)

---

**Potrzebujesz pomocy?**
Skopiuj błędy z logów Supabase i pokażę dokładnie co poprawić! 📧✨
