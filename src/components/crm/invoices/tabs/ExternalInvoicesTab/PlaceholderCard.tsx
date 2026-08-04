import { AlertTriangle } from 'lucide-react';
import { Subscription, MONTH_NAMES, cycleLabel, formatMoney } from './ExternalInvoicesTab';
import { Plus } from 'lucide-react';

export function PlaceholderCard({
  subscription,
  year,
  month,
  canManage,
  onAdd,
}: {
  subscription: Subscription;
  year: number;
  month: number;
  canManage: boolean;
  onAdd: (sub: Subscription, year: number, month: number) => void;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-red-500/50 bg-red-500/5 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-[#e5e4e2]">{subscription.name}</span>
          <span className="flex items-center gap-1 rounded-full bg-red-500/15 px-2 py-0.5 text-xs font-medium text-red-400">
            <AlertTriangle className="h-3 w-3" />
            Brak faktury
          </span>
        </div>
        <div className="mt-1 text-sm text-[#e5e4e2]/70">
          {subscription.seller_name || subscription.name}
          {subscription.seller_nip ? ` · NIP ${subscription.seller_nip}` : ''}
        </div>
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[#e5e4e2]/50">
          <span>
            Okres: {MONTH_NAMES[month - 1]} {year}
          </span>
          <span>Cykl: {cycleLabel(subscription.billing_cycle)}</span>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <span className="text-right font-medium text-red-400">
          {formatMoney(subscription.amount, subscription.currency)}
        </span>
        {canManage && (
          <button
            onClick={() => onAdd(subscription, year, month)}
            className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-3 py-2 text-sm font-medium text-[#0a0d1a] hover:bg-[#d3bb73]/90"
          >
            <Plus className="h-4 w-4" />
            Dodaj fakturę
          </button>
        )}
      </div>
    </div>
  );
}