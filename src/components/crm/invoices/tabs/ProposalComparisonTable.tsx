'use client';

import { AlertTriangle, CheckCircle2, MinusCircle, XCircle } from 'lucide-react';
import {
  comparisonSummary,
  type ComparisonRow,
  type ComparisonSegment,
  type ComparisonState,
} from '@/lib/invoices/proposalComparison';

/*
 * Uzgodnienie wyciągów → propozycja systemu: „Co do czego pasuje” — płatność z wyciągu obok dokumentu, wiersz po wierszu
 * (kwota, kontrahent, numer w tytule, data, oznaczenie ręczne), z zaznaczonym fragmentem, który się zgadza
 * (`proposalComparison`). Ten sam układ na Macu (`ReconciliationInspector`).
 */

const STATE: Record<ComparisonState, { icon: typeof CheckCircle2; className: string; label: string }> = {
  match: { icon: CheckCircle2, className: 'text-green-300', label: 'Zgadza się' },
  partial: { icon: AlertTriangle, className: 'text-amber-300', label: 'Do sprawdzenia' },
  mismatch: { icon: XCircle, className: 'text-red-300', label: 'Nie zgadza się' },
  info: { icon: MinusCircle, className: 'text-[#e5e4e2]/45', label: 'Bez porównania' },
};

function Segments({ segments }: { segments: ComparisonSegment[] }) {
  return (
    <>
      {segments.map((segment, index) => (segment.hit ? (
        <mark key={index} className="rounded-sm bg-green-500/25 px-0.5 font-medium text-green-100">{segment.text}</mark>
      ) : (
        <span key={index}>{segment.text}</span>
      )))}
    </>
  );
}

export default function ProposalComparisonTable({ rows }: { rows: ComparisonRow[] }) {
  if (!rows.length) return null;
  const summary = comparisonSummary(rows);
  return (
    <div className="mt-2 overflow-hidden rounded-md border border-white/10 bg-[#0f1119]/60 text-[11px] leading-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 border-b border-white/10 px-2.5 py-1.5">
        <span className="uppercase tracking-wide text-[#e5e4e2]/70">Co do czego pasuje</span>
        {summary && <span className="text-[#e5e4e2]/50">{summary}</span>}
      </div>
      <div className="hidden grid-cols-[7.5rem_minmax(0,1fr)_minmax(0,1fr)] gap-x-3 border-b border-white/5 px-2.5 py-1 text-[10px] uppercase tracking-wide text-[#e5e4e2]/40 md:grid">
        <span />
        <span>Płatność z wyciągu</span>
        <span>Dokument</span>
      </div>
      {rows.map((row) => {
        const meta = STATE[row.state];
        const Icon = meta.icon;
        return (
          <div key={row.key}
            className="grid grid-cols-1 gap-x-3 gap-y-0.5 border-b border-white/5 px-2.5 py-1.5 last:border-b-0 md:grid-cols-[7.5rem_minmax(0,1fr)_minmax(0,1fr)]">
            <span className={`flex items-start gap-1 font-medium ${meta.className}`} title={meta.label}>
              <Icon className="mt-px h-3.5 w-3.5 shrink-0" aria-label={meta.label} />{row.label}
            </span>
            <span className="min-w-0 break-words text-[#e5e4e2]/80">
              <span className="text-[#e5e4e2]/40 md:hidden">Wyciąg: </span><Segments segments={row.payment} />
            </span>
            <span className="min-w-0 break-words text-[#e5e4e2]/80">
              <span className="text-[#e5e4e2]/40 md:hidden">Dokument: </span><Segments segments={row.document} />
            </span>
            <span className={`md:col-span-2 md:col-start-2 ${meta.className}`}>{row.verdict}</span>
          </div>
        );
      })}
    </div>
  );
}
