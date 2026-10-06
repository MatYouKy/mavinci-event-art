'use client';

import { useId, useMemo } from 'react';
import { Info } from 'lucide-react';
import Popover from '@/components/UI/Tooltip';
import { ContractDateField } from '@/components/crm/invoices/ContractTermFields';
import { personnelInput as input } from '@/lib/personnel/workspace';
import { compareNetCosts, type NetCostScenario } from '@/lib/personnel/netCostComparison';
import { estimateNetCost, netBasisLabels, type NetCostContext, type NetCostEstimate, type NetCostSettings } from '@/lib/personnel/netCostEstimate';

const money = (amount: number) => new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN' }).format(amount);
function ComparisonContent({ scenarios, settings }: { scenarios: NetCostScenario[]; settings: NetCostSettings }) {
  const reference = scenarios.find(s => s.result.breakdown)?.result;
  return <section className="space-y-3">
    <p className="font-medium text-sm">Porównanie wariantów{reference ? ` dla ${money(reference.target)} netto` : ''}</p>
    {!reference ? <p>{scenarios[0]?.result.issue || 'Wpisz kwotę netto.'}</p> : <>
      <p className="opacity-70">Przykładowe sytuacje, niezależne od danych osoby w formularzu. Nie każdy wariant będzie dostępny dla tej osoby.</p>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead><tr className="text-[11px] opacity-65"><th scope="col" className="pb-2 pr-3 font-normal">Wariant</th><th scope="col" className="pb-2 pr-3 text-right font-normal">Wydatek firmy</th><th scope="col" className="pb-2 text-right font-normal">Po możliwym efekcie CIT {settings.cit_rate}%</th></tr></thead>
          <tbody>{scenarios.map(s => <tr key={s.id} className="align-top odd:bg-white/[0.035]">
            <th scope="row" className="p-2 pl-0 font-normal"><span className="font-medium">{s.label}</span><span className="mt-1 block text-[11px] leading-4 opacity-60">{s.assumption}</span>{s.result.breakdown && <span className="mt-1 block text-[11px] leading-4 opacity-70">Brutto {money(s.result.breakdown.gross)} · PIT {money(s.result.breakdown.pit)} · Składki osoby {money(s.result.breakdown.social + s.result.breakdown.health)} · Składki firmy {money(s.result.breakdown.employer)}</span>}</th>
            {s.result.breakdown ? <><td className="whitespace-nowrap p-2 text-right font-medium text-[#d3bb73]">{money(s.result.breakdown.company)}</td><td className="whitespace-nowrap py-2 pl-2 text-right">{money(s.result.afterCit)}</td></> : <td colSpan={2} className="p-2 opacity-60">{s.result.issue}</td>}
          </tr>)}</tbody>
        </table>
      </div>
      <p className="opacity-65">PIT {settings.pit_rate}%, pomniejszenie PIT-2 {settings.pit_credit} zł, KUP etatu {settings.employment_kup} zł. Warianty z ulgą zakładają dostępny cały limit 85 528 zł. Składki firmy według przyjętych założeń kalkulacji. Każdy wiersz zakłada osobne rozliczenie poza własnym pracodawcą, bez PPK i ryczałtu do 200 zł.</p>
      <p className="opacity-65">Efekt CIT jest warunkowy: koszt podatkowy, dochód firmy i uprawnienie do stawki {settings.cit_rate}%. Etat wymaga właściwego wymiaru i płacy minimalnej; kwota w porównaniu jest wyłącznie symulacją wypłaty. Sam KRUS nie zwalnia ze składek zlecenia.</p>
      <div className="space-y-1 rounded-lg bg-white/[0.04] p-3">
        <p className="font-medium">Oddzielnie: prywatne środki z dywidendy</p>
        <p>Netto dla wspólnika: <strong>{money(reference.target)}</strong></p>
        <p>CIT {settings.cit_rate}%: {money(reference.dividendCit)} · Podatek od dywidendy 19%: {money(reference.dividendTax)}</p>
        <p>Potrzebny zysk przed CIT: <strong className="text-[#d3bb73]">{money(reference.dividendProfit)}</strong></p>
        <p className="opacity-65">To źródło prywatnych środków wspólnika, nie rozliczenie wynagrodzenia pracownika. Wypłata pracownikowi gotówką nadal podlega zasadom jego umowy.</p>
      </div>
    </>}
  </section>;
}

function CostContent({ result, settings, scenarios }: { result: NetCostEstimate; settings: NetCostSettings; scenarios: NetCostScenario[] }) {
  const b = result.breakdown;
  const row = (label: string, amount: number, emphasis = false) => <div className={`flex justify-between gap-5 ${emphasis ? 'font-semibold text-[#d3bb73]' : ''}`}><span>{label}</span><span className="shrink-0 tabular-nums">{money(amount)}</span></div>;
  return <div className="max-h-[65vh] space-y-3 overflow-y-auto text-xs leading-5">
    <ComparisonContent scenarios={scenarios} settings={settings} />
    <p className="pt-3 font-medium text-sm">Według danych osoby w formularzu</p>
    {result.issue ? <p>{result.issue}</p> : b && <>
      <p className="opacity-70">{result.insuranceLabel}. Wypłata: {settings.payment_date.split('-').reverse().join('.')}.</p>
      <div className="space-y-1">
        {row('Dla osoby — netto', b.net)}
        {row('Składki społeczne osoby', b.social)}
        {row('Składka zdrowotna', b.health)}
        {row('PIT', b.pit)}
        {row('Wynagrodzenie brutto', b.gross)}
      </div>
      <div className="space-y-1 rounded-lg bg-white/[0.04] p-3">
        {row('Emerytalna firmy', b.employerPension)}
        {row('Rentowa firmy', b.employerDisability)}
        {row('Wypadkowa', b.accident)}
        {row('FP i FS', b.labourFund)}
        {row('FGŚP', b.fgsp)}
        {row('Łączny wydatek firmy', b.company, true)}
      </div>
      {b.net !== result.target && <p className="opacity-65">Kwota po zaokrągleniach różni się od planu o {money(b.net - result.target)}.</p>}
      {b.youth > 0 && <p className="opacity-65">Przychód objęty ulgą dla młodych: {money(b.youth)}.</p>}
      <div className="space-y-1">
        {row(`Możliwe zmniejszenie CIT (${settings.cit_rate}%)`, result.citBenefit)}
        {row('Koszt po możliwym efekcie CIT', result.afterCit, true)}
        <p className="opacity-65">Warunkowo: cały koszt jest podatkowy, firma ma dochód do opodatkowania i prawo do wskazanej stawki klasycznego CIT. To nie zmniejsza przelewu ani bieżącej wypłaty. CIT {settings.cit_rate}% jest założeniem, nie potwierdzeniem statusu spółki.</p>
      </div>
      <p className="opacity-65">{result.notes.join(' ')}</p>
    </>}
    <p className="opacity-60">Symulacja do planowania według zasad na 2026 r. Ostateczne zobowiązania zapisuj z rozliczenia płacowego.</p>
  </div>;
}

export function PersonnelNetCostInfo({ amount, settings, context }: { amount: number; settings: NetCostSettings; context: NetCostContext }) {
  const result = useMemo(() => estimateNetCost(amount, settings, context), [amount, settings, context]);
  const scenarios = useMemo(() => compareNetCosts(amount, settings, context.currency), [amount, settings, context.currency]);
  return <Popover openOn="auto" maxWidth={640} ariaLabel="Porównanie kosztów różnych form rozliczenia" className="!border-white/10" triggerClassName="inline-flex rounded-full text-[#d3bb73] focus-visible:outline focus-visible:outline-1 focus-visible:outline-white/30" trigger={<Info className="h-4 w-4" aria-hidden="true" />} content={<CostContent result={result} settings={settings} scenarios={scenarios} />} />;
}

export function PersonnelNetCostFields({ amount, onAmountChange, settings, onSettingsChange, context, paymentMethod, guided = false }: {
  amount: string; onAmountChange: (value: string) => void;
  settings: NetCostSettings; onSettingsChange: (value: NetCostSettings) => void;
  context: NetCostContext; paymentMethod: string; guided?: boolean;
}) {
  const id = useId();
  const set = <K extends keyof NetCostSettings>(key: K, value: NetCostSettings[K]) => onSettingsChange({ ...settings, [key]: value });
  const unit = settings.basis === 'hourly' || settings.basis === 'piecework';
  const result = useMemo(() => estimateNetCost(Number(amount), settings, context), [amount, settings, context]);
  return <section className="space-y-3 rounded-lg bg-white/[0.035] p-4 sm:col-span-2">
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="text-xs">
        <div className="flex items-center gap-2"><label htmlFor={id}>{paymentMethod === 'cash' ? 'Planowane netto do ręki' : 'Planowane netto na konto'}</label><PersonnelNetCostInfo amount={Number(amount)} settings={settings} context={context} /></div>
        <input id={id} className={input} type="number" min="0.01" max="1000000" step="0.01" value={amount} onChange={e => onAmountChange(e.target.value)} placeholder="Np. 5000,00" />
      </div>
      <label className="text-xs">Kwota netto dotyczy<select className={input} value={settings.basis} onChange={e => set('basis', e.target.value as NetCostSettings['basis'])}>{Object.entries(netBasisLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      {unit && <label className="text-xs sm:col-span-2">{settings.basis === 'hourly' ? 'Planowana liczba godzin w miesiącu wypłaty' : 'Planowana liczba jednostek akordu w miesiącu wypłaty'}<input className={input} type="number" min="0.01" step="0.01" value={settings.quantity} onChange={e => set('quantity', e.target.value)} /></label>}
    </div>
    {amount && <p className="text-xs leading-5" aria-live="polite">{result.issue ? <>Dla tej osoby: {result.issue} Porównanie przykładowych wariantów znajdziesz pod ikoną „i”.</> : (result.breakdown && <>Netto w tej kalkulacji: <strong>{money(result.target)}</strong> · Łączny koszt firmy: <strong className="text-[#d3bb73]">około {money(result.breakdown.company)}</strong>. Rozbicie i porównanie wariantów pod ikoną „i”.</>)}</p>}
    <p className="text-xs leading-5 opacity-60">Do porównania pod „i” wystarczy kwota; przy godzinach i akordzie także liczba jednostek. Plan obejmuje jeden miesiąc lub jedną pełną wypłatę za realizację. Przy dłuższej umowie przeliczaj każdy miesiąc osobno. Po zapisaniu umowy możesz przenieść plan do stawki wynagrodzenia.</p>
    {!guided && <details className="space-y-3">
      <summary className="cursor-pointer text-xs text-[#d3bb73]">Założenia kalkulacji PIT, ZUS i CIT</summary>
      <div className="grid gap-3 sm:grid-cols-2">
        <ContractDateField label="Planowana data wypłaty" value={settings.payment_date} onChange={v => set('payment_date', v)} />
        <label className="text-xs">Klasyczny CIT — założenie<select className={input} value={settings.cit_rate} onChange={e => set('cit_rate', e.target.value as NetCostSettings['cit_rate'])}><option value="9">9% — uprawnienie do potwierdzenia</option><option value="19">19%</option></select></label>
        <ContractDateField label="Praca objęta kalkulacją od" value={settings.work_from} onChange={v => set('work_from', v)} />
        <ContractDateField label="Praca objęta kalkulacją do" value={settings.work_to} onChange={v => set('work_to', v)} />
        {context.kind === 'mandate' && <>
          <label className="text-xs sm:col-span-2">Ubezpieczenie zlecenia<select className={input} value={settings.insurance} onChange={e => set('insurance', e.target.value as NetCostSettings['insurance'])}><option value="auto">Z danych osoby; domyślnie pełne ZUS</option><option value="social_health">Założenie: społeczne i zdrowotna</option><option value="health_only">Potwierdzony inny tytuł — tylko zdrowotna</option></select></label>
          <label className="flex items-center gap-2 text-xs sm:col-span-2"><input type="checkbox" checked={settings.sickness} onChange={e => set('sickness', e.target.checked)} />Dobrowolne chorobowe zleceniobiorcy (2,45%)</label>
        </>}
        <label className="text-xs">PIT od całej podstawy<select className={input} value={settings.pit_rate} onChange={e => set('pit_rate', e.target.value as NetCostSettings['pit_rate'])}><option value="12">12%</option><option value="32">32%</option></select></label>
        <label className="text-xs">Pomniejszenie PIT-2 w tym miesiącu<select className={input} value={settings.pit_credit} onChange={e => set('pit_credit', e.target.value as NetCostSettings['pit_credit'])}><option value="0">Bez pomniejszenia</option><option value="100">100 zł</option><option value="150">150 zł</option><option value="300">300 zł</option></select></label>
        {context.kind === 'employment' && <label className="text-xs">Miesięczne koszty uzyskania przychodu<select className={input} value={settings.employment_kup} onChange={e => set('employment_kup', e.target.value as NetCostSettings['employment_kup'])}><option value="250">250 zł — podstawowe</option><option value="300">300 zł — dojazd, spełnione warunki</option><option value="0">0 zł — bez kosztów</option></select></label>}
        {context.kind !== 'specific_work' && <label className="text-xs">Pozostały wspólny limit ulgi dla młodych<input className={input} type="number" min="0" max="85528" step="0.01" placeholder="Wymagany przy stosowaniu ulgi" value={settings.youth_remaining} onChange={e => set('youth_remaining', e.target.value)} /></label>}
        {context.kind !== 'employment' && <label className="flex items-start gap-2 text-xs leading-5 sm:col-span-2"><input className="mt-1" type="checkbox" checked={settings.small_contract} onChange={e => set('small_contract', e.target.checked)} />Ryczałt PIT 12%: należność określona w całej umowie do 200 zł brutto, umowa z osobą niebędącą pracownikiem płatnika.</label>}
        <label className="text-xs">Wypadkowa firmy (%)<input className={input} type="number" min="0.67" max="3.33" step="0.01" value={settings.accident_rate} onChange={e => set('accident_rate', e.target.value)} /></label>
        <label className="text-xs">Fundusz Pracy i Solidarnościowy<select className={input} value={settings.labour_fund} onChange={e => set('labour_fund', e.target.value as NetCostSettings['labour_fund'])}><option value="auto">Automatycznie od progu pełnego miesiąca</option><option value="yes">Naliczaj — 2,45%</option><option value="no">Nie naliczaj — zwolnienie</option></select></label>
        <label className="flex items-center gap-2 text-xs sm:col-span-2"><input type="checkbox" checked={settings.fgsp} onChange={e => set('fgsp', e.target.checked)} />Naliczaj FGŚP 0,10%, jeśli umowa podlega składkom społecznym</label>
      </div>
      <p className="text-xs leading-5 opacity-65">Składki i ulga zależą również od sekcji „Dane do PIT i ZUS”. Limit ulgi uwzględnij u wszystkich płatników. Dla 12%/32% przyjęto jedną stawkę w całej wypłacie, standardowe KUP i brak PPK. Umowa ustna oraz gotówka stosują reguły wybranej podstawy prawnej.</p>
      <p className="text-xs leading-5 opacity-65">Dywidenda: 19% dla polskiego wspólnika będącego osobą fizyczną, klasyczny CIT. Model nie obejmuje estońskiego CIT. Stawki CIT nie można potwierdzić samym NIP.</p>
      <p className="text-xs opacity-60"><a className="underline" href="https://www.podatki.gov.pl/ulgi-i-odliczenia/ulga-dla-mlodych-pit" target="_blank" rel="noreferrer">Ulga dla młodych — MF</a> · <a className="underline" href="https://www.zus.pl/en/-/umowy-cywilnoprawne-w-ubezpieczeniach-spolecznych" target="_blank" rel="noreferrer">Ubezpieczenie umów — ZUS</a> · <a className="underline" href="https://www.podatki.gov.pl/podatki-firmowe/cit/cit-klasyczny/stawki-i-limity" target="_blank" rel="noreferrer">CIT — MF</a></p>
    </details>}
    {guided && <p className="text-xs leading-5 opacity-65">Składki i PIT wynikają z odpowiedzi w kreatorze. Porównanie pod ikoną „i” przedstawia przykładowe sytuacje; nie zmienia danych tej osoby. Efekt CIT {settings.cit_rate}% pozostaje założeniem do potwierdzenia dla firmy.</p>}
  </section>;
}
