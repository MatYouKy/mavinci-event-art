'use client';

import { useId } from 'react';

export type ContractTerm = 'fixed' | 'indefinite';

export function isContractDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

const fieldClass = 'w-full rounded-lg border border-white/10 bg-[var(--brand-burgundy-950)] px-3 py-2 text-sm text-[var(--brand-platinum)] outline-none focus:border-[var(--crm-field-border-focus)] disabled:opacity-50';

export function ContractDateField({ label, value, onChange, required = false, disabled = false }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  disabled?: boolean;
}) {
  const id = useId();
  const display = isContractDate(value) ? value.split('-').reverse().join('.') : value;
  const invalid = Boolean(value) && !isContractDate(value);
  return <div>
    <label htmlFor={id} className="mb-1 block text-xs text-[var(--brand-platinum)]/70">{label}{required ? ' *' : ''}</label>
    <div className="flex flex-wrap gap-2">
      <input id={id} type="text" inputMode="numeric" placeholder="DD.MM.RRRR" autoComplete="off"
        value={display} required={required} disabled={disabled} aria-invalid={invalid} aria-describedby={invalid ? `${id}-error` : undefined}
        className={`${fieldClass} min-w-0 flex-1`} onChange={(event) => {
          const raw = event.target.value;
          const match = raw.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
          const iso = match ? `${match[3]}-${match[2]}-${match[1]}` : raw;
          onChange(isContractDate(iso) ? iso : raw);
        }} />
      <input type="date" aria-label={`${label} — wybierz z kalendarza`} value={isContractDate(value) ? value : ''}
        disabled={disabled} className={`${fieldClass} !w-40`} onChange={(event) => onChange(event.target.value)} />
    </div>
    {invalid && <p id={`${id}-error`} className="mt-1 text-xs text-amber-200">Wpisz prawidłową datę w formacie DD.MM.RRRR.</p>}
  </div>;
}

export function ContractTermFields({ term, startDate, endDate, ending, disabled, onTermChange, onStartChange, onEndChange, onEndingChange }: {
  term: ContractTerm | '';
  startDate: string;
  endDate: string;
  ending: boolean;
  disabled?: boolean;
  onTermChange: (value: ContractTerm | '') => void;
  onStartChange: (value: string) => void;
  onEndChange: (value: string) => void;
  onEndingChange: (value: boolean) => void;
}) {
  const id = useId();
  return <section className="space-y-3 rounded-lg bg-white/[0.03] p-4 sm:col-span-2">
    <div><label htmlFor={id} className="mb-1 block text-xs text-[var(--brand-platinum)]/70">Zakres umowy *</label>
      <select id={id} className={fieldClass} value={term} disabled={disabled} onChange={(event) => onTermChange(event.target.value as ContractTerm | '')}>
        <option value="">Wybierz zakres umowy</option><option value="fixed">Na czas określony</option><option value="indefinite">Na czas nieokreślony</option>
      </select>
    </div>
    {term && <>
      <ContractDateField label="Początek obowiązywania" value={startDate} onChange={onStartChange} required disabled={disabled} />
      {term === 'indefinite' && <label className="flex items-center gap-2 text-sm text-[var(--brand-platinum)]/80">
        <input type="checkbox" checked={ending} disabled={disabled} onChange={(event) => onEndingChange(event.target.checked)} className="accent-[#d3bb73]" />Umowa się kończy — podaj datę zakończenia
      </label>}
      {(term === 'fixed' || ending) && <ContractDateField label="Koniec obowiązywania (włącznie)" value={endDate} onChange={onEndChange} required disabled={disabled} />}
      <p className="text-xs leading-5 text-[var(--brand-platinum)]/60">{term === 'fixed'
        ? 'Umowa na czas określony nie jest automatycznie dodawana do kolejnych miesięcy. Daty opisują jej rzeczywisty okres obowiązywania.'
        : 'Ta sama umowa będzie widoczna w kolejnych miesiącach od daty początku do daty zakończenia włącznie. Nie tworzymy kopii dokumentu, nowych faktur ani automatycznych płatności.'}</p>
    </>}
    {!term && <p className="text-xs leading-5 text-[var(--brand-platinum)]/60">Dla starszych umów zakres nie został jeszcze ustalony. Nie uznajemy ich automatycznie za bezterminowe.</p>}
  </section>;
}
