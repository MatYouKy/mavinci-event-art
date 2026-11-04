'use client';
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { CheckCircle2, CircleSlash } from 'lucide-react';
import {
  EVENT_STEPS_RULES,
  eventStepsHelpForRoles,
  type EventStepRole,
  type EventStepsHelpRole,
} from '@/lib/events/steps/eventSteps';
import EventStepDialog from './EventStepDialog';

/** Pomoc: zakres odpowiedzialności ról w krokach realizacji. `myRoles = null` → wszystkie role bez wyróżnienia. */
export default function EventStepsHelpModal({
  open,
  onClose,
  myRoles,
}: {
  open: boolean;
  onClose: () => void;
  myRoles: Partial<Record<EventStepRole, boolean>> | null | undefined;
}) {
  const baseId = useId();
  const tabRefs = useRef<Partial<Record<EventStepsHelpRole, HTMLButtonElement | null>>>({});
  const { mine, others } = useMemo(() => eventStepsHelpForRoles(myRoles), [myRoles]);
  const sections = useMemo(() => [...mine, ...others], [mine, others]);
  const mineRoles = useMemo(() => new Set(mine.map(section => section.role)), [mine]);
  const firstRole = sections[0]?.role ?? 'sales';
  const [active, setActive] = useState<EventStepsHelpRole>(firstRole);

  useEffect(() => {
    if (open) setActive(firstRole);
  }, [open, firstRole]);

  const current = sections.find(section => section.role === active) ?? sections[0];
  if (!current) return null;

  const select = (role: EventStepsHelpRole, focus = false) => {
    setActive(role);
    if (focus) tabRefs.current[role]?.focus();
  };

  const onTabKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const index = sections.findIndex(section => section.role === active);
    let next = -1;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % sections.length;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index - 1 + sections.length) % sections.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = sections.length - 1;
    if (next < 0) return;
    event.preventDefault();
    select(sections[next].role, true);
  };

  const description =
    myRoles == null
      ? 'Zakres odpowiedzialności każdej roli i jak wykonać swoje kroki.'
      : mine.length
        ? 'Najpierw Twoja rola na tym wydarzeniu, potem pozostałe.'
        : 'Nie masz przypisanej roli na tym wydarzeniu — poniżej zakres wszystkich ról.';

  const tabId = (role: EventStepsHelpRole) => `${baseId}-tab-${role}`;
  const panelId = `${baseId}-panel`;
  const heading = 'text-xs font-semibold uppercase tracking-wider text-[#d3bb73]';

  return (
    <EventStepDialog open={open} onClose={onClose} title="Kroki realizacji — kto za co odpowiada" description={description} wide>
      <div
        role="tablist"
        aria-label="Role w krokach realizacji"
        onKeyDown={onTabKeyDown}
        className="-mx-1 mb-4 flex gap-1 overflow-x-auto px-1 pb-1"
      >
        {sections.map(section => {
          const selected = section.role === current.role;
          const isMine = mineRoles.has(section.role);
          return (
            <button
              key={section.role}
              ref={element => {
                tabRefs.current[section.role] = element;
              }}
              id={tabId(section.role)}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={panelId}
              tabIndex={selected ? 0 : -1}
              data-autofocus={selected ? true : undefined}
              onClick={() => select(section.role)}
              className={`flex shrink-0 flex-col items-start rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                selected ? 'bg-[#d3bb73]/15 text-[#d3bb73]' : 'bg-white/[0.04] text-[#e5e4e2]/75 hover:bg-white/[0.08]'
              }`}
            >
              <span className="font-medium">{section.title}</span>
              {isMine && <span className="text-[10px] uppercase tracking-wider text-[#d3bb73]/80">Twoja rola</span>}
            </button>
          );
        })}
      </div>

      <div role="tabpanel" id={panelId} aria-labelledby={tabId(current.role)} tabIndex={0} className="space-y-5 outline-none">
        <p className="text-sm leading-relaxed text-[#e5e4e2]/85">{current.summary}</p>

        <section aria-labelledby={`${panelId}-scope`}>
          <h3 id={`${panelId}-scope`} className={heading}>
            Twój zakres
          </h3>
          <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm text-[#e5e4e2]/80">
            {current.responsibilities.map(item => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>

        <section aria-labelledby={`${panelId}-steps`}>
          <h3 id={`${panelId}-steps`} className={heading}>
            Kroki i jak je wykonać
          </h3>
          <ol className="mt-2 space-y-2">
            {current.steps.map((item, index) => (
              <li key={item.title} className="flex gap-3 rounded-lg bg-white/[0.04] p-3">
                <span
                  aria-hidden
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#d3bb73]/15 text-xs font-medium tabular-nums text-[#d3bb73]"
                >
                  {index + 1}
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-[#e5e4e2]">{item.title}</p>
                  <p className="mt-0.5 text-sm leading-relaxed text-[#e5e4e2]/70">{item.how}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby={`${panelId}-close`}>
          <h3 id={`${panelId}-close`} className={heading}>
            Jak dobrze zamknąć swój zakres
          </h3>
          <ul className="mt-2 space-y-1.5">
            {current.closeScope.map(item => (
              <li key={item} className="flex items-start gap-2 text-sm text-[#e5e4e2]/80">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300/80" aria-hidden />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby={`${panelId}-not`}>
          <h3 id={`${panelId}-not`} className={heading}>
            Nie należy do Ciebie
          </h3>
          <p className="mt-2 flex items-start gap-2 rounded-lg bg-white/[0.04] p-3 text-sm text-[#e5e4e2]/75">
            <CircleSlash className="mt-0.5 h-4 w-4 shrink-0 text-[#e5e4e2]/45" aria-hidden />
            <span>{current.notYours}</span>
          </p>
        </section>
      </div>

      <section aria-labelledby={`${baseId}-rules`} className="mt-6 rounded-xl bg-white/[0.03] p-4">
        <h3 id={`${baseId}-rules`} className={heading}>
          Zasady
        </h3>
        <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm text-[#e5e4e2]/75">
          {EVENT_STEPS_RULES.map(rule => (
            <li key={rule}>{rule}</li>
          ))}
        </ul>
      </section>
    </EventStepDialog>
  );
}
