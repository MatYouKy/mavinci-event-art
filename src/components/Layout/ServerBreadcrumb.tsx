import 'server-only';
import Link from 'next/link';
import { ChevronRight, Home } from 'lucide-react';
import { buildBreadcrumbList } from '@/lib/SEO/breadcrumbs';

type Props = { pageSlug: string; labels?: Record<string, string> };

/** Uses the same labels and URLs as PageLayout's JSON-LD; does not emit a second schema. */
export function ServerBreadcrumb({ pageSlug, labels }: Props) {
  const { itemListElement } = buildBreadcrumbList(`/${pageSlug}`, labels);
  return <nav aria-label="Ścieżka nawigacji" data-brand-breadcrumb="true" className="mb-4">
    <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm leading-6 text-white/80">
      {itemListElement.map((item, index) => <li key={item.item} className="inline-flex min-w-0 items-center gap-2">
        {index > 0 && <ChevronRight className="h-3.5 w-3.5 shrink-0 text-white/40" aria-hidden="true" />}
        {index === itemListElement.length - 1
          ? <span aria-current="page" className="break-words font-medium text-[#d3bb73]">{item.name}</span>
          : <Link href={item.item} className="inline-flex min-h-11 items-center gap-1.5 hover:text-[#d3bb73]">
            {index === 0 && <Home className="h-4 w-4 shrink-0" aria-hidden="true" />}
            <span className={index === 0 ? 'sr-only sm:not-sr-only' : undefined}>{item.name}</span>
          </Link>}
      </li>)}
    </ol>
  </nav>;
}
