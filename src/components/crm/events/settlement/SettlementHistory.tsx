'use client';
import { useState } from 'react';
import { History } from 'lucide-react';
import {
  SETTLEMENT_VERSION_ACTION_LABELS,
  formatPercent,
  formatPln,
  type SettlementVersion,
} from '@/lib/events/settlement/eventSettlement';
import { formatSettlementDate } from './settlementUi';

const PREVIEW = 5;

const ACTION_CHIP: Record<SettlementVersion['action'], string> = {
  submitted: 'bg-amber-400/15 text-amber-200',
  returned: 'bg-red-500/15 text-red-200',
  approved: 'bg-emerald-400/15 text-emerald-200',
  reopened: 'bg-white/10 text-[#e5e4e2]/75',
};

/** Historia podsumowania (niezmienne wersje z bazy): kto, kiedy, co i kluczowe kwoty. */
export default function SettlementHistory({ versions }: { versions: SettlementVersion[] }) {
  const [showAll, setShowAll] = useState(false);
  if (!versions.length) return null;
  const visible = showAll ? versions : versions.slice(0, PREVIEW);
  return (
    <section aria-labelledby="settlement-history-heading" className="rounded-xl bg-white/5 p-4 sm:p-5">
      <h3 id="settlement-history-heading" className="flex items-center gap-2 font-medium text-[#e5e4e2]">
        <History className="h-4 w-4 text-[#d3bb73]" aria-hidden />
        Historia podsumowania
      </h3>
      <ol className="mt-3 space-y-2">
        {visible.map(version => (
          <li key={version.id} className="rounded-lg bg-white/[0.03] px-3 py-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded-md px-2 py-0.5 text-[11px] font-medium ${ACTION_CHIP[version.action] ?? ACTION_CHIP.reopened}`}>
                {SETTLEMENT_VERSION_ACTION_LABELS[version.action] ?? version.action}
              </span>
              <span className="text-xs text-[#e5e4e2]/55">wersja {version.revision}</span>
              <span className="text-xs text-[#e5e4e2]/55">· {formatSettlementDate(version.created_at, true)}</span>
              {version.actor_name && <span className="text-xs text-[#e5e4e2]/70">· {version.actor_name}</span>}
            </div>
            {version.note && <p className="mt-1.5 whitespace-pre-wrap break-words text-sm text-[#e5e4e2]/80">{version.note}</p>}
            {version.totals && (
              <dl className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs">
                <div>
                  <dt className="inline text-[#e5e4e2]/45">Przychód netto: </dt>
                  <dd className="inline tabular-nums text-[#e5e4e2]/80">{formatPln(version.totals.revenue_net)}</dd>
                </div>
                <div>
                  <dt className="inline text-[#e5e4e2]/45">Koszty: </dt>
                  <dd className="inline tabular-nums text-[#e5e4e2]/80">{formatPln(version.totals.costs_net)}</dd>
                </div>
                <div>
                  <dt className="inline text-[#e5e4e2]/45">Zysk netto: </dt>
                  <dd className="inline tabular-nums text-[#d3bb73]">{formatPln(version.totals.profit_net)}</dd>
                </div>
                <div>
                  <dt className="inline text-[#e5e4e2]/45">Prowizje pracowników: </dt>
                  <dd className="inline tabular-nums text-[#e5e4e2]/80">{formatPln(version.totals.internal_commissions)}</dd>
                </div>
              </dl>
            )}
            {(version.internal.length > 0 || version.external.length > 0) && (
              <p className="mt-1 text-[11px] leading-relaxed text-[#e5e4e2]/50">
                {[
                  ...version.internal.map(
                    item => `${item.name}: ${formatPln(item.amount)} (${formatPercent(item.rate)}${item.share_percent !== 100 ? `, udział ${formatPercent(item.share_percent)}` : ''})`,
                  ),
                  ...version.external.map(item => `${item.name}: ${formatPln(item.amount)} (${formatPercent(item.rate)})`),
                ].join(' · ')}
              </p>
            )}
          </li>
        ))}
      </ol>
      {versions.length > PREVIEW && (
        <button type="button" onClick={() => setShowAll(value => !value)} className="mt-2 text-xs text-[#d3bb73] hover:underline">
          {showAll ? 'Pokaż mniej' : `Pokaż całą historię (${versions.length})`}
        </button>
      )}
    </section>
  );
}
