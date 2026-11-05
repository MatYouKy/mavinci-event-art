# Obszary danych wydarzenia — kto co widzi

Każdy pracownik widzi na wydarzeniu to, czego potrzebuje na swoim stanowisku. Regułę wymusza baza (RLS i funkcje), więc obowiązuje tak samo w CRM, w aplikacji mobilnej, w API i na Karcie imprezy. Migracje: `20261105090000_event_access_areas.sql`, `20261105100000_event_financials.sql`, `20261105110000_sales_colleague_visibility.sql`. Wspólne mapowanie na zakładki: `src/lib/events/access/eventAccess.ts` ↔ `mobile/src/lib/eventAccess.ts`.

## Obszary

| Obszar | Co obejmuje | Kto ma |
|---|---|---|
| Realizacja (`operations`) | termin, miejsce, sprzęt, logistyka, zespół, harmonogram, agenda, pliki operacyjne, kroki realizacji | każdy, kto widzi wydarzenie: zespół (przyjęte zaproszenie), magazyn (`equipment_manage` — wszystkie wydarzenia od akceptacji oferty), kierownik realizacji, kierowca, sprzedaż, biuro, administrator |
| Kontakt na miejscu (`onsite_contact`) | imię, rola i telefon osoby od klienta i z obiektu (`get_event_onsite_contacts`) | kierownik realizacji, kierowca, prowadzący, wszyscy z obszarem „klient” |
| Dane klienta (`client`) | organizacja, osoby kontaktowe, e-mail, karta klienta | sprzedawca / prowadzący, biuro (`role = manager`), administrator, uprawnienia kontaktów, klientów i ofert, `events_manage` |
| Kwoty (`values`) | budżet, przychód, koszty, kalkulacje i ich ceny (`event_financials`, `event_calculations`) | sprzedawca / prowadzący, biuro, administrator, `offers_*`, `finances_*`, dostęp finansowy działalności |
| Oferta, umowa i formalności (`commercial_docs`) | oferta, umowa, ustalenia ze sprzedawcą, historia zmian, pliki dokumentacji, kroki „Formalności” i „Rozliczenie” | sprzedawca / prowadzący, biuro, administrator, `offers_*`, `contracts_*`, `finances_*`, `invoices_*` |
| Faktury i rozliczenie (`billing`) | faktury, płatności, zakładka Finanse | jak `can_view_event_commercials` |
| Podgląd sprzedaży (`sales_overview`) | termin, miejsce, kategoria, status, nazwa klienta, sprzedane usługi bez cen, kto sprzedał (`get_event_sales_overview`) | każdy z realizacją oraz sprzedawcy przy sprzedanych wydarzeniach innych sprzedawców |

Magazyn, kierownik realizacji (bez uprawnień handlowych), technik, DJ i freelancer mają tylko realizację; kierownik i kierowca dodatkowo kontakt na miejscu.

## Sprzedawcy między sobą

Sprzedawca (uprawnienia ofert lub zapytań) widzi sprzedane wydarzenia innych sprzedawców — od akceptacji oferty, w swoich działalnościach — żeby wiedzieć, które terminy są zajęte. Ma wtedy tylko „Podgląd sprzedaży”: termin, miejsce, klienta (nazwę), sprzedane usługi i kto sprzedał. Nie widzi kwot, oferty, umowy, kroków, plików, zespołu ani danych kontaktowych i nie może takiego wydarzenia zmienić (zakres `events_own_only` dalej obowiązuje dla zapisu). Administrator widzi wszystko. Migracja `20261105110000_sales_colleague_visibility.sql`; w kalendarzu (`get_events_list`) takie wydarzenia mają `sales_colleague: true`, bez kwot i notatek.

## Co wymusza baza

- **Kontakty i organizacje**: odczyt i zapis dla ról pracujących z klientami (`crm_can_read_client_directory`) albo dla kontaktów wydarzeń, na których osoba ma obszar „klient”. Organizacje-podwykonawcy widzą wszyscy. Wcześniej każdy zalogowany czytał (i mógł zmieniać) całą bazę klientów.
- **Kalkulacje**: tylko obszar „kwoty”. Magazyn dostaje pozycje sprzętowe zaakceptowanej kalkulacji bez cen (`get_event_calculation_equipment`).
- **Kwoty wydarzenia**: w `event_financials` (odczyt: obszar „kwoty”). Kolumny w `events` są puste; zapis do nich przenosi wyzwalacz. `get_events_list` zwraca kwoty tylko z obszarem „kwoty”, a klienta tylko z obszarem „klient”.
- **Pliki**: foldery mają `visibility` (`operational` / `formal`). Formalne: oferty, umowy, faktury, kalkulacje, rozliczenia i ich podfoldery (także po nazwie folderu). Pliki dokumentacji (`document_type` oferta, umowa, faktura, kalkulacja) i zawartość folderów formalnych widzi obszar „oferta, umowa i formalności”; pliki operacyjne (agenda, karta weselna, checklisty sprzętu, zdjęcia, prezentacje) — cała ekipa wydarzenia.
- **Historia zmian** (`event_audit_log`, m.in. zmiany budżetu): tylko obszar „oferta, umowa i formalności”.
- **Kroki realizacji**: etapy „Formalności” i „Rozliczenie” wraca baza tylko obszarowi handlowemu; powiadomienia o nich nie trafiają do kierownika realizacji.

## Zakładki

Jeden pasek zakładek (bez grup), w kolejności: Przegląd, Szczegóły · Sprzęt, Logistyka, Zespół, Harmonogram, Agenda, Podwykonawcy, Pliki, Zadania, Mavinci LIVE · Oferta, Kalkulacje, Umowa, Ustalenia, Finanse, Podsumowanie, Historia. Zakładka jest widoczna, gdy osoba ma jej obszar (Podsumowanie — obszar „kwoty”, zob. `docs/event-commissions.md`); lista zakładek w ustawieniach pracownika dalej może zawęzić widok (Przegląd i Szczegóły zawsze zostają).

## Znane ograniczenie

Zasobnik plików `event-files` jest publiczny: kto zna adres pliku, otworzy go bez logowania. Baza ukrywa listę plików i foldery dokumentacji, ale pełne zabezpieczenie wymaga przejścia na prywatny zasobnik i podpisane linki (osobna zmiana).
