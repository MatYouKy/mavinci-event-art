'use client';
import type { IProductVariant } from '../../types';
export function VariantPricesEditor({ variants, prices, onChange, disabled }: {
  variants: IProductVariant[]; prices: Record<string, number>;
  onChange: (id: string, price: number) => void; disabled?: boolean;
}) {
  return <div className="mt-4 space-y-2 rounded-lg bg-white/5 p-3">
    <h3 className="text-sm font-medium text-[#e5e4e2]">Ceny wariantów w tej ofercie</h3>
    <p className="text-xs text-[#e5e4e2]/50">Kwoty netto za sztukę, przed rabatem. Ceny katalogowe pozostają bez zmian.</p>
    {variants.map(variant => <label key={variant.id} className="flex items-center justify-between gap-3 text-sm text-[#e5e4e2]">
      <span>{variant.name}</span>
      <input type="number" min="0" max="999999999.99" step="0.01" disabled={disabled}
        aria-label={`${variant.name} — cena netto w ofercie`}
        value={Number.isFinite(prices[variant.id] ?? variant.price_net) ? (prices[variant.id] ?? variant.price_net) : ''}
        onChange={e => onChange(variant.id, e.target.value === '' ? NaN : Number(e.target.value))}
        className="w-36 rounded-lg border border-white/10 bg-[#111421] px-3 py-2" />
    </label>)}
  </div>;
}
