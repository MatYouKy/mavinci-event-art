import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getUserPermissions } from '@/lib/serverAuth';
import { getAgencyData } from '@/lib/SEO/eventAgencyData.server';
import AgencyPage, { agencyMetadata } from '../AgencyPage';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
type Props = { params: { miasto: string } };
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const data = await getAgencyData(params.miasto);
  if (!data) return { title: 'Nie znaleziono strony | MAVINCI', robots: { index: false, follow: true } };
  return agencyMetadata(data);
}
export default async function Page({ params }: Props) {
  const [data, { hasWebsiteEdit }] = await Promise.all([getAgencyData(params.miasto), getUserPermissions()]);
  if (!data) notFound();
  return <AgencyPage data={data} canEdit={hasWebsiteEdit} />;
}
