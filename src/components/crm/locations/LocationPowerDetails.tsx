'use client';

import { useDialog } from '@/contexts/DialogContext';

export type PowerConnection400 = {
  id: string;
  quantity?: number;
  rating_a?: 16 | 32 | 63 | 'other';
  connector?: string;
  position: string;
  distance_to_stage_m?: number;
  notes?: string;
};

export type LocationPowerDetails = {
  power_supply?: 'available' | 'unavailable';
  power_230v?: boolean;
  power_230v_notes?: string;
  power_400v?: boolean;
  power_400v_points?: PowerConnection400[];
  power_kw?: number;
  power_notes?: string;
};

const inputClass = 'mt-1 w-full rounded-lg border border-white/10 bg-[#250914] px-3 py-2 text-sm text-[#e5e4e2]';
const MAX_POINTS = 20;
const powerLabels = { available: 'Zasilanie dostępne', unavailable: 'Brak zasilania' } as const;
const sockets = [
  { key: 'power_230v', label: 'Gniazda 230 V' },
  { key: 'power_400v', label: 'Przyłącza 400 V (siła)' },
] as const;

export function hasLocationPowerDetails(value?: LocationPowerDetails) {
  return Boolean(value && (value.power_supply || value.power_notes || value.power_230v_notes ||
    value.power_400v_points?.length || value.power_kw != null || value.power_230v != null || value.power_400v != null));
}

export function LocationPowerDetailsView({ value }: { value?: LocationPowerDetails }) {
  if (!value || !hasLocationPowerDetails(value)) return null;
  const points = value.power_400v_points || [];
  return <section className="space-y-4 rounded-lg bg-white/[0.035] p-3 text-sm">
    <h3 className="font-medium uppercase text-[#d3bb73]">Prąd i przyłącza</h3>
    <p className="text-white/85">{value.power_supply ? powerLabels[value.power_supply] : 'Dostęp do zasilania niepotwierdzony'}</p>
    {value.power_supply !== 'unavailable' && <>
      <dl className="grid gap-2 sm:grid-cols-2">
        {sockets.map(({ key, label }) => <div key={key}>
          <dt className="text-xs text-white/50">{label}</dt>
          <dd className="text-white/75">{value[key] == null ? 'Do potwierdzenia' : value[key] ? 'Dostępne' : 'Brak'}</dd>
        </div>)}
        {value.power_kw != null && <div><dt className="text-xs text-white/50">Dostępna moc łącznie</dt><dd className="text-white/75">{value.power_kw.toLocaleString('pl-PL')} kW</dd></div>}
      </dl>
      {(value.power_230v === true || value.power_230v_notes) && <div>
        <h4 className="text-xs uppercase text-[#d3bb73]">230 V — rozmieszczenie, fazy i obwody</h4>
        <p className="mt-2 whitespace-pre-wrap break-words text-white/75">
          {value.power_230v_notes || 'Nie uzupełniono jeszcze opisu rozmieszczenia gniazd, faz i obwodów.'}
        </p>
      </div>}
      {(value.power_400v === true || points.length > 0) && <div className="space-y-3">
        <h4 className="text-xs uppercase text-[#d3bb73]">400 V — konkretne przyłącza</h4>
        {!points.length && <p className="text-white/55">Nie opisano jeszcze liczby, rodzaju i położenia przyłączy. Sama dostępność 400 V nie potwierdza możliwości wykorzystania przy scenie.</p>}
        {points.map((point, index) => <article key={point.id} className="space-y-3 rounded-lg bg-black/15 p-3">
          <p className="font-medium text-white/85">Punkt / grupa przyłączy {index + 1}</p>
          <dl className="grid gap-3 sm:grid-cols-2">
            <div><dt className="text-xs text-white/50">Liczba gniazd</dt><dd>{point.quantity != null ? `${point.quantity.toLocaleString('pl-PL')} szt.` : 'Do potwierdzenia'}</dd></div>
            <div><dt className="text-xs text-white/50">Prąd znamionowy złącza</dt><dd>{point.rating_a === 'other' ? 'Inny — patrz opis złącza' : point.rating_a ? `${point.rating_a} A` : 'Do potwierdzenia'}</dd></div>
            <div><dt className="text-xs text-white/50">Rodzaj złącza / liczba pinów</dt><dd className="whitespace-pre-wrap break-words">{point.connector || 'Do potwierdzenia'}</dd></div>
            <div><dt className="text-xs text-white/50">Odległość od typowego ustawienia sceny</dt><dd>{point.distance_to_stage_m != null ? `${point.distance_to_stage_m.toLocaleString('pl-PL')} m` : 'Do potwierdzenia'}</dd></div>
            <div className="sm:col-span-2"><dt className="text-xs text-white/50">Miejsce</dt><dd className="whitespace-pre-wrap break-words">{point.position}</dd></div>
          </dl>
          {point.notes && <div><p className="text-xs text-white/50">Przydatność przy scenie i ograniczenia</p><p className="mt-1 whitespace-pre-wrap break-words text-white/75">{point.notes}</p></div>}
        </article>)}
      </div>}
    </>}
    {value.power_notes && <div><h4 className="text-xs uppercase text-[#d3bb73]">Pozostałe szczegóły zasilania</h4><p className="mt-2 whitespace-pre-wrap break-words text-white/75">{value.power_notes}</p></div>}
  </section>;
}

export function LocationPowerDetailsFields({ value, onChange }: {
  value: LocationPowerDetails;
  onChange: (patch: Partial<LocationPowerDetails>) => void;
}) {
  const { showConfirm } = useDialog();
  const points = value.power_400v_points || [];
  const updatePoint = (id: string, patch: Partial<PowerConnection400>) => onChange({
    power_400v_points: points.map((point) => point.id === id ? { ...point, ...patch } : point),
  });
  const changeSupply = async (power_supply: LocationPowerDetails['power_supply']) => {
    if (power_supply === 'unavailable' && (points.length || value.power_230v_notes?.trim())) {
      const confirmed = await showConfirm({
        title: 'Oznaczyć brak zasilania?',
        message: 'Ta zmiana usunie z formularza szczegółowy opis 230 V oraz listę przyłączy 400 V. Pozostałe uwagi zostaną zachowane. Zmiana trafi do bazy dopiero po zapisaniu formularza.',
        confirmText: 'Oznacz brak zasilania',
      });
      if (!confirmed) return;
    }
    onChange({ power_supply, ...(power_supply === 'unavailable' ? {
      power_230v: undefined, power_400v: undefined, power_kw: undefined,
      power_230v_notes: undefined, power_400v_points: [],
    } : {}) });
  };
  const changeSocket = async (key: 'power_230v' | 'power_400v', available: boolean | undefined) => {
    if (key === 'power_400v' && available === false && points.length) {
      const confirmed = await showConfirm({
        title: 'Usunąć opisane przyłącza 400 V?',
        message: 'Oznaczenie „Brak” usunie z formularza listę przyłączy 400 V. Zmiana trafi do bazy dopiero po zapisaniu formularza.',
        confirmText: 'Usuń listę i oznacz brak',
      });
      if (!confirmed) return;
    }
    onChange({ [key]: available, ...(key === 'power_400v' && available === false ? { power_400v_points: [] } : {}) });
  };
  return <section className="space-y-4 rounded-lg bg-black/10 p-3">
    <h3 className="text-sm uppercase text-[#d3bb73]">Prąd i przyłącza</h3>
    <label className="block text-sm">Dostęp do zasilania
      <select className={inputClass} value={value.power_supply || ''}
        onChange={(event) => void changeSupply((event.target.value || undefined) as LocationPowerDetails['power_supply'])}>
        <option value="">Do potwierdzenia</option><option value="available">Zasilanie dostępne</option><option value="unavailable">Brak zasilania</option>
      </select>
    </label>
    {value.power_supply !== 'unavailable' && <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {sockets.map(({ key, label }) => <label key={key} className="block text-sm">{label}
          <select className={inputClass} value={value[key] == null ? '' : value[key] ? 'yes' : 'no'}
            onChange={(event) => void changeSocket(key, event.target.value === '' ? undefined : event.target.value === 'yes')}>
            <option value="">Do potwierdzenia</option><option value="yes">Dostępne</option><option value="no">Brak</option>
          </select>
        </label>)}
        <label className="block text-sm">Dostępna moc łącznie (kW)
          <input type="number" min={0.01} max={100000} step={0.01} value={value.power_kw ?? ''} placeholder="Do potwierdzenia" className={inputClass}
            onChange={(event) => onChange({ power_kw: event.target.value === '' ? undefined : event.target.valueAsNumber })}/>
        </label>
      </div>
      {(value.power_230v === true || value.power_230v_notes) && <label className="block text-sm">
        230 V — liczba gniazd, rozmieszczenie, fazy i obwody
        <textarea rows={4} maxLength={4000} className={inputClass} value={value.power_230v_notes || ''}
          onChange={(event) => onChange({ power_230v_notes: event.target.value })}
          placeholder="Opisz np. gniazda przy typowym miejscu sceny, które są na różnych fazach lub osobnych obwodach, gniazda po obu stronach sali, ich rozstaw oraz współdzielenie z urządzeniami hotelu."/>
        <span className="mt-1 block text-xs text-white/50">Podaj konkretne miejsca. Informacje o fazach i obwodach wpisuj osobno, zgodnie z danymi obsługi technicznej.</span>
      </label>}
      {(value.power_400v === true || points.length > 0) && <div className="space-y-3">
        <h4 className="text-sm uppercase text-[#d3bb73]">400 V — lista przyłączy</h4>
        <p className="text-xs leading-5 text-white/55">Każdy typ i miejsce dodaj osobno. Identyczne gniazda w tym samym miejscu możesz połączyć w grupę. Nieznane parametry pozostaw do potwierdzenia.</p>
        {points.map((point, index) => <fieldset key={point.id} className="space-y-3 rounded-lg bg-white/[0.035] p-3">
          <legend className="px-1 text-sm text-white/80">Punkt / grupa przyłączy {index + 1}</legend>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <label className="block text-sm">Liczba gniazd (szt.)
              <input type="number" min={1} max={1000} step={1} className={inputClass} value={point.quantity ?? ''} placeholder="Do potwierdzenia"
                onChange={(event) => updatePoint(point.id, { quantity: event.target.value === '' ? undefined : event.target.valueAsNumber })}/>
            </label>
            <label className="block text-sm">Prąd znamionowy złącza
              <select className={inputClass} value={point.rating_a ?? ''} onChange={(event) => updatePoint(point.id, {
                rating_a: event.target.value === '' ? undefined : event.target.value === 'other' ? 'other' : Number(event.target.value) as 16 | 32 | 63,
              })}>
                <option value="">Do potwierdzenia</option><option value="16">16 A</option><option value="32">32 A</option><option value="63">63 A</option><option value="other">Inny — opisz złącze</option>
              </select>
            </label>
            <label className="block text-sm">Rodzaj złącza / liczba pinów{point.rating_a === 'other' ? ' *' : ''}
              <input className={inputClass} maxLength={200} required={point.rating_a === 'other'} value={point.connector || ''}
                onChange={(event) => updatePoint(point.id, { connector: event.target.value })}
                placeholder={point.rating_a === 'other' ? 'Podaj amperaż i rodzaj złącza' : 'Np. CEE, 5-pin — do potwierdzenia'}/>
            </label>
            <label className="block text-sm sm:col-span-2">Miejsce przyłącza *
              <textarea required rows={2} maxLength={1000} className={inputClass} value={point.position}
                onChange={(event) => updatePoint(point.id, { position: event.target.value })}
                placeholder="Np. przeciwległa ściana względem typowego miejsca sceny, przy drzwiach technicznych"/>
            </label>
            <label className="block text-sm">Odległość od typowego ustawienia sceny (m)
              <input type="number" min={0} max={10000} step={0.1} className={inputClass} value={point.distance_to_stage_m ?? ''} placeholder="Do potwierdzenia"
                onChange={(event) => updatePoint(point.id, { distance_to_stage_m: event.target.value === '' ? undefined : event.target.valueAsNumber })}/>
            </label>
          </div>
          <label className="block text-sm">Przydatność przy scenie i ograniczenia
            <textarea rows={2} maxLength={2000} className={inputClass} value={point.notes || ''}
              onChange={(event) => updatePoint(point.id, { notes: event.target.value })}
              placeholder="Np. daleko od zwyczajowego ustawienia sceny, utrudniona trasa przewodów, dostęp po uzgodnieniu z technikiem"/>
          </label>
          <button type="button" className="text-sm text-red-300" aria-label={`Usuń punkt przyłącza ${index + 1}`}
            onClick={() => onChange({ power_400v_points: points.filter((item) => item.id !== point.id) })}>Usuń ten punkt</button>
        </fieldset>)}
        {!points.length && <p className="text-sm text-white/55">Nie opisano jeszcze żadnego przyłącza 400 V.</p>}
        <button type="button" disabled={points.length >= MAX_POINTS} className="rounded-lg bg-white/5 px-3 py-2 text-sm text-[#d3bb73] hover:bg-white/10 disabled:opacity-40"
          onClick={() => onChange({ power_400v_points: [...points, { id: crypto.randomUUID(), position: '' }] })}>+ Dodaj punkt / grupę przyłączy 400 V</button>
        <p className="text-xs text-white/45">Do {MAX_POINTS} punktów lub grup przyłączy.</p>
      </div>}
    </>}
    <label className="block text-sm">Pozostałe szczegóły zasilania
      <textarea rows={3} maxLength={4000} className={inputClass} value={value.power_notes || ''}
        onChange={(event) => onChange({ power_notes: event.target.value })}
        placeholder="Wspólne ograniczenia zasilania, dostęp do rozdzielni, kontakt do technika i dodatkowe ustalenia"/>
    </label>
    <p className="text-xs text-white/50">Parametry wpisz po potwierdzeniu przez obsługę techniczną obiektu. Nie przeliczamy liczby gniazd ani amperażu złączy na dostępną moc.</p>
  </section>;
}
