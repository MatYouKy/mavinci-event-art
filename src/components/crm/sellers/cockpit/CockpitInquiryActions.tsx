'use client';

import { useState } from 'react';
import { ArrowRightLeft, Loader2, MessageSquareReply } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useDialog } from '@/contexts/DialogContext';
import { SELLER_INQUIRY_STATUS_LABELS, type SellerCockpitInquiry, type SellerInquiryStatus } from '@/lib/seller/sellerCockpit';
import { SellerDialog, errorText, sellerFieldClass, sellerPrimaryButton, sellerSecondaryButton } from '../sellerUi';

const RESPONSE_STATUSES: SellerInquiryStatus[] = ['in_progress', 'answered', 'closed'];

/** Odpowiedź na zapytanie gościa (respond_seller_inquiry) i przekazanie do zapytań CRM (convert_seller_inquiry). */
export default function CockpitInquiryActions({ inquiry, onChanged, onConverted }: {
  inquiry: SellerCockpitInquiry;
  onChanged: () => void;
  onConverted: (inquiryId: string, guestName: string) => void;
}) {
  const { showSnackbar } = useSnackbar();
  const { showConfirm } = useDialog();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<SellerInquiryStatus>('answered');
  const [response, setResponse] = useState('');
  const [busy, setBusy] = useState<'respond' | 'convert' | null>(null);
  const [error, setError] = useState('');

  const respond = async () => {
    if (busy) return;
    if (status === 'answered' && !response.trim()) { setError('Wpisz odpowiedź, aby oznaczyć zapytanie jako odpowiedziane.'); return; }
    setBusy('respond');
    setError('');
    const { error: rpcError } = await supabase.rpc('respond_seller_inquiry', {
      p_inquiry: inquiry.id, p_status: status, p_response: response.trim() || null,
    });
    setBusy(null);
    if (rpcError) {
      const message = errorText(rpcError, 'Nie udało się zapisać odpowiedzi.');
      setError(message);
      showSnackbar(message, 'error');
      return;
    }
    setOpen(false);
    setResponse('');
    showSnackbar(response.trim() ? 'Odpowiedź wysłana — sprzedawca dostał powiadomienie.' : `Status zapytania: ${SELLER_INQUIRY_STATUS_LABELS[status].toLocaleLowerCase('pl-PL')}.`, 'success');
    onChanged();
  };

  const convert = async () => {
    if (busy) return;
    const confirmed = await showConfirm({
      title: 'Przekazać do zapytań CRM?',
      message: `Powstanie zapytanie CRM z danymi gościa ${inquiry.guest_name}, przypisane do opiekuna sprzedawcy. Sprzedawca zobaczy status „${SELLER_INQUIRY_STATUS_LABELS.converted}”.`,
      confirmText: 'Utwórz zapytanie',
      cancelText: 'Wróć',
    });
    if (!confirmed) return;
    setBusy('convert');
    const { data, error: rpcError } = await supabase.rpc('convert_seller_inquiry', { p_inquiry: inquiry.id });
    setBusy(null);
    if (rpcError) { showSnackbar(errorText(rpcError, 'Nie udało się utworzyć zapytania CRM.'), 'error'); return; }
    const createdId = typeof data === 'string' ? data : '';
    showSnackbar('Utworzono zapytanie w CRM.', 'success');
    if (createdId) onConverted(createdId, inquiry.guest_name);
    onChanged();
  };

  return <>
    <div className="flex flex-wrap gap-2">
      <button type="button" onClick={() => { setError(''); setOpen(true); }} disabled={Boolean(busy)} className="inline-flex items-center gap-1.5 rounded-lg bg-[#d3bb73]/10 px-3 py-1.5 text-xs text-[#d3bb73] hover:bg-[#d3bb73]/15 disabled:opacity-50">
        <MessageSquareReply className="h-3.5 w-3.5" />Odpowiedz
      </button>
      <button type="button" onClick={() => void convert()} disabled={Boolean(busy)} className="inline-flex items-center gap-1.5 rounded-lg bg-white/[0.05] px-3 py-1.5 text-xs text-white/70 hover:bg-white/[0.09] disabled:opacity-50">
        {busy === 'convert' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowRightLeft className="h-3.5 w-3.5" />}Przekaż do zapytań CRM
      </button>
    </div>
    <SellerDialog
      open={open}
      busy={busy === 'respond'}
      onClose={() => setOpen(false)}
      title={`Zapytanie: ${inquiry.guest_name}`}
      description={`Od sprzedawcy ${inquiry.seller_name}. Odpowiedź zobaczy sprzedawca w portalu i dostanie powiadomienie.`}
      footer={<>
        <button type="button" onClick={() => setOpen(false)} disabled={busy === 'respond'} className={sellerSecondaryButton}>Anuluj</button>
        <button type="button" onClick={() => void respond()} disabled={busy === 'respond'} className={sellerPrimaryButton}>
          {busy === 'respond' ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageSquareReply className="h-4 w-4" />}Zapisz
        </button>
      </>}
    >
      <label className="block text-xs text-white/55">Status
        <select value={status} onChange={(event) => { setStatus(event.target.value as SellerInquiryStatus); setError(''); }} className={`${sellerFieldClass} mt-1.5`}>
          {RESPONSE_STATUSES.map(value => <option key={value} value={value}>{SELLER_INQUIRY_STATUS_LABELS[value]}</option>)}
        </select>
      </label>
      <label className="block text-xs text-white/55">Odpowiedź dla sprzedawcy {status !== 'answered' && <span className="text-white/30">(opcjonalnie)</span>}
        <textarea value={response} onChange={(event) => { setResponse(event.target.value); setError(''); }} rows={5} maxLength={2000} className={`${sellerFieldClass} mt-1.5 resize-y`} placeholder="np. Termin jest wolny — przygotuję wstępną ofertę do jutra. Proszę potwierdzić liczbę gości." />
      </label>
      {error && <p role="alert" className="rounded-xl bg-red-400/10 p-3 text-sm text-red-100">{error}</p>}
    </SellerDialog>
  </>;
}
