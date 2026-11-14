'use client';

import { useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, CheckCircle2, Hourglass, Loader2, Pencil, Send } from 'lucide-react';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { sellerMoney } from '@/lib/seller/portal';
import { deliveryTimestamp } from '@/lib/seller/delivery';
import { HelpTip } from '@/components/help/HelpDrawer';
import {
  decideSellerPriceApproval, requestSellerPriceApproval, sellerPriceApprovalError,
  type SellerPriceApproval, type SellerPriceItem,
} from '@/lib/seller/priceApproval';

const button = 'inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-[#d3bb73]/10 px-3 py-2 text-sm text-[#d3bb73] hover:bg-[#d3bb73]/20 disabled:cursor-not-allowed disabled:opacity-40';
const primary = 'inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#1b0710] disabled:cursor-not-allowed disabled:opacity-40';
const field = 'mt-1.5 w-full rounded-lg border border-white/[0.06] bg-black/20 px-3 py-2 text-sm text-[#e5e4e2] outline-none focus:border-[#d3bb73]/30';

function PriceItems({ items, showBase }: { items: SellerPriceItem[]; showBase: boolean }) {
  if (!items.length) return null;
  return <div className="overflow-x-auto rounded-lg bg-black/15">
    <table className="w-full min-w-[28rem] text-left text-xs">
      <thead className="text-white/45"><tr>
        <th className="px-3 py-2 font-normal">Pozycja</th>
        <th className="px-3 py-2 font-normal">Ilość</th>
        {showBase && <th className="px-3 py-2 text-right font-normal">Cennik MAVINCI</th>}
        <th className="px-3 py-2 text-right font-normal">Cena dla klienta</th>
        {showBase && <th className="px-3 py-2 text-right font-normal">Różnica / szt.</th>}
      </tr></thead>
      <tbody className="divide-y divide-white/5">{items.map((item, index) => {
        const difference = item.base_price == null ? null : item.client_price - item.base_price;
        return <tr key={`${item.name}-${index}`}>
          <td className="px-3 py-2 text-[#e5e4e2]">{item.name}<span className="block text-[11px] text-white/45">{item.custom ? 'pozycja własna hotelu' : 'cena poniżej stawki'}</span></td>
          <td className="px-3 py-2 text-white/65">{item.quantity} {item.unit}{item.days > 1 ? ` × ${item.days} dni` : ''}</td>
          {showBase && <td className="px-3 py-2 text-right text-white/65">{item.base_price == null ? '—' : sellerMoney(item.base_price)}</td>}
          <td className="px-3 py-2 text-right text-[#e5e4e2]">{sellerMoney(item.client_price)}</td>
          {showBase && <td className={`px-3 py-2 text-right ${difference != null && difference < 0 ? 'text-amber-200' : 'text-white/55'}`}>{difference == null ? 'bez cennika' : sellerMoney(difference)}</td>}
        </tr>;
      })}</tbody>
    </table>
  </div>;
}

/**
 * Portal: zgoda na cenę przed pokazaniem oferty klientowi. Widoczna, gdy oferta ma pozycję własną albo cenę poniżej stawki.
 * Do zgody PDF dla klienta i link są wstrzymane; prośba wysyła się sama po zapisie w kreatorze.
 */
export function SellerPriceApprovalPanel({ offerId, approval, managerName, canEdit, onChanged }: {
  offerId: string;
  approval: SellerPriceApproval;
  managerName?: string | null;
  canEdit: boolean;
  onChanged: () => void;
}) {
  const { showSnackbar } = useSnackbar();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const manager = (managerName || '').trim().split(/\s+/)[0] || 'Opiekun';
  const request = approval.request;
  const required = approval.status === 'required';
  if (!required) {
    if (approval.status !== 'approved' || !request || request.status !== 'approved') return null;
    return <p className="flex items-center gap-2 rounded-lg bg-emerald-300/10 px-3 py-2 text-xs text-emerald-100">
      <CheckCircle2 className="h-4 w-4 shrink-0" />Ceny zatwierdzone{request.decided_by_name ? ` przez: ${request.decided_by_name}` : ''}{request.decided_at ? ` · ${deliveryTimestamp(request.decided_at)}` : ''}.
    </p>;
  }
  const pending = request?.status === 'pending';
  const changes = request?.status === 'changes_requested';
  const send = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await requestSellerPriceApproval(offerId, note.trim());
      showSnackbar(result.created === false && result.request_status === 'pending' ? 'Prośba o te ceny już czeka u opiekuna.' : `Prośba o zgodę wysłana — ${manager} dostaje powiadomienie.`, 'success');
      setNote('');
      onChanged();
    } catch (cause) {
      showSnackbar(sellerPriceApprovalError(cause, 'Nie udało się wysłać prośby o zgodę.'), 'error', 8000);
    } finally { setBusy(false); }
  };
  return <section id="seller-price-approval" aria-labelledby="seller-price-approval-title"
    className={`scroll-mt-6 space-y-3 rounded-xl p-4 sm:p-5 ${changes ? 'bg-amber-200/10' : pending ? 'bg-sky-300/10' : 'bg-[#d3bb73]/10'}`}>
    <div className="flex items-start gap-3">
      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${changes ? 'bg-amber-200/15 text-amber-200' : pending ? 'bg-sky-300/15 text-sky-200' : 'bg-[#d3bb73]/15 text-[#d3bb73]'}`}>
        {changes ? <AlertTriangle className="h-5 w-5" /> : pending ? <Hourglass className="h-5 w-5" /> : <Send className="h-5 w-5" />}
      </span>
      <div className="min-w-0">
        <h2 id="seller-price-approval-title" className="flex items-center gap-1 text-base uppercase">
          {changes ? 'Opiekun prosi o zmianę ceny' : pending ? `${manager} sprawdza ceny` : 'Cena wymaga zgody opiekuna'}
          <HelpTip audience="seller" tip="approval" label="zgoda na cenę" />
        </h2>
        <p className="mt-1 text-sm leading-6 text-white/70">
          {changes ? 'Popraw wskazaną cenę lub pozycję w ofercie. Po zapisie prośba o zgodę wyśle się sama.'
            : pending ? `Prośba wysłana ${request?.requested_at ? deliveryTimestamp(request.requested_at) : ''}. PDF dla klienta i link odblokują się po zgodzie — dostaniesz powiadomienie.`
            : 'Oferta ma pozycję własną albo cenę poniżej Twojej stawki. Poproś opiekuna o zgodę — potem pobierzesz PDF dla klienta.'}
        </p>
      </div>
    </div>
    {changes && request?.response_note && <blockquote className="m-0 rounded-lg bg-[#fff4d6] p-3 text-sm font-medium text-[#331321]">{request.response_note}</blockquote>}
    <details className="rounded-lg bg-black/10 p-3" open={!pending}>
      <summary className="cursor-pointer text-xs text-[#d3bb73]">Pozycje do zgody ({approval.items.length})</summary>
      <div className="mt-3"><PriceItems items={approval.items} showBase /></div>
    </details>
    {pending && request?.note && <p className="text-xs text-white/55">Twoja wiadomość: „{request.note}”</p>}
    {!pending && <div className="space-y-2">
      <label className="block text-xs text-white/55">Wiadomość do opiekuna (opcjonalnie)
        <textarea rows={2} maxLength={1000} value={note} onChange={(event) => setNote(event.target.value)} disabled={busy}
          placeholder="Np. klient prosi o dekorację w bieli, cena uzgodniona z nim telefonicznie." className={field} />
      </label>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => void send()} disabled={busy} className={primary}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}{changes ? 'Wyślij prośbę ponownie' : 'Poproś o zgodę'}</button>
        {canEdit && <Link href={`/seller/offers/new?offer=${offerId}`} className={button}><Pencil className="h-4 w-4" />Popraw ofertę</Link>}
      </div>
    </div>}
  </section>;
}

/** CRM: decyzja opiekuna o cenie — zgoda dla widocznych cen albo prośba o zmianę z uzasadnieniem. */
export function CrmPriceApprovalReview({ offerId, approval, onChanged }: {
  offerId: string;
  approval: SellerPriceApproval;
  onChanged: () => void;
}) {
  const { showSnackbar } = useSnackbar();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<'' | 'approved' | 'changes_requested'>('');
  const [noteError, setNoteError] = useState('');
  const request = approval.request;
  if (approval.status !== 'required') {
    if (!request || request.status !== 'approved' || approval.status !== 'approved') return null;
    return <p id="seller-price-approval" className="flex scroll-mt-6 items-center gap-2 rounded-lg bg-emerald-300/10 px-3 py-2 text-xs text-emerald-100">
      <CheckCircle2 className="h-4 w-4 shrink-0" />Ceny zatwierdzone{request.decided_by_name ? `: ${request.decided_by_name}` : ''}{request.decided_at ? ` · ${deliveryTimestamp(request.decided_at)}` : ''}.
    </p>;
  }
  const decide = async (decision: 'approved' | 'changes_requested') => {
    if (busy) return;
    if (decision === 'changes_requested' && note.trim().length < 3) { setNoteError('Napisz sprzedawcy, którą cenę lub pozycję trzeba zmienić.'); return; }
    setBusy(decision);
    try {
      await decideSellerPriceApproval(offerId, decision, note.trim(), approval.price_key);
      showSnackbar(decision === 'approved' ? 'Ceny zatwierdzone. Hotel może pobrać PDF i wysłać link klientowi.' : 'Prośba o zmianę ceny wysłana do sprzedawcy.', 'success');
      setNote(''); setNoteError('');
      onChanged();
    } catch (cause) {
      showSnackbar(sellerPriceApprovalError(cause, 'Nie udało się zapisać decyzji.'), 'error', 8000);
      onChanged();
    } finally { setBusy(''); }
  };
  const pending = request?.status === 'pending';
  return <section id="seller-price-approval" aria-labelledby="crm-price-approval-title" className="scroll-mt-6 space-y-3 rounded-lg bg-amber-300/10 p-4">
    <div>
      <h3 id="crm-price-approval-title" className="flex items-center gap-1 text-sm uppercase text-amber-100">Zgoda na cenę <HelpTip audience="manager" tip="approval" label="zgoda na cenę" /></h3>
      <p className="mt-1 text-xs leading-5 text-white/65">
        {pending ? `Sprzedawca prosi o zgodę${request?.requested_at ? ` (${deliveryTimestamp(request.requested_at)})` : ''}. Do zgody nie pobierze PDF dla klienta ani nie wyśle linku.`
          : request?.status === 'changes_requested' ? 'Poprosiłeś o zmianę ceny. Gdy sprzedawca zapisze poprawki, prośba wróci tutaj.'
          : 'Oferta ma pozycję własną albo cenę poniżej stawki. Sprzedawca jeszcze nie wysłał prośby — możesz zdecydować od razu.'}
      </p>
    </div>
    {request?.note && pending && <p className="rounded-lg bg-black/15 p-3 text-sm">„{request.note}”</p>}
    <PriceItems items={approval.items} showBase />
    {approval.can_decide ? <>
      <label className="block text-xs text-white/60">Wiadomość do sprzedawcy <span className="text-white/40">(wymagana przy prośbie o zmianę)</span>
        <textarea rows={2} maxLength={2000} value={note} disabled={Boolean(busy)} onChange={(event) => { setNote(event.target.value); setNoteError(''); }}
          aria-invalid={Boolean(noteError)} placeholder="Np. dekoracja sali minimum 1450 zł netto." className={field} />
      </label>
      {noteError && <p role="alert" className="text-xs text-rose-200">{noteError}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={Boolean(busy)} onClick={() => void decide('approved')} className={primary}>{busy === 'approved' ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}Zatwierdź ceny</button>
        <button type="button" disabled={Boolean(busy)} onClick={() => void decide('changes_requested')} className={button}>{busy === 'changes_requested' && <Loader2 className="h-4 w-4 animate-spin" />}Poproś o zmianę ceny</button>
      </div>
      <p className="text-[11px] text-white/45">Zgoda dotyczy tych pozycji i cen. Gdy sprzedawca je zmieni, potrzebna będzie nowa zgoda; zmiana tytułu czy terminu jej nie kasuje.</p>
    </> : <p className="text-xs text-white/55">Decyzję podejmuje opiekun sprzedawcy z uprawnieniami do ofert tej marki.</p>}
  </section>;
}
