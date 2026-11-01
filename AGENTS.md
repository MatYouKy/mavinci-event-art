# Zasady projektu Mavinci

## Polskie etykiety wartości systemowych

- Nie wyświetlaj kodów z bazy/API jako treści badge, statusów, ról ani kategorii.
- Używaj słownika `src/lib/ui/systemLabels.ts` i komponentu `SystemBadge`; istniejące słowniki domenowe z poprawnymi polskimi etykietami mogą pozostać.
- Nowy kod systemowy musi otrzymać polską etykietę. Nie zastępuj tłumaczenia usunięciem podkreśleń ani wyświetleniem surowego kodu jako wartości awaryjnej.
- Tłumaczenia są warstwą prezentacji: nie zmieniaj wartości enum w bazie, kluczy API, filtrów ani uprawnień. Zachowuj własne nazwy i opisy użytkowników. Kody integracyjne pozostają dostępne w technicznych formularzach konfiguracji.

## Typografia marki

- Czcionka Atom zawsze musi być stosowana z tekstem UPPERCASE (wielkie litery).
- Reguła dotyczy interfejsu, podglądów, ofert PDF i wszystkich nowych materiałów marki.
- W CSS stosuj `text-transform: uppercase`. W PDF konwertuj tekst przez `toLocaleUpperCase('pl-PL')` przed pomiarem szerokości i łamaniem wierszy.
- Zmieniaj sposób wyświetlania, nie treść nazw zapisaną w bazie. Pozostałe czcionki nie wymagają uppercase.

## Obramowania w interfejsie

- Nie stosuj ciężkich, jasnych ani mocno kontrastowych borderów wokół kart, formularzy, sekcji, przycisków i elementów klikalnych.
- Elementy oddzielaj przede wszystkim kolorem tła, odstępami, typografią i delikatnym cieniem.
- Jeżeli obramowanie jest potrzebne dla czytelności, używaj wyłącznie bardzo subtelnej linii o niskiej przezroczystości, spójnej z tłem i kolorystyką marki.
- Stany `hover`, `focus`, zaznaczenia i aktywności pokazuj zmianą tła, koloru lub dyskretną poświatą zamiast grubego obramowania.
- Zasada obowiązuje w całym CRM, portalu sprzedawcy, stronie WWW, modalach, drawerach, ustawieniach i wszystkich nowych komponentach.
- Inputy, selecty, textarea i datepickery mają najwyżej jedną delikatną linię 1 px, bez podwójnej ramki i grubych złotych ringów. Nie ustawiaj globalnie `outline-color`: ujawnia przezroczyste obrysy `outline-none` także poza fokusem.
- Kalendarze korzystają z kolorów aktualnego motywu, nie z osobnej granatowej palety. Dni nie mają osobnych ramek; zaznaczenie pokazuj tłem, a fokus klawiatury subtelnym, widocznym wyróżnieniem.
- Pola dat muszą umożliwiać zarówno wybór z kalendarza, jak i ręczne wpisanie daty w formacie `DD.MM.RRRR`, z walidacją rzeczywistej daty przed zapisem.

## Aplikacja mobilna nadąża za CRM

- Zmiana modułu CRM, który ma odpowiednik w aplikacji mobilnej (`mobile/`), obejmuje aplikację w tym samym commicie lub PR: te same reguły biznesowe, uprawnienia, filtry, etykiety i powiadomienia. Mapa modułów: `docs/mobile-parity.md`.
- Logikę używaną w obu miejscach trzymaj w identycznych kopiach wymienionych w `scripts/ci/check-shared-copies.mjs` (Metro nie importuje plików spoza `mobile/`). CI zatrzymuje się przy rozbieżności.
- Aplikacja mobilna nie może zostawać w tyle za ustawieniami projektu. Każde ustawienie pracownika i firmy — uprawnienia do modułów, zasięg danych (np. „tylko przypisane” / „wszystkie”, firmy, oddziały), widoczność finansów i danych osobowych, godziny pracy i reguły ewidencji — działa w aplikacji tak samo jak w CRM. Nowe lub zmienione ustawienie = ta sama reguła w bazie i obsługa w `mobile/` w tej samej zmianie; jeśli ekran w aplikacji nie obsługuje ustawienia, ma go ukryć, a nie pokazać więcej danych.
- Reguły dostępu wymuszaj w bazie (RLS, funkcje), nie tylko w interfejsie — aplikacja mobilna czyta bazę bezpośrednio, więc filtr dodany tylko w CRM jej nie obejmuje.
- Moduły dostępne tylko w CRM (oferty, faktury, finanse, ustawienia administracyjne) aplikacja otwiera w przeglądarce (`openInCrmWeb`). Nowy link w powiadomieniu musi mieć obsługę w `mobile/src/navigation/navigationRef.ts` (`routeNotification`, `routeSalesUrl`).
- Jeśli zmiana świadomie nie dotyczy aplikacji, wpisz w opisie PR „Mobile: nie dotyczy — powód”. Bez tego kontrola parytetu w CI zatrzymuje PR.
- Zmiany w aplikacji wymagają nowej wersji: podnieś `version` w `mobile/app.json` i `mobile/package.json`, a następnie `cd mobile && yarn deploy`.
