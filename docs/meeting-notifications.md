# Powiadomienia o spotkaniach

Spotkania (`meetings`, uczestnicy w `meeting_participants`) wysyłają powiadomienia CRM (`notifications` +
`notification_recipients`) — widać je w dzwonku CRM, w szufladzie powiadomień na Macu i jako push na telefonie i tablecie
(`dispatch_notification_recipient_push`). Autor zmiany nie dostaje powiadomienia o własnym działaniu
(`skip_own_action_notification`).

## Rodzaje

| Kiedy | Kto dostaje | Tytuł | Źródło |
| --- | --- | --- | --- |
| Dodanie do spotkania | nowy uczestnik | „Zaproszenie na spotkanie” | `notify_meeting_participant_assignment` (po dodaniu uczestnika) |
| Odpowiedź uczestnika | organizator | „Odpowiedź na spotkanie: …” | `respond_to_meeting` |
| Zmiana terminu (data, godziny, „cały dzień”) | uczestnicy i organizator, bez autora zmiany | „Zmiana terminu: …” | `notify_meeting_changes` |
| Odwołanie / przywrócenie | j.w. | „Spotkanie odwołane: …” / „Spotkanie przywrócone: …” | `notify_meeting_changes` |
| Inne zmiany: tytuł, miejsce, notatki, status (wstępne / potwierdzone), powtarzanie | j.w. | „Zmiany w spotkaniu: …” | `notify_meeting_changes` |
| Przypomnienie przed spotkaniem | uczestnicy (bez tych, którzy odrzucili) | „Przypomnienie: …” | `process_meeting_reminders` |

Kolor, przypomnienia i „prywatne / firmowe” nie wysyłają powiadomień.

## Zmiana terminu i ponowne potwierdzenie (migracja `20261202140000_meeting_change_notifications.sql`)

- Nowy termin zeruje odpowiedzi uczestników do „bez odpowiedzi” — poza organizatorem i autorem zmiany (jak w Teams).
  Treść powiadomienia zależy od wcześniejszej odpowiedzi: kto przyjął zaproszenie (albo „może”) — „Twoja odpowiedź została
  wycofana — potwierdź udział w nowym terminie”; kto odrzucił — „Odpowiedz, czy nowy termin Ci pasuje”; kto nie odpowiedział —
  „Odpowiedz na zaproszenie”; organizator (gdy termin zmienił ktoś inny) — informacja „zmienia termin Twojego spotkania”.
  W treści jest nowy i poprzedni termin (czas polski, `meeting_when_label`) oraz inne zmiany z tego samego zapisu.
- Zmiana „ten i następne” w spotkaniu cyklicznym: jedno powiadomienie dla edytowanego terminu z dopiskiem „Zmiana dotyczy też
  kolejnych spotkań z cyklu” (kolejne terminy są tworzone na nowo, bez osobnych powiadomień).
- `notify_meeting_changes` to wyzwalacz odroczony do zatwierdzenia transakcji (`deferrable initially deferred`): widzi
  ostateczną listę uczestników zapisu — nowo dodani dostają tylko zaproszenie, usunięci nic. Działa przy każdym zapisie
  spotkania (`save_meeting` z CRM, Maca i telefonu, przeciąganie w siatce, zapis wprost do tabeli). Zapis wycofany (tryb
  testowy) nie wysyła powiadomień. Zmiana bez zalogowanego pracownika (zadanie systemowe) tylko zeruje odpowiedzi.
  Błąd przy tworzeniu powiadomienia nie blokuje zapisu spotkania (ostrzeżenie w logu bazy).
- Terminy porównywane są co do minuty (aplikacje zapisują je z dokładnością do minuty), tekst tytułu, miejsca i notatek —
  bez spacji na końcach, miejsce — po nazwie (tekst albo lokalizacja).
- Metadane powiadomienia: `kind` (`meeting_rescheduled`, `meeting_updated`, `meeting_cancelled`, `meeting_restored`),
  `meeting_id`, `changed_by`, `changed_by_name`, `changes`, `datetime_start` / `datetime_end`, przy zmianie terminu
  `previous_start` / `previous_end` / `previous_response` i `needs_response`.

## Przejście z powiadomienia do szczegółów spotkania

Każde powiadomienie o spotkaniu ma `related_entity_type = 'meeting'` i identyfikator spotkania; nowe — adres
`/crm/meetings?meetingId=<id>`.

- **CRM**: dzwonek i baner (`NotificationCenter`) otwierają `/crm/meetings?meetingId=<id>` dla każdego powiadomienia
  o spotkaniu (także starszych z `/crm/calendar?meeting=` i `/crm/calendar/meeting/<id>`): okno szczegółów i dzień spotkania
  w siatce. Spotkania nie ma na liście — sprawdzenie w bazie (dodane przed chwilą → odświeżenie listy), usunięte albo bez
  dostępu → komunikat. Stary adres `/crm/calendar?meeting=<id>` przekierowuje na stronę Spotkań.
- **Mac**: „Otwórz sprawę” w szufladzie powiadomień → ekran Spotkań z tygodniem spotkania i szczegółami w panelu
  (`Workspace.showMeeting`); brak spotkania po synchronizacji → komunikat.
- **Telefon i tablet**: dotknięcie powiadomienia push albo pozycji na liście powiadomień → ekran Spotkań z oknem szczegółów
  (`navigateToMeeting`, parametr `requestId` — każde dotknięcie otwiera je ponownie, także gdy ekran jest już otwarty);
  brak spotkania → komunikat.

## Czat spotkania

Rozmowa organizatora i zaproszonych w Komunikatorze (także przed odpowiedzią, z plikami) — `docs/meeting-chat.md`.
Wiadomości z czatu przychodzą jako powiadomienia Komunikatora (push na telefon, powiadomienie macOS, dźwięk w CRM),
nie jako powiadomienia CRM.
