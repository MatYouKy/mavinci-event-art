'use client';

import { useState } from 'react';
import { Settings } from 'lucide-react';
import { PageMetadataModal } from '@/components/PageMetadataModal';

type Props = { isAdmin: boolean; pageSlug: string; cityName: string };

export default function CityConferenceAdminClient({ isAdmin, pageSlug, cityName }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  if (!isAdmin) return null;
  return <>
    <button type="button" onClick={() => setIsOpen(true)} className="fixed bottom-24 right-6 z-40 flex items-center gap-2 rounded-full bg-[#d3bb73] px-4 py-3 text-sm font-medium text-[#1c1f33] shadow-lg hover:bg-[#e3cd8c]">
      <Settings className="h-4 w-4" aria-hidden="true" /> Metadane SEO
    </button>
    {isOpen && <PageMetadataModal isOpen={isOpen} onClose={() => setIsOpen(false)} pageSlug={pageSlug} pageName={`Konferencje — ${cityName}`} />}
  </>;
}
