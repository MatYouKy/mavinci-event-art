# Karta imprezy (PDF dla kierownika imprezy)

Przycisk **„Karta imprezy”** na wydarzeniu (`/crm/events/[id]`, pasek akcji) i na pulpicie realizacji. W aplikacji mobilnej: „Karta imprezy (PDF)” w szczegółach wydarzenia i w pulpicie realizacji — otwiera `/crm/events/<id>?karta=1` w przeglądarce, a strona przekierowuje do PDF.

- **PDF:** `GET /bridge/events/<id>/card` (`?download=1` — do pobrania). Generuje serwer Next (Chromium, wspólny renderer `src/lib/print/pdfRenderer.server.ts`), logo do druku z brandbooka.
- **Dostęp:** jak pulpit realizacji — `get_realization_workspace` (kierownik realizacji, autor, administrator, `events_manage`). Inne osoby dostają komunikat bez danych. Ciasteczko CRM albo `Authorization: Bearer`.
- **Bez cen:** karta nie zawiera kwot, kosztów ani dokumentów finansowych (oferty, umowy, faktury, kalkulacje).

## Zawartość

| Sekcja | Źródło |
|---|---|
| Nagłówek: nazwa, termin, kategoria, status, stan magazynu, załadunek | `get_realization_workspace`, `events`, `event_warehouse_handoffs` |
| Kierownik imprezy | `event_realizations` (kierownik realizacji), inaczej koordynator z zespołu |
| Dla kogo, kontakty klienta | osoba kontaktowa, `event_contact_persons`, na weselu — karta weselna (para, świadkowie) |
| Miejsce | lokalizacja, sale, kontakt w obiekcie, link do mapy |
| Telefony | kierownik, klient, obiekt, kierowcy, podwykonawcy |
| Harmonogram | etapy (z ekipą i autami), agenda; wyjazdy i powroty aut, gdy nie ma etapów Dojazd / Powrót |
| Transport i trasy | `event_vehicles` (auto, rejestracja, kierowca, wyjazd, przyjazd, powrót, km, czas z planu trasy); pasażerowie z etapu „Dojazd”, gdy jest jedno auto |
| Zespół | zespół wydarzenia + odpowiedzialności (magazyn, kierowca, kierownik) + etapy |
| Podwykonawcy | zadania podwykonawców z kontaktem i godzinami |
| Do przygotowania i zamówienia | kroki przygotowania (`event_steps`, `docs/event-steps.md`): zamówienia z wyprzedzeniem, sprawdzenia stanu, braki, wynajmy, potwierdzenia z klientem / obiektem, ręczne kroki — z właścicielem, terminem i stanem; przed wdrożeniem migracji kroków: braki i wynajem zewnętrzny |
| Sprzęt | pozycje wydarzenia pogrupowane wg kategorii magazynu, z kratką do odhaczenia (te same pozycje zsumowane) |
| Wytyczne | co sprzedano (bez cen), opis, wymagania usług wobec obiektu, uwagi z agendy, sale, uwagi do sprzętu, wytyczne podwykonawców |
| Notatki i potwierdzenia | miejsce na podpisy: wydanie z magazynu, odbiór i załadunek, zwrot do magazynu |

Braki danych (brak kierownika, telefonu w obiekcie, przyjęcia przez magazyn, przydziału osób do aut) oraz niezamknięte kroki przygotowania i przekazania („Czekamy na: …”) karta pokazuje na górze jako ostrzeżenia.
