'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Clock3 } from 'lucide-react';

const options = (count: number) => Array.from({ length: count }, (_, index) => String(index).padStart(2, '0'));

export default function SellerTimePicker({ value, onChange, label, ariaLabel, align = 'left' }: {
  value: string; onChange: (value: string) => void; label: string; ariaLabel: string; align?: 'left' | 'right';
}) {
  const id = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const hourRef = useRef<HTMLSelectElement>(null);
  const [open, setOpen] = useState(false);
  const [hour = '', minute = '00'] = value.split(':');
  const close = () => { setOpen(false); triggerRef.current?.focus(); };

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: Event) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('focusin', closeOutside);
    hourRef.current?.focus();
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('focusin', closeOutside);
    };
  }, [open]);

  return <div ref={rootRef} className="relative min-w-0" onKeyDown={event => {
    if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); close(); }
  }}>
    <label htmlFor={id} className="text-xs text-white/50">{label}</label>
    <button ref={triggerRef} id={id} type="button" aria-label={ariaLabel + (value ? ': ' + value : ' — do ustalenia')}
      aria-haspopup="dialog" aria-expanded={open} aria-controls={id + '-panel'} onClick={() => setOpen(current => !current)}
      className="mt-1.5 flex h-11 w-full items-center justify-between gap-1 rounded-lg border border-white/10 bg-[var(--brand-burgundy-950)] px-2 text-sm outline-none focus-visible:border-[#d3bb73]/30">
      <span className={value ? 'tabular-nums text-[var(--brand-platinum)]' : 'text-white/40'}>{value || 'HH:MM'}</span>
      <Clock3 className="h-3.5 w-3.5 shrink-0 text-[#d3bb73]" />
    </button>
    {open && <div id={id + '-panel'} role="dialog" aria-label={ariaLabel} data-seller-time-picker
      className={`absolute top-full z-50 mt-2 w-56 rounded-xl bg-[var(--brand-burgundy-800)] p-3 text-[var(--brand-platinum)] shadow-xl ring-1 ring-white/5 ${align === 'left' ? 'left-0' : 'right-0'}`}>
      <div className="grid grid-cols-2 gap-3">
        <label className="text-xs text-white/60">Godzina
          <select ref={hourRef} aria-label={ariaLabel + ' — godzina'} value={hour} onChange={event => onChange(event.target.value ? event.target.value + ':' + minute : '')}
            className="mt-1.5 h-11 w-full rounded-lg border border-white/10 bg-[var(--brand-burgundy-950)] px-2 text-base outline-none focus:border-[#d3bb73]/30">
            <option value="">HH</option>{options(24).map(item => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
        <label className="text-xs text-white/60">Minuta
          <select aria-label={ariaLabel + ' — minuta'} value={minute} disabled={!hour} onChange={event => onChange(hour + ':' + event.target.value)}
            className="mt-1.5 h-11 w-full rounded-lg border border-white/10 bg-[var(--brand-burgundy-950)] px-2 text-base outline-none focus:border-[#d3bb73]/30 disabled:opacity-40">
            {options(60).map(item => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
      </div>
      <div className="mt-3 flex items-center justify-between gap-2 text-xs">
        <button type="button" onClick={() => { onChange(''); close(); }} className="rounded-lg px-2 py-2 text-white/60 hover:bg-white/5">Wyczyść</button>
        <button type="button" onClick={close} className="rounded-lg bg-[#d3bb73]/15 px-3 py-2 text-[#d3bb73]">Gotowe</button>
      </div>
    </div>}
  </div>;
}
