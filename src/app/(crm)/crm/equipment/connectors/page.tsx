'use client';

import { useState } from 'react';
import { ArrowLeft, Plug } from 'lucide-react';
import { useRouter } from 'next/navigation';
import ConnectorsView from '@/components/crm/ConnectorsView';

export default function ConnectorsPage() {
  const router = useRouter();
  const [viewMode, setViewMode] = useState<'grid' | 'list' | 'compact'>('grid');

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push('/crm/equipment')}
            className="rounded-lg p-2 text-[#e5e4e2]/60 transition-colors hover:bg-[#d3bb73]/10 hover:text-[#e5e4e2]"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="flex items-center gap-2">
            <Plug className="h-6 w-6 text-[#d3bb73]" />
            <h1 className="text-2xl font-light text-[#e5e4e2]">Wtyki / Connectors</h1>
          </div>
        </div>

        <div className="flex items-center gap-1 rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] p-1">
          <button
            onClick={() => setViewMode('grid')}
            className={`rounded-md px-3 py-1.5 text-xs transition-colors ${
              viewMode === 'grid'
                ? 'bg-[#d3bb73]/20 text-[#d3bb73]'
                : 'text-[#e5e4e2]/60 hover:text-[#e5e4e2]'
            }`}
          >
            Siatka
          </button>
          <button
            onClick={() => setViewMode('list')}
            className={`rounded-md px-3 py-1.5 text-xs transition-colors ${
              viewMode === 'list'
                ? 'bg-[#d3bb73]/20 text-[#d3bb73]'
                : 'text-[#e5e4e2]/60 hover:text-[#e5e4e2]'
            }`}
          >
            Lista
          </button>
          <button
            onClick={() => setViewMode('compact')}
            className={`rounded-md px-3 py-1.5 text-xs transition-colors ${
              viewMode === 'compact'
                ? 'bg-[#d3bb73]/20 text-[#d3bb73]'
                : 'text-[#e5e4e2]/60 hover:text-[#e5e4e2]'
            }`}
          >
            Kompakt
          </button>
        </div>
      </div>

      <ConnectorsView viewMode={viewMode} />
    </div>
  );
}
