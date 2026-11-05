'use client';
import { useState, type FormEvent } from 'react';
import { Check, Loader2, Pencil, RotateCcw, StickyNote, Trash2 } from 'lucide-react';
import {
  SETTLEMENT_CATEGORY_HINTS,
  SETTLEMENT_CATEGORY_LABELS,
  SETTLEMENT_SOURCE_LABELS,
  formatPln,
  settlementLineCanEdit,
  type SettlementCategory,
  type SettlementEditableField,
  type SettlementLine,
} from '@/lib/events/settlement/eventSettlement';
import SettlementSwitch from './SettlementSwitch';
import type { SettlementConfirmRequest } from './SettlementConfirmDialog';
import type { SettlementMutate } from './useEventSettlement';
import {
  formatSettlementDate,
  moneyInputValue,
  parseMoneyInput,
  settlementInputClass,
  smallButtonClass,
} from './settlementUi';

const COST_SWITCH: SettlementCategory[] = ['subcontractor', 'direct_cost'];

export type AskConfirm = (request: SettlementConfirmRequest, run: (note: string, option: boolean) => Promise<boolean>) => void;

export default function SettlementLineRow({
  eventId,
  line,
  canEdit,
  disabled,
  saving,
  mutate,
  askConfirm,
  onEditManual,
}: {
  eventId: string;
  line: SettlementLine;
  /** Podsumowanie w wersji roboczej i osoba może je zmieniać (can_edit z bazy). */
  canEdit: boolean;
  /** Trwa inny zapis — przyciski nieaktywne. */
  disabled: boolean;
  /** Trwa zapis tej pozycji. */
  saving: boolean;
  mutate: SettlementMutate;
  askConfirm: AskConfirm;
  onEditManual: (line: SettlementLine) => void;
}) {
  const [editingNet, setEditingNet] = useState(false);
  const [netText, setNetText] = useState('');
  const [netReason, setNetReason] = useState('');
  const [netError, setNetError] = useState('');
  const [editingNote, setEditingNote] = useState(false);
  const [noteText, setNoteText] = useState('');

  const manual = line.source_type === 'manual';
  const can = (field: SettlementEditableField) => canEdit && settlementLineCanEdit(line, field);
  const busyKey = `line:${line.key}`;

  const save = (patch: Record<string, unknown>, message?: string) => {
    const payload = manual
      ? {
          source_type: 'manual',
          line_id: line.line_id,
          kind: line.kind,
          category: line.category,
          name: line.name,
          net_amount: line.net_amount,
          included: line.included,
          note: line.note ?? '',
          ...patch,
        }
      : { source_type: line.source_type, source_id: line.source_id, ...patch };
    return mutate(busyKey, 'save_event_settlement_line', { p_event_id: eventId, p_line: payload }, message);
  };

  // Wyłączenie pozycji automatycznej, która domyślnie się wlicza, i zmiana rodzaju kosztu zmieniają prowizje —
  // baza wymaga powodu (notatki), więc pytamy o niego przed zapisem.
  const toggleIncluded = (next: boolean) => {
    if (!next && !manual && line.auto_included) {
      askConfirm(
        {
          key: `exclude:${line.key}`,
          title: 'Wyłącz pozycję z podsumowania',
          description: line.name,
          confirmLabel: 'Wyłącz pozycję',
          note: {
            label: 'Powód wyłączenia',
            required: true,
            initial: line.note ?? '',
            placeholder: 'Np. faktura dotyczy innego wydarzenia',
          },
        },
        note => save({ included: false, note }, 'Pozycja wyłączona z podsumowania.'),
      );
      return;
    }
    // Włączenie pozycji, którą system pominął (np. zastąpiona prognoza) — też z powodem.
    if (next && !manual && !line.auto_included) {
      askConfirm(
        {
          key: `include:${line.key}`,
          title: 'Wlicz pozycję do podsumowania',
          description: line.name,
          body: line.auto_note ? <p className="text-sm text-[#e5e4e2]/70">System ją pominął: {line.auto_note}</p> : undefined,
          confirmLabel: 'Wlicz pozycję',
          note: {
            label: 'Powód wliczenia',
            required: true,
            initial: line.note ?? '',
            placeholder: 'Np. faktura końcowa dotyczy innego zakresu',
          },
        },
        note => save({ included: true, note }, 'Pozycja wliczona do podsumowania.'),
      );
      return;
    }
    void save({ included: next }, next ? 'Pozycja wliczona do podsumowania.' : 'Pozycja wyłączona z podsumowania.');
  };

  const changeCategory = (category: SettlementCategory) =>
    askConfirm(
      {
        key: `category:${line.key}:${category}`,
        title: `Zmienić rodzaj kosztu na „${SETTLEMENT_CATEGORY_LABELS[category]}”?`,
        description: line.name,
        body: <p className="text-sm text-[#e5e4e2]/70">{SETTLEMENT_CATEGORY_HINTS[category]}</p>,
        confirmLabel: 'Zmień rodzaj kosztu',
        note: {
          label: 'Powód zmiany rodzaju kosztu',
          required: true,
          initial: line.note ?? '',
          placeholder: 'Np. zespół muzyczny bez naszej marży — wykonawca zewnętrzny',
        },
      },
      note => save({ category, note }, `Rodzaj kosztu: ${SETTLEMENT_CATEGORY_LABELS[category].toLowerCase()}.`),
    );

  const startNet = () => {
    setNetText(moneyInputValue(line.net_amount));
    setNetReason(line.note ?? '');
    setNetError('');
    setEditingNet(true);
  };
  const submitNet = async (event: FormEvent) => {
    event.preventDefault();
    const value = parseMoneyInput(netText);
    if (value === null) {
      setNetError('Podaj kwotę netto (nie ujemną), np. 1250,00.');
      return;
    }
    // Powód zapisuje się jako notatka pozycji; baza wymaga go, gdy koszt jest niższy (przychód wyższy) niż w dokumentach.
    if (await save({ net_amount: value, note: netReason.trim() }, 'Kwota netto zapisana i potwierdzona.')) setEditingNet(false);
  };

  const startNote = () => {
    setNoteText(line.note ?? '');
    setEditingNote(true);
  };
  const submitNote = async (event: FormEvent) => {
    event.preventDefault();
    if (await save({ note: noteText.trim() }, 'Notatka zapisana.')) setEditingNote(false);
  };

  const resetOverride = () =>
    askConfirm(
      {
        key: `reset:${line.key}`,
        title: 'Przywrócić wartości automatyczne?',
        description: line.name,
        body: (
          <p className="text-sm text-[#e5e4e2]/70">
            Zmiany tej pozycji (wliczenie, rodzaj kosztu, kwota netto, potwierdzenie i notatka) zostaną usunięte — pozycja wróci do
            wartości z dokumentów.
          </p>
        ),
        confirmLabel: 'Przywróć',
      },
      () => mutate(busyKey, 'delete_event_settlement_line', { p_line_id: line.line_id }, 'Przywrócono wartości automatyczne.'),
    );

  const deleteManual = () =>
    askConfirm(
      {
        key: `delete:${line.key}`,
        title: 'Usunąć pozycję?',
        description: line.name,
        body: <p className="text-sm text-[#e5e4e2]/70">Pozycja dopisana ręcznie zniknie z podsumowania.</p>,
        confirmLabel: 'Usuń pozycję',
        tone: 'danger',
      },
      () => mutate(busyKey, 'delete_event_settlement_line', { p_line_id: line.line_id }, 'Pozycja usunięta.'),
    );

  const meta = [
    line.detail,
    line.date ? formatSettlementDate(line.date) : null,
    SETTLEMENT_SOURCE_LABELS[line.source_type] ?? line.source_type,
  ].filter(Boolean);
  const showSuggested = line.auto && line.suggested_net != null && line.suggested_net !== line.net_amount;
  const showCategorySwitch = !manual && line.kind === 'cost' && can('category') && COST_SWITCH.includes(line.category);
  const showControls =
    canEdit && (can('included') || can('net') || can('note') || can('confirm') || showCategorySwitch || (manual && can('delete')));

  return (
    <li className={`rounded-lg px-3 py-3 ${line.included ? 'bg-white/[0.03]' : 'bg-white/[0.015]'}`} aria-busy={saving}>
      <div className={`flex flex-wrap items-start justify-between gap-3 ${line.included ? '' : 'opacity-55'}`}>
        <div className="min-w-0 flex-1">
          <p className={`break-words text-sm text-[#e5e4e2] ${line.included ? '' : 'line-through decoration-white/30'}`}>{line.name}</p>
          {meta.length > 0 && <p className="mt-0.5 break-words text-xs text-[#e5e4e2]/55">{meta.join(' · ')}</p>}
          {line.auto_note && <p className="mt-0.5 break-words text-xs text-[#e5e4e2]/45">{line.auto_note}</p>}
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {!line.included && (
              <span className="rounded-md bg-white/10 px-2 py-0.5 text-[11px] text-[#e5e4e2]/70">Wyłączone z podsumowania</span>
            )}
            {line.needs_confirmation && (
              <span className="rounded-md bg-amber-400/15 px-2 py-0.5 text-[11px] text-amber-200">Do potwierdzenia netto</span>
            )}
            {manual && line.kind === 'cost' && (
              <span className="rounded-md bg-white/5 px-2 py-0.5 text-[11px] text-[#e5e4e2]/60">
                {SETTLEMENT_CATEGORY_LABELS[line.category] ?? line.category}
              </span>
            )}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-sm font-medium tabular-nums text-[#e5e4e2]">
            {formatPln(line.net_amount)} <span className="text-xs font-normal text-[#e5e4e2]/45">netto</span>
          </p>
          {line.gross_amount != null && (
            <p className="text-xs tabular-nums text-[#e5e4e2]/45">brutto {formatPln(line.gross_amount)}</p>
          )}
          {showSuggested && (
            <p className="text-xs tabular-nums text-[#d3bb73]/75" title="Kwota wyliczona z dokumentów przed zmianą">
              wyliczone: {formatPln(line.suggested_net)}
            </p>
          )}
        </div>
      </div>

      {line.source_changed && (
        <p role="status" className="mt-2 rounded-md bg-amber-400/10 px-2.5 py-1.5 text-xs text-amber-100">
          Kwota źródła zmieniła się z {formatPln(line.previous_source_net)} na {formatPln(line.suggested_net)} — potwierdź ponownie.
          {canEdit && !can('confirm') && can('net') && ' Wpisz kwotę ponownie („Zmień netto”) albo przywróć wartości automatyczne.'}
        </p>
      )}
      {line.note && !editingNote && (
        <p className="mt-2 whitespace-pre-wrap break-words rounded-md bg-black/15 px-2.5 py-1.5 text-xs text-[#e5e4e2]/75">
          <span className="text-[#e5e4e2]/45">Notatka: </span>
          {line.note}
        </p>
      )}
      {line.updated_by_name && (
        <p className="mt-1 text-[11px] text-[#e5e4e2]/35">
          Zmienione: {line.updated_by_name}
          {line.updated_at ? ` · ${formatSettlementDate(line.updated_at, true)}` : ''}
        </p>
      )}

      {showControls && (
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          {saving && <Loader2 className="h-4 w-4 animate-spin text-[#d3bb73]" aria-label="Zapisywanie" />}
          {can('included') && (
            <SettlementSwitch
              checked={line.included}
              onChange={toggleIncluded}
              label="Wliczona"
              disabled={disabled}
              title={line.included ? 'Wyłącz pozycję z podsumowania' : 'Wlicz pozycję do podsumowania'}
            />
          )}
          {showCategorySwitch && (
            <div role="radiogroup" aria-label="Rodzaj kosztu" className="inline-flex rounded-lg bg-white/5 p-0.5">
              {COST_SWITCH.map(category => {
                const active = line.category === category;
                return (
                  <button
                    key={category}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    disabled={disabled || active}
                    title={SETTLEMENT_CATEGORY_HINTS[category]}
                    onClick={() => changeCategory(category)}
                    className={`rounded-md px-2.5 py-1 text-xs transition-colors disabled:cursor-default ${
                      active ? 'bg-[#d3bb73]/20 text-[#d3bb73]' : 'text-[#e5e4e2]/60 hover:bg-white/5 hover:text-[#e5e4e2]'
                    }`}
                  >
                    {SETTLEMENT_CATEGORY_LABELS[category]}
                  </button>
                );
              })}
            </div>
          )}
          {line.needs_confirmation && can('confirm') && !editingNet && (
            <button
              type="button"
              disabled={disabled}
              onClick={() => void save({ confirmed: true }, 'Kwota netto potwierdzona.')}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#d3bb73]/15 px-2.5 py-1.5 text-xs text-[#d3bb73] hover:bg-[#d3bb73]/25 disabled:cursor-not-allowed disabled:opacity-45"
            >
              <Check className="h-3.5 w-3.5" aria-hidden />
              Potwierdź netto
            </button>
          )}
          {can('net') && !manual && !editingNet && (
            <button type="button" disabled={disabled} onClick={startNet} className={smallButtonClass}>
              <Pencil className="h-3.5 w-3.5" aria-hidden />
              Zmień netto
            </button>
          )}
          {can('note') && !manual && !editingNote && (
            <button type="button" disabled={disabled} onClick={startNote} className={smallButtonClass}>
              <StickyNote className="h-3.5 w-3.5" aria-hidden />
              {line.note ? 'Zmień notatkę' : 'Notatka'}
            </button>
          )}
          {manual && can('name') && (
            <button type="button" disabled={disabled} onClick={() => onEditManual(line)} className={smallButtonClass}>
              <Pencil className="h-3.5 w-3.5" aria-hidden />
              Edytuj
            </button>
          )}
          {manual && can('delete') && (
            <button
              type="button"
              disabled={disabled}
              onClick={deleteManual}
              className="inline-flex items-center gap-1.5 rounded-lg bg-red-500/10 px-2.5 py-1.5 text-xs text-red-200 hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-45"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
              Usuń
            </button>
          )}
          {!manual && line.line_id && canEdit && (
            <button type="button" disabled={disabled} onClick={resetOverride} className={smallButtonClass} title="Usuń zmiany tej pozycji">
              <RotateCcw className="h-3.5 w-3.5" aria-hidden />
              Przywróć automatyczne
            </button>
          )}
        </div>
      )}

      {showCategorySwitch && (
        <p className="mt-1.5 text-[11px] leading-relaxed text-[#e5e4e2]/40">{SETTLEMENT_CATEGORY_HINTS[line.category]}</p>
      )}

      {editingNet && (
        <form onSubmit={submitNet} className="mt-2.5 flex flex-wrap items-end gap-2" noValidate>
          <label className="block min-w-[10rem] flex-1 text-xs text-[#e5e4e2]/60 sm:max-w-[14rem]">
            Kwota netto (zł)
            <input
              autoFocus
              type="number"
              min={0}
              step="0.01"
              inputMode="decimal"
              value={netText}
              disabled={disabled}
              aria-invalid={Boolean(netError)}
              onChange={event => {
                setNetText(event.target.value);
                if (netError) setNetError('');
              }}
              className={`${settlementInputClass} mt-1`}
            />
          </label>
          <label className="block w-full text-xs text-[#e5e4e2]/60">
            Powód zmiany kwoty <span className="text-[#e5e4e2]/40">(wymagany, gdy koszt jest niższy albo przychód wyższy niż w dokumentach)</span>
            <textarea
              rows={2}
              maxLength={2000}
              value={netReason}
              disabled={disabled}
              placeholder="Np. faktura brutto 3 690 zł = 3 000 zł netto"
              onChange={event => setNetReason(event.target.value)}
              className={`${settlementInputClass} mt-1`}
            />
          </label>
          <button type="submit" disabled={disabled} className="rounded-lg bg-[#d3bb73] px-3 py-2 text-xs font-medium text-[#210811] disabled:opacity-50">
            Zapisz netto
          </button>
          {line.suggested_net != null && line.suggested_net !== line.net_amount && (
            <button
              type="button"
              disabled={disabled}
              onClick={async () => {
                if (await save({ net_amount: line.suggested_net }, 'Przywrócono kwotę wyliczoną.')) setEditingNet(false);
              }}
              className={smallButtonClass}
            >
              Przywróć {formatPln(line.suggested_net)}
            </button>
          )}
          <button type="button" disabled={disabled} onClick={() => setEditingNet(false)} className={smallButtonClass}>
            Anuluj
          </button>
          {netError && (
            <p role="alert" className="w-full text-xs text-red-200">
              {netError}
            </p>
          )}
          <p className="w-full text-[11px] text-[#e5e4e2]/40">Zapisanie kwoty potwierdza netto tej pozycji.</p>
        </form>
      )}

      {editingNote && (
        <form onSubmit={submitNote} className="mt-2.5 space-y-2" noValidate>
          <label className="block text-xs text-[#e5e4e2]/60">
            Notatka
            <textarea
              autoFocus
              rows={2}
              maxLength={2000}
              value={noteText}
              disabled={disabled}
              onChange={event => setNoteText(event.target.value)}
              className={`${settlementInputClass} mt-1`}
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={disabled} className="rounded-lg bg-[#d3bb73] px-3 py-1.5 text-xs font-medium text-[#210811] disabled:opacity-50">
              Zapisz notatkę
            </button>
            <button type="button" disabled={disabled} onClick={() => setEditingNote(false)} className={smallButtonClass}>
              Anuluj
            </button>
          </div>
        </form>
      )}
    </li>
  );
}
