# Jak wyczyścić cache PostgREST w przeglądarce

## Problem
Błąd PGRST201: PostgREST widzi duplikat foreign key, mimo że w bazie jest tylko jeden.

## Rozwiązanie

### 1. Hard Refresh przeglądarki (najszybsze)
- **Windows/Linux:** `Ctrl + Shift + R` lub `Ctrl + F5`
- **Mac:** `Cmd + Shift + R`

### 2. Wyczyść cache Supabase
1. Otwórz DevTools (F12)
2. Application/Storage → Local Storage → usuń wszystko
3. Application/Storage → Session Storage → usuń wszystko
4. Odśwież stronę

### 3. Restart dev servera (jeśli pracujesz lokalnie)
```bash
# Zatrzymaj serwer (Ctrl+C)
# Uruchom ponownie:
npm run dev
```

### 4. Poczekaj 2-3 minuty
Supabase hostowany czasami potrzebuje czasu na automatyczny reload cache PostgREST.

## Status bazy danych
✅ W bazie jest tylko 1 foreign key: `employee_email_accounts_employee_id_fkey`
✅ RLS policies są poprawne
✅ Kod został naprawiony
❌ PostgREST cache jest przestarzały

## Po hard refresh powinno działać!
