# Zespół, umowy i rozliczenia

Zmiana dodaje „Zespół → Pracownicy CRM / Współpracownicy / Umowy”.
Adresy istniejących pracowników, podwykonawców i Finansów pozostają aktualne.

## Uruchomienie

21.09.2026 wdrożono do połączonej bazy Supabase migracje:
- `20260920193100_contract_term_periods.sql` (wymagana zależność),
- `20260921120000_personnel_workspace.sql` (moduł Zespół).

Potwierdzono dostępność nowych tabel, widoków i kolumn przez API bazy.
Kartoteka została uzupełniona o 12 istniejących pracowników; dostępny jest podstawowy szablon umowy zlecenia.
Migracja zakłada zastosowanie wcześniejszych migracji projektu, w szczególności rejestru
umów, wypłat, warunków wynagrodzenia oraz zakresów umów z 20 września.
Nie wykonuj bez sprawdzenia wszystkich pozostałych lokalnych migracji poleceniem db push:
repozytorium zawiera także inne, niezwiązane zmiany.

Migracje zastosowano po zalogowaniu CLI. Wdrożenie objęło wyłącznie dwa wymienione pliki;
pozostałych oczekujących migracji nie wykonywano. Generator używa aktualnych pól
adresowych firmy (ulica, numer budynku, numer lokalu). Aplikacji nie publikowano na produkcji.
Zgodnie z `.build-policy.md` nie uruchamiano buildu, TypeScript, lintu ani testów.

## Przepływ do przeglądu

1. Dodaj współpracownika (konto CRM nie jest wymagane).
2. W profilu otwórz „Umowy i rozliczenia” i dodaj umowę zlecenie.
3. Wybierz działalność, daty, dane osoby, reprezentację, zakres i warunki płatności.
4. Zapisz umowę — numer nada system. Dodaj stawkę godzinową, miesięczną, za całe zlecenie lub akordową.
5. Wybierz szablon i utrwal wersję dokumentu. Otwórz podgląd i pobierz PDF.
6. Po zawarciu umowy ustaw status „Aktywna”.
7. Dla pracownika CRM uruchom timer. Przy jednej pasującej umowie wybierze ją baza;
   przy kilku wskaż umowę w formularzu timera. Wcześniejsze wpisy przypisz w panelu wynagrodzenia.
   Dla współpracownika koordynator dodaje godziny w szczegółach umowy.
8. Wskaż miesiąc i sprawdź godziny. Podaj brutto, PIT, składki i pozostałe obciążenia ze wskazanego rozliczenia księgowego.
   Netto i koszt firmy wynikają z tych kwot. Stałą kwotę miesięczną/ryczałt potwierdza operator, również przy niepełnym okresie.
9. Zatwierdź rozliczenie. Zatwierdzenie blokuje objęte nim wpisy i nie tworzy płatności.
10. Dodaj wypłatę lub przypisz istniejącą wypłatę do rozliczenia miesiąca.
    Przypisanie nie tworzy drugiej pozycji ani drugiego kosztu.
11. Porównaj profil, Czas pracy, Finanse i rentowność wydarzenia.

## Zasady danych

- `personnel_people` jest kartoteką osób. `employee_id` jest opcjonalnym powiązaniem konta.
  Kartoteka istniejących pracowników jest uzupełniana migracją i synchronizowana przy zmianach.
- Powiązanie współpracownika z istniejącym kontem CRM przenosi relacje umów poprzedniej
  kartoteki i zachowuje jej archiwalny rekord. Nie tworzy konta Supabase Auth.
- Umowy nadal korzystają z `personnel_contracts` i `personnel_contract_payments`.
- Dane historycznych umów nie otrzymują domyślnej daty zawarcia, stawki ani rozliczenia.
- Szablony i utrwalone wersje dokumentów są oddzielone od umów z klientami.
- Stawki mają zakresy dat. Wpis pracy zachowuje warunki obowiązujące w dniu pracy.
  `is_billable` pozostaje oznaczeniem rozliczenia z klientem i nie decyduje o wynagrodzeniu.
- Utrwalony dokument zachowuje własną kopię danych i treści. Zmiana warunków wymaga
  nowej umowy lub dokumentu aneksu w rejestrze. Niewykorzystaną stawkę można usunąć.
- Naliczenie brutto/netto nie zastępuje rozliczenia płacowego. System nie zgaduje
  składek i podatków; kwotę netto i pełny koszt zatwierdza uprawniona osoba.
- Umowa miesięczna może być rozliczona raz na miesiąc, a ryczałt za całe zlecenie raz.
- Wpis obejmujący dwa miesiące lub zmianę stawki wymaga podziału na osobne wpisy.
- Rentowność wydarzenia korzysta z oszacowanego kosztu godzin, a po zatwierdzeniu
  z pełnego kosztu rozliczenia podzielonego według czasu na wydarzenia i pracę ogólną.
- Umowę podwykonawcy można powiązać z konkretnym zleceniem. Gdy dostępny jest koszt
  pracy z umowy, zastępuje koszt tego zlecenia w rentowności, zapobiegając dublowaniu.
- Koszty w walucie obcej pozostają w tej walucie; nie są dodawane do wyniku PLN bez kursu.
- `personnel_view` / `personnel_manage` sterują dostępem kadrowym. Pracownik ma
  podgląd własnych umów i rozliczeń. Zwykły podgląd listy pracowników nie otwiera płac.
  Dotychczasowi zarządzający pracownikami/podwykonawcami otrzymują `personnel_manage`.

## Zakres obecnej wersji

Nie dodano wysyłania umów, podpisu elektronicznego, automatycznych przelewów ani silnika
naliczania ZUS/PIT. Dokument PDF jest generowany z utrwalonej wersji po stronie przeglądarki.
Nowe koszty personelu są włączone do widoku rentowności wydarzenia; historyczne
zatwierdzone prowizje i rozliczenia opiekunów sprzedaży nie są automatycznie przeliczane.

## Numeracja, akord i dane prawne — 21.09.2026

Migracja `20260921160000_personnel_contract_rules.sql` została wdrożona do połączonej bazy Supabase 21.09.2026. Wdrożenie objęło wyłącznie tę nową migrację. Kod aplikacji zapisano lokalnie; aplikacji nie publikowano na produkcji. Nie uruchamiano buildu, TypeScript, lintu ani testów zgodnie z polityką repozytorium.

Zmiana dodaje:

- Numer nadawany transakcyjnie: `UZ/2026/0001`, `UOP/2026/0001`, `UOD/2026/0001`.
  Oddzielne liczniki działalności / rodzaju / roku zawarcia; numery historyczne zachowane.
  Numer i seria istniejącej umowy są chronione. Równoczesne zapisy nie dostają tego samego numeru.
- Wyszukiwanie podwykonawcy i wydarzenia w formularzu umowy.
- Jedną realizację albo współpracę okresową, np. rok, z osobnymi rozliczeniami miesięcy.
  Jedna realizacja nie tworzy automatycznie dzieła: rodzaj umowy wybiera się według charakteru pracy.
- Ustne ustalenia („dżentelmeńskie”) jako forma cywilnoprawnej umowy, bez nowego rodzaju podatkowego.
  Operator potwierdza dopuszczalność formy ustnej; etat wymaga formy pisemnej.
- Przelew / gotówkę. Gotówka wymaga wskazania pokwitowania i nie łączy się z transakcją bankową.
  Przy etacie zapisujemy także potwierdzenie wniosku o wypłatę do rąk własnych.
- Akord: nazwa jednostki, ilość × stawka. Przy godzinach już zapisanych w CRM koordynator może
  dopisać samą ilość z zerowym czasem. Minimum zlecenia nadal wymaga ewidencji godzin.
- Potwierdzane dane do PIT/ZUS oraz ich kopię w każdym rozliczeniu; zmiana statusu osoby nie
  zmienia historii. Rozliczenie wymaga źródła, daty przychodu, brutto i rozbicia obciążeń.
- Kontrolę minimum zlecenia za zarejestrowany czas oraz konieczność wyrównania brutto.
  Zapisane stawki: 2025, 2026, 2027. Inny rok wymaga uzupełnienia tabeli przepisów.
- Kontrolę deklarowanego zwolnienia studenta z ZUS (daty statusu, wiek, własny pracodawca)
  oraz deklarowanej ulgi PIT (rodzaj umowy, wiek w dniu przychodu, sposób opodatkowania,
  rezygnacja i limit). Roczny limit sumuje ulgę tej osoby w CRM i zadeklarowane wykorzystanie
  poza systemem. Poprawność danych spoza CRM potwierdza osoba zatwierdzająca rozliczenie.

### Granice automatyzacji

To rejestr umów i zatwierdzanych rozliczeń, nie kompletny silnik kadrowo-płacowy.
Nie oblicza sam PIT/ZUS ani nie ocenia wszystkich przesłanek zawarcia danego rodzaju umowy.
Etat (absencje, etat, dodatki), zbiegi ubezpieczeń, nierezydenci, PIT-2, KUP, PPK,
zmiany statusu w miesiącu i szczególne zwolnienia wymagają rozliczenia indywidualnego.
Przy częściowym zwolnieniu studenta nie oznacza się pełnego zwolnienia za cały okres;
kwoty i podział trzeba podać ze źródła księgowego. Dzieło nie otrzymuje ulgi dla młodych.
Zlecenia walutowe i wyjątki od minimum godzinowego nie są automatycznie rozliczane.
Opcja wypłaty po realizacji jest dostępna dla pracy w jednym miesiącu; przełom miesięcy
obsługujemy rozliczeniami miesięcznymi. Kwota stała za całe zlecenie jest rozliczana raz.
Źródłowe godziny muszą być kompletne — system nie wykryje czasu, którego nikt nie zarejestrował.
Zmiana rzeczywistej daty wypłaty wymaga ponownej oceny podatku przez księgowość.

### Źródła reguł

- [MF — ulga dla młodych](https://www.podatki.gov.pl/ulgi-i-odliczenia/ulga-dla-mlodych-pit).
- [KAS — wiek i data uzyskania przychodu](https://www.podatki.gov.pl/aktualnosci/kas-przypomina-zasady-rocznego-rozliczenia-pit-osob-do-26-roku-zycia).
- [ZUS — status studenta i wyjątek własnego pracodawcy](https://www.zus.pl/-/studencki-portfel-w-wakacje.-kiedy-praca-sezonowa-zasili-twoje-konto-w-zus-a-kiedy-do-twojego-portfela-trafi-%E2%80%9Eca%C5%82a-pensja-).
- [MRPiPS — minimum godzinowe i częstotliwość wypłat](https://www.gov.pl/web/rodzina/minimalna-stawka-godzinowa).
- Rozporządzenia stawek: [2025](https://eli.gov.pl/eli/DU/2024/1362/ogl/pol), [2026](https://eli.gov.pl/eli/DU/2025/1242/ogl/pol), [2027](https://eli.gov.pl/eli/DU/2026/1213/ogl/pol).
- [PIP — formy zatrudnienia](https://www.pip.gov.pl/dla-pracownikow/niezbednik-pracownika/formy-zatrudnienia-oraz-podstawowe-prawa-i-obowiazki).

- [PIP — wypłata gotówkowa na wniosek pracownika](https://www.pip.gov.pl/dla-pracodawcow/porady-prawne/wynagrodzenie-za-prace).
