'use client';
import { useCallback, useState } from 'react';
import { Loader2 } from 'lucide-react';
import CostInvoiceLinkDialog from './CostInvoiceLinkDialog';
import SalesSharesEditor from './SalesSharesEditor';
import SettlementActionBar from './SettlementActionBar';
import SettlementCommissionsCard from './SettlementCommissionsCard';
import SettlementConfirmDialog, { type SettlementConfirmRequest } from './SettlementConfirmDialog';
import SettlementHeader from './SettlementHeader';
import SettlementHistory from './SettlementHistory';
import SettlementLinesTable from './SettlementLinesTable';
import SettlementTotalsCard from './SettlementTotalsCard';
import { useEventSettlement } from './useEventSettlement';
import { SETTLEMENT_MIGRATION_NOTICE } from './settlementUi';

type PendingConfirm = { request: SettlementConfirmRequest; run: (note: string, option: boolean) => Promise<boolean> };

/**
 * Zakładka „Podsumowanie” wydarzenia (obszar „kwoty”): przychody i koszty netto, wynik, prowizje,
 * sprzedawca wydarzenia, obieg wysłanie → zatwierdzenie oraz historia. Źródło prawdy: get_event_settlement.
 */
export default function EventSettlementTab({ eventId }: { eventId: string }) {
  const { settlement, state, loadError, busy, load, mutate } = useEventSettlement(eventId);
  const [confirm, setConfirm] = useState<PendingConfirm | null>(null);
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  // Po pierwszym 42501 (brak dostępu do finansów wydarzenia) przycisk „Dodaj fakturę kosztową” znika.
  const [invoiceForbidden, setInvoiceForbidden] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const askConfirm = useCallback((request: SettlementConfirmRequest, run: (note: string, option: boolean) => Promise<boolean>) => {
    setConfirm({ request, run });
  }, []);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load(true);
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  if (state === 'loading') {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-sm text-[#e5e4e2]/55" role="status">
        <Loader2 className="h-5 w-5 animate-spin text-[#d3bb73]" aria-hidden />
        Wczytuję podsumowanie wydarzenia…
      </div>
    );
  }
  if (state === 'missing') {
    return <p className="rounded-xl bg-amber-400/10 p-5 text-sm text-amber-100/90">{SETTLEMENT_MIGRATION_NOTICE}</p>;
  }
  if (state === 'forbidden') {
    return (
      <p className="rounded-xl bg-white/5 p-5 text-sm text-[#e5e4e2]/70">
        {loadError || 'Podsumowanie wydarzenia widzi osoba z dostępem do kwot tego wydarzenia.'}
      </p>
    );
  }
  if (state === 'error' || !settlement) {
    return (
      <div role="alert" className="rounded-xl bg-white/5 p-5 text-sm text-red-200">
        {loadError || 'Nie udało się wczytać podsumowania wydarzenia.'}{' '}
        <button type="button" onClick={() => void refresh()} className="text-[#d3bb73] underline">
          Spróbuj ponownie
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6" aria-busy={Boolean(busy)}>
      <SettlementHeader settlement={settlement} refreshing={refreshing} onRefresh={() => void refresh()} />
      {loadError && (
        <p role="status" className="rounded-lg bg-amber-400/10 px-3 py-2 text-xs text-amber-100/90">
          {loadError}
        </p>
      )}
      <SettlementActionBar eventId={eventId} settlement={settlement} busy={busy} mutate={mutate} askConfirm={askConfirm} />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(320px,380px)]">
        <SettlementLinesTable
          eventId={eventId}
          settlement={settlement}
          busy={busy}
          mutate={mutate}
          askConfirm={askConfirm}
          onAddInvoice={invoiceForbidden ? undefined : () => setInvoiceOpen(true)}
        />
        <div className="space-y-6 xl:sticky xl:top-4 xl:self-start">
          <SettlementTotalsCard totals={settlement.totals} forecast={settlement.forecast} />
        </div>
      </div>

      <div className={`grid gap-6 ${settlement.can_edit_shares ? 'lg:grid-cols-[minmax(0,1fr)_minmax(320px,420px)]' : ''}`}>
        <SettlementCommissionsCard settlement={settlement} />
        {settlement.can_edit_shares && (
          <div className="lg:self-start">
            <SalesSharesEditor eventId={eventId} internal={settlement.internal} busy={busy} mutate={mutate} />
          </div>
        )}
      </div>

      <SettlementHistory versions={settlement.versions} />

      <SettlementConfirmDialog
        request={confirm?.request ?? null}
        busy={Boolean(busy)}
        onCancel={() => {
          if (!busy) setConfirm(null);
        }}
        onConfirm={async (note, option) => {
          if (!confirm) return;
          const ok = await confirm.run(note, option);
          if (ok) setConfirm(null);
        }}
      />
      {settlement.can_edit && (
        <CostInvoiceLinkDialog
          open={invoiceOpen}
          eventId={eventId}
          busy={busy}
          mutate={mutate}
          onClose={() => setInvoiceOpen(false)}
          onForbidden={() => setInvoiceForbidden(true)}
        />
      )}
    </div>
  );
}
