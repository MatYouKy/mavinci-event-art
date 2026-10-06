'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import VehicleTravelCalculator, { type FuelEstimateSnapshot, type TravelCalculatorResult } from '@/components/crm/VehicleTravelCalculator';
import type { OfferLogisticsRouteSnapshot } from '@/lib/CRM/Offers/logisticsEstimate';

type Destination = { label: string; locationId: string | null; source: string };
type Location = { id: string; name: string; formatted_address: string | null; address: string | null; city: string | null; postal_code: string | null };
const sourceLabels: Record<string,string> = { event: 'Z wydarzenia', offer: 'Ze szczegółów oferty', catalog: 'Z katalogu lokalizacji' };
const button = 'rounded-lg bg-[#d3bb73]/10 px-3 py-2 text-xs text-[#d3bb73] disabled:opacity-40';
async function fetchData(offerId: string, action: string, data: object, signal: AbortSignal) {
  const response = await fetch('/bridge/offers/travel-estimate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ offerId, action, ...data }), signal });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Nie udało się pobrać trasy.');
  return result;
}
export default function OfferLogisticsRoute({ offerId, value, fuel, distance, onApply, onBusyChange, disabled, readOnly }: {
  offerId: string; value?: OfferLogisticsRouteSnapshot | null;
  fuel?: FuelEstimateSnapshot; distance: number | null;
  onApply: (route: OfferLogisticsRouteSnapshot | null, fuel?: FuelEstimateSnapshot, distance?: number) => void; onBusyChange?: (busy: boolean) => void;
  disabled?: boolean; readOnly?: boolean;
}) {
  const [destination, setDestination] = useState<Destination | null>(null);
  const [override, setOverride] = useState<Destination | null>(() => value?.source === 'catalog' && value.location_id ? { label: value.destination, locationId: value.location_id, source: 'catalog' } : null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [locations, setLocations] = useState<Location[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [reload, setReload] = useState(0);
  const [origin, setOrigin] = useState(value?.origin || 'Marcina Kasprzaka 15, Olsztyn, Polska');
  const busyCallback = useRef(onBusyChange); busyCallback.current = onBusyChange;
  const changeBusy = useCallback((next: boolean) => { setBusy(next); busyCallback.current?.(next); }, []);
  const apply = useRef(onApply); apply.current = onApply;
  const selected = override || destination;
  useEffect(() => {
    if (readOnly) return;
    const controller = new AbortController(); setLoading(true); setError('');
    void fetchData(offerId, 'destination', {}, controller.signal).then(data => {
      if (!controller.signal.aborted) { setDestination(data.destination); if (!data.destination && !override) setSearchOpen(true); }
    }).catch(e => { if (!controller.signal.aborted) { setError(e.message); setSearchOpen(true); } }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
    // Destination is refreshed when this editor opens, not on each form change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offerId, readOnly, reload]);
  useEffect(() => {
    if (!searchOpen || readOnly) return;
    const controller = new AbortController(); setSearching(true); setSearchError(''); setLocations([]);
    const timer = setTimeout(() => {
      void fetchData(offerId, 'search', { query }, controller.signal).then(data => { if (!controller.signal.aborted) setLocations(data.locations); }).catch(e => { if (!controller.signal.aborted) setSearchError(e.message); }).finally(() => { if (!controller.signal.aborted) setSearching(false); });
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [offerId, query, searchOpen, readOnly]);
  useEffect(() => () => { busyCallback.current?.(false); }, []);
  const applyCalculator = (result: TravelCalculatorResult) => {
    const route = result.routeEstimate;
    if (route) {
      const snapshot: OfferLogisticsRouteSnapshot = {
        origin, destination: route.destination, location_id: route.location_id ?? null,
        source: route.source === 'catalog' ? 'catalog' : route.source === 'offer' ? 'offer' : 'event',
        distance_km: route.distanceKm,
        travel_minutes: Math.ceil((route.outbound.durationSeconds + (route.inbound?.durationSeconds || 0))/60),
        outbound_km: Math.round(route.outbound.distanceMeters/100)/10,
        inbound_km: Math.round((route.inbound?.distanceMeters || 0)/100)/10,
        round_trip: Boolean(route.inbound), resolved_destination: route.outbound.endAddress,
        calculated_at: route.calculated_at || new Date().toISOString(),
      };
      apply.current(snapshot, result.fuelEstimate, route.distanceKm);
    } else if (result.fuelEstimate) apply.current(value || null, result.fuelEstimate);
  };
  if (readOnly && !value) return null;
  const controls = <div className="space-y-3">
    {selected && <p className="text-xs text-[#e5e4e2]/45">{sourceLabels[selected.source] || 'Miejsce realizacji'}</p>}
      <div className="flex flex-wrap gap-2"><button type="button" disabled={disabled || busy} onClick={() => setSearchOpen(v => !v)} className={button}>{searchOpen ? 'Zamknij lokalizacje' : 'Wybierz z naszych lokalizacji'}</button>{override && <button type="button" disabled={disabled || busy} onClick={() => setOverride(null)} className={button}>Użyj miejsca z wydarzenia / oferty</button>}</div>
      {searchOpen && <div className="space-y-2"><input type="search" value={query} disabled={disabled || busy} onChange={e=>setQuery(e.target.value)} aria-label="Szukaj zapisanej lokalizacji" placeholder="Nazwa, miasto lub adres…" className="w-full rounded-lg border border-white/10 bg-black/15 px-3 py-2 text-sm" /><div className="max-h-44 space-y-1 overflow-y-auto">{searching ? <p className="text-xs text-[#e5e4e2]/50">Wyszukiwanie…</p> : locations.map(location => <button type="button" key={location.id} disabled={disabled || busy} onClick={() => { setOverride({ label: [location.name, location.formatted_address || [location.address,location.city].filter(Boolean).join(', ')].filter(Boolean).join(' — '), locationId: location.id, source:'catalog' }); setError(''); setSearchOpen(false); }} className="block w-full rounded-lg bg-white/5 p-2 text-left text-sm"><span>{location.name}</span><small className="block text-[#e5e4e2]/50">{location.formatted_address || [location.address,location.postal_code,location.city].filter(Boolean).join(', ')}</small></button>)}{!searching && !locations.length && !searchError && <p className="text-xs text-[#e5e4e2]/50">Brak wyników. Spróbuj innej nazwy lub miasta.</p>}{searchError && <p role="alert" className="text-xs text-red-200">{searchError}</p>}</div><p className="text-[11px] text-[#e5e4e2]/40">Do 20 wyników. Wybór dotyczy tej kalkulacji i nie zmienia wydarzenia.</p></div>}
    {error && <p role="alert" className="text-xs text-red-200">{error} <button type="button" disabled={disabled || busy} onClick={()=>setReload(n=>n+1)} className="underline">Odśwież miejsce realizacji</button></p>}
  </div>;
  if (readOnly) return value ? <p className="text-xs text-[#e5e4e2]/60">{value.origin} → {value.destination} · {value.distance_km} km {value.round_trip === false ? '(w jedną stronę)' : '(z powrotem)'}</p> : null;
  return <fieldset disabled={disabled || loading} className="min-w-0">
    <VehicleTravelCalculator offerId={offerId} locationId={override?.locationId ?? null}
      eventLocation={loading ? '' : selected?.label || ''} vehicleId="" origin={origin}
      distance={distance == null ? '' : String(distance)} initialFuel={fuel} initialRoundTrip={value?.round_trip !== false}
      destinationControls={controls} onOriginChange={setOrigin} onBusyChange={changeBusy} onApply={applyCalculator} />
    {value && <p className="mt-2 text-xs text-[#e5e4e2]/50">Ostatnie obliczenie: {value.origin} → {value.resolved_destination} · {value.distance_km} km {value.round_trip === false ? '(w jedną stronę)' : '(z powrotem)'}. Po zmianie celu przelicz trasę ponownie.</p>}
  </fieldset>;
}
