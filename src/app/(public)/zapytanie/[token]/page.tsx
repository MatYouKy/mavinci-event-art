import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import PublicInquiryForm from '@/components/seller/public/PublicInquiryForm';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Zapytanie o wydarzenie',
  referrer: 'no-referrer',
  robots: { index: false, follow: false, nocache: true, nosnippet: true, googleBot: { index: false, follow: false, nosnippet: true } },
};

const TOKEN_PATTERN = /^[a-f0-9]{24,64}$/i;

export default function PublicSellerInquiryPage({ params }: { params: { token: string } }) {
  if (!TOKEN_PATTERN.test(params.token)) notFound();
  return <PublicInquiryForm token={params.token} />;
}
