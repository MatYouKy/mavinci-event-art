# Konfiguracja Systemowej Skrzynki Email

## Przegląd

System umożliwia wysyłanie ofert i faktur przez email z automatycznie wygenerowanymi załącznikami PDF:

- **Oferty** - wysyłane z domyślnego konta email pracownika (kreator oferty lub admin)
- **Faktury** - wysyłane z systemowej skrzynki email (wspólna skrzynka dla całej firmy)

## Jak to działa

### Wysyłanie Ofert

1. Kreator oferty lub administrator otwiera szczegóły oferty (`/crm/offers/[id]`)
2. Klika przycisk **"Wyślij"**
3. Wypełnia formularz email:
   - Adres odbiorcy (auto-uzupełniony z klienta)
   - Temat wiadomości
   - Treść wiadomości
4. System wysyła email z domyślnego konta pracownika z załącznikiem PDF oferty

### Wysyłanie Faktur

1. Pracownik otwiera szczegóły faktury (`/crm/invoices/[id]`)
2. Klika przycisk **"Wyślij email"**
3. Wypełnia formularz email
4. System wysyła email ze **systemowej skrzynki** z załącznikiem PDF faktury

## Konfiguracja Systemowej Skrzynki Email

### Krok 1: Przygotowanie skrzynki email

Zalecamy utworzenie dedykowanej skrzynki email dla systemu, np:
- `faktury@twojafirma.pl`
- `system@twojafirma.pl`
- `crm@twojafirma.pl`

### Krok 2: Pobranie danych SMTP/IMAP

Potrzebujesz następujących informacji od dostawcy email:

**SMTP (wysyłanie):**
- Host: np. `smtp.example.com`
- Port: zazwyczaj `587` (TLS) lub `465` (SSL)
- Login/Username
- Hasło

**IMAP (opcjonalne, do synchronizacji):**
- Host: np. `imap.example.com`
- Port: zazwyczaj `993`
- Login/Username
- Hasło

#### Przykłady dla popularnych dostawców:

**Gmail:**
```
SMTP Host: smtp.gmail.com
SMTP Port: 587
IMAP Host: imap.gmail.com
IMAP Port: 993
```
⚠️ Uwaga: W Gmail musisz utworzyć "Hasło aplikacji" w ustawieniach konta

**Outlook/Office 365:**
```
SMTP Host: smtp.office365.com
SMTP Port: 587
IMAP Host: outlook.office365.com
IMAP Port: 993
```

**Custom Domain:**
Sprawdź dokumentację swojego dostawcy hostingu (home.pl, OVH, etc.)

### Krok 3: Aktualizacja konfiguracji w bazie danych

Zaloguj się do Supabase SQL Editor i wykonaj następujące zapytanie:

```sql
UPDATE system_email_config
SET
  from_name = 'Twoja Firma',
  from_email = 'faktury@twojafirma.pl',
  smtp_host = 'smtp.example.com',
  smtp_port = 587,
  smtp_username = 'faktury@twojafirma.pl',
  smtp_password = 'twoje-haslo-smtp',
  smtp_use_tls = true,
  imap_host = 'imap.example.com',
  imap_port = 993,
  imap_username = 'faktury@twojafirma.pl',
  imap_password = 'twoje-haslo-imap',
  imap_use_ssl = true,
  signature = '<p>Pozdrawiamy,<br><strong>Zespół Twoja Firma</strong></p>',
  is_active = true
WHERE config_key = 'system';
```

### Krok 4: Testowanie

1. Przejdź do `/crm/invoices/[id]` dla dowolnej faktury
2. Kliknij "Wyślij email"
3. Wprowadź swój adres email testowy
4. Sprawdź czy email przyszedł poprawnie

## Bezpieczeństwo

- Hasła są przechowywane w bazie danych Supabase
- Tylko administratorzy mają dostęp do konfiguracji (`admin` permission)
- Edge functions używają Service Role Key do dostępu do haseł
- Wszystkie połączenia SMTP używają TLS/SSL

## Rozwiązywanie problemów

### Email nie został wysłany

1. Sprawdź logi w Supabase Edge Functions
2. Zweryfikuj poprawność danych SMTP w bazie danych
3. Upewnij się że `is_active = true` w `system_email_config`
4. Sprawdź czy skrzynka email nie ma ograniczeń (limity wysyłki)

### Błąd "System email configuration not found"

Wykonaj zapytanie SQL aby sprawdzić konfigurację:

```sql
SELECT * FROM system_email_config WHERE config_key = 'system';
```

Jeśli nie ma wpisu, uruchom migrację ponownie lub dodaj ręcznie:

```sql
INSERT INTO system_email_config (config_key, from_name, from_email, is_active)
VALUES ('system', 'System CRM', 'system@example.com', false);
```

### Gmail odrzuca logowanie

1. Włącz "Dostęp dla mniej bezpiecznych aplikacji" (niezalecane)
2. **LUB** Wygeneruj "Hasło aplikacji":
   - Przejdź do https://myaccount.google.com/security
   - 2-Step Verification → App passwords
   - Wygeneruj hasło dla "Mail"
   - Użyj tego hasła w konfiguracji SMTP

## Edge Functions

System korzysta z dwóch edge functions:

1. **send-offer-email** - wysyła oferty z konta pracownika
2. **send-invoice-email** - wysyła faktury z systemowej skrzynki

Funkcje są automatycznie wdrożone przez Supabase.

## FAQ

**Q: Czy mogę zmienić nadawcę dla faktur?**
A: Tak, zaktualizuj pola `from_name` i `from_email` w tabeli `system_email_config`.

**Q: Czy oferty są wysyłane z systemowej skrzynki?**
A: Nie, oferty są wysyłane z domyślnego konta email pracownika, który je tworzy.

**Q: Jak dodać podpis email?**
A: Zaktualizuj pole `signature` w tabeli `system_email_config`. Możesz używać HTML.

**Q: Czy mogę mieć różne skrzynki dla ofert i faktur?**
A: Obecnie faktury są wysyłane z systemowej skrzynki, a oferty z konta pracownika. W przyszłości można dodać osobną konfigurację dla ofert.

## Wsparcie

W razie problemów skontaktuj się z zespołem technicznym lub sprawdź logi w:
- Supabase → Edge Functions → Logs
- Supabase → SQL Editor → Query History
