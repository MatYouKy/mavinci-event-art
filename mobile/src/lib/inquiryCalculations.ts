import { crmPost, forgetFunnel, inquiriesGet, inquiriesPost } from './inquiriesApi';

/*
 * Kalkulacje zapytania na tablecie — te same odczyty i czynności co edytor kalkulacji w CRM (`CalculationEditor` z
 * `inquiryContext`) i na Macu (`CalculationEditorView` z `CalculationBackend.inquiry`): `/bridge/native/v1/inquiries` —
 * GET op=calcQuery&query=editor|catalog|pdf|pdfPayload|travel|importSources|emailSetup|consumption|fuel, POST op=calcAction
 * (remove, duplicate, select, saveItem, addItems, removeItem, save, importItems, emailPreview; kalkulacja w `targetId`),
 * op=calcEmail. PDF generuje serwer CRM (`/bridge/events/calculation-pdf`) — plik przy zapytaniu albo w wydarzeniu zapytania.
 */

export type CalcCategory = 'equipment' | 'staff' | 'transport' | 'other';
export const CALC_CATEGORIES: ReadonlyArray<{ id: CalcCategory; label: string; icon: 'package' | 'users' | 'truck' | 'more-horizontal' }> = [
  { id: 'equipment', label: 'Pozycje', icon: 'package' },
  { id: 'staff', label: 'Ludzie', icon: 'users' },
  { id: 'transport', label: 'Transport', icon: 'truck' },
  { id: 'other', label: 'Pozostałe', icon: 'more-horizontal' },
];

/** Pozycja kalkulacji (`event_calculation_items`); `days` w transporcie to kilometry. */
export type CalcLine = {
  id: string;
  category: CalcCategory;
  name: string;
  description: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  days: number;
  source: string;
  sourceRef: string | null;
  sourceLabel: string | null;
  position: number;
  vat: number;
  power: number | null;
  weight: number | null;
  thumbnail: string | null;
  stock: number | null;
  transportEstimate: Record<string, unknown> | null;
};
export type CalcEditor = {
  id: string; name: string; notes: string; pdf: string | null; createdAt: string | null; pdfCurrent: boolean; revision: number; items: CalcLine[];
};
export type CalcCatalogOption = {
  id: string; label: string; name: string; title: string; subtitle: string; detail: string | null; price: number; unit: string; vat: number;
  thumbnail: string | null; stock: number | null; power: number | null; weight: number | null; description: string; minimum: number | null;
  people: number | null; fuelType: string | null;
};
export type CalcImportSources = {
  products: Array<{ ref: string; name: string; description: string; quantity: number; unit: string; unitPrice: number; total: number; offerName: string; categoryName: string | null; category: CalcCategory; vat: number }>;
  equipment: Array<{ ref: string; name: string; quantity: number; rentalPrice: number; productName: string; offerName: string; isKit: boolean; isRental: boolean }>;
  staff: Array<{ ref: string; role: string; quantity: number; hourlyRate: number; estimatedHours: number; productName: string; offerName: string }>;
  vehicles: Array<{ ref: string; vehicleName: string; role: string; driverName: string | null; estimatedDistance: number | null; fuelCost: number | null; tollCost: number | null }>;
};
export type CalcEmailSetup = {
  accounts: Array<{ id: string; label: string }>; to: string; contact: string; subject: string; text: string; pdfReady: boolean;
  files: Array<{ id: string; name: string; size: number | null; createdAt: string | null }>;
};
export type CalcTravelContext = { origin: string; destination: { label: string; locationId: string | null; source: string } | null };
export type CalcRoute = {
  outbound: { distanceMeters: number; durationSeconds: number; startAddress?: string; endAddress?: string };
  inbound: { distanceMeters: number; durationSeconds: number } | null;
  distanceKm: number; travelMinutes: number; origin: string; destination: string; location_id: string | null; source: string; round_trip: boolean; calculated_at: string;
};
export type CalcFuelQuote = { prices?: Record<string, number>; sourceUpdated?: string; fetchedAt?: string };

/** Pola pozycji do zapisu (`serializeItem`). */
export type CalcItemPayload = {
  id?: string | null; category: CalcCategory; name: string; description: string; unit: string; quantity: number; unitPrice: number; days: number;
  source: string; sourceRef: string | null; vat: number; power: number | null; weight: number | null; transportEstimate: Record<string, unknown> | null;
};
export const linePayload = (line: CalcLine): CalcItemPayload => ({
  id: line.id, category: line.category, name: line.name, description: line.description, unit: line.unit, quantity: line.quantity,
  unitPrice: line.unitPrice, days: line.days, source: line.source, sourceRef: line.sourceRef, vat: line.vat, power: line.power,
  weight: line.weight, transportEstimate: line.transportEstimate,
});

const query = <T>(inquiryId: string, name: string, params: Record<string, string> = {}) => inquiriesGet<T>('calcQuery', { id: inquiryId, query: name, ...params });
const action = async <T = { ok: boolean }>(inquiryId: string, name: string, body: Record<string, unknown> = {}, targetId: string | null = null) => {
  const reply = await inquiriesPost<T>('calcAction', { ...body, id: inquiryId, action: name, targetId });
  forgetFunnel();
  return reply;
};

export const loadCalcEditor = (inquiryId: string, calculationId: string) => query<CalcEditor>(inquiryId, 'editor', { calculationId });
export const loadCalcCatalog = (inquiryId: string, kind: 'equipment' | 'product' | 'vehicle') => query<{ options: CalcCatalogOption[] }>(inquiryId, 'catalog', { kind });
export const loadCalcImportSources = (inquiryId: string) => query<CalcImportSources>(inquiryId, 'importSources');
export const loadCalcEmailSetup = (inquiryId: string, calculationId: string) => query<CalcEmailSetup>(inquiryId, 'emailSetup', { calculationId });
export const loadCalcTravelContext = (inquiryId: string, calculationId: string) => query<CalcTravelContext>(inquiryId, 'travel', { calculationId, action: 'destination' });
/** Trasa Google Maps: cel z zapytania / wydarzenia albo wpisany (`destination`), opcjonalnie z powrotem. */
export const calcRoute = (inquiryId: string, calculationId: string, origin: string, roundTrip: boolean, destination: string | null) =>
  query<CalcRoute>(inquiryId, 'travel', { calculationId, action: 'route', origin, roundTrip: roundTrip ? '1' : '0', ...(destination !== null ? { destination } : {}) });
export const calcVehicleConsumption = (inquiryId: string, vehicleId: string) =>
  query<{ value: number | null; source: string | null; error: string | null }>(inquiryId, 'consumption', { vehicleId });
export const calcFuelQuote = (inquiryId: string) => query<CalcFuelQuote>(inquiryId, 'fuel');
/** Podpisany adres PDF; `current` — tylko gdy dokument odpowiada zapisanej treści. */
export const calcPdfLink = (inquiryId: string, calculationId: string, current: boolean) =>
  query<{ url: string; name: string }>(inquiryId, 'pdf', { calculationId, ...(current ? { current: '1' } : {}) });

export const removeCalculation = (inquiryId: string, calculationId: string) => action(inquiryId, 'remove', {}, calculationId);
export const duplicateCalculation = (inquiryId: string, calculationId: string) => action(inquiryId, 'duplicate', {}, calculationId);
/** „Wybierz kalkulację” (`select_inquiry_calculation`) z kontrolą poprzedniego wyboru. */
export const selectCalculation = (inquiryId: string, calculationId: string, expected: string | null) => action(inquiryId, 'select', { expected }, calculationId);
export const saveCalcItem = (inquiryId: string, calculationId: string, item: CalcItemPayload) => action(inquiryId, 'saveItem', { calculationId, item });
export const addCalcItems = (inquiryId: string, calculationId: string, items: CalcItemPayload[]) =>
  action<{ ok: boolean; count: number; merged: number }>(inquiryId, 'addItems', { calculationId, items });
export const removeCalcItem = (inquiryId: string, calculationId: string, itemId: string) => action(inquiryId, 'removeItem', { calculationId, itemId });
/** Nazwa, notatki i wszystkie pozycje w kolejności (jedno żądanie); zmiana kolejności unieważnia PDF. */
export const saveCalculation = (inquiryId: string, calculationId: string, data: { name: string; notes: string; orderChanged: boolean; items: CalcItemPayload[] }) =>
  action(inquiryId, 'save', { calculationId, ...data });
export const importCalcItems = (inquiryId: string, calculationId: string, items: CalcItemPayload[]) =>
  action<{ ok: boolean; count: number }>(inquiryId, 'importItems', { calculationId, items });
export const calcEmailPreview = (inquiryId: string, calculationId: string, accountId: string, subject: string, text: string) =>
  action<{ ok: boolean; html: string }>(inquiryId, 'emailPreview', { calculationId, accountId, subject, text });
export const sendCalcEmail = async (inquiryId: string, mail: {
  calculationId: string; accountId: string; to: string; cc: string; bcc: string; subject: string; text: string; fileIds: string[]; scheduledAt: string | null;
}) => {
  const reply = await inquiriesPost<{ scheduled: boolean; scheduledAt: string | null }>('calcEmail', { id: inquiryId, ...mail });
  forgetFunnel();
  return reply;
};
/** „Generuj PDF” z zapisanej treści — na serwerze CRM; plik przy zapytaniu (albo w Plikach wydarzenia zapytania). */
export async function generateCalcPdf(inquiryId: string, calculationId: string) {
  const payload = await query<Record<string, unknown>>(inquiryId, 'pdfPayload', { calculationId });
  return crmPost<{ ok: boolean }>('/bridge/events/calculation-pdf', payload);
}

// MARK: Wartości (jak `calculations.helper` i `CalculationMath` na Macu)

export const round2 = (value: number) => Math.round(value * 100) / 100;
export const lineNet = (line: Pick<CalcLine, 'quantity' | 'unitPrice' | 'days'>) => round2(line.quantity * line.unitPrice * (line.days === 0 ? 1 : line.days));
export const lineGross = (line: Pick<CalcLine, 'quantity' | 'unitPrice' | 'days' | 'vat'>) => round2(lineNet(line) * (1 + line.vat / 100));
const moneyFormat = new Intl.NumberFormat('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** „1 234,50” */
export const calcMoney = (value: number) => moneyFormat.format(Number.isFinite(value) ? value : 0);
/** Liczba do pola i tabeli — bez zbędnych zer, z przecinkiem, bez separatora tysięcy. */
export const calcPlain = (value: number, max = 2) => {
  if (!Number.isFinite(value)) return '';
  const fixed = value.toFixed(max).replace(/\.?0+$/, '');
  return fixed.replace('.', ',');
};
/** Pole tekstowe → liczba (spacje i przecinek dozwolone); pusty / błędny tekst — `null`. */
export const calcParse = (text: string): number | null => {
  const clean = text.replace(/[\s ]/g, '').replace(',', '.');
  if (!clean) return null;
  const value = Number(clean);
  return Number.isFinite(value) ? value : null;
};
export const calcPower = (watts: number) => (watts >= 1000 ? `${calcPlain(watts / 1000)} kW` : `${Math.round(watts)} W`);
export const calcWeight = (kg: number) => (kg >= 1000 ? `${calcPlain(kg / 1000)} t` : `${calcPlain(kg, 1)} kg`);
/** Koszt paliwa brutto: dystans × spalanie / 100 × cena litra. */
export const fuelCost = (distance: number, consumption: number, price: number) =>
  Number.isFinite(distance) && distance >= 0 && consumption > 0 && price > 0 ? Math.round((distance / 100) * consumption * price * 100) / 100 : null;
/** Stawka paliwowa netto za km z ceny brutto litra i VAT paliwa (6 miejsc po przecinku). */
export const fuelRatePerKm = (consumption: number, priceGross: number, vatPercent: number) =>
  Math.round((consumption / 100 * priceGross / (1 + vatPercent / 100)) * 1_000_000) / 1_000_000;

export const TRAVEL_ORIGIN = 'Marcina Kasprzaka 15/66, Olsztyn, Polska';
export const FUEL_TYPES: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'benzyna95', label: 'Benzyna 95' }, { id: 'benzyna98', label: 'Benzyna 98' }, { id: 'diesel', label: 'Olej napędowy' }, { id: 'LPG', label: 'LPG' },
  { id: 'elektryczny', label: 'Elektryczny' }, { id: 'other', label: 'Inne' },
];
export const isLiquidFuel = (type: string) => ['benzyna95', 'benzyna98', 'diesel', 'LPG'].includes(type);
