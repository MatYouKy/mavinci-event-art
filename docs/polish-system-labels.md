# Polskie etykiety w interfejsie

Wspólny słownik: `src/lib/ui/systemLabels.ts`. Badge: `src/components/UI/SystemBadge.tsx`.
Słownik jest przeznaczony do wyświetlania, nie do zmiany wartości zapisanych w bazie.

- `systemLabel(value, domain)` tłumaczy kod w odpowiedniej dziedzinie; brak tłumaczenia pokazuje polską etykietę zastępczą, nie roboczy kod.
- `preserveCustom` jest przeznaczone wyłącznie dla pól dopuszczających własne nazwy/opisy. Nie stosować do kontrolowanych statusów.
- `formatSystemSubject` rozpoznaje wygenerowane tematy formularzy, również historyczne. Zwykłe tematy i treść wiadomości pozostają bez zmian.
- `InquiryTypeBadges` pokazuje kategorię i typ wydarzenia. `event_inquiry - team` oznacza „Zapytanie o wydarzenie — Integracja zespołu”.
- Nowe formularze zapisują polski temat; kategoria i typ wybrany w formularzu nadal używają dotychczasowych kodów technicznych.
- Nieznane typy zewnętrznych webhooków wymagają dodania etykiety do słownika. Oryginalne kody pozostają w konfiguracji i szczegółach technicznych integracji.

Zmiana nie wymaga migracji bazy ani publikacji funkcji Edge. Wymaga publikacji aplikacji.
Nie uruchamiano kompilacji, testów ani walidacji zgodnie z polityką repozytorium.
