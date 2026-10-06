import { localDatetimeStringToUTC } from '@/lib/utils/dateTimeUtils';

type Phase = { id: string; name: string; start_time: string; end_time: string };
type ScheduleForm = {
  independent_schedule: boolean;
  phase_from_id: string;
  phase_to_id: string;
  pickup_time: string;
  return_time: string;
};

// These are stages of an individual vehicle journey, not new event phases.
export function vehicleBoundaryOptions(phases: Phase[], side: 'pickup' | 'return'): Phase[] {
  const stages =
    side === 'pickup'
      ? [
          ['loading', 'Załadunek'],
          ['outbound', 'Dojazd'],
        ]
      : [
          ['teardown', 'Demontaż'],
          ['inbound', 'Powrót'],
          ['unloading', 'Rozładunek'],
        ];
  return [
    ...stages.map(([id, name]) => ({
      id: `local:${id}`,
      name: `${name} — termin tego auta`,
      start_time: '',
      end_time: '',
    })),
    ...phases,
  ];
}

// A single resolver feeds the driver check, vehicle check, summary and save.
// Never fall back to event dates when a custom boundary is incomplete.
export function resolveVehiclePhases(phases: Phase[], form: ScheduleForm): Phase[] {
  if (!form.independent_schedule) return phases;
  if (!form.pickup_time || !form.return_time) return [];
  const result: Phase[] = [];
  for (const [side, id, time] of [
    ['pickup', form.phase_from_id, form.pickup_time],
    ['return', form.phase_to_id, form.return_time],
  ] as const) {
    const option = vehicleBoundaryOptions(phases, side).find((p) => p.id === id);
    const timestamp = time ? localDatetimeStringToUTC(time) : null;
    if (!option || !timestamp || !Number.isFinite(Date.parse(timestamp))) return [];
    const existing = result.find((p) => p.id === id);
    if (existing) existing.end_time = timestamp;
    else result.push({ ...option, start_time: timestamp, end_time: timestamp });
  }
  return result;
}
