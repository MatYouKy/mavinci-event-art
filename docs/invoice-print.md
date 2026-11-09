# Wydruk faktury (podgląd i PDF)

Jeden szablon, jeden renderer, wszystko na serwerze Next — wzorowane na podglądzie wydruku z aplikacji Wodawo (piastpol, `desktop/mac/Sources/Wodawo/Views/DocPdfPreview.swift`): aplikacja pokazuje strony prawdziwego PDF-a z serwera, a nie osobną makietę.

## Przepływ

```
invoices + invoice_items + invoice_order_items (Supabase, dane utrwalone na fakturze)
        │
        ▼
invoiceRowToPdfData()            src/lib/invoices/print/invoicePrintData.ts
        │
        ▼
buildInvoicePdfHtml()            src/components/crm/invoices/helpers/buildInvoicePdfHtml.ts
        │  + „Logo do druku” z brandbooka (plik w pamięci 15 min), kod QR KSeF, osadzony Inter
        ▼
buildInvoicePrintDocument() → renderInvoicePdf()   src/lib/invoices/print/renderInvoicePdf.server.ts
        │  Chromium (Playwright) na serwerze Next, jedna przeglądarka na proces (zamykana po 90 s bezczynności)
        ▼
PDF ──► GET  /bridge/invoices/invoice-pdf/preview?invoiceId=…   podgląd / pobranie (?download=1), bez zapisu
    └─► POST /bridge/invoices/invoice-pdf                       zapis w Storage + dokumenty wydarzenia (folder „Faktury”)
```

- **Podgląd na stronie faktury** (`InvoicePrintPreview`): strony PDF w ramce, podpis w kolorze stanu (KSeF / wizualizacja / pro forma), liczba stron, „Otwórz podgląd”, „Pobierz PDF”, „Drukuj”, odświeżenie. Pamięć podręczna per faktura i rewizja (`updated_at`, `pdf_generated_at`, status płatności, KSeF).
- **Podgląd w uzgadnianiu** (`MonthlyDocumentPreviewModal`): zapisany PDF faktury, a gdy go nie ma — ten sam wydruk z serwera.
- **E-mail z fakturą** (`SendInvoiceEmailModal`): zapisany PDF albo `POST /bridge/invoices/invoice-pdf` — ten sam plik.
- **Dostęp do podglądu**: jak do faktury (RLS na `invoices`). Ciasteczko sesji CRM albo `Authorization: Bearer <token Supabase>` (aplikacje natywne).

## Logo do druku

W brandbooku firmy (`/crm/settings/my-companies/<firma>/brandbook`) przy logo jest pole **„Logo do druku”** — jedno na firmę (`company_brandbook_logos.use_for_print`, RPC `set_company_print_logo`, migracja `20261104180000_brandbook_print_logo.sql`). Używają go faktury, kalkulacje i umowy wydarzeń (`src/lib/brandbook/printLogo.ts`). W umowie wydarzenia zaznaczone „Logo do druku” firmy wydarzenia ma pierwszeństwo przed logo wybranym w szablonie umowy (nagłówek i stopka); bez zaznaczenia — logo z szablonu, jeśli należy do tej firmy, potem primary-black. Umowy wystawione zachowują zapisane logo. Dopóki nic nie jest zaznaczone — logo o nazwie lub wariancie `primary-black` (migracja zaznacza je automatycznie). Wydruk sprzętu wydarzenia nadal używa poziomego `logo-horizontal-black`.

## Wizualizacja a faktura w KSeF

Fakturą jest dokument ustrukturyzowany w KSeF; PDF jest jego wizualizacją.
- **Przyjęta w KSeF**: bez dodatkowego opisu — wystarczy kod QR KSeF z numerem KSeF pod kodem (przy podpisie; bez zapisanego XML sam numer KSeF) i numer KSeF w stopce każdej strony („Faktura VAT FV/… · numer KSeF: …”). Tytuł pliku: „Faktura VAT FV/…”.
- **Przed przyjęciem**: pasek pod datami „Wizualizacja faktury — wymaga wysłania do KSeF” (wysłana, bez numeru: „— wysłana do KSeF, czeka na nadanie numeru KSeF”), stopka „Wizualizacja: … · wymaga wysłania do KSeF” / „· czeka na numer KSeF”, tytuł pliku „Wizualizacja — …”.
- **Pro forma**: „Pro forma — to nie jest faktura VAT…”, oznaczenie „Wizualizacja pro formy” w nagłówku.

## Zawartość wydruku

- Nagłówek: logo, rodzaj dokumentu, numer (pro forma: oznaczenie „Wizualizacja pro formy”).
- Daty: wystawienia, sprzedaży, termin płatności, miejsce wystawienia.
- Sprzedawca (z e-mailem i telefonem z faktury), nabywca, odbiorca (migawka z faktury).
- Pozycje; korekta: przed / po / różnica dla każdej pozycji; korekta danych stron: tabela pól przed i po.
- Zestawienie według stawek VAT (art. 106e ust. 1 pkt 13–14) i „Razem”; dla korekty — różnice według stawek i podsumowanie przed/po.
- Faktura końcowa: rozliczenie zaliczek (wartość, każda zaliczka, pozostało do zapłaty) w podsumowaniu.
- Płatność: sposób, termin, numer konta (grupowany), bank, SWIFT, tytuł przelewu, status; kwota do zapłaty / zapłacono / do zwrotu **słownie**.
- Uwagi (bez wezwania do zapłaty, gdy faktura jest opłacona), podstawa zwolnienia z VAT, podpis wystawiającego, kod QR KSeF z numerem KSeF pod kodem.
- Stopka na każdej stronie: rodzaj i numer dokumentu, numer KSeF (przed przyjęciem: „Wizualizacja” i stan wysyłki), strona WWW, „Strona X z Y”. Nagłówek tabeli powtarza się na kolejnych stronach; podsumowanie, uwagi, kod QR i podpis zawsze trzymają się razem (przechodzą na następną stronę w całości).
- Liczby po polsku: `12 840,00`, daty `DD.MM.RRRR`; font Inter (statyczne odmiany w `public/fonts/invoice`, osadzane w PDF jako TrueType).

## Zmiana szablonu

Po zmianie wyglądu podnieś `INVOICE_PRINT_TEMPLATE_VERSION` w `buildInvoicePdfHtml.ts` (nagłówek `X-Invoice-Print-Revision` podglądu). Podgląd zawsze powstaje z bieżącego szablonu; pamięć podręczna podglądu żyje tylko w otwartej karcie. Zapisane wcześniej PDF-y zostają bez zmian — „Regeneruj PDF” tworzy nowy plik nowym szablonem.
