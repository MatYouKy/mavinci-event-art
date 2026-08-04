import { AlertTriangle, Ban, Paperclip, RotateCcw, Trash2 } from 'lucide-react';
import { cycleLabel, formatDate, formatMoney, Subscription } from './ExternalInvoicesTab';

export function SubscriptionsList({
  subscriptions,
  today,
  canManage,
  onPreview,
  onDelete,
  onToggleStatus,
}: {
  subscriptions: Subscription[];
  today: string;
  canManage: boolean;
  onPreview: (path: string | null) => void;
  onDelete: (sub: Subscription) => void;
  onToggleStatus: (sub: Subscription) => void;
}) {
  if (subscriptions.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-[#d3bb73]/20 py-16 text-center text-[#e5e4e2]/50">
        Brak subskrypcji. Dodaj cykliczne płatności, aby nie zapomnieć o comiesięcznych fakturach.
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      {subscriptions.map((sub) => {
        const isCancelled = sub.status === 'cancelled';
        const isOverdue = !isCancelled && !!sub.next_charge_date && sub.next_charge_date < today;

        return (
          <div
            key={sub.id}
            className={`flex flex-col gap-3 rounded-xl border bg-[#1c1f33] p-4 sm:flex-row sm:items-center sm:justify-between ${
              isOverdue ? 'border-red-500/50' : 'border-[#d3bb73]/10'
            } ${isCancelled ? 'opacity-60' : ''}`}
          >
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-[#e5e4e2]">{sub.name}</span>
                {isCancelled ? (
                  <span className="rounded-full bg-[#e5e4e2]/10 px-2 py-0.5 text-xs text-[#e5e4e2]/60">
                    Anulowana
                  </span>
                ) : isOverdue ? (
                  <span className="flex items-center gap-1 rounded-full bg-red-500/15 px-2 py-0.5 text-xs text-red-400">
                    <AlertTriangle className="h-3 w-3" />
                    Termin minął
                  </span>
                ) : (
                  <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs text-emerald-400">
                    Aktywna
                  </span>
                )}
              </div>
              {sub.seller_name && (
                <div className="mt-1 text-sm text-[#e5e4e2]/70">
                  {sub.seller_name}
                  {sub.seller_nip ? ` · NIP ${sub.seller_nip}` : ''}
                </div>
              )}
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[#e5e4e2]/50">
                <span>Cykl: {cycleLabel(sub.billing_cycle)}</span>
                <span className={isOverdue ? 'font-medium text-red-400' : undefined}>
                  Najbliższe obciążenie: {formatDate(sub.next_charge_date)}
                </span>
                {sub.payment_method && <span>Płatność: {sub.payment_method}</span>}
              </div>
            </div>

            <div className="flex items-center gap-3">
              <span className="text-right font-medium text-[#d3bb73]">
                {formatMoney(sub.amount, sub.currency)}
              </span>
              {sub.file_url && (
                <button
                  onClick={() => onPreview(sub.file_url)}
                  title="Załącznik"
                  className="rounded-lg border border-[#d3bb73]/20 p-2 text-[#e5e4e2]/70 hover:text-[#d3bb73]"
                >
                  <Paperclip className="h-4 w-4" />
                </button>
              )}
              {canManage && (
                <>
                  <button
                    onClick={() => onToggleStatus(sub)}
                    title={isCancelled ? 'Wznów' : 'Anuluj'}
                    className="rounded-lg border border-[#d3bb73]/20 p-2 text-[#e5e4e2]/70 hover:text-[#d3bb73]"
                  >
                    {isCancelled ? <RotateCcw className="h-4 w-4" /> : <Ban className="h-4 w-4" />}
                  </button>
                  <button
                    onClick={() => onDelete(sub)}
                    title="Usuń"
                    className="rounded-lg border border-red-500/20 p-2 text-red-400 hover:bg-red-500/10"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
