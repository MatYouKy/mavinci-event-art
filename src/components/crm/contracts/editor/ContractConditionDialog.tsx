'use client';

import { useEffect, useMemo, useState } from 'react';
import { Building2, CalendarDays, ListChecks, TextCursorInput, X } from 'lucide-react';
import {
  CONTRACT_CATEGORY_VARIABLE,
  CONTRACT_CLIENT_VARIABLE,
  CONTRACT_OPTION_PREFIX,
  contractOptionKeyFromLabel,
  contractOptionVariable,
  describeContractCondition,
  parseContractCondition,
  serializeContractCondition,
  type ContractCondition,
  type ContractOption,
} from '@/lib/CRM/contracts/contractConditions';

type Kind = 'client' | 'category' | 'option' | 'filled';

export interface ContractConditionDialogProps {
  /** Warunek do zmiany (`null` — nowy). */
  initial: string | null;
  /** Gdzie trafi warunek — informacja w nagłówku („Zaznaczone akapity (sekcja)”, „Punkt listy”…). */
  scopeLabel: string;
  options: ContractOption[];
  categories: string[];
  fields: Array<{ key: string; label: string }>;
  onApply: (condition: string, options: ContractOption[]) => void;
  onRemove?: () => void;
  onClose: () => void;
}

const KINDS: Array<{ id: Kind; label: string; hint: string; icon: typeof Building2 }> = [
  { id: 'client', label: 'Klient', hint: 'firma albo osoba prywatna — z danych wydarzenia', icon: Building2 },
  { id: 'category', label: 'Rodzaj wydarzenia', hint: 'kategoria wydarzenia, np. Wesele', icon: CalendarDays },
  { id: 'option', label: 'Opcja umowy', hint: 'włączana przy każdej umowie, np. nocleg', icon: ListChecks },
  { id: 'filled', label: 'Pole wypełnione', hint: 'np. numer zamówienia klienta', icon: TextCursorInput },
];

const kindOf = (condition: ContractCondition | null): Kind => {
  if (!condition) return 'client';
  if (condition.kind === 'client' || condition.kind === 'category' || condition.kind === 'option') return condition.kind;
  return 'filled';
};

/** Okno warunku: kiedy akapit, punkt albo sekcja ma się znaleźć w umowie. */
export default function ContractConditionDialog({ initial, scopeLabel, options, categories, fields, onApply, onRemove, onClose }: ContractConditionDialogProps) {
  const parsed = useMemo(() => parseContractCondition(initial), [initial]);
  const [kind, setKind] = useState<Kind>(kindOf(parsed));
  const [negate, setNegate] = useState(parsed?.negate ?? false);
  const [client, setClient] = useState(parsed?.kind === 'client' ? parsed.values[0]?.toLowerCase() || 'firma' : 'firma');
  const [selectedCategories, setSelectedCategories] = useState<string[]>(parsed?.kind === 'category' ? parsed.values : []);
  const [optionList, setOptionList] = useState<ContractOption[]>(options);
  const [optionKey, setOptionKey] = useState(parsed?.kind === 'option' ? parsed.variable.slice(CONTRACT_OPTION_PREFIX.length) : options[0]?.key || '');
  const [newOption, setNewOption] = useState('');
  const [field, setField] = useState(parsed && (parsed.kind === 'filled' || parsed.kind === 'equals') ? parsed.variable : fields[0]?.key || '');

  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [onClose]);

  const categoryChoices = useMemo(
    () => Array.from(new Set([...categories, ...selectedCategories])).sort((a, b) => a.localeCompare(b, 'pl')),
    [categories, selectedCategories],
  );

  const addOption = () => {
    const label = newOption.trim();
    if (!label) return;
    const key = contractOptionKeyFromLabel(label, optionList.map((option) => option.key));
    setOptionList((current) => [...current, { key, label, defaultOn: true }]);
    setOptionKey(key);
    setNewOption('');
  };

  const condition: ContractCondition | null = (() => {
    if (kind === 'client') return { kind, variable: CONTRACT_CLIENT_VARIABLE, values: [client], negate: false };
    if (kind === 'category') {
      return selectedCategories.length ? { kind, variable: CONTRACT_CATEGORY_VARIABLE, values: selectedCategories, negate } : null;
    }
    if (kind === 'option') return optionKey ? { kind, variable: contractOptionVariable(optionKey), values: [], negate } : null;
    return field ? { kind: 'filled', variable: field, values: [], negate } : null;
  })();
  const expression = condition ? serializeContractCondition(condition) : '';
  const fieldLabels = Object.fromEntries(fields.map((item) => [item.key, item.label]));

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="contract-condition-title"
        className="w-full max-w-xl rounded-xl border border-white/10 bg-[#1c1f33] shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-3">
          <div>
            <h2 id="contract-condition-title" className="text-base font-medium text-[#e5e4e2]">{initial ? 'Zmień warunek' : 'Dodaj warunek'}</h2>
            <p className="text-xs text-[#e5e4e2]/50">{scopeLabel} — pojawi się w umowie tylko, gdy warunek jest spełniony.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Zamknij" className="rounded p-1 text-[#e5e4e2]/60 hover:bg-white/10 hover:text-[#e5e4e2]">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 px-5 py-4">
          <div className="grid grid-cols-2 gap-2">
            {KINDS.map(({ id, label, hint, icon: Icon }) => (
              <button
                key={id}
                type="button"
                aria-pressed={kind === id}
                onClick={() => setKind(id)}
                className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-left ${kind === id ? 'border-[#d3bb73] bg-[#d3bb73]/10' : 'border-white/10 hover:bg-white/5'}`}
              >
                <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${kind === id ? 'text-[#d3bb73]' : 'text-[#e5e4e2]/60'}`} />
                <span>
                  <span className="block text-sm text-[#e5e4e2]">{label}</span>
                  <span className="block text-[11px] text-[#e5e4e2]/50">{hint}</span>
                </span>
              </button>
            ))}
          </div>

          {kind === 'client' && (
            <div className="flex gap-2">
              {[['firma', 'Firma (organizacja)'], ['osoba', 'Osoba prywatna']].map(([value, label]) => (
                <label key={value} className={`flex flex-1 cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm ${client === value ? 'border-[#d3bb73] text-[#d3bb73]' : 'border-white/10 text-[#e5e4e2]/80'}`}>
                  <input type="radio" name="contract-client" checked={client === value} onChange={() => setClient(value)} className="accent-[#d3bb73]" />
                  {label}
                </label>
              ))}
            </div>
          )}

          {kind === 'category' && (
            <div>
              <div className="mb-1 text-xs text-[#e5e4e2]/60">Pokaż dla wydarzeń z kategorii (można kilka):</div>
              <div className="flex max-h-48 flex-wrap gap-1.5 overflow-y-auto">
                {categoryChoices.map((name) => {
                  const active = selectedCategories.includes(name);
                  return (
                    <button
                      key={name}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setSelectedCategories((current) => (active ? current.filter((item) => item !== name) : [...current, name]))}
                      className={`rounded-full border px-3 py-1 text-xs ${active ? 'border-[#d3bb73] bg-[#d3bb73]/15 text-[#d3bb73]' : 'border-white/15 text-[#e5e4e2]/80 hover:bg-white/5'}`}
                    >
                      {name}
                    </button>
                  );
                })}
                {!categoryChoices.length && <span className="text-xs text-[#e5e4e2]/50">Brak kategorii wydarzeń.</span>}
              </div>
            </div>
          )}

          {kind === 'option' && (
            <div className="space-y-2">
              {optionList.length > 0 ? (
                <select
                  value={optionKey}
                  onChange={(event) => setOptionKey(event.target.value)}
                  className="w-full rounded border border-white/15 bg-[#0f1119] px-2 py-1.5 text-sm text-[#e5e4e2]"
                >
                  {optionList.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
                </select>
              ) : (
                <p className="text-xs text-[#e5e4e2]/60">Szablon nie ma jeszcze opcji — dodaj pierwszą.</p>
              )}
              <div className="flex gap-2">
                <input
                  value={newOption}
                  onChange={(event) => setNewOption(event.target.value)}
                  onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addOption(); } }}
                  placeholder="Nowa opcja, np. Nocleg dla wykonawcy"
                  className="flex-1 rounded border border-white/15 bg-[#0f1119] px-2 py-1.5 text-sm text-[#e5e4e2] placeholder:text-[#e5e4e2]/30"
                />
                <button type="button" onClick={addOption} className="rounded-lg bg-white/10 px-3 text-sm text-[#e5e4e2] hover:bg-white/15">Dodaj</button>
              </div>
            </div>
          )}

          {kind === 'filled' && (
            <select
              value={field}
              onChange={(event) => setField(event.target.value)}
              className="w-full rounded border border-white/15 bg-[#0f1119] px-2 py-1.5 text-sm text-[#e5e4e2]"
            >
              {fields.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
            </select>
          )}

          {kind !== 'client' && (
            <label className="flex items-center gap-2 text-sm text-[#e5e4e2]/80">
              <input type="checkbox" checked={negate} onChange={(event) => setNegate(event.target.checked)} className="accent-[#d3bb73]" />
              {kind === 'category' ? 'Odwrotnie — dla wszystkich innych wydarzeń'
                : kind === 'option' ? 'Odwrotnie — gdy opcja jest wyłączona'
                  : 'Odwrotnie — gdy pole jest puste'}
            </label>
          )}

          <div className="rounded-lg border border-[#a083dc]/30 bg-[#a083dc]/10 px-3 py-2 text-sm text-[#cdb9f5]">
            {expression ? describeContractCondition(expression, { options: optionList, fieldLabels }) : 'Wybierz warunek'}
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-white/10 px-5 py-3">
          <div>
            {initial && onRemove && (
              <button type="button" onClick={onRemove} className="rounded-lg px-3 py-2 text-sm text-red-300 hover:bg-red-500/10">Usuń warunek</button>
            )}
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-[#e5e4e2]/80 hover:bg-white/10">Anuluj</button>
            <button
              type="button"
              disabled={!expression}
              onClick={() => onApply(expression, optionList)}
              className="rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#1c1f33] hover:bg-[#d3bb73]/90 disabled:opacity-50"
            >
              Zastosuj
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
