import { FileText, Calendar, Building2, DollarSign, Eye, Edit, Trash2 } from 'lucide-react';

const statusColors: Record<string, string> = {
  draft: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
  sent: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  accepted: 'bg-green-500/20 text-green-400 border-green-500/30',
  rejected: 'bg-red-500/20 text-red-400 border-red-500/30',
  expired: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
};

const statusLabels: Record<string, string> = {
  draft: 'Szkic',
  sent: 'Wysłana',
  accepted: 'Zaakceptowana',
  rejected: 'Odrzucona',
  expired: 'Wygasła',
};

interface OffersViewsProps {
  offers: any[];
  viewMode: 'list' | 'table' | 'grid';
  getClientName: (offer: any) => string;
  onView: (offerId: string) => void;
  onDelete: (offerId: string) => void;
}

export function OffersListView({ offers, getClientName, onView, onDelete }: Omit<OffersViewsProps, 'viewMode'>) {
  return (
    <div className="space-y-4">
      {offers.map((offer: any) => (
        <div
          key={offer.id}
          className="bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg p-6 hover:border-[#d3bb73]/30 transition-all"
        >
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-4 flex-1">
              <div className="w-12 h-12 bg-[#d3bb73]/20 rounded-lg flex items-center justify-center">
                <FileText className="w-6 h-6 text-[#d3bb73]" />
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-2">
                  <h3 className="text-lg font-medium text-[#e5e4e2]">
                    {offer.offer_number || 'Brak numeru'}
                  </h3>
                  <span
                    className={`px-2 py-1 rounded text-xs border ${
                      statusColors[offer.status] || 'bg-gray-500/20 text-gray-400'
                    }`}
                  >
                    {statusLabels[offer.status] || offer.status}
                  </span>
                </div>
                <div className="space-y-1">
                  {offer.event && (
                    <div className="flex items-center gap-2 text-sm text-[#e5e4e2]/70">
                      <Calendar className="w-4 h-4" />
                      <span>{offer.event.name}</span>
                    </div>
                  )}
                  <div className="flex items-center gap-2 text-sm text-[#e5e4e2]/60">
                    <Building2 className="w-4 h-4" />
                    <span>{getClientName(offer)}</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-4">
              <div className="text-right">
                <div className="text-2xl font-light text-[#d3bb73] mb-1">
                  {offer.total_amount ? offer.total_amount.toLocaleString('pl-PL') : '0'} zł
                </div>
                {offer.valid_until && (
                  <div className="text-xs text-[#e5e4e2]/60">
                    Ważna do: {new Date(offer.valid_until).toLocaleDateString('pl-PL')}
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-2">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onView(offer.id);
                  }}
                  className="p-2 bg-[#d3bb73]/20 text-[#d3bb73] rounded-lg hover:bg-[#d3bb73]/30 transition-colors"
                  title="Zobacz szczegóły"
                >
                  <Eye className="w-4 h-4" />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(offer.id);
                  }}
                  className="p-2 bg-red-500/20 text-red-400 rounded-lg hover:bg-red-500/30 transition-colors"
                  title="Usuń ofertę"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function OffersTableView({ offers, getClientName, onView, onDelete }: Omit<OffersViewsProps, 'viewMode'>) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="border-b border-[#d3bb73]/20">
            <th className="text-left py-3 px-4 text-sm text-[#e5e4e2]/60">Numer oferty</th>
            <th className="text-left py-3 px-4 text-sm text-[#e5e4e2]/60">Klient</th>
            <th className="text-left py-3 px-4 text-sm text-[#e5e4e2]/60">Event</th>
            <th className="text-left py-3 px-4 text-sm text-[#e5e4e2]/60">Kwota</th>
            <th className="text-left py-3 px-4 text-sm text-[#e5e4e2]/60">Status</th>
            <th className="text-left py-3 px-4 text-sm text-[#e5e4e2]/60">Ważna do</th>
            <th className="text-right py-3 px-4 text-sm text-[#e5e4e2]/60">Akcje</th>
          </tr>
        </thead>
        <tbody>
          {offers.map((offer: any) => (
            <tr
              key={offer.id}
              className="border-b border-[#d3bb73]/10 hover:bg-[#0f1119] transition-colors"
            >
              <td className="py-3 px-4">
                <span className="text-[#e5e4e2] font-medium">
                  {offer.offer_number || 'Brak numeru'}
                </span>
              </td>
              <td className="py-3 px-4 text-[#e5e4e2]/70">
                {getClientName(offer)}
              </td>
              <td className="py-3 px-4 text-[#e5e4e2]/70">
                {offer.event?.name || '-'}
              </td>
              <td className="py-3 px-4">
                <span className="text-[#d3bb73] font-medium">
                  {offer.total_amount ? offer.total_amount.toLocaleString('pl-PL') : '0'} zł
                </span>
              </td>
              <td className="py-3 px-4">
                <span
                  className={`px-2 py-1 rounded text-xs border ${
                    statusColors[offer.status] || 'bg-gray-500/20 text-gray-400'
                  }`}
                >
                  {statusLabels[offer.status] || offer.status}
                </span>
              </td>
              <td className="py-3 px-4 text-[#e5e4e2]/60 text-sm">
                {offer.valid_until
                  ? new Date(offer.valid_until).toLocaleDateString('pl-PL')
                  : '-'}
              </td>
              <td className="py-3 px-4">
                <div className="flex items-center justify-end gap-2">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onView(offer.id);
                    }}
                    className="p-2 bg-[#d3bb73]/20 text-[#d3bb73] rounded-lg hover:bg-[#d3bb73]/30 transition-colors"
                    title="Zobacz szczegóły"
                  >
                    <Eye className="w-4 h-4" />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete(offer.id);
                    }}
                    className="p-2 bg-red-500/20 text-red-400 rounded-lg hover:bg-red-500/30 transition-colors"
                    title="Usuń ofertę"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function OffersGridView({ offers, getClientName, onView, onDelete }: Omit<OffersViewsProps, 'viewMode'>) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {offers.map((offer: any) => (
        <div
          key={offer.id}
          className="bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg p-6 hover:border-[#d3bb73]/30 transition-all"
        >
          <div className="flex items-start justify-between mb-4">
            <div className="w-12 h-12 bg-[#d3bb73]/20 rounded-lg flex items-center justify-center">
              <FileText className="w-6 h-6 text-[#d3bb73]" />
            </div>
            <span
              className={`px-2 py-1 rounded text-xs border ${
                statusColors[offer.status] || 'bg-gray-500/20 text-gray-400'
              }`}
            >
              {statusLabels[offer.status] || offer.status}
            </span>
          </div>

          <h3 className="text-lg font-medium text-[#e5e4e2] mb-3">
            {offer.offer_number || 'Brak numeru'}
          </h3>

          <div className="space-y-2 mb-4">
            {offer.event && (
              <div className="flex items-center gap-2 text-sm text-[#e5e4e2]/70">
                <Calendar className="w-4 h-4" />
                <span className="truncate">{offer.event.name}</span>
              </div>
            )}
            <div className="flex items-center gap-2 text-sm text-[#e5e4e2]/60">
              <Building2 className="w-4 h-4" />
              <span className="truncate">{getClientName(offer)}</span>
            </div>
          </div>

          <div className="mb-4">
            <div className="text-2xl font-light text-[#d3bb73]">
              {offer.total_amount ? offer.total_amount.toLocaleString('pl-PL') : '0'} zł
            </div>
            {offer.valid_until && (
              <div className="text-xs text-[#e5e4e2]/60 mt-1">
                Ważna do: {new Date(offer.valid_until).toLocaleDateString('pl-PL')}
              </div>
            )}
          </div>

          <div className="flex gap-2">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onView(offer.id);
              }}
              className="flex-1 py-2 bg-[#d3bb73]/20 text-[#d3bb73] rounded-lg hover:bg-[#d3bb73]/30 transition-colors text-sm flex items-center justify-center gap-2"
            >
              <Eye className="w-4 h-4" />
              <span>Zobacz</span>
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDelete(offer.id);
              }}
              className="py-2 px-3 bg-red-500/20 text-red-400 rounded-lg hover:bg-red-500/30 transition-colors"
              title="Usuń"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
