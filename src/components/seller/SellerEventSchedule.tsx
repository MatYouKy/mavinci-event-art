'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { CalendarDays, ChevronDown, Plus, Trash2 } from 'lucide-react';
import SellerDatePicker from '@/app/(public)/seller/_components/SellerDatePicker';
import SellerTimePicker from '@/components/seller/SellerTimePicker';
import { buildSellerEventSchedule, emptySellerEventDay, MAX_SELLER_EVENT_DAYS, nextSellerDay, sellerDayLabel, sellerEventDayLabel, type SellerEventDay } from '@/lib/seller/eventSchedule';

function DayRow({ day, index, onChange, onValidity, onRemove }: {
  day: SellerEventDay; index: number; onChange: (day: SellerEventDay) => void;
  onValidity: (index: number, valid: boolean) => void; onRemove?: () => void;
}) {
  const validity = useCallback((valid: boolean) => onValidity(index, valid), [index, onValidity]);
  const overnight = !buildSellerEventSchedule([day]).error && day.start_time && day.end_time && day.end_time < day.start_time;
  return <div className="space-y-1.5">
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_2rem] items-start gap-2 sm:grid-cols-[minmax(0,1fr)_7rem_7rem_2rem]">
      <div className="col-span-3 sm:col-span-1">
        <SellerDatePicker label={index === 0 ? 'Data wydarzenia' : `Dzień ${index + 1}`} value={day.date} onChange={date => onChange({ ...day, date })} onValidityChange={validity} />
      </div>
      <SellerTimePicker label="Od" ariaLabel={`Dzień ${index + 1} — początek`} value={day.start_time} onChange={start_time => onChange({ ...day, start_time })} />
      <SellerTimePicker label="Do" align="right" ariaLabel={`Dzień ${index + 1} — koniec`} value={day.end_time} onChange={end_time => onChange({ ...day, end_time })} />
      {onRemove && <button type="button" onClick={onRemove} aria-label={`Usuń dzień ${index + 1}`} className="mt-6 flex h-10 w-8 items-center justify-center rounded-lg text-white/40 hover:bg-white/5 hover:text-rose-200"><Trash2 className="h-4 w-4" /></button>}
    </div>
    {overnight && <p className="text-xs text-[#d3bb73]" aria-live="polite">Koniec: {sellerDayLabel(nextSellerDay(day.date))}, {day.end_time} · następny dzień</p>}
  </div>;
}

export default function SellerEventSchedule({ value, onChange, onValidityChange, disabled = false, compact = false, requiredForPdf = false, notice }: {
  value: SellerEventDay[]; onChange: (days: SellerEventDay[]) => void;
  onValidityChange: (valid: boolean) => void; disabled?: boolean; compact?: boolean; requiredForPdf?: boolean; notice?: string;
}) {
  const [invalidDates, setInvalidDates] = useState<Record<number, boolean>>({});
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const id = useId();
  const dateValidity = useCallback((index: number, valid: boolean) => {
    setInvalidDates(current => current[index] === !valid ? current : { ...current, [index]: !valid });
  }, []);
  const schedule = buildSellerEventSchedule(value);
  const invalidDate = value.some((_, index) => invalidDates[index]);
  const valid = !invalidDate && !schedule.error;
  const error = invalidDate ? 'Popraw datę zaznaczoną w formularzu.' : schedule.error;
  const first = value[0];
  const summary = first?.date
    ? value.length > 1
      ? `${sellerDayLabel(first.date)} · ${value.length} dni`
      : `${sellerDayLabel(first.date)}${first.start_time && first.end_time ? ` · ${first.start_time}–${first.end_time}${first.end_time < first.start_time ? ' (+1 dzień)' : ''}` : ''}`
    : 'Wybierz datę i godziny';

  useEffect(() => { onValidityChange(valid); }, [valid, onValidityChange]);
  useEffect(() => {
    if (!compact || !open) return;
    const closeOutside = (event: Event) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('focusin', closeOutside);
    panelRef.current?.querySelector<HTMLInputElement>('input:not(:disabled)')?.focus();
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('focusin', closeOutside);
    };
  }, [compact, open]);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);

  const editor = <fieldset disabled={disabled} className="min-w-0 space-y-3 disabled:opacity-60">
    <legend className={compact ? 'sr-only' : 'mb-2 text-sm font-medium'}>Termin i godziny wydarzenia</legend>
    {notice && <p className="rounded-lg bg-amber-300/10 p-2 text-xs leading-5 text-amber-100">{notice}</p>}
    {value.map((day, index) => <DayRow key={index} day={day} index={index} onValidity={dateValidity}
      onChange={next => onChange(value.map((item, position) => position === index ? next : item))}
      onRemove={index ? () => {
        setInvalidDates(current => Object.fromEntries(Object.entries(current).filter(([key]) => Number(key) !== index).map(([key, invalid]) => [Number(key) > index ? Number(key) - 1 : Number(key), invalid])));
        onChange(value.filter((_, position) => position !== index));
      } : undefined} />)}
    {!valid && <p id={`${id}-editor-error`} role="alert" className="text-xs text-rose-200">{error}</p>}
    <div className="flex flex-wrap items-center justify-between gap-2">
      <button type="button" disabled={!valid || !first?.date || value.length >= MAX_SELLER_EVENT_DAYS || !nextSellerDay(value[value.length - 1]?.date || '')}
        onClick={() => onChange([...value, emptySellerEventDay(nextSellerDay(value[value.length - 1].date))])}
        className="inline-flex items-center gap-1.5 rounded-lg px-2 py-2 text-xs text-[#d3bb73] hover:bg-white/5 disabled:opacity-40"><Plus className="h-3.5 w-3.5" />Kolejny dzień</button>
      <span className="text-[11px] text-white/40">{requiredForPdf ? 'Data wymagana do PDF · godziny opcjonalne · czas polski' : 'Godziny opcjonalne · czas polski'}</span>
    </div>
  </fieldset>;

  if (!compact) return editor;
  return <div ref={rootRef} className="relative min-w-0" onKeyDown={event => {
    if (event.key === 'Escape' && open) {
      event.preventDefault(); event.stopPropagation(); setOpen(false); triggerRef.current?.focus();
    }
  }}>
    <label id={`${id}-label`} htmlFor={`${id}-trigger`} className="text-xs text-white/50">Termin wydarzenia{requiredForPdf ? ' *' : ''}</label>
    <button ref={triggerRef} id={`${id}-trigger`} type="button" disabled={disabled} aria-haspopup="dialog" aria-expanded={open}
      aria-controls={`${id}-panel`} aria-invalid={!valid} aria-describedby={!valid ? `${id}-${open ? 'editor-error' : 'error'}` : undefined}
      onClick={() => setOpen(current => !current)}
      className="mt-1.5 flex h-11 w-full items-center gap-2 rounded-lg border border-white/10 bg-[var(--brand-burgundy-950)] px-3 text-left text-sm outline-none focus-visible:border-[#d3bb73]/30 disabled:opacity-50">
      <CalendarDays className="h-4 w-4 shrink-0 text-[#d3bb73]" />
      <span className={'min-w-0 flex-1 truncate ' + (first?.date ? '' : 'text-white/40')} title={summary}>{summary}</span>
      <ChevronDown className="h-3.5 w-3.5 shrink-0 text-white/40" />
    </button>
    {!valid && !open && <p id={`${id}-error`} role="alert" className="mt-1 text-xs text-rose-200">{error}</p>}
    {/* Keep fields mounted so closing the picker cannot erase an invalid typed date. */}
    <div ref={panelRef} id={`${id}-panel`} hidden={!open} role="dialog" aria-labelledby={`${id}-label`}
      className="absolute left-0 top-full z-40 mt-2 max-h-[75vh] w-[min(34rem,calc(100vw-3rem))] overflow-y-auto rounded-xl bg-[var(--brand-burgundy-800,#341021)] p-4 [&:has([role=dialog])]:pb-80 shadow-2xl ring-1 ring-white/5 xl:left-auto xl:right-0">
      <div className="mb-3 flex items-center justify-between gap-3">
        <span className="text-sm font-medium">Termin i godziny</span>
        <button type="button" disabled={!valid} onClick={() => { setOpen(false); triggerRef.current?.focus(); }}
          className="rounded-lg bg-[#d3bb73]/15 px-3 py-1.5 text-xs text-[#d3bb73] disabled:opacity-40">Gotowe</button>
      </div>
      {editor}
    </div>
  </div>;
}

export function SellerEventScheduleSummary({ days }: { days?: SellerEventDay[] | null }) {
  if (!days?.length) return null;
  return <section className="space-y-2 rounded-lg bg-white/[0.035] p-3">
    <h4 className="text-sm font-medium">Dni i godziny wydarzenia · ustalenia oferty</h4>
    <ul className="space-y-2 text-sm">{days.map((day, index) => <li key={day.date}><span className="mr-2 text-white/45">Dzień {index + 1}</span>{sellerEventDayLabel(day)}</li>)}</ul>
  </section>;
}
