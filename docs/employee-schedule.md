# Plan pracownika i oś czasu zespołu

Migracja: `supabase/migrations/20261109140000_employee_schedule.sql` (można uruchomić ponownie). Dane: RPC `get_employee_schedule(p_employee_ids, p_from, p_to)` — jedna lista pozycji planu; odczyt, typy, etykiety i układ (pasy osi, kolumny dnia): `src/lib/employees/employeeSchedule.ts`. Interfejs: `src/components/crm/EmployeesTimelineView.tsx` (oś zespołu), `src/components/crm/employee/EmployeeScheduleCalendar.tsx` (plan dnia / tygodnia w profilu), `src/components/crm/employee/tabs/EmployeeTimelineTab.tsx`.

## Co jest w planie

| Rodzaj | Skąd | Czas | Otwiera |
|---|---|---|---|
| Wydarzenie | przypisanie do zespołu (`employee_assignments`, bez odrzuconych; bez anulowanych wydarzeń) | `event_date` → `event_end_date` (brak końca = 4 h); od 20 h — „cały dzień” | `/crm/events/<id>` |
| Faza wydarzenia | `event_phase_assignments` | godziny przypisania do fazy | `/crm/events/<id>?tab=phases` |
| Spotkanie | uczestnik albo autor (bez usuniętych) | godziny spotkania | `/crm/meetings?meetingId=<id>` |
| Kontakt w zapytaniu | otwarte zapytanie prowadzone przez pracownika, `next_action_at` | o północy = cały dzień, inaczej 30 min | `/crm/inquiries/<id>` |
| Zadanie | przypisane (także współwykonawca), z terminem, nie zakończone ani anulowane; prywatne tylko w swoim planie | termin 00:00 / 23:59 = cały dzień, inaczej 30 min przed terminem | `/crm/tasks/<id>` |
| Oddzwonienie | zaplanowane po rozmowie (`crm_call_activities.next_action_at`) | 15 min | kontakt albo zapytanie |
| Nieobecność | zatwierdzona lub oczekująca | daty nieobecności | — |

Pozycje oczekujące (zaproszenie do wydarzenia, wniosek o nieobecność) są w paski.

## Kto widzi

Każdy pracownik — swój plan. Administrator i „Zarządzanie pracownikami” (`employees_manage`) — plan każdego (bez cudzych zadań prywatnych). Identyfikatory spoza zakresu baza pomija; przedział najwyżej 400 dni.

## Oś czasu zespołu (`/crm/employees` → widok „Oś czasu”, administrator)

- Cała szerokość obok menu bocznego. Powiększenie: **Miesiąc** (cały miesiąc kalendarzowy, krótkie pozycje jednego dnia zebrane w komórkę „N pozycji” — kliknięcie otwiera ten dzień), **Tydzień** (pon.–niedz., godziny co 6 h), **Dzień** (godziny, co pół godziny przy szerokim ekranie; noc przyciemniona).
- Przesuwanie: przeciągnięcie myszą (kursor „chwyć”), gest poziomy na gładziku, Shift + kółko, strzałki ← →; ‹ Dziś › skacze o cały okres. Dane wczytywane z zapasem jednego okresu po obu stronach — przesuwanie nie czeka na sieć.
- Pozycje w osobnych pasach (bez nakładania), kliknięcie otwiera pozycję (Ctrl/⌘ — nowa karta); kliknięcie daty w podziałce — widok tego dnia; kliknięcie pracownika — jego plan w profilu na widocznym dniu (`?tab=timeline&date=RRRR-MM-DD`).
- Filtry: grupy (Wydarzenia i fazy, Spotkania, Lejek i zadania — domyślnie wyłączone, Nieobecności) i wybór pracowników.

## Plan w profilu (zakładka „Oś czasu”)

Siatka jak w Teams: godziny od góry do dołu, pasek „cały dzień” nad siatką, nakładające się pozycje obok siebie, linia „teraz”. Własny profil — domyślnie **tydzień**, profil innej osoby (administrator) — **dzień**; wybór zapamiętuje przeglądarka (osobno dla swojego i cudzego profilu). Nagłówek dnia w tygodniu otwiera ten dzień. Pod planem — lista nieobecności jak dotąd.

## Przed migracją

Brak RPC → interfejs czyta dawne `get_employee_timeline_data` (wydarzenia, fazy, nieobecności) i pokazuje „pojawią się po aktualizacji bazy”.

## Aplikacja mobilna

Bez zmian: ekran „Pracownicy” to katalog kontaktów (bez osi czasu), własne wydarzenia, spotkania i zadania pracownik ma w „Kalendarzu”. Plan z `get_employee_schedule` można dodać do aplikacji później tym samym RPC.

## Pulpit — „Mój plan”

Na pulpicie CRM (`components/crm/dashboard/MyDayTimeline`, także pulpit magazynu) i w aplikacji (`mobile/src/components/MyScheduleSection`) pracownik widzi na górze swój plan z tego samego RPC: dziś albo dziś i dwa kolejne dni (wybór zapamiętany w przeglądarce). CRM — pozioma oś czasu z zakresem 8:00–18:00 poszerzanym o wcześniejsze i późniejsze pozycje, wiersz na dzień, pozycje całodniowe nad osią, czerwona linia „teraz”; krótkie pozycje rysowane jak godzinne, żeby tytuł był czytelny. Telefon — lista godzin.
