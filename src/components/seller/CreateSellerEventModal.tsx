'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { CalendarDays, Loader2, X } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import SearchCombobox, { type SearchComboboxOption } from '@/components/crm/SearchCombobox';
import { useLocations } from '@/app/(crm)/crm/locations/useLocations';
import SellerDatePicker from '@/app/(public)/seller/_components/SellerDatePicker';
import { arrangementSchedule, type ArrangementScheduleKey, type SellerArrangements } from '@/lib/seller/arrangements';

type Slot = { date: string; time: string };
type EventDraft = {
  event_id: string | null; source_key: string; revision: number; brand_name: string; offer_number: string;
  name: string; location: string; description: string;
  client: SellerArrangements['client']; arrangements: SellerArrangements['values'];
  items: { id: string; name: string; quantity: number; unit?: string }[];
} & Partial<Record<ArrangementScheduleKey, string | null>>;
const field = 'mt-1.5 min-h-11 w-full rounded-lg border border-white/10 bg-[#0f1119] px-3 py-2.5 text-sm text-[#e5e4e2] outline-none focus:border-[#d3bb73]/30';
const button = 'inline-flex items-center justify-center gap-2 rounded-lg bg-[#d3bb73]/10 px-4 py-2.5 text-sm text-[#d3bb73] hover:bg-[#d3bb73]/20 disabled:opacity-40';

function Schedule({ name, label, value, onChange, onValidity }: {
  name: ArrangementScheduleKey; label: string; value: Slot; onChange: (slot: Slot) => void;
  onValidity: (key: ArrangementScheduleKey, valid: boolean) => void;
}) {
  const validity = useCallback((valid: boolean) => onValidity(name, valid), [name, onValidity]);
  return <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_7rem] gap-2">
    <SellerDatePicker label={label} value={value.date} onChange={(date) => onChange({ ...value, date })} onValidityChange={validity}/>
    <label className="text-xs text-white/50">Godzina<input type="time" aria-label={`${label} — godzina`} value={value.time} onChange={(event) => onChange({ ...value, time: event.target.value })} className={field}/></label>
  </div>;
}

export default function CreateSellerEventModal({ offerId, api, onClose, onCreated }: {
  offerId: string; api: (payload: Record<string, unknown>) => Promise<any>;
  onClose: () => void; onCreated: (eventId: string) => void;
}) {
  const [draft, setDraft] = useState<EventDraft | null>(null);
  const [name, setName] = useState('');
  const [location, setLocation] = useState('');
  const [locationId, setLocationId] = useState('');
  const { list: locations, loading: locationsLoading, error: locationsError } = useLocations();
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [categories, setCategories] = useState<SearchComboboxOption[]>([]);
  const [categoryError, setCategoryError] = useState('');
  const [schedule, setSchedule] = useState<Record<ArrangementScheduleKey, Slot>>({
    setup_at: { date: '', time: '' }, starts_at: { date: '', time: '' },
    ends_at: { date: '', time: '' }, teardown_at: { date: '', time: '' },
  });
  const [invalidDates, setInvalidDates] = useState<Partial<Record<ArrangementScheduleKey, boolean>>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState('');
  const lock = useRef(false);
  const panel = useRef<HTMLDivElement>(null);
  const dateValidity = useCallback((key: ArrangementScheduleKey, valid: boolean) => {
    setInvalidDates((current) => current[key] === !valid ? current : { ...current, [key]: !valid });
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const next = await api({ action: 'event_draft' }) as EventDraft;
        if (!active) return;
        setDraft(next); setName(next.name || ''); setLocation(next.location || ''); setLocationId(''); setDescription(next.description || '');
        const slot = (key: ArrangementScheduleKey): Slot => ({ date: next[key]?.slice(0, 10) || '', time: next[key]?.slice(11, 16) || '' });
        setSchedule({ setup_at: slot('setup_at'), starts_at: slot('starts_at'), ends_at: slot('ends_at'), teardown_at: slot('teardown_at') });
      } catch (cause: any) { if (active) setError(cause?.message || 'Nie udało się wczytać danych wydarzenia.'); }
      finally { if (active) setLoading(false); }
    })();
    void supabase.from('event_categories').select('id,name').eq('is_active', true).order('name').then(({ data, error: loadError }) => {
      if (!active) return;
      if (loadError) setCategoryError('Nie udało się wczytać kategorii. Możesz ją uzupełnić później w wydarzeniu.');
      else setCategories((data || []).map((item) => ({ id: item.id, label: item.name })));
    });
    return () => { active = false; };
  }, [api, offerId]);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden'; panel.current?.focus();
    return () => { document.body.style.overflow = overflow; previous?.focus(); };
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!draft || lock.current) return;
    setError('');
    if (!confirmed) { setError('Zaznacz osobne potwierdzenie realizacji po sprawdzeniu danych wydarzenia.'); return; }
    if (Object.values(invalidDates).some(Boolean)) { setError('Popraw daty zaznaczone w formularzu.'); return; }
    const values: Record<string, unknown> = { name: name.trim(), location: location.trim(), location_id: locationId || null, description, category_id: category || null };
    for (const [key, label] of arrangementSchedule) {
      const slot = schedule[key];
      if (Boolean(slot.date) !== Boolean(slot.time)) { setError(`${label}: uzupełnij datę oraz godzinę albo pozostaw oba pola puste.`); return; }
      values[key] = slot.date ? `${slot.date}T${slot.time}` : null;
    }
    if (!values.name || !values.starts_at) { setError('Uzupełnij nazwę oraz datę i godzinę rozpoczęcia wydarzenia.'); return; }
    lock.current = true; setSaving(true);
    try {
      const result = await api({ action: 'create_event', sourceKey: draft.source_key, revision: draft.revision, values, confirm: true });
      if (!result?.event_id) throw new Error('Nie otrzymano potwierdzenia utworzenia wydarzenia. Odśwież status przed ponowieniem.');
      onCreated(result.event_id);
    } catch (cause: any) { setError(cause?.message || 'Nie udało się zapisać wydarzenia. Formularz pozostaje otwarty.'); }
    finally { lock.current = false; setSaving(false); }
  };

  if (typeof document === 'undefined') return null;
  return createPortal(<div className="fixed inset-0 z-[9100] flex items-center justify-center bg-black/75 p-3 sm:p-6">
    <div ref={panel} role="dialog" aria-modal="true" aria-labelledby="seller-event-title" tabIndex={-1}
      className="max-h-[90dvh] w-full max-w-3xl overflow-y-auto rounded-xl bg-[#1c1f33] text-[#e5e4e2] shadow-2xl outline-none"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !lock.current) { event.preventDefault(); onClose(); }
        if (event.key === 'Tab') {
          const nodes = Array.from(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),a[href],select:not(:disabled)') || []).filter((node) => node.getClientRects().length > 0);
          const first = nodes[0], last = nodes[nodes.length - 1];
          if (!first) { event.preventDefault(); return; }
          if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { event.preventDefault(); last?.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        }
      }}>
      <header className="flex items-start justify-between gap-4 p-5 sm:p-6">
        <div><h2 id="seller-event-title" className="flex items-center gap-2 text-lg uppercase"><CalendarDays className="h-5 w-5 text-[#d3bb73]"/>Potwierdź realizację i utwórz wydarzenie</h2><p className="mt-2 text-xs text-white/50">Drugi, osobny krok po akceptacji oferty. Sprawdź dane sprzedawcy. Zamknięcie formularza pozostawi realizację oczekującą na potwierdzenie CRM.</p></div>
        <button type="button" aria-label="Zamknij formularz" disabled={saving} className="rounded-lg p-2 hover:bg-white/5 disabled:opacity-40" onClick={onClose}><X className="h-5 w-5"/></button>
      </header>
      {loading && <p role="status" className="flex items-center gap-2 p-6"><Loader2 className="h-4 w-4 animate-spin"/>Wczytywanie danych sprzedawcy…</p>}
      {error && <p role="alert" className="mx-6 mb-4 rounded-lg bg-rose-300/10 p-3 text-sm text-rose-200">{error}</p>}
      {draft?.event_id ? <div className="space-y-4 p-6"><p>Wydarzenie zostało już utworzone. Nie dodamy go drugi raz.</p><Link href={`/crm/events/${draft.event_id}`} className={button}>Przejdź do wydarzenia</Link></div> : draft && <form onSubmit={submit} className="px-5 pb-6 sm:px-6">
        <fieldset disabled={saving} className="min-w-0 space-y-5">
          <div className="rounded-lg bg-white/[0.035] p-4 text-sm"><p>{draft.brand_name} · {draft.offer_number}</p><p className="mt-1 text-amber-200">Oferta zaakceptowana. Realizacja oczekuje na Twoje potwierdzenie poniżej.</p></div>
          <label className="block text-xs text-white/60">Nazwa wydarzenia *<input required maxLength={250} value={name} onChange={(event) => setName(event.target.value)} className={field}/></label>
          <div className="grid gap-4 sm:grid-cols-2">{arrangementSchedule.map(([key, label]) => <Schedule key={key} name={key} label={label + (key === 'starts_at' ? ' *' : '')} value={schedule[key]} onChange={(value) => setSchedule((current) => ({ ...current, [key]: value }))} onValidity={dateValidity}/>)}</div>
          <p className="text-xs text-white/45">Godziny w strefie Europe/Warsaw. Brakujących godzin nie uzupełniamy automatycznie.</p>
          <div>
            <p className="mb-1.5 text-xs text-white/60">Miejsce wydarzenia</p>
            <SearchCombobox ariaLabel="Miejsce wydarzenia" disabled={saving}
              value={locationId || (location ? 'seller-location' : '')}
              options={[
                ...(draft.location ? [{ id: 'seller-location', label: draft.location, description: 'Miejsce podane przez sprzedawcę — bez powiązania z bazą' }] : []),
                ...locations.map((item) => ({ id: item.id, label: item.name,
                  description: [item.address, item.city, item.postal_code].filter(Boolean).join(', ') || item.formatted_address,
                  keywords: item.formatted_address })),
              ]}
              onChange={(id) => {
                const selected = locations.find((item) => item.id === id);
                setLocationId(selected?.id || '');
                setLocation(selected ? [selected.name, selected.address, selected.city, selected.postal_code].filter(Boolean).join(', ')
                  : id === 'seller-location' ? draft.location : '');
              }}
              placeholder="Wyszukaj obiekt, miasto lub adres…"
              emptyLabel={locationsLoading ? 'Wczytywanie lokalizacji…' : locationsError ? 'Nie udało się wczytać lokalizacji' : 'Brak pasujących lokalizacji w bazie'}
            />
            {locationsError && <p role="alert" className="mt-2 text-xs text-amber-200">Nie udało się pobrać bazy lokalizacji. Miejsce podane przez sprzedawcę pozostaje dostępne.</p>}
            {locationId && <p className="mt-2 text-xs text-white/45">Wydarzenie zostanie powiązane z wybranym obiektem w bazie CRM.</p>}
          </div>
          <div><p className="mb-1.5 text-xs text-white/60">Kategoria (opcjonalnie)</p><SearchCombobox ariaLabel="Kategoria wydarzenia" value={category} options={categories} onChange={setCategory} placeholder="Wyszukaj kategorię…" disabled={saving}/>{categoryError && <p className="mt-2 text-xs text-amber-200">{categoryError}</p>}</div>
          <section className="space-y-2 rounded-lg bg-white/[0.035] p-4 text-sm">
            <h3 className="text-sm uppercase">Klient i kontakty z oferty</h3>
            <p>{[draft.client.company, draft.client.name, draft.client.email, draft.client.phone].filter(Boolean).join(' · ') || 'Nie podano danych klienta'}</p>
            {draft.arrangements.contacts?.map((contact, index) => <p key={index} className="break-words text-xs text-white/60">{[contact.name, contact.role, contact.email, contact.phone].filter(Boolean).join(' · ')}</p>)}
            <p className="text-xs text-white/45">Zachowamy te dane w opisie i powiązanych ustaleniach. Powiązanie z kartoteką klienta i sposób rozliczenia uzupełnisz w wydarzeniu — bez automatycznego zakładania duplikatów kontaktów.</p>
          </section>
          <section className="space-y-2 rounded-lg bg-white/[0.035] p-4 text-sm">
            <h3 className="text-sm uppercase">Zakres z zaakceptowanej oferty</h3>
            {draft.items.map((item) => <p key={item.id}>{item.name} · {item.quantity} {item.unit || 'szt.'}</p>)}
            {draft.arrangements.room && <p className="text-xs text-white/60">Sala: {draft.arrangements.room}</p>}
            {draft.arrangements.technical_requirements && <p className="whitespace-pre-wrap text-xs text-white/60">Wymagania: {draft.arrangements.technical_requirements}</p>}
            {draft.arrangements.logistics_requirements && <p className="whitespace-pre-wrap text-xs text-white/60">Logistyka: {draft.arrangements.logistics_requirements}</p>}
            <p className="text-xs text-white/45">Oferta, PDF i historia rozmowy pozostaną powiązane z wydarzeniem. Konkretne rezerwacje sprzętu oraz skład zespołu uzupełnisz w realizacji.</p>
          </section>
          <label className="block text-xs text-white/60">Opis wydarzenia<textarea rows={4} maxLength={10000} value={description} onChange={(event) => setDescription(event.target.value)} className={field}/></label>
          <label className="flex items-start gap-3 rounded-lg bg-[#d3bb73]/10 p-4 text-sm"><input type="checkbox" required checked={confirmed} onChange={(event)=>setConfirmed(event.target.checked)} className="mt-1"/><span>Potwierdzam realizację po sprawdzeniu terminu, zasobów i ustaleń. Utworzę potwierdzone wydarzenie w CRM, a sprzedawca otrzyma osobne powiadomienie.</span></label>
          <div className="flex flex-wrap justify-end gap-3"><button type="button" onClick={onClose} className={button}>Dokończę później</button><button type="submit" disabled={!confirmed} className={button}>{saving && <Loader2 className="h-4 w-4 animate-spin"/>}{saving ? 'Potwierdzanie i zapisywanie…' : 'Potwierdź realizację i utwórz wydarzenie'}</button></div>
        </fieldset>
      </form>}
    </div>
  </div>, document.body);
}
