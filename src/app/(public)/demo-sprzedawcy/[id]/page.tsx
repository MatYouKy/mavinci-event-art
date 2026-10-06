import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getDemoBrochure, getDemoDefaultCover } from '@/lib/seller/demo.server';
import SellerDemoClient from './SellerDemoClient';
export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Wypróbuj strefę sprzedawcy', robots: { index: false, follow: false } };
export default async function SellerDemoPage({ params, searchParams }: { params: { id: string }; searchParams: { source?: string | string[] } }) {
  const brochure = await getDemoBrochure(params.id);
  if (!brochure) notFound();
  return <SellerDemoClient brochureId={params.id} source={typeof searchParams.source === 'string' ? searchParams.source.slice(0,2049) : ''} defaultCoverUrl={await getDemoDefaultCover()} />;
}
