'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, ArrowLeft, ArrowRight, Check, CheckCircle2, Download, Link2, MessageSquare, Pencil, Send, X } from 'lucide-react';
import { deliveryTimestamp, type SellerDeliveryState, type SellerDocument } from '@/lib/seller/delivery';
import { sellerMoney, useSellerPortalContext } from '@/lib/seller/portal';
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

export type SellerClientAcceptance = { channel: string; note: string };

export function SellerOfferNextStep({ state, offerId, selected, busy, submitted, onConfirm, onPreparePdf, onDownload, guestAcceptance, priceBlocked }: {
  state: SellerDeliveryState; offerId: string; selected?: SellerDocument;
  busy: boolean; submitted: boolean;
  onConfirm: (correction?: { note: string; confirmed: boolean }, acceptance?: SellerClientAcceptance) => void; onPreparePdf: () => void;
  /** Pobiera aktualny PDF (generuje go, gdy brak) — wkładka do oferty hotelu. */
  onDownload: () => void;
  /** Cena czeka na zgodę opiekuna: PDF dla klienta i wysyłka do opiekuna są wstrzymane (zdanie wyjaśnienia). */
  priceBlocked?: string;
  /** Online acceptance through the guest link; the seller still confirms it explicitly. */
  guestAcceptance?: { at: string; name: string; email: string };
}) {
  const { context } = useSellerPortalContext();
  const manager = context?.manager?.name?.trim().split(/\s+/)[0] || 'Opiekun';
  const [clientConfirmed, setClientConfirmed] = useState(false);
  const [correctionNote, setCorrectionNote] = useState('');
  const [acceptanceOpen, setAcceptanceOpen] = useState(false);
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
  const canRequest = canEdit && !priceBlocked;
  const correctionReady = !feedback || (correctionNote.trim().length >= 5 && correctionNote.trim().length <= 2000);
  const disabled = busy || !clientConfirmed || !correctionReady || !state.seller_progress || !state.offer_summary?.event_date
    || !selected?.current || state.realization?.migration_ready !== true;
  const title = cancelled ? 'Wydarzenie anulowane'
    : confirmed ? 'Termin potwierdzony'
    : pending ? `${manager} sprawdza ofertę`
    : accepted || review?.status === 'approved' ? 'Oferta przyjęta — czeka na potwierdzenie terminu'
    : declined ? 'Oferta bez zgody opiekuna'
    : needsChange ? 'Oferta do poprawy'
    : canSubmitStatus ? (feedback ? 'Wyślij poprawki do opiekuna' : guestAcceptance ? 'Klient zaakceptował ofertę — wyślij ją do opiekuna' : 'Przekaż ofertę klientowi') : 'Ustal dalszy krok z opiekunem';

  return <section id="seller-offer-review" aria-labelledby="seller-next-step-title"
    className={`scroll-mt-6 space-y-4 rounded-xl p-4 sm:p-5 ${pending ? 'bg-sky-300/10' : needsChange ? (declined ? 'bg-rose-300/10' : 'bg-amber-200/10') : 'bg-[#d3bb73]/10'}`}>
    <div className="flex items-start gap-3">
      {needsChange && <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${declined ? 'bg-rose-300/15 text-rose-200' : 'bg-amber-200/15 text-amber-200'}`}><AlertTriangle aria-hidden="true" className="h-5 w-5"/></div>}
      <div className="min-w-0">
        <p className={`text-xs font-semibold uppercase tracking-wide ${needsChange ? (declined ? 'text-rose-200' : 'text-amber-200') : 'text-[#d3bb73]'}`}>
          {needsChange ? 'Wymaga Twojej reakcji' : `Teraz działa: ${pending || accepted || review?.status === 'approved' ? manager : 'Ty'}`}
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
        ? declined ? 'Opiekun nie przyjął tej wersji. Po poprawkach lub wyjaśnieniu uwag opisz odpowiedź poniżej i wyślij ofertę ponownie.'
          : 'Popraw wskazane dane i zapisz ofertę. Poniżej opisz, co zmieniono, i wyślij poprawki do opiekuna.'
        : 'Zmiany są zapisane, ale opiekun jeszcze ich nie dostał. Odpowiedz na uwagi poniżej i wyślij aktualny PDF.'}</p>
    </> : <>
      {pending ? <p role="status" className="text-sm leading-6 text-white/70">{currentAcceptance || submitted
        ? `Oferta jest u opiekuna razem ze zgodą klienta. ${manager} sprawdzi termin, zespół i sprzęt. Teraz nic nie musisz robić.`
        : 'Oferta jest u opiekuna, ale bez zapisanej zgody klienta. Wyjaśnij to w rozmowie; nie wysyłaj drugi raz.'}</p>
        : confirmed ? <p className="text-sm leading-6 text-white/70">Termin jest potwierdzony. Przygotowanie znajdziesz w „Wydarzeniach”.</p>
        : accepted || review?.status === 'approved' ? <p className="text-sm leading-6 text-white/70">Oferta przyjęta. {manager} osobno potwierdzi termin wydarzenia — dostaniesz powiadomienie.</p>
        : cancelled ? <p className="text-sm text-white/65">Historia i dokumenty pozostają dostępne. Dalsze działania omów z opiekunem.</p>
        : <p className="text-sm leading-6 text-white/70">Pobierz PDF i dołącz go do swojej oferty dla klienta. Gdy klient się zgodzi, zaznacz to poniżej i wyślij ofertę do opiekuna. Montaż, materiały i kontakty ustalicie po potwierdzeniu terminu.</p>}
      {!pending && review?.response_note && <div className="rounded-lg bg-black/15 p-3 text-sm"><p className="text-xs text-[#d3bb73]">Wiadomość od opiekuna</p><p className="mt-2 whitespace-pre-wrap break-words">{review.response_note}</p></div>}
    </>}
    {pending && review?.request_note && <details className="rounded-lg bg-black/10 p-3 text-sm">
      <summary className="cursor-pointer text-[#d3bb73]">Wysłana wiadomość i zakres</summary>
      <p className="mt-3 whitespace-pre-wrap break-words text-xs leading-6 text-white/65">{review.request_note}</p>
    </details>}
    {currentAcceptance && !needsChange && <p className="text-xs text-white/55"><Check className="mr-1 inline h-3.5 w-3.5"/>Zapisano potwierdzenie klienta: {deliveryTimestamp(currentAcceptance.confirmed_at)}.</p>}
    {state.review && !review && !feedback && <p className="text-xs text-amber-200">Poprzednia decyzja dotyczy innej wersji. Pokaż zmiany klientowi i wyślij aktualny PDF do opiekuna.</p>}
    {state.seller_progress_error && <p role="alert" className="text-sm text-amber-200">{state.seller_progress_error}</p>}
    <div className="flex flex-wrap items-center gap-2">
      {needsChange ? <>
        {canEdit && <Link href={`/seller/offers/new?offer=${offerId}`} className={button}><Pencil aria-hidden="true" className="h-4 w-4"/>Popraw ofertę</Link>}
        <a href="#seller-offer-conversation" className={button}><MessageSquare aria-hidden="true" className="h-4 w-4"/>Omów uwagi z opiekunem</a>
        <a href="#seller-offer-documents" className="inline-flex min-h-11 items-center px-3 py-2 text-xs text-white/65 underline underline-offset-4 hover:text-white">Dokumenty PDF ↓</a>
      </> : <>
        {canEdit ? <button type="button" disabled={busy || Boolean(priceBlocked)} title={priceBlocked || undefined} onClick={onDownload} className="inline-flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2.5 text-sm font-medium text-[#1b0710] disabled:cursor-not-allowed disabled:opacity-40"><Download aria-hidden="true" className="h-4 w-4"/>{selected?.current || state.documents.some(document => document.current) ? 'Pobierz PDF' : 'Przygotuj i pobierz PDF'}</button>
          : <a href="#seller-offer-documents" className={button}>PDF dla klienta</a>}
        <a href="#seller-offer-conversation" className={button}><MessageSquare aria-hidden="true" className="h-4 w-4"/>Napisz do opiekuna</a>
        {canEdit && <Link href={`/seller/offers/new?offer=${offerId}`} className={button}>Popraw ofertę</Link>}
      </>}
    </div>
    {canEdit && priceBlocked && <p className="rounded-lg bg-sky-300/10 p-3 text-xs leading-5 text-sky-100">{priceBlocked}</p>}
    {canRequest && guestAcceptance && <div role="status" className="flex items-start gap-3 rounded-lg bg-emerald-300/15 p-4 text-sm text-emerald-50">
      <CheckCircle2 aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-emerald-200"/>
      <div className="min-w-0"><p className="font-medium">Zaakceptowana online przez {guestAcceptance.name || 'klienta'} · {deliveryTimestamp(guestAcceptance.at)}</p>
        <p className="mt-1 text-xs leading-5 text-emerald-50/80">{guestAcceptance.email ? `${guestAcceptance.email}. ` : ''}Oferta nie trafiła do opiekuna sama — zwykle dlatego, że PDF zmienił się po akceptacji. Sprawdź aktualny PDF i wyślij ofertę do opiekuna.</p></div>
    </div>}
    {canRequest && <div id="seller-review-resubmission" className="scroll-mt-6 space-y-3 rounded-lg bg-black/10 p-3">
      {feedback && <>
        <h3 className="text-sm uppercase">Poprawki gotowe — wyślij do opiekuna</h3>
        <label htmlFor="seller-correction-note" className="block text-sm">Odpowiedź na uwagi opiekuna
          <textarea id="seller-correction-note" rows={3} minLength={5} maxLength={2000} value={correctionNote} disabled={busy}
            onChange={event => setCorrectionNote(event.target.value)} aria-describedby="seller-correction-note-help"
            placeholder="Np. poprawiłem datę wydarzenia na 23.12.2026. Pozostały zakres pozostaje bez zmian."
            className="mt-2 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-[#e5e4e2] outline-none focus:border-[#d3bb73]/30"/>
        </label>
        <p id="seller-correction-note-help" className="text-xs text-white/55">Wymagane 5–2000 znaków. Odpowiedź trafi do opiekuna razem z ofertą; nie pojawi się w PDF dla klienta.</p>
        {!selected?.current && <button type="button" disabled={busy} onClick={onPreparePdf} className={button}>
          {state.documents.some(document => document.current) ? 'Wybierz aktualny PDF' : 'Zaktualizuj PDF'}
        </button>}
        {selected?.current && <p className="break-words text-xs text-white/60">Wysyłany PDF: {selected.filename}</p>}
        {selected?.current && selected.id === feedback.document_id && <p className="text-xs leading-5 text-white/55">To ten sam PDF co wcześniej. Jeśli zmieniono treść oferty, najpierw zapisz zmiany i zaktualizuj PDF. Samo wyjaśnienie uwag nie wymaga nowego PDF.</p>}
      </>}
      {feedback ? <>
        <label className="flex items-start gap-2 text-sm leading-6">
          <input type="checkbox" checked={clientConfirmed} disabled={busy || !selected?.current} onChange={event => setClientConfirmed(event.target.checked)} className="mt-1.5"/>
          Potwierdzam, że uwagi zostały uwzględnione lub wyjaśnione, a klient zaakceptował wybraną aktualną wersję PDF.
        </label>
        <button type="button" disabled={disabled} onClick={() => onConfirm({ note: correctionNote.trim(), confirmed: clientConfirmed })} className="inline-flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-3 text-sm font-medium text-[#1b0710] disabled:cursor-not-allowed disabled:opacity-40">
          <Send aria-hidden="true" className="h-4 w-4 shrink-0"/>Wyślij poprawki do opiekuna
        </button>
      </> : <>
        <h3 className="text-sm uppercase">Klient zaakceptował ofertę?</h3>
        <p className="text-xs leading-5 text-white/60">Mailem, telefonicznie albo osobiście — trzy krótkie kroki i oferta trafi do opiekuna. Akceptacja przez link dla klienta trafia do opiekuna sama.</p>
        <button type="button" disabled={busy || !state.seller_progress || !state.offer_summary?.event_date || state.realization?.migration_ready !== true}
          onClick={() => setAcceptanceOpen(true)} className="inline-flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-3 text-sm font-medium text-[#1b0710] disabled:cursor-not-allowed disabled:opacity-40">
          <Send aria-hidden="true" className="h-4 w-4 shrink-0"/>Klient zaakceptował — wyślij do opiekuna
        </button>
      </>}
      {feedback && !selected?.current && <p className="text-xs text-amber-200">Najpierw zaktualizuj PDF i pokaż go klientowi — do opiekuna wysyłasz aktualną wersję.</p>}
      {!state.offer_summary?.event_date && <p className="text-xs text-amber-200">{state.offer_summary ? 'Uzupełnij termin w edycji oferty i zaktualizuj PDF.' : 'Najpierw odśwież dane oferty.'}</p>}
      {state.realization?.migration_ready !== true && <p className="text-xs text-amber-200">Wysyłka do opiekuna jest chwilowo niedostępna. PDF i rozmowa działają — napisz do opiekuna.</p>}
      <p className="text-xs leading-5 text-white/55">{feedback ? 'Opiekun dostanie poprawki dopiero po kliknięciu „Wyślij poprawki do opiekuna”. Sam zapis zmian ani wiadomość na czacie nie wystarczą.' : 'Wysyłasz ofertę razem z informacją o zgodzie klienta. To jeszcze nie rezerwuje terminu ani sprzętu. Wiadomość na czacie nie zastępuje wysłania.'}</p>
    </div>}
    {acceptanceOpen && <SellerClientAcceptanceDialog selected={selected} busy={busy} manager={manager} onPreparePdf={onPreparePdf}
      onClose={() => setAcceptanceOpen(false)}
      onSend={(acceptance) => { setAcceptanceOpen(false); onConfirm(undefined, acceptance); }} />}
  </section>;
}

const ACCEPTANCE_CHANNELS = [
  { value: 'email', label: 'E-mailem' },
  { value: 'phone', label: 'Telefonicznie' },
  { value: 'meeting', label: 'Osobiście, na spotkaniu' },
  { value: 'signed', label: 'Podpisał ofertę hotelu' },
  { value: 'other', label: 'Inaczej' },
] as const;
export const sellerAcceptanceChannelLabel = (value: string) => ACCEPTANCE_CHANNELS.find(item => item.value === value)?.label || 'Inaczej';

/** „Klient zaakceptował poza portalem”: jak → która wersja PDF → uwagi dla opiekuna. */
function SellerClientAcceptanceDialog({ selected, busy, manager, onPreparePdf, onClose, onSend }: {
  selected?: SellerDocument; busy: boolean; manager: string;
  onPreparePdf: () => void; onClose: () => void; onSend: (acceptance: SellerClientAcceptance) => void;
}) {
  const [step, setStep] = useState(0);
  const [channel, setChannel] = useState('');
  const [note, setNote] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    window.requestAnimationFrame(() => dialogRef.current?.querySelector<HTMLElement>('input, button, textarea')?.focus());
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  // Inna wersja PDF = nowa zgoda klienta.
  useEffect(() => { setConfirmed(false); }, [selected?.id]);
  const steps = ['Jak klient zaakceptował?', 'Która wersja PDF?', 'Uwagi dla opiekuna'];
  const canNext = step === 0 ? Boolean(channel) : step === 1 ? Boolean(selected?.current) : confirmed;
  return <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 sm:items-center sm:p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="seller-acceptance-title" className="w-full max-w-lg space-y-4 rounded-t-2xl bg-[#1c1f33] p-5 text-[#e5e4e2] shadow-2xl sm:rounded-xl">
      <div className="flex items-start justify-between gap-3">
        <div><p className="text-xs text-white/45">Krok {step + 1} z 3</p><h2 id="seller-acceptance-title" className="mt-1 text-lg">{steps[step]}</h2></div>
        <button type="button" onClick={onClose} aria-label="Zamknij" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-white/55 hover:bg-white/5"><X className="h-5 w-5"/></button>
      </div>
      <ol className="grid grid-cols-3 gap-1.5" aria-hidden="true">{steps.map((label, index) => <li key={label} className={`h-1.5 rounded-full ${index < step ? 'bg-emerald-300/50' : index === step ? 'bg-[#d3bb73]' : 'bg-white/10'}`}/>)}</ol>
      {step === 0 && <fieldset className="space-y-2"><legend className="sr-only">Sposób akceptacji</legend>
        {ACCEPTANCE_CHANNELS.map(item => <label key={item.value} className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm ${channel === item.value ? 'bg-[#d3bb73]/15 text-[#d3bb73]' : 'bg-white/[0.04] hover:bg-white/[0.07]'}`}>
          <input type="radio" name="seller-acceptance-channel" value={item.value} checked={channel === item.value} onChange={() => setChannel(item.value)} className="accent-[#d3bb73]"/>{item.label}
        </label>)}
      </fieldset>}
      {step === 1 && <div className="space-y-3 text-sm">
        {selected?.current ? <p className="rounded-lg bg-white/[0.04] p-3">Aktualny PDF: <span className="break-words text-white/80">{selected.filename}</span><span className="mt-1 block text-xs text-white/50">{deliveryTimestamp(selected.created_at)} · tę wersję zobaczy opiekun</span></p>
          : <div className="space-y-2 rounded-lg bg-amber-300/10 p-3 text-amber-100"><p>Do opiekuna wysyłasz aktualną wersję PDF. Oferta zmieniła się po wygenerowaniu PDF albo wybrano starszą wersję.</p>
            <button type="button" disabled={busy} onClick={onPreparePdf} className={button}>Zaktualizuj PDF</button>
            <p className="text-xs">Jeśli klient zaakceptował starszą wersję, pokaż mu zmiany przed wysłaniem.</p></div>}
      </div>}
      {step === 2 && <div className="space-y-3">
        <label className="block text-xs text-white/55">Uwagi dla opiekuna (opcjonalnie)
          <textarea rows={3} maxLength={1000} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Np. klient prosi o rozpoczęcie o 17:00 zamiast 16:00."
            className="mt-1.5 w-full rounded-lg border border-white/[0.06] bg-black/20 px-3 py-2 text-sm outline-none focus:border-[#d3bb73]/30"/>
        </label>
        <label className="flex items-start gap-2 text-sm leading-6">
          <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} className="mt-1.5"/>
          Potwierdzam, że klient zaakceptował tę wersję ({sellerAcceptanceChannelLabel(channel).toLocaleLowerCase('pl-PL')}).
        </label>
        <p className="text-xs text-white/50">Oferta trafi do: {manager}. Opiekun sprawdzi termin, zespół i sprzęt — dostaniesz powiadomienie o decyzji.</p>
      </div>}
      <div className="flex items-center justify-between gap-2">
        <button type="button" onClick={() => step === 0 ? onClose() : setStep(step - 1)} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-white/5 px-4 text-sm"><ArrowLeft className="h-4 w-4"/>{step === 0 ? 'Anuluj' : 'Wstecz'}</button>
        {step < 2 ? <button type="button" disabled={!canNext} onClick={() => setStep(step + 1)} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-[#d3bb73] px-4 text-sm font-medium text-[#1b0710] disabled:opacity-40">Dalej<ArrowRight className="h-4 w-4"/></button>
          : <button type="button" disabled={!canNext || busy || !selected?.current} onClick={() => onSend({ channel, note: note.trim() })} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-[#d3bb73] px-4 text-sm font-medium text-[#1b0710] disabled:opacity-40"><Send className="h-4 w-4"/>Wyślij do opiekuna</button>}
      </div>
    </div>
  </div>;
}

/** Po zapisie w kreatorze (?gotowe=1): co zrobić z ofertą teraz. */
export function SellerOfferReady({ managerName, priceStage, busy, onDownload, onClose }: {
  managerName?: string | null;
  priceStage: 'pending' | 'changes_requested' | 'missing' | null;
  busy: boolean;
  onDownload: () => void;
  onClose: () => void;
}) {
  const manager = (managerName || '').trim().split(/\s+/)[0] || 'opiekuna';
  return <section aria-labelledby="seller-offer-ready-title" className="relative space-y-4 rounded-xl bg-gradient-to-br from-[#d3bb73]/20 to-[#d3bb73]/5 p-4 pr-12 sm:p-5 sm:pr-14">
    <button type="button" onClick={onClose} aria-label="Zamknij podpowiedź" className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-lg text-white/55 hover:bg-white/5"><X className="h-4 w-4"/></button>
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-[#d3bb73]">Gotowe — co dalej?</p>
      <h2 id="seller-offer-ready-title" className="mt-1 text-lg uppercase">{priceStage ? 'Oferta zapisana — czeka na zgodę na cenę' : 'Oferta zapisana, PDF gotowy'}</h2>
    </div>
    {priceStage === 'pending' ? <p className="text-sm leading-6 text-white/75">Wysłaliśmy prośbę o zgodę na cenę do: {manager}. PDF dla klienta pobierzesz po zgodzie — dostaniesz powiadomienie. Podgląd PDF jest niżej.</p>
      : priceStage ? <p className="text-sm leading-6 text-white/75">Oferta ma pozycję własną albo cenę poniżej stawki. Poproś opiekuna o zgodę w sekcji „Cena wymaga zgody opiekuna”.</p>
      : <>
        <div className="grid gap-3 sm:grid-cols-2">
          <button type="button" disabled={busy} onClick={onDownload} className="flex items-start gap-3 rounded-xl bg-[#d3bb73] p-4 text-left text-[#1b0710] disabled:opacity-40">
            <Download className="mt-0.5 h-5 w-5 shrink-0"/><span><span className="block font-medium">Pobierz PDF</span><span className="mt-1 block text-xs leading-5 opacity-80">Dołącz go jako wkładkę do swojej oferty dla klienta.</span></span>
          </button>
          <a href="#seller-guest-link" className="flex items-start gap-3 rounded-xl bg-white/[0.06] p-4 hover:bg-white/[0.09]">
            <Link2 className="mt-0.5 h-5 w-5 shrink-0 text-[#d3bb73]"/><span><span className="block font-medium">Link dla klienta</span><span className="mt-1 block text-xs leading-5 text-white/60">Opcjonalnie: klient obejrzy ofertę na telefonie i zaakceptuje ją online.</span></span>
          </a>
        </div>
        <ol className="list-decimal space-y-1 pl-5 text-xs leading-5 text-white/65">
          <li>Wyślij PDF klientowi ze swojej skrzynki, razem z ofertą hotelu.</li>
          <li>Gdy klient się zgodzi, kliknij na tej stronie „Klient zaakceptował — wyślij do opiekuna”.</li>
          <li>Akceptacja przez link trafi do opiekuna sama.</li>
        </ol>
      </>}
  </section>;
}
