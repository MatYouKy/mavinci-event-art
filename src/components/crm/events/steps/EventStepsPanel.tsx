'use client';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ChevronDown, HelpCircle, Phone, Plus, RefreshCw } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { createRefreshQueue } from '@/lib/CRM/refreshQueue';
import {
  EVENT_STEP_ROLE_LABELS,
  eventStepDueLabel,
  eventStepOwnerLabel,
  groupEventStepsByStage,
  isEventStepLive,
  type EventStepStage,
  type EventStepsSnapshot,
} from '@/lib/events/steps/eventSteps';
import EventStepRow from './EventStepRow';
import EventStepActionDialog from './EventStepActionDialog';
import EventStepsHelpModal from './EventStepsHelpModal';
import AddEventStepDialog from './AddEventStepDialog';
import { useEventStepActions } from './useEventStepActions';
import { channelSuffix, telHref } from './stepUi';

/** Brak dostępu (42501) albo funkcja jeszcze niewdrożona — panel się nie pokazuje. */
const HIDDEN_ERROR_CODES = new Set(['42501', '42883', 'PGRST202']);
const WAITING_PREVIEW = 4;

type PanelState = 'loading' | 'ready' | 'hidden' | 'error';

export default function EventStepsPanel({
  eventId,
  onNavigate,
  canOpenTab,
  className = '',
}: {
  eventId: string;
  onNavigate?: (tab: string) => void;
  /** Czy zakładka (cel kroku) jest dostępna — link do niedostępnej zakładki się nie pokazuje. */
  canOpenTab?: (tab: string) => boolean;
  /** Dodatkowe klasy sekcji (np. odstęp w układzie strony). */
  className?: string;
}) {
  const headingId = useId();
  const stagesId = useId();
  const [snapshot, setSnapshot] = useState<EventStepsSnapshot | null>(null);
  const [state, setState] = useState<PanelState>('loading');
  const [loadError, setLoadError] = useState('');
  const [helpOpen, setHelpOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [showAllWaiting, setShowAllWaiting] = useState(false);
  const [stageOverrides, setStageOverrides] = useState<Partial<Record<EventStepStage, boolean>>>({});
  const queueRef = useRef<ReturnType<typeof createRefreshQueue> | null>(null);

  useEffect(() => {
    setSnapshot(null);
    setState('loading');
    setLoadError('');
    setStageOverrides({});
    const controller = new AbortController();
    const queue = createRefreshQueue(controller.signal, async signal => {
      const { data, error } = await supabase.rpc('get_event_steps', { p_event_id: eventId }).abortSignal(signal);
      if (signal.aborted) {
        // Przekroczony czas odczytu (nie zamknięcie widoku) — pokaż błąd zamiast wiecznego wczytywania.
        if (!controller.signal.aborted) {
          setLoadError('Nie udało się odświeżyć kroków realizacji.');
          setState(current => (current === 'ready' ? 'ready' : 'error'));
        }
        return;
      }
      if (error) {
        if (HIDDEN_ERROR_CODES.has(error.code ?? '')) {
          setSnapshot(null);
          setState('hidden');
          return;
        }
        setLoadError('Nie udało się odświeżyć kroków realizacji.');
        setState(current => (current === 'ready' ? 'ready' : 'error'));
        return;
      }
      setSnapshot(data as EventStepsSnapshot);
      setLoadError('');
      setState('ready');
    });
    queueRef.current = queue;
    void queue.refresh();

    const channel = supabase
      .channel(`event-steps-${eventId}-${channelSuffix()}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'event_steps', filter: `event_id=eq.${eventId}` },
        () => queue.schedule(),
      )
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
  }, [eventId]);

  const { pending, trigger, dialog } = useEventStepActions(next => {
    if (next && Array.isArray(next.steps)) setSnapshot(next);
    else void queueRef.current?.refresh();
  });

  const groups = useMemo(() => groupEventStepsByStage(snapshot?.steps ?? []), [snapshot]);
  const totals = useMemo(() => {
    const values = Object.values(snapshot?.progress ?? {});
    const total = values.reduce((sum, item) => sum + (item?.total ?? 0), 0);
    const done = values.reduce((sum, item) => sum + (item?.done ?? 0), 0);
    return { total, done, percent: total ? Math.round((done / total) * 100) : 0 };
  }, [snapshot]);
  const myOpenCount = useMemo(
    () => (snapshot?.steps ?? []).filter(step => step.is_mine && isEventStepLive(step)).length,
    [snapshot],
  );

  if (state === 'hidden' || state === 'loading') return null;

  if (state === 'error' || !snapshot) {
    return (
      <section className={`rounded-xl bg-white/5 p-4 ${className}`} aria-labelledby={headingId}>
        <h3 id={headingId} className="font-medium text-[#e5e4e2]">
          Kroki realizacji
        </h3>
        <p role="alert" className="mt-2 text-sm text-red-300">
          Nie udało się wczytać kroków realizacji.{' '}
          <button type="button" onClick={() => void queueRef.current?.refresh()} className="underline">
            Spróbuj ponownie
          </button>
        </p>
      </section>
    );
  }

  // Bez kroków (np. brak daty wydarzenia) panel zostaje tylko wtedy, gdy można dodać krok ręcznie.
  if (!snapshot.steps.length && !snapshot.can_add) return null;

  const waiting = snapshot.waiting_for ?? [];
  const visibleWaiting = showAllWaiting ? waiting : waiting.slice(0, WAITING_PREVIEW);
  const allClosed = !snapshot.steps.some(isEventStepLive);

  return (
    <section className={`rounded-xl bg-white/5 p-4 sm:p-5 ${className}`} aria-labelledby={headingId} aria-busy={Boolean(pending)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 id={headingId} className="font-medium text-[#e5e4e2]">
            Kroki realizacji
          </h3>
          <p className="mt-0.5 text-xs text-[#e5e4e2]/55">
            Zamknięte {totals.done} z {totals.total}
            {myOpenCount > 0 && ` · Twoje do zrobienia: ${myOpenCount}`}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => void queueRef.current?.refresh()}
            aria-label="Odśwież kroki realizacji"
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

      <div
        role="progressbar"
        aria-label="Postęp kroków realizacji"
        aria-valuemin={0}
        aria-valuemax={totals.total}
        aria-valuenow={totals.done}
        aria-valuetext={`${totals.done} z ${totals.total} kroków zamkniętych`}
        className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10"
      >
        <div className="h-full rounded-full bg-[#d3bb73] transition-[width]" style={{ width: `${totals.percent}%` }} />
      </div>

      {loadError && (
        <p role="status" className="mt-2 text-xs text-amber-200/80">
          {loadError}{' '}
          <button type="button" onClick={() => void queueRef.current?.refresh()} className="underline">
            Odśwież
          </button>
        </p>
      )}

      <div className="mt-4 rounded-lg bg-black/15 p-3">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-[#d3bb73]">Czekamy na</h4>
        {waiting.length === 0 ? (
          <p className="mt-2 text-sm text-[#e5e4e2]/60">
            {allClosed ? 'Wszystkie kroki są zamknięte.' : 'Nic nie jest teraz do zrobienia — pozostałe kroki czekają na wcześniejsze.'}
          </p>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {visibleWaiting.map(step => {
              const due = eventStepDueLabel(step);
              const phone = telHref(step.assignee?.phone);
              return (
                <li
                  key={step.id}
                  className={`flex items-start justify-between gap-3 rounded-md px-3 py-2 ${
                    step.status === 'problem' ? 'bg-red-500/10' : step.overdue ? 'bg-amber-400/10' : 'bg-white/[0.03]'
                  }`}
                >
                  <div className="min-w-0">
                    <p className="break-words text-sm text-[#e5e4e2]">
                      {step.title}
                      {step.is_mine && <span className="ml-2 text-xs text-[#d3bb73]">Twój krok</span>}
                    </p>
                    <p className="mt-0.5 text-xs text-[#e5e4e2]/60">
                      {eventStepOwnerLabel(step)}
                      {due && (
                        <>
                          {' · '}
                          <span className={step.overdue ? 'font-medium text-amber-300' : undefined}>{due}</span>
                        </>
                      )}
                      {step.status === 'problem' && <span className="text-red-300"> · problem</span>}
                    </p>
                  </div>
                  {phone && (
                    <a
                      href={phone}
                      aria-label={`Zadzwoń: ${step.assignee?.name ?? EVENT_STEP_ROLE_LABELS[step.owner_role]}`}
                      className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-[#d3bb73]/10 px-2.5 py-1.5 text-xs text-[#d3bb73] hover:bg-[#d3bb73]/20"
                    >
                      <Phone className="h-3.5 w-3.5" aria-hidden />
                      Zadzwoń
                    </a>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {waiting.length > WAITING_PREVIEW && (
          <button
            type="button"
            onClick={() => setShowAllWaiting(value => !value)}
            className="mt-2 text-xs text-[#d3bb73] hover:underline"
          >
            {showAllWaiting ? 'Pokaż mniej' : `Pokaż wszystkie (${waiting.length})`}
          </button>
        )}
      </div>

      <div className="mt-4 space-y-3">
        {groups.map(group => {
          const progress = snapshot.progress?.[group.stage];
          const open = stageOverrides[group.stage] ?? group.steps.some(isEventStepLive);
          const regionId = `${stagesId}-${group.stage}`;
          return (
            <div key={group.stage}>
              <button
                type="button"
                aria-expanded={open}
                aria-controls={regionId}
                onClick={() => setStageOverrides(previous => ({ ...previous, [group.stage]: !open }))}
                className="flex w-full items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-left hover:bg-white/[0.03]"
              >
                <span className="text-xs font-semibold uppercase tracking-wider text-[#d3bb73]">{group.label}</span>
                <span className="flex items-center gap-2 text-xs tabular-nums text-[#e5e4e2]/50">
                  {progress ? `${progress.done}/${progress.total}` : ''}
                  <ChevronDown className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
                </span>
              </button>
              <div id={regionId} hidden={!open} className="mt-2 space-y-2">
                {group.steps.map(step => (
                  <EventStepRow
                    key={step.id}
                    step={step}
                    pendingAction={pending?.step.id === step.id ? pending.action : null}
                    disabled={Boolean(pending)}
                    onAction={trigger}
                    onNavigate={onNavigate}
                    canOpenTab={canOpenTab}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {snapshot.can_add && (
        <div className="mt-4">
          <button
            type="button"
            onClick={() => setAddOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#d3bb73]/15 px-3 py-2 text-sm text-[#d3bb73] hover:bg-[#d3bb73]/25"
          >
            <Plus className="h-4 w-4" aria-hidden />
            Dodaj krok
          </button>
        </div>
      )}

      <EventStepActionDialog {...dialog} />
      <EventStepsHelpModal open={helpOpen} onClose={() => setHelpOpen(false)} myRoles={snapshot.my_roles} />
      {snapshot.can_add && (
        <AddEventStepDialog
          open={addOpen}
          eventId={eventId}
          onClose={() => setAddOpen(false)}
          onAdded={next => setSnapshot(next)}
        />
      )}
    </section>
  );
}
