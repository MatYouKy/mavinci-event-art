'use client';
import { useState } from 'react';
import { FilePlus2, Plus } from 'lucide-react';
import {
  formatPln,
  settlementLinesBySection,
  type EventSettlement,
  type SettlementCategory,
  type SettlementLine,
  type SettlementTotals,
} from '@/lib/events/settlement/eventSettlement';
import ManualLineForm from './ManualLineForm';
import SettlementLineRow, { type AskConfirm } from './SettlementLineRow';
import type { SettlementMutate } from './useEventSettlement';
import { accentButtonClass } from './settlementUi';

/** Suma sekcji z bazy (suma pozycji wliczonych) — interfejs jej nie przelicza. */
const SECTION_TOTAL: Record<SettlementCategory, keyof SettlementTotals> = {
  revenue: 'revenue_net',
  subcontractor: 'subcontractor_net',
  direct_cost: 'direct_cost_net',
  team: 'team_net',
  external_commission: 'external_commission_lines',
};

export default function SettlementLinesTable({
  eventId,
  settlement,
  busy,
  mutate,
  askConfirm,
  onAddInvoice,
}: {
  eventId: string;
  settlement: EventSettlement;
  busy: string | null;
  mutate: SettlementMutate;
  askConfirm: AskConfirm;
  /** Brak = przycisk ukryty (np. osoba bez dostępu do finansów wydarzenia). */
  onAddInvoice?: () => void;
}) {
  const [manualEditor, setManualEditor] = useState<SettlementLine | 'new' | null>(null);
  const sections = settlementLinesBySection(settlement.lines);
  const canEdit = settlement.can_edit;

  return (
    <section aria-labelledby="settlement-lines-heading" className="rounded-xl bg-white/5 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id="settlement-lines-heading" className="font-medium text-[#e5e4e2]">
            Przychody i koszty netto
          </h3>
          <p className="mt-0.5 text-xs text-[#e5e4e2]/55">
            Pozycje z faktur, kosztów, zleceń, ewidencji czasu i prowizji. Wyłączone pozycje zostają widoczne, ale nie liczą się do sum.
          </p>
        </div>
        {canEdit && (
          <div className="flex flex-wrap gap-2">
            {onAddInvoice && (
              <button type="button" disabled={Boolean(busy)} onClick={onAddInvoice} className={accentButtonClass}>
                <FilePlus2 className="h-4 w-4" aria-hidden />
                Dodaj fakturę kosztową
              </button>
            )}
            <button
              type="button"
              disabled={Boolean(busy) || manualEditor !== null}
              onClick={() => setManualEditor('new')}
              className={accentButtonClass}
            >
              <Plus className="h-4 w-4" aria-hidden />
              Dodaj pozycję
            </button>
          </div>
        )}
      </div>

      {canEdit && manualEditor === 'new' && (
        <div className="mt-4">
          <ManualLineForm eventId={eventId} line={null} busy={busy} mutate={mutate} onClose={() => setManualEditor(null)} />
        </div>
      )}

      <div className="mt-4 space-y-5">
        {sections.map(section => (
          <div key={section.id}>
            <div className="flex items-baseline justify-between gap-3 rounded-lg bg-black/15 px-3 py-2">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-[#d3bb73]">
                {section.label}
                <span className="ml-2 font-normal normal-case tracking-normal text-[#e5e4e2]/40">{section.lines.length}</span>
              </h4>
              <span className="text-sm font-medium tabular-nums text-[#e5e4e2]">
                {formatPln(settlement.totals[SECTION_TOTAL[section.id]])}
              </span>
            </div>
            {section.lines.length === 0 ? (
              <p className="px-3 py-2 text-xs text-[#e5e4e2]/40">Brak pozycji.</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {section.lines.map(line =>
                  canEdit && manualEditor !== null && manualEditor !== 'new' && manualEditor.key === line.key ? (
                    <li key={line.key}>
                      <ManualLineForm
                        eventId={eventId}
                        line={line}
                        busy={busy}
                        mutate={mutate}
                        onClose={() => setManualEditor(null)}
                      />
                    </li>
                  ) : (
                    <SettlementLineRow
                      key={line.key}
                      eventId={eventId}
                      line={line}
                      canEdit={canEdit}
                      disabled={Boolean(busy)}
                      saving={busy === `line:${line.key}`}
                      mutate={mutate}
                      askConfirm={askConfirm}
                      onEditManual={setManualEditor}
                    />
                  ),
                )}
              </ul>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
