'use client';

import { systemLabel } from '@/lib/ui/systemLabels';

import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import Link from 'next/link';
import { Loader2, Mail, Phone, Plus, RefreshCw, Save, Trash2 } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { sellerMoney } from '@/lib/seller/portal';
import { arrangementLocalDate, arrangementSchedule, sellerArrangementError, type ArrangementContact, type ArrangementScheduleKey, type SellerArrangements } from '@/lib/seller/arrangements';
import SellerDatePicker from '@/app/(public)/seller/_components/SellerDatePicker';
import SearchCombobox from '@/components/crm/SearchCombobox';
import { TechnicalDetailsView } from '@/components/crm/locations/LocationTechnicalDetails';
import { hotelContextError, type HotelVenueSnapshot, type SellerHotelContext } from '@/lib/seller/hotel';

const field = 'mt-1.5 min-h-11 w-full rounded-lg border border-white/10 bg-[#0f1119] px-3 py-2.5 text-sm text-[#e5e4e2] outline-none focus:border-[#d3bb73]/30 disabled:opacity-60';
const button = 'inline-flex items-center justify-center gap-2 rounded-lg bg-[#d3bb73]/10 px-3 py-2.5 text-sm text-[#d3bb73] hover:bg-[#d3bb73]/20 disabled:cursor-not-allowed disabled:opacity-40';
type Slot = { date: string; time: string };
type Draft = {
  room: string;
  venue_snapshot: HotelVenueSnapshot | null;
  participant_count: string;
  schedule: Record<ArrangementScheduleKey, Slot>;
  materials_due_date: string;
  technical_requirements: string;
  logistics_requirements: string;
  contacts: ArrangementContact[];
};

function draftFrom(data: SellerArrangements): Draft {
  const values = data.values;
  const slot = (key: ArrangementScheduleKey): Slot => ({ date: values[key]?.slice(0, 10) || '', time: values[key]?.slice(11, 16) || '' });
  return {
    room: values.room || '', venue_snapshot: values.venue_snapshot || null, participant_count: values.participant_count == null ? '' : String(values.participant_count),
    schedule: { setup_at: slot('setup_at'), starts_at: slot('starts_at'), ends_at: slot('ends_at'), teardown_at: slot('teardown_at') },
    materials_due_date: values.materials_due_date || '', technical_requirements: values.technical_requirements || '',
    logistics_requirements: values.logistics_requirements || '', contacts: values.contacts || [],
  };
}

function ContactCard({ name, role, email, phone }: { name: string; role?: string | null; email?: string | null; phone?: string | null }) {
  const dial = phone?.replace(/[^+\d]/g, '');
  return <div className="min-w-0 rounded-lg bg-white/[0.035] p-3 text-sm">
    <p className="break-words">{name}</p>
    {role && <p className="mt-1 text-xs text-white/50">{systemLabel(role, 'role', { preserveCustom: true })}</p>}
    {email && <a className="mt-2 flex items-start gap-2 break-all text-[#d3bb73] hover:underline" href={`mailto:${encodeURIComponent(email)}`}><Mail className="mt-0.5 h-4 w-4 shrink-0"/>{email}</a>}
    {phone && <a className="mt-2 flex items-center gap-2 text-[#d3bb73] hover:underline" href={dial ? `tel:${dial}` : undefined}><Phone className="h-4 w-4 shrink-0"/>{phone}</a>}
    {!email && !phone && <p className="mt-2 text-xs text-white/40">Kontakt nie został jeszcze uzupełniony.</p>}
  </div>;
}

function ContactEditor({ person, children }: { person: ArrangementContact; children: ReactNode }) {
  // Decide once, not on each keystroke: entering the phone must not collapse
  // a new contact's fields or move focus while the seller is typing.
  const [initiallyOpen] = useState(!person.name);
  return <details open={initiallyOpen || undefined} className="rounded-lg bg-white/[0.035] p-3">
    <summary className="cursor-pointer text-sm text-[#d3bb73]">{person.name || 'Nowy kontakt'}{person.role ? ` · ${person.role}` : ''}<span className="ml-2 text-xs text-white/45">{person.phone || person.email || 'Dane i edycja'}</span></summary>
    <div className="mt-3">{children}</div>
  </details>;
}

function ScheduleField({ name, label, value, onChange, onValidity }: {
  name: ArrangementScheduleKey; label: string; value: Slot; onChange: (value: Slot) => void;
  onValidity: (name: ArrangementScheduleKey, valid: boolean) => void;
}) {
  const validity = useCallback((valid: boolean) => onValidity(name, valid), [name, onValidity]);
  return <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_6.5rem] items-start gap-2">
    <SellerDatePicker label={label} value={value.date} onChange={(date) => onChange({ ...value, date })} onValidityChange={validity}/>
    <label className="text-xs text-white/50">Godzina<input type="time" aria-label={`${label} — godzina`} value={value.time} onChange={(event) => onChange({ ...value, time: event.target.value })} className={field}/></label>
  </div>;
}

export default function SellerOfferArrangements({ offerId, crm, refreshKey = 0, reviewedAt, onSaved, onReadyChange, onDirtyChange }: {
  offerId: string; crm: boolean; refreshKey?: number; reviewedAt?: string | null;
  onSaved?: () => Promise<void>; onReadyChange?: (ready: boolean) => void; onDirtyChange?: (dirty: boolean) => void;
}) {
  const [data, setData] = useState<SellerArrangements | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [savedDraft, setSavedDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [invalidDates, setInvalidDates] = useState<Record<string, boolean>>({});
  const [materialsValid, setMaterialsValid] = useState(true);
  const [formVersion, setFormVersion] = useState(0);
  const [hotel, setHotel] = useState<SellerHotelContext | null>(null);
  const [hotelError, setHotelError] = useState('');
  const [hotelLoading, setHotelLoading] = useState(true);
  const [customRoom, setCustomRoom] = useState(false);
  const dataRef = useRef<SellerArrangements | null>(null);
  const savedDraftRef = useRef('');
  const editRevision = useRef(0);
  const requestRef = useRef(0);
  const saveLock = useRef(false);
  const mounted = useRef(true);
  const invalid = !materialsValid || Object.values(invalidDates).some(Boolean);
  const dirty = Boolean(draft && (JSON.stringify(draft) !== savedDraft || invalid));
  const dirtyRef = useRef(dirty); dirtyRef.current = dirty;
  const dateValidity = useCallback((key: ArrangementScheduleKey, valid: boolean) => {
    setInvalidDates((current) => current[key] === !valid ? current : { ...current, [key]: !valid });
  }, []);

  const changeDraft = (next: Draft) => {
    editRevision.current += 1;
    dirtyRef.current = true;
    setDraft(next);
  };
  const accept = useCallback((next: SellerArrangements, reset = false) => {
    const nextDraft = draftFrom(next);
    const serialized = JSON.stringify(nextDraft);
    if (JSON.stringify(next) !== JSON.stringify(dataRef.current)) { dataRef.current = next; setData(next); }
    if (reset || serialized !== savedDraftRef.current) {
      savedDraftRef.current = serialized;
      setDraft(nextDraft); setSavedDraft(serialized);
      setCustomRoom(Boolean(nextDraft.room && !nextDraft.venue_snapshot));
      setInvalidDates({}); setMaterialsValid(true); setFormVersion((version) => version + 1);
    }
  }, []);
  const load = useCallback(async (foreground = false) => {
    const request = ++requestRef.current;
    const editingAtStart = editRevision.current;
    if (foreground || !dataRef.current) { setLoading(true); setError(''); setMessage(''); }
    try {
      const result = await supabase.rpc('get_seller_offer_arrangements', { p_offer: offerId });
      if (result.error) throw result.error;
      if (!result.data) throw new Error('Nie znaleziono danych ustaleń.');
      if (mounted.current && request === requestRef.current && editingAtStart === editRevision.current
        && (foreground || (!dirtyRef.current && !saveLock.current))) {
        accept(result.data as SellerArrangements, foreground); setError('');
      }
    } catch (cause) {
      if (mounted.current && request === requestRef.current) setError(sellerArrangementError(cause));
    } finally {
      if (mounted.current && request === requestRef.current) setLoading(false);
    }
  }, [offerId, accept]);
  useEffect(() => {
    mounted.current = true; void load(true);
    return () => { mounted.current = false; requestRef.current += 1; };
  }, [load]);
  useEffect(() => {
    let active = true;
    let request = 0;
    const refreshHotel = async (foreground = false) => {
      if (!foreground && document.visibilityState !== 'visible') return;
      const currentRequest = ++request;
      if (foreground) { setHotelLoading(true); setHotelError(''); }
      try {
        const { data: result, error: failed } = await supabase.rpc('get_seller_hotel_context', { p_offer: offerId });
        if (failed) throw failed;
        if (active && currentRequest === request) {
          setHotelError(''); setHotel((current) => JSON.stringify(current) === JSON.stringify(result) ? current : result as SellerHotelContext);
        }
      } catch (cause) {
        if (active && currentRequest === request) setHotelError(hotelContextError(cause as { code?: string; message?: string }));
      } finally { if (active && currentRequest === request) setHotelLoading(false); }
    };
    const onFocus = () => { void refreshHotel(); };
    void refreshHotel(true);
    window.addEventListener('focus', onFocus);
    return () => { active = false; window.removeEventListener('focus', onFocus); };
  }, [offerId]);
  // Parent refreshes never silently replace an unsaved form.
  const previousRefresh = useRef(refreshKey);
  useEffect(() => {
    if (previousRefresh.current === refreshKey) return;
    previousRefresh.current = refreshKey;
    if (!dirtyRef.current && !saveLock.current) void load();
  }, [refreshKey, load]);
  useEffect(() => { onReadyChange?.(Boolean(data) && !loading && !saving); }, [data, loading, saving, onReadyChange]);
  useEffect(() => { onDirtyChange?.(dirty || saving); }, [dirty, saving, onDirtyChange]);
  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [dirty]);

  const refresh = () => {
    if (!dirty || window.confirm('Wczytać zapisane dane i porzucić niezapisane zmiany w ustaleniach?')) void load(true);
  };
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!data?.can_edit || !draft || saveLock.current) return;
    setError(''); setMessage('');
    if (invalid) { setError('Popraw daty zaznaczone w formularzu.'); return; }
    const schedule = {} as Record<ArrangementScheduleKey, string | null>;
    for (const [key, label] of arrangementSchedule) {
      const slot = draft.schedule[key];
      if (Boolean(slot.date) !== Boolean(slot.time) || (slot.time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(slot.time))) {
        setError(`${label}: uzupełnij datę i godzinę albo pozostaw oba pola puste.`); return;
      }
      schedule[key] = slot.date ? `${slot.date}T${slot.time}` : null;
    }
    if ((schedule.starts_at && schedule.ends_at && schedule.ends_at < schedule.starts_at)
      || (schedule.setup_at && schedule.starts_at && schedule.setup_at > schedule.starts_at)
      || (schedule.teardown_at && schedule.ends_at && schedule.teardown_at < schedule.ends_at)) {
      setError('Sprawdź kolejność terminów: montaż, początek, koniec i demontaż.'); return;
    }
    requestRef.current += 1; // Ignore reads started before this save.
    saveLock.current = true; setSaving(true);
    try {
      const result = await supabase.rpc('save_seller_offer_arrangements', {
        p_offer: offerId, p_revision: data.values.revision,
        p_values: {
          ...schedule, room: draft.room, venue_snapshot: draft.venue_snapshot, participant_count: draft.participant_count === '' ? null : Number(draft.participant_count),
          materials_due_date: draft.materials_due_date || null, technical_requirements: draft.technical_requirements,
          logistics_requirements: draft.logistics_requirements, contacts: draft.contacts,
        },
      });
      if (result.error) throw result.error;
      if (!result.data) throw new Error('Nie otrzymano potwierdzenia zapisu. Wczytaj aktualne dane przed ponowieniem.');
      if (!mounted.current) return;
      accept(result.data as SellerArrangements, true);
      setMessage('Ustalenia zapisano. Dotychczasowa decyzja o akceptacji pozostaje bez zmian.');
      window.dispatchEvent(new Event('seller-workspace-changed'));
      try { await onSaved?.(); }
      catch { if (mounted.current) setMessage('Ustalenia zapisano. Nie udało się odświeżyć statusu oferty — użyj przycisku Odśwież status.'); }
    } catch (cause) {
      if (mounted.current) setError(sellerArrangementError(cause));
    } finally {
      saveLock.current = false; if (mounted.current) setSaving(false);
    }
  };
  const changedAfterReview = data?.values.updated_at && reviewedAt && new Date(data.values.updated_at) > new Date(reviewedAt);
  const savedRoomInHotel = Boolean(draft?.venue_snapshot && draft.venue_snapshot.organization_id === hotel?.organization?.id);
  const hotelReady = !hotelLoading && !hotelError;

  return <div className="space-y-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h3 className="text-sm uppercase">Ustalenia realizacji</h3><p className="mt-2 max-w-2xl text-xs leading-relaxed text-white/50">Tutaj zapisujemy konkretne ustalenia i kontakty. Są wspólne dla oferty i powiązanej realizacji. Pytania oraz propozycje omawiamy w rozmowie obok.</p></div>
      <button type="button" className={button} disabled={loading || saving} onClick={refresh}><RefreshCw className="h-4 w-4"/>Wczytaj ustalenia</button>
    </div>
    {loading && <p role="status" className="flex items-center gap-2 text-sm text-white/50"><Loader2 className="h-4 w-4 animate-spin"/>Wczytywanie ustaleń i kontaktów…</p>}
    {error && <p role="alert" className="rounded-lg bg-rose-300/10 p-3 text-sm text-rose-200">{error} Twoje niezapisane zmiany nie zostały zastąpione.</p>}
    {message && <p role="status" className="rounded-lg bg-[#d3bb73]/10 p-3 text-sm text-[#d3bb73]">{message}</p>}
    {data && draft && <>
      <div className="grid gap-3 rounded-lg bg-white/[0.035] p-3 text-sm sm:grid-cols-2">
        <div><p className="text-xs text-white/45">Termin i miejsce z oferty</p><p className="mt-1">{arrangementLocalDate(data.offer.event_date?.slice(0, 10))}</p><p>{data.offer.location || 'Miejsce do ustalenia'}</p></div>
        <div><p className="text-xs text-white/45">Wartości oferty netto</p><p className="mt-1">Cena dla sprzedawcy: {data.offer.base_net == null ? '—' : sellerMoney(data.offer.base_net)}</p><p>Cena klienta: {data.offer.client_net == null ? '—' : sellerMoney(data.offer.client_net)}</p></div>
      </div>
      {data.event && <div className="rounded-lg bg-white/[0.035] p-3">
        <p className="text-xs text-white/50">Terminy zapisane w kalendarzu CRM · {data.event.name}</p>
        <dl className="mt-2 grid gap-2 text-sm sm:grid-cols-2">{arrangementSchedule.map(([key, label]) => <div key={key}><dt className="text-xs text-white/45">{label}</dt><dd>{arrangementLocalDate(data.event?.[key])}</dd></div>)}</dl>
        {data.event.location && <p className="mt-2 text-sm">Miejsce: {data.event.location}</p>}
        {crm && data.event.can_view_crm && <Link href={`/crm/events/${data.event.id}`} className="mt-2 inline-block text-xs text-[#d3bb73] hover:underline">Otwórz realizację w CRM — harmonogram i przypisanie zespołu</Link>}
      </div>}
      <p className="text-xs leading-relaxed text-white/45">Ustalenia poniżej są wspólne dla sprzedawcy i CRM. Ich zapis nie zmienia cen, kalendarza ani akceptacji. Opiekun osobno zatwierdza decyzję i aktualizuje harmonogram realizacji.</p>
      {changedAfterReview && <p className="rounded-lg bg-amber-300/10 p-3 text-sm text-amber-100">Ustalenia zmieniono po ostatniej decyzji opiekuna. Decyzja pozostaje bez zmian — omówcie aktualizację na czacie.</p>}
      {data.can_edit ? <form key={formVersion} onSubmit={save}>
        <fieldset disabled={saving || loading} className="min-w-0 space-y-4 disabled:opacity-70">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2 text-xs text-white/50"><p>Sala / przestrzeń</p>
              {hotelLoading && <p role="status">Wczytywanie podpowiedzi hotelu…</p>}
              {hotelReady && hotel?.organization && <p>Podpowiedzi: {hotel.organization.name}</p>}
              {hotelReady && hotel?.available && !hotel.organization && <p>Wybierz organizację w edycji oferty, aby korzystać z jej przestrzeni i kontaktów.</p>}
              {hotelReady && hotel && !hotel.available && <p>Brak bazy hotelowej dla organizacji zapisanej przy tej ofercie. Organizację wybierzesz w edycji oferty; inną przestrzeń możesz wpisać ręcznie.</p>}
              {hotelReady && hotel?.organization && !hotel.location && <p>Hotel nie ma przypisanej lokalizacji. Opiekun CRM musi ją powiązać z organizacją, a następnie dodać sale.</p>}
              {hotelReady && hotel?.location && !hotel.location.rooms.length && <p>Nie dodano jeszcze sal w lokalizacji tego hotelu. Poproś opiekuna CRM o uzupełnienie przestrzeni.</p>}
              {hotel?.available && !customRoom ? <SearchCombobox
                value={savedRoomInHotel ? draft.venue_snapshot?.room.id || '' : ''}
                disabled={!hotelReady || !hotel.organization}
                ariaLabel="Wybierz salę hotelu" placeholder="Wyszukaj salę lub przestrzeń hotelu…"
                emptyLabel="Brak sal — dodaj je w ustawieniach hotelu"
                options={[
                  ...(hotel.location?.rooms || []).map((room) => ({ id: room.id, label: room.name, description: room.notes })),
                  ...(draft.venue_snapshot && savedRoomInHotel && !hotel.location?.rooms.some((room) => room.id === draft.venue_snapshot?.room.id)
                    ? [{ id: draft.venue_snapshot.room.id, label: `${draft.venue_snapshot.room.name} (zapisana w ofercie)`, description: draft.venue_snapshot.room.notes }] : []),
                ]}
                onChange={(id) => {
                  if (!hotelReady || (id && savedRoomInHotel && id === draft.venue_snapshot?.room.id)) return;
                  const room = hotel.location?.rooms.find((item) => item.id === id);
                  changeDraft({ ...draft, room: room?.name || '', venue_snapshot: room && hotel.location && hotel.organization ? {
                    organization_id: hotel.organization.id, organization_name: hotel.organization.name,
                    location_id: hotel.location.id, location_name: hotel.location.name, room,
                    technical_details: hotel.location.technical_details,
                  } : null });
                }}/>
                : <input value={draft.room} maxLength={200} onChange={(event) => changeDraft({ ...draft, room: event.target.value, venue_snapshot: null })} placeholder="Nazwa innej przestrzeni" className={field}/>}
              {hotel?.available && <div className="flex flex-wrap gap-3">
                <button type="button" className="text-[#d3bb73]" onClick={() => setCustomRoom(!customRoom)}>{customRoom ? 'Wybierz z bazy hotelu' : 'Inna przestrzeń — wpisz ręcznie'}</button>
                {(!crm || hotel.organization) && <Link target="_blank" rel="noopener noreferrer" className="text-[#d3bb73]" href={crm ? `/crm/contacts/${hotel.organization?.id}?tab=branding#hotel-directory` : '/seller/profile#hotel-directory'}>Ustawienia przestrzeni i kontaktów</Link>}
              </div>}
              {draft.venue_snapshot && !savedRoomInHotel && <p>Wybrana do oferty: {draft.venue_snapshot.organization_name} · {draft.venue_snapshot.room.name}. Zapisana przestrzeń pozostaje bez zmian.</p>}
              {hotelError && <p role="alert" className="text-amber-200">{hotelError} Możesz nadal wpisać dane ręcznie.</p>}
            </div>
            <label className="text-xs text-white/50">Liczba uczestników<input type="number" min={0} max={1000000} step={1} value={draft.participant_count} onChange={(event) => changeDraft({ ...draft, participant_count: event.target.value })} placeholder="Do ustalenia" className={field}/></label>
          </div>
          {draft.venue_snapshot && <details className="rounded-lg bg-white/[0.035] p-3"><summary className="cursor-pointer text-sm text-[#d3bb73]">{draft.venue_snapshot.organization_name} · {draft.venue_snapshot.room.name} — plany i informacje o przestrzeni</summary><div className="mt-3 space-y-3"><p className="whitespace-pre-wrap text-sm text-white/60">{draft.venue_snapshot.room.notes}</p><TechnicalDetailsView value={draft.venue_snapshot.room.technical}/><TechnicalDetailsView value={draft.venue_snapshot.technical_details}/></div></details>}
          <div><p className="mb-3 text-xs text-white/50">Harmonogram ustaleń · czas polski (Europe/Warsaw)</p><div className="grid gap-3 xl:grid-cols-2">{arrangementSchedule.map(([key, label]) => <ScheduleField key={key} name={key} label={label} value={draft.schedule[key]} onValidity={dateValidity} onChange={(slot) => changeDraft({ ...draft, schedule: { ...draft.schedule, [key]: slot } })}/>)}</div></div>
          <div className="max-w-sm"><SellerDatePicker label="Termin dostarczenia materiałów" value={draft.materials_due_date} onChange={(value) => changeDraft({ ...draft, materials_due_date: value })} onValidityChange={setMaterialsValid}/></div>
          <details className="rounded-lg bg-white/[0.035] p-3"><summary className="cursor-pointer text-sm text-[#d3bb73]">Dodatkowe wymagania techniczne i logistyczne{draft.technical_requirements || draft.logistics_requirements ? ' · uzupełnione' : ' · opcjonalnie'}</summary><div className="mt-3 space-y-3">
            <label className="block text-xs text-white/50">Wymagania techniczne<textarea value={draft.technical_requirements} maxLength={3000} rows={3} onChange={(event) => changeDraft({ ...draft, technical_requirements: event.target.value })} placeholder="Wymagania dotyczące tego wydarzenia, poza opisem wybranej sali" className={field}/></label>
            <label className="block text-xs text-white/50">Logistyka i wymagania organizacyjne<textarea value={draft.logistics_requirements} maxLength={3000} rows={3} onChange={(event) => changeDraft({ ...draft, logistics_requirements: event.target.value })} placeholder="Np. wjazd, rozładunek, parking, nocleg" className={field}/></label>
          </div></details>
          <div className="space-y-3"><h4 className="text-xs uppercase">Kontakty organizacyjne</h4><p className="text-xs text-white/45">Osoby po stronie hotelu, klienta lub organizatora. Dane widoczne także dla drugiej strony.</p>
            {hotel?.available && <SearchCombobox value="" ariaLabel="Dodaj kontakt z hotelu" placeholder="Wyszukaj kontakt hotelu — np. technik, recepcja, sprzedaż…"
              disabled={!hotelReady || !hotel.organization || draft.contacts.length >= 12}
              options={hotel.contacts.filter((person) => !draft.contacts.some((added) => added.name === person.name && added.email === person.email && added.phone === person.phone)).map((person) => ({ id: person.id, label: person.name, description: [person.role, person.phone, person.email].filter(Boolean).join(' · ') }))}
              emptyLabel="Brak kolejnych kontaktów — dodaj je w ustawieniach hotelu"
              onChange={(id) => {
                const person = hotel.contacts.find((contact) => contact.id === id);
                if (hotelReady && person && draft.contacts.length < 12 && !draft.contacts.some((added) => added.name === person.name && added.email === person.email && added.phone === person.phone))
                  changeDraft({ ...draft, contacts: [...draft.contacts, { name: person.name, role: person.role, email: person.email, phone: person.phone }] });
              }}/>} 
            {draft.contacts.map((person, index) => <ContactEditor key={index} person={person}>
              <div className="grid gap-3 sm:grid-cols-2">{([
                ['name', 'Imię i nazwisko', 160], ['role', 'Rola przy wydarzeniu', 100], ['email', 'E-mail', 254], ['phone', 'Telefon', 50],
              ] as const).map(([key, label, maxLength]) => <label key={key} className="text-xs text-white/50">{label}<input required={key === 'name'} type={key === 'email' ? 'email' : key === 'phone' ? 'tel' : 'text'} maxLength={maxLength} value={person[key]} onChange={(event) => changeDraft({ ...draft, contacts: draft.contacts.map((contact, position) => position === index ? { ...contact, [key]: event.target.value } : contact) })} className={field}/></label>)}</div>
              <button type="button" className="mt-3 inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs text-white/50 hover:bg-white/5 hover:text-rose-200" aria-label={`Usuń kontakt ${person.name || index + 1}`} onClick={() => changeDraft({ ...draft, contacts: draft.contacts.filter((_, position) => position !== index) })}><Trash2 className="h-3.5 w-3.5"/>Usuń kontakt z ustaleń</button>
            </ContactEditor>)}
            <button type="button" className={button} disabled={draft.contacts.length >= 12} onClick={() => changeDraft({ ...draft, contacts: [...draft.contacts, { name: '', role: '', email: '', phone: '' }] })}><Plus className="h-4 w-4"/>Inny kontakt — tylko do tej oferty</button>
          </div>
          <div className="flex flex-wrap items-center gap-3"><button type="submit" className={button} disabled={!dirty || invalid || saving || loading}>{saving ? <Loader2 className="h-4 w-4 animate-spin"/> : <Save className="h-4 w-4"/>}{saving ? 'Zapisywanie…' : 'Zapisz ustalenia'}</button>{dirty && <span className="text-xs text-amber-200">Masz niezapisane zmiany.</span>}</div>
        </fieldset>
      </form> : <div className="space-y-3">
        <p className="rounded-lg bg-white/[0.035] p-3 text-xs text-white/60">{crm ? 'Masz dostęp do podglądu. Edycja wymaga uprawnień do zarządzania ofertą tej marki.' : 'Ustalenia zaakceptowanej oferty są w trybie podglądu. Nie oznacza to jeszcze potwierdzenia wydarzenia. Aktualny status znajdziesz w sekcji akceptacji; zmiany uzgodnij na czacie.'}</p>
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div><dt className="text-xs text-white/45">Sala / przestrzeń</dt><dd>{data.values.room || 'Nie ustalono'}</dd></div>
          <div><dt className="text-xs text-white/45">Uczestnicy</dt><dd>{data.values.participant_count ?? 'Nie ustalono'}</dd></div>
          {arrangementSchedule.map(([key, label]) => <div key={key}><dt className="text-xs text-white/45">{label} · czas polski</dt><dd>{arrangementLocalDate(data.values[key])}</dd></div>)}
          <div><dt className="text-xs text-white/45">Materiały do</dt><dd>{arrangementLocalDate(data.values.materials_due_date)}</dd></div>
        </dl>
        {data.values.venue_snapshot && <details className="rounded-lg bg-white/[0.035] p-3"><summary className="cursor-pointer text-sm text-[#d3bb73]">Plany i zapisane informacje o przestrzeni</summary><div className="mt-3 space-y-3"><p className="whitespace-pre-wrap text-sm">{data.values.venue_snapshot.room.notes}</p><TechnicalDetailsView value={data.values.venue_snapshot.room.technical}/><TechnicalDetailsView value={data.values.venue_snapshot.technical_details}/></div></details>}
        <div><p className="text-xs text-white/45">Wymagania techniczne</p><p className="mt-1 whitespace-pre-wrap break-words text-sm">{data.values.technical_requirements || 'Nie ustalono'}</p></div>
        <div><p className="text-xs text-white/45">Logistyka</p><p className="mt-1 whitespace-pre-wrap break-words text-sm">{data.values.logistics_requirements || 'Nie ustalono'}</p></div>
        <h4 className="text-xs uppercase">Kontakty organizacyjne</h4>
        <div className="grid gap-3 sm:grid-cols-2">{data.values.contacts?.map((contact, index) => <ContactCard key={index} {...contact}/>)}</div>
        {!data.values.contacts?.length && <p className="text-xs text-white/40">Nie dodano jeszcze kontaktów organizacyjnych.</p>}
      </div>}
      <div className="space-y-3"><h4 className="text-xs uppercase">Klient i zespół realizacji</h4>
        <div className="grid gap-3 sm:grid-cols-2">
          <ContactCard name={data.client.name || data.client.company || 'Klient — dane do uzupełnienia'} role={data.client.company ? `Klient · ${data.client.company}` : 'Klient'} email={data.client.email} phone={data.client.phone}/>
          {data.team.map((person) => <ContactCard key={person.id} {...person}/>) }
        </div>
        <p className="text-xs leading-relaxed text-white/45">{data.team.length ? 'Pokazujemy opiekuna oraz osoby z potwierdzonym przydziałem do realizacji — wyłącznie służbowe dane kontaktowe.' : 'Opiekun lub zespół nie zostali jeszcze przypisani. Po przypisaniu w CRM pojawią się tutaj wraz ze służbowym kontaktem.'}</p>
      </div>
      <p className="text-xs text-white/40">{data.values.updated_at ? `Zapisana wersja ${data.values.revision} · ${new Date(data.values.updated_at).toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw' })}` : 'Nie zapisano jeszcze dodatkowych ustaleń.'}</p>
    </>}
  </div>;
}
