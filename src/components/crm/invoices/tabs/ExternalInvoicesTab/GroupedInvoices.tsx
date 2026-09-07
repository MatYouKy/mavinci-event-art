import { useMemo } from 'react';
import {
  ExternalInvoice,
  formatDate,
  formatMoney,
  MONTH_NAMES,
  Subscription,
} from './ExternalInvoicesTab';
import { buildInvoiceGroups } from './buildInvoiceGroups';
import {
  AlertTriangle,
  Eye,
  Copy,
  Pencil,
  Plus,
  Repeat,
  Trash2,
} from 'lucide-react';
import { RealInvoiceCard } from './RealInvoiceCard';
import { PlaceholderCard } from './PlaceholderCard';
import {
  TableColumnOption,
  TableDensity,
  tableDensityClasses,
} from '../../TablePreferencesControl';
import ResponsiveActionBar from '../../../ResponsiveActionBar';

export const EXTERNAL_INVOICE_COLUMNS: TableColumnOption[] = [
  { id: 'number', label: 'Numer faktury', required: true },
  { id: 'label', label: 'Nazwa opisowa' },
  { id: 'seller', label: 'Sprzedawca' },
  { id: 'date', label: 'Data' },
  { id: 'payment', label: 'Płatność' },
  { id: 'net', label: 'Netto' },
  { id: 'gross', label: 'Brutto' },
  { id: 'actions', label: 'Akcje' },
];

export function GroupedInvoices({
  invoices,
  subscriptions,
  canManage,
  onPreview,
  onDelete,
  onAddForPlaceholder,
  onEdit,
  onAddSimilar,
  viewMode,
  density,
  isColumnVisible,
  hasSearchQuery,
}: {
  onEdit: (inv: ExternalInvoice) => void;
  onAddSimilar: (inv: ExternalInvoice) => void;
  invoices: ExternalInvoice[];
  subscriptions: Subscription[];
  canManage: boolean;
  onPreview: (path: string | null) => void;
  onDelete: (inv: ExternalInvoice) => void;
  onAddForPlaceholder: (sub: Subscription, year: number, month: number) => void;
  viewMode: 'table' | 'list';
  density: TableDensity;
  isColumnVisible: (id: string) => boolean;
  hasSearchQuery?: boolean;
}) {
  const groups = useMemo(
    () => buildInvoiceGroups(invoices, subscriptions),
    [invoices, subscriptions],
  );

  if (groups.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-[#d3bb73]/20 py-16 text-center text-[#e5e4e2]/50">
        {hasSearchQuery
          ? 'Nie znaleziono faktur pasujących do wyszukiwania.'
          : 'Brak faktur spoza KSeF. Dodaj pierwszą fakturę papierową, zagraniczną lub paragon — subskrypcje pojawią się tu automatycznie co miesiąc.'}
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
                {viewMode === 'table' ? (
                  <div className="overflow-x-auto overscroll-x-contain rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33]">
                    <table
                      className={`w-full min-w-[1424px] table-fixed border-collapse ${tableDensityClasses[density]}`}
                    >
                      <colgroup>
                        <col className="w-[210px]" />
                        {isColumnVisible('label') && <col className="w-[280px]" />}
                        {isColumnVisible('seller') && <col className="w-[360px]" />}
                        {isColumnVisible('date') && <col className="w-[120px]" />}
                        {isColumnVisible('payment') && <col className="w-[120px]" />}
                        {isColumnVisible('net') && <col className="w-[135px]" />}
                        {isColumnVisible('gross') && <col className="w-[135px]" />}
                        {isColumnVisible('actions') && <col className="w-[64px]" />}
                      </colgroup>
                      <thead>
                        <tr className="border-b border-[#d3bb73]/10 bg-[#0f1119]">
                          <th className="sticky left-0 z-10 bg-[#0f1119] px-2.5 py-2 text-left text-[11px] font-medium uppercase tracking-wide text-[#e5e4e2]/50">
                            Numer faktury
                          </th>
                          {isColumnVisible('label') && (
                            <th className="px-2.5 py-2 text-left text-[11px] font-medium uppercase tracking-wide text-[#e5e4e2]/50">
                              Nazwa opisowa
                            </th>
                          )}
                          {isColumnVisible('seller') && (
                            <th className="px-2.5 py-2 text-left text-[11px] font-medium uppercase tracking-wide text-[#e5e4e2]/50">
                              Sprzedawca
                            </th>
                          )}
                          {isColumnVisible('date') && (
                            <th className="px-2.5 py-2 text-left text-[11px] font-medium uppercase tracking-wide text-[#e5e4e2]/50">Data</th>
                          )}
                          {isColumnVisible('payment') && (
                            <th className="px-2.5 py-2 text-left text-[11px] font-medium uppercase tracking-wide text-[#e5e4e2]/50">Płatność</th>
                          )}
                          {isColumnVisible('net') && (
                            <th className="px-2.5 py-2 text-right text-[11px] font-medium uppercase tracking-wide text-[#e5e4e2]/50">Netto</th>
                          )}
                          {isColumnVisible('gross') && (
                            <th className="px-2.5 py-2 text-right text-[11px] font-medium uppercase tracking-wide text-[#e5e4e2]/50">Brutto</th>
                          )}
                          {isColumnVisible('actions') && (
                            <th className="px-2.5 py-2 text-right text-[11px] font-medium uppercase tracking-wide text-[#e5e4e2]/50">Akcje</th>
                          )}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#d3bb73]/10">
                        {monthGroup.rows.map((row) => {
                          if (row.kind === 'placeholder') {
                            const { subscription, year, month } = row;
                            return (
                              <tr
                                key={`ph-${subscription.id}-${year}-${month}`}
                                className="bg-red-500/5"
                              >
                                <td className="sticky left-0 z-[1] bg-[#201b29] px-2.5 py-2">
                                  <span className="inline-flex items-center gap-1 rounded-full bg-red-500/15 px-1.5 py-0.5 font-medium text-red-400">
                                    <AlertTriangle className="h-3 w-3" />
                                    Brak faktury
                                  </span>
                                </td>
                                {isColumnVisible('label') && (
                                  <td className="overflow-hidden px-2.5 py-2 text-[#e5e4e2]/75">
                                    <div className="truncate" title={subscription.name}>{subscription.name}</div>
                                  </td>
                                )}
                                {isColumnVisible('seller') && (
                                  <td className="overflow-hidden px-2.5 py-2 text-[#e5e4e2]/70">
                                    <div
                                      className="truncate"
                                      title={`${subscription.seller_name || subscription.name}${subscription.seller_nip ? ` · ${subscription.seller_nip}` : ''}`}
                                    >
                                      {subscription.seller_name || subscription.name}
                                      {subscription.seller_nip ? ` · ${subscription.seller_nip}` : ''}
                                    </div>
                                  </td>
                                )}
                                {isColumnVisible('date') && (
                                  <td className="whitespace-nowrap px-2.5 py-2 text-[#e5e4e2]/70">{MONTH_NAMES[month - 1]} {year}</td>
                                )}
                                {isColumnVisible('payment') && (
                                  <td className="whitespace-nowrap px-2.5 py-2 text-[#e5e4e2]/60">{subscription.payment_method || '—'}</td>
                                )}
                                {isColumnVisible('net') && (
                                  <td className="px-2.5 py-2 text-right text-[#e5e4e2]/40">—</td>
                                )}
                                {isColumnVisible('gross') && (
                                  <td className="whitespace-nowrap px-2.5 py-2 text-right font-medium text-red-400">{formatMoney(subscription.amount, subscription.currency)}</td>
                                )}
                                {isColumnVisible('actions') && (
                                <td className="px-2.5 py-2 text-right">
                                  {canManage && (
                                    <button
                                      type="button"
                                      onClick={() => onAddForPlaceholder(subscription, year, month)}
                                      className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md bg-[#d3bb73] px-2.5 py-1.5 text-xs font-medium text-[#0a0d1a] hover:bg-[#d3bb73]/90"
                                    >
                                      <Plus className="h-4 w-4" />
                                      Dodaj
                                    </button>
                                  )}
                                </td>
                                )}
                              </tr>
                            );
                          }

                          const inv = row.invoice;
                          return (
                            <tr
                              key={`inv-${inv.id}`}
                              className="transition-colors hover:bg-[#d3bb73]/5"
                            >
                              <td className="sticky left-0 z-[1] overflow-hidden bg-[#1c1f33] px-2.5 py-2">
                                <div className="truncate text-sm font-medium text-[#e5e4e2]" title={inv.invoice_number}>
                                  {inv.invoice_number}
                                </div>
                              </td>
                              {isColumnVisible('label') && (
                                <td className="overflow-hidden px-2.5 py-2 text-[#e5e4e2]/75">
                                  <div className="truncate" title={inv.label || undefined}>
                                    {inv.label || '—'}
                                    {inv.subscription_id && (
                                      <Repeat className="ml-1 inline h-3 w-3 text-emerald-400" />
                                    )}
                                  </div>
                                </td>
                              )}
                              {isColumnVisible('seller') && (
                                <td className="overflow-hidden px-2.5 py-2 text-[#e5e4e2]/70">
                                  <div className="truncate" title={`${inv.seller_name}${inv.seller_nip ? ` · ${inv.seller_nip}` : ''}`}>
                                    {inv.seller_name}{inv.seller_nip ? ` · ${inv.seller_nip}` : ''}
                                  </div>
                                </td>
                              )}
                              {isColumnVisible('date') && (
                                <td className="whitespace-nowrap px-2.5 py-2 text-[#e5e4e2]/70">{formatDate(inv.invoice_date)}</td>
                              )}
                              {isColumnVisible('payment') && (
                                <td className="whitespace-nowrap px-2.5 py-2 text-[#e5e4e2]/60">{inv.payment_method || '—'}</td>
                              )}
                              {isColumnVisible('net') && (
                                <td className="whitespace-nowrap px-2.5 py-2 text-right text-[#e5e4e2]/60">{formatMoney(inv.amount_net, inv.currency)}</td>
                              )}
                              {isColumnVisible('gross') && (
                                <td className="whitespace-nowrap px-2.5 py-2 text-right font-medium text-[#d3bb73]">{formatMoney(inv.amount_gross, inv.currency)}</td>
                              )}
                              {isColumnVisible('actions') && (
                              <td className="px-2.5 py-2">
                                <div className="flex justify-end">
                                  <ResponsiveActionBar
                                    disabledBackground
                                    compact
                                    mobileBreakpoint={4000}
                                    actions={[
                                      ...(inv.file_url
                                        ? [{ label: 'Podgląd', onClick: () => onPreview(inv.file_url), icon: <Eye className="h-4 w-4" /> }]
                                        : []),
                                      ...(canManage
                                        ? [
                                            { label: 'Edytuj', onClick: () => onEdit(inv), icon: <Pencil className="h-4 w-4" /> },
                                            { label: 'Dodaj podobną', onClick: () => onAddSimilar(inv), icon: <Copy className="h-4 w-4" /> },
                                            { label: 'Usuń', onClick: () => onDelete(inv), icon: <Trash2 className="h-4 w-4" />, variant: 'danger' as const },
                                          ]
                                        : []),
                                    ]}
                                  />
                                </div>
                              </td>
                              )}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
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
                          onAddSimilar={onAddSimilar}
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
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
