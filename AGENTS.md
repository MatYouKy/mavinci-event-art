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
