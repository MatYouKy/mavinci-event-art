import { notFound } from 'next/navigation';
import InquiryWorkspaceClient from './InquiryWorkspaceClient';
import { fetchInquiryWorkspaceServer } from '@/lib/CRM/inquiries/inquiryWorkspace.server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function InquiryWorkspacePage({ params }: { params: { id: string } }) {
  const data = await fetchInquiryWorkspaceServer(params.id);
  if (!data) notFound();
  return <InquiryWorkspaceClient initialData={data as any} />;
}
