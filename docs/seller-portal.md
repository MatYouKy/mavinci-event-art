# Sprzedawcy zewnętrzni: portal i kokpit opiekuna

Migracja: `supabase/migrations/20261105150000_seller_manager_cockpit.sql` (wymaga `20261105130000_event_settlement_commissions.sql`, można uruchomić ponownie). Wspólny kod CRM ↔ aplikacja: `src/lib/seller/sellerCockpit.ts` ↔ `mobile/src/lib/sellerCockpit.ts` (typy, odczyt wyników RPC, etykiety). Zakres, uprawnienia i powiadomienia liczy baza — interfejs tylko wyświetla i wysyła zmiany.

## Zasady

- **Opiekun sprzedawcy** = `sales_partner_profiles.manager_id`, opcjonalnie **zastępca** `backup_manager_id`. Jedno źródło prawdy: opiekun kontaktu (`contacts.owner_id`) nie daje opiekuna sprzedawcy (kontakt bez opiekuna mógłby „przejąć” każdy z prawem edycji kontaktów). Na start opiekunem został opiekun kontaktu, jeśli może prowadzić sprzedawców. Przypisuje administrator (`set_seller_manager`, z powodem w historii); przy okazji kontakt sprzedawcy dostaje tego samego opiekuna. Opiekunem może być aktywny pracownik z uprawnieniem do ofert (`offers_manage`) i dostępem do wszystkich aktywnych marek sprzedawcy — inaczej błąd z nazwą marki.
- Nowy profil sprzedawcy dostaje opiekuna sam: opiekuna kontaktu (jeśli może prowadzić sprzedawców), a bez niego — pracownika, który zakłada profil (nie administratora). Ręcznie ustawionego opiekuna w zapisie bazy się nie zmieni — tylko przez RPC.
- **„Mój sprzedawca”** (`seller_partner_is_mine`) = administrator, opiekun albo zastępca. Sprzedawca bez opiekuna jest tylko u administratorów (ostrzeżenie „Brak opiekuna” w kokpicie). Tylko oni widzą i obsługują: rozmowy ze sprzedawcą, skrzynkę, sprawdzanie ofert, kartę sprzedawcy w CRM, zapytania, link dla gościa i oferty z portalu bez wydarzenia (zasada RLS `seller_portal_offer_manager_scope`; finanse czytają oferty). Administratorzy dalej dostają kopię każdej wiadomości od sprzedawcy. Odczyt warunków marek (stawki) bez zmian dla pracowników, którzy widzą profil sprzedawcy (np. panel prowizji wydarzenia); zapis — opiekun, zastępca, finanse, administrator.
- **Wynagrodzenie w portalu** (`sales_partner_brand_terms.commissions_visible`, osobno dla sprzedawcy i marki): domyślnie ukryte — opiekun odsłania je przełącznikiem „Pokaż wynagrodzenie w portalu”, kiedy uzna, że czas o tym rozmawiać. Prowizja nalicza się niezależnie od widoczności (`commission_enabled`). Ukryte = portal nie pokazuje stawki, kwot ani zakładki prowizji tej marki; `get_seller_portal_context` zwraca wtedy `default_commission_rate` i `default_payment_method` jako `null`. Narzut (model „narzut”) jest zawsze widoczny — to cena dla klienta. Zmienia opiekun, zastępca, finanse albo administrator (`set_seller_commission_visibility`, z historią); po odsłonięciu sprzedawca dostaje powiadomienie z sumą już naliczonego wynagrodzenia. Na start: aktywne warunki z włączoną prowizją zostały widoczne (tak jak przed wdrożeniem). Sprzedawca nie czyta tabeli warunków bezpośrednio (stawka tylko przez RPC z maskowaniem); kwoty zapisane w jego własnych ofertach w modelu prowizyjnym są technicznie dostępne przez API — ukrycie dotyczy portalu, nie jest tajemnicą.
- Portal pokazuje przy prowizji stawkę i kwotę podstawy, bez opisu podstawy (`base_description` = `null` w trybie sprzedawcy). Skąd podstawa — w podsumowaniu wydarzenia (niżej).
- **Prowizja = % od zysku netto wydarzenia** po kosztach i po koszcie samej prowizji (`docs/event-commissions.md`). Stawkę ustala się przy mianowaniu (karta sprzedawcy: „Prowizja (% od zysku)”, nowa marka ma od razu włączone rozliczenie prowizyjne), a dla jednego wydarzenia — w jego podsumowaniu.
- Start (opiekunowie z opiekunów kontaktów, widoczność) wykonuje się raz — znacznik `[start:2026-11-05]` w komentarzu tabeli `sales_partner_audit`; ponowne uruchomienie migracji nie zmienia decyzji opiekunów.
- Usunięcie pracownika czyści go jako opiekuna / zastępcę (klucz obcy) — bez blokady strażnika.
- Historia zmian sprzedawcy (`sales_partner_audit`, tylko dopisywanie): profil, opiekun, warunki marek, widoczność wynagrodzenia, konto portalu — z autorem i powodem (`get_seller_audit`).
- Warunki marek zapisuje opiekun / zastępca (z `contacts_manage`), finanse, administrator, a sprzedawcę bez opiekuna — osoba, która go założyła (`created_by` ustawia baza z sesji).
- Konto portalu (`portal_auth_user_id`) podłącza tylko zaproszenie do portalu (rola serwisowa); odłączyć można. Kontaktu, który jest sprzedawcą, nie da się usunąć — zmień status sprzedawcy na „nieaktywny”.
- Wydarzenie z oferty z portalu prowadzi opiekun przez udział sprzedaży (podsumowanie wydarzenia: `seller_partner_manager_id`) — widzi wydarzenie (`current_employee_sells_event`), a krok „sprzedaż” idzie do głównego udziału sprzedaży. Autora wydarzenia (`created_by`) baza nie zmienia.
- Prowizja z „Ustaleń ze sprzedawcą” i dla kontaktu rozliczeniowego hotelu / agencji należy się osobie, która pracowała w tej organizacji w dniu wydarzenia (`contact_organizations.is_current` albo `ended_at` ≥ data wydarzenia) — odejście po wydarzeniu nie odbiera prowizji.

## Oś oferty, słownictwo i pomoc „?” (audyt kreatora, etap 1)

- **Jedna oś w 5 etapach** zamiast kilkunastu nazw statusów: Oferta → U klienta → U opiekuna → Wydarzenie → Rozliczenie (`src/lib/seller/offerJourney.ts`, komponent `src/components/seller/SellerJourney.tsx`). Pod osią zawsze stan („Do poprawy”, „Czeka na potwierdzenie terminu”…), kto działa („Teraz działa: Ty / Anna / Klient”) i jedno zdanie „Teraz”. Ta sama oś: pulpit, lista ofert (kreski i filtr `?etap=offer|client|manager|mine`), strona oferty, „Wydarzenia”, ocena oferty w CRM (widok opiekuna). Etap liczy się z zapisanych decyzji (status oferty, ocena bieżącej wersji, realizacja, status wydarzenia, istnienie i aktualność PDF) — daty niczego nie przesuwają.
- **„Klient”** = osoba zamawiająca wydarzenie (wcześniej zamiennie „gość”). „Liczba gości” i „goście hotelu” (kody QR) pozostają. Teksty z bazy (powiadomienia „Gość zaakceptował…”, błędy linku) zmieni migracja etapu 2.
- **PDF jako wkładka**: hotel najczęściej pobiera PDF i dołącza go do własnej oferty — „Pobierz PDF” jest głównym przyciskiem na stronie oferty; „Link dla klienta” jest opcjonalny i stoi pod PDF.
- Nazwy czynności: „Zaktualizuj PDF” (wcześniej „Regeneruj PDF”), „Wyślij do opiekuna” (wcześniej „Przekaż akceptację opiekunowi”), menu „Wydarzenia” (wcześniej „Potwierdzone wydarzenia”) z sekcjami „Czeka na potwierdzenie terminu”, „Potwierdzone”, „Zakończone, wstrzymane i anulowane”.
- Kreator: krok „Klient i termin”, lista wszystkich braków kroku naraz, „Twoje rozliczenie: marża / prowizja” na górze usług, „Do rozważenia przez klienta” (dawniej propozycje dodatkowe), baner „Cena do zgody opiekuna (N pozycji)” w podsumowaniu, przy braku sal — „Napisz do opiekuna” z gotową wiadomością (`/seller/messages?draft=…`, tekst tylko wpisany w pole rozmowy ogólnej).
- **Pomoc pod „?”** (`src/lib/help/`, `src/components/help/HelpDrawer.tsx`): panel z boku z rozdziałem dla bieżącego ekranu, wyszukiwarką i „Zapytaj opiekuna”; klawisz „?” poza polami tekstowymi; „?” przy pojęciach (sposób rozliczenia, do rozważenia, zgoda na cenę, wersje PDF, link dla klienta). Portal: przycisk w górnym pasku i strona `/seller/help` („Pomoc” w menu). CRM: instrukcja opiekuna w „Sprzedawcach” i na ocenie oferty. Zasada: zmiana procesu zmienia też rozdział instrukcji.
- Tryb pokazowy CRM („Jak to działa”) opowiada tę samą ścieżkę: wizyta, zaproszenie, oferta i klient, u opiekuna, wydarzenie, rozliczenie.

## Zgoda na cenę i akceptacja online (audyt kreatora, etap 2)

Migracja: `supabase/migrations/20261114230000_seller_price_approval_and_auto_review.sql` (po `20261105150000_seller_manager_cockpit.sql`, można uruchomić ponownie).

- **Zgoda na cenę przed pokazaniem oferty klientowi.** Pozycja własna albo cena poniżej stawki → `offers.partner_approval_status = 'required'` (jak dotąd liczy to zapis oferty i trigger sum). Kreator po każdym zapisie wywołuje `request_seller_offer_price_approval(p_offer, p_note)` — prośba trafia do opiekuna i zastępcy (powiadomienie „Prośba o zgodę na cenę”, grupa „Ceny do zgody” w kokpicie CRM i w aplikacji). Prośba o te same ceny nie dubluje się; nowe ceny zastępują starą prośbę (`superseded`). Opiekun decyduje w CRM na stronie oferty (`decide_seller_offer_price_approval(p_offer, 'approved'|'changes_requested', p_note, p_expected_key)` — klucz cen, które widział; prośba o zmianę wymaga uzasadnienia). Stan: `get_seller_offer_price_approval(p_offer)` (sprzedawca i „mój sprzedawca”), lista w kokpicie: `get_my_seller_price_requests(p_manager)`.
- Do zgody: link dla klienta nie działa (`guest_ready`, bez zmian), a **PDF dla klienta** nie pobierze się z portalu (trasa `/bridge/seller/offers/[id]`, akcja `document` z `download`, błąd 409). Podgląd PDF działa.
- **Zgoda trzyma się cen**, nie wersji: `offers.partner_price_approval_key` = odcisk pozycji wymagających zgody (`private.seller_offer_price_key`: produkt, nazwa, ilość, dni, cennik i cena dla klienta). Trigger `trg_keep_seller_price_approval` przywraca `approved`, gdy zapis oferty ustawia `required`, a odcisk jest ten sam (zmiana tytułu, terminu czy klienta nie kasuje zgody); każde przejście na `approved` (zgoda na cenę albo przyjęcie oferty w ocenie) zapamiętuje odcisk. Po zgodzie PDF trzeba zaktualizować (klucz źródła oferty zawiera stan zgody) — „Pobierz PDF” robi to sam.
- Historia: `seller_offer_price_requests` (tylko przez RPC, RLS bez polityk) i `partner_offer_activities` (`price_approval_requested`, `price_approved`, `price_changes_requested`).
- **Akceptacja online klienta przekazuje ofertę do oceny** (`accept_shared_seller_offer` → `private.request_seller_offer_review_after_client_acceptance`): tylko gdy zaakceptowany PDF jest aktualny, oferta ma termin, nie ma już oceny tej wersji, a powiadomienie ma odbiorcę. Zapisuje też zgodę klienta przy tej wersji (`seller_offer_client_acceptances`, opis „Akceptacja online klienta: …”, konto sprzedawcy jako właściciel oferty). Gdy się nie da, akceptacja zostaje, a sprzedawca dostaje powiadomienie z powodem i wysyła ofertę sam. Wynik: `{ok, accepted_at, forwarded}`.
- **„Klient zaakceptował poza portalem”** w portalu: trzy kroki (jak — e-mail, telefon, spotkanie, podpisana oferta hotelu, inaczej; aktualna wersja PDF; uwagi dla opiekuna). Sposób i uwagi trafiają na początek wiadomości do opiekuna (`request_review`: `acceptanceChannel`, `sellerNote`).
- Kreator: start od zera, z zapytania (`/seller/offers/new?inquiry=<id>` — klient, termin, liczba gości) albo jako kopia poprzedniej oferty (`?copy=<id>` — usługi, propozycje, tytuł, opis; usługi z konfiguratora trzeba skonfigurować ponownie). Po zapisie strona oferty pokazuje „Gotowe — co dalej?” (`?gotowe=1`).
- Lista ofert: `get_seller_offer_delivery_states` zwraca też `approval_status` i `price_request` — oś pokazuje „Cena czeka na zgodę”, „Opiekun prosi o zmianę ceny”, „Poproś o zgodę na cenę”.
- Teksty z bazy: „Klient otworzył ofertę”, „Klient zaakceptował…”, „Link dla klienta będzie dostępny po zgodzie opiekuna na cenę”, „Gość hotelu zostawił zapytanie” (kody QR), „Klient: …” w zapytaniu CRM.

## Podsumowanie wydarzenia w portalu

`get_seller_event_summary(p_event)` (sesja sprzedawcy) — „Moje wynagrodzenie” (przy każdym wydarzeniu „Podsumowanie wydarzenia — skąd ta kwota”, `?event=<id>` otwiera to wydarzenie) i realizacja z portalu. Dostęp: sprzedawca jest w podsumowaniu wydarzenia (albo ma wpis prowizji w wydarzeniu) i marka ma widoczne wynagrodzenie. Wynik: `{event{id, name, date, end_date, location, cancelled}, source forecast|submitted|approved, as_of, base_rule profit|revenue_minus_subcontractors, forecast, lines[{kind, category, name, net_amount, date, to_confirm}], totals{revenue_net, subcontractor_net, direct_cost_net, team_net, external_commission_lines, event_costs_net, profit_before_external, external_commission_auto, own_commission_cost, other_sellers_cost, profit_net, partner_base, rounding_difference}, mine{rate, rate_label, base, amount, company_cost, payment_method, dividend_tax_rate}|null, commissions[{id, entry_kind, status, amount, paid_amount, offset_amount}]}` — typy i odczyt: `src/lib/seller/sellerEventSummary.ts`. Wysłane / zatwierdzone podsumowanie = wersja z chwili wysłania / zatwierdzenia (`event_settlement_versions`), inaczej prognoza. Pozycje włączone do podsumowania z kwotą netto; ekipa jedną kwotą (bez nazwisk i stawek), prowizje / narzuty innych sprzedawców bez nazwisk; bez prowizji pracowników, notatek, opisów i autorów zmian. Starsze zatwierdzenia (sprzed zasady „od zysku”) mają `base_rule = revenue_minus_subcontractors` i taki opis.

## Szybkie zapytania i kod QR

- **„Sprawdź termin”** w portalu (`submit_seller_inquiry`): gość, e-mail albo telefon, data (nie z przeszłości), liczba gości, rodzaj (`wedding|conference|gala|party|corporate|other`), miejsce, budżet netto, uwagi. Idempotentne po `p_request_id`. Trafia do opiekuna (i zastępcy; bez nich — do administratorów).
- **Kod QR w hotelu**: sprzedawca tworzy link (`create_seller_inquiry_link`, nazwa np. „Recepcja”, do 20 aktywnych), drukuje kod do `/zapytanie/<token>`. Gość wypełnia formularz bez logowania (`submit_public_seller_inquiry`, wymagana zgoda na kontakt). Limity: 5 zgłoszeń na godzinę z jednego urządzenia (skrót adresu IP, bez zapisu adresu), 20 na godzinę i 60 na dzień na kod, 150 na dzień na sprzedawcę. Powiadomienie dostaje sprzedawca i opiekun. Nieaktywny link: `get_seller_inquiry_form` zwraca `{"active": false}`.
- Opiekun odpowiada (`respond_seller_inquiry`: w toku / odpowiedziano / zamknięte — odpowiedź widzi sprzedawca i dostaje powiadomienie) albo zamienia zapytanie w zapytanie CRM (`convert_seller_inquiry` → `tasks.is_inquiry`, prowadzi opiekun, następny kontakt jutro).

## Link do oferty dla gościa

- Sprzedawca (też opiekun / administrator) tworzy link `/oferta/<token>` (`create_seller_offer_share_link`, `p_rotate` = nowy link, stary przestaje działać), widzi otwarcia i akceptację (`get_seller_offer_share_state`), może go wyłączyć (`revoke_seller_offer_share_link`). Jeden aktywny link na ofertę.
- Link działa tylko dla oferty zatwierdzonej przez MAVINCI albo niewymagającej zatwierdzenia (`partner_approval_status` `not_required|approved`), aktywnego sprzedawcy z włączonym portalem i aktywnej marki (`guest_ready` w stanie linku). Zmiany czekające na sprawdzenie wstrzymują link — po zatwierdzeniu działa ten sam adres.
- Gość bez logowania (`get_shared_seller_offer`): pozycje z ceną dla klienta netto, suma netto / VAT / brutto, hotel i marka, dane sprzedawcy, PDF (jeśli wygenerowany). Bez kosztów, narzutu i prowizji. Pierwsze otwarcie → wpis „gość otworzył ofertę” w historii oferty i powiadomienie sprzedawcy. Otwarcie przez zalogowanego sprzedawcę lub pracownika (podgląd) się nie liczy. Wizytówka: tylko pola wizualne (kolory, czcionka, nazwa, stopka) — logo hotelu przez trasę `/bridge/public/seller-offer-asset` (podpisany link z prywatnego bucketu `seller-brand-assets`), kontakt z wizytówki sprzedawcy.
- Akceptacja online (`accept_shared_seller_offer`: imię i nazwisko, e-mail, uwagi, zgoda) — idempotentna; zapisuje to, co gość zaakceptował (`accepted_snapshot`: pozycje, sumy, ostatni PDF) i potem pokazuje gościowi właśnie to; powiadamia sprzedawcę i opiekuna. To deklaracja gościa, nie zmienia statusu oferty — opiekun potwierdza dalej w CRM.
- PDF: `get_shared_seller_offer_document` tylko dla roli serwisowej (trasa `/bridge/public/seller-offer-pdf` zwraca podpisany link z bucketu `seller-offer-documents`).
- Strony gościa (`/oferta/<token>`, `/zapytanie/<token>`) są bez nawigacji i stopki strony WWW (`src/lib/seller/guestPages.ts`), `noindex`.

## Kokpit opiekuna (CRM „Sprzedawcy”, aplikacja „Moi sprzedawcy”)

`get_my_seller_cockpit(p_manager, p_partner)` — pracownik widzi swoich sprzedawców (`p_manager` ignorowane), administrator wszystkich albo jednego opiekuna; `p_partner` = tylko ten sprzedawca (karta sprzedawcy). Demo dla hotelu: `/crm/salespeople/demo` (bez zapisu w bazie):

- **Dziś**: oferty do sprawdzenia, kroki realizacji do zatwierdzenia, wydarzenia do potwierdzenia, rozmowy bez odpowiedzi (z czasem oczekiwania), zapytania, akceptacje gości.
- **Sprzedawcy**: organizacja, konto portalu (`none|invited|active`), ostatnie logowanie i aktywność, opiekun i zastępca, marki (stawka, widoczność wynagrodzenia), oferty według etapów, najbliższe wydarzenia, do wypłaty / prognoza, ostrzeżenia.
- **Lejek** (szkic → PDF → do sprawdzenia → zaakceptowana → wydarzenie → zakończone → rozliczone) i wydarzenia w 14 dni.
- Ostrzeżenia (`sellers[].warnings` = kody, `sellers[].warning_messages` = komunikaty; zbiorczo `warnings[]`): `no_manager`, `manager_without_rights`, `no_active_terms`, `invite_pending` (portal włączony, konto nieaktywne po 7 dniach), `inactive_30`, `inactive_60`.

`get_my_sales_day()` ma klucz `sellers` (liczniki + do 10 spraw z linkiem do CRM) — karta „Sprzedawcy — do zrobienia” w „Moim dniu” (CRM i aplikacja). `get_crm_seller_directory()` ma przy profilu opiekuna, konto portalu, ostatnią aktywność i `is_mine`.

## Powiadomienia

| Zdarzenie | Kto |
|---|---|
| Wiadomość od sprzedawcy | opiekun + zastępca + administratorzy (bez opiekuna: administratorzy) |
| PDF oferty z portalu | opiekun + zastępca + administratorzy |
| Oferta do sprawdzenia | opiekun + zastępca (bez nich: administratorzy) |
| Zapytanie sprzedawcy | opiekun + zastępca (bez nich: administratorzy) |
| Zapytanie z kodu QR | sprzedawca + opiekun |
| Odpowiedź na zapytanie | sprzedawca |
| Gość otworzył ofertę (pierwsze otwarcie) | sprzedawca |
| Gość zaakceptował ofertę | sprzedawca + opiekun |
| Wydarzenie z oferty sprzedawcy: anulowane, zmiana terminu lub miejsca | sprzedawca + opiekun |
| Prowizja zatwierdzona / wypłacona (tylko marki z widocznym wynagrodzeniem) | sprzedawca |
| Odsłonięcie wynagrodzenia | sprzedawca |

Powiadomienia sprzedawcy trafiają do dzwonka i skrzynki portalu (`notifications.metadata.workflow`: `seller_offer`, `seller_review_result`, `seller_event`, `seller_commission`, `seller_inquiry`, `seller_guest`, `seller_visibility`). Błąd zapisu powiadomienia nigdy nie blokuje zapisu sprawy.

## Interfejs

**CRM**
- `/crm/salespeople` — zakładka „Kokpit opiekuna” (domyślna: Dziś, Moi sprzedawcy, lejek, najbliższe wydarzenia, ostrzeżenia; administrator filtruje po opiekunie) i „Kartoteka sprzedawców” (`?view=directory`: opiekun, konto portalu, ostatnia aktywność, filtr „Wszyscy / Moi”). `?inquiry=<id>` przewija do zapytania w „Dziś”. Menu „Sprzedawcy” widzi też sprzedaż (`offers_manage`), dane zawęża baza.
- Karta sprzedawcy (`?seller=<id>`) → Ustawienia: „Opiekun i zastępca” (administrator), „Wynagrodzenie w portalu” (przełącznik per marka, z potwierdzeniem i powiadomieniem), zakładka „Historia zmian”.
- Kontakty: filtr „Tylko sprzedawcy”, oznaczenia statusu sprzedawcy i organizacji zatrudniających sprzedawców; karta organizacji — lista sprzedawców hotelu, „Mianuj sprzedawcą”, „Pokaż portal hotelowi”.
- `/crm/salespeople/demo` — tryb pokazowy portalu dla hotelu (logo i nazwa hotelu tylko lokalnie, produkty z katalogu, kreator oferty, oferta dla gościa, wynagrodzenie do ukrycia, „Jak to działa”, „Zaproś hotel do portalu”). Nic nie zapisuje.
- Oferta z portalu → „Utwórz klienta z danych oferty” (podgląd i potwierdzenie).
- „Mój dzień” — karta „Sprzedawcy — do zrobienia”.

**Portal sprzedawcy**
- Pulpit: „Do zrobienia”, karta „Twój opiekun” (zdjęcie, telefon, WhatsApp, e-mail, czat), lista startowa (pierwsze logowanie), prognoza wynagrodzenia tylko dla marek z widocznym wynagrodzeniem.
- „Sprawdź termin” (`/seller/inquiries`): formularz i lista zapytań z odpowiedzią opiekuna.
- Kreator oferty w 3 krokach (Klient i termin / Usługi / Podsumowanie) z paskiem sumy na telefonie i ochroną przed wyjściem; pozycja własna ma cenę klienta w obu modelach rozliczenia.
- Oferta → oś w 5 etapach, „Pobierz PDF” (wkładka do oferty hotelu), „Link dla klienta — opcjonalnie” (kopiuj, udostępnij, podgląd, wyłącz, nowy link, wyświetlenia, akceptacja z kwotą).
- „Pomoc” (`/seller/help`) i „?” w górnym pasku każdego ekranu.
- „Materiały dla hotelu” (`/seller/materials`): kody QR (PNG, karta A5 do druku).
- „Moje wynagrodzenie” — tylko gdy któraś marka ma widoczne wynagrodzenie.
- Zaproszenie e-mail: „Zaproszenie do współpracy z MAVINCI” z nazwiskiem zapraszającego.

**Aplikacja mobilna** (1.3.13): „Mój dzień” — karta sprzedawców; Profil → „Moi sprzedawcy” (podgląd kokpitu); Kontakty — oznaczenie i filtr „Tylko sprzedawcy”. Decyzje w CRM (`docs/mobile-parity.md`).

## Wdrożenie

1. SQL Editor: `20261105150000_seller_manager_cockpit.sql` (po `20261105130000_event_settlement_commissions.sql`), potem `20261114230000_seller_price_approval_and_auto_review.sql`.
2. Sprzedawcy bez opiekuna (ostrzeżenie w kokpicie administratora) — przypisz opiekuna w karcie sprzedawcy.
3. Nowi sprzedawcy mają wynagrodzenie ukryte — opiekun odsłania je, gdy przyjdzie pora.

## Kontrakt RPC

Wszystkie funkcje `public.*`, SECURITY DEFINER, zwracają `jsonb`; błędy to polskie komunikaty (`error.message` do pokazania).

### CRM
- `get_my_seller_cockpit(p_manager uuid DEFAULT NULL, p_partner uuid DEFAULT NULL)` → `{viewer{employee_id,is_admin}, managers[{id,name,eligible}] (administrator), today{reviews[], wizard_steps[], events_pending[], chats_waiting[], inquiries[], guest_acceptances[]}, sellers[], pipeline{draft,pdf,review,accepted,confirmed,completed,settled}, upcoming[], warnings[{sales_partner_id,seller_name,code,message}]}` — pola: `src/lib/seller/sellerCockpit.ts`.
- `set_seller_manager(p_partner, p_manager, p_backup DEFAULT NULL, p_reason DEFAULT NULL)` → `{ok, manager_id, backup_manager_id}` (administrator; `p_manager` NULL = usuń).
- `set_seller_commission_visibility(p_partner, p_company, p_visible, p_reason DEFAULT NULL, p_notify DEFAULT true)` → `{ok, commissions_visible, changed}`.
- `get_seller_audit(p_partner, p_limit DEFAULT 50)` → `[{id, action, my_company_id, brand_name, before, after, reason, actor_name, created_at}]` (profil: także `organization_name`, `manager_name`, `backup_manager_name`); `action`: `profile_created|profile_updated|manager_changed|terms_created|terms_updated|terms_deleted|visibility_changed|portal_account_linked|portal_account_unlinked`.
- `respond_seller_inquiry(p_inquiry, p_status in_progress|answered|closed, p_response DEFAULT NULL)` → `{ok}`; `convert_seller_inquiry(p_inquiry)` → `uuid` zapytania CRM.
- `create_client_from_seller_offer(p_offer, p_confirm DEFAULT false)` — bez potwierdzenia podgląd `{contact, organization, matches{contact_id?, organization_id?}, linked}`; z potwierdzeniem tworzy / łączy kontakt (i organizację, gdy podano firmę), ustawia klienta oferty (`client_type`) i pustego klienta wydarzenia → `{ok, contact_id, organization_id, created}`.
- `get_my_sales_day()` → klucz `sellers {reviews, chats_waiting, inquiries, wizard_steps, events_pending, guest_acceptances, items[{kind review|chat|inquiry|wizard|event|guest, title, seller_name, at, url}]}`.
- `get_crm_seller_directory()` → profil: `manager_id, backup_manager_id, manager_name, backup_manager_name, portal_account, last_sign_in_at, last_activity_at, is_mine`.
- `get_crm_seller_workspace(p_partner)` (tylko „mój sprzedawca”) → dodatkowo `manager{manager_id, backup_manager_id, manager_name, backup_manager_name, manager_ok, can_assign}`, `portal{portal_account, last_sign_in_at}`, `terms[{my_company_id, name, is_active, commission_enabled, rate, commissions_visible, visibility_changed_at, visibility_changed_by}]`, `guest_link`.

### Portal (sesja sprzedawcy)
- `get_seller_portal_context()` → `manager{name, email, phone, photo_url, position}`, `brands[].commissions_visible`.
- `get_seller_event_summary(p_event)` → podsumowanie wydarzenia (wyżej).
- `get_seller_portal_commissions()`, `get_commission_settlements('seller', …)` — tylko marki z widocznym wynagrodzeniem.
- `submit_seller_inquiry(p_company, p_request_id, p_values)` → `{ok, id}`; `get_seller_inquiries(p_limit DEFAULT 50)`.
- `create_seller_offer_share_link(p_offer, p_rotate DEFAULT false)` → `{token, path, created_at}`; `get_seller_offer_share_state(p_offer)` → `{active, token, path, created_at, first_viewed_at, last_viewed_at, view_count, accepted_at, accepted_name, accepted_email, accepted_note, accepted_totals, accepted_document, guest_ready}`; `revoke_seller_offer_share_link(p_offer)`.
- `save_seller_portal_offer_v5` zapisuje też `p_offer.guest_count` (1–100 000).
- `create_seller_inquiry_link(p_company, p_label)` → `{id, token, path, label}`; `get_seller_inquiry_links()`; `revoke_seller_inquiry_link(p_id)`.

### Publiczne (anon)
- `get_shared_seller_offer(p_token)` → `{status active|accepted|expired|revoked, offer{…}, items[{name, description, quantity, days, unit, unit_price_net, total_net}], totals{net, vat, gross, vat_percent}, branding{hotel_name, brand_name, has_logo, has_cover, snapshot (pola wizualne)}, seller{name, position, email, phone}, document{available, filename}, accepted{at, name}|null}`; nieznany token → błąd „Ten link do oferty jest nieaktywny.”
- `accept_shared_seller_offer(p_token, p_name, p_email, p_note, p_consent)` → `{ok, accepted_at, duplicate?}`.
- `get_seller_inquiry_form(p_token)` → `{active, hotel_name, brand_name, label, logo_url}`; `submit_public_seller_inquiry(p_token, p_request_id, p_values + consent)` → `{ok}`.
- Rola serwisowa: `get_shared_seller_offer_document(p_token)` → `{storage_path, filename}`; `get_shared_seller_offer_asset(p_token, p_kind logo|cover)` → `{bucket, storage_path}`.
