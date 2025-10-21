# Automatyczne przypisywanie autora do zadań

## Funkcjonalność

Od teraz wszystkie nowo utworzone zadania automatycznie przypisują autora do listy przypisanych użytkowników.

### Cechy systemu:

1. **Automatyczne przypisanie autora**
   - Gdy tworzysz nowe zadanie, automatycznie jesteś dodawany/a do listy przypisanych użytkowników
   - Otrzymasz powiadomienia o:
     - Nowych komentarzach w zadaniu
     - Zmianach w zadaniu
     - Załącznikach dodanych do zadania
   - Masz pełny wgląd i wpływ na przebieg zadania

2. **Wypisywanie się z zadań**
   - Każdy przypisany użytkownik może się wypisać z zadania klikając przycisk "Wypisz się"
   - Autor może wypisać innych użytkowników z zadania
   - Przycisk "Wypisz się" widoczny jest w szczegółach zadania

3. **Obszar konwersacji**
   - Przestrzeń na konwersację automatycznie dostosowuje wysokość:
     - Minimalna wysokość: 200px
     - Maksymalna wysokość: 500px
   - Przewijanie włącza się automatycznie gdy jest więcej treści

## Gdzie działa?

System działa we wszystkich miejscach tworzenia zadań:
- ✅ Strona główna zadań (`/crm/tasks`)
- ✅ Prywatne zadania (tablica Kanban)
- ✅ Zadania w wydarzeniach (`/crm/events/[id]`)
- ✅ Zadania tworzone z kalendarza

## Migracja istniejących zadań

Istniejące zadania zostały automatycznie zaktualizowane - autorzy zostali dodani do listy przypisanych użytkowników.

## Przykład użycia

1. **Tworzenie zadania:**
   - Tworzysz nowe zadanie "Przygotować ofertę"
   - System automatycznie Cię przypisuje do tego zadania
   - Wybierasz dodatkowych użytkowników (opcjonalnie)
   - Wszyscy przypisani użytkownicy otrzymają powiadomienia

2. **Wypisywanie się:**
   - Wchodzisz w szczegóły zadania
   - Widzisz przycisk "Wypisz się" obok listy przypisanych osób
   - Klikasz "Wypisz się"
   - Nie będziesz już otrzymywać powiadomień o tym zadaniu

3. **Wypisywanie innych (tylko autor):**
   - Jako autor zadania możesz wypisać innych użytkowników
   - Wchodzisz w szczegóły zadania
   - Usuwasz przypisanie wybranej osoby

## Techniczne szczegóły

- Trigger bazodanowy: `trigger_auto_assign_task_creator`
- Funkcja: `auto_assign_task_creator()`
- Polityki RLS dla bezpiecznego usuwania przypisań
