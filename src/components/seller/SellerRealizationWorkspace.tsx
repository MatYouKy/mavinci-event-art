'use client';

import { systemLabel } from '@/lib/ui/systemLabels';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, CalendarDays, Check, Clock3, FileText, Loader2, Mail, MapPin, MessageSquare, Phone, RefreshCw, Send } from 'lucide-react';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { arrangementLocalDate, arrangementSchedule, type ArrangementContact } from '@/lib/seller/arrangements';
import { deliveryStage, deliverySteps, deliveryTimestamp, preparationTasks, type PreparationTask, type SellerDeliveryState } from '@/lib/seller/delivery';
import { readSellerNotice, useSellerInbox } from '@/lib/seller/inbox';
import { sellerOfferRequest } from '@/lib/seller/offerRequest.browser';
import { sellerMoney } from '@/lib/seller/portal';
import { useOfferRefresh } from '@/lib/seller/useOfferRefresh';
import SellerOfferConversation from './SellerOfferConversation';
import SellerRealizationDocuments from './SellerRealizationDocuments';
import { TechnicalDetailsView } from '@/components/crm/locations/LocationTechnicalDetails';

const card = 'min-w-0 scroll-mt-6 rounded-xl bg-[#1c1f33] p-4 sm:p-5';
const button = 'inline-flex items-center justify-center gap-2 rounded-lg bg-[#d3bb73]/10 px-3 py-2.5 text-sm text-[#d3bb73] hover:bg-[#d3bb73]/20 disabled:cursor-not-allowed disabled:opacity-40';
type Draft = { task: PreparationTask; revision: number; text: string };

function Contact({ contact }: { contact: Partial<ArrangementContact> }) {
  return <div className="min-w-0 space-y-2 rounded-lg bg-white/[0.03] p-3 text-sm">
    <p className="break-words">{contact.name || 'Osoba do ustalenia'}</p>
    {contact.role && <p className="text-xs text-white/50">{systemLabel(contact.role, 'role', { preserveCustom: true })}</p>}
    {contact.phone && <a href={`tel:${contact.phone.replace(/[^+\d]/g, '')}`} className="flex items-center gap-2 break-all text-[#d3bb73]"><Phone className="h-3.5 w-3.5 shrink-0"/>{contact.phone}</a>}
    {contact.email && <a href={`mailto:${contact.email}`} className="flex items-center gap-2 break-all text-[#d3bb73]"><Mail className="h-3.5 w-3.5 shrink-0"/>{contact.email}</a>}
    {!contact.phone && !contact.email && <p className="text-xs text-white/40">Dane kontaktowe nie zostały jeszcze uzupełnione.</p>}
  </div>;
}

export default function SellerRealizationWorkspace({ offerId }: { offerId: string }) {
  const [data, setData] = useState<SellerDeliveryState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const alive = useRef(true);
  const sequence = useRef(0);
  const dirty = useRef(false);
  const locked = useRef(false);
  const pending = useRef<{ key: string; id: string } | null>(null);
  const handledHash = useRef('');
  const externalRefresh = useOfferRefresh(`id=eq.${offerId}`);
  const inbox = useSellerInbox();
  const { showSnackbar } = useSnackbar();

  const reload = useCallback(async () => {
    const current = ++sequence.current;
    if (alive.current) setLoading(true);
    try {
      const result = await sellerOfferRequest(offerId) as SellerDeliveryState;
      if (alive.current && current === sequence.current) { setData(result); setError(''); }
      return result;
    } catch (cause) {
      if (alive.current && current === sequence.current) setError(cause instanceof Error ? cause.message : 'Nie udało się wczytać realizacji.');
      return null;
    } finally { if (alive.current && current === sequence.current) setLoading(false); }
  }, [offerId]);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; ++sequence.current; };
  }, []);
  useEffect(() => { if (!dirty.current && !locked.current) void reload(); }, [reload, externalRefresh]);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => { if (dirty.current || locked.current) { event.preventDefault(); event.returnValue = ''; } };
    const beforeNavigation = (event: MouseEvent) => {
      if (!(event.target instanceof Element)) return;
      const anchor = event.target.closest('a[href]');
      if (!anchor || anchor.getAttribute('target') === '_blank') return;
      const url = new URL(anchor.getAttribute('href') || '', window.location.href);
      if (url.origin === window.location.origin && url.pathname === window.location.pathname && url.hash) {
        const target = document.getElementById(url.hash.slice(1));
        if (target instanceof HTMLDetailsElement) target.open = true;
      }
      if (!dirty.current && !locked.current) return;
      if (url.origin !== window.location.origin || url.pathname === window.location.pathname) return;
      if (locked.current || !window.confirm('Masz niewysłaną informację. Opuścić stronę bez jej wysłania?')) { event.preventDefault(); event.stopPropagation(); }
    };
    window.addEventListener('beforeunload', beforeUnload);
    document.addEventListener('click', beforeNavigation, true);
    return () => { window.removeEventListener('beforeunload', beforeUnload); document.removeEventListener('click', beforeNavigation, true); };
  }, []);
  useEffect(() => {
    if (!data || document.visibilityState !== 'visible') return;
    inbox.items.filter((item) => item.offer_id === offerId && item.kind === 'notification').forEach((item) => void readSellerNotice(item));
  }, [data, inbox.items, offerId]);
  useEffect(() => {
    if (!data) return;
    const scrollToAnchor = () => {
      const id = window.location.hash.slice(1);
      if (!id || handledHash.current === id) return;
      const target = document.getElementById(id);
      if (!target) return;
      if (target instanceof HTMLDetailsElement) target.open = true;
      target.scrollIntoView({ block: 'start' }); handledHash.current = id;
    };
    if (new URLSearchParams(window.location.search).get('preview') === '1') {
      const documents = document.getElementById('seller-realization-documents');
      if (documents instanceof HTMLDetailsElement) documents.open = true;
    }
    const frame = window.requestAnimationFrame(scrollToAnchor);
    window.addEventListener('hashchange', scrollToAnchor);
    return () => { window.cancelAnimationFrame(frame); window.removeEventListener('hashchange', scrollToAnchor); };
  }, [data]);

  const refresh = () => {
    if (locked.current || (dirty.current && !window.confirm('Odświeżyć dane i odrzucić niewysłaną informację?'))) return;
    dirty.current = false; setDraft(null); pending.current = null; void reload();
  };
  const openTask = (task: PreparationTask) => {
    if (locked.current || (dirty.current && !window.confirm('Odrzucić niewysłaną informację i otworzyć inną pozycję?'))) return;
    dirty.current = false; pending.current = null;
    setDraft({ task, revision: data?.seller_arrangements?.values.revision || 0, text: '' });
  };
  const submit = async () => {
    if (!draft?.text.trim() || locked.current) return;
    const text = draft.text.trim();
    const key = JSON.stringify([offerId, draft.task.key, draft.revision, text]);
    if (pending.current?.key !== key) pending.current = { key, id: crypto.randomUUID() };
    const messageId = pending.current.id;
    locked.current = true; setSubmitting(true);
    try {
      await sellerOfferRequest(offerId, { action: 'submit_preparation', taskKey: draft.task.key, revision: draft.revision, messageId, text });
      if (!alive.current) return;
      // A successful write remains successful even if the following read fails.
      setData((current) => current?.seller_progress ? { ...current, seller_progress: { ...current.seller_progress,
        submissions: [{ id: messageId, task_key: draft.task.key, arrangement_revision: draft.revision, submitted_at: new Date().toISOString() }, ...current.seller_progress.submissions.filter((item) => item.id !== messageId)],
      } } : current);
      dirty.current = false; setDraft(null); pending.current = null;
      showSnackbar('Informacja została przekazana opiekunowi i zapisana we wspólnej rozmowie.', 'success');
      window.dispatchEvent(new Event('seller-workspace-changed'));
      if (!await reload() && alive.current) showSnackbar('Informacja jest zapisana. Nie udało się odświeżyć widoku — nie musisz wysyłać jej ponownie.', 'warning');
    } catch (cause) {
      if (alive.current) showSnackbar(cause instanceof Error ? cause.message : 'Nie udało się potwierdzić wysłania. Treść pozostaje w formularzu.', 'error');
    } finally { locked.current = false; if (alive.current) setSubmitting(false); }
  };

  if (!data) return <div className="mx-auto max-w-7xl space-y-4 p-6 text-[#e5e4e2]">
    <Link href="/seller/realizations" className={button}><ArrowLeft className="h-4 w-4"/>Moje realizacje</Link>
    {loading ? <p role="status" className="flex items-center gap-2 py-8 text-sm text-white/60"><Loader2 className="h-4 w-4 animate-spin"/>Wczytywanie realizacji…</p>
      : <div role="alert" className={card}><p>{error || 'Realizacja nie jest dostępna.'}</p><button className={`${button} mt-4`} onClick={refresh}>Spróbuj ponownie</button></div>}
  </div>;

  const arrangements = data.seller_arrangements;
  const progress = data.seller_progress;
  const stage = deliveryStage(data.realization?.event_status);
  const isRealization = data.realization?.offer_status === 'accepted' || ['confirmed', 'cancelled'].includes(data.realization?.stage || '');
  if (!isRealization) return <div className="mx-auto max-w-3xl space-y-4 p-6 text-[#e5e4e2]"><h1 className="text-xl uppercase">Oferta oczekuje na decyzję</h1><p className="text-sm text-white/60">Ta oferta nie przeszła jeszcze do realizacji. Aktualną decyzję i dalsze kroki znajdziesz w jej podglądzie.</p><Link href={`/seller/offers/${offerId}`} className={button}>Przejdź do oferty</Link></div>;

  const tasks = arrangements ? preparationTasks(arrangements, progress) : [];
  const currentRevision = arrangements?.values.revision || 0;
  const latestSubmission = (key: string) => progress?.submissions.find((item) => item.task_key === key);
  const outstanding = tasks.filter((task) => !task.recorded && latestSubmission(task.key)?.arrangement_revision !== currentRevision);
  const preparedCount = tasks.length - outstanding.length;
  const clientAcceptance = progress?.acceptances[0];
  const readyToRead = Boolean(arrangements && progress);
  let next = { title: 'Czekamy na potwierdzenie MAVINCI', detail: 'Oferta została zaakceptowana. Opiekun osobno potwierdzi wydarzenie. Nie wysyłaj oferty ponownie — możesz już sprawdzić przygotowania i kontynuować rozmowę.', owner: 'Opiekun MAVINCI', href: '#seller-realization-preparation', action: 'Sprawdź przygotowania' };
  if (stage.index === -1) next = { title: stage.cancelled ? 'Realizacja została anulowana' : 'Realizacja jest wstrzymana', detail: 'Historia, dokumenty i rozmowa pozostają dostępne. Dalsze działania ustal z opiekunem.', owner: 'Opiekun MAVINCI', href: '#seller-offer-conversation', action: 'Otwórz rozmowę' };
  else if (stage.index === 5) next = { title: outstanding.length ? 'Jak przebiegła realizacja?' : 'Realizacja zakończona', detail: outstanding.length ? 'Możesz przekazać opiekunowi podsumowanie i uwagi klienta. To krok opcjonalny.' : 'Dokumenty i pełna historia ustaleń pozostają tutaj. Dziękujemy za współpracę.', owner: outstanding.length ? 'Ty — opcjonalnie' : 'Brak wymaganej czynności', href: outstanding.length ? '#seller-realization-preparation' : '#seller-realization-documents', action: outstanding.length ? 'Przekaż podsumowanie' : 'Przejrzyj dokumenty' };
  else if (stage.index === 4) next = { title: 'Wydarzenie jest w realizacji', detail: 'W sprawach bieżących korzystaj z kontaktów do zespołu. Ustalenia i zmiany zapisuj we wspólnej rozmowie.', owner: 'Zespół realizacyjny', href: '#seller-realization-schedule', action: 'Harmonogram i kontakty' };
  else if (stage.index === 3) next = { title: 'Wszystko gotowe do realizacji', detail: 'Opiekun oznaczył realizację jako gotową. Sprawdź harmonogram i dostępność osoby kontaktowej na miejscu.', owner: 'Ty i zespół realizacyjny', href: '#seller-realization-schedule', action: 'Sprawdź harmonogram' };
  else if (stage.index > 0) next = outstanding.length
    ? { title: outstanding[0].title, detail: 'Przejrzyj wymagania poniżej i przekaż brakujące informacje. Zapis trafi do rozmowy z opiekunem.', owner: 'Ty', href: '#seller-realization-preparation', action: 'Przejdź do przygotowań' }
    : { title: 'Informacje przekazane', detail: 'Na tej liście nie ma teraz brakujących odpowiedzi. Opiekun potwierdza przygotowanie i gotowość realizacji — samo wysłanie informacji nie zmienia etapu.', owner: 'Opiekun MAVINCI', href: '#seller-offer-conversation', action: 'Otwórz rozmowę' };
  if (!readyToRead && stage.index >= 0) next = { title: 'Sprawdź dostępność danych', detail: 'Nie wczytaliśmy pełnych ustaleń lub przygotowań. Nie traktuj tego jako braku zadań. Odśwież widok lub skontaktuj się z opiekunem.', owner: 'Dane chwilowo niedostępne', href: '#seller-offer-conversation', action: 'Otwórz rozmowę' };
  const location = arrangements?.event?.location || arrangements?.offer.location;

  return <div className="min-h-screen p-4 text-[#e5e4e2] md:p-6">
    <div className="mx-auto max-w-7xl space-y-5">
      <header className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3"><Link href="/seller/realizations" className="inline-flex items-center gap-2 text-sm text-white/60 hover:text-[#d3bb73]"><ArrowLeft className="h-4 w-4"/>Moje realizacje</Link><button type="button" className={button} disabled={loading || submitting} onClick={refresh}><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`}/>Odśwież</button></div>
        <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><p className="text-xs text-white/45">{data.offer_number} · Realizacja</p><h1 className="mt-2 break-words text-xl uppercase sm:text-2xl">{arrangements?.event?.name || data.title}</h1>{location && <p className="mt-2 flex items-center gap-2 text-sm text-white/55"><MapPin className="h-4 w-4 shrink-0"/>{location}</p>}</div><span className={`rounded-full px-3 py-2 text-xs ${stage.cancelled ? 'bg-rose-300/10 text-rose-200' : 'bg-[#d3bb73]/10 text-[#d3bb73]'}`}>{stage.label}</span></div>
      </header>
      {error && <p role="alert" className="rounded-xl bg-amber-200/10 p-4 text-sm text-amber-100">{error} Wyświetlane dane mogą być nieaktualne.</p>}
      {[data.seller_arrangements_error, data.seller_progress_error].filter(Boolean).map((message) => <p role="alert" key={message} className="rounded-xl bg-amber-200/10 p-4 text-sm text-amber-100">{message}</p>)}
      <nav aria-label="Etapy realizacji" className={`${card} overflow-x-auto`}>
        <ol className="grid min-w-[650px] grid-cols-6 gap-3">{deliverySteps.map((label, index) => <li key={label} aria-current={stage.index === index ? 'step' : undefined} className={`space-y-2 text-xs ${stage.index === index ? 'text-[#d3bb73]' : index < stage.index ? 'text-white/75' : 'text-white/35'}`}><span className={`flex h-7 w-7 items-center justify-center rounded-full ${index <= stage.index ? 'bg-[#d3bb73]/15' : 'bg-white/5'}`}>{index < stage.index ? <Check className="h-3.5 w-3.5"/> : index + 1}</span><p>{label}</p></li>)}</ol>
        <p className="mt-4 text-xs text-white/40">Etap wynika z decyzji MAVINCI, nie z samego upływu daty wydarzenia.</p>
      </nav>
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <main className="min-w-0 space-y-5">
          <section id="seller-offer-review" className={`${card} space-y-3`} aria-labelledby="seller-next-action">
            <p className="text-xs uppercase text-[#d3bb73]">Następny krok · {next.owner}</p><h2 id="seller-next-action" className="text-lg uppercase">{next.title}</h2><p className="text-sm leading-6 text-white/60">{next.detail}</p><a href={next.href} className={button}>{next.action}</a>
          </section>
          <nav aria-label="Sekcje realizacji" className="flex flex-wrap gap-2 text-xs"><a href="#seller-realization-summary" className={button}>Podsumowanie</a><a href="#seller-realization-preparation" className={button}>Przygotowanie</a><a href="#seller-realization-schedule" className={button}>Harmonogram i kontakty</a><a href="#seller-realization-documents" className={button}>Dokumenty</a></nav>
          <section id="seller-realization-summary" className={`${card} space-y-4`}>
            <h2 className="text-base uppercase">Podsumowanie realizacji</h2>
            {arrangements && <div className="grid gap-4 text-sm sm:grid-cols-2"><div><p className="text-xs text-white/45">Klient</p><p className="mt-1">{[arrangements.client.company, arrangements.client.name].filter(Boolean).join(' · ') || 'Nie podano'}</p></div><div><p className="text-xs text-white/45">Wartość oferty dla klienta netto</p><p className="mt-1">{arrangements.offer.client_net == null ? 'Nie podano' : sellerMoney(arrangements.offer.client_net)}</p></div>{arrangements.values.room && <div><p className="text-xs text-white/45">Sala / przestrzeń</p><p className="mt-1">{arrangements.values.room}</p></div>}{arrangements.values.participant_count != null && <div><p className="text-xs text-white/45">Liczba uczestników</p><p className="mt-1">{arrangements.values.participant_count}</p></div>}</div>}
            {progress && <div className="space-y-2"><h3 className="text-xs uppercase text-white/50">Zakres usług</h3>{progress.items.length ? <ul className="divide-y divide-white/5">{progress.items.map((item) => <li key={item.id} className="flex justify-between gap-4 py-2.5 text-sm"><span className="break-words">{item.name}</span><span className="shrink-0 text-white/55">{item.quantity} {item.unit}</span></li>)}</ul> : <p className="text-sm text-white/50">Brak pozycji zapisanych przy ofercie.</p>}</div>}
            <p className="text-xs leading-5 text-white/45">Zmianę ceny, zakresu lub terminu zgłoś opiekunowi w rozmowie. Ten ekran nie zmienia zaakceptowanej oferty.</p>
          </section>
          <section id="seller-realization-preparation" className={`${card} space-y-4`}>
            <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-base uppercase">{stage.closed ? 'Podsumowanie po realizacji' : 'Przygotowanie do realizacji'}</h2>{readyToRead && tasks.length > 0 && <span className="text-xs text-white/50">{preparedCount}/{tasks.length} · dane zapisane lub przekazane</span>}</div>
            <p className="text-xs leading-5 text-white/55">To lista informacji do uzgodnienia, nie automatyczne potwierdzenie gotowości. Odpowiedź trafia do tej samej rozmowy. Opiekun zatwierdza ustalenia osobno.</p>
            {!readyToRead ? <p className="text-sm text-white/50">Pełna lista przygotowań jest chwilowo niedostępna.</p> : !tasks.length ? <p className="text-sm text-white/50">{stage.cancelled ? 'Realizacja anulowana — nie ma aktywnych przygotowań.' : 'Brak dodatkowych informacji do przekazania.'}</p> : tasks.map((task) => {
              const submission = latestSubmission(task.key);
              const submitted = submission?.arrangement_revision === currentRevision;
              const active = draft?.task.key === task.key;
              const status = task.recorded ? 'Dane w ustaleniach' : submitted ? 'Przekazano opiekunowi' : submission ? 'Ustalenia zmienione — sprawdź odpowiedź' : task.optional ? 'Opcjonalnie' : 'Czeka na Twoją informację';
              return <article key={task.key} className="space-y-3 rounded-lg bg-white/[0.03] p-4">
                <div className="flex flex-wrap justify-between gap-2"><h3 className="text-sm uppercase">{task.title}</h3><span className={`text-xs ${task.recorded || submitted ? 'text-emerald-200' : 'text-[#d3bb73]'}`}>{status}</span></div>
                <p className="whitespace-pre-wrap break-words text-sm leading-6 text-white/60">{task.detail}</p>
                {task.due && <p className="flex items-center gap-2 text-xs text-[#d3bb73]"><Clock3 className="h-3.5 w-3.5"/>Termin przekazania: {arrangementLocalDate(task.due)}</p>}
                {submission && <p className="text-xs text-white/40">Ostatnia informacja: {deliveryTimestamp(submission.submitted_at)} · wersja ustaleń {submission.arrangement_revision}</p>}
                {active && draft ? <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
                  <label className="block text-xs text-white/60">Informacja dla opiekuna<textarea autoFocus rows={4} maxLength={4000} value={draft.text} disabled={submitting} onChange={(event) => { dirty.current = Boolean(event.target.value.trim()); setDraft({ ...draft, text: event.target.value }); }} placeholder={task.key === 'materials' ? 'Link do materiałów i krótki opis…' : 'Wpisz konkretne dane, odpowiedź lub propozycję…'} className="mt-2 w-full rounded-lg border border-white/10 bg-[#0f1119] p-3 text-sm outline-none focus:border-[#d3bb73]/30"/></label>
                  <p className="text-xs text-white/40">Wiadomość będzie widoczna w rozmowie. Nie nadpisze harmonogramu, ceny ani zaakceptowanych ustaleń.</p>
                  <div className="flex flex-wrap gap-2"><button type="submit" disabled={submitting || !draft.text.trim() || !data.chat?.can_start} className={button}>{submitting ? <Loader2 className="h-4 w-4 animate-spin"/> : <Send className="h-4 w-4"/>}{submitting ? 'Przekazywanie…' : 'Przekaż opiekunowi'}</button><button type="button" disabled={submitting} className={button} onClick={() => { if (!dirty.current || window.confirm('Odrzucić niewysłaną informację?')) { dirty.current = false; setDraft(null); pending.current = null; } }}>Anuluj</button></div>
                </form> : <button type="button" disabled={submitting || !data.chat?.can_start} className={button} onClick={() => openTask(task)}>{task.recorded || submission ? 'Uzupełnij informację' : 'Przekaż informacje'}</button>}
              </article>;
            })}
            {readyToRead && tasks.length > 0 && !data.chat?.can_start && <p className="text-xs text-amber-200">Przekazywanie informacji wymaga dostępu do rozmowy w tej marce.</p>}
          </section>
          <section id="seller-realization-schedule" className={`${card} space-y-5`}>
            <h2 className="flex items-center gap-2 text-base uppercase"><CalendarDays className="h-4 w-4 text-[#d3bb73]"/>Harmonogram i kontakty</h2>
            {arrangements ? <><p className="text-xs leading-5 text-white/45">Godziny w strefie Europe/Warsaw. Terminy bez oznaczenia „CRM” pochodzą z ustaleń oferty i wymagają potwierdzenia przez opiekuna.</p><dl className="grid gap-3 sm:grid-cols-2">{arrangementSchedule.map(([key, label]) => { const official = arrangements.event?.[key]; const value = official || arrangements.values[key]; return <div key={key} className="rounded-lg bg-white/[0.03] p-3"><dt className="text-xs text-white/45">{label}{official ? ' · CRM' : value ? ' · ustalenia oferty' : ''}</dt><dd className="mt-1 text-sm">{arrangementLocalDate(value)}</dd></div>; })}</dl>
              {location && <p className="text-sm text-white/60">Miejsce: {location}</p>}
              <div className="space-y-3"><h3 className="text-sm uppercase">Opiekun i zespół MAVINCI</h3>{arrangements.team.length ? <div className="grid gap-3 sm:grid-cols-2">{arrangements.team.map((contact) => <Contact key={contact.id} contact={contact}/>)}</div> : <p className="text-sm text-white/50">Kontakty nie zostały jeszcze uzupełnione. Skorzystaj z rozmowy z opiekunem.</p>}</div>
              <div className="space-y-3"><h3 className="text-sm uppercase">Kontakty po stronie klienta</h3><div className="grid gap-3 sm:grid-cols-2">{(arrangements.client.name || arrangements.client.phone || arrangements.client.email) && <Contact contact={{ name: arrangements.client.name || '', phone: arrangements.client.phone || '', email: arrangements.client.email || '', role: 'Klient z oferty' }}/>} {(arrangements.values.contacts || []).map((contact, index) => <Contact key={`${contact.name}:${index}`} contact={contact}/>)}</div>{!arrangements.values.contacts?.length && <p className="text-xs text-white/45">Osobę kontaktową na miejscu przekaż w sekcji przygotowań.</p>}</div>
            </> : <p className="text-sm text-white/50">Harmonogram i kontakty są chwilowo niedostępne.</p>}
          </section>
          {arrangements?.values.venue_snapshot && <details className={card}>
            <summary className="cursor-pointer text-base uppercase">Przestrzeń i plany · {arrangements.values.venue_snapshot.room.name}</summary>
            <div className="mt-4 space-y-4"><p className="text-xs text-white/50">Informacje zapisane wraz z ustaleniami oferty. Późniejsze zmiany bazy hotelu nie nadpisują tego zapisu.</p><p className="whitespace-pre-wrap text-sm text-white/65">{arrangements.values.venue_snapshot.room.notes}</p><TechnicalDetailsView value={arrangements.values.venue_snapshot.room.technical}/><TechnicalDetailsView value={arrangements.values.venue_snapshot.technical_details}/></div>
          </details>}
          <details id="seller-realization-documents" className={card}>
            <summary className="cursor-pointer text-base uppercase"><FileText className="mr-2 inline h-4 w-4 text-[#d3bb73]"/>Dokumenty i historia akceptacji</summary>
            <div className="mt-5 space-y-5"><SellerRealizationDocuments offerId={offerId} documents={data.documents} approvedDocumentId={data.review?.status === 'approved' ? data.review.document_id : undefined} clientDocumentId={clientAcceptance?.document_id}/>
              <div className="space-y-3 text-xs leading-5 text-white/55"><h3 className="text-sm uppercase">Akceptacja klienta</h3>{progress ? progress.acceptances.length ? <ul className="space-y-2">{progress.acceptances.map((acceptance) => <li key={acceptance.id}>{deliveryTimestamp(acceptance.confirmed_at)} · {acceptance.seller_name} potwierdził(a) akceptację klienta dla {data.documents.find((document) => document.id === acceptance.document_id)?.filename || 'zapisanej wersji PDF'}.{acceptance.source_key !== data.source_key && <span className="block text-amber-200">Potwierdzenie dotyczy wcześniejszej wersji. Nie oznacza zgody na późniejsze zmiany.</span>}</li>)}</ul> : <p>Brak osobno zapisanego potwierdzenia klienta. Historycznej prośby o akceptację nie traktujemy automatycznie jako zgody klienta.</p> : <p>Historia akceptacji jest chwilowo niedostępna.</p>}{data.review?.reviewed_at && <p>Ostatnia decyzja opiekuna: {deliveryTimestamp(data.review.reviewed_at)}.</p>}</div>
            </div>
          </details>
          {progress?.commission_enabled && <Link href="/seller/commissions" className={button}>Przejdź do mojego wynagrodzenia</Link>}
        </main>
        <aside className="min-w-0 lg:sticky lg:top-6 lg:flex lg:max-h-[calc(100dvh-3rem)] lg:flex-col">
          {data.chat ? <SellerOfferConversation offerId={offerId} partnerId={data.chat.sales_partner_id} companyId={data.chat.my_company_id} canStart={data.chat.can_start} crm={false} compact standalone realization/>
            : <section id="seller-offer-conversation" className={card}><h2 className="flex items-center gap-2 text-base uppercase"><MessageSquare className="h-4 w-4 text-[#d3bb73]"/>Rozmowa o realizacji</h2><p className="mt-3 text-sm text-white/55">{data.chat_error || 'Rozmowa jest chwilowo niedostępna.'}</p><button className={`${button} mt-3`} disabled={loading} onClick={refresh}>Odśwież</button></section>}
        </aside>
      </div>
    </div>
  </div>;
}
