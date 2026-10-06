import type { TravelPlan } from './travelPlan';

type Phase = { name: string; start_time: string; end_time: string; phase_type?: { name: string } };
export type TravelVehicle = {
  id: string;
  status?: string;
  vehicle_available_from?: string;
  vehicle_available_until?: string;
  loading_time_minutes?: number;
  travel_plan?: TravelPlan | null;
  logistics_schedule?: {
    mode?: string;
    outbound_start?: string;
    inbound_start?: string;
    pickup?: { id: string; name?: string };
    return?: { id: string; name?: string };
    unloading_minutes?: number;
  } | null;
  vehicles?: { name?: string };
  vehicle?: { name?: string };
  external_company_name?: string;
};
export type FlexibleDirection = 'outbound' | 'inbound';
export type TravelInterval =
  { start: string; end: string; reason?: never } | { start?: never; end?: never; reason: string };
const minutes = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const millis = (value?: string) => (value ? Date.parse(value) : NaN);
const stage = (value?: { id: string; name?: string }, id?: string, name?: string) =>
  value?.id === `local:${id}` || value?.name?.toLocaleLowerCase('pl-PL').startsWith(name || '__');

// Pure projection: logistics stays the source of truth, no phase writes or
// synthetic dates are needed when a trip has not yet been planned.
export function flexibleTravelInterval(
  direction: FlexibleDirection,
  vehicle: TravelVehicle,
  phases: Phase[],
): TravelInterval {
  const duration = minutes(vehicle.travel_plan?.[direction]?.plannedMinutes);
  if (!duration) return { reason: 'Oczekuje na obliczenie i zapisanie trasy w Logistyce.' };
  const travel = Math.ceil(duration / 15) * 15 * 60000;
  if (vehicle.logistics_schedule?.mode === 'timeline') {
    const value =
      vehicle.logistics_schedule[direction === 'outbound' ? 'outbound_start' : 'inbound_start'];
    const start = millis(value);
    return Number.isFinite(start)
      ? { start: new Date(start).toISOString(), end: new Date(start + travel).toISOString() }
      : { reason: 'Ustal rozpoczęcie przejazdu w Timeline.' };
  }
  let start: number;
  let end: number;
  if (vehicle.logistics_schedule) {
    const from = millis(vehicle.vehicle_available_from);
    const until = millis(vehicle.vehicle_available_until);
    if (!Number.isFinite(from) || !Number.isFinite(until) || until <= from)
      return { reason: 'Uzupełnij termin odbioru i zwrotu auta w Logistyce.' };
    const schedule = vehicle.logistics_schedule;
    if (direction === 'outbound') {
      if (stage(schedule.pickup, 'loading', 'załadunek')) {
        const loading = minutes(vehicle.loading_time_minutes);
        if (loading === null) return { reason: 'Uzupełnij czas załadunku auta w Logistyce.' };
        start = from + loading * 60000;
      } else if (stage(schedule.pickup, 'outbound', 'dojazd')) start = from;
      else
        return {
          reason:
            'Aby wyznaczyć dojazd, wskaż odbiór auta przy załadunku lub dojeździe w Logistyce.',
        };
      end = start + travel;
    } else {
      if (stage(schedule.return, 'unloading', 'rozładunek')) {
        const unloading = minutes(schedule.unloading_minutes);
        if (unloading === null)
          return { reason: 'Uzupełnij czas rozładunku auta w Logistyce i zapisz pojazd.' };
        end = until - unloading * 60000;
      } else if (stage(schedule.return, 'inbound', 'powrót')) end = until;
      else
        return {
          reason: 'Aby wyznaczyć powrót, wskaż zwrot auta po powrocie lub rozładunku w Logistyce.',
        };
      start = end - travel;
    }
    if (start < from || end > until)
      return {
        reason: 'Okres rezerwacji auta jest krótszy niż przejazd z obsługą. Popraw go w Logistyce.',
      };
  } else {
    const anchors = phases.filter(
      (p) =>
        (p.phase_type?.name || p.name).trim().toLocaleLowerCase('pl-PL') ===
        (direction === 'outbound' ? 'montaż' : 'demontaż'),
    );
    if (!anchors.length)
      return {
        reason: `Oczekuje na termin ${direction === 'outbound' ? 'montażu' : 'demontażu'} lub własny harmonogram auta.`,
      };
    if (direction === 'outbound') {
      end = Math.min(...anchors.map((p) => millis(p.start_time)));
      start = end - travel;
    } else {
      start = Math.max(...anchors.map((p) => millis(p.end_time)));
      end = start + travel;
    }
  }
  if (!Number.isFinite(start) || !Number.isFinite(end))
    return { reason: 'Brak poprawnego terminu w planie logistyki.' };
  return { start: new Date(start).toISOString(), end: new Date(end).toISOString() };
}
