'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, Check, MessageSquare, Pencil, Send } from 'lucide-react';
import { deliveryTimestamp, type SellerDeliveryState, type SellerDocument } from '@/lib/seller/delivery';
import { sellerMoney } from '@/lib/seller/portal';
import { SellerEventScheduleSummary } from './SellerEventSchedule';

const button = 'inline-flex items-center justify-center gap-2 rounded-lg bg-[#d3bb73]/10 px-3 py-2.5 text-sm text-[#d3bb73] hover:bg-[#d3bb73]/20 disabled:cursor-not-allowed disabled:opacity-40';

export function SellerOfferSummary({ state, id }: { state: SellerDeliveryState; id?: string }) {
  const summary = state.offer_summary;
  const arrangements = state.seller_arrangements;
  const date = summary?.event_date ? new Date(summary.event_date) : null;
  const dateLabel = date && Number.isFinite(date.getTime())
    ? date.toLocaleDateString('pl-PL', { timeZone: 'Europe/Warsaw' }) : 'Termin do ustalenia';
  return <section id={id} className="min-w-0 scroll-mt-6 space-y-4 rounded-xl bg-white/[0.035] p-4">
    <div><h2 className="text-base uppercase">Podsumowanie oferty</h2><p className="mt-1 text-xs text-white/45">{state.offer_number} · aktualnie zapisany zakres</p></div>
    {!summary ? <p role="alert" className="text-sm text-amber-200">{state.offer_summary_error || 'Nie udało się wczytać podsumowania. Odśwież status; PDF i rozmowa pozostają dostępne.'}</p> : <>
      <dl className="grid gap-4 text-sm sm:grid-cols-2">
        <div><dt className="text-xs text-white/45">Sprzedawca / organizacja</dt><dd className="mt-1 break-words">{summary.seller_name}{summary.seller_organization && <span className="mt-1 block text-white/60">{summary.seller_organization}</span>}</dd></div>
        <div><dt className="text-xs text-white/45">Oferta dla</dt><dd className="mt-1 break-words">{[summary.client_company, summary.client_name].filter(Boolean).join(' · ') || 'Klient do uzupełnienia'}</dd></div>
        <div><dt className="text-xs text-white/45">Termin wydarzenia</dt><dd className="mt-1">{dateLabel}</dd></div>
        <div><dt className="text-xs text-white/45">Miejsce</dt><dd className="mt-1 break-words">{summary.event_location || 'Miejsce do ustalenia'}{arrangements?.values.room && !summary.event_location.includes(arrangements.values.room) && <span className="mt-1 block text-white/60">{arrangements.values.room}</span>}</dd></div>
      </dl>
      <SellerEventScheduleSummary days={arrangements?.values.event_days} />
      <div>
        <h3 className="text-xs uppercase text-white/50">Co jest oferowane</h3>
        {summary.items.length ? <ul className="mt-2 divide-y divide-white/5">{summary.items.map(item => {
          const scope = state.seller_progress?.items.find(row => row.id === item.id)?.configuration_scope;
          return <li key={item.id} className="flex items-start justify-between gap-3 py-2.5 text-sm">
            <div className="min-w-0 break-words">{item.name}{scope && <details className="mt-1 text-xs text-white/55"><summary className="cursor-pointer text-[#d3bb73]">Konfiguracja</summary><p className="mt-2 whitespace-pre-wrap leading-5">{scope}</p></details>}</div>
            <span className="shrink-0 text-white/55">{item.quantity} {item.unit}{item.days > 1 ? ` × ${item.days} dni` : ''}</span>
          </li>;
        })}</ul> : <p className="mt-2 text-sm text-white/50">Brak zapisanych pozycji.</p>}
      </div>
      {arrangements?.offer.client_net != null && <p className="text-sm text-[#d3bb73]">Wartość oferty dla klienta: {sellerMoney(arrangements.offer.client_net)} netto</p>}
    </>}
    <p className="text-xs leading-5 text-white/45">To podsumowanie zapisanej oferty. Historyczne PDF-y zachowują własny zakres. Pytania i propozycje zmian omawiaj z opiekunem w tej samej rozmowie.</p>
  </section>;
}

export function SellerOfferNextStep({ state, offerId, selected, busy, submitted, onConfirm, onPreparePdf }: {
  state: SellerDeliveryState; offerId: string; selected?: SellerDocument;
  busy: boolean; submitted: boolean; onConfirm: (correction?: { note: string; confirmed: boolean }) => void; onPreparePdf: () => void;
}) {
  const [clientConfirmed, setClientConfirmed] = useState(false);
  const [correctionNote, setCorrectionNote] = useState('');
  // Keep the typed reply when generating/selecting a PDF, but never carry a
  // client's declared consent over to a different document or changed offer.
  useEffect(() => { setClientConfirmed(false); }, [selected?.id, state.source_key]);
  const review = state.review?.source_key === state.source_key ? state.review : undefined;
  const pending = review?.status === 'pending' || submitted;
  const accepted = state.realization?.offer_status === 'accepted';
  const confirmed = state.realization?.stage === 'confirmed';
  const cancelled = state.realization?.stage === 'cancelled';
  const currentAcceptance = state.seller_progress?.acceptances.find(item => item.source_key === state.source_key);
  const canSubmitStatus = ['draft', 'sent', 'viewed'].includes(state.realization?.offer_status || '');
  // Keep the caretaker's explanation after edits, but clearly distinguish an
  // old decision from a refusal of the current version. Never infer acceptance.
  const feedback = !pending && !accepted && !confirmed && !cancelled
    && ['changes_requested', 'rejected'].includes(state.review?.status || '') ? state.review : undefined;
  const needsChange = Boolean(feedback && review);
  const declined = needsChange && review?.status === 'rejected';
  const canEdit = canSubmitStatus && !pending && !accepted && !confirmed && !cancelled && review?.status !== 'approved';
  const canRequest = canEdit;
  const correctionReady = !feedback || (correctionNote.trim().length >= 5 && correctionNote.trim().length <= 2000);
  const disabled = busy || !clientConfirmed || !correctionReady || !state.seller_progress || !state.offer_summary?.event_date
    || !selected?.current || state.realization?.migration_ready !== true;
  const title = cancelled ? 'Realizacja anulowana'
    : confirmed ? 'Realizacja potwierdzona'
    : pending ? 'Oczekuje na weryfikację opiekuna'
    : accepted || review?.status === 'approved' ? 'Czekamy na potwierdzenie wydarzenia'
    : declined ? 'Oferta nie została zaakceptowana'
    : needsChange ? 'Oferta wymaga poprawy'
    : canSubmitStatus ? (feedback ? 'Przekaż poprawki do weryfikacji' : 'Przedstaw ofertę klientowi') : 'Uzgodnij dalszy krok z opiekunem';

  return <section id="seller-offer-review" aria-labelledby="seller-next-step-title"
    className={`scroll-mt-6 space-y-4 rounded-xl p-4 sm:p-5 ${pending ? 'bg-sky-300/10' : needsChange ? (declined ? 'bg-rose-300/10' : 'bg-amber-200/10') : 'bg-[#d3bb73]/10'}`}>
    <div className="flex items-start gap-3">
      {needsChange && <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${declined ? 'bg-rose-300/15 text-rose-200' : 'bg-amber-200/15 text-amber-200'}`}><AlertTriangle aria-hidden="true" className="h-5 w-5"/></div>}
      <div className="min-w-0">
        <p className={`text-xs font-semibold uppercase tracking-wide ${needsChange ? (declined ? 'text-rose-200' : 'text-amber-200') : 'text-[#d3bb73]'}`}>
          {needsChange ? 'Wymaga Twojej reakcji' : `Następny krok · ${pending || accepted || review?.status === 'approved' ? 'opiekun' : 'Ty'}`}
        </p>
        <h2 id="seller-next-step-title" className="mt-2 text-base uppercase sm:text-lg">{title}</h2>
      </div>
    </div>
    {feedback ? <>
      <div role={needsChange ? 'alert' : undefined} aria-atomic="true" className="rounded-xl bg-[#fff4d6] p-4 text-[#331321] sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-semibold uppercase tracking-wide">{needsChange ? (declined ? 'Dlaczego oferta nie została zaakceptowana' : 'Co trzeba poprawić — wiadomość opiekuna') : 'Uwagi opiekuna do poprzedniej wersji'}</p>
          {feedback.reviewed_at && <p className="text-xs text-[#331321]/65">{deliveryTimestamp(feedback.reviewed_at)}</p>}
        </div>
        <blockquote className="m-0 mt-3 whitespace-pre-wrap break-words text-base font-semibold leading-7 sm:text-lg">
          {feedback.response_note?.trim() || 'Opiekun nie podał uzasadnienia. Napisz do niego, aby ustalić, co wymaga zmiany.'}
        </blockquote>
      </div>
      <p className="text-sm leading-6 text-white/75">{needsChange
        ? declined ? 'Ta wersja nie ma akceptacji opiekuna. Po poprawkach lub wyjaśnieniu uwag opisz odpowiedź poniżej i przekaż ofertę do ponownej weryfikacji.'
          : 'Popraw wskazane dane i zapisz ofertę. Poniżej opisz, co zmieniono, wybierz aktualny PDF i przekaż poprawki do weryfikacji.'
        : 'Zmiany są zapisane, ale nie zostały jeszcze przekazane. Odpowiedz na uwagi poniżej i wyślij aktualny PDF do ponownej weryfikacji.'}</p>
    </> : <>
      {pending ? <p role="status" className="text-sm leading-6 text-white/70">{currentAcceptance || submitted
        ? 'Potwierdzenie klienta zostało przekazane wraz z ofertą. Opiekun sprawdzi termin i możliwości realizacji. Nie wysyłaj ponownie.'
        : 'Oferta została przekazana wcześniej. Nie zapisano przy niej osobnego potwierdzenia klienta. Wyjaśnij to z opiekunem w rozmowie; nie wysyłaj drugi raz.'}</p>
        : confirmed ? <p className="text-sm leading-6 text-white/70">Wydarzenie jest potwierdzone. Kolejne ustalenia i przygotowania znajdziesz w realizacji.</p>
        : accepted || review?.status === 'approved' ? <p className="text-sm leading-6 text-white/70">Oferta została przyjęta przez opiekuna. Ostateczne potwierdzenie wydarzenia pozostaje osobną decyzją — otrzymasz powiadomienie.</p>
        : cancelled ? <p className="text-sm text-white/65">Historia i dokumenty pozostają dostępne. Dalsze działania omów z opiekunem.</p>
        : <p className="text-sm leading-6 text-white/70">Pobierz PDF i przedstaw go klientowi. Gdy zaakceptuje tę wersję, przekaż ją do opiekuna. Montaż, demontaż, materiały i kontakty organizacyjne ustalicie dopiero podczas przygotowania potwierdzonej realizacji.</p>}
      {!pending && review?.response_note && <div className="rounded-lg bg-black/15 p-3 text-sm"><p className="text-xs text-[#d3bb73]">Wiadomość od opiekuna</p><p className="mt-2 whitespace-pre-wrap break-words">{review.response_note}</p></div>}
    </>}
    {pending && review?.request_note && <details className="rounded-lg bg-black/10 p-3 text-sm">
      <summary className="cursor-pointer text-[#d3bb73]">Przekazana wiadomość i zakres</summary>
      <p className="mt-3 whitespace-pre-wrap break-words text-xs leading-6 text-white/65">{review.request_note}</p>
    </details>}
    {currentAcceptance && !needsChange && <p className="text-xs text-white/55"><Check className="mr-1 inline h-3.5 w-3.5"/>Zapisano potwierdzenie klienta: {deliveryTimestamp(currentAcceptance.confirmed_at)}.</p>}
    {state.review && !review && !feedback && <p className="text-xs text-amber-200">Poprzednia decyzja dotyczy innej wersji. Zmiany przedstaw klientowi i przekaż aktualny PDF.</p>}
    {state.seller_progress_error && <p role="alert" className="text-sm text-amber-200">{state.seller_progress_error}</p>}
    <div className="flex flex-wrap items-center gap-2">
      {needsChange ? <>
        {canEdit && <Link href={`/seller/offers/new?offer=${offerId}`} className={button}><Pencil aria-hidden="true" className="h-4 w-4"/>Popraw ofertę</Link>}
        <a href="#seller-offer-conversation" className={button}><MessageSquare aria-hidden="true" className="h-4 w-4"/>Omów uwagi z opiekunem</a>
        <a href="#seller-offer-documents" className="inline-flex min-h-11 items-center px-3 py-2 text-xs text-white/65 underline underline-offset-4 hover:text-white">Dokumenty PDF ↓</a>
      </> : <>
        <a href="#seller-offer-documents" className={button}>PDF dla klienta</a>
        <a href="#seller-offer-conversation" className={button}><MessageSquare aria-hidden="true" className="h-4 w-4"/>Napisz do opiekuna</a>
        {canEdit && <Link href={`/seller/offers/new?offer=${offerId}`} className={button}>Popraw ofertę</Link>}
      </>}
    </div>
    {canRequest && <div id="seller-review-resubmission" className="scroll-mt-6 space-y-3 rounded-lg bg-black/10 p-3">
      {feedback && <>
        <h3 className="text-sm uppercase">Poprawki wykonane — przekaż do weryfikacji</h3>
        <label htmlFor="seller-correction-note" className="block text-sm">Odpowiedź na uwagi opiekuna
          <textarea id="seller-correction-note" rows={3} minLength={5} maxLength={2000} value={correctionNote} disabled={busy}
            onChange={event => setCorrectionNote(event.target.value)} aria-describedby="seller-correction-note-help"
            placeholder="Np. poprawiłem datę wydarzenia na 23.12.2026. Pozostały zakres pozostaje bez zmian."
            className="mt-2 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-[#e5e4e2] outline-none focus:border-[#d3bb73]/30"/>
        </label>
        <p id="seller-correction-note-help" className="text-xs text-white/55">Wymagane 5–2000 znaków. Ta odpowiedź trafi do opiekuna razem z ofertą; nie zostanie dodana do PDF dla klienta.</p>
        {!selected?.current && <button type="button" disabled={busy} onClick={onPreparePdf} className={button}>
          {state.documents.some(document => document.current) ? 'Wybierz aktualny PDF' : 'Wygeneruj aktualny PDF'}
        </button>}
        {selected?.current && <p className="break-words text-xs text-white/60">Przekazywany PDF: {selected.filename}</p>}
        {selected?.current && selected.id === feedback.document_id && <p className="text-xs leading-5 text-white/55">To ten sam PDF co wcześniej. Jeśli zmieniono treść oferty, najpierw zapisz zmiany i wygeneruj nową wersję. Samo wyjaśnienie uwag nie wymaga zmiany dokumentu.</p>}
      </>}
      <label className="flex items-start gap-2 text-sm leading-6">
        <input type="checkbox" checked={clientConfirmed} disabled={busy || !selected?.current} onChange={event => setClientConfirmed(event.target.checked)} className="mt-1.5"/>
        {feedback ? 'Potwierdzam, że uwagi zostały uwzględnione lub wyjaśnione, a klient zaakceptował wybraną aktualną wersję PDF.' : 'Potwierdzam, że klient zaakceptował wybraną aktualną wersję PDF.'}
      </label>
      <button type="button" disabled={disabled} onClick={() => onConfirm(feedback ? { note: correctionNote.trim(), confirmed: clientConfirmed } : undefined)} className="inline-flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-3 text-sm font-medium text-[#1b0710] disabled:cursor-not-allowed disabled:opacity-40">
        <Send aria-hidden="true" className="h-4 w-4 shrink-0"/>{feedback ? 'Przekaż poprawki do weryfikacji' : 'Przekaż akceptację opiekunowi'}
      </button>
      {!selected?.current && <p className="text-xs text-amber-200">W sekcji PDF wybierz aktualną wersję lub wygeneruj nową, a następnie przedstaw ją klientowi.</p>}
      {!state.offer_summary?.event_date && <p className="text-xs text-amber-200">{state.offer_summary ? 'Uzupełnij termin w edycji oferty i wygeneruj aktualny PDF.' : 'Najpierw odśwież dane oferty.'}</p>}
      {state.realization?.migration_ready !== true && <p className="text-xs text-amber-200">Obsługa akceptacji wymaga aktualizacji przez administratora. PDF i rozmowa pozostają dostępne.</p>}
      <p className="text-xs leading-5 text-white/55">{feedback ? 'Dopiero przekazanie odpowiedzi zmieni status na oczekiwanie na weryfikację i powiadomi opiekuna. Sam zapis poprawek ani wiadomość na czacie nie wystarczą. Decyzję o akceptacji podejmie opiekun.' : 'Ten przycisk zapisuje deklarację zgody klienta i wysyła ofertę do opiekuna. Nie potwierdza jeszcze realizacji ani rezerwacji sprzętu. Wiadomość na czacie nie zastępuje tej decyzji.'}</p>
    </div>}
  </section>;
}
