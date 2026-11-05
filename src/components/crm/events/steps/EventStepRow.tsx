'use client';
import { useId, useState } from 'react';
import Link from 'next/link';
import {
  ChevronDown,
  ClipboardCheck,
  ClipboardList,
  FileText,
  Info,
  Loader2,
  Lock,
  Package,
  Phone,
  Truck,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { EVENT_TAB_LABELS, isEventTabId } from '@/lib/events/access/eventAccess';
import {
  EVENT_STEP_TARGET_TAB,
  EVENT_STEP_KIND_LABELS,
  EVENT_STEP_ROLE_LABELS,
  EVENT_STEP_STATUS_LABELS,
  eventStepActionBlocked,
  eventStepActionLabel,
  eventStepAvailableActions,
  eventStepDueLabel,
  eventStepHistoryLabel,
  eventStepOwnerLabel,
  eventStepPrimaryAction,
  eventStepQuantityLabel,
  eventStepTone,
  formatEventStepDate,
  isEventStepLive,
  type EventStep,
  type EventStepAction,
} from '@/lib/events/steps/eventSteps';
import { EVENT_STEP_TONE_CHIP, EVENT_STEP_TONE_ROW, telHref } from './stepUi';

/** Ikony zakładek, do których prowadzą kroki (miejsce, gdzie krok się zamyka). */
const TAB_ICONS: Record<string, LucideIcon> = {
  details: Info,
  contract: FileText,
  finances: Wallet,
  summary: ClipboardCheck,
  agenda: ClipboardList,
  team: Users,
  logistics: Truck,
  equipment: Package,
};

/** Etykiety bardziej konkretne niż nazwa zakładki. */
const CONTEXT_LABELS: Record<string, string> = {
  dispatch_out: 'Lista załadunku',
  wedding_card: 'Karta weselna',
};

/** Zakładka, w której zamyka się krok: EVENT_STEP_TARGET_TAB, a kroki magazynu (braki, wynajem, sprawdzenia) → Sprzęt. */
function stepTargetTab(key: string): string | null {
  const direct = EVENT_STEP_TARGET_TAB[key];
  if (direct) return direct;
  const prefix = key.split(':')[0];
  return prefix === 'shortage' || prefix === 'rental' || prefix === 'check' ? 'equipment' : null;
}

function stepContextLink(key: string): { tab: string; label: string; icon: LucideIcon } | undefined {
  const tab = stepTargetTab(key);
  if (!tab) return undefined;
  const label = CONTEXT_LABELS[key] ?? (isEventTabId(tab) ? EVENT_TAB_LABELS[tab] : null);
  if (!label) return undefined;
  return { tab, label, icon: TAB_ICONS[tab] ?? FileText };
}

const NOTE_PREFIX: Partial<Record<EventStep['status'], string>> = {
  problem: 'Problem',
  skipped: 'Powód pominięcia',
};

function actionClass(action: EventStepAction, primary: boolean) {
  if (primary) return 'bg-[#d3bb73] text-[#210811] hover:bg-[#d3bb73]/90';
  if (action === 'take') return 'bg-[#d3bb73]/15 text-[#d3bb73] hover:bg-[#d3bb73]/25';
  if (action === 'problem') return 'bg-red-500/10 text-red-200 hover:bg-red-500/20';
  if (action === 'skip') return 'bg-transparent text-[#e5e4e2]/60 hover:bg-white/5';
  return 'bg-white/5 text-[#e5e4e2]/85 hover:bg-white/10';
}

export default function EventStepRow({
  step,
  pendingAction = null,
  disabled = false,
  onAction,
  onNavigate,
  eventHref,
  canOpenTab,
}: {
  step: EventStep;
  /** Czynność w trakcie zapisu dla tego kroku. */
  pendingAction?: EventStepAction | null;
  /** Blokuje przyciski (np. trwa zapis innego kroku). */
  disabled?: boolean;
  onAction?: (step: EventStep, action: EventStepAction) => void;
  /** Przejście do zakładki wydarzenia (na stronie wydarzenia). */
  onNavigate?: (tab: string) => void;
  /** Adres wydarzenia — używany do linków kontekstowych poza stroną wydarzenia. */
  eventHref?: string;
  /** Czy zakładka jest dostępna dla tej osoby (bez tego link do niedostępnej zakładki się nie pokazuje). */
  canOpenTab?: (tab: string) => boolean;
}) {
  const detailsId = useId();
  const blockedId = useId();
  const [expanded, setExpanded] = useState(false);
  const tone = eventStepTone(step);
  const live = isEventStepLive(step);
  const actions = onAction ? eventStepAvailableActions(step) : [];
  const quantity = eventStepQuantityLabel(step);
  const due = eventStepDueLabel(step);
  const phoneHref = live ? telHref(step.assignee?.phone) : null;
  const blockedTitles = step.blocked_by.map(item => item.title).join(', ');
  const contextLink = live ? stepContextLink(step.key) : undefined;
  const context = contextLink && (!canOpenTab || canOpenTab(contextLink.tab)) ? contextLink : undefined;
  const hasMore = Boolean(step.details) || step.history.length > 0;
  const primaryAction = actions.length ? eventStepPrimaryAction(step, actions) : null;
  const busy = Boolean(pendingAction);

  const meta: { key: string; text: string; className?: string }[] = [];
  if (quantity) meta.push({ key: 'quantity', text: `Ilość: ${quantity}` });
  if (step.supplier) meta.push({ key: 'supplier', text: `Dostawca: ${step.supplier}` });
  if (step.ordered_at) meta.push({ key: 'ordered', text: `Zamówiono: ${formatEventStepDate(step.ordered_at)}` });
  if (step.expected_at) meta.push({ key: 'expected', text: `Dostawa: ${formatEventStepDate(step.expected_at)}` });
  if (step.completed_at && (step.status === 'done' || step.status === 'skipped')) {
    meta.push({
      key: 'completed',
      text: `${step.status === 'skipped' ? 'Pominięte' : 'Zamknięte'}: ${[step.completed_by_name, formatEventStepDate(step.completed_at)].filter(Boolean).join(' · ')}`,
    });
  }

  return (
    <article
      className={`rounded-lg p-3 sm:p-4 ${EVENT_STEP_TONE_ROW[tone]}`}
      aria-busy={busy}
      aria-label={`${step.title} — ${EVENT_STEP_STATUS_LABELS[step.status]}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ${EVENT_STEP_TONE_CHIP[tone]}`}>
          {EVENT_STEP_STATUS_LABELS[step.status]}
        </span>
        {step.is_mine && live && (
          <span className="rounded-full bg-[#d3bb73]/15 px-2.5 py-0.5 text-[11px] text-[#d3bb73]">Twój krok</span>
        )}
        <span className="text-xs text-[#e5e4e2]/45">{EVENT_STEP_KIND_LABELS[step.kind]}</span>
        {step.blocks_ready && live && step.stage === 'preparation' && (
          <span className="text-xs text-[#e5e4e2]/45">· wymagane przed gotowością magazynu</span>
        )}
      </div>

      <h4 className={`mt-1.5 break-words text-sm font-medium ${live ? 'text-[#e5e4e2]' : 'text-[#e5e4e2]/60'}`}>
        {step.title}
      </h4>

      <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[#e5e4e2]/60">
        <span className="inline-flex items-center gap-1.5">
          Odpowiada: {eventStepOwnerLabel(step)}
          {phoneHref && (
            <a
              href={phoneHref}
              aria-label={`Zadzwoń: ${step.assignee?.name ?? EVENT_STEP_ROLE_LABELS[step.owner_role]}`}
              className="inline-flex items-center rounded p-0.5 text-[#d3bb73] hover:bg-white/5"
            >
              <Phone className="h-3.5 w-3.5" aria-hidden />
            </a>
          )}
        </span>
        {due && (
          <span className={step.overdue && live ? 'font-medium text-amber-300' : undefined}>
            {due.startsWith('do ') || due.startsWith('dziś') ? `Termin: ${due}` : due.charAt(0).toUpperCase() + due.slice(1)}
          </span>
        )}
        {meta.map(item => (
          <span key={item.key} className={item.className}>
            {item.text}
          </span>
        ))}
      </div>

      {step.status_note && (
        <p
          className={`mt-2 whitespace-pre-wrap break-words rounded-md px-2.5 py-1.5 text-xs ${
            step.status === 'problem' ? 'bg-red-500/10 text-red-100' : 'bg-black/15 text-[#e5e4e2]/80'
          }`}
        >
          <span className="text-[#e5e4e2]/50">{NOTE_PREFIX[step.status] ?? 'Notatka'}: </span>
          {step.status_note}
        </p>
      )}

      {step.blocked_by.length > 0 && live && (
        <p id={blockedId} className="mt-2 flex items-start gap-1.5 text-xs text-[#e5e4e2]/60">
          <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#e5e4e2]/45" aria-hidden />
          <span>
            Czeka na:{' '}
            {step.blocked_by
              .map(item => `${item.title} (${EVENT_STEP_ROLE_LABELS[item.owner_role] ?? 'inna rola'})`)
              .join(', ')}
          </span>
        </p>
      )}

      {(actions.length > 0 || context) && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {actions.map(action => {
            const blocked = eventStepActionBlocked(step, action);
            const isPending = pendingAction === action;
            return (
              <span
                key={action}
                title={blocked ? `Najpierw muszą być zamknięte: ${blockedTitles}` : undefined}
                className="inline-flex"
              >
                <button
                  type="button"
                  disabled={disabled || busy || blocked}
                  aria-describedby={blocked ? blockedId : undefined}
                  onClick={() => onAction?.(step, action)}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${actionClass(action, action === primaryAction)}`}
                >
                  {isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
                  {blocked && <Lock className="h-3.5 w-3.5" aria-hidden />}
                  {isPending ? 'Zapisywanie…' : eventStepActionLabel(step, action)}
                </button>
              </span>
            );
          })}
          {context &&
            (onNavigate ? (
              <button
                type="button"
                onClick={() => onNavigate(context.tab)}
                title={`Przejdź do zakładki: ${context.label}`}
                className="inline-flex items-center gap-1.5 rounded-lg bg-white/5 px-3 py-1.5 text-xs text-[#d3bb73] hover:bg-white/10"
              >
                <context.icon className="h-3.5 w-3.5" aria-hidden />
                {context.label}
              </button>
            ) : eventHref ? (
              <Link
                href={`${eventHref}?tab=${context.tab}`}
                className="inline-flex items-center gap-1.5 rounded-lg bg-white/5 px-3 py-1.5 text-xs text-[#d3bb73] hover:bg-white/10"
              >
                <context.icon className="h-3.5 w-3.5" aria-hidden />
                {context.label}
              </Link>
            ) : null)}
        </div>
      )}

      {hasMore && (
        <div className="mt-2">
          <button
            type="button"
            aria-expanded={expanded}
            aria-controls={detailsId}
            onClick={() => setExpanded(value => !value)}
            className="inline-flex items-center gap-1 rounded px-1 py-0.5 text-xs text-[#e5e4e2]/55 hover:bg-white/5 hover:text-[#e5e4e2]/80"
          >
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${expanded ? 'rotate-180' : ''}`} aria-hidden />
            {expanded
              ? 'Ukryj szczegóły'
              : step.details && step.history.length
                ? 'Szczegóły i historia'
                : step.details
                  ? 'Szczegóły'
                  : 'Historia'}
          </button>
          <div id={detailsId} hidden={!expanded} className="mt-2 space-y-3">
            {step.details && (
              <p className="whitespace-pre-wrap break-words rounded-md bg-black/15 px-3 py-2 text-xs leading-relaxed text-[#e5e4e2]/80">
                {step.details}
              </p>
            )}
            {step.history.length > 0 && (
              <ol className="space-y-1.5 text-xs text-[#e5e4e2]/60" aria-label="Historia kroku">
                {step.history.map((entry, index) => (
                  <li key={`${entry.at}-${index}`} className="rounded-md bg-white/[0.03] px-3 py-1.5">
                    <span>{eventStepHistoryLabel(entry)}</span>
                    {entry.to_status && (
                      <span className="text-[#e5e4e2]/45"> → {EVENT_STEP_STATUS_LABELS[entry.to_status]}</span>
                    )}
                    {entry.note && <p className="mt-0.5 whitespace-pre-wrap break-words text-[#e5e4e2]/75">{entry.note}</p>}
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      )}
    </article>
  );
}
