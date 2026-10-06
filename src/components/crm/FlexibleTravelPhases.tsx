'use client';

import Link from 'next/link';
import VehicleTimelineTimes from './VehicleTimelineTimes';
import {
  useGetFlexibleTravelPhasesQuery,
  useSaveFlexibleTravelPhaseMutation,
  type EventPhase,
} from '@/store/api/eventPhasesApi';
import { flexibleTravelInterval, type TravelVehicle } from '@/lib/CRM/events/flexibleTravelPhases';
import { useDialog } from '@/contexts/DialogContext';
import { useSnackbar } from '@/contexts/SnackbarContext';

export default function FlexibleTravelPhases({
  eventId,
  vehicles,
  phases,
}: {
  eventId: string;
  vehicles: TravelVehicle[];
  phases: EventPhase[];
}) {
  const { data: templates = [], error } = useGetFlexibleTravelPhasesQuery(eventId, {
    refetchOnMountOrArgChange: true,
  });
  const [save, { isLoading }] = useSaveFlexibleTravelPhaseMutation();
  const { showConfirm } = useDialog();
  const { showSnackbar } = useSnackbar();
  if (error)
    return (
      <p role="alert" className="p-4 text-sm text-red-300">
        Nie udało się pobrać faz elastycznych. Odśwież timeline.
      </p>
    );
  if (!templates.length && !vehicles.some((v) => v.status !== 'cancelled')) return null;
  const active = vehicles.filter((vehicle) => vehicle.status !== 'cancelled');
  const date = (value: string) =>
    new Date(value).toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'short' });
  return (
    <section className="space-y-3 bg-white/5 p-4" aria-label="Fazy elastyczne z logistyki">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold uppercase text-[#d3bb73]">
          Fazy elastyczne · Logistyka
        </h3>
        <Link
          href={`/crm/events/${eventId}?tab=logistics`}
          className="text-sm text-[#d3bb73] underline"
        >
          Edytuj plan pojazdów
        </Link>
      </div>
      <p className="text-xs text-[#e5e4e2]/65">
        Godziny ustalasz tutaj. Czas jazdy pochodzi z Logistyki i obejmuje zapas, przerwy i
        zaokrąglenie do 15 minut w górę.
      </p>
      {active.map((vehicle) => (
        <VehicleTimelineTimes
          key={`${vehicle.id}:${JSON.stringify(vehicle.logistics_schedule)}:${JSON.stringify(vehicle.travel_plan)}`}
          vehicle={vehicle}
          eventId={eventId}
        />
      ))}
      {templates.map((template) => (
        <div key={template.key} className="rounded-lg bg-black/10 p-3">
          <div className="flex items-center justify-between gap-3">
            <strong className="text-sm text-[#e5e4e2]">{template.name}</strong>
            <button
              type="button"
              disabled={isLoading}
              className="text-xs text-[#e5e4e2]/60 hover:text-[#e5e4e2] disabled:opacity-50"
              onClick={async () => {
                if (
                  !(await showConfirm({
                    title: 'Usunąć fazę elastyczną?',
                    message: `Usunąć „${template.name}” z timeline? Plan i rezerwacje pojazdów pozostaną zapisane.`,
                    confirmText: 'Usuń',
                    cancelText: 'Anuluj',
                  }))
                )
                  return;
                try {
                  await save({ eventId, key: template.key, name: null }).unwrap();
                } catch (e: any) {
                  showSnackbar(e.message || 'Nie udało się usunąć fazy', 'error');
                }
              }}
            >
              Usuń
            </button>
          </div>
          {template.description && (
            <p className="mt-1 text-xs text-[#e5e4e2]/60">{template.description}</p>
          )}
          {!active.length && (
            <p className="mt-2 text-sm text-[#d3bb73]">Oczekuje na plan pojazdu w Logistyce.</p>
          )}
          {active.map((vehicle) => {
            const interval = flexibleTravelInterval(template.key, vehicle, phases);
            return (
              <div
                key={vehicle.id}
                className="mt-2 flex flex-wrap justify-between gap-2 text-sm text-[#e5e4e2]"
              >
                <span>
                  {vehicle.vehicles?.name ||
                    vehicle.vehicle?.name ||
                    vehicle.external_company_name ||
                    'Pojazd'}
                </span>
                {interval.reason ? (
                  <span className="text-[#d3bb73]">{interval.reason}</span>
                ) : (
                  <time>
                    {date(interval.start!)} → {date(interval.end!)}
                  </time>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </section>
  );
}
