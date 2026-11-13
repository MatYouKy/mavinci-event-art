/**
 * Karta produktu: „Uzupełnij” w panelu gotowości otwiera wskazaną sekcję (`ProductSettingsDrawer` z `anchor`)
 * i przewija do niej; zamknięcie sekcji lub koniec edycji prosi panel o ponowne sprawdzenie sprzętu i obsady.
 */
export const PRODUCT_SECTION_OPEN_EVENT = 'crm:product-section-open';
export const PRODUCT_READINESS_REFRESH_EVENT = 'crm:product-readiness-refresh';

export function openProductSection(anchor: string) {
  window.dispatchEvent(new CustomEvent<string>(PRODUCT_SECTION_OPEN_EVENT, { detail: anchor }));
  window.requestAnimationFrame(() => {
    document.getElementById(anchor)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

export function requestProductReadinessRefresh() {
  window.dispatchEvent(new Event(PRODUCT_READINESS_REFRESH_EVENT));
}
