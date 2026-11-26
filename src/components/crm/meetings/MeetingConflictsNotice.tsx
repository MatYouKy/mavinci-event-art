'use client';

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import {
  conflictHeadline,
  conflictText,
  meetingConflicts,
  type AvailabilityBlock,
} from '@/lib/CRM/meetings/teamAvailability';
import { fetchAvailability } from './teamAvailabilityApi';

/**
 * Ostrzeżenie w formularzu spotkania (jak „Asystent planowania” w Teams): kto z uczestników z firmy ma już w tym czasie
 * spotkanie, event, fazę albo nieobecność. Nie blokuje zapisu. Szczegóły według zakresu planu (`get_team_availability`):
 * osoby spoza zakresu — tylko „Zajęty”. Edytowane spotkanie się nie liczy (`excludeMeetingId`).
 */
export default function MeetingConflictsNotice({
  employeeIds,
  start,
  end,
  excludeMeetingId,
  names,
}: {
  employeeIds: string[];
  /** ISO — początek i koniec terminu (null — termin niepełny). */
  start: string | null;
  end: string | null;
  excludeMeetingId?: string | null;
  /** Nazwy osób do ostrzeżenia (bieżący pracownik — „Ty”). */
  names: Record<string, string>;
}) {
  const [blocks, setBlocks] = useState<AvailabilityBlock[]>([]);
  const [loading, setLoading] = useState(false);
  const key = useMemo(() => Array.from(new Set(employeeIds.filter(Boolean))).sort().join(','), [employeeIds]);
  const valid = !!start && !!end && !Number.isNaN(Date.parse(start)) && !Number.isNaN(Date.parse(end)) && Date.parse(end) > Date.parse(start);

  useEffect(() => {
    if (!valid || !key) {
      setBlocks([]);
      return;
    }
    let cancelled = false;
    // Krótka zwłoka — wpisywanie godziny nie odpytuje bazy po każdym znaku.
    const timer = window.setTimeout(() => {
      setLoading(true);
      fetchAvailability(key.split(','), new Date(start as string), new Date(end as string), excludeMeetingId)
        .then((next) => {
          if (!cancelled) setBlocks(next);
        })
        .catch(() => {
          if (!cancelled) setBlocks([]);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 400);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [key, start, end, excludeMeetingId, valid]);

  const conflicts = useMemo(
    () => (valid && key ? meetingConflicts(blocks, start as string, end as string, key.split(',')) : []),
    [blocks, start, end, key, valid],
  );

  if (!conflicts.length) {
    return loading ? (
      <p className="flex items-center gap-2 text-xs text-[#e5e4e2]/45">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Sprawdzanie, czy uczestnicy są wolni…
      </p>
    ) : null;
  }

  return (
    <div className="rounded-lg border border-amber-400/25 bg-amber-400/[0.07] p-3 text-sm">
      <p className="flex items-center gap-2 font-medium text-amber-200">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        {conflictHeadline(conflicts.length)}
        {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-200/70" />}
      </p>
      <ul className="mt-2 space-y-1 text-xs text-[#e5e4e2]/80">
        {conflicts.map((conflict) => (
          <li key={conflict.employeeId}>
            <span className="font-medium text-[#e5e4e2]">{names[conflict.employeeId] || 'Pracownik'}:</span> {conflictText(conflict)}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[11px] text-[#e5e4e2]/45">Możesz zapisać spotkanie mimo to — uczestnicy zdecydują w odpowiedzi.</p>
    </div>
  );
}
