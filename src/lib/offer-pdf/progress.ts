// Shared, public progress contract. No document content or credentials in events.
export const OFFER_PDF_STEPS = [
  { id: 'queued', label: 'Oczekiwanie na generator' },
  { id: 'data', label: 'Odczyt danych oferty' },
  { id: 'layout', label: 'Szablon, czcionki i okładka' },
  { id: 'products', label: 'Produkty, zdjęcia i pakiety' },
  { id: 'pricing', label: 'Kalkulacja i podsumowanie cen' },
  { id: 'recommendations', label: 'Propozycje dodatkowe' },
  { id: 'finishing', label: 'Warunki, zakończenie i numeracja stron' },
  { id: 'saving', label: 'Tworzenie i zapis pliku PDF' },
  { id: 'download', label: 'Pobieranie gotowego PDF' },
] as const;
export type OfferPdfStep = typeof OFFER_PDF_STEPS[number]['id'];
export type OfferPdfProgress = { step: OfferPdfStep; detail?: string };
export type ReportOfferPdfProgress = (progress: OfferPdfProgress) => void;

export type OfferPdfFailure = {
  step: OfferPdfStep;
  message: string;
  context: string;
  code?: string;
  requestId?: string;
  status?: number;
  occurredAt: string;
};
