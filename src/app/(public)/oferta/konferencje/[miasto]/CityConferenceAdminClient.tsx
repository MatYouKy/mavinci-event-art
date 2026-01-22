'use client';

import { useState } from 'react';
import { Settings } from 'lucide-react';
import CityPageSEOModal from '@/components/CityPageSEOModal';

type Props = {
  isAdmin: boolean;
  cityLocality: string;
  cityName: string;
  defaultTitle: string;
  defaultDescription: string;
};

export default function CityConferenceAdminClient({
  isAdmin,
  cityLocality,
  cityName,
  defaultTitle,
  defaultDescription,
}: Props) {
  const [isSEOModalOpen, setIsSEOModalOpen] = useState(false);

  if (!isAdmin) return null;

  return (
    <>
      <button
        onClick={() => setIsSEOModalOpen(true)}
        className="fixed bottom-24 right-6 z-40 flex items-center gap-2 rounded-full bg-[#d3bb73] px-4 py-3 text-sm font-medium text-[#1c1f33] shadow-lg transition-all hover:scale-105 hover:bg-[#d3bb73]/90"
      >
        <Settings className="h-4 w-4" />
        Metadane SEO
      </button>

      <CityPageSEOModal
        isOpen={isSEOModalOpen}
        onClose={() => setIsSEOModalOpen(false)}
        pageType="konferencje"
        citySlug={cityLocality}
        cityName={cityName}
        defaultTitle={defaultTitle}
        defaultDescription={defaultDescription}
      />
    </>
  );
}