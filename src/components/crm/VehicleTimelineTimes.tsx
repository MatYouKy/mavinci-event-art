'use client';
import { useState } from 'react';
import { supabase } from '@/lib/supabase/browser';
import { useAppDispatch } from '@/store/hooks';
import { eventPhasesApi } from '@/store/api/eventPhasesApi';
import { eventsApi } from '@/app/(crm)/crm/events/store/api/eventsApi';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { utcToLocalDatetimeString, localDatetimeStringToUTC } from '@/lib/utils/dateTimeUtils';
import type { TravelVehicle } from '@/lib/CRM/events/flexibleTravelPhases';

export default function VehicleTimelineTimes({
  vehicle,
  eventId,
}: {
  vehicle: TravelVehicle;
  eventId: string;
}) {
  const schedule = vehicle.logistics_schedule;
  const [outbound, setOutbound] = useState(
    utcToLocalDatetimeString(schedule?.outbound_start) || '',
  );
  const [inbound, setInbound] = useState(utcToLocalDatetimeString(schedule?.inbound_start) || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const dispatch = useAppDispatch();
  const { showSnackbar } = useSnackbar();
  const name =
    vehicle.vehicles?.name || vehicle.vehicle?.name || vehicle.external_company_name || 'Pojazd';
  const fields = [
    {
      key: 'outbound',
      label: 'Dojazd',
      value: outbound,
      set: setOutbound,
      leg: vehicle.travel_plan?.outbound,
    },
    {
      key: 'inbound',
      label: 'Powrót',
      value: inbound,
      set: setInbound,
      leg: vehicle.travel_plan?.inbound,
    },
  ];
  return (
    <form
      className="space-y-3 rounded-lg bg-black/10 p-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (saving) return;
        setSaving(true);
        setError('');
        try {
          const { error: failure } = await supabase.rpc('schedule_vehicle_travel', {
            p_event_vehicle_id: vehicle.id,
            p_outbound_start: outbound ? localDatetimeStringToUTC(outbound) : null,
            p_inbound_start: inbound ? localDatetimeStringToUTC(inbound) : null,
          });
          if (failure) throw failure;
          dispatch(eventPhasesApi.util.invalidateTags([{ type: 'Phases', id: eventId }]));
          dispatch(
            eventsApi.util.invalidateTags([
              { type: 'EventVehicles', id: eventId },
              { type: 'EventLogistics', id: eventId },
            ]),
          );
          showSnackbar('Godziny przejazdów zapisane.', 'success');
        } catch (failure: any) {
          setError(failure.message || 'Nie udało się zapisać godzin.');
        } finally {
          setSaving(false);
        }
      }}
    >
      <strong className="text-sm">{name}</strong>
      <div className="grid gap-3 md:grid-cols-2">
        {fields.map((field) => {
          const duration = field.leg?.plannedMinutes;
          const end =
            field.value && duration
              ? new Date(Date.parse(localDatetimeStringToUTC(field.value)!) + duration * 60000)
              : null;
          return (
            <label key={field.key} className="block text-sm">
              {field.label} — rozpoczęcie
              <input
                type="datetime-local"
                disabled={saving || !duration}
                value={field.value}
                onChange={(e) => field.set(e.target.value)}
                className="mt-1 w-full rounded-lg border border-white/10 bg-[#250914] p-2"
              />
              <span className="mt-1 block text-xs text-[#d3bb73]">
                {duration
                  ? `Czas z logistyki: ${duration} min (przerwy: ${field.leg?.breakMinutes || 0} min, zapas: ${field.leg?.bufferMinutes || 0} min).`
                  : 'Najpierw oblicz i zapisz trasę w Logistyce.'}
              </span>
              {end && Number.isFinite(end.getTime()) && (
                <span className="block text-xs">
                  Koniec: {end.toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'short' })}
                </span>
              )}
            </label>
          );
        })}
      </div>
      {error && (
        <p role="alert" className="text-sm text-red-300">
          {error}
        </p>
      )}
      <button
        disabled={saving || (!outbound && !inbound)}
        className="rounded-lg bg-[#d3bb73] px-3 py-2 text-sm text-[#250914] disabled:opacity-50"
      >
        {saving ? 'Zapisywanie…' : 'Zapisz godziny przejazdów'}
      </button>
    </form>
  );
}
