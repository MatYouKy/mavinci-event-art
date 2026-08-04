import { useMemo } from 'react';
import { ExternalInvoice, MONTH_NAMES, Subscription } from './ExternalInvoicesTab';
import { buildInvoiceGroups } from './buildInvoiceGroups';
import { AlertTriangle } from 'lucide-react';
import { RealInvoiceCard } from './RealInvoiceCard';
import { PlaceholderCard } from './PlaceholderCard';

export function GroupedInvoices({
  invoices,
  subscriptions,
  canManage,
  onPreview,
  onDelete,
  onAddForPlaceholder,
  onEdit,
}: {
  onEdit: (inv: ExternalInvoice) => void;
  invoices: ExternalInvoice[];
  subscriptions: Subscription[];
  canManage: boolean;
  onPreview: (path: string | null) => void;
  onDelete: (inv: ExternalInvoice) => void;
  onAddForPlaceholder: (sub: Subscription, year: number, month: number) => void;
}) {
  const groups = useMemo(
    () => buildInvoiceGroups(invoices, subscriptions),
    [invoices, subscriptions],
  );

  if (groups.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-[#d3bb73]/20 py-16 text-center text-[#e5e4e2]/50">
        Brak faktur spoza KSeF. Dodaj pierwszą fakturę papierową, zagraniczną lub paragon —
        subskrypcje pojawią się tu automatycznie co miesiąc.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      {groups.map((yearGroup) => (
        <div key={yearGroup.year}>
          <h2 className="mb-3 text-xl font-semibold text-[#e5e4e2]">{yearGroup.year}</h2>
          <div className="flex flex-col gap-5">
            {yearGroup.months.map((monthGroup) => (
              <div key={monthGroup.month}>
                <div className="mb-2 flex items-center gap-3">
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-[#d3bb73]">
                    {MONTH_NAMES[monthGroup.month - 1]}
                  </h3>
                  {monthGroup.missing > 0 && (
                    <span className="flex items-center gap-1 rounded-full bg-red-500/15 px-2 py-0.5 text-xs font-medium text-red-400">
                      <AlertTriangle className="h-3 w-3" />
                      {monthGroup.missing} do dodania
                    </span>
                  )}
                </div>
                <div className="grid gap-3">
                  {monthGroup.rows.map((row) =>
                    row.kind === 'real' ? (
                      <RealInvoiceCard
                        key={`inv-${row.invoice.id}`}
                        inv={row.invoice}
                        canManage={canManage}
                        onPreview={onPreview}
                        onDelete={onDelete}
                        onEdit={onEdit}
                      />
                    ) : (
                      <PlaceholderCard
                        key={`ph-${row.subscription.id}-${row.year}-${row.month}`}
                        subscription={row.subscription}
                        year={row.year}
                        month={row.month}
                        canManage={canManage}
                        onAdd={onAddForPlaceholder}
                      />
                    ),
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
