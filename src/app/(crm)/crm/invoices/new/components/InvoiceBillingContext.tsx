'use client';

import { Building2, CalendarDays } from 'lucide-react';

export type BillingArrangement = 'direct' | 'hotel' | 'agency' | 'other';

interface InvoiceBillingContextProps {
  eventName: string;
  eventDate?: string | null;
  serviceRecipientName?: string | null;
  arrangement: BillingArrangement;
  payerName?: string | null;
  onArrangementChange: (arrangement: BillingArrangement) => void;
}

const ARRANGEMENT_DESCRIPTION: Record<BillingArrangement, string> = {
  direct: 'Nabywcą faktury jest klient przypisany do wydarzenia.',
  hotel:
    'Hotel będzie nabywcą i płatnikiem faktury. Klient oraz wydarzenie pozostaną powiązane w CRM.',
  agency:
    'Agencja lub pośrednik będzie nabywcą faktury. Klient oraz wydarzenie pozostaną powiązane w CRM.',
  other:
    'Inna organizacja będzie nabywcą faktury. Klient oraz wydarzenie pozostaną powiązane w CRM.',
};

export default function InvoiceBillingContext({
  eventName,
  eventDate,
  serviceRecipientName,
  arrangement,
  payerName,
  onArrangementChange,
}: InvoiceBillingContextProps) {
  const indirect = arrangement !== 'direct';

  return (
    <div className="rounded-xl border border-[#d3bb73]/25 bg-[#d3bb73]/5 p-4">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <CalendarDays className="mt-0.5 h-5 w-5 shrink-0 text-[#d3bb73]" />
          <div className="min-w-0">
            <div className="text-xs uppercase tracking-wide text-[#e5e4e2]/45">
              Rozliczenie wydarzenia
            </div>
            <div className="truncate font-medium text-[#e5e4e2]">{eventName}</div>
            <div className="mt-1 text-xs text-[#e5e4e2]/55">
              {[serviceRecipientName, eventDate ? new Date(eventDate).toLocaleDateString('pl-PL') : null]
                .filter(Boolean)
                .join(' · ')}
            </div>
          </div>
        </div>

        {indirect && payerName && (
          <div className="flex items-center gap-2 rounded-lg border border-sky-400/20 bg-sky-400/10 px-3 py-2 text-xs text-sky-200">
            <Building2 className="h-4 w-4" />
            Płatnik: {payerName}
          </div>
        )}
      </div>

      <label className="block text-sm text-[#e5e4e2]/70">
        Kto opłaca wydarzenie?
        <select
          value={arrangement}
          onChange={(event) => onArrangementChange(event.target.value as BillingArrangement)}
          className="mt-2 w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-3 text-[#e5e4e2]"
        >
          <option value="direct">Klient wydarzenia — rozliczenie bezpośrednie</option>
          <option value="hotel">Hotel</option>
          <option value="agency">Agencja lub pośrednik</option>
          <option value="other">Inna organizacja</option>
        </select>
      </label>

      <p className="mt-2 text-xs leading-5 text-[#e5e4e2]/55">
        {ARRANGEMENT_DESCRIPTION[arrangement]}
      </p>

      {indirect && (
        <p className="mt-2 text-xs font-medium text-sky-300">
          Poniżej wybierz organizację, której dane mają znaleźć się na fakturze.
        </p>
      )}
    </div>
  );
}
