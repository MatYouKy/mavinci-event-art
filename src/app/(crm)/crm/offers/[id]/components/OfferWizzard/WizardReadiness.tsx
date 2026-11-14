'use client';

import { AlertTriangle } from 'lucide-react';
import { productReadiness, type ProductReadiness } from '@/lib/CRM/Offers/productReadiness';
import { ReadinessDots, readinessSummary } from '@/components/crm/offers/ProductReadiness';
import type { IOfferItem } from '@/app/(crm)/crm/offers/types';

/**
 * Gotowość produktu do oferty w kreatorze — ta sama reguła co katalog i karta produktu (`productReadiness`), ze sprzętem
 * i obsadą z katalogu kreatora. Niegotowy produkt można dodać, ale kreator ostrzega o brakach (tak samo w aplikacji na Maca).
 */
export function wizardReadiness(product: any): ProductReadiness | null {
  if (!product) return null;
  return productReadiness(
    product,
    Array.isArray(product.equipment) ? { equipmentCount: product.equipment.length, staff: Array.isArray(product.staff) ? product.staff : [] } : null,
  );
}

/** Kropki gotowości i opis: w katalogu zawsze, przy dodanej pozycji (`onlyMissing`) — tylko braki. */
export function WizardReadinessLine({ product, onlyMissing = false, className = '' }: { product: any; onlyMissing?: boolean; className?: string }) {
  const readiness = wizardReadiness(product);
  if (!readiness || (onlyMissing && readiness.ready)) return null;
  const summary = readinessSummary(readiness);
  const label = onlyMissing ? `Niegotowy do oferty — ${summary.toLowerCase()}` : summary;
  return (
    <p className={`flex min-w-0 items-center gap-2 text-xs ${readiness.ready ? 'text-emerald-300/80' : 'text-amber-200/80'} ${className}`}>
      <ReadinessDots readiness={readiness} />
      <span className="truncate" title={label}>{label}</span>
    </p>
  );
}

/** Podsumowanie kreatora: produkty niegotowe do oferty wśród pozycji. */
export function NotReadyProductsNotice({ items }: { items: IOfferItem[] }) {
  const rows = items
    .map((item) => ({ item, product: (item as any).product, readiness: wizardReadiness((item as any).product) }))
    .filter((row): row is { item: IOfferItem; product: any; readiness: ProductReadiness } => Boolean(row.readiness && !row.readiness.ready));
  if (!rows.length) return null;
  return (
    <div role="status" className="rounded-lg border border-amber-400/30 bg-amber-400/10 p-4 text-sm">
      <div className="flex items-center gap-2 font-medium text-amber-200">
        <AlertTriangle className="h-4 w-4" />
        Produkty niegotowe do oferty ({rows.length})
      </div>
      <p className="mt-1 text-xs text-[#e5e4e2]/60">
        Brakujące dane mogą dać niepełny PDF, zaniżone koszty i marżę albo umowę bez klauzul. Ofertę możesz utworzyć, ale przed wysłaniem uzupełnij produkty w katalogu.
      </p>
      <ul className="mt-2 space-y-1">
        {rows.map(({ item, product, readiness }) => (
          <li key={item.id} className="flex items-center gap-2 text-xs text-[#e5e4e2]/80">
            <ReadinessDots readiness={readiness} />
            <span>{product?.name || item.name} — {readinessSummary(readiness)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
