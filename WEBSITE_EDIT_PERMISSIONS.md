# System Uprawnień do Edycji Strony WWW

## Problem
Wcześniej przycisk "Włącz tryb edycji" był widoczny dla **wszystkich** zalogowanych użytkowników CRM, co pozwalało pracownikom bez odpowiednich uprawnień na edycję treści i obrazów na stronie WWW.

## Rozwiązanie
Zaimplementowano kontrolę dostępu opartą o system uprawnień (`permissions`):

### 1. Uprawnienie `website_edit`
W systemie istnieje uprawnienie `website_edit` definiowane w `/src/lib/permissions.ts`:
- Tylko administratorzy i pracownicy z tym uprawnieniem mogą widzieć przycisk trybu edycji
- Funkcja `canEditWebsite(employee)` sprawdza czy użytkownik ma dostęp

### 2. Zmiany w Navbar
**Plik**: `/src/components/Navbar.tsx`

**Przed:**
```typescript
{(crmUser || authUser) && (
  <button onClick={toggleEditMode}>
    Włącz tryb edycji
  </button>
)}
```

**Po:**
```typescript
{(authUser || canEditWebsite(employee)) && (
  <button onClick={toggleEditMode}>
    Włącz tryb edycji
  </button>
)}
```

### 3. Pobieranie Uprawnień
Navbar teraz pobiera pełne dane pracownika włącznie z uprawnieniami:

```typescript
const { data: employeeData } = await supabase
  .from('employees')
  .select('id, name, surname, nickname, email, avatar_url, avatar_metadata, access_level, permissions, role')
  .eq('email', session.user.email)
  .maybeSingle();
```

## Jak Nadać Uprawnienie do Edycji Strony

### Opcja 1: Przez Panel CRM
1. Zaloguj się jako administrator
2. Przejdź do **CRM → Pracownicy**
3. Kliknij na pracownika
4. Przejdź do zakładki **Uprawnienia**
5. Zaznacz uprawnienie **"Edycja strony WWW (website_edit)"**
6. Zapisz zmiany

### Opcja 2: Przez SQL (Supabase Dashboard)
```sql
-- Dodaj uprawnienie website_edit dla konkretnego pracownika
UPDATE employees
SET permissions = array_append(permissions, 'website_edit')
WHERE email = 'pracownik@mavinci.pl';

-- Lub ustaw wszystkie uprawnienia na raz
UPDATE employees
SET permissions = ARRAY[
  'equipment_view',
  'equipment_manage',
  'clients_view',
  'website_edit'
]
WHERE email = 'pracownik@mavinci.pl';
```

### Opcja 3: Ustaw jako Admin
Administratorzy mają automatycznie dostęp do wszystkiego:

```sql
UPDATE employees
SET access_level = 'admin'
WHERE email = 'pracownik@mavinci.pl';
```

## Komponenty Chronione

### 1. Navbar (Desktop i Mobile)
- Przycisk "Włącz tryb edycji" w menu użytkownika

### 2. WebsiteEditButton
Komponent używa `useWebsiteEdit()` hook, który automatycznie sprawdza uprawnienia:
```typescript
const { canEdit, loading } = useWebsiteEdit();
if (!canEdit) return null; // Nie pokazuje przycisku
```

### 3. EditableImage i EditableContent
Te komponenty sprawdzają tylko `isEditMode` z contextu, więc kontrola dostępu odbywa się na poziomie przełącznika trybu edycji (Navbar).

## Hierarchia Dostępu

1. **Administrator** (`access_level = 'admin'`)
   - Pełny dostęp do wszystkiego, w tym edycji strony WWW
   - Nie wymaga dodatkowych uprawnień

2. **Pracownik z uprawnieniem `website_edit`**
   - Może przełączać tryb edycji
   - Może edytować treści i obrazy na stronie WWW
   - Dostęp do panelu admina strony (`/admin/dashboard`)

3. **Pracownik bez uprawnień**
   - Nie widzi przycisku "Włącz tryb edycji"
   - Nie może edytować strony WWW
   - Ma dostęp tylko do CRM zgodnie ze swoimi uprawnieniami

## Weryfikacja Uprawnień

Aby sprawdzić czy pracownik ma uprawnienie do edycji strony:

```sql
SELECT
  email,
  access_level,
  permissions,
  CASE
    WHEN access_level = 'admin' THEN true
    WHEN 'website_edit' = ANY(permissions) THEN true
    ELSE false
  END as can_edit_website
FROM employees;
```

## Bezpieczeństwo

### Warstwa Frontend
- Przycisk trybu edycji jest ukryty dla nieuprawnioanych
- Komponenty edycyjne sprawdzają `isEditMode` z contextu

### Warstwa Backend (Supabase RLS)
Tabele związane ze stroną WWW (np. `site_images`, `team_members`, `portfolio_projects`) mają polityki RLS:
- Publiczny odczyt (SELECT)
- Tylko użytkownicy z odpowiednimi uprawnieniami mogą edytować (UPDATE, INSERT, DELETE)

Przykład polityki RLS:
```sql
CREATE POLICY "Allow authenticated users with website_edit to update"
ON site_images FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM employees
    WHERE email = auth.jwt()->>'email'
    AND (
      access_level = 'admin' OR
      'website_edit' = ANY(permissions)
    )
  )
);
```

## Troubleshooting

### Problem: Pracownik nie widzi przycisku edycji mimo uprawnień
**Rozwiązanie**:
1. Sprawdź czy pracownik ma uprawnienie `website_edit` w bazie danych
2. Wyloguj i zaloguj ponownie (odśwież token sesji)
3. Sprawdź konsolę przeglądarki czy są błędy

### Problem: Przycisk jest widoczny ale edycja nie działa
**Rozwiązanie**:
1. Sprawdź polityki RLS dla odpowiednich tabel
2. Upewnij się że pracownik ma aktywną sesję Supabase
3. Sprawdź czy token JWT zawiera poprawny email

### Problem: Administrator nie widzi przycisku
**Rozwiązanie**:
Sprawdź czy pole `access_level` jest ustawione na `'admin'` w tabeli `employees`:
```sql
SELECT access_level FROM employees WHERE email = 'admin@mavinci.pl';
```
