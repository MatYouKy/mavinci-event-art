# Plan netto i informacyjny koszt wynagrodzenia

Stan zasad: 21.09.2026. Kalkulator obejmuje wypłaty w 2026 r. i klasyczny CIT.

`planned_net_amount` przechowuje plan netto w jednostce wskazanej przez `net_cost_settings.basis`. Dane nie zastępują `gross_value`, stawek obowiązujących w umowie ani zatwierdzonych rozliczeń. Zmiana planu nie zmienia utrwalonej treści dokumentu. Użytkownik może przenieść plan do formularza stawki, a następnie ją zapisać. Przy godzinach i akordzie koszt jednostkowy jest średnim szacunkiem dla podanej miesięcznej liczby jednostek.

Obliczenie netto → brutto rozdziela składki osoby, zdrowotną, PIT i składki płatnika. Każda składka jest zaokrąglana do groszy, podstawa skali i zaliczka PIT do pełnego złotego. Wyszukiwanie brutto uwzględnia lokalne skoki wywołane zaokrągleniami. Limit ulgi dla młodych jest podawany przez użytkownika; nie zakładamy, że cała roczna kwota jest dostępna. Daty pracy ustalają zwolnienie ucznia/studenta z ZUS, a data wypłaty ustala uprawnienie do ulgi PIT. Dzieło nie korzysta z ulgi dla młodych. KRUS nie jest automatycznym zwolnieniem ze składek zlecenia.

Model zakłada jedną wypłatę w miesiącu i jedną stawkę PIT dla całej podstawy, bez PPK, absencji, potrąceń, 50% KUP, przekroczenia rocznego limitu składek emerytalno-rentowych i limitów rocznych KUP. FP/FS w trybie automatycznym używa progu dla pełnego miesiąca; części miesiąca, zbieg tytułów i zwolnienia wymagają ręcznego ustawienia. Wypadkowa 1,67% jest edytowalnym założeniem. Umowy z własnym pracodawcą, zmiana statusu studenta w trakcie okresu i nierezydenci wymagają odrębnego rozliczenia. Zdrowotna uwzględnia standardowe ograniczenie według hipotetycznej zaliczki na zasadach z 2021 r.; jej oświadczenia są założeniem modelu. Symulacje nie tworzą zobowiązań w PIT/ZUS ani nie zatwierdzają listy płac.

CIT 9% to niepotwierdzone założenie użytkownika dla Mavinci, z możliwością wyboru 19%. NIP 7394011583 identyfikuje spółkę, ale nie potwierdza jej prawa do CIT 9%. Potencjalny efekt CIT wymaga kosztu podatkowego i odpowiedniego dochodu; nie zmniejsza kwoty wypłaty. Nie aktualizujemy globalnych ustawień kosztów pracy na podstawie tego założenia.

Dywidenda: netto / ((1 − CIT) × (1 − 19%)), dla polskiej osoby fizycznej w klasycznym CIT. Wynik to potrzebny zysk przed CIT, nie koszt wynagrodzenia. Przekazanie gotówki pracownikowi podlega PIT/ZUS według umowy niezależnie od źródła finansowania. Nie modelujemy estońskiego CIT.

## Źródła

- [ZUS — umowy cywilnoprawne](https://www.zus.pl/en/-/umowy-cywilnoprawne-w-ubezpieczeniach-spolecznych)
- [ZUS — zmiany w składce zdrowotnej](https://www.zus.pl/o-zus/o-nas/programy-transformacji-cyfrowej-zus/zmiany-od-2022-r./zmiany-w-skladce-zdrowotnej)
- [ZUS — FGŚP](https://www.zus.pl/pracujacy/fundusze-pozaubezpieczeniowe/fgsp)
- [MF — ulga dla młodych](https://www.podatki.gov.pl/ulgi-i-odliczenia/ulga-dla-mlodych-pit)
- [MF — dochody z pracy i koszty uzyskania](https://www.podatki.gov.pl/podatki-osobiste/pit/informacje-podstawowe/co-jest-opodatkowane/dochody-z-pracy)
- [MF — dochody ze zlecenia i dzieła](https://podatki.gov.pl/podatki-osobiste/pit/informacje-podstawowe/co-jest-opodatkowane/dochody-z-umowy-zlecenia-lub-o-dzielo)
- [MF — stawki PIT i dywidendy](https://www.podatki.gov.pl/podatki-osobiste/pit/stawki-i-limity)
- [MF — klasyczny CIT](https://www.podatki.gov.pl/podatki-firmowe/cit/cit-klasyczny/stawki-i-limity)

## Porównanie wariantów

Ikona „i” pokazuje również porównanie zlecenia (pełne ZUS z chorobowym i bez, tylko zdrowotna, osoba młoda, student), etatu, dzieła i ustnego zlecenia płatnego gotówką. Warianty mają osobne hipotetyczne profile, niezależne od danych osoby w formularzu. Daty urodzenia w tych profilach są wyłącznie techniczną reprezentacją scenariusza i nigdy nie są zapisywane do danych osoby. Warianty ulgi dla młodych zakładają pełny pozostały limit 85 528 zł. Porównanie uwzględnia kwotę i jednostkę, ustawienia PIT-2, PIT, KUP, składek płatnika oraz CIT. Przy braku daty korzysta z przykładowej wypłaty w 2026 r.; podany inny rok pozostaje nieobsługiwany.

Zablokowana kalkulacja konkretnej osoby nie ukrywa porównania. Pole własnego pracodawcy dotyczy istniejącego stosunku pracy i nie jest automatycznie zmieniane. Wybranie lub oglądanie scenariusza nie zmienia danych osoby ani stawek umowy.
