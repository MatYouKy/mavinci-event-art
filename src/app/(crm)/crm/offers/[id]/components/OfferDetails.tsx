import React from 'react';
import { getOfferStatusBadgeProps } from '../../helpers/statusColors';
import { getOfferPricingTotals } from '@/lib/CRM/Offers/offerTotals';

export const OfferDetails = ({ offer }: { offer: any }) => {
  const badge = getOfferStatusBadgeProps(offer.status);
  const totals = getOfferPricingTotals(offer);

  return (
    <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
      <h2 className="mb-4 text-lg font-light text-[#e5e4e2]">Informacje</h2>

      <div className="mb-4">
        <p className="mb-1 text-sm text-[#e5e4e2]/60">Status</p>
        <span
          className={`inline-flex items-center rounded-full border px-3 py-1 text-xs uppercase ${badge.bg} ${badge.text} ${badge.border} `}
        >
          {badge.label}
        </span>
      </div>

      <div className="mb-4 rounded-lg border border-[#d3bb73]/10 bg-[#0a0d1a] p-4">
        <p className="mb-2 text-sm text-[#e5e4e2]/60">Podsumowanie</p>
        <div className="space-y-1.5 text-sm">
          {totals.discountAmount > 0 && (
            <>
              <div className="flex items-center justify-between">
                <span className="text-[#e5e4e2]/60">Wartość pozycji</span>
                <span className="text-[#e5e4e2]">{totals.listNet.toLocaleString('pl-PL', { minimumFractionDigits: 2 })} PLN</span>
              </div>
              <div className="flex items-center justify-between text-green-400">
                <span>Rabat {totals.discountPercent.toFixed(2)}%</span>
                <span>−{totals.discountAmount.toLocaleString('pl-PL', { minimumFractionDigits: 2 })} PLN</span>
              </div>
            </>
          )}
          <div className="flex items-center justify-between">
            <span className="text-[#e5e4e2]/60">Netto</span>
            <span className="text-[#e5e4e2]">{totals.net.toLocaleString('pl-PL', { minimumFractionDigits: 2 })} PLN</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[#e5e4e2]/60">
              VAT ({totals.hasMixedVatRates ? 'wg stawek pozycji' : `${totals.taxPercent}%`})
            </span>
            <span className="text-[#e5e4e2]/80">{totals.taxAmount.toLocaleString('pl-PL', { minimumFractionDigits: 2 })} PLN</span>
          </div>
          <div className="flex items-center justify-between border-t border-[#d3bb73]/10 pt-1.5">
            <span className="font-medium text-[#e5e4e2]">Brutto</span>
            <span className="font-medium text-[#d3bb73]">{totals.gross.toLocaleString('pl-PL', { minimumFractionDigits: 2 })} PLN</span>
          </div>
        </div>
      </div>

      <div className="space-y-3 text-sm">
        <div>
          <p className="text-[#e5e4e2]/60">Utworzona</p>
          <p className="text-[#e5e4e2]">
            {offer.created_at ? new Date(offer.created_at).toLocaleString('pl-PL') : '-'}
          </p>
        </div>

        <div>
          <p className="text-[#e5e4e2]/60">Ostatnia aktualizacja</p>
          <p className="text-[#e5e4e2]">
            {offer.updated_at ? new Date(offer.updated_at).toLocaleString('pl-PL') : '-'}
          </p>
        </div>

        <div>
          <p className="text-[#e5e4e2]/60">Wygasa</p>
          <p className="text-[#e5e4e2]">
            {offer.valid_until ? new Date(offer.valid_until).toLocaleString('pl-PL') : '-'}
          </p>
        </div>
      </div>
    </div>
  );
};
