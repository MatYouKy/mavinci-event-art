'use client';

import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Loader2, ShieldAlert, XCircle } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';

type GuardrailStatus = {
  required: boolean;
  reasons: Array<{ kind: 'discount' | 'margin'; message: string }>;
  discount_percent: number;
  margin_percent: number | null;
  margin_known: boolean;
  approval_status: 'pending' | 'approved' | 'rejected' | null;
  approval_valid: boolean;
  approval_note: string | null;
  can_send: boolean;
  can_approve: boolean;
  limits: { enabled: boolean; max_discount_percent: number; min_margin_percent: number };
};

const percent = (value: number | null | undefined) =>
  `${Number(value || 0).toLocaleString('pl-PL', { maximumFractionDigits: 2 })}%`;

/**
 * Progi handlowe oferty (sales_offer_guardrails): rabat powyżej limitu lub marża poniżej progu
 * wymagają akceptacji administratora przed wysłaniem. Ta sama ocena blokuje wysyłkę w usłudze e-mail.
 */
export default function OfferApprovalBanner({ offerId, revision }: { offerId: string; revision?: unknown }) {
  const { showSnackbar } = useSnackbar();
  const [status, setStatus] = useState<GuardrailStatus | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<'request' | 'approve' | 'reject' | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('get_offer_guardrail_status', { p_offer_id: offerId });
    if (error) {
      // Starsza baza bez progów — nic nie pokazujemy.
      setStatus(null);
      return;
    }
    setStatus((data as GuardrailStatus) || null);
  }, [offerId]);

  useEffect(() => {
    void load();
  }, [load, revision]);

  const run = async (kind: 'request' | 'approve' | 'reject') => {
    if (kind === 'reject' && !note.trim()) {
      showSnackbar('Podaj powód odrzucenia w polu notatki.', 'warning');
      return;
    }
    setBusy(kind);
    const { error } =
      kind === 'request'
        ? await supabase.rpc('request_offer_approval', { p_offer_id: offerId, p_note: note.trim() || null })
        : await supabase.rpc('decide_offer_approval', {
            p_offer_id: offerId,
            p_approve: kind === 'approve',
            p_note: note.trim() || null,
          });
    setBusy(null);
    if (error) {
      showSnackbar(error.message || 'Nie udało się zapisać decyzji', 'error');
      return;
    }
    setNote('');
    showSnackbar(
      kind === 'request' ? 'Wysłano do akceptacji' : kind === 'approve' ? 'Oferta zaakceptowana' : 'Oferta odrzucona',
      'success',
    );
    await load();
  };

  if (!status || !status.limits?.enabled) return null;

  if (!status.required) {
    if (status.margin_known) return null;
    return (
      <p className="rounded-xl bg-white/[0.03] px-4 py-3 text-xs text-[#e5e4e2]/55">
        Oferta nie ma kosztów pozycji — marża nie jest kontrolowana. Uzupełnij koszty w katalogu produktów, aby system
        pilnował progu {percent(status.limits.min_margin_percent)}.
      </p>
    );
  }

  if (status.approval_valid) {
    return (
      <div className="flex items-start gap-3 rounded-xl bg-emerald-400/10 px-4 py-3 text-sm text-emerald-100">
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          Warunki zaakceptowane do wysyłki (rabat {percent(status.discount_percent)}
          {status.margin_percent !== null ? `, marża ${percent(status.margin_percent)}` : ''}).
          {status.approval_note ? ` Notatka: ${status.approval_note}` : ''}
        </span>
      </div>
    );
  }

  const pending = status.approval_status === 'pending';
  const rejected = status.approval_status === 'rejected';

  return (
    <div className="space-y-3 rounded-xl bg-amber-400/10 px-4 py-4 text-sm text-amber-50">
      <div className="flex items-start gap-3">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-200" />
        <div className="space-y-1">
          <p className="font-medium">
            {pending
              ? 'Oferta czeka na akceptację'
              : rejected
                ? 'Akceptacja odrzucona — popraw warunki albo wyślij ponownie z uzasadnieniem'
                : status.approval_status === 'approved'
                  ? 'Warunki zmieniły się po akceptacji — potrzebna ponowna akceptacja'
                  : 'Oferta wymaga akceptacji przed wysłaniem'}
          </p>
          <ul className="text-xs text-amber-100/80">
            {status.reasons.map((reason) => (
              <li key={reason.kind}>{reason.message}</li>
            ))}
          </ul>
          {status.approval_note && <p className="text-xs text-amber-100/70">Notatka: {status.approval_note}</p>}
          {status.can_approve && !pending && (
            <p className="text-xs text-amber-100/70">Jako osoba zatwierdzająca możesz wysłać ofertę bez dodatkowej akceptacji.</p>
          )}
        </div>
      </div>

      <textarea
        value={note}
        onChange={(event) => setNote(event.target.value)}
        rows={2}
        placeholder={status.can_approve ? 'Notatka do decyzji (wymagana przy odrzuceniu)' : 'Uzasadnienie dla akceptującego (np. klient strategiczny)'}
        className="w-full rounded-lg bg-[#0f1119] px-3 py-2 text-sm text-[#e5e4e2] placeholder-[#e5e4e2]/30"
      />

      <div className="flex flex-wrap gap-2">
        {!pending && (
          <button
            type="button"
            onClick={() => void run('request')}
            disabled={busy !== null}
            className="inline-flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#1c1f33] disabled:opacity-50"
          >
            {busy === 'request' && <Loader2 className="h-4 w-4 animate-spin" />}
            Wyślij do akceptacji
          </button>
        )}
        {status.can_approve && (
          <>
            <button
              type="button"
              onClick={() => void run('approve')}
              disabled={busy !== null}
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-400/20 px-4 py-2 text-sm text-emerald-100 disabled:opacity-50"
            >
              {busy === 'approve' ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              Zatwierdź
            </button>
            <button
              type="button"
              onClick={() => void run('reject')}
              disabled={busy !== null}
              className="inline-flex items-center gap-2 rounded-lg bg-red-400/15 px-4 py-2 text-sm text-red-100 disabled:opacity-50"
            >
              {busy === 'reject' ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />}
              Odrzuć
            </button>
          </>
        )}
      </div>
    </div>
  );
}
