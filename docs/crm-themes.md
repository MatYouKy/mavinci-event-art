# Motywy CRM

Każdy pracownik wybiera motyw w **Ustawienia → Ogólne → Wygląd** (`components/crm/settings/CrmThemePicker`):

| Motyw | Wygląd |
| --- | --- |
| Burgund (domyślny) | kolory marki Mavinci |
| Granat | klasyczny ciemnogranatowy |
| Ciemny | szary, jak tryb ciemny macOS |
| Jasny | jak tryb jasny macOS (białe karty, jasnoszare tło, grafitowy tekst) |

Wybór zapisuje się w `employees.crm_theme` (migracja `20261110130000_employee_crm_theme.sql`), więc obowiązuje na każdym komputerze. Serwer od razu renderuje `<html data-crm-theme="…">`, więc strona nie miga przy wczytaniu.

## Jak to działa

- Komponenty mają kolory wpisane w klasach Tailwind (historyczne granatowe i nowsze burgundowe wartości). `src/index.css` mapuje je na zmienne `--brand-burgundy-*` i `--crm-*` (tło, karty, najechanie, okna, zakładki, pasek przewijania, stany wydarzeń).
- `src/styles/crm-themes.css` podmienia tylko te zmienne dla granatu, ciemnego i jasnego oraz mapuje klasy z burgundem wpisanym na stałe na poziomy tła bieżącego motywu.
- **Jasny** powstaje przez odwrócenie ciemnej palety filtrem (`invert(1) hue-rotate(180deg)` na `<html>`, tylko na ekranie, nie w druku). Złoto staje się ciemnym brązowozłotym, kolory statusów zostają czytelne. Zdjęcia, filmy, mapy, podglądy PDF (iframe), tła z `url(…)` i elementy z białym tłem (`bg-white`, dokumenty A4, `data-theme-preserve`) są odwracane z powrotem, więc wyglądają jak w oryginale.
- Nowy element, który ma zawsze wyglądać „jak na papierze” (np. podgląd dokumentu), oznacz atrybutem `data-theme-preserve`.

Mobile: nie dotyczy — aplikacja ma własną kolorystykę; motyw z CRM można przenieść później.
