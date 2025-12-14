import React from 'react';
import { getStatusBadgeProps } from '../../helpers/statusColors';

export const OfferDetails = ({ offer }: { offer: any }) => {
  const badge = getStatusBadgeProps(offer.status);

  return (
    <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
      <h2 className="mb-4 text-lg font-light text-[#e5e4e2]">Informacje</h2>

      {/* ✅ STATUS */}
      <div className="mb-4">
        <p className="mb-1 text-sm text-[#e5e4e2]/60">Status</p>

        <span
          className={`inline-flex items-center rounded-full border px-3 py-1 text-xs uppercase ${badge.bg} ${badge.text} ${badge.border} `}
        >
          {badge.label}
        </span>
      </div>

      {/* ✅ POZOSTAŁE INFO */}
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
