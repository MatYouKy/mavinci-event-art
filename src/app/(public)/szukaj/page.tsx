import type { Metadata } from 'next';
import { permanentRedirect } from 'next/navigation';
export const metadata: Metadata = { robots: { index: false, follow: true } };
/** Retire the old SearchAction URL; the catalogue now supports the same query. */
export default function LegacySearchPage({ searchParams }: { searchParams: { q?: string | string[] } }) {
  const raw = typeof searchParams.q === 'string' ? searchParams.q.trim().slice(0, 200) : '';
  const query = raw === '{search_term_string}' ? '' : raw;
  permanentRedirect(query ? `/uslugi?q=${encodeURIComponent(query)}` : '/uslugi');
}
