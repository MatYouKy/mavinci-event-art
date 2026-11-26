'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import {
  RENTAL_TRIP_LABELS,
  rentalDateTime,
  rentalErrorMessage,
  rentalIsoFromLocal,
  rentalLocalInput,
  rentalVehicleConflicts,
  setRentalTrips,
  type RentalDetail,
  type RentalTripKind,
  type RentalVehicleConflict,
} from '@/lib/CRM/rental/rental';
import { RentalError, RentalField, RentalModal, rentalButton, rentalInput, rentalPrimaryButton } from './rentalUi';

/*
 * Dostawa do klienta i odbiór od klienta: pojazd z floty, kierowca, godziny. Od rezerwacji wypożyczenia pojazd jest zajęty
 * (eventy go nie dostaną); konflikty z eventami i innymi wypożyczeniami widać przed zapisem.
 */

type Option = { id: string; name: string };
type Trip = { enabled: boolean; vehicle: string; driver: string; start: string; end: string; note: string; conflicts: RentalVehicleConflict[] };

const shift = (iso: string, hours: number) => new Date(new Date(iso).getTime() + hours * 3_600_000).toISOString();

export default function RentalTripsModal({ rental, onClose, onSaved }: { rental: RentalDetail; onClose: () => void; onSaved: (rental: RentalDetail) => void }) {
  const { showSnackbar } = useSnackbar();
  const initial = (kind: RentalTripKind): Trip => {
    const trip = rental.trips.find((item) => item.kind === kind);
    const anchor = kind === 'delivery' ? rental.starts_at : rental.ends_at;
    return {
      enabled: Boolean(trip) || rental.handover === 'delivery',
      vehicle: trip?.vehicle_id || '',
      driver: trip?.driver_id || '',
      start: rentalLocalInput(trip?.starts_at || shift(anchor, kind === 'delivery' ? -2 : 0)),
      end: rentalLocalInput(trip?.ends_at || shift(anchor, kind === 'delivery' ? 0 : 2)),
      note: trip?.note || '',
      conflicts: [],
    };
  };
  const [trips, setTrips] = useState<Record<RentalTripKind, Trip>>({ delivery: initial('delivery'), collection: initial('collection') });
  const [vehicles, setVehicles] = useState<Option[]>([]);
  const [drivers, setDrivers] = useState<Option[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const [vehicleRows, employeeRows] = await Promise.all([
        supabase.from('vehicles').select('id, name, registration_number, status').order('name'),
        supabase.from('employees').select('id, name, surname').eq('is_active', true).order('name'),
      ]);
      if (!alive) return;
      setVehicles(((vehicleRows.data || []) as any[]).filter((row) => !row.status || row.status === 'active')
        .map((row) => ({ id: String(row.id), name: [row.name, row.registration_number].filter(Boolean).join(' · ') })));
      setDrivers(((employeeRows.data || []) as any[]).map((row) => ({ id: String(row.id), name: `${row.name || ''} ${row.surname || ''}`.trim() })));
    })();
    return () => {
      alive = false;
    };
  }, []);

  const deliveryKey = `${trips.delivery.enabled}|${trips.delivery.vehicle}|${trips.delivery.start}|${trips.delivery.end}`;
  const collectionKey = `${trips.collection.enabled}|${trips.collection.vehicle}|${trips.collection.start}|${trips.collection.end}`;
  useEffect(() => {
    let alive = true;
    const timer = setTimeout(async () => {
      for (const kind of ['delivery', 'collection'] as RentalTripKind[]) {
        const trip = trips[kind];
        const start = rentalIsoFromLocal(trip.start);
        const end = rentalIsoFromLocal(trip.end);
        let conflicts: RentalVehicleConflict[] = [];
        if (trip.enabled && trip.vehicle && start && end && new Date(end) > new Date(start)) {
          try {
            conflicts = await rentalVehicleConflicts(supabase, trip.vehicle, start, end, rental.id);
          } catch {
            conflicts = [];
          }
        }
        if (alive) setTrips((current) => ({ ...current, [kind]: { ...current[kind], conflicts } }));
      }
    }, 400);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deliveryKey, collectionKey, rental.id]);

  const update = (kind: RentalTripKind, patch: Partial<Trip>) => setTrips((current) => ({ ...current, [kind]: { ...current[kind], ...patch } }));

  const submit = async () => {
    setError(null);
    const payload = [];
    for (const kind of ['delivery', 'collection'] as RentalTripKind[]) {
      const trip = trips[kind];
      if (!trip.enabled) continue;
      const start = rentalIsoFromLocal(trip.start);
      const end = rentalIsoFromLocal(trip.end);
      if (!start || !end || new Date(end) <= new Date(start)) return setError(`${RENTAL_TRIP_LABELS[kind]}: podaj godziny (koniec po początku).`);
      payload.push({ kind, vehicle_id: trip.vehicle || null, driver_id: trip.driver || null, starts_at: start, ends_at: end, note: trip.note.trim() || null });
    }
    setSaving(true);
    try {
      const saved = await setRentalTrips(supabase, rental.id, payload);
      showSnackbar('Zapisano dostawę i odbiór', 'success');
      onSaved(saved);
    } catch (failure) {
      setError(rentalErrorMessage(failure));
    } finally {
      setSaving(false);
    }
  };

  return (
    <RentalModal
      title="Dostawa i odbiór"
      subtitle={`${rental.number}${rental.delivery_address ? ` · ${rental.delivery_address}` : ''}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={rentalButton} onClick={onClose} disabled={saving}>Anuluj</button>
          <button type="button" className={rentalPrimaryButton} onClick={submit} disabled={saving}>{saving ? 'Zapisywanie…' : 'Zapisz'}</button>
        </>
      }
    >
      <div className="space-y-5">
        <RentalError message={error} />
        {(['delivery', 'collection'] as RentalTripKind[]).map((kind) => {
          const trip = trips[kind];
          return (
            <div key={kind} className="space-y-3 rounded-xl border border-white/10 p-3">
              <label className="flex items-center gap-2 text-sm font-medium text-[#e5e4e2]">
                <input type="checkbox" checked={trip.enabled} onChange={(event) => update(kind, { enabled: event.target.checked })} />
                {RENTAL_TRIP_LABELS[kind]}
              </label>
              {trip.enabled && (
                <>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <RentalField label="Pojazd" hint={vehicles.length === 0 ? 'Lista pojazdów wymaga dostępu do Floty.' : undefined}>
                      <select value={trip.vehicle} onChange={(event) => update(kind, { vehicle: event.target.value })} className={rentalInput}>
                        <option value="">Bez pojazdu z floty</option>
                        {vehicles.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.name}</option>)}
                      </select>
                    </RentalField>
                    <RentalField label="Kierowca">
                      <select value={trip.driver} onChange={(event) => update(kind, { driver: event.target.value })} className={rentalInput}>
                        <option value="">Nie wybrano</option>
                        {drivers.map((driver) => <option key={driver.id} value={driver.id}>{driver.name}</option>)}
                      </select>
                    </RentalField>
                    <RentalField label="Od">
                      <input type="datetime-local" value={trip.start} onChange={(event) => update(kind, { start: event.target.value })} className={rentalInput} />
                    </RentalField>
                    <RentalField label="Do">
                      <input type="datetime-local" value={trip.end} onChange={(event) => update(kind, { end: event.target.value })} className={rentalInput} />
                    </RentalField>
                  </div>
                  <RentalField label="Uwagi">
                    <input value={trip.note} onChange={(event) => update(kind, { note: event.target.value })} className={rentalInput} />
                  </RentalField>
                  {trip.conflicts.length > 0 && (
                    <div className="rounded-lg border border-amber-400/30 bg-amber-400/10 p-3 text-sm text-amber-100">
                      <p className="flex items-center gap-2 font-medium"><AlertTriangle className="h-4 w-4" />Pojazd jest zajęty w tym czasie</p>
                      <ul className="mt-1 space-y-0.5 text-xs">
                        {trip.conflicts.map((conflict) => (
                          <li key={`${conflict.type}-${conflict.id}-${conflict.starts_at}`}>
                            {conflict.type === 'event' ? 'Event' : 'Wypożyczenie'}: {conflict.name} · {rentalDateTime(conflict.starts_at)}{conflict.ends_at ? ` – ${rentalDateTime(conflict.ends_at)}` : ''}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </>
              )}
            </div>
          );
        })}
        <p className="text-xs text-[#e5e4e2]/45">Pojazd zarezerwowanego lub wydanego wypożyczenia jest zajęty w tych godzinach — eventy go nie dostaną.</p>
      </div>
    </RentalModal>
  );
}
