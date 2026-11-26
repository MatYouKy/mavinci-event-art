# Wydajność RLS eventów i ofert

Migracja `supabase/migrations/20261202130000_rls_performance_events_offers.sql` (26.11.2026).

## Problem

Lista eventów i ofert u pracowników bez roli administratora przekraczała limit 8 s na zapytanie (`statement_timeout` roli
`authenticated`) — CRM pokazywał „Nie udało się pobrać danych”, a Mac i telefon puste listy. Z logów bazy (24 h przed zmianą):
lista ofert sprzedawcy — 186 przekroczeń, lista eventów menedżera z zakresem „tylko własne” — 117, oferty tego menedżera — 48,
eventy technika (sprawdzane w trybie testowym) — 3, nawet u administratora pojedyncze przekroczenia (oferty, KSeF). Udane zapytania
listy eventów trwały średnio 3 s (maks. 7,9 s), ofert — 4 s; liczenie samych eventów przez RLS: technik 0,7–2,8 s, menedżer
z „tylko własne” 5,8 s; lista ofert sprzedawcy 4,9 s.

Przyczyny — polityki RLS wywoływały dla każdego wiersza łańcuchy funkcji `SECURITY DEFINER`:

- w funkcjach z warunkiem `employee.id = public.sales_employee_id()` bieżący pracownik był liczony dla **każdego wiersza tabeli
  pracowników**, przy każdym wywołaniu (np. `crm_record_scope_limited` ok. 0,4 ms na wywołanie zamiast setnych części);
- `crm_record_id_scope_allows` / `crm_record_scope_allows` sprawdzały najpierw kierownika realizacji i przyjęcie na magazyn,
  a dopiero potem tani test „tylko własne” — także u pracowników bez tego zakresu;
- polityki eventów z przypisaniem pracownika czytały `employee_assignments` z jej RLS — zakres eventu
  (`crm_record_id_scope_allows`) liczony dla każdego przypisania każdego eventu;
- `crm_record_base_owned` porównywała `c.id::text` z każdym kontaktem (bez indeksu);
- oferty liczyły własność rekordu dwa razy (`crm_owned_offer_read` i `crm_creator_offer_read`), także u pracowników bez
  uprawnień do ofert.

## Zmiany (bez zmiany wyników)

1. `crm_record_id_scope_allows`, `crm_record_scope_allows` — najpierw `crm_record_scope_limited`.
2. `crm_record_base_owned` — kontakty i sprzedawcy po identyfikatorze (indeks); identyfikator w zapisie innym niż kanoniczny
   i tak nie pasował do `c.id::text`, więc wynik się nie zmienia.
3. Bieżący pracownik raz na wywołanie (`(SELECT public.sales_employee_id())`, `current_invoice_employee_id`, portal sprzedawcy) w:
   `crm_record_scope_limited`, `crm_record_base_owned`, `is_realization_manager`, `can_receive_warehouse_event`,
   `can_direct_realization`, `realization_operational_only`, `event_visible_to_sales_colleague`, `sales_can_manage_document`,
   `current_employee_sells_event`. Poza tym treść funkcji jak na produkcji.
4. `current_employee_can_view_event` — „bezpośredni dostęp” liczony dopiero, gdy wynik od niego zależy; tanie warunki pierwsze.
5. Nowa funkcja `rls_event_assignment_visible(event, pracownik)` w politykach eventów „Users can view events based on
   permissions” i „Users can view own assigned events by auth_user_id”: przypisanie (bez odrzuconego) i ten sam zakres eventu, który
   dokładało RLS `employee_assignments` (dla zalogowanego: polityka „true”, `crm_parent_scope_event_id`, portal sprzedawcy) — raz na
   event.
6. Wszystkie polityki, których cały warunek to `NOT current_session_is_seller_portal()` (62 na produkcji) — jako podzapytanie
   (raz na zapytanie).
7. Oferty: usunięta `crm_creator_offer_read` (zawiera się w `crm_owned_offer_read`); w `crm_owned_offer_read` własność liczona
   dopiero przy uprawnieniu do ofert; funkcje portalu sprzedawcy w politykach ofert — jako podzapytania.

## Jak sprawdzono, że nic się nie zmienia

Lokalna baza PostgreSQL z 24 funkcjami skopiowanymi z produkcji (treść porównana sumą MD5 z `pg_proc` produkcji — identyczna),
politykami eventów, ofert, przypisań i pracowników jak na produkcji oraz danymi testowymi (6 zestawów, 120–200 eventów, ofert
i przypisań, 3 działalności). Na każdym zestawie: baza „przed” i baza „po” (ten sam plik migracji), po 28–30 użytkowników —
administrator, poziom „admin”, technicy z magazynem (wszystkie i wybrane marki), sprzedawcy i menedżerowie z „tylko własne”,
podgląd operacyjny / planowanie, przypisania „accepted / pending / rejected / brak”, konta portalu sprzedawcy, nieznany użytkownik,
brak sesji. Porównane: widoczne wiersze `events`, `offers`, `employee_assignments`, `contacts`, `organizations`, `employees`,
`tasks` przez RLS oraz wyniki wszystkich zmienionych funkcji dla wszystkich wierszy (także niepoprawne i niekanoniczne
identyfikatory w JSON, NULL). Wynik: **identyczne** we wszystkich 6 zestawach (4 175 porównań).

Czas (ten sam komputer, zestaw 160 eventów / 141 ofert / 344 przypisań, liczenie przez RLS):

| Kto | Eventy | Oferty | Przypisania |
| --- | --- | --- | --- |
| administrator | 38 → 35 ms | 523 → 171 ms | 187 → 25 ms |
| poziom „admin” bez roli | 588 → 259 ms | 1053 → 367 ms | 172 → 25 ms |
| technik (magazyn, wszystkie marki) | 242 → 123 ms | 694 → 210 ms | 98 → 29 ms |
| technik (wybrana marka) | 335 → 84 ms | 140 → 51 ms | 163 → 24 ms |
| podgląd operacyjny | 275 → 116 ms | 671 → 210 ms | 171 → 25 ms |
| sprzedawca „tylko własne” | 790 → 456 ms | 957 → 550 ms | 473 → 480 ms |
| menedżer „tylko własne” | 855 → 507 ms | 352 → 222 ms | 530 → 453 ms |

Najwięcej zyskują pracownicy bez „tylko własne” (2–7×). Przy „tylko własne” zostaje liczenie własności rekordu dla każdego
wiersza (≈1,7×) — kolejny krok, gdyby było potrzebne: zbiór własnych rekordów liczony raz na zapytanie.

## Uwagi

- Polityka ofert `inquiry_offer_read` porównuje `tasks.id = tasks.inquiry_id` (zamiast `offers.inquiry_id`) — dziś nie daje
  nikomu dostępu (żadne zapytanie nie ma `inquiry_id` równego własnemu `id`). Bez zmian w tej migracji.
- Największe obciążenie bazy poza listami: `native_workspace_sync_v3` (synchronizacja Maca i telefonu, ok. 1,1 s na wywołanie,
  ok. 4 400 wywołań na dobę) — korzysta z tych samych funkcji, więc też przyspieszy.
