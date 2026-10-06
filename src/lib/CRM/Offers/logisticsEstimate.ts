import type { FuelEstimateSnapshot } from '@/components/crm/VehicleTravelCalculator';
import { calculateFuelCost } from '@/lib/CRM/events/travelEstimate';

export const logisticsEstimateKinds = {
  fuel: 'Paliwo', travel: 'Czas ekipy', meals: 'Wyżywienie', accommodation: 'Nocleg', other: 'Inny koszt',
} as const;
export type LogisticsEstimateKind = keyof typeof logisticsEstimateKinds;
export type LogisticsEstimateRow = {
  id: string; kind: LogisticsEstimateKind; name: string;
  quantity: number | null; units: number | null; rate: number | null;
  included_hours: number | null; consumption: number | null;
  fuel_estimate?: FuelEstimateSnapshot; route?: OfferLogisticsRouteSnapshot | null;
};
export type OfferLogisticsRouteSnapshot = {
  origin: string; destination: string; location_id: string | null; source: 'event' | 'offer' | 'catalog';
  distance_km: number; travel_minutes: number; outbound_km: number; inbound_km: number;
  resolved_destination: string; calculated_at: string; round_trip?: boolean;
};
export type LogisticsEstimate = { route?: OfferLogisticsRouteSnapshot | null; version: 1; rows: LogisticsEstimateRow[]; reserve_percent: number | null; notes: string };
export const emptyLogisticsEstimate = (): LogisticsEstimate => ({ version: 1, rows: [], reserve_percent: 0, notes: '' });
export const newLogisticsEstimateRow = (kind: LogisticsEstimateKind): LogisticsEstimateRow => ({
  id: crypto.randomUUID(), kind,
  name: { fuel: 'Paliwo — przejazd w obie strony', travel: 'Ekipa — czas podróży', meals: 'Posiłki i napoje', accommodation: 'Nocleg ekipy', other: 'Parking / opłaty / inne' }[kind],
  quantity: 1, units: kind === 'fuel' || kind === 'travel' ? null : 1, rate: null, included_hours: 0, consumption: null,
});
const round = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const valid = (n: unknown, max: number, positive = false): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0 && (!positive || n > 0) && n <= max && Math.abs(n * 100 - Math.round(n * 100)) < 0.00001;
export function logisticsEstimateRowCost(row: LogisticsEstimateRow): number | null {
  if (!valid(row.quantity, 10000, true) || !Number.isInteger(row.quantity) || !valid(row.units, 100000) || !valid(row.rate, 99999999.99)) return null;
  if (row.kind === 'fuel') {
    if (!valid(row.consumption, 1000, true) || row.rate <= 0) return null;
    const fuel = calculateFuelCost(row.units, row.consumption, row.rate);
    return fuel == null ? null : round(fuel * row.quantity);
  }
  if (row.kind === 'travel' && (!valid(row.included_hours, 100000) || row.included_hours > row.units)) return null;
  return round(row.quantity * (row.units - (row.kind === 'travel' ? row.included_hours! : 0)) * row.rate);
}
export function summarizeLogisticsEstimate(value: LogisticsEstimate) {
  let error = '';
  if (value.version !== 1 || !Array.isArray(value.rows) || !value.rows.length || value.rows.length > 30) error = 'Dodaj od 1 do 30 pozycji kosztowych. Dla braku kosztów wybierz kwotę ręczną i wpisz 0.';
  if (!valid(value.reserve_percent, 100)) error = 'Podaj rezerwę od 0 do 100% (maksymalnie dwa miejsca po przecinku).';
  if (typeof value.notes !== 'string' || value.notes.length > 2000) error = 'Założenia mogą mieć do 2000 znaków.';
  const ids = new Set<string>();
  let subtotal = 0;
  for (const row of value.rows || []) {
    if (!Object.prototype.hasOwnProperty.call(logisticsEstimateKinds, row.kind) || !row.name.trim() || row.name.length > 120 || !row.id || ids.has(row.id)) error = 'Każda pozycja musi mieć własną nazwę (do 120 znaków).';
    ids.add(row.id);
    const amount = logisticsEstimateRowCost(row);
    if (amount == null) error = 'Uzupełnij ilość, czas lub dystans i stawkę wybranych kosztów. Godziny wliczone w pakiet nie mogą przekraczać czasu podróży.';
    else subtotal += amount;
  }
  subtotal = round(subtotal);
  const reserve = round(subtotal * (value.reserve_percent ?? 0) / 100);
  const total = round(subtotal + reserve);
  if (total > 99999999.99) error = 'Szacunek przekracza maksymalną kwotę.';
  return { error, subtotal, reserve, total: error ? null : total };
}
