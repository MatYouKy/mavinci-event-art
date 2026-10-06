# Audyt przycisków i zakładek — 21.09.2026

## Zakres

Przegląd statyczny 740 plików TSX w src: 2959 elementów button (w tym 14 samozamykających). Przejrzano reguły CSS oraz miejsca używające wyglądu lub obsługi zakładek. Nie jest to potwierdzenie ręcznego otwarcia wszystkich ekranów aplikacji.

## Przyczyna i poprawka

Globalny selektor dopasowywał złoty przycisk wewnątrz dowolnego rodzica z klasą border-b. W efekcie zapis, eksport i inne akcje otrzymywały kształt i podkreślenie aktywnej zakładki. Usunięto tę heurystykę oraz dziedziczenie stylu active od dowolnego potomka tablist.

56 definicji zakładek ma jawne data-crm-tab-active. 62 drugorzędne akcje otrzymały wspólny wariant data-crm-action="secondary". Istniejące złote akcje główne i czerwone destrukcyjne zachowują swój charakter. Filtry, selektory, elementy menu i przełączniki widoku nie stają się zakładkami na podstawie koloru.

## Zasady kolejnych zmian

- Akcja drugorzędna: data-crm-action="secondary", klasy rozmiaru i odstępów lokalnie. Cztery zaokrąglone rogi, subtelne tło i złoty tekst.
- Zakładka: data-crm-tab-active={warunek}; złote podkreślenie i górne zaokrąglenie wyłącznie dla aktywnego widoku.
- Dla komponentu z pełną obsługą klawiatury można używać role="tab" oraz aria-selected. Sam atrybut wizualny nie zastępuje implementacji wzorca ARIA tabs.
- Nie rozpoznawaj roli kontrolki przez ramkę rodzica, kolor tekstu lub tekst etykiety.

## Weryfikacja

Test scripts/ui/test-action-tab-styles.cjs kompiluje rzeczywisty index.css z Tailwind i sprawdza w Chromium: akcje wewnątrz border-b, aktywne i nieaktywne zakładki, hover, focus, disabled oraz szerokości 390 i 1280 px. Kompilacja SWC sprawdza 68 objętych zmianą plików. Nie wykonywano pełnego builda.

## Zmienione miejsca

| Plik | Zakładki | Akcje |
| --- | ---: | ---: |
| `src/app/(crm)/crm/brochures/[id]/BrochureEditorClient.tsx` | 0 | 1 |
| `src/app/(crm)/crm/calendar/meeting/[id]/page.tsx` | 0 | 1 |
| `src/app/(crm)/crm/campaigns/CampaignsPageClient.tsx` | 0 | 1 |
| `src/app/(crm)/crm/clients/[id]/page.tsx` | 4 | 0 |
| `src/app/(crm)/crm/contacts/[id]/page.tsx` | 2 | 1 |
| `src/app/(crm)/crm/contacts/page.tsx` | 2 | 0 |
| `src/app/(crm)/crm/contract-templates/[id]/edit-wysiwyg/page.tsx` | 0 | 1 |
| `src/app/(crm)/crm/employees/[id]/page.tsx` | 1 | 0 |
| `src/app/(crm)/crm/events/UI/RenderRowItem.tsx` | 0 | 1 |
| `src/app/(crm)/crm/events/[id]/EventDetailPageClient.tsx` | 1 | 0 |
| `src/app/(crm)/crm/events/[id]/components/tabs/EventAgendaTab.tsx` | 0 | 1 |
| `src/app/(crm)/crm/events/[id]/components/tabs/EventEquipmentTab.tsx` | 0 | 1 |
| `src/app/(crm)/crm/events/[id]/components/tabs/EventFinancesTab.tsx` | 0 | 2 |
| `src/app/(crm)/crm/events/[id]/components/tabs/EventMavinciLiveTab.tsx` | 0 | 3 |
| `src/app/(crm)/crm/events/[id]/components/tabs/EventSubcontractorsPanel.tsx` | 0 | 1 |
| `src/app/(crm)/crm/events/[id]/components/tabs/EventWeddingCardTab.tsx` | 0 | 1 |
| `src/app/(crm)/crm/events/[id]/components/tabs/EventsDetailsTab/EventBillingContextCard.tsx` | 0 | 1 |
| `src/app/(crm)/crm/events/[id]/components/tabs/EventsDetailsTab/EventCommissionsPanel.tsx` | 0 | 4 |
| `src/app/(crm)/crm/events/[id]/components/tabs/PhaseResourcesPanel.tsx` | 1 | 0 |
| `src/app/(crm)/crm/events/[id]/components/tabs/WeddingPeopleSchedulePanel.tsx` | 0 | 2 |
| `src/app/(crm)/crm/fleet/[id]/page.tsx` | 1 | 0 |
| `src/app/(crm)/crm/inquiries/InquiriesPageClient.tsx` | 0 | 1 |
| `src/app/(crm)/crm/inquiries/[id]/InquiryWorkspaceClient.tsx` | 1 | 1 |
| `src/app/(crm)/crm/invoices/new/components/InvoiceNumberInput.tsx` | 0 | 1 |
| `src/app/(crm)/crm/invoices/page.tsx` | 1 | 0 |
| `src/app/(crm)/crm/mavinci-live/MavinciLiveHubClient.tsx` | 1 | 3 |
| `src/app/(crm)/crm/mavinci-live/MavinciQuizShowPanel.tsx` | 0 | 2 |
| `src/app/(crm)/crm/offers/[id]/components/OfferRequirementsEditor.tsx` | 0 | 2 |
| `src/app/(crm)/crm/offers/[id]/page.tsx` | 0 | 1 |
| `src/app/(crm)/crm/offers/products/[id]/ProductDetailPage.tsx` | 0 | 2 |
| `src/app/(crm)/crm/settings/access-levels/page.tsx` | 0 | 1 |
| `src/app/(crm)/crm/settings/email-template/page.tsx` | 1 | 0 |
| `src/app/(crm)/crm/settings/my-companies/[id]/brandbook/page.tsx` | 1 | 1 |
| `src/app/(crm)/crm/settings/page.tsx` | 6 | 0 |
| `src/app/(crm)/crm/settings/system-health/page.tsx` | 0 | 1 |
| `src/app/(crm)/crm/settings/webhooks/page.tsx` | 2 | 0 |
| `src/app/(crm)/crm/settings/workflows/page.tsx` | 0 | 2 |
| `src/app/(crm)/crm/subcontractors/[id]/page.tsx` | 3 | 0 |
| `src/app/(crm)/crm/tenders/config/page.tsx` | 0 | 1 |
| `src/app/(public)/oferta/technika-sceniczna/[miasto]/TechStageCityGallery.tsx` | 0 | 1 |
| `src/app/(public)/oferta/technika-sceniczna/[miasto]/TechStageCityIntro.tsx` | 0 | 1 |
| `src/app/(public)/oferta/technika-sceniczna/sections/TechnicalStageFeatures.tsx` | 1 | 0 |
| `src/app/(public)/oferta/technika-sceniczna/sections/TechnicalStageGallery.tsx` | 0 | 1 |
| `src/app/(public)/seller/_components/SellerDatePicker.tsx` | 0 | 1 |
| `src/app/(public)/uslugi/[slug]/ServiceDetailClient.tsx` | 0 | 1 |
| `src/components/AdminCasinoPanel.tsx` | 1 | 0 |
| `src/components/AdminDashboard.tsx` | 4 | 0 |
| `src/components/crm/AddEventVehicleModal.tsx` | 0 | 1 |
| `src/components/crm/BankAiAnalysisPanel.tsx` | 1 | 0 |
| `src/components/crm/Calendar/CalendarMain.tsx` | 0 | 1 |
| `src/components/crm/ClientSelectorTabs.tsx` | 2 | 0 |
| `src/components/crm/EditEventClientModal.tsx` | 2 | 0 |
| `src/components/crm/FinalInvoiceWizardModal.tsx` | 0 | 2 |
| `src/components/crm/KSeFFinancialDashboard.tsx` | 0 | 2 |
| `src/components/crm/KSeFIntegrationPanel.tsx` | 3 | 0 |
| `src/components/crm/SubcontractorServicesPanel.tsx` | 1 | 0 |
| `src/components/crm/equipment/TabCarousel.tsx` | 1 | 0 |
| `src/components/crm/events/calculations/AddCalculationItemModal.tsx` | 0 | 1 |
| `src/components/crm/events/calculations/CategorySection.tsx` | 0 | 1 |
| `src/components/crm/events/calculations/ImportFromOfferModal.tsx` | 3 | 1 |
| `src/components/crm/invoices/modal/BankStatementRecord.tsx` | 2 | 1 |
| `src/components/crm/invoices/tabs/AccountingWorkspaceTab.tsx` | 1 | 3 |
| `src/components/crm/invoices/tabs/ExternalInvoicesTab/ExternalInvoicesTab.tsx` | 2 | 0 |
| `src/components/crm/invoices/tabs/PersonnelContractsRegistry.tsx` | 0 | 1 |
| `src/components/crm/marketing/MarketingIntegrationSettings.tsx` | 1 | 1 |
| `src/components/crm/marketing/MarketingWorkspace.tsx` | 1 | 1 |
| `src/components/crm/personnel/PersonnelContractsPanel.tsx` | 1 | 0 |
| `src/components/seller/CrmSellerWorkspace.tsx` | 1 | 0 |
