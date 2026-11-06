'use client';
import { useEffect, useId, useState, type FormEvent } from 'react';
import { Loader2 } from 'lucide-react';
import { formatPercent, type SettlementExternalCommission } from '@/lib/events/settlement/eventSettlement';
import EventStepDialog from '../steps/EventStepDialog';
import type { SettlementMutate } from './useEventSettlement';
import { parsePercentInput, primaryButtonClass, secondaryButtonClass, settlementInputClass } from './settlementUi';

/**
 * Stawka sprzedawcy zewnętrznego tylko dla tego wydarzenia (z powodem) albo powrót do stawki z karty
 * → set_event_settlement_seller_rate. Kwotę przelicza baza.
 */
export default function SellerRateDialog({
  eventId,
  seller,
  busy,
  mutate,
  onClose,
}: {
  eventId: string;
  seller: SettlementExternalCommission | null;
  busy: string | null;
  mutate: SettlementMutate;
  onClose: () => void;
}) {
  const id = useId();
  const [rate, setRate] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const saving = busy === 'seller-rate';

  useEffect(() => {
    setRate(seller?.rate != null ? String(seller.rate).replace('.', ',') : '');
    setReason('');
    setError('');
  }, [seller?.partner_id, seller?.rate]);

  if (!seller) return null;

  const close = () => {
    if (!saving) onClose();
  };

  const save = async (value: number | null) => {
    const ok = await mutate(
      'seller-rate',
      'set_event_settlement_seller_rate',
      { p_event_id: eventId, p_sales_partner_id: seller.partner_id, p_rate: value, p_reason: value === null ? null : reason.trim() },
      value === null ? 'Przywrócono stawkę z karty sprzedawcy.' : 'Stawka dla wydarzenia zapisana — prowizja przeliczona.',
    );
    if (ok) onClose();
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const value = parsePercentInput(rate);
    if (value === null || value <= 0) {
      setError('Podaj stawkę większą od 0% (najwyżej 100%, do 0,01).');
      return;
    }
    if (reason.trim().length < 3) {
      setError('Podaj powód stawki dla tego wydarzenia (widoczny w historii prowizji).');
      return;
    }
    setError('');
    void save(value);
  };

  return (
    <EventStepDialog
      open
      title={`Stawka dla wydarzenia — ${seller.name}`}
      description={`Karta sprzedawcy: ${seller.card_rate != null ? `${formatPercent(seller.card_rate)} od zysku` : 'brak stawki'}. Zmiana dotyczy tylko tego wydarzenia.`}
      onClose={close}
      busy={saving}
    >
      <form onSubmit={submit} noValidate className="space-y-4" aria-busy={saving}>
        <div className="grid gap-3 sm:grid-cols-[140px_minmax(0,1fr)]">
          <label htmlFor={`${id}-rate`} className="block text-sm text-[#e5e4e2]/70">
            Stawka (% od zysku)
            <input
              id={`${id}-rate`}
              data-autofocus
              inputMode="decimal"
              value={rate}
              disabled={saving}
              onChange={event => setRate(event.target.value)}
              className={`${settlementInputClass} mt-1`}
            />
          </label>
          <label htmlFor={`${id}-reason`} className="block text-sm text-[#e5e4e2]/70">
            Powód <span className="text-[#d3bb73]">*</span>
            <input
              id={`${id}-reason`}
              value={reason}
              maxLength={500}
              disabled={saving}
              onChange={event => setReason(event.target.value)}
              placeholder="np. uzgodnione z hotelem dla tej konferencji"
              className={`${settlementInputClass} mt-1`}
            />
          </label>
        </div>
        {error && (
          <p role="alert" className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-200">
            {error}
          </p>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2">
          {seller.rate_override ? (
            <button type="button" disabled={Boolean(busy)} onClick={() => void save(null)} className={secondaryButtonClass}>
              Wróć do stawki z karty
            </button>
          ) : (
            <span />
          )}
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={saving} onClick={close} className={secondaryButtonClass}>
              Anuluj
            </button>
            <button type="submit" disabled={Boolean(busy)} className={primaryButtonClass}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              Zapisz stawkę
            </button>
          </div>
        </div>
      </form>
    </EventStepDialog>
  );
}
