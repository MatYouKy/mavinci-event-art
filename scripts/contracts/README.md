# Wspólny układ umów

Generator wszystkich kategorii korzysta z tego samego układu 11 paragrafów. Wdrożenie z 7 września 2026 r. tworzy kopię `UNIWERSALNA — wspólny układ wydarzeń`, przypisuje ją do 16 istniejących kategorii i porządkuje klauzule 67 produktów. Oryginalne szablony i wybór szablonu w wydarzeniu Werfen pozostają bez zmian. Nowa kategoria bez przypisanego szablonu korzysta z aktywnego szablonu oznaczonego `page_settings.contractStructureDefault`.

## Dodawanie i zmiana klauzul

W edytorze produktu wybierz własną treść albo wspólną zasadę. Biblioteka wspólnych zasad znajduje się w `src/lib/CRM/contracts/sharedContractClauses.json`. Wpis produktu z `sharedKey` odwołuje się do tej biblioteki. Własna treść służy do szczegółów konkretnej usługi: czasu, liczby urządzeń, parametrów zasilania, formatów plików i ograniczeń zakresu.

Termin materiałów ma jedno źródło: `{{termin_dostarczenia_materialow}}`. Domyślna wartość w nowym szablonie to „najpóźniej 3 dni kalendarzowe przed datą rozpoczęcia wydarzenia”. Można ją edytować w zmiennych umowy. Klauzula dopuszcza inny termin potwierdzony przez obie strony mailowo.

`contractClauseAssembly.ts` usuwa identyczne punkty na podstawie pełnej treści, łączy przypisane do nich nazwy produktów i umieszcza wspólne zasady tylko raz. Atrybut `data-contract-shared-clause` wiąże punkt szablonu z biblioteką. Różne wersje tej samej wspólnej zasady wymagają wyboru użytkownika. Różne własne postanowienia o podobnym temacie są zachowywane. `legacySharedClauseAliases.json` rozpoznaje wyłącznie kompletne, wskazane brzmienia historyczne w wymaganiach ofert.

Identyfikatory `legacyId` zachowują działanie wcześniejszych wyłączeń oraz indywidualnych zmian klauzul wydarzenia. Umowy wystawione, zablokowane i edytowane indywidualnie są odczytywane z zapisanego dokumentu. Zmiana źródeł nie zastępuje automatycznie ich treści.

## Zapis danych

`node scripts/contracts/rollout.cjs` wypisuje zakres bez zapisywania danych. `--apply` stosuje przygotowany zestaw, a `--rollback` przywraca zapisane wcześniej klauzule i przypisania kategorii. Skrypt używa lokalnego `.env`, nie zawiera kluczy. Przed zapisem porównuje dane ze stanem źródłowym; zapis warunkowy na `updated_at` chroni równoległe edycje.

Dziennik zapisów domyślnie trafia do `/tmp/mavinci-contract-layout-2026-09-07.json`; inną lokalizację wskazuje `CONTRACT_ROLLOUT_JOURNAL`. Pliki w `shared-layout-2026-09-07` zawierają treści przed i po zmianie. Skrypt nie wysyła dokumentów, nie zmienia podpisów ani zawartości istniejących umów.

Zgodnie z `.build-policy.md` nie uruchamiano builda, TypeScript, lintu ani testów.
