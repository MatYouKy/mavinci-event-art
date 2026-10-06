# Zapytania z formularzy i webhooków

## Jeden lejek

Nowy wpis w `contact_messages` (również przez `contact_form_submissions`)
oraz nowe zgłoszenie w `inbound_events` tworzą zapytanie w
`/crm/inquiries`: etap **Nowe**, kolejka **Nieprzypisane**.
Nie przypisujemy automatycznego zgłoszenia pierwszemu administratorowi.

Zapytania nadal są przechowywane w `tasks` z `is_inquiry = true`.
Nie tworzymy drugiej kopii w osobnej tabeli. Zwykłe zadania są dalszymi
działaniami i mogą wskazywać zapytanie przez `inquiry_id`.
Stare adresy `/crm/tasks/[id]` dla zapytań przekierowują do lejka.

## Powiadomienia i ponowienia

Powiadomienie otwiera konkretne `/crm/inquiries/[id]`. Odbiorcy muszą mieć
dostęp do zapytania i włączoną odpowiednią subskrypcję powiadomień.
Brak subskrybentów nie blokuje utworzenia zapytania.

Standardowy odbiór webhooków używa transakcji `receive_inquiry_webhook`.
Kluczem ponowienia jest para `source_id` i `external_event_id`.
Zgłoszenia oznaczone wcześniej jako błędne nie są usuwane przy ponowieniu.
Odpowiedź zawiera `inquiry_id` oraz `inquiry_url`.
Powiadomienie push jest dodatkowym kanałem; jego błąd nie cofa zapisu.
Istniejące operacje aktualizacji karty ślubnej nie tworzą nowych leadów.

## Istniejące dane

Migracja `20260918150000_route_form_and_webhook_inquiries.sql` wiąże
starsze źródła z zapytaniami i uzupełnia brakujące wpisy. Rozpoznaje je po
identyfikatorach źródła, nie po podobnym tytule. Zachowuje istniejące
identyfikatory, opiekunów, etap pracy i historię; nie usuwa dawnych duplikatów
ani nie wysyła ponownie historycznych powiadomień.

Brakujące starsze zgłoszenia pojawiają się jako nowe elementy kolejki.
Oryginalny czas źródła pozostaje w metadanych, bez cofania daty utworzenia
zapytania i natychmiastowego zaległego SLA. Źródła zamknięte/archiwalne
bez istniejącego zapytania są pomijane.

## Wdrożenie

Najpierw zastosuj migrację w docelowej bazie. Następnie opublikuj zmienioną
funkcję Edge `receive-webhook` i aplikację. Funkcja Edge wymaga nowego RPC;
bez niego zwraca błąd zamiast potwierdzać niezapisane zgłoszenie.

Przygotowanie tych plików nie oznacza zastosowania migracji ani publikacji.
Zgodnie z polityką repozytorium w ramach tej zmiany nie uruchamiano testów,
kompilacji ani innych poleceń walidacyjnych.
