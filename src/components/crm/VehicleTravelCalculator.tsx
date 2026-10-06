'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { planTravelLeg, recalculateLeg, type TravelPlan } from '@/lib/CRM/events/travelPlan';
import { supabase } from '@/lib/supabase/browser';
import {
  averageFuelConsumption,
  calculateFuelCost,
  FUEL_TYPES,
  type FuelPrices,
  type FuelType,
} from '@/lib/CRM/events/travelEstimate';

const field =
  'w-full rounded-lg border border-white/10 bg-[var(--brand-burgundy-950)] px-3 py-2 text-sm text-[var(--brand-platinum)] outline-none focus:border-[var(--app-field-border-focus)]';
const button =
  'rounded-lg bg-[var(--brand-burgundy-750)] px-3 py-2 text-sm text-[var(--brand-platinum)] disabled:opacity-50';
export type PriceQuote = { prices: FuelPrices; source: string; sourceUpdated: string; fetchedAt: string };
export type RouteEstimate = {
  origin?: string; location_id?: string | null; source?: string; round_trip?: boolean; calculated_at?: string;
  distanceKm: number;
  travelMinutes: number;
  destination: string;
  outbound: {
    distanceMeters: number;
    durationSeconds: number;
    startAddress: string;
    endAddress: string;
  };
  inbound: { distanceMeters: number; durationSeconds: number } | null;
};

export type FuelEstimateSnapshot = {
  fuel_type: string; price: number | null; consumption: number | null;
  price_source: 'manual' | 'autocentrum'; quote: PriceQuote | null;
};
export type TravelCalculatorResult = {
  distanceKm?: number; travelMinutes?: number; travelPlan?: TravelPlan | null;
  fuelCost?: number | null; fuelEstimate?: FuelEstimateSnapshot; routeEstimate?: RouteEstimate;
};

export default function VehicleTravelCalculator({
  eventId,
  offerId, locationId, destinationControls, initialFuel, initialRoundTrip = true,
  eventLocation,
  vehicleId,
  vehicleFuelType,
  origin,
  distance,
  onOriginChange,
  onApply,
  onBusyChange,
  travelPlan,
}: {
  travelPlan?: TravelPlan | null;
  eventId?: string;
  offerId?: string; locationId?: string | null; destinationControls?: ReactNode;
  initialFuel?: FuelEstimateSnapshot; initialRoundTrip?: boolean;
  eventLocation: string;
  vehicleId: string;
  vehicleFuelType?: string;
  origin: string;
  distance: string;
  onOriginChange: (value: string) => void;
  onApply: (value: TravelCalculatorResult) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const [roundTrip, setRoundTrip] = useState(initialRoundTrip);
  const [fuelOverride, setFuelOverride] = useState<{ vehicleId: string; value: string } | null>(
    null,
  );
  const fuelType =
    fuelOverride?.vehicleId === vehicleId ? fuelOverride.value : vehicleFuelType || initialFuel?.fuel_type || 'diesel';
  const isLiquidFuel = FUEL_TYPES.some((fuel) => fuel.value === fuelType);
  const [manualPrices, setManualPrices] = useState<Record<string, string>>(() => initialFuel?.price != null && initialFuel.price_source !== 'autocentrum' ? { [initialFuel.fuel_type]: String(initialFuel.price) } : {});
  const [manualConsumption, setManualConsumption] = useState<Record<string, string>>(() => initialFuel?.consumption != null ? { [vehicleId]: String(initialFuel.consumption) } : {});
  const [history, setHistory] = useState<{
    vehicleId: string;
    value: number | null;
    error?: string;
  } | null>(null);
  const [quote, setQuote] = useState<PriceQuote | null>(initialFuel?.quote || null);
  const [fuelError, setFuelError] = useState('');
  const [priceLoading, setPriceLoading] = useState(false);
  const [priceRefresh, setPriceRefresh] = useState(0);
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeError, setRouteError] = useState('');
  const [route, setRoute] = useState<RouteEstimate | null>(null);
  const mounted = useRef(true);
  const routeController = useRef<AbortController | null>(null);
  const price = manualPrices[fuelType] ?? quote?.prices[fuelType as FuelType]?.toString() ?? '';
  const consumption =
    manualConsumption[vehicleId] ??
    (history?.vehicleId === vehicleId ? history.value?.toString() : '') ??
    '';
  const cost =
    isLiquidFuel && distance.trim()
      ? calculateFuelCost(Number(distance), Number(consumption), Number(price))
      : null;

  const endpoint = offerId ? '/bridge/offers/travel-estimate' : '/bridge/events/travel-estimate';
  const fuelSnapshot = (): FuelEstimateSnapshot => ({ fuel_type: fuelType, price: Number(price) > 0 ? Number(price) : null, consumption: Number(consumption) > 0 ? Number(consumption) : null, price_source: manualPrices[fuelType] !== undefined ? 'manual' : 'autocentrum', quote: manualPrices[fuelType] !== undefined ? null : quote });

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      routeController.current?.abort();
    };
  }, []);

  useEffect(() => {
    let active = true;
    if (!vehicleId) return;
    const from = new Date();
    from.setDate(from.getDate() - 90);
    void (async () => {
      const { data, error } = await supabase
        .from('fuel_entries')
        .select('avg_consumption,distance_since_last')
        .eq('vehicle_id', vehicleId)
        .gte('date', from.toISOString().slice(0, 10))
        .lte('date', new Date().toISOString().slice(0, 10))
        .gt('avg_consumption', 0)
        .gt('distance_since_last', 0);
      if (active)
        setHistory({
          vehicleId,
          value: error ? null : averageFuelConsumption(data || []),
          error: error
            ? 'Nie udało się pobrać historii tankowań. Wpisz spalanie ręcznie.'
            : undefined,
        });
    })();
    return () => {
      active = false;
    };
  }, [vehicleId]);

  useEffect(() => {
    const controller = new AbortController();
    setPriceLoading(true);
    setFuelError('');
    void (async () => {
      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'fuel', eventId, offerId }),
          signal: controller.signal,
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Nie udało się pobrać cen paliw.');
        if (!controller.signal.aborted) setQuote(data);
      } catch (error) {
        if (!controller.signal.aborted) {
          setQuote(null);
          setFuelError(error instanceof Error ? error.message : 'Wpisz cenę paliwa ręcznie.');
        }
      } finally {
        if (!controller.signal.aborted) setPriceLoading(false);
      }
    })();
    return () => controller.abort();
  }, [eventId, offerId, endpoint, priceRefresh]);

  useEffect(() => {
    routeController.current?.abort();
    setRouteLoading(false);
    setRoute(null);
    setRouteError('');
    onBusyChange(false);
  }, [vehicleId, vehicleFuelType, eventId, offerId, locationId, eventLocation, onBusyChange]);

  async function calculateRoute() {
    if (routeLoading) return;
    routeController.current?.abort();
    const controller = new AbortController();
    routeController.current = controller;
    setRouteLoading(true);
    onBusyChange(true);
    setRouteError('');
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'route', eventId, offerId, locationId, origin, roundTrip }),
        signal: controller.signal,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Nie udało się wyznaczyć trasy.');
      if (!mounted.current || controller.signal.aborted) return;
      const calculated = data as RouteEstimate;
      const fuelCost = isLiquidFuel
        ? calculateFuelCost(calculated.distanceKm, Number(consumption), Number(price))
        : null;
      const plan: TravelPlan = {
        origin,
        destination: calculated.destination,
        calculatedAt: new Date().toISOString(),
        outbound: planTravelLeg(calculated.outbound.durationSeconds),
        inbound: calculated.inbound ? planTravelLeg(calculated.inbound.durationSeconds) : null,
      };
      setRoute(calculated);
      onApply({
        distanceKm: calculated.distanceKm,
        travelMinutes: plan.outbound.plannedMinutes,
        travelPlan: plan,
        fuelCost, fuelEstimate: fuelSnapshot(), routeEstimate: calculated,
      });
    } catch (error) {
      if (mounted.current && !controller.signal.aborted)
        setRouteError(error instanceof Error ? error.message : 'Nie udało się obliczyć trasy.');
    } finally {
      if (mounted.current && !controller.signal.aborted) {
        setRouteLoading(false);
        onBusyChange(false);
      }
    }
  }

  return (
    <section className="space-y-4 rounded-xl border border-white/10 bg-[var(--brand-burgundy-800)] p-4">
      <h3 className="text-base text-[var(--brand-platinum)]">Trasa i koszt paliwa</h3>
      {travelPlan && !offerId && (
        <div className="space-y-3 rounded-lg bg-white/5 p-3 text-sm">
          <p>
            Czas do harmonogramu: jazda z Google Maps + zapas + przerwy. Zapas: 20%, minimum 15 min.
            Przerwy: 15 min po każdych 2 h jazdy. Możesz zmienić plan poniżej.
          </p>
          {(['outbound', 'inbound'] as const).map((direction) => {
            const leg = travelPlan[direction];
            if (!leg) return null;
            return (
              <div key={direction}>
                <p className="font-medium text-[#d3bb73]">
                  {direction === 'outbound' ? 'Dojazd' : 'Powrót'}: {leg.plannedMinutes} min · jazda{' '}
                  {leg.baseMinutes} min
                </p>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  {(['bufferMinutes', 'breakMinutes'] as const).map((key) => (
                    <label key={key}>
                      {key === 'bufferMinutes' ? 'Zapas (min)' : 'Przerwy (min)'}
                      <input
                        type="number"
                        min="0"
                        max="1440"
                        className={field}
                        value={leg[key]}
                        disabled={routeLoading}
                        onChange={(e) => {
                          const value = Number(e.target.value);
                          if (!Number.isFinite(value) || value < 0 || value > 1440) return;
                          const next = {
                            ...travelPlan,
                            [direction]: recalculateLeg({ ...leg, [key]: value }),
                          };
                          onApply({
                            travelPlan: next,
                            travelMinutes: next.outbound.plannedMinutes,
                          });
                        }}
                      />
                    </label>
                  ))}
                </div>
              </div>
            );
          })}
          <p className="text-xs opacity-60">
            Plan to zapas organizacyjny, nie gwarancja czasu przejazdu. Po przeliczeniu zapisz
            pojazd: istniejące fazy Dojazd i Powrót oraz powiązane godziny Załadunku, Rozładunku
            i rezerwacji auta zostaną zaktualizowane. Montaż i realizacja pozostają bez zmian.
            Przy kilku pojazdach wspólne fazy uwzględniają najdłuższy czas trasy.
          </p>
        </div>
      )}

      <label className="text-[var(--brand-platinum)]/80 block text-sm">
        Miejsce startu
        <input
          className={`${field} mt-2`}
          value={origin}
          disabled={routeLoading}
          onChange={(event) => {
            onOriginChange(event.target.value);
            onApply({ travelPlan: null });
            setRoute(null);
          }}
        />
      </label>
      <p className="text-[var(--brand-platinum)]/70 text-sm">
        {offerId ? 'Cel realizacji:' : 'Cel z zakładki Przegląd:'} {eventLocation || 'Brak lokalizacji — uzupełnij ją w Przeglądzie.'}
      </p>
      {destinationControls}
      <label className="flex items-center gap-2 text-sm text-[var(--brand-platinum)]">
        <input
          type="checkbox"
          checked={roundTrip}
          disabled={routeLoading}
          className="accent-[var(--brand-gold)]"
          onChange={(event) => {
            setRoundTrip(event.target.checked);
            onApply({ travelPlan: null });
            setRoute(null);
          }}
        />
        Uwzględnij powrót do miejsca startu
      </label>
      <div className="grid gap-3 md:grid-cols-3">
        <label className="text-[var(--brand-platinum)]/80 text-sm">
          Paliwo
          <select
            className={`${field} mt-2`}
            value={fuelType}
            disabled={routeLoading}
            onChange={(event) => setFuelOverride({ vehicleId, value: event.target.value })}
          >
            {FUEL_TYPES.map((fuel) => (
              <option key={fuel.value} value={fuel.value}>
                {fuel.label}
              </option>
            ))}
            {!offerId && <><option value="elektryczny">Elektryczny</option><option value="other">Inne</option></>}
            {!isLiquidFuel && !['elektryczny', 'other'].includes(fuelType) && (
              <option value={fuelType}>{fuelType}</option>
            )}
          </select>
        </label>
        <label className="text-[var(--brand-platinum)]/80 text-sm">
          Średnie spalanie (l/100 km)
          <input
            type="number"
            min="0.01"
            step="0.01"
            className={`${field} mt-2`}
            value={consumption}
            disabled={!isLiquidFuel || routeLoading}
            placeholder="Uzupełnij spalanie"
            onChange={(event) =>
              setManualConsumption((previous) => ({ ...previous, [vehicleId]: event.target.value }))
            }
          />
        </label>
        <label className="text-[var(--brand-platinum)]/80 text-sm">
          Cena paliwa (zł/l)
          <input
            type="number"
            min="0.01"
            step="0.01"
            className={`${field} mt-2`}
            value={isLiquidFuel ? price : ''}
            disabled={!isLiquidFuel || routeLoading}
            placeholder={priceLoading ? 'Pobieranie…' : 'Uzupełnij cenę'}
            onChange={(event) =>
              setManualPrices((previous) => ({ ...previous, [fuelType]: event.target.value }))
            }
          />
        </label>
      </div>
      {isLiquidFuel ? (
        <>
          <p className="text-[var(--brand-platinum)]/60 text-xs">
            {manualConsumption[vehicleId] !== undefined
              ? 'Spalanie wpisane ręcznie.'
              : history?.vehicleId === vehicleId && history.value
                ? 'Spalanie z tankowań z ostatnich 90 dni, ważone przejechanym dystansem. Możesz je skorygować, np. dla jazdy z przyczepą.'
                : history?.vehicleId === vehicleId && history.error
                  ? history.error
                  : 'Jeśli brakuje historii tankowań, wpisz średnie spalanie auta.'}
          </p>
          <div className="text-[var(--brand-platinum)]/60 flex flex-wrap items-center gap-2 text-xs">
            {manualPrices[fuelType] !== undefined ? (
              <span>Cena wpisana ręcznie.</span>
            ) : quote && quote.prices[fuelType as FuelType] ? (
              <span>
                Średnia krajowa:{' '}
                <a
                  href={quote.source}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[var(--brand-gold)] underline"
                >
                  AutoCentrum.pl
                </a>
                . Aktualizacja źródła: {quote.sourceUpdated} w chwili pobrania (
                {new Date(quote.fetchedAt).toLocaleString('pl-PL')}).
              </span>
            ) : (
              <span>
                {priceLoading
                  ? 'Pobieranie cen paliw…'
                  : 'Brak ceny dla wybranego paliwa — wpisz ją ręcznie.'}
              </span>
            )}
            <button
              type="button"
              className={button}
              disabled={priceLoading || routeLoading}
              onClick={() => {
                setManualPrices((previous) => {
                  const next = { ...previous };
                  delete next[fuelType];
                  return next;
                });
                setPriceRefresh((value) => value + 1);
              }}
            >
              Pobierz cenę
            </button>
          </div>
          {fuelError && (
            <p role="status" className="text-xs text-amber-300">
              {fuelError}
            </p>
          )}
        </>
      ) : (
        <p className="text-[var(--brand-platinum)]/60 text-xs">
          Dla tego napędu uzupełnij koszt energii lub paliwa ręcznie w polu kosztu poniżej.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={routeLoading || !origin.trim() || (!!offerId && !eventLocation)}
          onClick={calculateRoute}
          className="rounded-lg bg-[var(--brand-gold)] px-4 py-2 text-sm font-medium text-[var(--brand-burgundy-950)] disabled:opacity-50"
        >
          {routeLoading ? 'Obliczanie trasy…' : 'Oblicz trasę i koszt'}
        </button>
        {cost !== null && (
          <button
            type="button"
            className={button}
            disabled={routeLoading}
            onClick={() => onApply({ fuelCost: cost, fuelEstimate: fuelSnapshot() })}
          >
            Zastosuj koszt: {cost.toFixed(2)} zł
          </button>
        )}
      </div>
      {routeError && (
        <p role="alert" className="text-sm text-red-300">
          {routeError}
        </p>
      )}
      {route && Number(distance) === route.distanceKm && (
        <div className="text-[var(--brand-platinum)]/70 space-y-1 text-xs">
          <p>
            {route.outbound.startAddress} → {route.outbound.endAddress}
          </p>
          <p>
            Dojazd: {(route.outbound.distanceMeters / 1000).toFixed(1)} km · {route.travelMinutes}{' '}
            min
            {route.inbound &&
              ` · Powrót: ${(route.inbound.distanceMeters / 1000).toFixed(1)} km · ${Math.ceil(route.inbound.durationSeconds / 60)} min`}{' '}
            · Łącznie: {route.distanceKm.toFixed(1)} km
          </p>
          <a
            className="text-[var(--brand-gold)] underline"
            target="_blank"
            rel="noreferrer"
            href={`https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(route.outbound.startAddress)}&destination=${encodeURIComponent(route.outbound.endAddress)}&travelmode=driving`}
          >
            Google Maps — zobacz dojazd
          </a>
        </div>
      )}
      <p className="text-[var(--brand-platinum)]/50 text-xs">
        Koszt = łączny dystans × spalanie / 100 × cena litra. Po korekcie spalania lub ceny kliknij
        „Zastosuj koszt”. {offerId ? 'Dystans i koszt zapiszesz przyciskiem „Zapisz logistykę”. Cena AutoCentrum jest ceną brutto; do szacunku przyjmujemy pełny wydatek na paliwo.' : 'Dystans i koszt zapiszesz razem z pojazdem.'}
      </p>
    </section>
  );
}
