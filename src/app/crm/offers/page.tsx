'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, FileText, Search, DollarSign, Calendar, Building2, User } from 'lucide-react';
import { supabase } from '@/lib/supabase';

interface Offer {
  id: string;
  offer_number: string;
  event_id: string;
  client_id: string;
  total_amount: number;
  valid_until: string;
  status: string;
  created_at: string;
  client?: {
    company_name?: string;
    first_name?: string;
    last_name?: string;
  };
  event?: {
    name: string;
    event_date: string;
  };
}

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

export default function OffersPage() {
  const router = useRouter();
  const [offers, setOffers] = useState<Offer[]>([]);
  const [filteredOffers, setFilteredOffers] = useState<Offer[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [showCreateModal, setShowCreateModal] = useState(false);

  useEffect(() => {
    fetchOffers();
  }, []);

  useEffect(() => {
    filterOffers();
  }, [searchQuery, statusFilter, offers]);

  const fetchOffers = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('offers')
        .select(`
          *,
          client:clients!client_id(company_name, first_name, last_name),
          event:events!event_id(name, event_date)
        `)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error fetching offers:', error);
        return;
      }

      console.log('Fetched offers:', data);
      console.log('Number of offers:', data?.length);

      if (data) {
        setOffers(data);
      }
    } catch (err) {
      console.error('Error:', err);
    } finally {
      setLoading(false);
    }
  };

  const filterOffers = () => {
    let filtered = [...offers];

    if (searchQuery) {
      filtered = filtered.filter(
        (offer) =>
          offer.offer_number?.toLowerCase().includes(searchQuery.toLowerCase()) ||
          offer.client?.company_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
          offer.event?.name?.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }

    if (statusFilter !== 'all') {
      filtered = filtered.filter((offer) => offer.status === statusFilter);
    }

    setFilteredOffers(filtered);
  };

  const getClientName = (offer: Offer) => {
    if (offer.client?.company_name) return offer.client.company_name;
    if (offer.client?.first_name || offer.client?.last_name) {
      return `${offer.client.first_name || ''} ${offer.client.last_name || ''}`.trim();
    }
    return 'Brak klienta';
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-[#e5e4e2]">Ładowanie...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-light text-[#e5e4e2]">Oferty</h1>
          <p className="text-sm text-[#e5e4e2]/60 mt-1">
            Zarządzaj ofertami dla klientów
          </p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="flex items-center gap-2 bg-[#d3bb73] text-[#1c1f33] px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#d3bb73]/90 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Nowa oferta
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6">
          <div className="flex items-center gap-3 mb-2">
            <FileText className="w-5 h-5 text-[#d3bb73]" />
            <span className="text-2xl font-light text-[#e5e4e2]">{offers.length}</span>
          </div>
          <p className="text-sm text-[#e5e4e2]/60">Wszystkie</p>
        </div>

        <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6">
          <div className="flex items-center gap-3 mb-2">
            <FileText className="w-5 h-5 text-gray-400" />
            <span className="text-2xl font-light text-[#e5e4e2]">
              {offers.filter((o) => o.status === 'draft').length}
            </span>
          </div>
          <p className="text-sm text-[#e5e4e2]/60">Szkice</p>
        </div>

        <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6">
          <div className="flex items-center gap-3 mb-2">
            <FileText className="w-5 h-5 text-blue-400" />
            <span className="text-2xl font-light text-[#e5e4e2]">
              {offers.filter((o) => o.status === 'sent').length}
            </span>
          </div>
          <p className="text-sm text-[#e5e4e2]/60">Wysłane</p>
        </div>

        <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6">
          <div className="flex items-center gap-3 mb-2">
            <FileText className="w-5 h-5 text-green-400" />
            <span className="text-2xl font-light text-[#e5e4e2]">
              {offers.filter((o) => o.status === 'accepted').length}
            </span>
          </div>
          <p className="text-sm text-[#e5e4e2]/60">Zaakceptowane</p>
        </div>

        <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6">
          <div className="flex items-center gap-3 mb-2">
            <DollarSign className="w-5 h-5 text-yellow-400" />
            <span className="text-2xl font-light text-[#e5e4e2]">
              {offers
                .reduce((sum, o) => sum + (o.total_amount || 0), 0)
                .toLocaleString('pl-PL')}
              zł
            </span>
          </div>
          <p className="text-sm text-[#e5e4e2]/60">Łączna wartość</p>
        </div>
      </div>

      <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6">
        <div className="flex flex-col lg:flex-row gap-4 mb-6">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[#e5e4e2]/40" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Szukaj oferty..."
              className="w-full bg-[#0a0d1a] border border-[#d3bb73]/20 rounded-lg pl-10 pr-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
            />
          </div>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="bg-[#0a0d1a] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
          >
            <option value="all">Wszystkie statusy</option>
            <option value="draft">Szkice</option>
            <option value="sent">Wysłane</option>
            <option value="accepted">Zaakceptowane</option>
            <option value="rejected">Odrzucone</option>
            <option value="expired">Wygasłe</option>
          </select>
        </div>

        {filteredOffers.length === 0 ? (
          <div className="text-center py-12">
            <FileText className="w-12 h-12 text-[#e5e4e2]/20 mx-auto mb-4" />
            <p className="text-[#e5e4e2]/60">
              {searchQuery || statusFilter !== 'all'
                ? 'Brak ofert spełniających kryteria'
                : 'Brak ofert'}
            </p>
            <button
              onClick={() => setShowCreateModal(true)}
              className="mt-4 text-[#d3bb73] hover:text-[#d3bb73]/80 text-sm"
            >
              Utwórz pierwszą ofertę
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {filteredOffers.map((offer) => (
              <div
                key={offer.id}
                className="bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg p-6 hover:border-[#d3bb73]/30 transition-all cursor-pointer"
                onClick={() => router.push(`/crm/offers/${offer.id}`)}
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

                  <div className="text-right">
                    <div className="text-2xl font-light text-[#d3bb73] mb-1">
                      {offer.total_amount
                        ? offer.total_amount.toLocaleString('pl-PL')
                        : '0'}{' '}
                      zł
                    </div>
                    {offer.valid_until && (
                      <div className="text-xs text-[#e5e4e2]/60">
                        Ważna do: {new Date(offer.valid_until).toLocaleDateString('pl-PL')}
                      </div>
                    )}
                    <div className="text-xs text-[#e5e4e2]/40 mt-1">
                      Utworzona: {new Date(offer.created_at).toLocaleDateString('pl-PL')}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showCreateModal && (
        <CreateOfferModal
          isOpen={showCreateModal}
          onClose={() => setShowCreateModal(false)}
          onSuccess={() => {
            setShowCreateModal(false);
            fetchOffers();
          }}
        />
      )}
    </div>
  );
}

function CreateOfferModal({
  isOpen,
  onClose,
  onSuccess,
}: {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [clients, setClients] = useState<any[]>([]);
  const [events, setEvents] = useState<any[]>([]);
  const [formData, setFormData] = useState({
    offer_number: '',
    client_id: '',
    event_id: '',
    valid_until: '',
    notes: '',
  });

  useEffect(() => {
    if (isOpen) {
      fetchClients();
      fetchEvents();
    }
  }, [isOpen]);

  const fetchClients = async () => {
    const { data } = await supabase
      .from('clients')
      .select('id, company_name, first_name, last_name')
      .order('company_name');
    if (data) setClients(data);
  };

  const fetchEvents = async () => {
    const { data } = await supabase
      .from('events')
      .select('id, name, event_date')
      .order('event_date', { ascending: false });
    if (data) setEvents(data);
  };

  const handleSubmit = async () => {
    try {
      const offerData: any = {
        client_id: formData.client_id || null,
        event_id: formData.event_id || null,
        valid_until: formData.valid_until || null,
        notes: formData.notes || null,
        status: 'draft',
        total_amount: 0,
      };

      if (formData.offer_number.trim()) {
        offerData.offer_number = formData.offer_number;
      }

      const { data, error } = await supabase
        .from('offers')
        .insert([offerData])
        .select();

      if (error) {
        console.error('Error creating offer:', error);
        alert('Błąd podczas tworzenia oferty: ' + error.message);
        return;
      }

      if (data && data[0]) {
        alert(`Utworzono ofertę: ${data[0].offer_number}`);
      }

      onSuccess();
    } catch (err) {
      console.error('Error:', err);
      alert('Wystąpił błąd');
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-[#0f1119] border border-[#d3bb73]/20 rounded-xl p-6 max-w-lg w-full">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-light text-[#e5e4e2]">Utwórz nową ofertę</h2>
          <button
            onClick={onClose}
            className="text-[#e5e4e2]/60 hover:text-[#e5e4e2]"
          >
            ✕
          </button>
        </div>

        <div className="space-y-4">
          <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4 mb-4">
            <p className="text-sm text-blue-400">
              Numer oferty zostanie wygenerowany automatycznie w formacie OF/RRRR/MM/NNN (np. OF/2025/10/001)
            </p>
          </div>

          <div>
            <label className="block text-sm text-[#e5e4e2]/60 mb-2">
              Numer oferty
            </label>
            <input
              type="text"
              value={formData.offer_number}
              onChange={(e) => setFormData({ ...formData, offer_number: e.target.value })}
              className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
              placeholder="Zostaw puste dla automatycznego numeru lub wpisz własny"
            />
            <p className="text-xs text-[#e5e4e2]/40 mt-1">
              System sprawdzi czy numer jest unikalny
            </p>
          </div>

          <div>
            <label className="block text-sm text-[#e5e4e2]/60 mb-2">Klient</label>
            <select
              value={formData.client_id}
              onChange={(e) => setFormData({ ...formData, client_id: e.target.value })}
              className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
            >
              <option value="">Wybierz klienta...</option>
              {clients.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.company_name ||
                    `${client.first_name || ''} ${client.last_name || ''}`.trim()}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm text-[#e5e4e2]/60 mb-2">Event</label>
            <select
              value={formData.event_id}
              onChange={(e) => setFormData({ ...formData, event_id: e.target.value })}
              className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
            >
              <option value="">Wybierz event...</option>
              {events.map((event) => (
                <option key={event.id} value={event.id}>
                  {event.name} -{' '}
                  {new Date(event.event_date).toLocaleDateString('pl-PL')}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm text-[#e5e4e2]/60 mb-2">
              Ważna do
            </label>
            <input
              type="date"
              value={formData.valid_until}
              onChange={(e) => setFormData({ ...formData, valid_until: e.target.value })}
              className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
            />
          </div>

          <div>
            <label className="block text-sm text-[#e5e4e2]/60 mb-2">
              Notatki
            </label>
            <textarea
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] min-h-[100px] focus:outline-none focus:border-[#d3bb73]"
              placeholder="Dodatkowe informacje..."
            />
          </div>

          <div className="flex gap-3 pt-4">
            <button
              onClick={handleSubmit}
              className="flex-1 bg-[#d3bb73] text-[#1c1f33] px-4 py-2 rounded-lg font-medium hover:bg-[#d3bb73]/90"
            >
              Utwórz ofertę
            </button>
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-[#e5e4e2]/60 hover:bg-[#1c1f33]"
            >
              Anuluj
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
