'use client';

import { useState } from 'react';
import { Eye, EyeOff, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { SellerDialog, errorText, sellerFieldClass, sellerPrimaryButton, sellerSecondaryButton } from './sellerUi';

type Props = {
  partnerId: string;
  companyId: string;
  brandName: string;
  visible: boolean;
  /** Krótki wariant (kokpit) — sam przełącznik z etykietą marki. */
  compact?: boolean;
  disabled?: boolean;
  onChanged?: (visible: boolean) => void;
};

/**
 * „Pokaż wynagrodzenie w portalu” dla jednej marki sprzedawcy (set_seller_commission_visibility).
 * Prowizje naliczają się niezależnie od widoczności; zmiana jest audytowana w bazie.
 */
export default function CommissionVisibilityToggle({ partnerId, companyId, brandName, visible, compact = false, disabled = false, onChanged }: Props) {
  const { showSnackbar } = useSnackbar();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [notify, setNotify] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const next = !visible;

  const start = () => { setReason(''); setNotify(true); setError(''); setOpen(true); };
  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    const { error: rpcError } = await supabase.rpc('set_seller_commission_visibility', {
      p_partner: partnerId,
      p_company: companyId,
      p_visible: next,
      p_reason: reason.trim() || null,
      p_notify: next ? notify : false,
    });
    setBusy(false);
    if (rpcError) {
      const message = errorText(rpcError, 'Nie udało się zmienić widoczności wynagrodzenia.');
      setError(message);
      showSnackbar(message, 'error');
      return;
    }
    setOpen(false);
    showSnackbar(next ? `Wynagrodzenie marki ${brandName} jest teraz widoczne w portalu.` : `Ukryto wynagrodzenie marki ${brandName} w portalu.`, 'success');
    onChanged?.(next);
    window.dispatchEvent(new Event('seller-workspace-changed'));
  };

  return <>
    <button
      type="button"
      role="switch"
      aria-checked={visible}
      disabled={disabled}
      onClick={start}
      title={visible ? 'Wynagrodzenie widoczne w portalu — kliknij, aby ukryć' : 'Wynagrodzenie ukryte w portalu — kliknij, aby pokazać'}
      className={`group inline-flex items-center gap-2 rounded-full text-left text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${compact ? 'px-1 py-0.5' : 'bg-white/[0.04] px-3 py-2 hover:bg-white/[0.07]'}`}
    >
      <span className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${visible ? 'bg-emerald-400/70' : 'bg-white/15'}`}>
        <span className={`absolute h-4 w-4 rounded-full bg-white shadow transition-transform ${visible ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
      </span>
      <span className={visible ? 'text-emerald-100' : 'text-white/55'}>
        {compact ? (visible ? 'Wynagrodzenie widoczne' : 'Wynagrodzenie ukryte') : 'Pokaż wynagrodzenie w portalu'}
      </span>
    </button>
    <SellerDialog
      open={open}
      busy={busy}
      onClose={() => setOpen(false)}
      title={next ? `Pokazać wynagrodzenie — ${brandName}?` : `Ukryć wynagrodzenie — ${brandName}?`}
      description={next
        ? 'Sprzedawca zobaczy prowizje i dostanie powiadomienie. W portalu pojawią się stawka, naliczenia i historia wypłat tej marki.'
        : 'Sprzedawca przestanie widzieć stawkę, naliczenia i wypłaty tej marki. Prowizje nadal będą naliczane i rozliczane w CRM.'}
      footer={<>
        <button type="button" onClick={() => setOpen(false)} disabled={busy} className={sellerSecondaryButton}>Anuluj</button>
        <button type="button" onClick={() => void submit()} disabled={busy} className={sellerPrimaryButton}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : next ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
          {next ? 'Pokaż wynagrodzenie' : 'Ukryj wynagrodzenie'}
        </button>
      </>}
    >
      <label className="block text-xs text-white/55">Powód (opcjonalnie, trafi do historii zmian)
        <textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={3} maxLength={500} className={`${sellerFieldClass} mt-1.5 resize-y`} placeholder={next ? 'np. Pierwsza oferta zaakceptowana — odsłaniamy wynagrodzenie' : 'np. Renegocjacja warunków'} />
      </label>
      {next && <label className="flex items-start gap-3 rounded-xl bg-white/[0.03] p-3 text-sm">
        <input type="checkbox" checked={notify} onChange={(event) => setNotify(event.target.checked)} className="mt-0.5" />
        <span><span className="block">Wyślij sprzedawcy powiadomienie w portalu</span><span className="mt-0.5 block text-xs text-white/45">Zalecane — sprzedawca dowie się, że może sprawdzić swoje wynagrodzenie.</span></span>
      </label>}
      {error && <p role="alert" className="rounded-xl bg-red-400/10 p-3 text-sm text-red-100">{error}</p>}
    </SellerDialog>
  </>;
}
