# Naprawa Tabel Wydarzenia - Instrukcje

## Problem

Po dodaniu migracji tworzących nowe tabele (`event_equipment`, `event_employees`, `event_checklists`, `offers`), te tabele nie są widoczne przez Supabase REST API pomimo że zostały utworzone w bazie.

### Objawy

- Błędy 404: `Could not find the table 'public.event_equipment' in the schema cache`
- Błędy 404: `Could not find the table 'public.offers' in the schema cache`

## Przyczyna

PostgREST (komponent Supabase odpowiedzialny za REST API) cachuje schemat bazy danych. Po dodaniu nowych tabel cache nie został automatycznie odświeżony.

## Rozwiązanie

### Opcja 1: Odśwież schema w Supabase Dashboard (ZALECANE)

1. Zaloguj się do Supabase Dashboard: https://supabase.com/dashboard
2. Wybierz projekt
3. Przejdź do: **Settings** → **API**
4. Kliknij przycisk **"Reload schema cache"** lub **"Restart PostgREST"**
5. Poczekaj 10-30 sekund
6. Odśwież aplikację

### Opcja 2: Poczekaj na automatyczne odświeżenie

Cache PostgREST automatycznie odświeża się co kilka minut. Możesz po prostu poczekać 5-10 minut i spróbować ponownie.

### Opcja 3: Ręczne odświeżenie przez SQL

W **Supabase SQL Editor** wykonaj:

\`\`\`sql
NOTIFY pgrst, 'reload schema';
\`\`\`

## Weryfikacja

Po zastosowaniu rozwiązania, sprawdź czy błędy zniknęły:

1. Otwórz stronę wydarzenia w CRM
2. Sprawdź konsolę przeglądarki - nie powinno być błędów 404
3. Sprawdź czy sekcje (Sprzęt, Pracownicy, Oferty) ładują się poprawnie

## Naprawione w kodzie

✅ Zmieniono zapytanie do `equipment_items` aby używać relacji `category:equipment_categories(name)` zamiast nieistniejącej kolumny `category`

✅ Naprawiono niejednoznaczną relację w `task_assignees` przez wskazanie konkretnego foreign key: `employees!task_assignees_employee_id_fkey`

✅ Poprawiono filtrowanie globalnego Kanbana - teraz pokazuje tylko zadania globalne (bez `event_id`)

## Kontakt

Jeśli problem nadal występuje po zastosowaniu powyższych kroków, skontaktuj się z deweloperem lub sprawdź logi Supabase.
