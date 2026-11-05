/**
 * Tryb pokazowy „Pokaż portal hotelowi” — wyłącznie dane w pamięci przeglądarki.
 * Nic nie jest zapisywane w bazie: brak ofert, prowizji, kontaktów ani plików.
 */

export type DemoBrand = { id: string; name: string; logoUrl: string | null };

export type DemoConfig = {
  brand: DemoBrand | null;
  hotelName: string;
  /** Lokalny plik (object URL) — nigdy nie jest wysyłany na serwer. */
  logoUrl: string | null;
  accent: string;
  showEarnings: boolean;
  presenterName: string;
  presenterEmail: string;
  presenterPhone: string;
};

export type DemoService = {
  id: string;
  name: string;
  description: string;
  priceNet: number | null;
  unit: string;
  category: string | null;
  imageUrl: string | null;
};

export type DemoOfferItem = { serviceId: string; quantity: number };
export type DemoOfferDraft = {
  eventType: string;
  eventDate: string;
  guests: number;
  guestName: string;
  guestCompany: string;
  items: DemoOfferItem[];
  markupPercent: number;
};

export const DEMO_EVENT_TYPES: { id: string; label: string }[] = [
  { id: 'wedding', label: 'Wesele' },
  { id: 'conference', label: 'Konferencja' },
  { id: 'gala', label: 'Gala' },
  { id: 'corporate', label: 'Wydarzenie firmowe' },
  { id: 'party', label: 'Impreza' },
];

export const DEMO_ACCENTS = ['#d3bb73', '#b08d57', '#8c1d40', '#1f6f5c', '#2f5d8a', '#6b4fa0', '#c2410c', '#111827'];

/** Zapasowy katalog, gdy katalog produktów CRM jest pusty lub niedostępny. Ceny poglądowe. */
export const DEMO_SAMPLE_SERVICES: DemoService[] = [
  { id: 'sample-dj', name: 'DJ eventowy', description: 'Oprawa muzyczna, prowadzenie i kontakt z gośćmi — program dopasowany do charakteru wydarzenia.', priceNet: 3200, unit: 'wydarzenie', category: 'Muzyka', imageUrl: null },
  { id: 'sample-sound', name: 'Nagłośnienie sali', description: 'Zestaw nagłośnieniowy z mikrofonami bezprzewodowymi i obsługą techniczną.', priceNet: 2400, unit: 'wydarzenie', category: 'Technika', imageUrl: null },
  { id: 'sample-light', name: 'Oświetlenie dekoracyjne', description: 'Podświetlenie ścian i parkietu w kolorach wydarzenia lub hotelu.', priceNet: 1800, unit: 'wydarzenie', category: 'Technika', imageUrl: null },
  { id: 'sample-led', name: 'Ekran LED', description: 'Prezentacje, filmy i oprawa wizualna na jasnym ekranie LED.', priceNet: 4500, unit: 'dzień', category: 'Multimedia', imageUrl: null },
  { id: 'sample-photo', name: 'Fotobudka', description: 'Zdjęcia z natychmiastowym wydrukiem i galerią online dla gości.', priceNet: 1900, unit: 'wydarzenie', category: 'Atrakcje', imageUrl: null },
  { id: 'sample-casino', name: 'Kasyno eventowe', description: 'Stoły do gry z krupierami i pamiątkowymi żetonami — integracja dla gości.', priceNet: 5200, unit: 'wydarzenie', category: 'Atrakcje', imageUrl: null },
  { id: 'sample-conference', name: 'Obsługa konferencji', description: 'Dźwięk, prezentacje, realizator i wsparcie techniczne przez cały program.', priceNet: 3900, unit: 'dzień', category: 'Konferencje', imageUrl: null },
  { id: 'sample-stream', name: 'Transmisja online', description: 'Realizacja transmisji z sali na wybraną platformę, 2 kamery i realizator.', priceNet: 6800, unit: 'dzień', category: 'Multimedia', imageUrl: null },
];

export const defaultDraft = (): DemoOfferDraft => {
  const date = new Date();
  date.setDate(date.getDate() + 45);
  const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  return { eventType: 'wedding', eventDate: iso, guests: 120, guestName: 'Anna i Piotr Nowak', guestCompany: '', items: [], markupPercent: 15 };
};

export const demoPln = (value: number, digits = 0) =>
  new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN', minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value || 0);

export const demoDate = (iso: string) => {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T12:00:00`) : null;
  return date && Number.isFinite(date.getTime()) ? date.toLocaleDateString('pl-PL', { day: 'numeric', month: 'long', year: 'numeric' }) : 'termin do ustalenia';
};

/** Czytelny kolor tekstu na tle akcentu (biały / grafit). */
export function readableOn(hex: string): string {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!match) return '#111522';
  const value = parseInt(match[1], 16);
  const r = (value >> 16) & 255; const g = (value >> 8) & 255; const b = value & 255;
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6 ? '#111522' : '#ffffff';
}

export const hexAlpha = (hex: string, alpha: number) => {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!match) return `rgba(211,187,115,${alpha})`;
  const value = parseInt(match[1], 16);
  return `rgba(${(value >> 16) & 255},${(value >> 8) & 255},${value & 255},${alpha})`;
};

export const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]?.toLocaleUpperCase('pl-PL')).join('') || 'H';

/** Sumy oferty pokazowej: cena bazowa (cennik), narzut hotelu, cena dla gościa. Pozycje bez ceny = wycena indywidualna. */
export function demoTotals(draft: DemoOfferDraft, services: DemoService[]) {
  const lines = draft.items.map(item => {
    const service = services.find(entry => entry.id === item.serviceId);
    const base = service?.priceNet && service.priceNet > 0 ? service.priceNet * item.quantity : null;
    const guest = base == null ? null : Math.round(base * (1 + draft.markupPercent / 100));
    return { item, service, base, guest };
  }).filter(line => line.service);
  const baseNet = lines.reduce((sum, line) => sum + (line.base || 0), 0);
  const guestNet = lines.reduce((sum, line) => sum + (line.guest || 0), 0);
  return { lines, baseNet, guestNet, markup: guestNet - baseNet, vat: Math.round(guestNet * 0.23), gross: Math.round(guestNet * 1.23), onRequest: lines.filter(line => line.base == null).length };
}
