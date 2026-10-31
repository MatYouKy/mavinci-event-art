import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getUserPermissions } from '@/lib/serverAuth';
import { getAgencyData } from '@/lib/SEO/eventAgencyData.server';
import AgencyPage, { agencyMetadata } from './AgencyPage';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export async function generateMetadata(): Promise<Metadata> {
  const data = await getAgencyData();
  if (!data) return { title: 'MAVINCI — agencja eventowa', robots: { index: false } };
  return agencyMetadata(data);
}
export default async function Page() {
  const [data, { hasWebsiteEdit }] = await Promise.all([getAgencyData(), getUserPermissions()]);
  if (!data) notFound();
  return <AgencyPage data={data} canEdit={hasWebsiteEdit} />;
}
