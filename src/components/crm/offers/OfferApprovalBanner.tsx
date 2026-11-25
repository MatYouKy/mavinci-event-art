'use client';

import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Clock, Info, Send, ShieldAlert, XCircle } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import FullScreenLoader from '@/components/UI/Loader/CustomModalLoader';
import {
  OFFER_APPROVAL_DONE,
  OFFER_APPROVAL_NOTE_LIMIT,
  OFFER_APPROVAL_REJECT_NOTE,
  loadOfferApproval,
  type OfferApprovalView,
} from '@/lib/CRM/Offers/offerApproval';

type Action = 'request' | 'approve' | 'reject';

const TONES: Record<OfferApprovalView['tone'], { box: string; icon: typeof Info; iconClass: string }> = {
  success: { box: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-50', icon: CheckCircle2, iconClass: 'text-emerald-300' },
  pending: { box: 'border-sky-400/30 bg-sky-400/10 text-sky-50', icon: Clock, iconClass: 'text-sky-300' },
  warning: { box: 'border-amber-400/30 bg-amber-400/10 text-amber-50', icon: ShieldAlert, iconClass: 'text-amber-200' },
  info: { box: 'border-white/10 bg-white/[0.03] text-[#e5e4e2]/70', icon: Info, iconClass: 'text-[#d3bb73]' },
};

const PENDING_TITLES: Record<Action, string> = {
  request: 'Wysyłam do akceptacji',
  approve: 'Zapisuję akceptację',
  reject: 'Zapisuję odrzucenie',
};

/**
 * Akceptacja rabatu ponad limit (progi `sales_offer_guardrails`) w karcie „Informacje” oferty — jak `OfferApprovalPanel`
 * na Macu (ten sam opis stanu: `src/lib/CRM/Offers/offerApproval.ts`). Sprzedawca: „Wyślij do akceptacji” z uzasadnieniem.
 * Administrator: wysyła od razu; prośbę sprzedawcy „Zaakceptuj” albo „Odrzuć” z powodem (sprzedawca go zobaczy).
 */
export default function OfferApprovalBanner({ offerId, revision, onChanged }: {
  offerId: string;
  revision?: unknown;
  onChanged?: () => unknown;
}) {
  const { showSnackbar } = useSnackbar();
  const [view, setView] = useState<OfferApprovalView | null>(null);
  const [note, setNote] = useState('');
  const [noteMissing, setNoteMissing] = useState(false);
  const [busy, setBusy] = useState<Action | null>(null);

  const load = useCallback(async () => {
    setView(await loadOfferApproval(supabase, offerId).catch(() => null));
  }, [offerId]);

  useEffect(() => {
    void load();
  }, [load, revision]);

  useEffect(() => {
    setNote('');
    setNoteMissing(false);
  }, [offerId]);

  const run = async (kind: Action) => {
    const trimmed = note.trim().slice(0, OFFER_APPROVAL_NOTE_LIMIT);
    if (kind === 'reject' && !trimmed) {
      setNoteMissing(true);
      showSnackbar(OFFER_APPROVAL_REJECT_NOTE, 'warning');
      return;
    }
    setBusy(kind);
    const { error } =
      kind === 'request'
        ? await supabase.rpc('request_offer_approval', { p_offer_id: offerId, p_note: trimmed || null })
        : await supabase.rpc('decide_offer_approval', { p_offer_id: offerId, p_approve: kind === 'approve', p_note: trimmed || null });
    setBusy(null);
    if (error) {
      showSnackbar(error.message || 'Nie udało się zapisać decyzji', 'error');
      return;
    }
    setNote('');
    setNoteMissing(false);
    showSnackbar(OFFER_APPROVAL_DONE[kind], 'success');
    await load();
    await onChanged?.();
  };

  if (!view) return null;
  const tone = TONES[view.tone];
  const Icon = tone.icon;
  const actionable = view.canRequest || view.canApprove || view.canReject;

  return (
    <div className={`mb-4 space-y-3 rounded-lg border px-4 py-3 text-sm ${tone.box}`}>
      <FullScreenLoader show={busy !== null} title={busy ? PENDING_TITLES[busy] : ''} description="Czekamy na potwierdzenie serwera." />
      <div className="flex items-start gap-3">
        <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${tone.iconClass}`} aria-hidden />
        <div className="min-w-0 space-y-1">
          <p className="font-medium">{view.title}</p>
          {view.reasons.length > 0 && (
            <ul className="text-xs opacity-80">
              {view.reasons.map((reason) => <li key={reason}>{reason}</li>)}
            </ul>
          )}
          {view.note && (
            <p className="whitespace-pre-wrap break-words text-xs">
              <span className="font-medium">{view.note.label}:</span> {view.note.text}
            </p>
          )}
          {view.meta && <p className="text-xs opacity-60">{view.meta}</p>}
          {view.hint && <p className="text-xs opacity-70">{view.hint}</p>}
        </div>
      </div>

      {actionable && (
        <>
          <textarea
            value={note}
            onChange={(event) => { setNote(event.target.value); if (noteMissing) setNoteMissing(false); }}
            rows={2}
            maxLength={OFFER_APPROVAL_NOTE_LIMIT}
            placeholder={view.notePlaceholder}
            aria-label="Uzasadnienie"
            aria-invalid={noteMissing}
            className={`w-full rounded-lg border bg-[#0f1119] px-3 py-2 text-sm text-[#e5e4e2] placeholder-[#e5e4e2]/30 ${noteMissing ? 'border-red-400/70' : 'border-white/10'}`}
          />
          {noteMissing && <p role="alert" className="text-xs text-red-300">{OFFER_APPROVAL_REJECT_NOTE}</p>}
          <div className="flex flex-wrap gap-2">
            {view.canRequest && (
              <button
                type="button"
                onClick={() => void run('request')}
                disabled={busy !== null}
                className="inline-flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#1c1f33] disabled:opacity-50"
              >
                <Send className="h-4 w-4" aria-hidden /> Wyślij do akceptacji
              </button>
            )}
            {view.canApprove && (
              <button
                type="button"
                onClick={() => void run('approve')}
                disabled={busy !== null}
                className="inline-flex items-center gap-2 rounded-lg bg-emerald-400/20 px-4 py-2 text-sm text-emerald-100 disabled:opacity-50"
              >
                <CheckCircle2 className="h-4 w-4" aria-hidden /> {view.approveLabel}
              </button>
            )}
            {view.canReject && (
              <button
                type="button"
                onClick={() => void run('reject')}
                disabled={busy !== null}
                className="inline-flex items-center gap-2 rounded-lg bg-red-400/15 px-4 py-2 text-sm text-red-100 disabled:opacity-50"
              >
                <XCircle className="h-4 w-4" aria-hidden /> Odrzuć
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
