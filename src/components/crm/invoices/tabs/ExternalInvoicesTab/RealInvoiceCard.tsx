import { Eye, Pencil, Repeat, Trash2 } from 'lucide-react';
import { ExternalInvoice, formatDate, formatMoney } from './ExternalInvoicesTab';

export function RealInvoiceCard({
  inv,
  canManage,
  onPreview,
  onDelete,
  onEdit,
}: {
  inv: ExternalInvoice;
  canManage: boolean;
  onPreview: (path: string | null) => void;
  onDelete: (inv: ExternalInvoice) => void;
  onEdit: (inv: ExternalInvoice) => void;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-[#e5e4e2]">
            {inv.invoice_number}
          </span>

          {inv.subscription_id && (
            <span className="flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs text-emerald-400">
              <Repeat className="h-3 w-3" />
              Subskrypcja
            </span>
          )}

          {inv.label && (
            <span className="rounded-full bg-[#d3bb73]/15 px-2 py-0.5 text-xs text-[#d3bb73]">
              {inv.label}
            </span>
          )}
        </div>

        <div className="mt-1 text-sm text-[#e5e4e2]/70">
          {inv.seller_name}
          {inv.seller_nip ? ` · NIP ${inv.seller_nip}` : ''}
        </div>

        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[#e5e4e2]/50">
          <span>
            Data: {formatDate(inv.invoice_date)}
          </span>

          {inv.payment_method && (
            <span>
              Płatność: {inv.payment_method}
            </span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div className="text-right">
          <div className="font-medium text-[#d3bb73]">
            {formatMoney(inv.amount_gross, inv.currency)}
          </div>

          {inv.amount_net !== null && inv.amount_net !== undefined && (
            <div className="text-xs text-[#e5e4e2]/50">
              netto: {formatMoney(inv.amount_net, inv.currency)}
            </div>
          )}
        </div>

        {inv.file_url && (
          <button
            onClick={() => onPreview(inv.file_url)}
            title="Podgląd faktury"
            className="rounded-lg border border-[#d3bb73]/20 p-2 text-[#e5e4e2]/70 hover:text-[#d3bb73]"
          >
            <Eye className="h-4 w-4" />
          </button>
        )}

        {canManage && (
          <button
            onClick={() => onEdit(inv)}
            title="Edytuj"
            className="rounded-lg border border-[#d3bb73]/20 p-2 text-[#e5e4e2]/70 hover:text-[#d3bb73]"
          >
            <Pencil className="h-4 w-4" />
          </button>
        )}

        {canManage && (
          <button
            onClick={() => onDelete(inv)}
            title="Usuń"
            className="rounded-lg border border-red-500/20 p-2 text-red-400 hover:bg-red-500/10"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}