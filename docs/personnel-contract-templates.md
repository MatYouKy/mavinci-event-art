# Szablony i podgląd PDF umów

Wersja bazowa: 21.09.2026. Trzy nowe szablony są zasiane migracją `20260921190000_personnel_document_templates.sql`. Niezmieniony pierwotny wzór zlecenia zostaje zarchiwizowany; szablony edytowane przez użytkownika i historyczne dokumenty pozostają zachowane.

Zakładka Szablony otwiera rzeczywisty PDF z widocznymi placeholderami. Ten sam moduł `contractPdf.js` obsługuje podgląd, pobranie wzoru i PDF utrwalonej umowy. Wzory mają oznaczenie SZABLON; dokument po podstawieniu danych go nie ma. Tekst użytkownika jest wstawiany wyłącznie jako tekst, bez interpretowania HTML. Zmiana długości danych może zmienić liczbę stron. Edycja szablonu odświeża podgląd po krótkiej przerwie w pisaniu. Pobranie korzysta z dokładnie tego samego pliku Blob co podgląd.

`document_details` zawiera miejsce pracy lub przekazania dzieła; dla etatu stanowisko, wymiar, próg ponadwymiarowy, składniki płacy i podstawę umowy terminowej; dla dzieła kryteria, odbiór i materiały; dla zlecenia własny sposób ewidencji godzin. Te warunki są chronione istniejącym mechanizmem utrwalania treści umowy. Symulacyjny plan netto nie zastępuje zapisanej stawki w dokumencie.

Generator sprawdza dane stron i działalności, adresy, rachunek przy przelewie, daty, kompletność warunków rodzaju umowy, pokrycie okresu stawkami, wymagane i znane placeholdery. Umowa o pracę wymaga stawki brutto. Dzieło w tym wzorze ma jeden rezultat, ustaloną kwotę za całość i termin. W przypadku rat miesięcznych wypłaty przed oddaniem dzieła są zaliczkami rozliczanymi przy jego oddaniu. Ustne ustalenia skutkują nagłówkiem potwierdzenia ustaleń, z zachowaniem prawnej podstawy umowy i rozliczeń. Wybrane PIT/ZUS wpływają na klauzulę; żadne zwolnienie nie jest bezwarunkowo obiecywane na cały okres.

To wzory bazowe, nie automatyczna ocena prawna faktycznego zatrudnienia. System nie weryfikuje pełnej historii umów terminowych poza CRM, legalizacji pracy cudzoziemców, obowiązków zakładowych ani szczególnych branżowych warunków pracy. Wzór etatu nie obejmuje okresu próbnego i nie zastępuje osobnej informacji z art. 29 § 3 Kodeksu pracy. Wzór dzieła nie przenosi automatycznie praw autorskich. Prawa, pola eksploatacji i forma wymagają osobnego ustalenia. Dodatkowe postanowienia i dowolne edycje szablonu wymagają oceny zgodności z konkretną sytuacją.

Źródła:

- [PIP — umowa o pracę, wymagane warunki i obowiązki](https://www.pip.gov.pl/dla-pracodawcow/niezbednik-pracodawcy/jak-zatrudnic-pracownika-w-ramach-umowy-o-prace)
- [Kodeks pracy, tekst jednolity z aktualizacjami](https://isap.sejm.gov.pl/isap.nsf/download.xsp/WDU20250000277/U/D20250277Lj.pdf)
- [Kodeks cywilny, tekst jednolity z 2026 r.](https://api.sejm.gov.pl/eli/acts/DU/2026/795/text.pdf)
- [MRPiPS — minimalna stawka godzinowa, ewidencja i umowy ustne](https://www.gov.pl/web/rodzina/minimalna-stawka-godzinowa)
- [ZUS — różnice między zleceniem i dziełem](https://www.zus.pl/en/-/umowy-cywilnoprawne-w-ubezpieczeniach-spolecznych)
- [ZUS — rejestr umów o dzieło i RUD](https://www.zus.pl/documents/10182/24154/Rejestr%2Bum%C3%B3w%2Bo%2Bdzie%C5%82o_final.pdf/8be0afe1-218d-cfdc-eee3-f3227abb8ead)

Układ PDF: cały tekst, także placeholdery i stopka, jest czarny. Numer paragrafu jest wyśrodkowany; jego tytuł znajduje się w kolejnym wyśrodkowanym wierszu. Tekst zasadniczy jest wyjustowany, z ostatnim wierszem akapitu wyrównanym do lewej. Formatowanie nie zmienia treści zapisanych umów.

Podpisy są układane w dwóch kolumnach: Pracownik / Zleceniobiorca / Wykonawca po lewej, Pracodawca / Zleceniodawca / Zamawiający po prawej. Pod każdą etykietą jest wykropkowane miejsce na podpis z odstępem jednej interlinii. Obie kolumny pozostają razem na stronie. Renderer rozpoznaje dotychczasowe pary etykiet, bez zmiany treści utrwalonych dokumentów.


## Wybór sposobu potwierdzania godzin (26.09.2026)

W warunkach umowy zlecenia dostępne są: **System CRM**, **Zadanie**, **Inne**. Ostatnia opcja pokazuje pole opisu. Wybrana metoda jest zapisywana w `document_details.time_evidence_method`, a odpowiadający jej opis w istniejącym `time_evidence`, używanym przez generator PDF i zapis wersji dokumentu. Wcześniejszy własny tekst wyświetla się jako „Inne”, bez automatycznej zmiany zapisanej treści. Umowy bez zapisanej metody zachowują dotychczasowy tekst domyślny, dopóki użytkownik nie wybierze metody. Utrwalonych dokumentów nie zmienia się wstecz.

Po zapisaniu metody „System CRM” powiązany pracownik otrzymuje uprawnienie **Czas pracy → Przeglądanie i raportowanie własnego czasu** (`time_tracking_view_own`). Otwiera ono moduł czasu pracy i pozwala zapisywać własne wpisy, także gdy ID logowania różni się od ID pracownika. Nie nadaje dostępu do cudzych wpisów ani uprawnień administratora. Istniejące szersze uprawnienia pozostają zachowane. Szkic bez konta może czekać na późniejsze powiązanie osoby z pracownikiem; zwykły zapis umowy z metodą CRM wymaga powiązania. Uprawnienie jest dodawane również po późniejszym powiązaniu kartoteki. Zmiana sposobu ewidencji nie odbiera automatycznie wcześniej nadanego dostępu — dostęp można zmienić w uprawnieniach pracownika. „Zadanie” zapisuje metodę, nie tworzy ani nie przypisuje automatycznie zadania.

Wdrożenie: najpierw `20260926183000_personnel_time_evidence_method.sql`, następnie aplikacja. Pracownik z otwartą sesją powinien odświeżyć aplikację, aby pobrać nowe uprawnienia i menu.

Odbiór po wdrożeniu:
- Wybrać każdą z trzech metod, zapisać i otworzyć umowę ponownie; tylko „Inne” pokazuje pole opisu.
- Dla „Inne” bez tekstu zwykły zapis ma wskazać brak; zapis niepełnego szkicu pozostaje możliwy.
- Zapisać CRM dla pracownika bez dostępu do czasu: w jego uprawnieniach pojawia się dostęp do własnego czasu; może utworzyć własny wpis, ale odczyt i zapis cudzego wpisu są odrzucane przez bazę.
- Powiązać szkic CRM z kontem po jego utworzeniu, również dla różnych ID Auth/pracownika; uprawnienie zostaje dodane raz.
- Wygenerować PDF każdej metody i sprawdzić zapisany sposób ewidencji; istniejący dokument i stary własny tekst pozostają niezmienione.

Zmiany przygotowano lokalnie; nie wykonano migracji, wdrożenia ani testów uruchomieniowych zgodnie z `.build-policy.md`.


## Dokładny adres strony umowy (26.09.2026)

Adres strony umowy składa się z typu (ulica, aleja, plac, wieś, osiedle lub bez prefiksu), nazwy, numeru budynku, opcjonalnego lokalu, kodu pocztowego, miejscowości i kraju. Podgląd pokazuje tekst przeznaczony do umowy. Wieś jest formatowana bez prefiksu, np. `Brzeziny 12, 00-001 Brzeziny, Polska`. Ta sama reguła obowiązuje przy edycji adresu podwykonawcy.

Pola są zapisywane w istniejącym `document_details.party_address_parts`, a sformatowany adres w `party_address`, z którego korzysta dokument PDF. Nowa migracja nie jest potrzebna. Nowa umowa i zmiana strony umowy pobierają rozbity adres z kartoteki, jeśli odpowiada on jej zapisanej treści. Wybór innej osoby usuwa poprzednie pola adresu; zapisany adres umowy stanowi osobną kopię danych. Historyczny adres zapisany jedynie jako tekst pozostaje zachowany do czasu wprowadzenia nowych pól; istniejące dokumenty nie są przepisywane. Starsze adresy wsi z prefiksem nadal są rozpoznawane przy odczycie pól z kartoteki.

Odbiór: zapisać i ponownie otworzyć adres ulicy, placu i wsi, z lokalem oraz bez; sprawdzić podgląd i PDF. Wybrać innego pracownika/podwykonawcę i sprawdzić, że poprzedni adres nie pozostał w polach. Niekompletny adres można zapisać jako szkic, ale zwykły zapis wymaga pełnych pól i poprawnego polskiego kodu pocztowego. Starsza umowa zachowuje zapisany adres do czasu jego świadomej zmiany. Kod przygotowano lokalnie, bez uruchamiania testów i wdrożenia.
