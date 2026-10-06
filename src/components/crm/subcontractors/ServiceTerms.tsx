'use client';
export type ServiceTermsValue = {
  included_hours?: number | null;
  overtime_hourly_rate?: number | null;
  travel_rate_per_km?: number | null;
  performance_requirements?: string | null;
};
export const emptyServiceTerms: ServiceTermsValue = {
  included_hours: null,
  overtime_hourly_rate: null,
  travel_rate_per_km: null,
  performance_requirements: '',
};
export function validateServiceTerms(value: ServiceTermsValue) {
  for (const key of ['included_hours', 'overtime_hourly_rate', 'travel_rate_per_km'] as const) {
    const amount = value[key];
    if (amount != null && (!Number.isFinite(Number(amount)) || Number(amount) < 0))
      throw new Error('Czas i stawki muszą być liczbami nieujemnymi.');
  }
}
export default function ServiceTerms({
  value,
  onChange,
  rateHint,
}: {
  rateHint?: string;
  value: ServiceTermsValue;
  onChange?: (value: ServiceTermsValue) => void;
}) {
  const fields = [
    ['included_hours', 'Czas w cenie (h)'],
    ['overtime_hourly_rate', 'Przedłużenie (zł/h)'],
    ['travel_rate_per_km', 'Dojazd (zł/km)'],
  ] as const;
  return (
    <div className="space-y-3 rounded-xl bg-white/5 p-4">
      <div className="grid gap-3 sm:grid-cols-3">
        {fields.map(([key, label]) => (
          <label key={key} className="text-sm">
            {label}
            {onChange ? (
              <input
                type="number"
                min="0"
                step="0.01"
                value={value[key] ?? ''}
                placeholder="Do ustalenia"
                onChange={(e) =>
                  onChange({
                    ...value,
                    [key]: e.target.value === '' ? null : Number(e.target.value),
                  })
                }
                className="mt-1 w-full rounded-lg border border-white/10 bg-[#250914] px-3 py-2"
              />
            ) : (
              <div className="mt-1 text-[#d3bb73]">
                {value[key] == null ? 'Do ustalenia' : Number(value[key]).toLocaleString('pl-PL')}
              </div>
            )}
          </label>
        ))}
      </div>
      <p className="text-xs opacity-60">
        {rateHint || 'Stawki dodatkowe: netto przy fakturze; kwota wypłaty przy rozliczeniu gotówkowym. Dojazd za faktycznie rozliczane kilometry — zasady powrotu i minimum wpisz w warunkach.'}
      </p>
      <label className="block text-sm">
        Warunki realizacji i dojazdu
        {onChange ? (
          <textarea
            value={value.performance_requirements || ''}
            onChange={(e) => onChange({ ...value, performance_requirements: e.target.value })}
            placeholder="Np. stanowisko DJ, nagłośnienie, zasilanie, czas przygotowania, dojazd w obie strony…"
            className="mt-1 w-full rounded-lg border border-white/10 bg-[#250914] px-3 py-2"
            rows={3}
          />
        ) : (
          <p className="mt-1 whitespace-pre-wrap">
            {value.performance_requirements || 'Nie określono'}
          </p>
        )}
      </label>
    </div>
  );
}
