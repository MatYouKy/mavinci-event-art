'use client';

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader, ShieldCheck, Sparkles, X } from 'lucide-react';
import type {
  ContractAuditBlock,
  ContractAuditIssue,
  ContractAuditResult,
} from '@/lib/CRM/contracts/contractAudit';

type ContractAuditReviewModalProps = {
  audit: ContractAuditResult;
  blocks: ContractAuditBlock[];
  isApplying: boolean;
  onClose: () => void;
  onApply: (selections: Record<string, string>) => void;
};

const severityStyles: Record<ContractAuditIssue['severity'], string> = {
  error: 'border-red-400/30 bg-red-500/10 text-red-100',
  warning: 'border-amber-400/30 bg-amber-500/10 text-amber-100',
  info: 'border-sky-400/25 bg-sky-500/10 text-sky-100',
};

const excerpt = (value = '') => (value.length > 260 ? `${value.slice(0, 257)}…` : value);

export default function ContractAuditReviewModal({
  audit,
  blocks,
  isApplying,
  onClose,
  onApply,
}: ContractAuditReviewModalProps) {
  const [selections, setSelections] = useState<Record<string, string>>({});
  const blockById = useMemo(() => new Map(blocks.map((block) => [block.id, block])), [blocks]);
  const decisionIssues = audit.issues.filter((issue) => issue.options.length > 0);
  const allDecisionsMade = decisionIssues.every((issue) => Boolean(selections[issue.id]));
  const hasChanges = audit.duplicates.length > 0 || decisionIssues.length > 0;

  useEffect(() => {
    setSelections({});
  }, [audit]);

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/75 p-3 backdrop-blur-sm md:p-6">
      <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-[#d3bb73]/25 bg-[#2c0b18] shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-[#d3bb73]/15 px-5 py-4 md:px-6">
          <div className="flex min-w-0 items-start gap-3">
            <div className="rounded-xl bg-[#d3bb73]/15 p-2 text-[#d3bb73]">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-[#f2eee2]">Przegląd audytu AI</h3>
              <p className="mt-1 text-sm leading-5 text-[#e5e4e2]/65">{audit.summary}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isApplying}
            className="rounded-lg p-2 text-[#e5e4e2]/55 transition-colors hover:bg-white/5 hover:text-white disabled:opacity-40"
            aria-label="Zamknij audyt"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 space-y-6 overflow-y-auto px-5 py-5 md:px-6">
          <div className="rounded-xl border border-emerald-400/20 bg-emerald-500/10 p-4">
            <div className="flex items-start gap-3">
              <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-300" />
              <div>
                <div className="font-medium text-emerald-100">Bezpieczny zakres zmian</div>
                <p className="mt-1 text-xs leading-5 text-emerald-100/65">
                  Dane stron, reprezentantów, kontakty, identyfikatory i podpisy zostały wyłączone
                  z analizy. Asystent nie zmienia samodzielnie kwot, terminów, zakresu ani
                  odpowiedzialności. Audyt wspiera redakcję draftu i nie zastępuje weryfikacji prawnej.
                </p>
              </div>
            </div>
          </div>

          <section>
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h4 className="font-semibold text-[#f2eee2]">Duplikaty do usunięcia</h4>
                <p className="mt-1 text-xs text-[#e5e4e2]/50">
                  Te powtórzenia zostaną usunięte automatycznie po zatwierdzeniu audytu.
                </p>
              </div>
              <span className="rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-semibold text-emerald-200">
                {audit.duplicates.length}
              </span>
            </div>

            {audit.duplicates.length === 0 ? (
              <div className="rounded-xl border border-white/10 bg-white/[0.025] p-4 text-sm text-[#e5e4e2]/55">
                Nie znaleziono pewnych duplikatów.
              </div>
            ) : (
              <div className="space-y-3">
                {audit.duplicates.map((duplicate) => (
                  <div
                    key={duplicate.id}
                    className="rounded-xl border border-emerald-400/20 bg-emerald-500/5 p-4"
                  >
                    <div className="flex items-start gap-2 text-sm font-medium text-emerald-100">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                      <span>{duplicate.reason}</span>
                    </div>
                    <div className="mt-3 grid gap-2 text-xs md:grid-cols-2">
                      <div className="rounded-lg bg-black/20 p-3 text-[#e5e4e2]/70">
                        <span className="mb-1 block font-semibold text-emerald-200">Pozostaje</span>
                        {excerpt(blockById.get(duplicate.keepBlockId)?.text || '')}
                      </div>
                      <div className="rounded-lg bg-black/20 p-3 text-[#e5e4e2]/70">
                        <span className="mb-1 block font-semibold text-red-200">Usuwane</span>
                        {duplicate.removeBlockIds
                          .map((id) => excerpt(blockById.get(id)?.text || ''))
                          .filter(Boolean)
                          .join(' / ')}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section>
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h4 className="font-semibold text-[#f2eee2]">Kwestie do decyzji</h4>
                <p className="mt-1 text-xs text-[#e5e4e2]/50">
                  Wybierz wariant w każdym spornym punkcie. Zawsze możesz pozostawić oryginał.
                </p>
              </div>
              <span className="rounded-full bg-amber-500/15 px-2.5 py-1 text-xs font-semibold text-amber-200">
                {audit.issues.length}
              </span>
            </div>

            {audit.issues.length === 0 ? (
              <div className="rounded-xl border border-white/10 bg-white/[0.025] p-4 text-sm text-[#e5e4e2]/55">
                Nie znaleziono kwestii wymagających decyzji.
              </div>
            ) : (
              <div className="space-y-4">
                {audit.issues.map((issue) => (
                  <div key={issue.id} className={`rounded-xl border p-4 ${severityStyles[issue.severity]}`}>
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                      <div>
                        <div className="font-semibold">{issue.title}</div>
                        <p className="mt-1 text-sm leading-5 opacity-80">{issue.description}</p>
                      </div>
                    </div>

                    {issue.relatedBlockIds.length > 0 && (
                      <div className="mt-3 space-y-1 rounded-lg bg-black/20 p-3 text-xs leading-5 text-[#e5e4e2]/65">
                        {issue.relatedBlockIds.map((blockId) => (
                          <p key={blockId}>„{excerpt(blockById.get(blockId)?.text || '')}”</p>
                        ))}
                      </div>
                    )}

                    {issue.options.length > 0 && (
                      <div className="mt-3 space-y-2">
                        {[
                          ...issue.options,
                          {
                            id: '__keep_original__',
                            label: 'Pozostaw bez zmian',
                            explanation: 'Zachowaj obecną treść i rozstrzygnij temat później.',
                            operations: [],
                          },
                        ].map((option) => (
                          <label
                            key={option.id}
                            className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${
                              selections[issue.id] === option.id
                                ? 'border-[#d3bb73]/60 bg-[#d3bb73]/10'
                                : 'border-white/10 bg-black/15 hover:border-white/20'
                            }`}
                          >
                            <input
                              type="radio"
                              name={`contract-audit-${issue.id}`}
                              value={option.id}
                              checked={selections[issue.id] === option.id}
                              onChange={() =>
                                setSelections((current) => ({ ...current, [issue.id]: option.id }))
                              }
                              className="mt-1 accent-[#d3bb73]"
                            />
                            <span className="min-w-0 text-sm text-[#f2eee2]">
                              <span className="font-medium">
                                {option.label}
                                {issue.recommendedOptionId === option.id && (
                                  <span className="ml-2 rounded bg-[#d3bb73]/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-[#d3bb73]">
                                    rekomendowane
                                  </span>
                                )}
                              </span>
                              <span className="mt-1 block text-xs leading-5 text-[#e5e4e2]/55">
                                {option.explanation}
                              </span>
                            </span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        <div className="flex flex-col-reverse gap-3 border-t border-[#d3bb73]/15 px-5 py-4 sm:flex-row sm:items-center sm:justify-between md:px-6">
          <p className="text-xs text-[#e5e4e2]/45">
            {decisionIssues.length > 0
              ? `Wybrano ${Object.keys(selections).length} z ${decisionIssues.length} decyzji.`
              : 'Audyt nie wymaga dodatkowych decyzji.'}
          </p>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isApplying}
              className="rounded-lg px-4 py-2 text-sm text-[#e5e4e2]/70 hover:bg-white/5 disabled:opacity-40"
            >
              Anuluj
            </button>
            <button
              type="button"
              onClick={() => (hasChanges ? onApply(selections) : onClose())}
              disabled={isApplying || (hasChanges && !allDecisionsMade)}
              className="inline-flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-semibold text-[#210811] transition-colors hover:bg-[#e0c981] disabled:cursor-not-allowed disabled:opacity-45"
            >
              {isApplying && <Loader className="h-4 w-4 animate-spin" />}
              {hasChanges ? (isApplying ? 'Zapisywanie…' : 'Zastosuj audyt') : 'Zamknij'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
