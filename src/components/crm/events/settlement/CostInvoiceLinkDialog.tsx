'use client';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { ArrowLeft, Loader2, Search } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import {
  SETTLEMENT_CATEGORY_HINTS,
  SETTLEMENT_CATEGORY_LABELS,
  formatPln,
} from '@/lib/events/settlement/eventSettlement';
import EventStepDialog from '../steps/EventStepDialog';
import type { SettlementMutate } from './useEventSettlement';
import {
  formatSettlementDate,
  parseMoneyInput,
  primaryButtonClass,
  secondaryButtonClass,
  settlementErrorMessage,
  settlementInputClass,
} from './settlementUi';

type Candidate = {
  source: 'ksef' | 'external';
  id: string;
  number: string | null;
  seller_name: string | null;
  seller_nip: string | null;
  issue_date: string | null;
  net: number | null;
  gross: number | null;
  first_item: string | null;
  allocated: number;
  remaining_gross: number;
  linked_to_event: boolean;
};

type LinkCategory = 'subcontractor' | 'direct_cost';

const toNumber = (value: unknown): number | null => {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
};

function parseCandidates(data: unknown): Candidate[] {
  if (!Array.isArray(data)) return [];
  return data
    .filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === 'object')
    .map(row => ({
      source: row.source === 'ksef' ? 'ksef' : 'external',
      id: String(row.id ?? ''),
      number: typeof row.number === 'string' ? row.number : null,
      seller_name: typeof row.seller_name === 'string' ? row.seller_name : null,
      seller_nip: typeof row.seller_nip === 'string' ? row.seller_nip : null,
      issue_date: typeof row.issue_date === 'string' ? row.issue_date : null,
      net: toNumber(row.net),
      gross: toNumber(row.gross),
      first_item: typeof row.first_item === 'string' ? row.first_item : null,
      allocated: toNumber(row.allocated) ?? 0,
      remaining_gross: toNumber(row.remaining_gross) ?? 0,
      linked_to_event: row.linked_to_event === true,
    }))
    .filter(row => row.id);
}

/** Faktury kosztowe przypisuje tylko osoba z dostępem do finansów wydarzenia (event_finance_can_access w bazie). */
export const COST_INVOICE_FORBIDDEN_MESSAGE = 'Faktury kosztowe przypisuje osoba z dostępem do finansów tego wydarzenia.';

/**
 * „Dodaj fakturę kosztową”: wyszukanie faktury (KSeF / spoza KSeF) → opcjonalna część brutto → rodzaj kosztu →
 * link_event_cost_invoice (baza tworzy koszt wydarzenia i pilnuje, by nie przypisać więcej niż 100% faktury).
 * Bez dostępu do finansów baza zwraca 42501 — okno pokazuje komunikat, a rodzic ukrywa przycisk (onForbidden).
 */
export default function CostInvoiceLinkDialog({
  open,
  eventId,
  busy,
  mutate,
  onClose,
  onForbidden,
}: {
  open: boolean;
  eventId: string;
  busy: string | null;
  mutate: SettlementMutate;
  onClose: () => void;
  onForbidden?: (message: string) => void;
}) {
  const id = useId();
  const [forbidden, setForbidden] = useState('');
  const [search, setSearch] = useState('');
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState('');
  const [selected, setSelected] = useState<Candidate | null>(null);
  const [part, setPart] = useState('');
  const [category, setCategory] = useState<LinkCategory>('direct_cost');
  const [name, setName] = useState('');
  const [formError, setFormError] = useState('');
  const sequence = useRef(0);
  const onForbiddenRef = useRef(onForbidden);
  onForbiddenRef.current = onForbidden;
  const saving = busy === 'link-invoice';

  useEffect(() => {
    if (!open) return;
    setForbidden('');
    setSearch('');
    setSelected(null);
    setPart('');
    setCategory('direct_cost');
    setName('');
    setFormError('');
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const request = ++sequence.current;
    setLoading(true);
    const timer = window.setTimeout(async () => {
      const { data, error } = await supabase.rpc('list_event_cost_invoice_candidates', {
        p_event_id: eventId,
        p_search: search.trim() || null,
        p_limit: 30,
      });
      if (request !== sequence.current) return;
      setLoading(false);
      if (error) {
        setCandidates([]);
        if (error.code === '42501') {
          const message = error.message?.trim() || COST_INVOICE_FORBIDDEN_MESSAGE;
          setForbidden(message);
          setListError('');
          onForbiddenRef.current?.(message);
          return;
        }
        setListError(settlementErrorMessage(error, 'Nie udało się wczytać faktur kosztowych.'));
        return;
      }
      setListError('');
      setCandidates(parseCandidates(data));
    }, search ? 300 : 0);
    return () => window.clearTimeout(timer);
  }, [open, eventId, search]);

  if (!open) return null;

  const close = () => {
    if (!saving) onClose();
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!selected || busy) return;
    let gross: number | null = null;
    if (part.trim()) {
      gross = parseMoneyInput(part);
      if (gross === null || gross <= 0) {
        setFormError('Podaj dodatnią część brutto z dokładnością do grosza albo zostaw puste pole (cała pozostała kwota).');
        return;
      }
    }
    setFormError('');
    const ok = await mutate(
      'link-invoice',
      'link_event_cost_invoice',
      {
        p_event_id: eventId,
        p_source: selected.source,
        p_invoice_id: selected.id,
        p_gross_amount: gross,
        p_category: category,
        p_name: name.trim() || null,
      },
      'Faktura kosztowa przypisana do wydarzenia.',
    );
    if (ok) onClose();
  };

  return (
    <EventStepDialog
      open
      wide
      title="Dodaj fakturę kosztową"
      description="Faktury kosztowe marki wydarzenia, najbliższe dacie wydarzenia i jeszcze nie w pełni przypisane."
      onClose={close}
      busy={saving}
    >
      {forbidden ? (
        <div className="space-y-4">
          <p role="alert" className="rounded-lg bg-amber-400/10 px-3 py-2 text-sm text-amber-100">
            {forbidden}
          </p>
          <div className="flex justify-end">
            <button type="button" onClick={close} className={secondaryButtonClass}>
              Zamknij
            </button>
          </div>
        </div>
      ) : !selected ? (
        <div className="space-y-3">
          <label htmlFor={`${id}-search`} className="sr-only">
            Szukaj faktury
          </label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-white/35" aria-hidden />
            <input
              id={`${id}-search`}
              data-autofocus
              value={search}
              onChange={event => setSearch(event.target.value)}
              placeholder="Numer, sprzedawca, NIP lub pozycja faktury…"
              className={`${settlementInputClass} pl-9`}
            />
          </div>
          {listError && (
            <p role="alert" className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-200">
              {listError}
            </p>
          )}
          {loading && candidates.length === 0 ? (
            <p className="flex items-center gap-2 py-6 text-sm text-[#e5e4e2]/55">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              Szukam faktur…
            </p>
          ) : candidates.length === 0 && !listError ? (
            <p className="py-6 text-center text-sm text-[#e5e4e2]/45">
              {search.trim() ? 'Brak faktur pasujących do wyszukiwania.' : 'Brak faktur kosztowych do przypisania.'}
            </p>
          ) : (
            <ul className="max-h-[50dvh] space-y-1.5 overflow-y-auto" aria-busy={loading}>
              {candidates.map(candidate => (
                <li key={`${candidate.source}:${candidate.id}`}>
                  <button
                    type="button"
                    onClick={() => {
                      setSelected(candidate);
                      setFormError('');
                    }}
                    className="w-full rounded-lg bg-white/[0.03] px-3 py-2.5 text-left transition-colors hover:bg-white/[0.07]"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="break-words text-sm text-[#e5e4e2]">
                          {candidate.seller_name || 'Sprzedawca nieznany'}
                          {candidate.seller_nip && <span className="text-[#e5e4e2]/45"> · NIP {candidate.seller_nip}</span>}
                        </p>
                        <p className="mt-0.5 text-xs text-[#e5e4e2]/55">
                          {[candidate.number || 'bez numeru', formatSettlementDate(candidate.issue_date), candidate.source === 'ksef' ? 'KSeF' : 'spoza KSeF']
                            .filter(Boolean)
                            .join(' · ')}
                        </p>
                        {candidate.first_item && <p className="mt-0.5 break-words text-xs text-[#e5e4e2]/45">{candidate.first_item}</p>}
                      </div>
                      <div className="shrink-0 text-right text-xs tabular-nums">
                        <p className="text-sm text-[#e5e4e2]">{formatPln(candidate.gross)} brutto</p>
                        <p className="text-[#e5e4e2]/50">{formatPln(candidate.net)} netto</p>
                        {candidate.allocated > 0 && (
                          <p className="text-[#d3bb73]/80">do przypisania: {formatPln(candidate.remaining_gross)}</p>
                        )}
                      </div>
                    </div>
                    {candidate.linked_to_event && (
                      <span className="mt-1.5 inline-block rounded-md bg-amber-400/15 px-2 py-0.5 text-[11px] text-amber-200">
                        Część tej faktury jest już przypisana do tego wydarzenia
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <form onSubmit={submit} noValidate className="space-y-4" aria-busy={saving}>
          <button type="button" disabled={saving} onClick={() => setSelected(null)} className="inline-flex items-center gap-1.5 text-xs text-[#d3bb73] hover:underline disabled:opacity-50">
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
            Wybierz inną fakturę
          </button>
          <div className="rounded-lg bg-white/[0.04] px-3 py-2.5 text-sm">
            <p className="text-[#e5e4e2]">
              {selected.seller_name || 'Sprzedawca nieznany'} · {selected.number || 'bez numeru'}
            </p>
            <p className="mt-0.5 text-xs text-[#e5e4e2]/55">
              {formatPln(selected.gross)} brutto · {formatPln(selected.net)} netto · {formatSettlementDate(selected.issue_date)}
            </p>
            <p className="mt-0.5 text-xs text-[#d3bb73]/80">Pozostało do przypisania: {formatPln(selected.remaining_gross)} brutto</p>
          </div>
          <label className="block text-sm text-[#e5e4e2]/70">
            Część brutto dla tego wydarzenia <span className="text-[#e5e4e2]/40">(opcjonalnie)</span>
            <input
              data-autofocus
              type="number"
              min={0.01}
              step="0.01"
              inputMode="decimal"
              value={part}
              disabled={saving}
              onChange={event => setPart(event.target.value)}
              placeholder={`Cała pozostała kwota (${formatPln(selected.remaining_gross)})`}
              className={`${settlementInputClass} mt-1`}
            />
            <span className="mt-1 block text-xs text-[#e5e4e2]/40">
              Puste pole = cała pozostała kwota. Netto pozycji wyliczy baza z faktury.
            </span>
          </label>
          <div>
            <span className="block text-sm text-[#e5e4e2]/70">Rodzaj kosztu</span>
            <div role="radiogroup" aria-label="Rodzaj kosztu" className="mt-1 grid gap-2 sm:grid-cols-2">
              {(['subcontractor', 'direct_cost'] as LinkCategory[]).map(option => (
                <button
                  key={option}
                  type="button"
                  role="radio"
                  aria-checked={category === option}
                  disabled={saving}
                  onClick={() => setCategory(option)}
                  className={`rounded-lg px-3 py-2 text-left transition-colors ${
                    category === option ? 'bg-[#d3bb73]/15 text-[#e5e4e2]' : 'bg-white/[0.03] text-[#e5e4e2]/70 hover:bg-white/[0.06]'
                  }`}
                >
                  <span className={`block text-sm ${category === option ? 'text-[#d3bb73]' : ''}`}>{SETTLEMENT_CATEGORY_LABELS[option]}</span>
                  <span className="mt-0.5 block text-[11px] leading-relaxed text-[#e5e4e2]/50">{SETTLEMENT_CATEGORY_HINTS[option]}</span>
                </button>
              ))}
            </div>
          </div>
          <label className="block text-sm text-[#e5e4e2]/70">
            Nazwa pozycji <span className="text-[#e5e4e2]/40">(opcjonalnie)</span>
            <input
              value={name}
              maxLength={300}
              disabled={saving}
              onChange={event => setName(event.target.value)}
              placeholder="Domyślnie: sprzedawca — pozycja — numer faktury"
              className={`${settlementInputClass} mt-1`}
            />
          </label>
          {formError && (
            <p role="alert" className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-200">
              {formError}
            </p>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" disabled={saving} onClick={close} className={secondaryButtonClass}>
              Anuluj
            </button>
            <button type="submit" disabled={Boolean(busy)} className={primaryButtonClass}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              Przypisz fakturę
            </button>
          </div>
        </form>
      )}
    </EventStepDialog>
  );
}
