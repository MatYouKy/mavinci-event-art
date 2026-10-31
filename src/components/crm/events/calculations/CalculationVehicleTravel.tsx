'use client';
import { useEffect, useRef, useState } from 'react';
import VehicleTravelCalculator, { type FuelEstimateSnapshot, type RouteEstimate, type TravelCalculatorResult } from '@/components/crm/VehicleTravelCalculator';
import { DEFAULT_TRAVEL_ORIGIN } from '@/lib/CRM/events/travelEstimate';

export type CalculationTransportEstimate = {
  version: 1; origin: string; destination: string; fuel: FuelEstimateSnapshot;
  fuel_vat_percent: number; distance_km: number; rate_net_per_km: number;
  fuel_cost_gross: number; route: RouteEstimate | null; applied_at: string;
};
type Destination = { label: string; source: string };
const field = 'mt-2 w-full rounded-lg border border-white/10 bg-black/15 px-3 py-2 text-sm';
export default function CalculationVehicleTravel({ calculationId, vehicleId, vehicleFuelType, initial, distance, onApply, onBusyChange, onPendingChange }: {
  calculationId: string; vehicleId: string; vehicleFuelType?: string;
  initial?: CalculationTransportEstimate | null; distance: number;
  onApply: (result: { distance: number; rate?: number; estimate?: CalculationTransportEstimate }) => void;
  onBusyChange: (busy: boolean) => void; onPendingChange: (pending: boolean) => void;
}) {
  const [origin, setOrigin] = useState(initial?.origin || DEFAULT_TRAVEL_ORIGIN);
  const [destination, setDestination] = useState(initial?.destination || '');
  const [manual, setManual] = useState(Boolean(initial?.destination));
  const manuallyEdited = useRef(Boolean(initial?.destination));
  const [suggested, setSuggested] = useState<Destination | null>(null);
  const [contextError, setContextError] = useState('');
  const [fuelVat, setFuelVat] = useState(String(initial?.fuel_vat_percent ?? 23));
  const [route, setRoute] = useState<RouteEstimate | null>(initial?.route ?? null);
  const [routeDirty, setRouteDirty] = useState(false);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  // Stable callback avoids clearing an in-flight route on every parent render.
  const busyCallback = useRef(onBusyChange); busyCallback.current = onBusyChange;
  const changeBusy = useRef((value: boolean) => { setBusy(value); busyCallback.current(value); }).current;
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch('/bridge/calculations/travel-estimate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'destination', calculationId }), signal: controller.signal });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Nie udało się pobrać miejsca realizacji.');
        if (!controller.signal.aborted) {
          setSuggested(data.destination);
          if (!manuallyEdited.current) setDestination(data.destination?.label || '');
        }
      } catch (error) {
        if (!controller.signal.aborted) setContextError(error instanceof Error ? error.message : 'Wpisz cel ręcznie.');
      }
    })();
    return () => { controller.abort(); busyCallback.current(false); };
  }, [calculationId]);
  const invalidateRoute = () => { setRouteDirty(true); setRoute(null); onPendingChange(true); setMessage('Cel lub kierunek zmienił się. Oblicz trasę ponownie.'); };
  const apply = (result: TravelCalculatorResult) => {
    if (result.travelPlan === null && result.distanceKm === undefined) { invalidateRoute(); return; }
    const km = result.distanceKm ?? distance;
    const nextRoute = result.routeEstimate ?? route;
    if (result.routeEstimate) { setRoute(nextRoute); setRouteDirty(false); }
    if (result.distanceKm !== undefined) onApply({ distance: km });
    const fuel = result.fuelEstimate;
    const vat = Number(fuelVat);
    if (!fuel || !fuel.price || !fuel.consumption || !Number.isFinite(km) || km <= 0 || !fuelVat.trim() || !Number.isFinite(vat) || vat < 0 || vat > 100) {
      onPendingChange(true); setMessage('Uzupełnij spalanie, cenę paliwa i VAT paliwa, a następnie zastosuj koszt.'); return;
    }
    const rate = Math.round((fuel.consumption / 100 * fuel.price / (1 + vat / 100)) * 1e6) / 1e6;
    onApply({ distance: km, rate, estimate: {
      version: 1, origin, destination, fuel, fuel_vat_percent: vat,
      distance_km: km, rate_net_per_km: rate,
      fuel_cost_gross: Math.round(km * fuel.consumption / 100 * fuel.price * 100) / 100,
      route: nextRoute, applied_at: new Date().toISOString(),
    } });
    onPendingChange(false);
    setMessage(`Zastosowano ${km.toLocaleString('pl-PL')} km i ${rate.toLocaleString('pl-PL', { maximumFractionDigits: 6 })} zł netto/km. Liczba aut jest mnożona w pozycji kalkulacji.`);
  };
  return <div className="space-y-3">
    <VehicleTravelCalculator calculationId={calculationId} destination={manual ? destination : undefined}
      eventLocation={destination} vehicleId={vehicleId} vehicleFuelType={vehicleFuelType}
      origin={origin} distance={routeDirty ? '' : String(distance)} initialFuel={initial?.fuel}
      initialRoundTrip={initial?.route?.round_trip ?? true} onOriginChange={setOrigin}
      onBusyChange={changeBusy} onApply={apply}
      onSettingsChange={() => { onPendingChange(true); setMessage('Ustawienia paliwa zmieniły się. Kliknij „Zastosuj koszt”.'); }}
      destinationControls={<div className="space-y-3">
        <label className="block text-sm">Miejsce docelowe
          <input className={field} value={destination} maxLength={500} disabled={busy}
            placeholder="Nazwa obiektu, ulica, numer i miasto"
            onChange={event => { manuallyEdited.current = true; setManual(true); setDestination(event.target.value); invalidateRoute(); }} />
        </label>
        {suggested && <p className="text-xs text-white/60">Lokalizacja z {suggested.source === 'inquiry' ? 'zapytania' : 'wydarzenia'}: {suggested.label} {manual && <button type="button" disabled={busy} className="ml-2 text-[#d3bb73]" onClick={() => { manuallyEdited.current = false; setManual(false); setDestination(suggested.label); invalidateRoute(); }}>Użyj tej lokalizacji</button>}</p>}
        {contextError && <p role="status" className="text-xs text-amber-200">{contextError}</p>}
        <label className="block max-w-48 text-sm">VAT w cenie paliwa (%)
          <input type="number" min="0" max="100" step="0.01" className={field} value={fuelVat} disabled={busy} onChange={event => { setFuelVat(event.target.value); onPendingChange(true); setMessage('Zmieniono VAT paliwa. Zastosuj koszt ponownie.'); }} />
        </label>
      </div>} />
    <p className="text-xs text-white/60">Cena AutoCentrum jest brutto. Stawka paliwowa netto/km = spalanie ÷ 100 × cena litra brutto ÷ (1 + VAT paliwa ÷ 100). Obejmuje samo paliwo. Opłaty drogowe, wynajem i pracę kierowcy wyceń osobno lub uwzględnij we własnej stawce.</p>
    {message && <p role="status" className="text-xs text-[#d3bb73]">{message}</p>}
  </div>;
}
