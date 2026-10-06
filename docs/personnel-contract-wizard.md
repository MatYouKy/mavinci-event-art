# Kreator umów personelu

Sześć kroków w rejestrze `/crm/employees/contracts` oraz przy umowach w fakturach: strony, praca i okres, sytuacja osoby, podatki i oświadczenia, wynagrodzenie, podsumowanie. Nie zaznaczamy domyślnie odpowiedzi na pytania o sytuację osoby. Dalej wymaga odpowiedzi na widoczne pytania i poprawnych danych danego kroku. Odpowiedź „Nie wiem” pozwala przejść do podsumowania i zapisać szkic; blokuje kalkulację dla osoby, aktywację i nowy dokument.

Odpowiedzi są zapisywane w `payroll_profile.questionnaire`, wersja 1. Obecne pola profilu i parametry PIT/ZUS są wyprowadzane z odpowiedzi. Zmiana danych w formularzu cofa potwierdzenie podsumowania. Kontrola aktualności i pochodzenia oświadczenia dotyczy wskazanego miesiąca pracy, nie automatycznie całej rocznej umowy. Zmiana osoby resetuje odpowiedzi. Stare umowy wymagają uzupełnienia kreatora przed nowym dokumentem i rozliczeniem; dotychczasowe dokumenty i zatwierdzone miesiące pozostają dostępne. Notatki i zamykanie istniejących umów nie przepisują historii w bazie.

Automatyczne warianty dla standardowych danych polskiej osoby fizycznej w PLN w 2026 r.: zlecenie ze składkami społecznymi i zdrowotną, zlecenie ze zdrowotną przy jednym potwierdzonym etacie zapewniającym minimum, uczeń/student poniżej 26 lat z potwierdzonym okresem statusu, standardowe dzieło, plan netto standardowego etatu. KRUS nie zwalnia ze składek zlecenia; kreator wymaga potwierdzenia zgłoszenia i ustaleń z KRUS. PIT-2 ma kontrolę sumy 300 zł. Limit ulgi dla młodych wymaga osobnej kwoty z oświadczenia uwzględniającego wszystkich płatników. Dla zlecenia wymagamy także planowanych godzin do porównania z minimum, niezależnie od sposobu naliczania wynagrodzenia.

Kreator wykrywa m.in. własnego pracodawcę / pracę na jego rzecz, inne zlecenia, kilka etatów, działalność, emeryturę/rentę, A1 i zagranicę, małoletność, zmiany statusu, przerwy w etacie, PPK, inne ulgi, prawa autorskie/50% KUP, potrącenia, limit roczny składek, nietypowy miesiąc etatu i kilka wypłat w miesiącu. Te przypadki wymagają indywidualnych danych i rozliczenia; system nie oferuje przycisku omijającego brak danych. Użytkownik pobiera lokalny plik tekstowy z odpowiedziami i konkretną listą ustaleń. Nic nie jest automatycznie wysyłane.

Dane firmy o wypadkowym, FP/FS i FGŚP wymagają wskazania źródła. Automatyczne FP/FS jest dostępne wyłącznie dla pełnego miesiąca i braku innych podstaw; inne okresy wymagają potwierdzenia zasad. Efekt CIT nadal jest warunkową symulacją, bez potwierdzania 9% po samym NIP.

Migracja `20260921210000_personnel_contract_wizard` wyprowadza parametry również po stronie bazy i sprawdza odpowiedzi przed aktywacją, utrwaleniem dokumentu i zatwierdzeniem miesiąca. Rozliczenie wymaga zgodnego okresu pracy, daty wypłaty oraz zwolnień; kopia kwestionariusza i reguł trafia do istniejącego snapshotu rozliczenia. Dotychczasowe kontrole limitu ulgi, godzin i minimum pozostają. Kalkulator służy do planowania; zatwierdzone kwoty nadal pochodzą z rachunku/listy płac. To nie deklaracja obsługi wszystkich wyjątków polskiego prawa i nie generator zgłoszeń ZUS/PIT.

Źródła reguł (sprawdzone 21.09.2026):

- [ZUS — zbieg tytułów](https://www.zus.pl/pracujacy/system-ubezpieczen-spolecznych-w-polsce/zbieg-tytulow-do-ubezpieczen-spolecznych)
- [ZUS — uczeń i student](https://www.zus.pl/-/studencki-portfel-w-wakacje.-kiedy-praca-sezonowa-zasili-twoje-konto-w-zus-a-kiedy-do-twojego-portfela-trafi-%E2%80%9Eca%C5%82a-pensja-)
- [KRUS — zlecenia](https://www.gov.pl/web/krus/ubezpieczenie-spoleczne-rolnikow-dla-osob-wykonujacych-umowy)
- [MF — PIT-2](https://www.podatki.gov.pl/poradniki-i-informatory/pit-2-pit-2a-pit-3-zasady-skladania-oswiadczen-o-stosowaniu-pomniejszenia-zaliczki-o-kwote-zmniejszajaca-podatek-112-124-lub-136)
- [ZUS — Fundusz Pracy](https://www.zus.pl/en/pracujacy/fundusze-pozaubezpieczeniowe/fp)
- [MRPiPS — minimum 2026](https://www.gov.pl/web/rodzina/minimalne-wynagrodzenie-za-prace)

Zgodnie z `.build-policy.md` nie uruchamiano builda, TypeScriptu, lintowania ani testów.
