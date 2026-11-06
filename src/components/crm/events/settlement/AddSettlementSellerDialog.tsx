'use client';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { ArrowLeft, Loader2, Search } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { COMMISSION_PAYMENT_LABELS, formatPercent } from '@/lib/events/settlement/eventSettlement';
import EventStepDialog from '../steps/EventStepDialog';
import type { SettlementMutate } from './useEventSettlement';
import {
  parsePercentInput,
  primaryButtonClass,
  secondaryButtonClass,
  settlementErrorMessage,
  settlementInputClass,
} from './settlementUi';

type SellerCandidate = {
  partner_id: string;
  name: string;
  organization: string | null;
  rate: number | null;
  payment_method: string | null;
  /** Karta sprzedawcy: aktywna marka wydarzenia z włączoną prowizją. */
  ready: boolean;
  suggestion: string | null;
  in_event: boolean;
};

function parseCandidates(data: unknown): SellerCandidate[] {
  if (!Array.isArray(data)) return [];
  return data
    .filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === 'object')
    .map(row => ({
      partner_id: String(row.partner_id ?? ''),
      name: typeof row.name === 'string' && row.name.trim() ? row.name : 'Sprzedawca',
      organization: typeof row.organization === 'string' && row.organization.trim() ? row.organization : null,
      rate: typeof row.rate === 'number' ? row.rate : typeof row.rate === 'string' && row.rate !== '' ? Number(row.rate) : null,
      payment_method: typeof row.payment_method === 'string' ? row.payment_method : null,
      ready: row.ready === true,
      suggestion: typeof row.suggestion === 'string' ? row.suggestion : null,
      in_event: row.in_event === true,
    }))
    .filter(row => row.partner_id);
}

const sellerCardHref = (partnerId: string) => `/crm/salespeople?seller=${encodeURIComponent(partnerId)}&section=settings`;

/**
 * „Dodaj sprzedawcę” w podsumowaniu: wybór sprzedawcy zewnętrznego (podpowiedzi: osoba kontaktowa, kontakt
 * rozliczeniowy, pracownicy klienta), stawka % od zysku z karty albo inna dla tego wydarzenia (z powodem)
 * → add_event_settlement_seller. Kwotę liczy baza.
 */
export default function AddSettlementSellerDialog({
  open,
  eventId,
  busy,
  mutate,
  onClose,
}: {
  open: boolean;
  eventId: string;
  busy: string | null;
  mutate: SettlementMutate;
  onClose: () => void;
}) {
  const id = useId();
  const [search, setSearch] = useState('');
  const [candidates, setCandidates] = useState<SellerCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState('');
  const [selected, setSelected] = useState<SellerCandidate | null>(null);
  const [customRate, setCustomRate] = useState(false);
  const [rate, setRate] = useState('');
  const [reason, setReason] = useState('');
  const [formError, setFormError] = useState('');
  const sequence = useRef(0);
  const saving = busy === 'seller-add';

  useEffect(() => {
    if (!open) return;
    setSearch('');
    setSelected(null);
    setCustomRate(false);
    setRate('');
    setReason('');
    setFormError('');
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const request = ++sequence.current;
    setLoading(true);
    const timer = window.setTimeout(async () => {
      const { data, error } = await supabase.rpc('list_event_seller_candidates', {
        p_event_id: eventId,
        p_search: search.trim() || null,
      });
      if (request !== sequence.current) return;
      setLoading(false);
      if (error) {
        setCandidates([]);
        setListError(settlementErrorMessage(error, 'Nie udało się wczytać sprzedawców.'));
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
    let value: number | null = null;
    if (customRate || !(Number(selected.rate) > 0)) {
      value = parsePercentInput(rate);
      if (value === null || value <= 0) {
        setFormError('Podaj stawkę większą od 0% (najwyżej 100%, do 0,01).');
        return;
      }
      if (reason.trim().length < 3) {
        setFormError('Podaj powód stawki dla tego wydarzenia (widoczny w historii prowizji).');
        return;
      }
    }
    setFormError('');
    const ok = await mutate(
      'seller-add',
      'add_event_settlement_seller',
      {
        p_event_id: eventId,
        p_sales_partner_id: selected.partner_id,
        p_rate: value,
        p_reason: value === null ? null : reason.trim(),
      },
      'Sprzedawca dodany do podsumowania — prowizja przeliczona.',
    );
    if (ok) onClose();
  };

  const needsRate = selected ? customRate || !(Number(selected.rate) > 0) : false;

  return (
    <EventStepDialog
      open
      wide
      title="Dodaj sprzedawcę zewnętrznego"
      description="Prowizja sprzedawcy to % od zysku netto wydarzenia — po kosztach i po koszcie samej prowizji. Sprzedawca zobaczy podsumowanie w portalu, gdy ma widoczne wynagrodzenie."
      onClose={close}
      busy={saving}
    >
      {!selected ? (
        <div className="space-y-3">
          <label htmlFor={`${id}-search`} className="sr-only">
            Szukaj sprzedawcy
          </label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-white/35" aria-hidden />
            <input
              id={`${id}-search`}
              data-autofocus
              value={search}
              onChange={event => setSearch(event.target.value)}
              placeholder="Imię, nazwisko albo hotel / agencja…"
              className={`${settlementInputClass} pl-9`}
            />
          </div>
          {!search.trim() && (
            <p className="text-xs text-[#e5e4e2]/45">Podpowiedzi: osoba kontaktowa, kontakt rozliczeniowy i pracownicy klienta tego wydarzenia.</p>
          )}
          {listError && (
            <p role="alert" className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-200">
              {listError}
            </p>
          )}
          {loading && candidates.length === 0 ? (
            <p className="flex items-center gap-2 py-6 text-sm text-[#e5e4e2]/55">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              Szukam sprzedawców…
            </p>
          ) : candidates.length === 0 && !listError ? (
            <p className="py-6 text-center text-sm text-[#e5e4e2]/45">
              {search.trim()
                ? 'Brak aktywnych sprzedawców pasujących do wyszukiwania.'
                : 'Nikt z osób związanych z wydarzeniem nie jest sprzedawcą. Wyszukaj sprzedawcę albo mianuj kontakt sprzedawcą na jego karcie.'}
            </p>
          ) : (
            <ul className="max-h-[50dvh] space-y-1.5 overflow-y-auto" aria-busy={loading}>
              {candidates.map(candidate => {
                const disabled = candidate.in_event || !candidate.ready;
                return (
                  <li key={candidate.partner_id} className="rounded-lg bg-white/[0.03]">
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => {
                        setSelected(candidate);
                        setCustomRate(false);
                        setRate(candidate.rate != null ? String(candidate.rate).replace('.', ',') : '');
                        setFormError('');
                      }}
                      className="w-full rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-white/[0.07] disabled:cursor-not-allowed disabled:hover:bg-transparent"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className={`break-words text-sm ${disabled ? 'text-[#e5e4e2]/55' : 'text-[#e5e4e2]'}`}>
                            {candidate.name}
                            {candidate.organization && <span className="text-[#e5e4e2]/45"> · {candidate.organization}</span>}
                          </p>
                          {candidate.suggestion && (
                            <span className="mt-1 inline-block rounded-md bg-[#d3bb73]/15 px-2 py-0.5 text-[11px] text-[#d3bb73]">
                              {candidate.suggestion}
                            </span>
                          )}
                        </div>
                        <div className="shrink-0 text-right text-xs">
                          {candidate.in_event ? (
                            <p className="text-[#e5e4e2]/50">Już w podsumowaniu</p>
                          ) : candidate.ready ? (
                            <>
                              <p className="text-sm tabular-nums text-[#e5e4e2]">
                                {Number(candidate.rate) > 0 ? `${formatPercent(candidate.rate)} od zysku` : 'Stawka 0%'}
                              </p>
                              {candidate.payment_method && (
                                <p className="text-[#e5e4e2]/50">{COMMISSION_PAYMENT_LABELS[candidate.payment_method] ?? candidate.payment_method}</p>
                              )}
                            </>
                          ) : (
                            <p className="text-amber-200/85">Brak prowizji dla marki wydarzenia</p>
                          )}
                        </div>
                      </div>
                    </button>
                    {!candidate.ready && !candidate.in_event && (
                      <p className="px-3 pb-2.5 text-xs text-[#e5e4e2]/50">
                        Ustaw % od zysku na{' '}
                        <Link href={sellerCardHref(candidate.partner_id)} className="text-[#d3bb73] underline">
                          karcie sprzedawcy
                        </Link>
                        , potem wróć tutaj.
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          <div className="flex justify-end">
            <button type="button" onClick={close} className={secondaryButtonClass}>
              Anuluj
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} noValidate className="space-y-4" aria-busy={saving}>
          <button
            type="button"
            disabled={saving}
            onClick={() => setSelected(null)}
            className="inline-flex items-center gap-1.5 text-xs text-[#d3bb73] hover:underline disabled:opacity-50"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
            Wybierz innego sprzedawcę
          </button>
          <div className="rounded-lg bg-white/[0.04] px-3 py-2.5 text-sm">
            <p className="text-[#e5e4e2]">
              {selected.name}
              {selected.organization && <span className="text-[#e5e4e2]/50"> · {selected.organization}</span>}
            </p>
            <p className="mt-0.5 text-xs text-[#e5e4e2]/55">
              {Number(selected.rate) > 0 ? `Karta sprzedawcy: ${formatPercent(selected.rate)} od zysku` : 'Karta sprzedawcy: stawka 0%'}
              {selected.payment_method ? ` · ${COMMISSION_PAYMENT_LABELS[selected.payment_method] ?? selected.payment_method}` : ''}
            </p>
          </div>
          {Number(selected.rate) > 0 && (
            <label htmlFor={`${id}-custom`} className="flex cursor-pointer items-start gap-3 rounded-lg bg-white/[0.04] px-3 py-2.5">
              <input
                id={`${id}-custom`}
                type="checkbox"
                checked={customRate}
                disabled={saving}
                onChange={event => setCustomRate(event.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 accent-[#d3bb73]"
              />
              <span className="min-w-0">
                <span className="block text-sm text-[#e5e4e2]">Inna stawka dla tego wydarzenia</span>
                <span className="mt-0.5 block text-xs text-[#e5e4e2]/55">Karta sprzedawcy zostaje bez zmian.</span>
              </span>
            </label>
          )}
          {needsRate && (
            <div className="grid gap-3 sm:grid-cols-[140px_minmax(0,1fr)]">
              <label className="block text-sm text-[#e5e4e2]/70">
                Stawka (% od zysku)
                <input
                  data-autofocus
                  inputMode="decimal"
                  value={rate}
                  disabled={saving}
                  onChange={event => setRate(event.target.value)}
                  placeholder="np. 10"
                  className={`${settlementInputClass} mt-1`}
                />
              </label>
              <label className="block text-sm text-[#e5e4e2]/70">
                Powód <span className="text-[#d3bb73]">*</span>
                <input
                  value={reason}
                  maxLength={500}
                  disabled={saving}
                  onChange={event => setReason(event.target.value)}
                  placeholder="np. uzgodnione z hotelem dla tej konferencji"
                  className={`${settlementInputClass} mt-1`}
                />
              </label>
            </div>
          )}
          {formError && (
            <p role="alert" className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-200">
              {formError}
            </p>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" disabled={saving} onClick={close} className={secondaryButtonClass}>
              Anuluj
            </button>
            <button type="submit" disabled={Boolean(busy)} className={primaryButtonClass} data-autofocus={needsRate ? undefined : true}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              Dodaj sprzedawcę
            </button>
          </div>
        </form>
      )}
    </EventStepDialog>
  );
}
