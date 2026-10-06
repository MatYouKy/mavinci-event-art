import { uniquePhaseTypes } from './uniquePhaseTypes';
import type { EventPhase, EventPhaseType } from '@/store/api/eventPhasesApi';

const normalize = (name: string) => name.trim().toLocaleLowerCase('pl-PL');
const ranks: Record<string, number> = {
  załadunek: 1,
  dojazd: 2,
  montaż: 3,
  gotowość: 3.5,
  realizacja: 4,
  demontaż: 5,
  powrót: 6,
  rozładunek: 7,
};
export const phaseRank = (type: Pick<EventPhaseType, 'name' | 'sequence_priority'>) =>
  ranks[normalize(type.name)] ?? type.sequence_priority;
export const isWarehousePhase = (phase: EventPhase) =>
  ['załadunek', 'rozładunek'].includes(normalize(phase.phase_type?.name || phase.name));
const duration = (type: EventPhaseType) => Number(type.default_duration_hours) * 3600000;

/** Anchor preparation backwards and teardown forwards around the actual realization. */
export function suggestPhaseTimes(
  type: EventPhaseType,
  types: EventPhaseType[],
  phases: EventPhase[],
  eventStart: string,
  eventEnd: string,
) {
  types = uniquePhaseTypes(types.filter((t) => t.is_active !== false));
  const rank = phaseRank(type);
  const ranked = phases
    .map((phase) => ({
      start: Date.parse(phase.start_time),
      end: Date.parse(phase.end_time),
      rank: phaseRank(
        phase.phase_type ||
          types.find((t) => t.id === phase.phase_type_id) || {
            name: phase.name,
            sequence_priority: 4,
          },
      ),
    }))
    .filter((p) => Number.isFinite(p.start) && Number.isFinite(p.end) && p.end > p.start);
  const realization = ranked.filter((p) => p.rank === 4);
  const start = realization.length
    ? Math.min(...realization.map((p) => p.start))
    : Date.parse(eventStart);
  let end = realization.length ? Math.max(...realization.map((p) => p.end)) : Date.parse(eventEnd);
  if (!Number.isFinite(start)) return null;
  if (!Number.isFinite(end)) end = start + duration(types.find((t) => phaseRank(t) === 4) || type);
  // An end clock earlier on the same date denotes an overnight event.
  if (end <= start) {
    const nextDay = new Date(end);
    nextDay.setDate(nextDay.getDate() + 1);
    end = nextDay.getTime();
  }
  const anchors = [...ranked, { rank: 4, start, end }];
  const gap = (from: number, to: number) =>
    types
      .filter((t) => t.is_active !== false && phaseRank(t) > from && phaseRank(t) < to)
      .reduce((sum, t) => sum + duration(t), 0);
  let suggestedStart: number;
  let suggestedEnd: number;
  if (rank < 4) {
    const next = anchors
      .filter((p) => p.rank > rank)
      .sort((a, b) => a.rank - b.rank || a.start - b.start)[0];
    suggestedEnd = next.start - gap(rank, next.rank);
    suggestedStart = suggestedEnd - duration(type);
  } else if (rank > 4) {
    const previous = anchors
      .filter((p) => p.rank < rank)
      .sort((a, b) => b.rank - a.rank || b.end - a.end)[0];
    suggestedStart = previous.end + gap(previous.rank, rank);
    suggestedEnd = suggestedStart + duration(type);
  } else {
    suggestedStart = start;
    suggestedEnd = end;
  }
  if (!Number.isFinite(suggestedStart) || !Number.isFinite(suggestedEnd)) return null;
  return {
    start: new Date(suggestedStart).toISOString(),
    end: new Date(suggestedEnd).toISOString(),
  };
}
