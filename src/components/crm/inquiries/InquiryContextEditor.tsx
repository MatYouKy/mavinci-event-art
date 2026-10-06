'use client';

import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import LocationModal from '@/components/crm/locations/modal/LocationModal';
import { useLocations } from '@/app/(crm)/crm/locations/useLocations';
import type { ILocation } from '@/app/(crm)/crm/locations/type';
import { CalendarDays, Loader2, Plus } from 'lucide-react';

export type InquiryContextFields = {
  location_text: string;
  location_id: string;
  event_start_time: string;
  event_end_time: string;
  event_end_next_day: boolean;
  termin: string;
  scope: string;
  preliminary_budget_min: string;
  preliminary_budget_max: string;
};

function dateText(value: string) {
  if (!value) return '';
  const plain = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (plain) return `${plain[3]}.${plain[2]}.${plain[1]}`;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
function parseDate(value: string): string | null {
  if (!value.trim()) return '';
  const match = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(value.trim());
  if (!match) return null;
  const [, day, month, year] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  if (Number(year) < 1000 || date.getFullYear() !== Number(year) || date.getMonth() !== Number(month) - 1 || date.getDate() !== Number(day)) return null;
  return `${year}-${month}-${day}`;
}
function amount(value: string): string | null {
  if (!value.trim()) return '';
  const normalized = value.replace(/\s/g, '').replace(',', '.');
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized) || !Number.isFinite(Number(normalized))) return null;
  return normalized;
}

export default function InquiryContextEditor({ initial, disabled, onSave, onCancel }: {
  initial: InquiryContextFields;
  disabled: boolean;
  onSave: (context: InquiryContextFields) => Promise<boolean>;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  const { list: locations, loading: loadingLocations, error: locationError } = useLocations();
  const [showLocations, setShowLocations] = useState(false);
  const [addingLocation, setAddingLocation] = useState(false);
  const normalize = (value: string) => value.trim().toLocaleLowerCase('pl-PL');
  const locationLabel = (location: ILocation) => [location.name, location.city].filter(Boolean).join(', ');
  const matches = locations.filter(location => normalize([location.name, location.city, location.address].filter(Boolean).join(' ')).includes(normalize(draft.location_text)));
  const exactMatches = locations.filter(location => normalize(location.name) === normalize(draft.location_text) || normalize(locationLabel(location)) === normalize(draft.location_text));
  const selectLocation = (location: ILocation) => {
    setDraft(current => ({ ...current, location_id: location.id, location_text: locationLabel(location) }));
    setShowLocations(false);
  };
  const [date, setDate] = useState(() => dateText(initial.termin));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const lock = useRef(false);
  const parsedDate = parseDate(date);
  const input = 'mt-1 w-full rounded-lg border border-white/10 bg-black/15 px-3 py-2 text-sm text-white/85 focus:outline-none focus:border-white/20';
  const save = async () => {
    if (disabled || lock.current) return;
    if (parsedDate === null) { setError('Podaj prawidłowy termin w formacie DD.MM.RRRR.'); return; }
    const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;
    if ([draft.event_start_time, draft.event_end_time].some(time => time && !timePattern.test(time))) {
      setError('Podaj godziny w formacie GG:MM.'); return;
    }
    if (draft.event_start_time && draft.event_end_time && !draft.event_end_next_day && draft.event_end_time <= draft.event_start_time) {
      setError('Godzina zakończenia musi być późniejsza od rozpoczęcia. Dla wydarzenia przez północ zaznacz następny dzień.'); return;
    }
    const matchedLocation = !draft.location_id && !locationError && exactMatches.length === 1 ? exactMatches[0] : null;
    const min = amount(draft.preliminary_budget_min);
    const max = amount(draft.preliminary_budget_max);
    if (min === null || max === null || (min !== '' && max !== '' && Number(min) > Number(max))) {
      setError('Podaj poprawne kwoty. Budżet „od” nie może być większy od „do”.'); return;
    }
    setError(''); lock.current = true; setSaving(true);
    try {
      // Preserve an existing event time when only other context fields were edited.
      const termin = date.trim() === dateText(initial.termin) ? initial.termin : parsedDate;
      const saved = await onSave({ ...draft, location_id: draft.location_id || matchedLocation?.id || '', location_text: matchedLocation ? locationLabel(matchedLocation) : draft.location_text.trim(), event_end_next_day: Boolean(draft.event_end_time && draft.event_end_next_day), scope: draft.scope.trim(), termin,
        preliminary_budget_min: min, preliminary_budget_max: max });
      if (saved) onCancel();
    } catch { setError('Nie udało się zapisać kontekstu. Spróbuj ponownie.'); }
    finally { lock.current = false; setSaving(false); }
  };
  return <div className="mt-4 rounded-lg bg-white/5 p-3">
    <fieldset disabled={disabled || saving} className="space-y-3">
      <div onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setShowLocations(false); }}>
        <label htmlFor="inquiry-context-location" className="text-xs text-white/60">Miejsce</label>
        <input id="inquiry-context-location" type="search" autoComplete="off" value={draft.location_text}
          onFocus={() => setShowLocations(true)} onKeyDown={event => { if (event.key === 'Escape') setShowLocations(false); }}
          onChange={event => { setDraft({ ...draft, location_text: event.target.value, location_id: '' }); setShowLocations(true); }}
          maxLength={500} placeholder="Wyszukaj lokalizację lub wpisz nazwę" className={input} />
        {showLocations && <div className="mt-1 max-h-48 overflow-y-auto rounded-lg bg-black/20 p-1" aria-label="Pasujące lokalizacje">
          {loadingLocations ? <p className="p-2 text-xs text-white/50">Ładowanie lokalizacji…</p>
            : locationError ? <p className="p-2 text-xs text-amber-200">Nie udało się pobrać lokalizacji. Możesz zapisać samą nazwę.</p>
            : matches.length ? matches.slice(0, 30).map(location => <button key={location.id} type="button" onClick={() => selectLocation(location)} className="block w-full rounded-lg px-2 py-2 text-left text-sm text-white/80 hover:bg-white/5 focus:bg-white/5 focus:outline-none">
              {location.name}<span className="block text-xs text-white/45">{[location.city, location.address].filter(Boolean).join(', ')}</span>
            </button>) : <p className="p-2 text-xs text-white/50">Brak dopasowania. Nazwa zostanie zapisana przy zapytaniu.</p>}
        </div>}
        <p className="mt-1 text-xs text-white/45">{draft.location_id ? 'Powiązano z lokalizacją z bazy.' : !locationError && exactMatches.length === 1 ? 'Przy zapisie powiążemy z pasującą lokalizacją.' : exactMatches.length > 1 ? 'Kilka miejsc ma tę nazwę. Wybierz właściwą lokalizację lub zapisz sam tekst.' : 'Możesz również zapisać sam tekst bez dodawania do bazy.'}</p>
        <button type="button" onClick={() => { setShowLocations(false); setAddingLocation(true); }} className="mt-2 inline-flex items-center gap-1 text-xs text-[#d3bb73] hover:underline"><Plus className="h-3.5 w-3.5" />Dodaj lokalizację</button>
      </div>
      <div>
        <label htmlFor="inquiry-context-date" className="text-xs text-white/60">Termin</label>
        <div className="flex items-center gap-2">
          <input id="inquiry-context-date" value={date} onChange={e => setDate(e.target.value)} placeholder="DD.MM.RRRR" inputMode="numeric" maxLength={10} className={input} />
          <label className="relative mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/5 text-[#d3bb73]" title="Wybierz termin z kalendarza">
            <CalendarDays className="h-4 w-4" aria-hidden="true" />
            <input aria-label="Wybierz termin z kalendarza" type="date" onClick={e => e.currentTarget.showPicker?.()} value={parsedDate || ''} onChange={e => setDate(dateText(e.target.value))} className="absolute inset-0 h-full w-full cursor-pointer opacity-0" />
          </label>
        </div>
      </div>
      <div>
        <p className="text-xs text-white/60">Szacowane godziny wydarzenia</p>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs text-white/45">Od<input type="time" value={draft.event_start_time} onChange={event => setDraft({ ...draft, event_start_time: event.target.value })} className={input} /></label>
          <label className="text-xs text-white/45">Do<input type="time" value={draft.event_end_time} onChange={event => setDraft({ ...draft, event_end_time: event.target.value })} className={input} /></label>
        </div>
        <label className="mt-2 flex items-center gap-2 text-xs text-white/60"><input type="checkbox" checked={draft.event_end_next_day} onChange={event => setDraft({ ...draft, event_end_next_day: event.target.checked })} />Zakończenie następnego dnia</label>
      </div>
      <label className="block text-xs text-white/60">Zakres
        <textarea rows={4} value={draft.scope} onChange={e => setDraft({ ...draft, scope: e.target.value })} maxLength={10000} placeholder="Jakiej obsługi potrzebuje klient?" className={input} />
      </label>
      <div>
        <p className="text-xs text-white/60">Budżet / wartość (zł)</p>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs text-white/45">Od<input inputMode="decimal" value={draft.preliminary_budget_min} onChange={e => setDraft({ ...draft, preliminary_budget_min: e.target.value })} placeholder="Nie podano" className={input} /></label>
          <label className="text-xs text-white/45">Do<input inputMode="decimal" value={draft.preliminary_budget_max} onChange={e => setDraft({ ...draft, preliminary_budget_max: e.target.value })} placeholder="Nie podano" className={input} /></label>
        </div>
        <p className="mt-1 text-xs text-white/40">Dla jednej kwoty wystarczy wypełnić jedno pole.</p>
      </div>
      {error && <p role="alert" className="text-xs text-amber-200">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => void save()} className="inline-flex items-center gap-2 rounded-lg bg-[#d3bb73] px-3 py-2 text-sm text-[#1c1f33] disabled:opacity-50">{saving && <Loader2 className="h-4 w-4 animate-spin" />}Zapisz kontekst</button>
        <button type="button" onClick={onCancel} className="rounded-lg px-3 py-2 text-sm text-white/55">Anuluj</button>
      </div>
    </fieldset>
    {addingLocation && createPortal(<LocationModal open initialName={draft.location_text.trim()} onClose={() => setAddingLocation(false)} onLocationSaved={selectLocation} />, document.body)}
  </div>;
}
