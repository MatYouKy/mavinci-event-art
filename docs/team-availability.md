# Działy, przełożeni i dostępność pracowników (Spotkania)

Jak „Asystent planowania” w Teams / Outlooku: przy planowaniu spotkania widać, kto w tym czasie ma już coś w planie,
a osoby spoza firmy (kontakty) dostają zaproszenie e-mailem. CRM, aplikacja na Maca i telefon korzystają z tych samych
funkcji bazy (migracja `20261201090000_team_departments_availability.sql`).

## Działy i przełożeni

- `employees.department` — **Zarząd** (`management`), **Sprzedaż** (`sales`), **Biuro** (`office`), **Magazyn**
  (`warehouse` — magazyn, DJ, technicy). Pusty dział = Biuro. Dotychczasowi pracownicy i nowe konta dostają dział z roli
  firmowej: Administrator / Manager → Zarząd, Sprzedaż → Sprzedaż, Magazyn / DJ / Technik / Technik-Realizator → Magazyn,
  pozostali → Biuro (`private.default_employee_department`).
- `employees.supervisor_id` — bezpośredni przełożony (piramida). Bez pętli: przełożonym nie może być nikt z gałęzi
  podwładnych tej osoby (pilnuje trigger `private.guard_employee_structure`).
- Zmienia administrator albo osoba z „Zarządzanie pracownikami” (`employees_manage`): karta pracownika → „Dział
  i przełożony” (CRM: `EmployeeStructureCard`, Mac: karta pracownika, telefon: Pracownicy → pracownik). Zapis —
  `set_employee_structure(id, dział, przełożony)`; bezpośredni UPDATE innych osób blokuje trigger.

## Zakres planu (kto czyj plan widzi z tytułami)

| Pracownik | Widzi plan |
|---|---|
| Zarząd, administrator, „Zarządzanie pracownikami” | wszystkich |
| Sprzedaż, Biuro | Sprzedaży, Biura i Magazynu |
| Magazyn (magazyn, DJ, technicy) | swojego działu |
| każdy | siebie i swoich podwładnych (cała gałąź w dół) |

Funkcja `private.schedule_visible_employee_ids()`; lista osób do wyboru — `get_schedule_people()`.

## Dostępność — `get_team_availability(ids, od, do, pomiń_spotkanie)`

Zajętość wybranych osób (najwyżej 60, przedział do 62 dni):

- **spotkania** — uczestnik bez odrzucenia zaproszenia albo autor; bez odwołanych i usuniętych;
  „niepotwierdzone” = spotkanie wstępne albo zaproszenie bez odpowiedzi / „może”,
- **eventy** — ekipa wydarzenia (bez odrzuconych zaproszeń i odwołanych eventów); **fazy** — osoby przypisane tylko do
  fazy,
- **nieobecności** — zatwierdzone i oczekujące (oczekujące = „niepotwierdzone”).

Szczegóły (tytuł, miejsce, otwarcie pozycji) — osoby z zakresu planu i spotkania, w których widz uczestniczy. Spotkanie
prywatne innej osoby — tylko „Zajęty”. Typ nieobecności (urlop, zwolnienie…) widzi sam pracownik, Zarząd / administrator /
„Zarządzanie pracownikami” i przełożeni; pozostali — „Nieobecność”. Osoby spoza zakresu (np. zaproszone na spotkanie) —
sama zajętość „Zajęty”, bez szczegółów. `pomiń_spotkanie` — edytowane spotkanie nie liczy się do zajętości.

## Spotkania → „Pracownicy”

- **CRM** (`/crm/meetings`, widok „Pracownicy”, `TeamAvailabilityView`): wybrany dzień, kolumna dla każdej wybranej osoby
  (wybór pogrupowany działami, „Cały dział”, najwyżej 20 osób, zapamiętany w przeglądarce; domyślnie — ja i mój dział).
  Kliknięcie spotkania / eventu otwiera je; zaznaczenie wolnego czasu w kolumnie zakłada spotkanie z tą osobą.
- **Mac** (Spotkania → „Pracownicy”): to samo w oknie natywnym (chwyć i przesuń godziny, zaznaczenie czasu).
- **Telefon / tablet** (Spotkania → „Pracownicy”): dzień w pionie, kolumna dla każdej wybranej osoby (przewijanie w bok
  przy wielu osobach), szczegóły pozycji w oknie, przytrzymanie wolnej godziny — nowe spotkanie z tą osobą.

## Ostrzeżenia o zajętości w formularzu spotkania

Nowe spotkanie i edycja (CRM, Mac, telefon): pod uczestnikami — kto z firmy (także ja) ma w tym terminie spotkanie, event,
fazę albo nieobecność („Jedna osoba ma już coś w planie w tym czasie”). Ostrzeżenie nie blokuje zapisu. Wspólny kod:
`src/lib/CRM/meetings/teamAvailability.ts` ↔ `mobile/src/lib/teamAvailability.ts` (Mac: `Meetings/TeamAvailability.swift`).

## E-mail do uczestników spoza firmy

Kontakty dodane do spotkania dostają wiadomość z pierwszej skrzynki osoby zapisującej (szablon i stopka firmy skrzynki),
każdy osobno, z plikiem `.ics` do kalendarza (`src/lib/native/meetingMail.ts`, `/bridge/native/v1/meetings`, `op=notify`):

| Zdarzenie | Wiadomość |
|---|---|
| nowe spotkanie, nowy kontakt | zaproszenie (`METHOD:REQUEST`) |
| inny termin lub miejsce, przywrócone (nieodwołane), wstępne → potwierdzone | zmiana spotkania (`REQUEST`, ta sama `UID`, wyższa `SEQUENCE`) |
| status „Odwołane”, usunięcie spotkania | odwołanie (`METHOD:CANCEL`) |
| kontakt usunięty z uczestników | „zaproszenie nieaktualne” (`CANCEL`) |

- Spotkania cykliczne: zaproszenie do całego cyklu (nowe spotkanie albo zmiana „ten i kolejne”) ma `.ics` z regułą
  `RRULE`; zmiana i odwołanie pojedynczego terminu cyklu — sama treść (bez `.ics`, żeby nie rozbić cyklu w kalendarzu
  odbiorcy).
- Notatki spotkania (wewnętrzne) nie trafiają do wiadomości. Kontakty bez adresu e-mail są pomijane (komunikat po zapisie).
- Wysyła organizator albo uczestnicząca w spotkaniu osoba z „calendar_manage” (`meeting_mail_context` — także do 2 godzin
  po usunięciu spotkania). Bez skrzynki pocztowej w CRM wiadomość nie wychodzi (komunikat).
- Formularz (nowe / edycja): pole „Wyślij zaproszenie e-mailem osobom spoza firmy” (domyślnie włączone). Przeciągnięcie
  terminu, zmiana statusu i usunięcie — pytanie „Wysłać osobom spoza firmy e-mail…?”.
