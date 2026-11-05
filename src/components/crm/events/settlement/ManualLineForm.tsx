'use client';
import { useId, useState, type FormEvent } from 'react';
import { Loader2 } from 'lucide-react';
import {
  SETTLEMENT_CATEGORY_HINTS,
  SETTLEMENT_CATEGORY_LABELS,
  type SettlementCategory,
  type SettlementLine,
  type SettlementLineKind,
} from '@/lib/events/settlement/eventSettlement';
import type { SettlementMutate } from './useEventSettlement';
import {
  moneyInputValue,
  parseMoneyInput,
  primaryButtonClass,
  secondaryButtonClass,
  settlementInputClass,
} from './settlementUi';

const COST_CATEGORIES: SettlementCategory[] = ['subcontractor', 'direct_cost', 'team', 'external_commission'];

/** Pozycja dopisana ręcznie: rodzaj, kategoria kosztu, nazwa, netto i notatka (zapis: save_event_settlement_line). */
export default function ManualLineForm({
  eventId,
  line,
  busy,
  mutate,
  onClose,
}: {
  eventId: string;
  /** Edytowana pozycja ręczna; null = nowa. */
  line: SettlementLine | null;
  busy: string | null;
  mutate: SettlementMutate;
  onClose: () => void;
}) {
  const id = useId();
  const [kind, setKind] = useState<SettlementLineKind>(line?.kind ?? 'cost');
  const [category, setCategory] = useState<SettlementCategory>(
    line && line.kind === 'cost' && COST_CATEGORIES.includes(line.category) ? line.category : 'direct_cost',
  );
  const [name, setName] = useState(line?.name ?? '');
  const [net, setNet] = useState(line ? moneyInputValue(line.net_amount) : '');
  const [note, setNote] = useState(line?.note ?? '');
  const [error, setError] = useState('');
  const saving = busy === 'manual';

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const trimmedName = name.trim();
    if (!trimmedName || trimmedName.length > 300) {
      setError('Podaj nazwę pozycji (do 300 znaków).');
      return;
    }
    const value = parseMoneyInput(net);
    if (value === null) {
      setError('Podaj kwotę netto (nie ujemną) z dokładnością do grosza, np. 1250,00. Korektę przychodu wystawia się fakturą korygującą.');
      return;
    }
    setError('');
    const ok = await mutate(
      'manual',
      'save_event_settlement_line',
      {
        p_event_id: eventId,
        p_line: {
          source_type: 'manual',
          ...(line?.line_id ? { line_id: line.line_id } : {}),
          kind,
          category: kind === 'revenue' ? 'revenue' : category,
          name: trimmedName,
          net_amount: value,
          included: line ? line.included : true,
          note: note.trim(),
        },
      },
      line ? 'Pozycja zapisana.' : 'Pozycja dodana do podsumowania.',
    );
    if (ok) onClose();
  };

  return (
    <form onSubmit={submit} noValidate className="space-y-3 rounded-lg bg-black/20 p-3 sm:p-4" aria-busy={saving}>
      <p className="text-sm font-medium text-[#e5e4e2]">{line ? 'Edytuj pozycję dopisaną ręcznie' : 'Nowa pozycja'}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <span className="block text-xs text-[#e5e4e2]/60">Rodzaj</span>
          <div role="radiogroup" aria-label="Rodzaj pozycji" className="mt-1 inline-flex rounded-lg bg-white/5 p-0.5">
            {(['revenue', 'cost'] as SettlementLineKind[]).map(option => (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={kind === option}
                disabled={saving}
                onClick={() => setKind(option)}
                className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
                  kind === option ? 'bg-[#d3bb73]/20 text-[#d3bb73]' : 'text-[#e5e4e2]/60 hover:bg-white/5'
                }`}
              >
                {option === 'revenue' ? 'Przychód' : 'Koszt'}
              </button>
            ))}
          </div>
        </div>
        {kind === 'cost' && (
          <label className="block text-xs text-[#e5e4e2]/60">
            Rodzaj kosztu
            <select
              value={category}
              disabled={saving}
              onChange={event => setCategory(event.target.value as SettlementCategory)}
              aria-describedby={`${id}-hint`}
              className={`${settlementInputClass} mt-1`}
            >
              {COST_CATEGORIES.map(option => (
                <option key={option} value={option}>
                  {SETTLEMENT_CATEGORY_LABELS[option]}
                </option>
              ))}
            </select>
            <span id={`${id}-hint`} className="mt-1 block text-[11px] leading-relaxed text-[#e5e4e2]/40">
              {SETTLEMENT_CATEGORY_HINTS[category]}
            </span>
          </label>
        )}
        <label className="block text-xs text-[#e5e4e2]/60 sm:col-span-2">
          Nazwa
          <input
            value={name}
            maxLength={300}
            disabled={saving}
            onChange={event => setName(event.target.value)}
            placeholder={kind === 'revenue' ? 'Np. dopłata klienta gotówką' : 'Np. wynajem namiotu'}
            className={`${settlementInputClass} mt-1`}
          />
        </label>
        <label className="block text-xs text-[#e5e4e2]/60">
          Kwota netto (zł)
          <input
            type="number"
            min={0}
            step="0.01"
            inputMode="decimal"
            value={net}
            disabled={saving}
            onChange={event => setNet(event.target.value)}
            placeholder="0,00"
            className={`${settlementInputClass} mt-1`}
          />
        </label>
        <label className="block text-xs text-[#e5e4e2]/60 sm:col-span-2">
          Notatka <span className="text-[#e5e4e2]/35">(opcjonalnie)</span>
          <textarea
            rows={2}
            maxLength={2000}
            value={note}
            disabled={saving}
            onChange={event => setNote(event.target.value)}
            className={`${settlementInputClass} mt-1`}
          />
        </label>
      </div>
      {error && (
        <p role="alert" className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-200">
          {error}
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" disabled={saving} onClick={onClose} className={secondaryButtonClass}>
          Anuluj
        </button>
        <button type="submit" disabled={Boolean(busy)} className={primaryButtonClass}>
          {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
          {line ? 'Zapisz pozycję' : 'Dodaj pozycję'}
        </button>
      </div>
    </form>
  );
}
