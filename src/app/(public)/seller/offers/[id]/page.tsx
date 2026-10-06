'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useParams } from 'next/navigation';
import { ArrowLeft, Edit3, MessageSquare } from 'lucide-react';
import SellerOfferWorkflow from '@/components/seller/SellerOfferWorkflow';

export default function SellerOfferPreviewPage() {
  const params=useParams<{id:string}>();
  const [confirmed,setConfirmed]=useState<boolean | null>(null);
  return (
    <div className="min-h-screen p-4 text-[#e5e4e2] md:p-6">
      <div className="mx-auto max-w-6xl space-y-4">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <Link href={confirmed ? '/seller/realizations' : '/seller/offers'} className="flex items-center gap-2 text-sm text-white/60"><ArrowLeft className="h-4 w-4"/>{confirmed ? 'Moje realizacje' : 'Moje oferty'}</Link>
          {confirmed === false && <Link href={`/seller/offers/new?offer=${params.id}`} className="flex items-center gap-2 rounded-lg bg-[#d3bb73]/10 px-3 py-2 text-sm text-[#d3bb73]"><Edit3 className="h-4 w-4"/>Edytuj ofertę</Link>}
        </header>
        <SellerOfferWorkflow key={params.id} offerId={params.id} onRealizationChange={setConfirmed}>
          <Link href={`/seller/messages?offer=${params.id}`} className="inline-flex items-center gap-2 rounded-lg bg-[#d3bb73]/10 px-4 py-3 text-sm text-[#d3bb73]"><MessageSquare className="h-4 w-4" />{confirmed ? 'Porozmawiaj z opiekunem o realizacji' : 'Porozmawiaj z opiekunem o tej ofercie'}</Link>
        </SellerOfferWorkflow>
      </div>
    </div>
  );
}
