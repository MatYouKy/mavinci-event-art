'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { CheckCircle2, ChevronLeft, ChevronRight, Loader2, RefreshCw } from 'lucide-react';
import { sellerOfferRequest } from '@/lib/seller/offerRequest.browser';
import { arrangementLocalDate } from '@/lib/seller/arrangements';
import { deliveryTimestamp } from '@/lib/seller/delivery';
import { onsiteContactChoices, parseOnsiteContact, type OnsiteContact } from '@/lib/seller/onsiteContact';
import { planChecks, realizationWizardSteps, wizardActionLabels, wizardFieldLabels, wizardPayloadValue, wizardStatusLabels,
  type RealizationWizardState, type WizardPayload } from '@/lib/seller/realizationWizard';
import SellerOnsiteContactFields from './SellerOnsiteContactFields';

const button = 'inline-flex items-center justify-center gap-2 rounded-lg bg-[#d3bb73]/10 px-3 py-2.5 text-sm text-[#d3bb73] hover:bg-[#d3bb73]/20 disabled:opacity-40 disabled:cursor-not-allowed';
const field = 'mt-1.5 w-full rounded-lg border border-white/10 bg-[#0f1119] px-3 py-2.5 text-sm outline-none focus:border-[#d3bb73]/30';
const keys: string[] = [...realizationWizardSteps.map(step => step.key), 'finish'];

function legacyContact(body?: string): OnsiteContact | null {
  const match = body?.match(/^Koordynacja: (Osobista koordynacja|Klient z wydarzenia|Inny kontakt)\nImię i nazwisko: ([^\n]+)\nStanowisko \/ rola: ([^\n]+)\nTelefon: ([^\n]+)(?:\nE-mail: ([^\n]+))?(?:\nDodatkowe informacje:\n([\s\S]*))?$/);
  if (!match) return null;
  try { return parseOnsiteContact({ source: onsiteContactChoices.find(item => item.label === match[1])?.value,
    name: match[2], role: match[3], phone: match[4], email: match[5] || '', note: match[6] || '' }); } catch { return null; }
}
function PayloadView({ value }: { value: WizardPayload }) {
  return <dl className="grid gap-3 rounded-lg bg-black/15 p-4 text-sm sm:grid-cols-2">
    {Object.entries(value).filter(([key, value]) => wizardFieldLabels[key] && value !== '' && value != null).map(([key, value]) =>
      <div key={key} className={['summary', 'access', 'note', 'technical', 'logistics'].includes(key) ? 'sm:col-span-2' : ''}>
        <dt className="text-xs text-white/45">{wizardFieldLabels[key]}</dt><dd className="mt-1 whitespace-pre-wrap break-words">{wizardPayloadValue(key, value)}</dd>
      </div>)}
  </dl>;
}

export default function SellerRealizationWizard({ offerId, crm = false, refreshKey = 0, blocked = false, onDirtyChange }: {
  offerId: string; crm?: boolean; refreshKey?: number; blocked?: boolean; onDirtyChange?: (dirty: boolean) => void;
}) {
  const requestedStep = useSearchParams().get('prepStep');
  const [state, setState] = useState<RealizationWizardState | null>(null);
  const [selected, setSelected] = useState('contact');
  const [payload, setPayload] = useState<WizardPayload>({});
  const [note, setNote] = useState('');
  const [dirty, setDirty] = useState(false);
  const [editingApproved, setEditingApproved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const dirtyRef = useRef(false), busyRef = useRef(false), mounted = useRef(true), initialized = useRef(false);
  const selectedRef = useRef('contact'), request = useRef<{ key: string; id: string } | null>(null);
  const readSequence = useRef(0);
  const callback = useRef(onDirtyChange); callback.current = onDirtyChange;
  const markDirty = (value: boolean) => { dirtyRef.current = value; setDirty(value); callback.current?.(value); };
  const initialPayload = (next: RealizationWizardState, key: string): WizardPayload => {
    const saved = next.steps.find(step => step.key === key)?.payload;
    if (saved && Object.keys(saved).length) return saved;
    return key === 'organization' ? { room: next.context.room || next.context.location || '', participants: next.context.participants || '', access: '', schedule_confirmed: false }
      : key === 'materials' ? { mode: '', url: '', technical: next.context.technical || '', logistics: next.context.logistics || '', note: '' } : {};
  };
  const adopt = useCallback((next: RealizationWizardState) => {
    setState(next);
    let key = selectedRef.current;
    if (!initialized.current) {
      const requested = new URLSearchParams(window.location.search).get('prepStep') || '';
      key = keys.includes(requested) ? requested : next.steps.find(step => step.status !== 'approved')?.key || 'finish';
      initialized.current = true;
    }
    selectedRef.current = key; setSelected(key); setPayload(initialPayload(next, key)); setNote(''); setEditingApproved(false);
  }, []);
  const reload = useCallback(async () => {
    if (dirtyRef.current || busyRef.current) return;
    const sequence = ++readSequence.current;
    setLoading(true);
    try {
      const result = await sellerOfferRequest(offerId, { action: 'wizard_state' }) as RealizationWizardState;
      if (mounted.current && sequence === readSequence.current && !dirtyRef.current && !busyRef.current) { adopt(result); setError(''); }
    } catch (cause) { if (mounted.current && sequence === readSequence.current) setError(cause instanceof Error ? cause.message : 'Nie udało się wczytać kroków.'); }
    finally { if (mounted.current && sequence === readSequence.current) setLoading(false); }
  }, [offerId, adopt]);
  useEffect(() => {
    mounted.current = true;
    const unload = (event: BeforeUnloadEvent) => { if (dirtyRef.current || busyRef.current) { event.preventDefault(); event.returnValue = ''; } };
    const navigation = (event: MouseEvent) => {
      if (!(event.target instanceof Element) || (!dirtyRef.current && !busyRef.current)) return;
      const link = event.target.closest('a[href]');
      if (!link || link.getAttribute('target') === '_blank') return;
      const url = new URL(link.getAttribute('href') || '', window.location.href);
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      if (busyRef.current || !window.confirm('Opuścić krok bez zapisania zmian?')) { event.preventDefault(); event.stopPropagation(); }
      else { markDirty(false); request.current = null; }
    };
    window.addEventListener('beforeunload', unload); document.addEventListener('click', navigation, true);
    return () => { mounted.current = false; ++readSequence.current; callback.current?.(false); window.removeEventListener('beforeunload', unload); document.removeEventListener('click', navigation, true); };
  }, []);
  useEffect(() => { void reload(); }, [reload, refreshKey]);
  useEffect(() => {
    if (!state || !requestedStep || !keys.includes(requestedStep) || selectedRef.current === requestedStep
      || dirtyRef.current || busyRef.current) return;
    selectedRef.current = requestedStep; setSelected(requestedStep);
    setPayload(initialPayload(state, requestedStep)); setNote(''); setMessage(''); setEditingApproved(false);
  }, [requestedStep, state]);
  useEffect(() => {
    const visible = () => { if (document.visibilityState === 'visible') void reload(); };
    const timer = window.setInterval(visible, 20000);
    window.addEventListener('focus', visible); window.addEventListener('seller-workspace-changed', visible);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', visible); window.removeEventListener('seller-workspace-changed', visible); };
  }, [reload]);
  const select = (key: string) => {
    if (busyRef.current || (dirtyRef.current && !window.confirm('Zmienić krok i odrzucić niezapisane dane?'))) return;
    markDirty(false); request.current = null; setMessage(''); setNote(''); setEditingApproved(false);
    selectedRef.current = key; setSelected(key); if (state) setPayload(initialPayload(state, key));
    const url = new URL(window.location.href); url.searchParams.set('prepStep', key);
    // Next.js copies its internal history state and synchronizes search params.
    // Passing history.state back would bypass that synchronization via __NA.
    window.history.replaceState(null, '', url);
  };
  const change = (patch: WizardPayload) => { markDirty(true); setPayload(current => ({ ...current, ...patch })); setMessage(''); };
  const act = async (action: string) => {
    if (!state || busyRef.current || blocked) return;
    const step = state.steps.find(item => item.key === selected);
    const body = { action: 'wizard_update', step: selected, operation: action, revision: state.revision,
      contextKey: selected === 'finish' ? state.finish_key : step?.context_key,
      payload: ['save', 'submit'].includes(action) ? payload : {}, note: ['approve', 'changes_requested'].includes(action) ? note : '' };
    const key = JSON.stringify(body);
    if (request.current?.key !== key) request.current = { key, id: crypto.randomUUID() };
    busyRef.current = true; setBusy(true); ++readSequence.current; setError('');
    try {
      const result = await sellerOfferRequest(offerId, { ...body, requestId: request.current.id }) as RealizationWizardState;
      if (!mounted.current) return;
      markDirty(false); request.current = null; adopt(result);
      setMessage(action === 'save' ? 'Szkic zapisany. Krok nie jest jeszcze przekazany do sprawdzenia.'
        : action === 'submit' ? 'Dane zapisane w kroku i przekazane drugiej stronie.'
        : action === 'changes_requested' ? 'Uwagi zapisane. Krok wrócił do poprawy.'
        : action === 'complete' ? 'Przygotowania zatwierdzone przez opiekuna.' : 'Krok zatwierdzony. Można przejść dalej.');
      window.dispatchEvent(new Event('seller-workspace-changed'));
    } catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : 'Nie udało się potwierdzić zapisu. Dane pozostają w formularzu.'); }
    finally { busyRef.current = false; if (mounted.current) { setBusy(false); setLoading(false); } }
  };
  const step = state?.steps.find(item => item.key === selected);
  const definition = realizationWizardSteps.find(item => item.key === selected);
  const index = keys.indexOf(selected);
  const previousRemark = state?.history.find(item => item.step_key === selected && item.action === 'changes_requested' && item.review_note);
  const showForm = step?.can_submit && (step.status !== 'approved' || editingApproved);
  const imported = legacyContact(state?.legacy_contact_body);
  const contact = onsiteContactChoices.some(item => item.value === payload.source) ? {
    source: payload.source as OnsiteContact['source'], name: String(payload.name || ''), role: String(payload.role || ''),
    phone: String(payload.phone || ''), email: String(payload.email || ''), note: String(payload.note || ''),
  } : undefined;
  const input = (key: string, label: string, multiline = false, required = true) => <label key={key} className="block text-xs text-white/60">{label}{required ? ' *' : ''}
    {multiline ? <textarea rows={3} maxLength={key === 'summary' ? 4000 : 3000} value={String(payload[key] || '')} onChange={event => change({ [key]: event.target.value })} className={field} />
      : <input type={key === 'participants' ? 'number' : key === 'url' ? 'url' : 'text'} min={key === 'participants' ? 1 : undefined} max={key === 'participants' ? 1000000 : undefined}
        maxLength={key === 'room' ? 200 : 2000} value={String(payload[key] ?? '')} onChange={event => change({ [key]: event.target.value })} className={field} />}
  </label>;

  return <section id="seller-realization-wizard" className="min-w-0 space-y-4 rounded-xl bg-[#1c1f33] p-4 sm:p-5">
    <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-base uppercase">Przygotowanie realizacji krok po kroku</h2>
      <button type="button" className={button} disabled={busy || loading} onClick={() => {
        if (dirtyRef.current && !window.confirm('Odświeżyć i odrzucić niezapisane dane?')) return;
        markDirty(false); request.current = null; void reload();
      }}><RefreshCw className="h-4 w-4"/>Odśwież</button></div>
    <p className="text-xs leading-5 text-white/55">Dane, decyzje i poprawki są zapisane w krokach. Rozmowa pozostaje osobno. Wysłanie informacji ani zapis szkicu nie oznaczają zatwierdzenia.</p>
    {loading && !state && <p role="status" className="flex gap-2 text-sm"><Loader2 className="h-4 w-4 animate-spin"/>Wczytywanie przygotowań…</p>}
    {error && <p role="alert" className="whitespace-pre-wrap rounded-lg bg-rose-300/10 p-3 text-sm text-rose-200">{error}</p>}
    {message && <p role="status" className="rounded-lg bg-emerald-300/10 p-3 text-sm text-emerald-200">{message}</p>}
    {blocked && <p className="text-xs text-amber-200">Najpierw zapisz lub odrzuć niezapisane ustalenia realizacji poniżej.</p>}
    {state && <>
      <ol className="flex gap-2 overflow-x-auto pb-2" aria-label="Kroki przygotowania">
        {[...realizationWizardSteps, { key: 'finish', title: 'Zatwierdzenie przygotowań' }].map((item, i) => {
          const current = state.steps.find(step => step.key === item.key);
          const approved = item.key === 'finish' ? state.completed : current?.status === 'approved' && current.available;
          return <li key={item.key} className="min-w-[9rem] flex-1"><button type="button" aria-current={selected === item.key ? 'step' : undefined} onClick={() => select(item.key)}
            className={`h-full w-full rounded-lg p-3 text-left text-xs ${selected === item.key ? 'bg-[#d3bb73]/15 text-[#d3bb73]' : 'bg-white/[0.035] text-white/65'}`}>
            <span className="mb-2 block">{approved ? <CheckCircle2 className="h-4 w-4 text-emerald-200"/> : `${i + 1}/5`}</span>{item.title}</button></li>;
        })}
      </ol>
      <p className="text-xs text-white/50">{state.steps.filter(step => step.available && step.status === 'approved').length}/4 kroków uzgodnionych · {state.completed ? 'przygotowania zatwierdzone' : 'pozostaje końcowa decyzja opiekuna'}</p>
      {state.active && crm && !state.manager && <p className="text-sm text-amber-200">Masz dostęp tylko do podglądu przygotowań. Decyzje wymagają uprawnień do tej oferty i wydarzenia.</p>}
      {!state.active && <p className="text-sm text-amber-200">{!state.event_id ? 'Najpierw utwórz powiązane wydarzenie w CRM.' : 'Przygotowania są tylko do odczytu — sprawdź status wydarzenia i powiązanie oferty.'}</p>}
      {state.steps[0]?.status === 'approved' && <details className="rounded-lg bg-white/[0.035] p-3"><summary className="cursor-pointer text-sm text-[#d3bb73]">Zatwierdzony kontakt na miejscu · {String(state.steps[0].payload.name || '')}</summary><div className="mt-3"><PayloadView value={state.steps[0].payload}/></div></details>}
      {selected === 'finish' ? <div className="space-y-4">
        <h3 className="text-sm uppercase">Zatwierdzenie przygotowań · opiekun</h3>
        <p className="text-sm text-white/65">Ten krok wymaga zatwierdzenia danych sprzedawcy, potwierdzenia planu przez sprzedawcę oraz osobnego potwierdzenia realizacji w CRM.</p>
        {state.confirmation_required && <p className="text-sm text-amber-200">Realizacja nie została jeszcze potwierdzona w CRM. Zrób to w sekcji przygotowania wydarzenia.</p>}
        {state.completed ? <p className="text-sm text-emerald-200">Przygotowania zatwierdzone · {deliveryTimestamp(state.completed_at)}</p>
          : <button type="button" className={button} disabled={!state.can_complete || busy || blocked} onClick={() => void act('complete')}>Zatwierdź przygotowania</button>}
        <p className="text-xs text-white/45">Ta decyzja nie rezerwuje sprzętu, nie przypisuje pracowników i nie zmienia automatycznie statusu wydarzenia. Te operacje pozostają w CRM. Zmiana uzgodnionych danych wymaga ponownego sprawdzenia.</p>
      </div> : step && definition && <div className="space-y-4">
        <div><h3 className="text-sm uppercase">{index + 1}. {definition.title}</h3><p className="mt-2 text-sm text-[#d3bb73]">{wizardStatusLabels[step.status] || 'Sprawdź stan kroku'} · {step.status === 'submitted' ? `Teraz: ${definition.reviewer}` : step.status === 'approved' ? 'Można przejść dalej' : `Teraz: ${definition.author}`}</p></div>
        {!step.available && <p className="rounded-lg bg-amber-300/10 p-3 text-sm text-amber-200">Najpierw zatwierdź poprzednie kroki. Zapisane dane tego kroku pozostają dostępne.</p>}
        {step.review_note && <div className="rounded-lg bg-amber-300/10 p-4"><p className="mb-2 text-xs text-[#d3bb73]">Uwagi do tego kroku</p><p className="whitespace-pre-wrap text-sm">{step.review_note}</p></div>}
        {selected === 'organization' && <div className="rounded-lg bg-white/[0.035] p-3 text-sm"><p>Termin CRM: {arrangementLocalDate(state.context.starts_at)} — {arrangementLocalDate(state.context.ends_at)}</p><p className="mt-2">Miejsce CRM: {state.context.location || 'Do ustalenia z opiekunem'}</p><p className="mt-2 text-xs text-white/45">Zmianę terminu lub obiektu opiekun zapisuje w wydarzeniu. Ten krok nie nadpisuje kalendarza.</p></div>}
        {selected === 'materials' && <details className="rounded-lg bg-white/[0.035] p-3" open><summary className="cursor-pointer text-sm">Wymagania wynikające z oferty</summary><div className="mt-3 space-y-3 text-xs text-white/60">
          {state.context.materials_due && <p>Materiały do: {arrangementLocalDate(state.context.materials_due)}</p>}
          {state.context.requirements.map((item, i) => <p key={i} className="whitespace-pre-wrap"><strong>{item.name}</strong>{'\n'}{[item.technical, item.accommodation, item.logistics].filter(Boolean).join('\n') || 'Brak szczególnych wymagań zapisanych przy produkcie.'}</p>)}
        </div></details>}
        {selected === 'plan' && crm && state.event_id && <div className="flex flex-wrap gap-2">{planChecks.map(([key, label, tab]) =>
          <Link key={key} href={`/crm/events/${state.event_id}?tab=${tab}`} className={button}>{label} ↗</Link>)}</div>}
        {!step.review_note && previousRemark && <div className="rounded-lg bg-amber-300/10 p-4">
          <p className="mb-2 text-xs text-[#d3bb73]">Wcześniejsze uwagi do sprawdzenia · {deliveryTimestamp(previousRemark.at)}</p>
          <p className="whitespace-pre-wrap text-sm">{previousRemark.review_note}</p>
          {step.status === 'submitted' && <p className="mt-2 text-xs text-white/55">Powyżej są uwagi z poprzedniej rundy. Poniżej sprawdź ponownie przekazane dane.</p>}
        </div>}
        {step.can_submit && step.status === 'approved' && !editingApproved && <button type="button" className={button} disabled={busy || blocked} onClick={() => setEditingApproved(true)}>Zmień dane tego kroku</button>}
        {showForm ? <form className="space-y-4" onSubmit={event => { event.preventDefault(); void act('submit'); }}>
          <fieldset disabled={busy || blocked} className="space-y-4">
            {selected === 'contact' && <>
              {imported && !Object.keys(step.payload).length && <button type="button" className={button} onClick={() => change({ source: imported.source, name: imported.name, role: imported.role, phone: imported.phone, email: imported.email, note: imported.note || '' })}>Wczytaj wcześniej przekazany kontakt</button>}
              <SellerOnsiteContactFields value={contact} onChange={value => change({ source: value.source, name: value.name, role: value.role, phone: value.phone, email: value.email })} client={state.client} partnerId={state.partner_id} companyId={state.company_id} disabled={busy || blocked}/>
              {input('note', 'Dodatkowe informacje', true, false)}
            </>}
            {selected === 'organization' && <>
              <div className="grid gap-3 sm:grid-cols-2">{input('room', 'Sala / przestrzeń')}{input('participants', 'Liczba uczestników')}</div>
              {input('access', 'Dojazd, dostęp, odbiór zespołu na miejscu', true)}
              {input('note', 'Dodatkowe informacje', true, false)}
              <label className="flex gap-2 text-sm"><input type="checkbox" checked={payload.schedule_confirmed === true} onChange={event => change({ schedule_confirmed: event.target.checked })}/>Sprawdziłem/-am pokazany termin i miejsce wydarzenia.</label>
            </>}
            {selected === 'materials' && <>
              <label className="block text-xs text-white/60">
                Materiały *
                <select value={String(payload.mode || '')} onChange={event => change({ mode: event.target.value })} className={field}>
                  <option value="">Wybierz…</option>
                  <option value="provided">Przekazuję materiały pod linkiem</option>
                  <option value="none">Materiały nie są potrzebne</option>
                </select>
              </label>
              {payload.mode === 'provided' && input('url', 'Link do materiałów lub folderu')}
              {input('technical', 'Potwierdzenie wymagań technicznych', true)}
              {input('logistics', 'Logistyka i noclegi — ustalenia lub „nie dotyczy”', true)}
              {input('note', payload.mode === 'none' ? 'Dlaczego materiały nie są potrzebne?' : 'Dodatkowe informacje', true, payload.mode === 'none')}
            </>}
            {selected === 'plan' && <>
              <p className="text-xs text-white/55">Przygotuj plan w sekcjach CRM, a następnie zaznacz sprawdzone obszary. Jeśli coś nie dotyczy wydarzenia, wyjaśnij to w podsumowaniu. Zaznaczenie nie wykonuje rezerwacji ani przypisania.</p>
              {planChecks.map(([key, label]) => <label key={key} className="flex gap-2 text-sm"><input type="checkbox" checked={payload[key] === true} onChange={event => change({ [key]: event.target.checked })}/>{label}</label>)}
              {input('summary', 'Plan do potwierdzenia przez sprzedawcę — bez wewnętrznych cen i rozliczeń', true)}
            </>}
            <div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={step.status === 'approved' && !dirty} onClick={() => void act('save')}>Zapisz szkic</button><button type="submit" className={button} disabled={step.status === 'approved' && !dirty}>{busy && <Loader2 className="h-4 w-4 animate-spin"/>}Przekaż do sprawdzenia · {definition.reviewer}</button></div>
            {step.status === 'approved' && <p className="text-xs text-amber-200">Zmiana zatwierdzonych danych otworzy ten krok ponownie i może wymagać ponownego potwierdzenia kolejnych kroków.</p>}
          </fieldset>
        </form> : <PayloadView value={step.payload}/>}
        {step.can_review && <div className="space-y-3 rounded-lg bg-white/[0.035] p-4">
          <label className="block text-xs text-white/60">Uwagi do kroku — wymagane przy prośbie o poprawki<textarea rows={3} maxLength={3000} disabled={busy || blocked} value={note} onChange={event => { markDirty(true); setNote(event.target.value); }} className={field}/></label>
          <div className="flex flex-wrap gap-2"><button type="button" disabled={busy || blocked} className={button} onClick={() => void act('approve')}>Zatwierdź krok</button><button type="button" disabled={busy || blocked || !note.trim()} className={button} onClick={() => void act('changes_requested')}>Poproś o poprawki</button></div>
        </div>}
        {state.legacy_contact_body && selected === 'contact' && <details className="text-xs text-white/50"><summary className="cursor-pointer">Wcześniej przekazana informacja z czatu — bez zatwierdzenia kroku</summary><p className="mt-2 whitespace-pre-wrap">{state.legacy_contact_body}</p></details>}
      </div>}
      <div className="flex justify-between gap-2"><button type="button" className={button} disabled={index === 0 || busy} onClick={() => select(keys[index - 1])}><ChevronLeft className="h-4 w-4"/>Poprzedni</button><button type="button" className={button} disabled={index === keys.length - 1 || busy} onClick={() => select(keys[index + 1])}>Następny<ChevronRight className="h-4 w-4"/></button></div>
      <details className="rounded-lg bg-white/[0.025] p-3"><summary className="cursor-pointer text-sm">Historia tego kroku · ostatnie zmiany</summary><div className="mt-3 space-y-4">
        {state.history.filter(item => item.step_key === selected).map(item => <div key={item.revision} className="space-y-2 text-xs text-white/60"><p>{deliveryTimestamp(item.at)} · {wizardActionLabels[item.action] || 'Zmiana kroku'} · wersja {item.revision}</p>{item.review_note && <p className="whitespace-pre-wrap text-amber-200">{item.review_note}</p>}{item.payload && <PayloadView value={item.payload}/>}</div>)}
        {!state.history.some(item => item.step_key === selected) && <p className="text-xs text-white/40">Brak zapisanych zmian tego kroku.</p>}
      </div></details>
      {dirty && <p className="text-xs text-amber-200">Masz niezapisane dane w tym kroku.</p>}
    </>}
  </section>;
}
