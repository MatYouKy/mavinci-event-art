# Naprawiono uprawnienia do modułu Kontakty

## Problem

Pracownik, który otrzymał uprawnienie `contacts_view` w panelu uprawnień pracownika, **nie mógł wejść na stronę `/crm/contacts`** - wyświetlał się komunikat "Brak uprawnień".

### Przyczyny problemu:

1. **Brak modułu `contacts` w systemie uprawnień** (`src/lib/permissions.ts`):
   - Lista `MODULES` nie zawierała modułu `contacts`
   - Lista `MODULES_WITH_CREATE` nie zawierała modułu `contacts`
   - Funkcja `getAllScopes()` nie generowała uprawnień dla kontaktów

2. **Brak PermissionGuard na stronie** (`src/app/(crm)/crm/contacts/page.tsx`):
   - Strona nie była zabezpieczona komponentem `PermissionGuard`
   - Nawet jeśli pracownik miał uprawnienie, strona nie weryfikowała dostępu

3. **Niespójność w nazewnictwie**:
   - W nawigacji (`registry.server.ts`) używano `module: 'clients'` ale `permissions: ['contacts_view']`
   - W panelu uprawnień była kategoria "Kontakty" z kluczem `contacts`
   - System nie wiedział czy chodzi o `clients` czy `contacts`

## Rozwiązanie

### 1. ✅ Dodano moduł `contacts` do systemu uprawnień

**Plik:** `src/lib/permissions.ts`

#### Zaktualizowano dokumentację:
```typescript
/**
 * Dostępne scope:
 * ...
 * - contacts_view, contacts_manage, contacts_create
 * ...
 */
```

#### Dodano do listy MODULES:
```typescript
export const MODULES = [
  'equipment',
  'employees',
  'clients',
  'contacts',        // ← NOWY
  'events',
  // ...
  'databases',       // ← DODANY TAKŻE
] as const;
```

#### Dodano do MODULES_WITH_CREATE:
```typescript
const MODULES_WITH_CREATE = [
  'equipment',
  'employees',
  'clients',
  'contacts',        // ← NOWY
  'events',
  // ...
] as const;
```

#### Zaktualizowano getAllScopes():
```typescript
export const getAllScopes = (): string[] => {
  const scopes: string[] = [];
  MODULES.forEach((module) => {
    scopes.push(`${module}_view`, `${module}_manage`);
    if (MODULES_WITH_CREATE.includes(module as any)) {
      scopes.push(`${module}_create`);
    }
  });
  scopes.push('employees_permissions');
  scopes.push('messages_assign');
  scopes.push('contacts_manage');     // ← NOWY
  scopes.push('event_categories_manage');
  scopes.push('website_edit');
  return scopes;
};
```

### 2. ✅ Dodano PermissionGuard do strony kontaktów

**Plik:** `src/app/(crm)/crm/contacts/page.tsx`

```typescript
import PermissionGuard from '@/components/crm/PermissionGuard';

export default function ContactsPage() {
  // ... logika komponentu ...

  return (
    <PermissionGuard module="contacts">
      <div className="min-h-screen bg-[#0f1119] p-6">
        {/* Cała zawartość strony */}
      </div>
    </PermissionGuard>
  );
}
```

## Jak to teraz działa

### Krok po kroku:

1. **Administrator przypisuje uprawnienie w panelu pracownika:**
   - Wchodzi w zakładkę "Uprawnienia"
   - W sekcji "Kontakty" ustawia poziom "Przeglądanie" lub "Zarządzanie"
   - Zapisuje zmiany

2. **System zapisuje w bazie:**
   ```json
   {
     "permissions": ["contacts_view"]
   }
   ```
   lub
   ```json
   {
     "permissions": ["contacts_manage"]
   }
   ```

3. **Pracownik próbuje wejść na `/crm/contacts`:**
   - Strona jest opakowana w `PermissionGuard module="contacts"`
   - Guard sprawdza czy pracownik ma `contacts_view` lub `contacts_manage`
   - Jeśli TAK → pokazuje stronę
   - Jeśli NIE → pokazuje "Brak uprawnień" i przekierowuje do `/crm`

4. **Nawigacja pokazuje link do Kontakty:**
   - W `registry.server.ts` pozycja ma `permissions: ['contacts_view']`
   - System sprawdza czy pracownik ma to uprawnienie
   - Jeśli TAK → pokazuje link w menu
   - Jeśli NIE → ukrywa link

## Dostępne poziomy uprawnień dla Kontaktów

| Uprawnienie | Opis | Co może robić |
|-------------|------|---------------|
| **Brak** | Brak dostępu | Nie widzi modułu w menu, nie może wejść |
| **contacts_view** | Przeglądanie | Może przeglądać listę kontaktów i szczegóły |
| **contacts_manage** | Zarządzanie | Może edytować i usuwać kontakty |
| **contacts_create** | Tworzenie | Może tworzyć nowe kontakty |
| **contacts_manage** (extra) | Przypisywanie | Może przypisywać kontakty do pracowników |

## Dodatkowe uprawnienia (Extra Permissions)

W panelu uprawnień pracownika jest także checkbox:
```
☑ Przypisywanie kontaktów
  Może przypisywać kontakty do pracowników
```

To dodaje uprawnienie: `contacts_manage` (extra permission)

## Testowanie

### Test 1: Pracownik BEZ uprawnień
1. Usuń wszystkie uprawnienia do kontaktów
2. Zapisz zmiany
3. Odśwież stronę jako ten pracownik
4. ✅ Link "Kontakty" nie powinien być widoczny w menu
5. ✅ Próba wejścia na `/crm/contacts` → przekierowanie z komunikatem "Brak uprawnień"

### Test 2: Pracownik z uprawnieniem "Przeglądanie"
1. Przypisz `contacts_view`
2. Zapisz zmiany
3. Odśwież stronę jako ten pracownik
4. ✅ Link "Kontakty" jest widoczny w menu
5. ✅ Strona `/crm/contacts` się otwiera
6. ✅ Pracownik widzi listę kontaktów
7. ❌ Nie może edytować ani usuwać kontaktów

### Test 3: Pracownik z uprawnieniem "Zarządzanie"
1. Przypisz `contacts_manage`
2. Zapisz zmiany
3. Odśwież stronę jako ten pracownik
4. ✅ Link "Kontakty" jest widoczny w menu
5. ✅ Strona `/crm/contacts` się otwiera
6. ✅ Może przeglądać kontakty
7. ✅ Może edytować kontakty
8. ✅ Może usuwać kontakty

### Test 4: Administrator
1. Administrator ma zawsze pełny dostęp
2. ✅ Widzi wszystkie moduły w menu
3. ✅ Ma dostęp do wszystkich funkcji
4. ✅ Może zarządzać uprawnieniami innych pracowników

## Struktura uprawnień w bazie

### Tabela `employees`:
```sql
-- Kolumna permissions (TEXT[])
permissions: ['contacts_view', 'events_manage', 'tasks_view', ...]
```

### Przykładowe uprawnienia pracownika:
```json
{
  "id": "uuid-pracownika",
  "permissions": [
    "dashboard_view",
    "calendar_view",
    "events_view",
    "contacts_view",      // ← może przeglądać kontakty
    "tasks_view",
    "tasks_manage",
    "messages_view"
  ]
}
```

### Administrator:
```json
{
  "id": "uuid-admina",
  "role": "admin",
  "permissions": []  // pusty - admin ma wszystko automatycznie
}
```

## Podsumowanie zmian

### Zmiany w kodzie:
1. ✅ `src/lib/permissions.ts` - dodano moduł `contacts` i `databases`
2. ✅ `src/app/(crm)/crm/contacts/page.tsx` - dodano `PermissionGuard`

### Pliki bez zmian (ale ważne dla zrozumienia):
- `src/lib/CRM/navigation/registry.server.ts` - definicja nawigacji (już poprawna)
- `src/components/crm/EmployeePermissionsTab.tsx` - panel uprawnień (już poprawny)
- `src/components/crm/PermissionGuard.tsx` - komponent zabezpieczający (już istniał)

### Co było poprawnie wcześniej:
- ✅ Panel uprawnień pracownika miał kategorię "Kontakty"
- ✅ Nawigacja wymagała `contacts_view`
- ✅ Struktura bazy danych była poprawna

### Co było źle:
- ❌ System uprawnień nie znał modułu `contacts`
- ❌ Strona nie była zabezpieczona `PermissionGuard`

## Migracja danych

**NIE jest wymagana migracja bazy danych!**

Jeśli pracownicy mieli już przypisane uprawnienia `contacts_view` lub `contacts_manage`, będą one działać automatycznie po wdrożeniu tych zmian.

## Uwagi

- Moduł `clients` nadal istnieje w systemie i jest używany w innych miejscach
- Teraz mamy 2 moduły: `clients` i `contacts` - oba są prawidłowe
- `clients` może być używany do zarządzania klientami jako jednostkami biznesowymi
- `contacts` jest używany do zarządzania kontaktami (osoby i organizacje)
