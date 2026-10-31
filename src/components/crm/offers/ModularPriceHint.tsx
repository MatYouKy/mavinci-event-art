'use client';

import { calculateModular, type ProductConfigurationSnapshot } from '@/lib/CRM/Offers/modularProduct';

export default function ModularPriceHint({ value, manual, disabled, onReset }: {
  value: ProductConfigurationSnapshot; manual: boolean; disabled?: boolean; onReset: () => void;
}) {
  const calculation = calculateModular(value);
  return <div className="space-y-2 text-xs text-[#e5e4e2]/65">
    <p>{calculation.error ? 'Uzupełnij kalkulator, aby wyświetlić cenę sugerowaną.' : `Cena z kalkulatora: ${calculation.total.toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} zł netto / zestaw / dzień.`}</p>
    <p>{manual ? 'Własna cena bazowa. Zmiana składników nie nadpisze Twojej stawki. Rabat naliczymy od niej.' : 'Możesz wpisać własną cenę bazową netto za dzień w polu poniżej. Rabat naliczymy od wpisanej stawki.'}</p>
    {manual && <button type="button" disabled={disabled || Boolean(calculation.error)} onClick={onReset} className="rounded-lg bg-white/5 px-3 py-2 text-[#d3bb73] hover:bg-white/10 disabled:opacity-50">Użyj ceny z kalkulatora</button>}
  </div>;
}
