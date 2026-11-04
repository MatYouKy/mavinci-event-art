'use client';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { CalendarDays, HelpCircle, MapPin, RefreshCw } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { createRefreshQueue } from '@/lib/CRM/refreshQueue';
import type { MyEventStep } from '@/lib/events/steps/eventSteps';
import EventStepRow from './EventStepRow';
import EventStepActionDialog from './EventStepActionDialog';
import EventStepsHelpModal from './EventStepsHelpModal';
import { useEventStepActions } from './useEventStepActions';
import { channelSuffix, formatEventDay } from './stepUi';

const HIDDEN_ERROR_CODES = new Set(['42501', '42883', 'PGRST202']);

type SectionState = 'loading' | 'ready' | 'hidden' | 'error';

/** „Moje kroki”: kroki realizacji bieżącej osoby ze wszystkich wydarzeń, które można wykonać teraz. */
export default function MyEventStepsSection() {
  const headingId = useId();
  const [items, setItems] = useState<MyEventStep[]>([]);
  const [state, setState] = useState<SectionState>('loading');
  const [refreshError, setRefreshError] = useState('');
  const [helpOpen, setHelpOpen] = useState(false);
  const queueRef = useRef<ReturnType<typeof createRefreshQueue> | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const queue = createRefreshQueue(controller.signal, async signal => {
      const { data, error } = await supabase.rpc('get_my_event_steps').abortSignal(signal);
      if (signal.aborted) {
        // Przekroczony czas odczytu (nie zamknięcie widoku) — pokaż błąd zamiast wiecznego wczytywania.
        if (!controller.signal.aborted) {
          setRefreshError('Nie udało się odświeżyć listy kroków.');
          setState(current => (current === 'ready' ? 'ready' : 'error'));
        }
        return;
      }
      if (error) {
        if (HIDDEN_ERROR_CODES.has(error.code ?? '')) {
          setState('hidden');
          return;
        }
        setRefreshError('Nie udało się odświeżyć listy kroków.');
        setState(current => (current === 'ready' ? 'ready' : 'error'));
        return;
      }
      setItems(Array.isArray(data) ? (data as MyEventStep[]) : []);
      setRefreshError('');
      setState('ready');
    });
    queueRef.current = queue;
    void queue.refresh();

    // RLS filtruje zmiany do wydarzeń, które widzisz; kolejka łączy serie zmian w jedno odświeżenie.
    const channel = supabase
      .channel(`my-event-steps-${channelSuffix()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'event_steps' }, () => queue.schedule())
      .subscribe();
    const onFocus = () => queue.schedule();
    const onVisibility = () => {
      if (!document.hidden) queue.schedule();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      controller.abort();
      queueRef.current = null;
      void supabase.removeChannel(channel);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  // Po czynności lista „Moje kroki” jest pobierana od nowa (zwrócona migawka dotyczy jednego wydarzenia).
  const { pending, trigger, dialog } = useEventStepActions(async () => {
    await queueRef.current?.refresh();
  });

  const groups = useMemo(() => {
    const byEvent = new Map<string, { event: MyEventStep['event']; steps: MyEventStep[] }>();
    for (const step of items) {
      const event = step.event ?? { id: step.event_id, name: 'Wydarzenie', event_date: null, location: null };
      const group = byEvent.get(event.id);
      if (group) group.steps.push(step);
      else byEvent.set(event.id, { event, steps: [step] });
    }
    return Array.from(byEvent.values());
  }, [items]);

  if (state === 'hidden') return null;

  return (
    <section aria-labelledby={headingId} aria-busy={state === 'loading' || Boolean(pending)} className="space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 id={headingId} className="text-lg text-[#e5e4e2]">
            Kroki realizacji do wykonania
          </h2>
          <p className="mt-1 text-sm text-[#e5e4e2]/60">
            Kroki przypisane do Ciebie albo do Twojej roli, które można wykonać teraz — ze wszystkich wydarzeń.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => void queueRef.current?.refresh()}
            aria-label="Odśwież moje kroki"
            title="Odśwież"
            className="rounded-lg p-2 text-[#e5e4e2]/50 hover:bg-white/5 hover:text-[#d3bb73]"
          >
            <RefreshCw className="h-4 w-4" aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => setHelpOpen(true)}
            aria-label="Pomoc: kroki i odpowiedzialność"
            title="Pomoc: kroki i odpowiedzialność"
            className="rounded-lg p-2 text-[#e5e4e2]/60 hover:bg-white/5 hover:text-[#d3bb73]"
          >
            <HelpCircle className="h-5 w-5" aria-hidden />
          </button>
        </div>
      </div>

      {state === 'loading' && <p className="text-sm text-[#e5e4e2]/60">Wczytywanie…</p>}
      {state === 'error' && (
        <p role="alert" className="text-sm text-red-300">
          Nie udało się wczytać kroków.{' '}
          <button type="button" onClick={() => void queueRef.current?.refresh()} className="underline">
            Spróbuj ponownie
          </button>
        </p>
      )}
      {state === 'ready' && refreshError && (
        <p role="status" className="text-xs text-amber-200/80">
          {refreshError}
        </p>
      )}
      {state === 'ready' && !items.length && (
        <p className="rounded-xl bg-white/5 p-4 text-sm text-[#e5e4e2]/60">Nie masz kroków do wykonania.</p>
      )}

      {groups.map(group => {
        const href = `/crm/events/${group.event.id}`;
        return (
          <article key={group.event.id} className="rounded-xl bg-white/5 p-4" aria-label={group.event.name}>
            <header className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <Link href={href} className="font-medium text-[#e5e4e2] hover:text-[#d3bb73]">
                {group.event.name}
              </Link>
              <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[#e5e4e2]/55">
                <span className="inline-flex items-center gap-1">
                  <CalendarDays className="h-3.5 w-3.5" aria-hidden />
                  {formatEventDay(group.event.event_date)}
                </span>
                {group.event.location && (
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="h-3.5 w-3.5" aria-hidden />
                    {group.event.location}
                  </span>
                )}
              </p>
            </header>
            <div className="space-y-2">
              {group.steps.map(step => (
                <EventStepRow
                  key={step.id}
                  step={step}
                  pendingAction={pending?.step.id === step.id ? pending.action : null}
                  disabled={Boolean(pending)}
                  onAction={trigger}
                  eventHref={href}
                />
              ))}
            </div>
          </article>
        );
      })}

      <EventStepActionDialog {...dialog} />
      <EventStepsHelpModal open={helpOpen} onClose={() => setHelpOpen(false)} myRoles={null} />
    </section>
  );
}
