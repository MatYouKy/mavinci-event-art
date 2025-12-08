import React from 'react';
import { statusColors, statusLabels } from '../page';

export const OfferDetails = ({ offer }: { offer: any }) => {
  return (
    <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
      <h2 className="mb-4 text-lg font-light text-[#e5e4e2]">Informacje</h2>
      <div
          className={`py-2 text-sm ${statusColors[offer.status] || 'bg-gray-500/20 text-gray-400'}`}
        >
          <p className="text-[#e5e4e2]/60">Status</p>
          <p className="text-[#e5e4e2]">{statusLabels[offer.status]}</p>
        </div>
      <div className="space-y-3 text-sm">
        <div>
          <p className="text-[#e5e4e2]/60">Utworzona</p>
          <p className="text-[#e5e4e2]">{new Date(offer.created_at).toLocaleString('pl-PL')}</p>
        </div>
        <div>
          <p className="text-[#e5e4e2]/60">Ostatnia aktualizacja</p>
          <p className="text-[#e5e4e2]">{new Date(offer.updated_at).toLocaleString('pl-PL')}</p>
        </div>
        <div>
          <p className="text-[#e5e4e2]/60">Wygasa</p>
          <p className="text-[#e5e4e2]">{new Date(offer.valid_until).toLocaleString('pl-PL')}</p>
        </div>
        
      </div>
    </div>
  );
};
