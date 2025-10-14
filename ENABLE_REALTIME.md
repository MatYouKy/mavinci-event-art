# Jak włączyć Supabase Realtime (FREE)

## Krok 1: Database → Publications

1. Otwórz Supabase Dashboard
2. Idź do **Database** (lewy panel)
3. Kliknij **Publications** (NIE "Replication"!)
4. Znajdź publication: `supabase_realtime`

## Krok 2: Dodaj tabele do Realtime

W sekcji "Tables in this publication":

```sql
-- Możesz też to zrobić przez SQL Editor:
ALTER PUBLICATION supabase_realtime ADD TABLE notifications;
ALTER PUBLICATION supabase_realtime ADD TABLE contact_messages;
```

LUB przez UI:
1. Kliknij na publication `supabase_realtime`
2. Dodaj tabelę `notifications`
3. Dodaj tabelę `contact_messages`
4. Zapisz

## Krok 3: Sprawdź czy działa

W konsoli przeglądarki (F12) powinieneś zobaczyć:
```
[NotificationCenter] Subscription status: SUBSCRIBED
```

## Alternatywnie - SQL

```sql
-- Sprawdź czy tabela jest w publikacji
SELECT * FROM pg_publication_tables 
WHERE pubname = 'supabase_realtime';

-- Jeśli nie ma notifications, dodaj:
ALTER PUBLICATION supabase_realtime ADD TABLE notifications;
ALTER PUBLICATION supabase_realtime ADD TABLE contact_messages;
```

## Test Realtime

1. Otwórz aplikację w przeglądarce
2. Otwórz konsolę (F12)
3. W osobnej karcie/oknie, wyślij wiadomość z formularza
4. Powinna pojawić się notyfikacja natychmiast!

## Limity FREE Plan

- ✅ 200 concurrent connections
- ✅ 2 GB bandwidth/miesiąc
- ✅ Unlimited databases
- ✅ Realtime w pełni działa!

**Nie potrzebujesz Pro!**
