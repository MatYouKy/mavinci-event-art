'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  Plus,
  Search,
  Building2,
  User,
  Mail,
  Phone,
  MapPin,
  Tag,
  Calendar,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useSnackbar } from '@/contexts/SnackbarContext';

interface Client {
  id: string;
  client_type: 'company' | 'individual';
  company_name: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone_number: string | null;
  address_city: string | null;
  category: string;
  status: string;
  tags: string[] | null;
  total_events: number;
  last_contact_date: string | null;
  created_at: string;
}

export default function ClientsPage() {
  const router = useRouter();
  const [searchTerm, setSearchTerm] = useState('');
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');

  useEffect(() => {
    fetchClients();
  }, []);

  const fetchClients = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('clients')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error fetching clients:', error);
        return;
      }

      setClients(data || []);
    } catch (err) {
      console.error('Error:', err);
    } finally {
      setLoading(false);
    }
  };

  const filteredClients = clients.filter((client) => {
    const matchesSearch =
      `${client.company_name || ''} ${client.first_name || ''} ${client.last_name || ''} ${client.email || ''}`
        .toLowerCase()
        .includes(searchTerm.toLowerCase());

    const matchesCategory =
      filterCategory === 'all' || client.category === filterCategory;

    const matchesStatus =
      filterStatus === 'all' || client.status === filterStatus;

    return matchesSearch && matchesCategory && matchesStatus;
  });

  const getCategoryLabel = (category: string) => {
    const labels: Record<string, string> = {
      corporate_events: 'Eventy firmowe',
      weddings: 'Wesela',
      private_parties: 'Imprezy prywatne',
      conferences: 'Konferencje',
      other: 'Inne',
    };
    return labels[category] || category;
  };

  const getStatusLabel = (status: string) => {
    const labels: Record<string, string> = {
      active: 'Aktywny',
      potential: 'Potencjalny',
      inactive: 'Nieaktywny',
      blacklisted: 'Czarna lista',
    };
    return labels[status] || status;
  };

  const getStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      active: 'bg-green-500/20 text-green-400',
      potential: 'bg-blue-500/20 text-blue-400',
      inactive: 'bg-gray-500/20 text-gray-400',
      blacklisted: 'bg-red-500/20 text-red-400',
    };
    return colors[status] || 'bg-gray-500/20 text-gray-400';
  };

  const getCategoryColor = (category: string) => {
    const colors: Record<string, string> = {
      corporate_events: 'bg-purple-500/20 text-purple-400',
      weddings: 'bg-pink-500/20 text-pink-400',
      private_parties: 'bg-orange-500/20 text-orange-400',
      conferences: 'bg-blue-500/20 text-blue-400',
      other: 'bg-gray-500/20 text-gray-400',
    };
    return colors[category] || 'bg-gray-500/20 text-gray-400';
  };

  const getClientDisplayName = (client: Client) => {
    if (client.client_type === 'company') {
      return client.company_name || 'Firma bez nazwy';
    }
    return `${client.first_name || ''} ${client.last_name || ''}`.trim() || 'Klient';
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-[#e5e4e2]/60">Ładowanie...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-light text-[#e5e4e2]">Klienci</h2>
          <p className="text-[#e5e4e2]/60 text-sm mt-1">
            Zarządzaj klientami i relacjami biznesowymi
          </p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="flex items-center gap-2 bg-[#d3bb73] text-[#1c1f33] px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#d3bb73]/90 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Dodaj klienta
        </button>
      </div>

      <div className="flex flex-col md:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-[#e5e4e2]/40" />
          <input
            type="text"
            placeholder="Szukaj klientów..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-[#1c1f33] border border-[#d3bb73]/10 rounded-lg pl-12 pr-4 py-3 text-[#e5e4e2] placeholder:text-[#e5e4e2]/40 focus:outline-none focus:border-[#d3bb73]/30"
          />
        </div>
        <select
          value={filterCategory}
          onChange={(e) => setFilterCategory(e.target.value)}
          className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-lg px-4 py-3 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/30"
        >
          <option value="all">Wszystkie kategorie</option>
          <option value="corporate_events">Eventy firmowe</option>
          <option value="weddings">Wesela</option>
          <option value="private_parties">Imprezy prywatne</option>
          <option value="conferences">Konferencje</option>
          <option value="other">Inne</option>
        </select>
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-lg px-4 py-3 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/30"
        >
          <option value="all">Wszystkie statusy</option>
          <option value="active">Aktywny</option>
          <option value="potential">Potencjalny</option>
          <option value="inactive">Nieaktywny</option>
        </select>
      </div>

      {filteredClients.length === 0 ? (
        <div className="text-center py-12">
          <Building2 className="w-12 h-12 text-[#e5e4e2]/20 mx-auto mb-4" />
          <p className="text-[#e5e4e2]/60">
            {searchTerm ? 'Nie znaleziono klientów' : 'Brak klientów'}
          </p>
        </div>
      ) : (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredClients.map((client) => (
            <div
              key={client.id}
              onClick={() => router.push(`/crm/clients/${client.id}`)}
              className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6 hover:border-[#d3bb73]/30 transition-all cursor-pointer"
            >
              <div className="flex items-start gap-4 mb-4">
                <div
                  className={`w-12 h-12 rounded-full flex items-center justify-center ${
                    client.client_type === 'company'
                      ? 'bg-purple-500/20'
                      : 'bg-blue-500/20'
                  }`}
                >
                  {client.client_type === 'company' ? (
                    <Building2 className="w-6 h-6 text-purple-400" />
                  ) : (
                    <User className="w-6 h-6 text-blue-400" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-lg font-medium text-[#e5e4e2] truncate">
                    {getClientDisplayName(client)}
                  </h3>
                  <div className="flex items-center gap-2 mt-1">
                    <span
                      className={`px-2 py-0.5 rounded text-xs ${getStatusColor(
                        client.status
                      )}`}
                    >
                      {getStatusLabel(client.status)}
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded text-xs ${getCategoryColor(
                        client.category
                      )}`}
                    >
                      {getCategoryLabel(client.category)}
                    </span>
                  </div>
                </div>
              </div>

              <div className="space-y-2 text-sm">
                {client.email && (
                  <div className="flex items-center gap-2 text-[#e5e4e2]/70">
                    <Mail className="w-4 h-4 flex-shrink-0" />
                    <span className="truncate">{client.email}</span>
                  </div>
                )}
                {client.phone_number && (
                  <div className="flex items-center gap-2 text-[#e5e4e2]/70">
                    <Phone className="w-4 h-4 flex-shrink-0" />
                    {client.phone_number}
                  </div>
                )}
                {client.address_city && (
                  <div className="flex items-center gap-2 text-[#e5e4e2]/70">
                    <MapPin className="w-4 h-4 flex-shrink-0" />
                    {client.address_city}
                  </div>
                )}
              </div>

              <div className="mt-4 pt-4 border-t border-[#d3bb73]/10 flex items-center justify-between text-xs text-[#e5e4e2]/60">
                <span className="flex items-center gap-1">
                  <Calendar className="w-3 h-3" />
                  {client.total_events} wydarzeń
                </span>
                {client.last_contact_date && (
                  <span>
                    Ostatni kontakt:{' '}
                    {new Date(client.last_contact_date).toLocaleDateString(
                      'pl-PL'
                    )}
                  </span>
                )}
              </div>

              {client.tags && client.tags.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1">
                  {client.tags.slice(0, 3).map((tag, idx) => (
                    <span
                      key={idx}
                      className="px-2 py-0.5 bg-[#d3bb73]/10 text-[#d3bb73] rounded text-xs flex items-center gap-1"
                    >
                      <Tag className="w-3 h-3" />
                      {tag}
                    </span>
                  ))}
                  {client.tags.length > 3 && (
                    <span className="px-2 py-0.5 text-[#e5e4e2]/40 text-xs">
                      +{client.tags.length - 3}
                    </span>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {showAddModal && (
        <AddClientModal
          isOpen={showAddModal}
          onClose={() => setShowAddModal(false)}
          onAdded={fetchClients}
        />
      )}
    </div>
  );
}

function AddClientModal({
  isOpen,
  onClose,
  onAdded,
}: {
  isOpen: boolean;
  onClose: () => void;
  onAdded: () => void;
}) {
  const { showSnackbar } = useSnackbar();
  const [clientType, setClientType] = useState<'company' | 'individual'>('company');
  const [formData, setFormData] = useState({
    company_name: '',
    company_nip: '',
    first_name: '',
    last_name: '',
    email: '',
    phone_number: '',
    address_city: '',
    category: 'corporate_events',
    status: 'potential',
    source: '',
  });

  if (!isOpen) return null;

  const handleSubmit = async () => {
    const requiredFields =
      clientType === 'company'
        ? ['company_name', 'email']
        : ['first_name', 'last_name', 'email'];

    const missingFields = requiredFields.filter(
      (field) => !formData[field as keyof typeof formData]
    );

    if (missingFields.length > 0) {
      showSnackbar('Wypełnij wszystkie wymagane pola', 'warning');
      return;
    }

    try {
      const { error } = await supabase.from('clients').insert([
        {
          client_type: clientType,
          ...formData,
        },
      ]);

      if (error) {
        console.error('Error adding client:', error);
        showSnackbar(`Błąd podczas dodawania klienta: ${error.message}`, 'error');
        return;
      }

      showSnackbar('Klient dodany pomyślnie!', 'success');
      onAdded();
      onClose();
    } catch (err) {
      console.error('Error:', err);
      showSnackbar('Wystąpił błąd', 'error');
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-[#0f1119] border border-[#d3bb73]/20 rounded-xl p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <h2 className="text-xl font-light text-[#e5e4e2] mb-6">
          Dodaj nowego klienta
        </h2>

        <div className="mb-6">
          <label className="block text-sm text-[#e5e4e2]/60 mb-2">
            Typ klienta *
          </label>
          <div className="flex gap-4">
            <button
              onClick={() => setClientType('company')}
              className={`flex-1 p-4 rounded-lg border-2 transition-all ${
                clientType === 'company'
                  ? 'border-[#d3bb73] bg-[#d3bb73]/10'
                  : 'border-[#d3bb73]/20'
              }`}
            >
              <Building2 className="w-6 h-6 mx-auto mb-2 text-[#d3bb73]" />
              <div className="text-[#e5e4e2] font-medium">Firma</div>
            </button>
            <button
              onClick={() => setClientType('individual')}
              className={`flex-1 p-4 rounded-lg border-2 transition-all ${
                clientType === 'individual'
                  ? 'border-[#d3bb73] bg-[#d3bb73]/10'
                  : 'border-[#d3bb73]/20'
              }`}
            >
              <User className="w-6 h-6 mx-auto mb-2 text-[#d3bb73]" />
              <div className="text-[#e5e4e2] font-medium">Osoba prywatna</div>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 mb-6">
          {clientType === 'company' ? (
            <>
              <div className="col-span-2">
                <label className="block text-sm text-[#e5e4e2]/60 mb-2">
                  Nazwa firmy *
                </label>
                <input
                  type="text"
                  value={formData.company_name}
                  onChange={(e) =>
                    setFormData({ ...formData, company_name: e.target.value })
                  }
                  className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
                />
              </div>
              <div>
                <label className="block text-sm text-[#e5e4e2]/60 mb-2">
                  NIP
                </label>
                <input
                  type="text"
                  value={formData.company_nip}
                  onChange={(e) =>
                    setFormData({ ...formData, company_nip: e.target.value })
                  }
                  className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
                />
              </div>
            </>
          ) : (
            <>
              <div>
                <label className="block text-sm text-[#e5e4e2]/60 mb-2">
                  Imię *
                </label>
                <input
                  type="text"
                  value={formData.first_name}
                  onChange={(e) =>
                    setFormData({ ...formData, first_name: e.target.value })
                  }
                  className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
                />
              </div>
              <div>
                <label className="block text-sm text-[#e5e4e2]/60 mb-2">
                  Nazwisko *
                </label>
                <input
                  type="text"
                  value={formData.last_name}
                  onChange={(e) =>
                    setFormData({ ...formData, last_name: e.target.value })
                  }
                  className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
                />
              </div>
            </>
          )}

          <div>
            <label className="block text-sm text-[#e5e4e2]/60 mb-2">
              Email *
            </label>
            <input
              type="email"
              value={formData.email}
              onChange={(e) =>
                setFormData({ ...formData, email: e.target.value })
              }
              className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
            />
          </div>
          <div>
            <label className="block text-sm text-[#e5e4e2]/60 mb-2">
              Telefon
            </label>
            <input
              type="text"
              value={formData.phone_number}
              onChange={(e) =>
                setFormData({ ...formData, phone_number: e.target.value })
              }
              className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
            />
          </div>
          <div>
            <label className="block text-sm text-[#e5e4e2]/60 mb-2">
              Miasto
            </label>
            <input
              type="text"
              value={formData.address_city}
              onChange={(e) =>
                setFormData({ ...formData, address_city: e.target.value })
              }
              className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
            />
          </div>
          <div>
            <label className="block text-sm text-[#e5e4e2]/60 mb-2">
              Kategoria
            </label>
            <select
              value={formData.category}
              onChange={(e) =>
                setFormData({ ...formData, category: e.target.value })
              }
              className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
            >
              <option value="corporate_events">Eventy firmowe</option>
              <option value="weddings">Wesela</option>
              <option value="private_parties">Imprezy prywatne</option>
              <option value="conferences">Konferencje</option>
              <option value="other">Inne</option>
            </select>
          </div>
          <div className="col-span-2">
            <label className="block text-sm text-[#e5e4e2]/60 mb-2">
              Źródło pozyskania
            </label>
            <input
              type="text"
              value={formData.source}
              onChange={(e) =>
                setFormData({ ...formData, source: e.target.value })
              }
              className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
              placeholder="np. Rekomendacja, Strona www, LinkedIn..."
            />
          </div>
        </div>

        <div className="flex gap-3">
          <button
            onClick={handleSubmit}
            className="flex-1 bg-[#d3bb73] text-[#1c1f33] px-4 py-2 rounded-lg font-medium hover:bg-[#d3bb73]/90"
          >
            Dodaj klienta
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
  );
}
