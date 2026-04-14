# Konfiguracja Reset Hasła

## Problem rozwiązany

1. **Nieprawidłowe przekierowanie z maila** - link resetujący kierował na `/crm/reset-password`, ale strona jest pod `/reset-password`
2. **Błąd "not valid JSON" z poziomu admina** - próba parsowania HTML jako JSON gdy endpoint zwraca błąd 404/500

## Wymagana konfiguracja Supabase

Aby reset hasła działał prawidłowo, musisz skonfigurować **Redirect URLs** w Supabase Dashboard:

### Krok 1: Otwórz Supabase Dashboard
1. Przejdź do: https://app.supabase.com
2. Wybierz swój projekt
3. Przejdź do: **Authentication** → **URL Configuration**

### Krok 2: Dodaj Redirect URLs
W sekcji **Redirect URLs** dodaj następujące adresy:

**Dla środowiska lokalnego:**
```
http://localhost:3000/reset-password
```

**Dla środowiska produkcyjnego:**
```
https://twoja-domena.pl/reset-password
https://www.twoja-domena.pl/reset-password
```

### Krok 3: Zapisz zmiany
Kliknij **Save** na dole strony.

## Jak działa reset hasła

### Dla użytkowników (z poziomu loginu):

1. Użytkownik klika "Zapomniałeś hasła?" na stronie logowania
2. Wpisuje swój email
3. System wysyła email z linkiem resetującym
4. Link prowadzi do `/reset-password` (naprawione!)
5. Użytkownik wpisuje nowe hasło i je potwierdza
6. System aktualizuje hasło przez `supabase.auth.updateUser()`

### Dla adminów (z poziomu CRM):

1. Admin otwiera profil pracownika
2. Klika "Resetuj hasło"
3. Wpisuje nowe hasło i je potwierdza
4. System wywołuje endpoint `/bridge/reset-employee-password`
5. Endpoint sprawdza uprawnienia (admin lub employees_manage)
6. Hasło jest zmieniane przez `supabaseAdmin.auth.admin.updateUserById()`

## Zabezpieczenia

- Reset hasła wymaga:
  - Minimalnie 8 znaków
  - Co najmniej 1 wielką literę
  - Co najmniej 1 małą literę
  - Co najmniej 1 cyfrę

- Uprawnienia do resetu przez admina:
  - `access_level = 'admin'`
  - LUB `permissions` zawiera `'employees_manage'`
  - LUB `permissions` zawiera `'admin'`

## Testowanie

### Test 1: Reset z poziomu loginu
1. Otwórz `/login`
2. Kliknij "Zapomniałeś hasła?"
3. Wpisz email pracownika
4. Sprawdź pocztę i kliknij link
5. Link powinien prowadzić do `/reset-password` (nie `/crm/reset-password`)
6. Ustaw nowe hasło
7. Zaloguj się nowym hasłem

### Test 2: Reset z poziomu admina
1. Zaloguj się jako admin
2. Przejdź do `/crm/employees`
3. Kliknij na pracownika → "Resetuj hasło"
4. Wpisz nowe hasło i potwierdź
5. Powinieneś zobaczyć snackbar z sukcesem (nie błąd JSON)
6. Pracownik powinien móc się zalogować nowym hasłem

## Rozwiązane problemy

### 1. Nieprawidłowe przekierowanie
**Przed:**
```typescript
redirectTo: `${window.location.origin}/crm/reset-password`
```

**Po:**
```typescript
redirectTo: `${window.location.origin}/reset-password`
```

### 2. Błąd parsowania JSON
**Przed:**
```typescript
const data = await response.json(); // Błąd gdy response to HTML
```

**Po:**
```typescript
const contentType = response.headers.get('content-type');
if (!contentType || !contentType.includes('application/json')) {
  throw new Error('Błąd serwera - nieprawidłowa odpowiedź...');
}
const data = await response.json();
```

## Uwagi

- Link resetujący jest ważny przez 1 godzinę (domyślnie w Supabase)
- Po użyciu linku nie można go użyć ponownie
- Każde żądanie resetu generuje nowy link i unieważnia poprzedni
