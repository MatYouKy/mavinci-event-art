# Checklista sprzętu wydarzenia (wydanie → załadunek powrotny → zwrot)

Migracja: `supabase/migrations/20261105170000_event_equipment_checklist.sql` (można uruchomić ponownie). Wspólny kod CRM ↔ aplikacja: `src/lib/events/equipment/equipmentChecklist.ts` ↔ `mobile/src/lib/equipmentChecklist.ts` (typy, odczyt wyniku RPC, etykiety, walidacja). Etapy, uprawnienia, blokady i powiadomienia liczy baza — interfejs wyświetla `get_event_equipment_checklist` i wysyła zmiany przez RPC. Dane w obszarze „Realizacja” (`operations`, `docs/event-access.md`).

## Etapy

| Etap | Kto | Co | Zamyka krok realizacji |
|---|---|---|---|
| 1. Wydanie z magazynu | magazyn (`equipment_manage`, nie autor oferty), administrator | Przy każdej pozycji ilość spakowana (pełna = zielona). Mniej niż na liście = **brak na czerwono z powodem**. Braki wymagają **zgody sprzedawcy wydarzenia albo administratora** — do tego czasu wydania nie da się potwierdzić. Pozycje opcjonalne i wynajem zewnętrzny nie są wymagane. Potwierdzenie blokuje listę. | „Wydaj sprzęt — załadunek zgodny z listą” |
| 2. Załadunek powrotny | kierownik realizacji (albo osoba kierująca realizacją bez wyznaczonego kierownika), administrator | Po wydarzeniu, przy załadunku na powrót: lista tego, co **faktycznie wydano**. Kierownik odhacza, ile wraca; mniej = opis (zostało na obiekcie, zaginęło, uszkodzone). Zatwierdza listę. Rozbieżności → powiadomienie magazynu, sprzedawcy i administratorów. | „Oddaj sprzęt do magazynu” |
| 3. Zwrot na magazyn | magazyn, administrator | Przy każdej wydanej pozycji: sprawne / uszkodzone / brak (brak = wydane − sprawne − uszkodzone), opis przy uszkodzeniu lub braku, zdjęcia (do 10). Zatwierdzenie bez rozbieżności zamyka krok. Rozbieżności → krok „problem”, powiadomienie sprzedawcy, administratorów i kierownika; **sprzedawca lub administrator przyjmuje je z decyzją** (np. obciążenie klienta, naprawa) — wtedy krok się zamyka. | „Przyjmij zwrot i sprawdź sprzęt” |

- „Wszystko zgodne” (`fill_event_equipment_stage`) uzupełnia niesprawdzone pozycje pełną ilością na danym etapie (bez zmiany już wpisanych; przy wydaniu tylko pozycje wymagane).
- Zgoda na brak dotyczy konkretnej ilości: zmiana ilości spakowanej po decyzji wymaga nowej zgody. Odmowa (z notatką, co zrobić) blokuje wydanie, dopóki magazyn nie uzupełni sprzętu albo sprzedawca nie zmieni decyzji na zgodę. Decyzja obejmuje tylko braki, które widzi decydujący (`p_lines`) — zmiana w międzyczasie = „Lista braków zmieniła się”.
- Zgodę daje sprzedawca wydarzenia (krok sprzedaży, autor, udział w sprzedaży, prowadzący zapytanie / ofertę) albo administrator — samo `events_manage` nie wystarcza. Osoba, która spakowała brakującą pozycję, nie zatwierdza swojego braku (chyba że jest administratorem).
- Prośba o zgodę bez zmian od poprzedniej (i bez nowej notatki) nie wysyła się drugi raz; tak samo druga prośba o odblokowanie, gdy poprzednia czeka.
- Zwrot można sprawdzać także bez zatwierdzonego załadunku powrotnego (kierownik nie zdążył) — podstawą jest zawsze ilość wydana; zatwierdzony zwrot zamyka też krok „Oddaj sprzęt do magazynu”. „Wszystko wróciło sprawne” pomija pozycje z brakiem zgłoszonym przez kierownika (magazyn wpisuje je ręcznie z opisem).
- Nic nie wydano (same pozycje opcjonalne / wynajem zewnętrzny / braki): potwierdzenie wydania zamyka od razu załadunek i zwrot.
- Wydarzenie anulowane po wydaniu: zwrot przyjmuje magazyn (`equipment_manage`).
- Po zatwierdzeniu wydania magazyn lub kierownik prosi o odblokowanie z powodem (`request_event_equipment_unlock` → powiadomienie administratorów). Etap cofa administrator albo `events_manage` (`reopen_event_equipment_stage`, z powodem; od końca: zwrot → załadunek → wydanie). Cofnięcie przywraca otwarte kroki realizacji.
- Pól wydania w `events` (`loading_confirmed*`, `loading_locked`, `loading_unlock_*`, `loading_notes`) nie zmienia się bezpośrednim zapisem — strażnik `a_guard_event_loading_fields` (CRM i aplikację trzeba wdrożyć razem z migracją; starsze wersje aplikacji dostaną komunikat o aktualizacji).
- Ponowna synchronizacja sprzętu z oferty (`sync_offer_equipment_to_event` usuwa i wstawia pozycje) przenosi stan checklisty na nową pozycję tego samego sprzętu / zestawu / kabla (`private.equipment_check_carry`). Usunięcie na stałe pozycji wydanej, która jest poza magazynem (wydanie zatwierdzone, zwrot jeszcze nie), kończy się błędem przy zapisie całej zmiany.
- Cofnięcie wydania czyści wpisy załadunku powrotnego i zwrotu przy pozycjach (sprawdza się je od nowa po ponownym wydaniu).
- Dawne `set_event_equipment_loaded` (starsze wersje aplikacji, klient macOS) = pełna ilość spakowana / odznaczenie, tylko magazyn; `event_equipment.is_loaded` = pozycja spakowana w całości (PDF listy, licznik).
- Start: wydarzenia wydane dotychczasowym potwierdzeniem załadunku dostały stan checklisty (odhaczone = wydana pełna ilość, nieodhaczone = 0 z brakiem przyjętym „przed wdrożeniem”); gdy kroki zwrotu były już zamknięte albo wydarzenie rozliczone / anulowane — etapy zakończone.
- Kroki „Wydaj sprzęt”, „Oddaj sprzęt do magazynu”, „Przyjmij zwrot” są zamykane danymi (`private.event_step_auto_keys`) — w krokach przycisk prowadzi do checklisty (CRM zakładka „Sprzęt”, aplikacja zakładka „Checklista”). Wcześniejsze wydarzenia z ręcznie zamkniętymi krokami zostają bez zmian.

## Powiadomienia (`metadata.workflow = 'equipment_checklist'`, adres `/crm/events/<id>?tab=equipment`, aplikacja: zakładka „Checklista”)

| Zdarzenie | Kto |
|---|---|
| Prośba o zgodę na braki | sprzedawcy wydarzenia, administratorzy |
| Zgoda / odmowa | magazyn (i osoba, która prosiła) |
| Sprzęt wydany | kierownik realizacji (bez kierownika: prowadzący) |
| Prośba o odblokowanie wydania | administratorzy |
| Załadunek powrotny zatwierdzony | magazyn; przy rozbieżnościach także sprzedawcy i administratorzy |
| Rozbieżności w zwrocie | sprzedawcy, administratorzy, kierownik |
| Rozbieżności przyjęte | magazyn |
| Cofnięcie etapu | magazyn (wydanie, zwrot) / kierownik (załadunek) |

## Kontrakt RPC (wszystkie zwracają aktualną checklistę, poza `set_event_equipment_loaded`)

- `get_event_equipment_checklist(p_event)` → `{event_id, stage: empty|dispatch|loadback|return|issues|done, dispatch{confirmed_at, confirmed_by_name, note, locked, unlock_requested, unlock_requested_at, unlock_reason, shortage_requested_at, shortage_requested_name, shortage_request_note}, loadback{confirmed_at, confirmed_by_name, note}, return{confirmed_at, confirmed_by_name, note, issue_count, issues_ack_at, issues_ack_name, issues_ack_note}, can{pack, request_approval, approve_shortages, confirm_dispatch, request_unlock, loadback, confirm_loadback, return, confirm_return, ack_issues, reopen}, blockers[text], summary{…}, lines[…], log[…]}` — pola: `equipmentChecklist.ts`.
- `set_event_equipment_packed(p_line, p_qty, p_reason)` — `p_qty` NULL = odznacz; mniej niż na liście (pozycja wymagana) → `p_reason` ≥ 3 znaki.
- `fill_event_equipment_stage(p_event, p_stage dispatch|loadback|return)`.
- `request_event_equipment_shortage_approval(p_event, p_note)`; `decide_event_equipment_shortages(p_event, p_approve, p_note, p_lines)` — `p_lines` = `[{id, shortage_qty}]` braków otwartych (`shortage_status` pending / rejected) widocznych na ekranie; odmowa: notatka wymagana.
- `confirm_event_equipment_dispatch(p_event, p_note)`; `request_event_equipment_unlock(p_event, p_reason)`; `reopen_event_equipment_stage(p_event, p_stage, p_reason)`.
- `set_event_equipment_loadback(p_line, p_qty, p_note)` (mniej niż wydano → notatka); `confirm_event_equipment_loadback(p_event, p_note)`.
- `set_event_equipment_return(p_line, p_ok, p_damaged, p_note, p_photos)` — zdjęcia w buckecie `event-files`, ścieżka `<event_id>/equipment-return/<line_id>/…` (`equipmentReturnPhotoPath`), `p_photos` NULL = bez zmiany zdjęć; `confirm_event_equipment_return(p_event, p_note)`; `acknowledge_event_equipment_return_issues(p_event, p_note)` (notatka 5–1000 znaków).
- Tabele (odczyt pod RLS obszaru „Realizacja”, na żywo przez Realtime): `event_equipment_checks` (pozycje), `event_equipment_checklists` (etapy), `event_equipment_check_log` (historia).
