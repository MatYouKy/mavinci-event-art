# Wystawianie Faktur KSeF Bezpośrednio z Eventu

## Nowa Funkcjonalność

Dodano możliwość wystawiania faktur VAT bezpośrednio z zakładki **Finanse** w szczegółach eventu z automatyczną integracją KSeF.

## Lokalizacja

`/crm/events/[id]` → Zakładka **Finanse** → Przycisk **"Wystaw fakturę do KSeF"**

## Funkcje

### 1. Automatyczne Wypełnianie Danych

**Z Oferty:**
- Wszystkie pozycje z zaakceptowanej oferty
- Kwoty netto i brutto
- Stawki VAT
- Ilości

**Z Eventu:**
- Dane nabywcy (organizacja lub kontakt)
- NIP, adres
- Data sprzedaży (data eventu)
- Nazwa usługi

### 2. Walidacja Przed Wysłaniem

System sprawdza:
- ✅ Czy wybrano firmę wystawiającą
- ✅ Czy istnieje zaakceptowana oferta
- ✅ Czy klient ma uzupełniony NIP (wymagany dla KSeF)
- ✅ Czy klient ma kompletne dane adresowe
- ✅ Czy firma ma skonfigurowane kredencjały KSeF
- ✅ Czy faktura spełnia wymagania formatu FA(2)

### 3. Pełna Integracja z KSeF

**Proces wysyłania:**
1. Tworzenie faktury w bazie danych
2. Generowanie numeru faktury
3. Dodanie pozycji z oferty
4. Generowanie XML FA(2)
5. Uwierzytelnienie w KSeF (jeśli token wygasł)
6. Wysłanie faktury do KSeF
7. Zapisanie w tabeli `ksef_invoices`
8. Aktualizacja statusu na "issued"
9. Dodanie do historii

### 4. Szczegółowe Komunikaty Błędów

**Rodzaje błędów:**

**Błędy walidacji (przed wysłaniem):**
- Brak zaakceptowanej oferty
- Niekompletne dane klienta (brak NIP, adresu)
- Brak konfiguracji KSeF dla firmy
- Niepoprawne dane faktury

**Błędy KSeF:**
- Błędy autoryzacji (wygasły certyfikat, błędne kredencjały)
- Błędy walidacji XML FA(2)
- Błędy komunikacji z API KSeF
- Duplikacja faktury

**Wszystkie błędy wyświetlane są przez snackbar z szczegółowymi informacjami.**

## Struktura Plików

```
src/app/(crm)/crm/events/[id]/
├── components/
│   ├── IssueInvoiceFromEventModal.tsx    # Nowy modal
│   └── tabs/
│       └── EventFinancesTab.tsx          # Zaktualizowany
```

## Interfejs Użytkownika

### Modal "Wystaw Fakturę do KSeF"

**Sekcje:**

1. **Firma wystawiająca** - wybór z listy aktywnych firm
2. **Oferta bazowa** - automatyczny wybór zaakceptowanej oferty
3. **Nabywca** - podgląd danych klienta z eventu
4. **Daty** - data wystawienia, data sprzedaży (z eventu), termin płatności
5. **Pozycje** - podgląd pozycji z oferty
6. **Podsumowanie** - kwota brutto

**Przyciski:**
- **Sprawdź poprawność** - walidacja przed wysłaniem
- **Wystaw i wyślij do KSeF** - pełny proces

## Workflow

### Scenariusz 1: Standardowe Wystawienie Faktury

1. Przejdź do eventu: `/crm/events/[id]`
2. Otwórz zakładkę **Finanse**
3. Kliknij **"Wystaw fakturę do KSeF"**
4. Sprawdź/wybierz firmę wystawiającą
5. Sprawdź dane nabywcy i oferty
6. Dostosuj daty jeśli potrzeba
7. (Opcjonalnie) Kliknij **"Sprawdź poprawność"**
8. Kliknij **"Wystaw i wyślij do KSeF"**
9. Poczekaj na potwierdzenie wysłania

**Rezultat:**
- Faktura utworzona w systemie
- Faktura wysłana do KSeF
- Status: "issued"
- Numer referencyjny KSeF zapisany

### Scenariusz 2: Wykrycie Błędów

1. Otwórz modal wystawienia faktury
2. System automatycznie sprawdza dane
3. Jeśli są błędy - wyświetla czerwony panel z listą problemów
4. Popraw dane w systemie (np. uzupełnij NIP klienta)
5. Zamknij i otwórz modal ponownie
6. Kliknij **"Sprawdź poprawność"**
7. Jeśli OK - wystaw fakturę

### Scenariusz 3: Brak Zaakceptowanej Oferty

**Problem:** Event nie ma zaakceptowanej oferty

**Rozwiązanie:**
1. Zamknij modal
2. Przejdź do zakładki **Oferty**
3. Zaakceptuj odpowiednią ofertę
4. Wróć do zakładki **Finanse**
5. Otwórz modal ponownie
6. Wystaw fakturę

## Komunikaty i Błędy

### Komunikaty Sukcesu

```
✓ "Faktura FV/001/2026 została wystawiona i wysłana do KSeF"
✓ "Walidacja przeszła pomyślnie - można wystawić fakturę"
✓ "Dane pobrane z oferty"
```

### Komunikaty Błędów

#### Błędy Walidacji
```
✗ "Wybierz firmę wystawiającą fakturę"
✗ "Brak zaakceptowanej oferty dla tego eventu"
✗ "Klient nie ma uzupełnionego numeru NIP - wymagany do KSeF"
✗ "Klient nie ma kompletnych danych adresowych"
✗ "Wybrana firma nie ma skonfigurowanych danych uwierzytelniających KSeF"
```

#### Błędy KSeF
```
✗ "Nie udało się wygenerować numeru faktury"
✗ "Nie udało się utworzyć faktury"
✗ "Nie udało się dodać pozycji faktury"
✗ "Błąd KSeF: [szczegóły]"
✗ "Błędy KSeF:
   - Nieprawidłowy NIP nabywcy
   - Brak wymaganego pola: seller_street"
```

### Komunikaty Informacyjne

```
ℹ "Wysyłka do KSeF: Faktura zostanie automatycznie wysłana do Krajowego Systemu
   e-Faktur. Przed wysłaniem sprawdzana jest poprawność danych oraz dostępność
   certyfikatów."
```

## Wymagania Techniczne

### Dane Klienta (Obowiązkowe dla KSeF)

- **NIP** - 10 cyfr
- **Nazwa/Imię i nazwisko**
- **Ulica i numer**
- **Kod pocztowy** - format XX-XXX
- **Miasto**

### Konfiguracja Firmy

Firma wystawiająca musi mieć:
- Aktywne konto w tabeli `my_companies`
- Skonfigurowane kredencjały KSeF w tabeli `ksef_credentials`:
  - NIP
  - Token autoryzacyjny
  - Certyfikat (jeśli wymagany)
  - Flaga `is_active = true`

### Oferta

- Status: `accepted`
- Minimum 1 pozycja
- Poprawne stawki VAT (0%, 5%, 8%, 23%)

## Bezpieczeństwo

### Uprawnienia

- Wymagane: `invoices_manage` lub `finances_manage`
- Dostęp do zakładki Finanse
- Dostęp do danych eventu

### Walidacja na Poziomie API

Endpoint `/api/ksef/invoices/send` sprawdza:
- Czy użytkownik ma uprawnienia
- Czy faktura nie została już wysłana
- Czy faktura spełnia wymagania FA(2)
- Czy firma ma aktywne kredencjały KSeF

### Szyfrowanie

- Token KSeF jest szyfrowany certyfikatem publicznym
- Komunikacja z API KSeF przez HTTPS
- Certyfikaty przechowywane bezpiecznie w bazie

## Tabele Bazy Danych

### Tabele Związane z KSeF

**`ksef_invoices`** - faktury wysłane do KSeF
```sql
- invoice_id (FK do invoices)
- ksef_reference_number (numer referencyjny)
- sync_status ('synced', 'pending', 'error')
- xml_content (wygenerowany XML FA(2))
- ksef_issued_at
- my_company_id (FK)
```

**`ksef_credentials`** - dane uwierzytelniające
```sql
- my_company_id (FK)
- nip
- token (zaszyfrowany)
- access_token
- access_token_valid_until
- is_active
- is_test_environment
```

**`invoices`** - faktury
```sql
- status ('draft', 'issued', 'paid', 'cancelled')
- event_id (FK)
- organization_id (FK - nabywca)
- my_company_id (FK - sprzedawca)
- invoice_number
- ...wszystkie dane faktury
```

## Testowanie

### Test 1: Podstawowe Wystawienie
1. Utwórz event z organizacją (kompletne dane + NIP)
2. Dodaj i zaakceptuj ofertę
3. Skonfiguruj kredencjały KSeF dla firmy
4. Otwórz Finanse → "Wystaw fakturę do KSeF"
5. Wystaw fakturę
6. Sprawdź czy status = 'issued'
7. Sprawdź czy pojawił się wpis w `ksef_invoices`

### Test 2: Walidacja Danych
1. Utwórz event bez NIP klienta
2. Spróbuj wystawić fakturę
3. Sprawdź czy pojawia się błąd walidacji
4. Uzupełnij NIP
5. Spróbuj ponownie

### Test 3: Brak Oferty
1. Utwórz event bez oferty
2. Spróbuj wystawić fakturę
3. Sprawdź komunikat o braku oferty
4. Dodaj i zaakceptuj ofertę
5. Wystaw fakturę pomyślnie

### Test 4: Błąd KSeF
1. Ustaw niepoprawne kredencjały KSeF
2. Spróbuj wystawić fakturę
3. Sprawdź czy pojawia się szczegółowy błąd
4. Popraw kredencjały
5. Ponów wysyłkę

## API Endpoints

### POST `/api/ksef/invoices/send`

**Request:**
```json
{
  "invoiceId": "uuid"
}
```

**Response (sukces):**
```json
{
  "success": true,
  "message": "Faktura została pomyślnie wysłana do KSeF",
  "ksef_reference_number": "1234567890-20260101-ABCD-123",
  "ksef_timestamp": "2026-01-01T12:00:00Z",
  "invoice": {...}
}
```

**Response (błąd):**
```json
{
  "error": "Błąd podczas wysyłania faktury do KSeF",
  "details": "Nieprawidłowy format NIP" // lub array
}
```

## Przyszłe Usprawnienia

- [ ] Możliwość edycji pozycji przed wysłaniem
- [ ] Podgląd PDF faktury przed wysłaniem
- [ ] Automatyczne wysyłanie faktury email do klienta
- [ ] Bulk wystawianie faktur dla wielu eventów
- [ ] Import statusów płatności z banku
- [ ] Przypomnienia o niezapłaconych fakturach
- [ ] Integracja z systemem księgowym

## Logi i Monitoring

### Logi w Console

```javascript
// Sukces
"Generated FA(2) XML: { invoiceId, invoiceNumber, xmlLength }"
"KSeF send response: { referenceNumber, timestamp }"

// Błędy
"Error sending invoice to KSeF: [error]"
"Error checking KSeF credentials: [error]"
```

### Historia Zmian

Każda operacja jest logowana w `invoice_history`:
```sql
INSERT INTO invoice_history (
  invoice_id,
  action, -- 'created_from_event', 'sent_to_ksef'
  changed_by,
  changes -- { event_id, offer_id, ksef_reference }
)
```

## Kontakt i Wsparcie

W przypadku problemów:
1. Sprawdź logi w console przeglądarki
2. Sprawdź logi serwera (API routes)
3. Zweryfikuj konfigurację KSeF
4. Sprawdź status API KSeF (test/produkcja)
