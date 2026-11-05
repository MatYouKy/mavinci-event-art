'use client';
import { AlertTriangle, AlertCircle, Info, RefreshCw } from 'lucide-react';
import { SETTLEMENT_STATUS_LABELS, type EventSettlement } from '@/lib/events/settlement/eventSettlement';
import { formatSettlementDate } from './settlementUi';

const STATUS_CHIP: Record<EventSettlement['status'], string> = {
  draft: 'bg-white/10 text-[#e5e4e2]/80',
  submitted: 'bg-amber-400/15 text-amber-200',
  approved: 'bg-emerald-400/15 text-emerald-200',
};

/** Nagłówek podsumowania: status, kto i kiedy, uwaga zwrotu, ostrzeżenia z bazy (issues blokują wysłanie). */
export default function SettlementHeader({
  settlement,
  refreshing,
  onRefresh,
}: {
  settlement: EventSettlement;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const { status, submitted, approved, returned } = settlement;
  // Ostrzeżenie o anulowaniu po zatwierdzeniu pokazujemy osobnym banerem (baza dodaje je też do warnings).
  const warnings = settlement.clawback
    ? settlement.warnings.filter(warning => !warning.startsWith('Wydarzenie anulowane po zatwierdzeniu'))
    : settlement.warnings;
  return (
    <section aria-labelledby="settlement-heading" className="rounded-xl bg-white/5 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="settlement-heading" className="text-lg font-medium text-[#e5e4e2]">
              Podsumowanie wydarzenia
            </h2>
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_CHIP[status]}`}>
              {SETTLEMENT_STATUS_LABELS[status]}
            </span>
            {settlement.revision > 0 && (
              <span className="rounded-full bg-white/5 px-2.5 py-0.5 text-xs text-[#e5e4e2]/60">
                wersja {settlement.revision}
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-[#e5e4e2]/55">
            Przychody i koszty netto uzupełniają się same. Prowizje liczy baza — tutaj sprawdzasz, poprawiasz pozycje i wysyłasz do zatwierdzenia.
          </p>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshing}
          aria-label="Odśwież podsumowanie"
          title="Odśwież"
          className="rounded-lg p-2 text-[#e5e4e2]/50 hover:bg-white/5 hover:text-[#d3bb73] disabled:opacity-40"
        >
          <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} aria-hidden />
        </button>
      </div>

      {(submitted || approved || (returned && status === 'draft')) && (
        <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
          {submitted && (
            <div className="rounded-lg bg-white/[0.03] px-3 py-2">
              <dt className="text-xs text-[#e5e4e2]/50">Wysłane do zatwierdzenia</dt>
              <dd className="mt-0.5 text-[#e5e4e2]">
                {formatSettlementDate(submitted.at, true)}
                {submitted.by_name && <span className="text-[#e5e4e2]/60"> · {submitted.by_name}</span>}
              </dd>
              {submitted.note && <dd className="mt-1 whitespace-pre-wrap break-words text-xs text-[#e5e4e2]/60">{submitted.note}</dd>}
            </div>
          )}
          {approved && (
            <div className="rounded-lg bg-white/[0.03] px-3 py-2">
              <dt className="text-xs text-[#e5e4e2]/50">Zatwierdzone</dt>
              <dd className="mt-0.5 text-[#e5e4e2]">
                {formatSettlementDate(approved.at, true)}
                {approved.by_name && <span className="text-[#e5e4e2]/60"> · {approved.by_name}</span>}
              </dd>
            </div>
          )}
          {returned && status === 'draft' && (
            <div className="rounded-lg bg-amber-400/10 px-3 py-2 sm:col-span-2 lg:col-span-1">
              <dt className="text-xs text-amber-200/80">Zwrócone do poprawy</dt>
              <dd className="mt-0.5 text-[#e5e4e2]">
                {formatSettlementDate(returned.at, true)}
                {returned.by_name && <span className="text-[#e5e4e2]/60"> · {returned.by_name}</span>}
              </dd>
              {returned.note && (
                <dd className="mt-1 whitespace-pre-wrap break-words text-sm text-amber-100">{returned.note}</dd>
              )}
            </div>
          )}
        </dl>
      )}

      {settlement.clawback && (
        <p role="alert" className="mt-3 flex items-start gap-2 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-100">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          Wydarzenie anulowano po zatwierdzeniu podsumowania. Ponowne zatwierdzenie wyzeruje prowizje: niewypłacone zostaną anulowane,
          a wypłacone zamienią się w potrącenia.
        </p>
      )}
      {settlement.stale && (
        <p role="alert" className="mt-3 flex items-start gap-2 rounded-lg bg-amber-400/10 px-3 py-2 text-sm text-amber-100">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          Dane zmieniły się po zatwierdzeniu — otwórz ponownie, aby przeliczyć.
        </p>
      )}
      {settlement.submitted_stale && (
        <p role="alert" className="mt-3 flex items-start gap-2 rounded-lg bg-amber-400/10 px-3 py-2 text-sm text-amber-100">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          Dane zmieniły się po wysłaniu — zwróć do poprawy.
        </p>
      )}
      {settlement.forecast && (
        <p className="mt-3 flex items-start gap-2 rounded-lg bg-sky-400/10 px-3 py-2 text-sm text-sky-100/90">
          <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          Przychód pochodzi z prognozy (oferta lub kalkulacja). Kwoty i prowizje zmienią się po wystawieniu faktury albo potwierdzeniu
          gotówki — do wysłania potrzebny jest rzeczywisty przychód.
        </p>
      )}
      {!settlement.finished && status === 'draft' && (
        <p className="mt-3 flex items-start gap-2 rounded-lg bg-white/[0.03] px-3 py-2 text-sm text-[#e5e4e2]/70">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-[#d3bb73]" aria-hidden />
          Wydarzenie jeszcze się nie zakończyło — prowizje są prognozą. Podsumowanie wyślesz po zakończeniu.
        </p>
      )}

      {settlement.issues.length > 0 && (
        <div role="alert" className="mt-3 rounded-lg bg-red-500/10 px-3 py-2">
          <p className="flex items-center gap-2 text-sm font-medium text-red-200">
            <AlertCircle className="h-4 w-4 shrink-0" aria-hidden />
            Do uzupełnienia przed wysłaniem
          </p>
          <ul className="mt-1.5 list-disc space-y-1 pl-6 text-sm text-red-100/90">
            {settlement.issues.map(issue => (
              <li key={issue} className="break-words">
                {issue}
              </li>
            ))}
          </ul>
        </div>
      )}
      {warnings.length > 0 && (
        <div className="mt-3 rounded-lg bg-amber-400/[0.07] px-3 py-2">
          <p className="text-xs font-medium uppercase tracking-wider text-amber-200/80">Uwagi</p>
          <ul className="mt-1.5 list-disc space-y-1 pl-5 text-sm text-[#e5e4e2]/75">
            {warnings.map(warning => (
              <li key={warning} className="break-words">
                {warning}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
