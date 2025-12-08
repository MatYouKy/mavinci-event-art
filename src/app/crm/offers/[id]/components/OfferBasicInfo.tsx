'use client';

import { Building2, Calendar, DollarSign, FileText } from 'lucide-react';

interface OfferBasicInfoProps {
  offer: any;
}

export default function OfferBasicInfo({ offer }: OfferBasicInfoProps) {
  const getClientName = () => {
    if (offer.organization?.name) return offer.organization.name;
    return 'Brak klienta';
  };

  const getContactEmail = () => {
    if (offer.organization?.email) return offer.organization.email;
    if (offer.event?.contact?.email) return offer.event.contact.email;
    return '-';
  };

  return (
    <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6">
      <h2 className="text-lg font-light text-[#e5e4e2] mb-4">
        Informacje podstawowe
      </h2>
      <div className="space-y-4">
        <div className="flex items-start gap-3">
          <Building2 className="w-5 h-5 text-[#d3bb73] mt-0.5" />
          <div className="flex-1">
            <p className="text-xs text-[#e5e4e2]/60">Klient</p>
            <p className="text-sm text-[#e5e4e2] font-medium">{getClientName()}</p>
            <p className="text-xs text-[#e5e4e2]/60 mt-1">{getContactEmail()}</p>
          </div>
        </div>

        <div className="flex items-start gap-3">
          <FileText className="w-5 h-5 text-[#d3bb73] mt-0.5" />
          <div className="flex-1">
            <p className="text-xs text-[#e5e4e2]/60">Wydarzenie</p>
            <p className="text-sm text-[#e5e4e2] font-medium">
              {offer.event?.name || '-'}
            </p>
          </div>
        </div>

        <div className="flex items-start gap-3">
          <Calendar className="w-5 h-5 text-[#d3bb73] mt-0.5" />
          <div className="flex-1">
            <p className="text-xs text-[#e5e4e2]/60">Data wydarzenia</p>
            <p className="text-sm text-[#e5e4e2]">
              {offer.event?.event_date
                ? new Date(offer.event.event_date).toLocaleDateString('pl-PL')
                : '-'}
            </p>
          </div>
        </div>

        <div className="flex items-start gap-3">
          <Calendar className="w-5 h-5 text-[#d3bb73] mt-0.5" />
          <div className="flex-1">
            <p className="text-xs text-[#e5e4e2]/60">Ważna do</p>
            <p className="text-sm text-[#e5e4e2]">
              {offer.valid_until
                ? new Date(offer.valid_until).toLocaleDateString('pl-PL')
                : '-'}
            </p>
          </div>
        </div>

        <div className="flex items-start gap-3">
          <DollarSign className="w-5 h-5 text-[#d3bb73] mt-0.5" />
          <div className="flex-1">
            <p className="text-xs text-[#e5e4e2]/60">Wartość całkowita</p>
            <p className="text-lg text-[#d3bb73] font-medium">
              {offer.total_amount?.toFixed(2) || '0.00'} PLN
            </p>
          </div>
        </div>

        {offer.notes && (
          <div className="pt-4 border-t border-[#d3bb73]/10">
            <p className="text-xs text-[#e5e4e2]/60 mb-2">Notatki</p>
            <p className="text-sm text-[#e5e4e2] whitespace-pre-wrap">{offer.notes}</p>
          </div>
        )}
      </div>
    </div>
  );
}
