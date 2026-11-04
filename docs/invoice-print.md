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
        │  + logo primary-black z brandbooka (pamięć 15 min), kod QR KSeF, osadzony Inter
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

## Zawartość wydruku

- Nagłówek: logo, rodzaj dokumentu, numer, oznaczenie „Wizualizacja faktury / pro formy”, „Przyjęta w KSeF” i numer KSeF.
- Daty: wystawienia, sprzedaży, termin płatności, miejsce wystawienia.
- Sprzedawca (z e-mailem i telefonem z faktury), nabywca, odbiorca (migawka z faktury).
- Pozycje; korekta: przed / po / różnica dla każdej pozycji; korekta danych stron: tabela pól przed i po.
- Zestawienie według stawek VAT (art. 106e ust. 1 pkt 13–14) i „Razem”; dla korekty — różnice według stawek i podsumowanie przed/po.
- Faktura końcowa: rozliczenie zaliczek (wartość, każda zaliczka, pozostało do zapłaty) w podsumowaniu.
- Płatność: sposób, termin, numer konta (grupowany), bank, SWIFT, tytuł przelewu, status; kwota do zapłaty / zapłacono / do zwrotu **słownie**.
- Uwagi (bez wezwania do zapłaty, gdy faktura jest opłacona), podstawa zwolnienia z VAT, podpis wystawiającego, kod QR weryfikacji KSeF.
- Stopka na każdej stronie: rodzaj i numer dokumentu, sprzedawca, strona WWW, „Strona X z Y”. Nagłówek tabeli powtarza się na kolejnych stronach.
- Liczby po polsku: `12 840,00`, daty `DD.MM.RRRR`; font Inter (statyczne odmiany w `public/fonts/invoice`, osadzane w PDF jako TrueType).

## Zmiana szablonu

Po zmianie wyglądu podnieś `INVOICE_PRINT_TEMPLATE_VERSION` w `buildInvoicePdfHtml.ts` (nagłówek `X-Invoice-Print-Revision` podglądu). Podgląd zawsze powstaje z bieżącego szablonu; pamięć podręczna podglądu żyje tylko w otwartej karcie. Zapisane wcześniej PDF-y zostają bez zmian — „Regeneruj PDF” tworzy nowy plik nowym szablonem.
