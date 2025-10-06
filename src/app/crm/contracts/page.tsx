'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { FileText, Plus, Search, Eye, Download, Trash2, FileType } from 'lucide-react';

interface Contract {
  id: string;
  contract_number: string;
  title: string;
  status: string;
  valid_from: string;
  valid_until: string;
  created_at: string;
  client?: {
    company_name: string;
    first_name: string;
    last_name: string;
  };
  event?: {
    name: string;
  };
}

export default function ContractsPage() {
  const router = useRouter();
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [filteredContracts, setFilteredContracts] = useState<Contract[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [showCreateModal, setShowCreateModal] = useState(false);

  useEffect(() => {
    fetchContracts();
  }, []);

  useEffect(() => {
    filterContracts();
  }, [searchQuery, statusFilter, contracts]);

  const fetchContracts = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('contracts')
        .select(`
          *,
          client:clients!client_id(company_name, first_name, last_name),
          event:events!event_id(name)
        `)
        .order('created_at', { ascending: false });

      if (error) throw error;
      if (data) {
        setContracts(data);
      }
    } catch (err) {
      console.error('Error fetching contracts:', err);
    } finally {
      setLoading(false);
    }
  };

  const filterContracts = () => {
    let filtered = [...contracts];

    if (searchQuery) {
      filtered = filtered.filter(
        (c) =>
          c.contract_number.toLowerCase().includes(searchQuery.toLowerCase()) ||
          c.title.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }

    if (statusFilter !== 'all') {
      filtered = filtered.filter((c) => c.status === statusFilter);
    }

    setFilteredContracts(filtered);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Czy na pewno chcesz usunąć tę umowę?')) return;

    try {
      const { error } = await supabase.from('contracts').delete().eq('id', id);

      if (error) throw error;
      fetchContracts();
    } catch (err) {
      console.error('Error deleting contract:', err);
      alert('Błąd podczas usuwania umowy');
    }
  };

  const getClientName = (contract: Contract) => {
    if (contract.client?.company_name) return contract.client.company_name;
    if (contract.client?.first_name || contract.client?.last_name) {
      return `${contract.client.first_name || ''} ${contract.client.last_name || ''}`.trim();
    }
    return 'Brak klienta';
  };

  const statusLabels: Record<string, string> = {
    draft: 'Projekt',
    sent: 'Wysłana',
    signed: 'Podpisana',
    cancelled: 'Anulowana',
  };

  const statusColors: Record<string, string> = {
    draft: 'bg-gray-500/20 text-gray-400',
    sent: 'bg-blue-500/20 text-blue-400',
    signed: 'bg-green-500/20 text-green-400',
    cancelled: 'bg-red-500/20 text-red-400',
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0d1a] flex items-center justify-center">
        <div className="text-[#e5e4e2]">Ładowanie...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0d1a] p-6">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-light text-[#e5e4e2] mb-2">Umowy</h1>
            <p className="text-[#e5e4e2]/60">Zarządzaj umowami</p>
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => router.push('/crm/contract-templates')}
              className="flex items-center gap-2 bg-[#1c1f33] text-[#e5e4e2] px-6 py-3 rounded-lg font-medium hover:bg-[#1c1f33]/80 transition-colors border border-[#d3bb73]/20"
            >
              <FileType className="w-5 h-5" />
              Szablony
            </button>
            <button
              onClick={() => setShowCreateModal(true)}
              className="flex items-center gap-2 bg-[#d3bb73] text-[#1c1f33] px-6 py-3 rounded-lg font-medium hover:bg-[#d3bb73]/90 transition-colors"
            >
              <Plus className="w-5 h-5" />
              Nowa umowa
            </button>
          </div>
        </div>

        <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[#e5e4e2]/40" />
              <input
                type="text"
                placeholder="Szukaj umów..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg pl-10 pr-4 py-2 text-[#e5e4e2] placeholder-[#e5e4e2]/40 focus:outline-none focus:border-[#d3bb73]"
              />
            </div>

            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
            >
              <option value="all">Wszystkie statusy</option>
              <option value="draft">Projekt</option>
              <option value="sent">Wysłana</option>
              <option value="signed">Podpisana</option>
              <option value="cancelled">Anulowana</option>
            </select>
          </div>
        </div>

        {filteredContracts.length === 0 ? (
          <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-12 text-center">
            <FileText className="w-16 h-16 text-[#e5e4e2]/20 mx-auto mb-4" />
            <h3 className="text-xl font-light text-[#e5e4e2] mb-2">Brak umów</h3>
            <p className="text-[#e5e4e2]/60 mb-6">Utwórz pierwszą umowę</p>
            <button
              onClick={() => setShowCreateModal(true)}
              className="inline-flex items-center gap-2 bg-[#d3bb73] text-[#1c1f33] px-6 py-3 rounded-lg font-medium hover:bg-[#d3bb73]/90 transition-colors"
            >
              <Plus className="w-5 h-5" />
              Nowa umowa
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4">
            {filteredContracts.map((contract) => (
              <div
                key={contract.id}
                className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6 hover:border-[#d3bb73]/30 transition-colors cursor-pointer"
                onClick={() => router.push(`/crm/contracts/${contract.id}`)}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <h3 className="text-lg font-light text-[#e5e4e2]">
                        {contract.contract_number}
                      </h3>
                      <span
                        className={`text-xs px-2 py-1 rounded ${
                          statusColors[contract.status]
                        }`}
                      >
                        {statusLabels[contract.status]}
                      </span>
                    </div>
                    <p className="text-[#e5e4e2] mb-2">{contract.title}</p>
                    <div className="flex flex-wrap gap-4 text-sm text-[#e5e4e2]/60">
                      <span>Klient: {getClientName(contract)}</span>
                      {contract.event && <span>Event: {contract.event.name}</span>}
                      {contract.valid_from && (
                        <span>
                          Ważna:{' '}
                          {new Date(contract.valid_from).toLocaleDateString('pl-PL')}{' '}
                          -{' '}
                          {contract.valid_until
                            ? new Date(contract.valid_until).toLocaleDateString('pl-PL')
                            : 'bezterminowo'}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        router.push(`/crm/contracts/${contract.id}`);
                      }}
                      className="p-2 text-[#d3bb73] hover:bg-[#d3bb73]/10 rounded-lg transition-colors"
                      title="Szczegóły"
                    >
                      <Eye className="w-5 h-5" />
                    </button>
                    {contract.pdf_url && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          window.open(contract.pdf_url, '_blank');
                        }}
                        className="p-2 text-blue-400 hover:bg-blue-400/10 rounded-lg transition-colors"
                        title="Pobierz PDF"
                      >
                        <Download className="w-5 h-5" />
                      </button>
                    )}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(contract.id);
                      }}
                      className="p-2 text-red-400 hover:bg-red-400/10 rounded-lg transition-colors"
                      title="Usuń"
                    >
                      <Trash2 className="w-5 h-5" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showCreateModal && (
        <CreateContractModal
          isOpen={showCreateModal}
          onClose={() => setShowCreateModal(false)}
          onSuccess={() => {
            setShowCreateModal(false);
            fetchContracts();
          }}
        />
      )}
    </div>
  );
}

function CreateContractModal({
  isOpen,
  onClose,
  onSuccess,
}: {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const router = useRouter();
  const [templates, setTemplates] = useState<any[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [events, setEvents] = useState<any[]>([]);
  const [formData, setFormData] = useState({
    template_id: '',
    client_id: '',
    event_id: '',
    title: '',
  });

  useEffect(() => {
    fetchTemplates();
    fetchClients();
    fetchEvents();
  }, []);

  const fetchTemplates = async () => {
    const { data } = await supabase
      .from('contract_templates')
      .select('*')
      .eq('is_active', true)
      .order('name');
    if (data) setTemplates(data);
  };

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
      .select('id, name')
      .order('event_date', { ascending: false });
    if (data) setEvents(data);
  };

  if (!isOpen) return null;

  const handleSubmit = async () => {
    if (!formData.template_id) {
      alert('Wybierz szablon');
      return;
    }
    if (!formData.title.trim()) {
      alert('Podaj tytuł umowy');
      return;
    }

    const template = templates.find((t) => t.id === formData.template_id);
    if (!template) return;

    router.push(
      `/crm/contracts/create?template=${formData.template_id}&client=${formData.client_id}&event=${formData.event_id}&title=${encodeURIComponent(formData.title)}`
    );
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-[#0f1119] border border-[#d3bb73]/20 rounded-xl p-6 max-w-lg w-full">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-light text-[#e5e4e2]">Nowa umowa</h2>
          <button onClick={onClose} className="text-[#e5e4e2]/60 hover:text-[#e5e4e2]">
            ✕
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm text-[#e5e4e2]/60 mb-2">
              Szablon umowy *
            </label>
            <select
              value={formData.template_id}
              onChange={(e) => setFormData({ ...formData, template_id: e.target.value })}
              className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
            >
              <option value="">Wybierz szablon</option>
              {templates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm text-[#e5e4e2]/60 mb-2">Tytuł umowy *</label>
            <input
              type="text"
              value={formData.title}
              onChange={(e) => setFormData({ ...formData, title: e.target.value })}
              className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
              placeholder="np. Umowa na organizację eventu"
            />
          </div>

          <div>
            <label className="block text-sm text-[#e5e4e2]/60 mb-2">Klient</label>
            <select
              value={formData.client_id}
              onChange={(e) => setFormData({ ...formData, client_id: e.target.value })}
              className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
            >
              <option value="">Wybierz klienta</option>
              {clients.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.company_name ||
                    `${client.first_name} ${client.last_name}`}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm text-[#e5e4e2]/60 mb-2">Event (opcjonalny)</label>
            <select
              value={formData.event_id}
              onChange={(e) => setFormData({ ...formData, event_id: e.target.value })}
              className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
            >
              <option value="">Wybierz event</option>
              {events.map((event) => (
                <option key={event.id} value={event.id}>
                  {event.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex gap-3 mt-6">
          <button
            onClick={handleSubmit}
            className="flex-1 bg-[#d3bb73] text-[#1c1f33] px-4 py-2 rounded-lg font-medium hover:bg-[#d3bb73]/90 transition-colors"
          >
            Dalej
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-[#e5e4e2]/60 hover:bg-[#1c1f33] transition-colors"
          >
            Anuluj
          </button>
        </div>
      </div>
    </div>
  );
}
