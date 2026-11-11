# Karta wydarzenia — lista kontrolna Mac ↔ CRM

Spisane z kodu CRM (`src/app/(crm)/crm/events/[id]/**`, `src/components/crm/events/**`, hooki `events/hooks`, `events/store/api/eventsApi.ts`).
Każda pozycja to funkcja widoczna w CRM. Status: `[ ]` — jeszcze w CRM (Mac otwiera przeglądarkę albo widok danych), `[x]` — natywnie na Macu 1:1.
Mavinci LIVE — poza zakresem (decyzja z 2026-11-11). PDF-y z Chromium generuje Mac lokalnie (ten sam HTML i ustawienia druku), zapis do CRM robi serwer tym samym kodem.

Zakładki w CRM (`EVENT_TAB_GROUPS`, kolejność paska): **Wydarzenie** — Przegląd (`overview`), Szczegóły (`details`);
**Przygotowanie** — Sprzęt, Logistyka, Zespół, Harmonogram (`phases`), Agenda / Karta weselna, Podwykonawcy, Pliki, Zadania, Mavinci LIVE;
**Sprzedaż i rozliczenie** — Oferta, Kalkulacje, Umowa, Ustalenia (`seller-arrangements`), Finanse, Podsumowanie (`summary`), Historia.

## Wejście na kartę i warianty
- [x] Karta pełna (`EventDetailPageClient`) — dane z `fetchEventByIdWith` (ten sam kod co strona), zakładki i uprawnienia liczone na serwerze jak w CRM (`visibleEventTabs`, `can_view_event_commercials`, zakres sprzedaży), kopia na dysku ze skrótem
- [x] Podgląd sprzedaży kolegi (`EventSalesColleagueView`, `get_event_sales_overview`) — tylko odczyt
- [x] Przestrzeń realizacji (`RealizationWorkspace`, `get_realization_workspace`, operational_only): Przegląd z krokami, lokalizacja z danymi technicznymi, salami i materiałami, kontakt, kierownik realizacji (`advance_realization`), Timeline, Agenda, Sprzęt, Zespół (telefon / SMS / e-mail), Logistyka, Podwykonawcy, Pliki
- [x] Zaproszenie do zespołu (baner: Akceptuj / Odrzuć) — [ ] link z tokenem z e-maila
- [x] Pasek zakładek według dostępu (Mavinci LIVE — przejście do CRM)

## Nagłówek i akcje
- [x] Nazwa, status (odznaka), kategoria, termin, miejsce, klient
- [x] Karta imprezy PDF (`/bridge/events/[id]/card`) — **PDF lokalnie** (Chrome na Macu, `?render=local`), bez Chrome — z serwera
- [ ] Edytuj wydarzenie (`EditEventModalNew` / `EditEventModa`: nazwa, daty, kategoria, klient, kontakt — także nowy kontakt) — na Macu „Edytuj” otwiera CRM; termin, lokalizacja, opis, notatki i kategoria — natywnie w Szczegółach
- [x] Duplikuj wydarzenie (`handleDuplicateEvent`: dane podstawowe, status „draft”, kwoty tylko z obszarem „kwoty”) — tylko z zarządzaniem wydarzeniem
- [x] Usuń wydarzenie (`delete-event-safe`) — tylko administrator, jak w CRM
- [x] Zmiana statusu (`EventStatusSelectModal`); w Szczegółach → Akcje z ograniczeniem statusów magazynu, „Rozliczony” → faktury zapłacone
- [x] Zmiana kategorii, wysyłka potwierdzenia do klienta (`EventDetailsAction`: historia potwierdzeń, podgląd odbiorcy, `send-event-confirmation`)
- [x] Checklista sprzętu (Szczegóły → Akcje przy „Gotowy do realizacji”: ostatni PDF z plików, podgląd na Macu)
- [x] Kroki wydarzenia (`EventStepsPanel`: `get_event_steps`, „Czekamy na”, etapy, wiersz kroku z historią, akcje `update_event_step` z oknem notatki / zamówienia, dodaj krok `add_event_step`, pomoc z treścią z CRM) — [ ] „Moje kroki” (pulpit)
- [ ] Gotowość workflow (`EventWorkflowReadinessPanel`: `get_event_workflow_readiness`, nadpisanie wymagania, synchronizacja zadań; odłożenie `snooze_event_workflow`)
- [x] Panel realizacji i przekazanie magazynowi bez kroków w bazie — dotychczasowe czynności (`LegacyWorkflowSection`), jak `stepsUnavailable` w CRM
- [x] Wiadomość / prośba do magazynu (`WarehouseMessageModal`: `get_event_warehouse_recipients`, `send_event_warehouse_message` z identyfikatorem prośby)
- [x] Kontrola przed wydarzeniem (`get_event_preflight`, bez pozycji handlowych bez obszaru dokumentów), „Najważniejsze” (`EventKeyFactsCard`: kolejność wg roli, termin, załadunek, miejsce, kierownik, magazyn, sprzęt, transport, kontakt na miejscu)
- [x] Kontakty na miejscu (`get_event_onsite_contacts`) — w „Najważniejsze” i w Szczegółach (bez obszaru klienta)
- [x] Status sprzętu w nagłówku (`EventEquipmentStatusBadge`) — przejście do zakładki Sprzęt
- [x] Nagłówek 1:1: klient wg typu (firma / osoba prywatna), „Kontakt:”, „Autor:”; baner „Oferta sprzedawcy przyjęta” z przejściem do Ustaleń; brak zakładek → „Brak dostępu do danych tego wydarzenia”
- [x] Otwieranie karty na zakładce z powiadomień i linków (`normalizeEventTabId`: details, summary, timeline, settlement…)
- [ ] Synchronizacja folderu z Makiem (`MacFolderSyncPanel`: klucz, odłączenie)

## Szczegóły (`EventsDetailsTab`, `EventDetailsAction`)
- [x] Termin (edycja jak `saveDates`), lokalizacja (podgląd, mapa, zmiana z listy `LocationSelector`, sale i scena / DJ `EventRooms` z kontrolą zmian), dodanie nowej lokalizacji (`AddLocationModal`: wyszukiwanie miejsc Google jak `/bridge/places/*`, `buildBestAddress`, punkt na mapie)
- [x] Informacje o kliencie (klient firmowy / prywatny, osoba kontaktowa, e-mail, telefon, przejście do kontaktu), kontakty na miejscu, zmiana klienta (`EditEventClientModal`: impreza indywidualna / firma, nowy klient, osoby kontaktowe wydarzenia, osoba główna)
- [x] Budżet jak w CRM (źródło, najnowsza oferta: rabat, netto, VAT, brutto, logistyka, koszty i wynik; przychód faktyczny, realizacja %)
- [x] Opis i notatki (edycja) — [ ] edytor z formatowaniem
- [x] Firma realizująca (logo z brandbooka) i zmiana (`EditRealizationCompanyModal`)
- [x] Akcje (`EventDetailsAction`): kategoria (z uprawnieniem do ofert), liczba ofert, status, potwierdzenie e-mail, checklista; podsumowanie zakresu dostępu (`eventAccessSummary`)
- [ ] Sposób rozliczenia (`EventBillingContextCard`: organizacja rozliczająca, kontakty do faktur, grupy rozliczeń `save_event_settlement_group` / `dissolve_event_settlement_group`, polecenie przez sprzedawcę) — w CRM
- [ ] Prowizje w Szczegółach (`EventCommissionsPanel`: sprzedawca z kartoteki, beneficjent, automatyczne `/bridge/events/commissions/automatic`, edycja) — w CRM; prowizje (dodaj, status, anulowanie automatycznych) natywnie w Finansach
- [x] Kontrola finansowa (plan płatności `set_event_payment_plan` / `refresh_event_payment_plan`, raty, zamknięcie) — natywnie w zakładce Finanse
- [x] Ustalenia sprzedawcy (`EventSellerCorrespondence`) — zakładka Ustalenia

## Etapy (Timeline)
- [x] Oś faz, dodaj / edytuj / usuń fazę, obsada z konfliktami, pojazdy i sprzęt w fazach (`EventPhasesTab`, `EventPhasesSheets`) — wygląd osi do dopracowania po review

## Oferty
- [x] Lista ofert (`EventTabOffer`) z wartością brutto / netto, statusem i datami, usuwanie (szkic / wysłana, administrator — każda), otwarcie oferty
- [ ] Nowa oferta (`CreateOfferModa`, `OfferWizard`), wysyłka (`SendOfferEmailModal`), rezerwacja sprzętu — w CRM

## Agenda
- [x] Agenda: pozycje, notatki, edycja, kolejność; PDF (`/bridge/events/agenda-pdf`) — **PDF lokalnie**, zapis do plików wydarzenia; pokaż / pobierz / drukuj

## Karta wesela
- [x] Sekcje karty, odpowiedzi, osoby i harmonogram (`replace_wedding_people_and_schedule`), postęp; PDF (`/bridge/events/wedding-card-pdf`) — **PDF lokalnie**

## Finanse (`EventFinancesTab`, `EventSettlementTab`)
- [x] Podsumowanie (`get_event_financial_summary`, dostęp `get_event_finance_access`), koszty (dodaj / status / usuń), prowizje, pracownicy, podwykonawcy, gotówka, plan płatności i raty, zamknięcie
- [x] Rozliczenie wydarzenia (Podsumowanie: `get_event_settlement`, linie, wyłączenia, faktury kosztowe, udziały sprzedawców, stawki, zatwierdzanie, historia)
- [ ] Wystaw fakturę z wydarzenia (`IssueInvoiceFromEventModal`, KSeF), faktura końcowa — w CRM

## Kalkulacje
- [x] Lista (suma netto, PDF, akceptacja jako źródło finansów), nowa, duplikuj (`duplicate_sales_calculation`), usuń; edytor (sekcje Pozycje / Ludzie / Transport / Pozostałe, sumy netto i brutto, moc 230 / 400 V, waga, kolejność przeciąganiem), pozycja z magazynu ze stanem, usługa personelu z katalogu, pojazd z bazy, ręczna; trasa i stawka paliwa (Google Maps, ceny AutoCentrum, VAT paliwa); import z oferty (produkty, zawartość, transport); PDF (`/bridge/events/calculation-pdf`) — **PDF lokalnie**, podgląd / pobierz / drukuj
- [ ] Wyślij kalkulację e-mailem (`SendCalculationEmailModal`) — w CRM

## Umowy (`EventContractTab`)
- [x] Status z datami i zasadami CRM (dla wystawionej umowy), wersja, blokada po podpisaniu, potwierdzenie podpisu firmy, PDF bieżący i archiwalne wersje (podgląd, pobierz, drukuj), podpisane dokumenty (lista, otwieranie, dodawanie PDF / JPG / PNG jak `/contracts/signed-files`)
- [ ] Edytor umowy w CRM: dane i osoby podpisujące, treść, klauzule (`EventContractClausesModal`, audyt `audit-contract`), szablon, depozyt, wystawienie szkicu, generuj PDF (`/contracts/generate`), wysyłka, anulowanie z hasłem (`/cancel`) — treść składa i dzieli na strony edytor przeglądarki z bieżących danych oferty i szablonu

## Sprzęt (`EventEquipmentTab`)
- [x] Lista z dostępnością, zestawy, dodaj, ilości z limitem, import z kalkulacji, konflikty z ofertą, rental, alternatywy, uwagi
- [x] Checklista wydania i zwrotu, PDF checklisty — **PDF lokalnie**

## Zespół

- [x] Lista (`AddMembersList`): osoby z odpowiedzialności, status, kierownik realizacji (mianuj / odbierz), zaproszenie, aktualny timeline, rola i obowiązki, uprawnienia w wydarzeniu, usuń; dodaj osobę (`AddEventEmployeeModal`: fazy osoby, poziom dostępu, uprawnienia, zaproszenie z timeline)

## Logistyka (`EventLogisticsPanel`)
- [x] Pojazdy (dodaj / edytuj, kierowcy, konflikty), trasa i koszt paliwa, statusy przejazdu i przekazania, usuwanie

## Podwykonawcy (`EventSubcontractorsPanel`)
- [x] Zadania, umowy (wysyłka pliku), katalog usług, wytyczne (`generate-subcontractor-guidelines`, wysyłka `send-subcontractor-assignment`) — [ ] nowy podwykonawca w kartotece — w CRM

## Pliki (`EventFilesExplorer`)
- [x] Foldery, upload (przeciąganie), kopiuj / wytnij / wklej, zmiana nazwy, usuwanie, pobieranie, podgląd Quick Look — [ ] folder Mac / iCloud (`MacFolderSyncPanel`) — w CRM

## Zadania (`EventTasksBoard`)
- [x] Tablica (Do zrobienia, W trakcie, Do sprawdzenia, Ukończone), dodaj / edytuj / usuń, przypisania (z dopisaniem do zespołu), timer czasu pracy, przenoszenie

## Historia
- [x] Dziennik zmian (`event_audit_log`): oś czasu z filtrami i widok „Po dacie”
