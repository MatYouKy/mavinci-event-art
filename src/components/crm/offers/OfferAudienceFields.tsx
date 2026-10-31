'use client';

export type AudienceFields = { guest_count: string; guests_per_table: string; table_count: string };

export default function OfferAudienceFields({ value, onChange, needsTables = false, required = false, showGuestCount = true }: {
  value: AudienceFields;
  onChange: (value: AudienceFields) => void;
  needsTables?: boolean;
  required?: boolean;
  showGuestCount?: boolean;
}) {
  const fields: [keyof AudienceFields, string][] = showGuestCount ? [['guest_count', required ? 'Liczba osób — wymagana do wyceny' : 'Liczba osób — opcjonalnie']] : [];
  if (needsTables) fields.push(['guests_per_table', 'Średnio osób przy okrągłym stole'], ['table_count', 'Liczba stołów — opcjonalnie']);
  const guests = Number(value.guest_count);
  const capacity = Number(value.guests_per_table);
  const tables = value.table_count || (guests > 0 && capacity > 0 ? Math.ceil(guests / capacity) : null);
  return <div className="space-y-3 rounded-lg bg-black/10 p-3">
    <div className={`grid gap-3 ${needsTables ? showGuestCount ? 'sm:grid-cols-3' : 'sm:grid-cols-2' : ''}`}>
      {fields.map(([key, label]) => <label key={key} className="text-xs text-white/65">{label}
        <input type="number" min={1} max={key === 'guests_per_table' ? 100 : 100000} step={1}
          value={value[key]} onChange={e => onChange({ ...value, [key]: e.target.value })}
          placeholder={key === 'table_count' ? 'Oblicz automatycznie' : key === 'guest_count' ? 'Nie ustalono' : '10'}
          className="mt-1 w-full rounded-lg border border-white/10 bg-black/15 p-2 text-sm" />
      </label>)}
    </div>
    {showGuestCount && <p className="text-xs text-white/55">Liczba osób jest wymagana przy pozycjach rozliczanych na osobę lub stół i pakietach korzystających z kalkulatora. Zmiana przelicza powiązane pozycje, zachowując rabaty.</p>}
    {needsTables && <p className="text-xs text-white/55">{tables ? `Do wyceny: ${tables} stołów. ` : ''}Liczbę stołów zaokrąglamy w górę. Możesz wpisać rzeczywistą liczbę zamiast wyliczonej.</p>}
  </div>;
}
