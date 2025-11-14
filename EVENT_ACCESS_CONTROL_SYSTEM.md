# System Kontroli Dostępu do Wydarzeń

## Koncepcja

System rozróżnia 3 poziomy dostępu do wydarzeń:

### 1. **AUTOR** (Event Creator)

- Osoba która stworzyła wydarzenie
- Ma **pełną kontrolę** nad wszystkim
- Może edytować wydarzenie, zarządzać zespołem, przydzielać uprawnienia
- Nie można mu odebrać dostępu

### 2. **ZAPROSZENI** (Invited Members)

- Domyślnie mają dostęp **tylko do odczytu**
- Widzą podstawowe informacje (zgodnie z ich `access_level`)
- Przykład: DJ widzi agendę i pliki, Technik widzi sprzęt

### 3. **WSPÓŁPRACOWNICY** (Collaborators)

- Zaproszeni członkowie z **podwyższonymi uprawnieniami**
- Mogą edytować wybrane aspekty wydarzenia
- Autor/Admin nadaje im konkretne uprawnienia

---

## Szczegółowe Uprawnienia

Każdy członek zespołu (w `employee_assignments`) może mieć następujące uprawnienia:

| Uprawnienie              | Kolumna              | Opis                                         |
| ------------------------ | -------------------- | -------------------------------------------- |
| **Edycja wydarzenia**    | `can_edit_event`     | Może zmieniać nazwę, datę, lokalizację, opis |
| **Edycja agendy**        | `can_edit_agenda`    | Może zarządzać harmonogramem                 |
| **Edycja zadań**         | `can_edit_tasks`     | Może tworzyć/edytować/usuwać zadania         |
| **Edycja plików**        | `can_edit_files`     | Może dodawać/usuwać pliki                    |
| **Edycja sprzętu**       | `can_edit_equipment` | Może zarządzać przypisanym sprzętem          |
| **Zapraszanie członków** | `can_invite_members` | Może zapraszać innych ludzi                  |
| **Widok budżetu**        | `can_view_budget`    | Widzi informacje finansowe                   |

---

## Historia Zmian (Audit Log)

Każda zmiana jest **automatycznie zapisywana** w tabeli `event_audit_log`:

- **Kto** wykonał akcję (`employee_id`)
- **Co** zostało zmienione (`action`, `entity_type`)
- **Kiedy** (`created_at`)
- **Jakie wartości** przed i po zmianie (`old_value`, `new_value`)
- **Dodatkowy kontekst** (`metadata`)

### Śledzone akcje:

- `create` - tworzenie nowych elementów
- `update` - edycja istniejących
- `delete` - usuwanie
- `invite` - zapraszanie członków
- `accept` / `reject` - odpowiedzi na zaproszenia
- `grant_permission` - nadawanie uprawnień
- `revoke_permission` - odbieranie uprawnień

---

## Jak to działa?

### 1. Zapraszanie członka zespołu

```sql
-- Autor zaprasza DJ-a
INSERT INTO employee_assignments (
  event_id,
  employee_id,
  role,
  status,
  access_level_id, -- poziom "DJ" z ograniczonym dostępem
  can_edit_event,  -- false (domyślnie)
  can_edit_tasks   -- false (domyślnie)
) VALUES (
  'event-uuid',
  'dj-uuid',
  'DJ',
  'pending',
  (SELECT id FROM access_levels WHERE slug = 'dj'),
  false,
  false
);
-- Automatycznie logowane w event_audit_log
```

### 2. Nadawanie uprawnień "Współpracuj"

```sql
-- Autor/Admin nadaje DJ-owi prawo do edycji agendy i zadań
UPDATE employee_assignments
SET
  can_edit_agenda = true,
  can_edit_tasks = true,
  granted_by = 'author-uuid',
  permissions_updated_at = now()
WHERE id = 'assignment-uuid';
-- Automatycznie logowane w event_audit_log
```

### 3. Sprawdzanie uprawnień

```sql
-- Funkcja pomocnicza
SELECT can_user_perform_action(
  'event-uuid',  -- ID wydarzenia
  'user-uuid',   -- ID użytkownika
  'edit_tasks'   -- akcja do sprawdzenia
);
-- Zwraca: true/false
```

### 4. Wyświetlanie historii zmian

```sql
SELECT
  eal.created_at,
  eal.action,
  eal.entity_type,
  eal.field_name,
  eal.old_value,
  eal.new_value,
  emp.nickname as who_changed
FROM event_audit_log eal
JOIN employees emp ON emp.id = eal.employee_id
WHERE eal.event_id = 'event-uuid'
ORDER BY eal.created_at DESC;
```

---

## Widok pomocniczy

Dla łatwiejszego dostępu do uprawnień stworzono widok `event_member_permissions`:

```sql
SELECT * FROM event_member_permissions
WHERE event_id = 'event-uuid'
AND employee_id = 'user-uuid';

-- Zwraca:
-- - is_creator (boolean)
-- - access_level_name ('DJ', 'Technik', etc.)
-- - wszystkie uprawnienia (can_edit_*)
-- - kto nadał uprawnienia (granted_by)
-- - kiedy (permissions_updated_at)
```

---

## Przykład przepływu

### Scenariusz: Organizacja koncertu

1. **Marek (Manager)** tworzy wydarzenie "Koncert firmowy"
   - Status: AUTOR - pełna kontrola
   - Historia: `[CREATE event]`

2. Marek zaprasza **DJ-a Wojtka**
   - Status: ZAPROSZONY - widzi agendę i pliki
   - Uprawnienia: tylko odczyt
   - Historia: `[INVITE member: Wojtek (DJ)]`

3. Wojtek akceptuje zaproszenie
   - Historia: `[ACCEPT invitation: Wojtek]`

4. Marek nadaje Wojtkowi uprawnienia "Współpracuj"
   - Wojtek dostaje: `can_edit_agenda = true`, `can_edit_tasks = true`
   - Historia: `[GRANT_PERMISSION: Wojtek - edit_agenda, edit_tasks]`

5. Wojtek dodaje zadania do agendy
   - Historia: `[CREATE task: "Przygotować playlistę"] by Wojtek`

6. Marek zmienia datę wydarzenia
   - Historia: `[UPDATE event: date changed from X to Y] by Marek`

7. Wojtek próbuje zmienić lokalizację
   - ❌ **Odmowa** - nie ma `can_edit_event`
   - System loguje próbę (opcjonalnie)

8. Marek przegląda historię
   - Widzi wszystkie akcje: kto, co, kiedy
   - Nie ma wymigiwania się!

---

## Migracje do zastosowania

### 1. Podstawowy system kontroli dostępu

```
supabase/migrations/20251017010000_create_event_access_control_system.sql
```

Dodaje:

- Kolumny uprawnień do `employee_assignments`
- Tabelę `event_audit_log`
- Triggery automatycznego logowania
- Funkcje pomocnicze
- Widok `event_member_permissions`

### 2. Aktualizacja RLS policies

```
supabase/migrations/20251017010001_update_events_rls_with_access_control.sql
```

Aktualizuje RLS aby respektowały nowy system uprawnień:

- `events` - edycja tylko dla autorów i współpracowników z `can_edit_event`
- `employee_assignments` - zapraszanie przez współpracowników z `can_invite_members`
- `tasks` - zarządzanie dla współpracowników z `can_edit_tasks`

---

## Bezpieczeństwo

✅ **Autor zawsze ma pełną kontrolę** - nie można mu odebrać dostępu
✅ **Admini (events_manage) mają pełny dostęp** - do audytu i zarządzania
✅ **Zaproszeni domyślnie read-only** - bezpieczne
✅ **Uprawnienia muszą być nadane explicite** - przez autora/admina
✅ **Wszystko logowane** - pełna transparentność
✅ **RLS wymusza uprawnienia** - nie można ominąć
✅ **Historia nieusuwalna** - audit log tylko INSERT

---

## Następne kroki (UI)

Aby w pełni wykorzystać system, trzeba dodać:

1. **Modal zarządzania członkiem zespołu**
   - Checkboxy dla każdego uprawnienia
   - Przycisk "Nadaj uprawnienia współpracownika"
   - Wyświetlanie kto i kiedy nadał uprawnienia

2. **Widok historii zmian**
   - Lista wszystkich akcji w wydarzeniu
   - Filtrowanie po typie akcji/osobie
   - Wyświetlanie różnic (before/after)

3. **Badge "Współpracownik"**
   - Przy nazwie członka z podwyższonymi uprawnieniami
   - Tooltips pokazujące konkretne uprawnienia

4. **Powiadomienia**
   - "Otrzymałeś uprawnienia współpracownika"
   - "Twoje uprawnienia zostały zmienione"

5. **Walidacja UI**
   - Disable przycisków jeśli brak uprawnień
   - Komunikaty "Tylko autor może..."
