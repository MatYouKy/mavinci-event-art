# Naprawa Formularza Kontaktowego - RLS Policy

## Problem

Formularz kontaktowy przestał działać - nikt nie może wysłać wiadomości, nawet na stronie głównej.

## Przyczyna

**RLS (Row Level Security) policy była źle skonfigurowana** i blokowała INSERT dla użytkowników anonimowych (anon).

## Diagnoza

```sql
-- Test wykazał błąd:
SET LOCAL ROLE anon;
INSERT INTO contact_messages (name, email, message)
VALUES ('Test', 'test@test.com', 'Test');

-- Zwrócił:
ERROR: new row violates row-level security policy for table "contact_messages"
```

## Rozwiązanie ✅

### Usunięto starą policy:

```sql
DROP POLICY IF EXISTS "Anyone can send contact messages" ON contact_messages;
```

### Dodano nową działającą policy:

```sql
CREATE POLICY "Allow anyone to insert contact messages"
ON contact_messages
FOR INSERT
TO anon, authenticated
WITH CHECK (true);
```

## Co się zmieniło?

### Przed (nie działało):

- Policy: "Anyone can send contact messages"
- `with_check: true` - ale brak właściwej konfiguracji
- Blokowało INSERT dla anon

### Po (działa):

- Policy: "Allow anyone to insert contact messages"
- `WITH CHECK (true)` - prawidłowa składnia
- `TO anon, authenticated` - wyraźnie określone role
- Pozwala INSERT dla wszystkich

## Weryfikacja

### Test 1: Sprawdź policies

```sql
SELECT policyname, cmd, roles, with_check
FROM pg_policies
WHERE tablename = 'contact_messages' AND cmd = 'INSERT';
```

**Wynik powinien być:**

```
policyname: "Allow anyone to insert contact messages"
cmd: INSERT
roles: {anon,authenticated}
with_check: true
```

### Test 2: Próbny INSERT

```sql
INSERT INTO contact_messages (name, email, message, category, source_page)
VALUES ('Test', 'test@test.com', 'Test message', 'general', '/')
RETURNING id, created_at;
```

**Powinno zwrócić:** nowy rekord z id i created_at

### Test 3: Formularz na stronie

1. Otwórz: https://mavinci.pl
2. Przewiń do formularza kontaktowego
3. Wypełnij pola
4. Kliknij "Wyślij wiadomość"
5. **Powinno pokazać:** "Wiadomość wysłana! Dziękujemy za kontakt!"

## Security - Co jest chronione?

### ✅ Dozwolone dla ANON:

- INSERT do contact_messages (wysyłanie wiadomości)

### ❌ Zablokowane dla ANON:

- SELECT (czytanie wiadomości)
- UPDATE (edycja wiadomości)
- DELETE (usuwanie wiadomości)

### ✅ Dozwolone dla AUTHENTICATED:

- SELECT (czytanie wszystkich wiadomości)
- UPDATE (edycja wiadomości)
- DELETE (usuwanie wiadomości)
- INSERT (również wysyłanie)

## Policies - pełna lista

```sql
-- 1. INSERT - dla wszystkich
CREATE POLICY "Allow anyone to insert contact messages"
ON contact_messages FOR INSERT TO anon, authenticated
WITH CHECK (true);

-- 2. SELECT - tylko dla authenticated
CREATE POLICY "Authenticated users can read contact messages"
ON contact_messages FOR SELECT TO authenticated
USING (true);

-- 3. UPDATE - tylko dla authenticated
CREATE POLICY "Authenticated users can update contact messages"
ON contact_messages FOR UPDATE TO authenticated
USING (true) WITH CHECK (true);

-- 4. DELETE - tylko dla authenticated
CREATE POLICY "Authenticated users can delete contact messages"
ON contact_messages FOR DELETE TO authenticated
USING (true);
```

## Troubleshooting

### Problem: Nadal nie działa

1. Sprawdź console w przeglądarce (F12)
2. Szukaj błędów JavaScript
3. Sprawdź Network tab - kod odpowiedzi (200 = OK, 403 = CORS)

### Problem: 403 Forbidden

- To **CORS**, nie RLS!
- Zobacz: `NAPRAWA_403_CORS.md`
- Dodaj domenę w Supabase Dashboard → Settings → API → CORS

### Problem: Brak zmiennych środowiskowych

```bash
# Sprawdź .env
cat .env | grep SUPABASE

# Powinno pokazać:
NEXT_PUBLIC_SUPABASE_URL=https://fuuljhhuhfojtmmfmskq.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

## Migracja już zastosowana ✅

Zmiany zostały zapisane w bazie danych i działają od razu.

## Status

✅ **NAPRAWIONE** - Formularz działa dla wszystkich użytkowników!
