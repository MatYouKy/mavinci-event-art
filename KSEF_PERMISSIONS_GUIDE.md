# System Uprawnień dla Faktur KSeF

## Przegląd

System faktur KSeF w aplikacji używa szczegółowego systemu uprawnień opartego na RLS (Row Level Security) w Supabase. Aby pracownik mógł przeglądać lub zarządzać fakturami KSeF, musi mieć odpowiednie uprawnienia.

## Dostępne Uprawnienia

### 1. `invoices_view` - Podgląd faktur KSeF
**Opis**: Umożliwia przeglądanie faktur pobranych z systemu KSeF
**Co może pracownik:**
- Przeglądać listę faktur wystawionych
- Przeglądać listę faktur otrzymanych
- Wyświetlać szczegóły faktur
- Pobierać pliki XML faktur

**Czego NIE może:**
- Konfigurować integracji z KSeF
- Synchronizować faktur z systemem KSeF
- Usuwać faktur
- Modyfikować danych faktur

### 2. `invoices_manage` - Zarządzanie fakturami KSeF
**Opis**: Pełne zarządzanie integracją z KSeF i fakturami
**Co może pracownik:**
- Wszystko co `invoices_view`
- Konfigurować dane dostępowe do KSeF (token, certyfikat)
- Zarządzać firmami w systemie
- Synchronizować faktury z KSeF
- Eksportować faktury
- Wysyłać faktury
- Usuwać nieaktualne faktury

### 3. `admin` - Administrator
**Opis**: Pełny dostęp do wszystkich funkcji systemu
**Co może pracownik:**
- Wszystko co `invoices_manage`
- Plus wszystkie inne moduły w systemie

## Jak Nadać Uprawnienia Pracownikowi

### Krok 1: Przejdź do Zarządzania Pracownikami
1. Zaloguj się jako administrator lub użytkownik z uprawnieniem `employees_permissions`
2. Przejdź do `/crm/employees`
3. Kliknij na pracownika, któremu chcesz nadać uprawnienia

### Krok 2: Zakładka Uprawnienia
1. Przejdź do zakładki **"Uprawnienia"**
2. Znajdź sekcję **"Faktury"**
3. Zaznacz odpowiednie uprawnienia:
   - ✅ **Podgląd faktur KSeF** - dla pracowników, którzy mają tylko przeglądać
   - ✅ **Zarządzanie fakturami KSeF** - dla księgowych i managerów

### Krok 3: Zapisz Zmiany
1. Kliknij przycisk **"Zapisz uprawnienia"**
2. System automatycznie zaktualizuje polityki RLS
3. Pracownik natychmiast otrzyma dostęp

## Przykładowe Scenariusze

### Scenariusz 1: Księgowa
**Profil**: Osoba odpowiedzialna za fakturowanie
**Potrzebne uprawnienia**: `invoices_manage`
**Uzasadnienie**: Musi mieć pełen dostęp do konfiguracji i synchronizacji faktur

### Scenariusz 2: Manager Projektu
**Profil**: Osoba sprawdzająca rozliczenia projektów
**Potrzebne uprawnienia**: `invoices_view`
**Uzasadnienie**: Wystarczy podgląd faktur, nie potrzebuje zarządzać integracją

### Scenariusz 3: Handlowiec
**Profil**: Osoba obsługująca klientów
**Potrzebne uprawnienia**: `invoices_view` (opcjonalnie)
**Uzasadnienie**: Może potrzebować sprawdzić status faktury dla klienta

### Scenariusz 4: Praktykant
**Profil**: Osoba ucząca się systemu
**Potrzebne uprawnienia**: BRAK
**Uzasadnienie**: Nie ma potrzeby dostępu do dokumentów finansowych

## Zabezpieczenia RLS

System używa następujących polityk Row Level Security:

### Tabela `ksef_credentials`
```sql
-- Tylko admin i invoices_manage mogą:
- SELECT (przeglądać dane dostępowe)
- INSERT (dodawać nowe firmy)
- UPDATE (aktualizować tokeny)
```

### Tabela `ksef_invoices`
```sql
-- Admin, invoices_view i invoices_manage mogą:
- SELECT (przeglądać faktury)

-- Tylko admin i invoices_manage mogą:
- INSERT (dodawać nowe faktury)
- UPDATE (aktualizować status)
```

### Tabela `ksef_sync_log`
```sql
-- Admin i invoices_manage mogą:
- SELECT (przeglądać logi synchronizacji)
- INSERT (tworzyć nowe logi)
```

## Automatyczna Synchronizacja

Po nadaniu uprawnień i skonfigurowaniu KSeF w `/crm/settings/ksef`:

1. **Automatyczne pobieranie** - Przy wejściu na `/crm/invoices` system automatycznie:
   - Sprawdza czy sesja KSeF jest aktywna
   - Pobiera faktury wystawione
   - Pobiera faktury otrzymane
   - Zapisuje je w lokalnej bazie danych

2. **Bez konieczności klikania** - Użytkownik widzi faktury od razu po załadowaniu strony

3. **Inteligentne cachowanie** - Faktury zapisane w bazie pozostają dostępne nawet po wygaśnięciu sesji KSeF

## Sprawdzenie Uprawnień

Możesz sprawdzić uprawnienia pracownika w bazie:

```sql
SELECT
  id,
  first_name,
  last_name,
  permissions
FROM employees
WHERE 'invoices_view' = ANY(permissions)
   OR 'invoices_manage' = ANY(permissions);
```

## Troubleshooting

### Problem: Pracownik nie widzi zakładki "Integracja KSeF"
**Rozwiązanie**: Sprawdź czy ma uprawnienie `invoices_view` lub `invoices_manage`

### Problem: Pracownik widzi zakładkę, ale faktury są puste
**Możliwe przyczyny**:
1. Nie skonfigurowano jeszcze integracji KSeF w `/crm/settings/ksef`
2. Sesja KSeF wygasła - wymagane ponowne uwierzytelnienie
3. Firma nie ma żadnych faktur w systemie KSeF

### Problem: Pracownik nie może zsynchronizować faktur
**Rozwiązanie**: Upewnij się, że ma uprawnienie `invoices_manage` (nie tylko `invoices_view`)

## Najlepsze Praktyki

1. **Minimalne uprawnienia** - Nadawaj tylko te uprawnienia, które są naprawdę potrzebne
2. **Regularne audyty** - Sprawdzaj okresowo kto ma dostęp do faktur
3. **Dokumentacja** - Dokumentuj powody nadania uprawnień (np. w notatkach pracownika)
4. **Szkolenia** - Upewnij się, że pracownicy rozumieją odpowiedzialność związaną z dostępem do faktur

## Zobacz Również

- [System Uprawnień - Ogólny Przewodnik](/src/lib/permissions.ts)
- [Konfiguracja KSeF](/crm/settings/ksef)
- [Dokumentacja RLS Policies](/supabase/migrations/20260401144328_create_ksef_integration_system.sql)
