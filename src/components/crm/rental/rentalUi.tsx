'use client';

import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { RENTAL_STATUS_LABELS, type RentalStatus } from '@/lib/CRM/rental/rental';

/* Wspólne elementy ekranów Rental w CRM (okna, pola, przyciski, plakietki statusu). */

export const rentalButton =
  'inline-flex items-center justify-center gap-2 rounded-lg bg-white/5 px-3 py-2 text-sm text-[#d3bb73] hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50';
export const rentalPrimaryButton =
  'inline-flex items-center justify-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#1c1f33] hover:bg-[#d3bb73]/90 disabled:cursor-not-allowed disabled:opacity-50';
export const rentalDangerButton =
  'inline-flex items-center justify-center gap-2 rounded-lg border border-red-400/30 bg-red-400/10 px-3 py-2 text-sm text-red-200 hover:bg-red-400/20 disabled:cursor-not-allowed disabled:opacity-50';
export const rentalInput =
  'w-full rounded-lg border border-white/10 bg-[#0f1119] px-3 py-2 text-sm text-[#e5e4e2] placeholder-[#e5e4e2]/30 focus:border-[#d3bb73]/60 focus:outline-none disabled:opacity-60';
export const rentalCard = 'rounded-xl border border-[#d3bb73]/15 bg-[#1c1f33] p-4';

const STATUS_TONE: Record<RentalStatus, string> = {
  draft: 'bg-white/10 text-[#e5e4e2]/70',
  reserved: 'bg-sky-400/15 text-sky-200',
  issued: 'bg-[#d3bb73]/20 text-[#d3bb73]',
  returned: 'bg-emerald-400/15 text-emerald-200',
  settled: 'bg-emerald-500/20 text-emerald-100',
  cancelled: 'bg-red-400/15 text-red-200',
};

export function RentalStatusBadge({ status }: { status: RentalStatus }) {
  return <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_TONE[status]}`}>{RENTAL_STATUS_LABELS[status]}</span>;
}

export function RentalField({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium uppercase tracking-wide text-[#e5e4e2]/55">{label}</span>
      {children}
      {hint && <span className="block text-xs text-[#e5e4e2]/45">{hint}</span>}
    </label>
  );
}

export function RentalModal({
  title,
  subtitle,
  onClose,
  children,
  footer,
  wide,
  extraWide,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  /** Najszersze okno (katalog magazynu z pozycjami). */
  extraWide?: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-label={title} data-crm-modal="true">
      <div className={`flex max-h-[92vh] w-full ${extraWide ? 'max-w-7xl' : wide ? 'max-w-5xl' : 'max-w-2xl'} flex-col rounded-2xl border border-[#d3bb73]/20 bg-[#0f1119] shadow-2xl`}>
        <div className="flex items-start justify-between gap-4 border-b border-white/5 px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-xl font-light uppercase tracking-wide text-[#e5e4e2]">{title}</h2>
            {subtitle && <p className="mt-0.5 text-sm text-[#e5e4e2]/55">{subtitle}</p>}
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-[#e5e4e2]/60 hover:bg-white/5 hover:text-[#e5e4e2]" aria-label="Zamknij">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-white/5 px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

export function RentalSection({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className={rentalCard}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-light uppercase tracking-wide text-[#e5e4e2]">{title}</h2>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

export function RentalError({ message }: { message: string | null }) {
  if (!message) return null;
  return <p role="alert" className="rounded-lg border border-red-400/30 bg-red-400/10 p-3 text-sm text-red-200">{message}</p>;
}

/** Liczba z pola (pusty tekst → null). */
export const numberOrNull = (value: string) => {
  const normalized = value.replace(',', '.').trim();
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
};
