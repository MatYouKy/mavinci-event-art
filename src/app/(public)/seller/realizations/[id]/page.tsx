'use client';

import { useParams } from 'next/navigation';
import SellerRealizationWorkspace from '@/components/seller/SellerRealizationWorkspace';

export default function SellerRealizationPage() {
  const { id } = useParams<{ id: string }>();
  return <SellerRealizationWorkspace key={id} offerId={id}/>;
}
