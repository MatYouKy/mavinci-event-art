import type { MarketingIntegrationDTO } from '@/lib/marketing/types';

type TrafficTest = {
  name: string; startDate: string; endDate: string; budgetTotalPLN: number;
  baseline: { startDate: string; endDate: string; siteClicks: number; siteImpressions: number; homeClicks: number; homeImpressions: number };
};

export default function MarketingTrafficTest({ integrations }: { integrations: MarketingIntegrationDTO[] }) {
  const value = integrations.find((item) => item.provider === 'google')?.settings?.traffic_test;
  if (!value || typeof value !== 'object') return null;
  const test = value as TrafficTest;
  if (!test.baseline || typeof test.name !== 'string' || !Number.isFinite(test.budgetTotalPLN)) return null;
  const formatDate = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date) ? date.split('-').reverse().join('.') : '—';
  const number = (value: number) => new Intl.NumberFormat('pl-PL').format(Number(value) || 0);
  return <section className="rounded-xl bg-[#411326] p-5 text-[#e5e4e2]" aria-labelledby="traffic-test-heading">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h3 id="traffic-test-heading" className="text-base">{test.name}</h3><p className="mt-1 text-xs text-[#e5e4e2]/60">Planowany okres: {formatDate(test.startDate)}–{formatDate(test.endDate)}. Termin pierwszego wyświetlenia zależy od zatwierdzenia reklam.</p></div>
      <p className="text-sm text-[#d3bb73]">Budżet całkowity: {number(test.budgetTotalPLN)} zł</p>
    </div>
    <p className="mt-4 text-xs text-[#e5e4e2]/60">Punkt odniesienia przed testem: {formatDate(test.baseline.startDate)}–{formatDate(test.baseline.endDate)} · 28 dni · bezpłatne wyniki Google</p>
    <dl className="mt-3 grid grid-cols-2 gap-4 lg:grid-cols-4">
      {[['Kliknięcia — cała witryna', test.baseline.siteClicks], ['Wyświetlenia — cała witryna', test.baseline.siteImpressions], ['Kliknięcia — strona główna', test.baseline.homeClicks], ['Wyświetlenia — strona główna', test.baseline.homeImpressions]].map(([label, value]) => <div key={String(label)}><dt className="text-xs text-[#e5e4e2]/55">{label}</dt><dd className="mt-1 text-xl">{number(Number(value))}</dd></div>)}
    </dl>
    <p className="mt-4 text-xs leading-5 text-[#e5e4e2]/60">Kliknięcia z reklam porównuj osobno od organicznych. Bieżące karty obejmują 30 dni; punkt odniesienia obejmuje 28 dni, więc nie porównuj samych sum jako procentowej zmiany. Kliknięcie nie oznacza sesji ani zapytania. Równoczesne zmiany treści i reklamy nie pozwalają przypisać całego wzrostu jednemu działaniu.</p>
  </section>;
}
