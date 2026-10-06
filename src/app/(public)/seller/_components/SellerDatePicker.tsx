'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';

const isoDate = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const parseDate = (value: string) => {
  const [year, month, day] = value.split('-').map(Number);
  return year && month && day ? new Date(year, month - 1, day) : new Date();
};
const displayDate = (value: string) => value ? value.split('-').reverse().join('.') : '';
const parseTypedDate = (value: string): string | null => {
  if (!value.trim()) return '';
  const match = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(value.trim());
  if (!match) return null;
  const [, day, month, year] = match.map(Number);
  if (year < 1000 || year > 9999) return null;
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
    ? isoDate(date) : null;
};
const months = Array.from({ length: 12 }, (_, index) => new Date(2026, index, 1).toLocaleDateString('pl-PL', { month: 'long' }));

export default function SellerDatePicker({ value, onChange, label, onValidityChange }: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  onValidityChange?: (valid: boolean) => void;
}) {
  const id = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(() => displayDate(value));
  const [touched, setTouched] = useState(false);
  const invalid = parseTypedDate(text) === null;
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => parseDate(value));
  const year = month.getFullYear();
  const monthIndex = month.getMonth();
  const today = isoDate(new Date());
  const first = new Date(year, monthIndex, 1);
  const offset = (first.getDay() + 6) % 7;
  const days = Array.from({ length: 42 }, (_, index) => new Date(year, monthIndex, index - offset + 1));
  const startYear = Math.min(new Date().getFullYear() - 10, year);
  const endYear = Math.max(new Date().getFullYear() + 20, year);

  useEffect(() => {
    setText(displayDate(value));
    onValidityChange?.(parseTypedDate(displayDate(value)) !== null);
  }, [value, onValidityChange]);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', closeOutside);
    return () => document.removeEventListener('pointerdown', closeOutside);
  }, [open]);

  const choose = (next: string) => {
    setText(displayDate(next));
    setTouched(false);
    onValidityChange?.(true);
    onChange(next);
    setOpen(false);
    triggerRef.current?.focus();
  };

  return (
    <div ref={rootRef} className="relative min-w-0" onKeyDown={(event) => {
      if (event.key === 'Escape' && open) {
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
        triggerRef.current?.focus();
      }
    }} onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
    }}>
      <label htmlFor={`${id}-input`} className="text-xs text-[#e5e4e2]/50">{label}</label>
      <div className="relative mt-1.5">
        <input ref={triggerRef} id={`${id}-input`} type="text" inputMode="text" autoComplete="off"
          placeholder="DD.MM.RRRR" value={text} aria-invalid={touched && invalid}
          aria-describedby={`${id}-hint`}
          onChange={(event) => {
            const next = event.target.value;
            setText(next);
            const parsed = parseTypedDate(next);
            onValidityChange?.(parsed !== null);
            if (parsed !== null) { onChange(parsed); if (parsed) setMonth(parseDate(parsed)); }
          }}
          onBlur={() => { setTouched(true); const parsed = parseTypedDate(text); if (parsed !== null) setText(displayDate(parsed)); }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault(); setTouched(true);
              const parsed = parseTypedDate(text);
              if (parsed !== null) choose(parsed);
            }
            if (event.key === 'ArrowDown' && event.altKey) {
              event.preventDefault(); setMonth(parseDate(value)); setOpen(true);
            }
          }}
          className="h-11 w-full rounded-lg border border-white/10 bg-[var(--brand-burgundy-950)] pl-3 pr-12 text-sm text-[var(--brand-platinum)] outline-none placeholder:text-white/35 focus:border-[#d3bb73]/30" />
        <button type="button" aria-label={`Otwórz kalendarz: ${label}`} aria-expanded={open} aria-controls={`${id}-calendar`} aria-haspopup="dialog"
          onClick={() => { if (!open) setMonth(parseDate(value)); setOpen(!open); }}
          className="absolute right-1 top-1 flex h-9 w-9 items-center justify-center rounded-lg border-0 text-[#d3bb73] outline-none hover:bg-white/5 focus-visible:bg-white/10 focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[#d3bb73]/30">
          <CalendarDays className="h-4 w-4" />
        </button>
      </div>
      <p id={`${id}-hint`} className={touched && invalid ? 'mt-1 text-xs text-rose-300' : 'sr-only'}>
        {touched && invalid ? 'Wpisz poprawną datę w formacie DD.MM.RRRR.' : 'Wpisz datę DD.MM.RRRR lub wybierz ją z kalendarza.'}
      </p>
      {open && <div id={`${id}-calendar`} role="dialog" aria-label={`Wybierz: ${label}`} className="absolute left-0 top-full z-50 mt-2 w-[min(20rem,calc(100vw-4rem))] rounded-xl bg-[var(--brand-burgundy-800)] p-3 text-[var(--brand-platinum)] shadow-2xl ring-1 ring-white/10 [&_button]:border-0 [&_button]:outline-none [&_button:focus-visible]:bg-white/10 [&_button:focus-visible]:ring-1 [&_button:focus-visible]:ring-inset [&_button:focus-visible]:ring-[#d3bb73]/30">
        <div className="mb-3 flex items-center gap-1">
          <button type="button" aria-label="Poprzedni miesiąc" onClick={() => setMonth(new Date(year, monthIndex - 1, 1))} className="rounded-lg p-2 hover:bg-white/10"><ChevronLeft className="h-4 w-4" /></button>
          <select aria-label="Miesiąc" value={monthIndex} onChange={(event) => setMonth(new Date(year, Number(event.target.value), 1))} className="h-9 min-w-0 flex-1 rounded-lg bg-[var(--brand-burgundy-950)] px-2 text-xs">{months.map((name, index) => <option key={name} value={index}>{name}</option>)}</select>
          <select aria-label="Rok" value={year} onChange={(event) => setMonth(new Date(Number(event.target.value), monthIndex, 1))} className="h-9 rounded-lg bg-[var(--brand-burgundy-950)] px-1 text-xs">{Array.from({ length: endYear - startYear + 1 }, (_, index) => startYear + index).map((item) => <option key={item} value={item}>{item}</option>)}</select>
          <button type="button" aria-label="Następny miesiąc" onClick={() => setMonth(new Date(year, monthIndex + 1, 1))} className="rounded-lg p-2 hover:bg-white/10"><ChevronRight className="h-4 w-4" /></button>
        </div>
        <div className="grid grid-cols-7 gap-1 text-center text-xs">
          {['Pn', 'Wt', 'Śr', 'Cz', 'Pt', 'So', 'Nd'].map((day) => <span key={day} className="py-1 text-white/40">{day}</span>)}
          {days.map((day) => {
            const key = isoDate(day);
            return <button key={key} type="button" aria-label={day.toLocaleDateString('pl-PL', { day: 'numeric', month: 'long', year: 'numeric' })} aria-pressed={key === value} aria-current={key === today ? 'date' : undefined} onClick={() => choose(key)}
              className={`h-9 rounded-lg ${key === value ? 'bg-[#d3bb73]/20 font-semibold text-[#d3bb73]' : key === today ? 'bg-white/5 text-[#d3bb73] hover:bg-[#d3bb73]/15' : day.getMonth() === monthIndex ? 'hover:bg-white/10' : 'text-white/25 hover:bg-white/5'}`}>{day.getDate()}</button>;
          })}
        </div>
        <div className="mt-3 flex justify-between text-xs">
          <button data-crm-action="secondary" type="button" onClick={() => choose(today)} className="rounded-lg px-3 py-2 text-[#d3bb73] hover:bg-white/5">Dzisiaj</button>
          <button type="button" onClick={() => choose('')} className="rounded-lg px-3 py-2 text-white/60 hover:bg-white/5">Wyczyść</button>
        </div>
      </div>}
    </div>
  );
}
