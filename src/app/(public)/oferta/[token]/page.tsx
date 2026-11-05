import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import SharedOfferView from '@/components/seller/public/SharedOfferView';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Oferta wydarzenia',
  referrer: 'no-referrer',
  robots: { index: false, follow: false, nocache: true, nosnippet: true, googleBot: { index: false, follow: false, nosnippet: true } },
};

// Share tokens are random hex strings; anything else keeps the regular 404 of /oferta/*.
const TOKEN_PATTERN = /^[a-f0-9]{24,64}$/i;

export default function SharedSellerOfferPage({ params }: { params: { token: string } }) {
  if (!TOKEN_PATTERN.test(params.token)) notFound();
  return <SharedOfferView token={params.token} />;
}
