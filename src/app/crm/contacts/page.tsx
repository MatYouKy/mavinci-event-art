'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
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
  Users,
  Star,
  TrendingUp,
  DollarSign,
  AlertCircle,
  UserCheck,
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

interface Subcontractor {
  id: string;
  company_name: string;
  contact_person: string | null;
  email: string | null;
  phone: string | null;
  specialization: string[];
  hourly_rate: number;
  status: 'active' | 'inactive' | 'blacklisted';
  rating: number | null;
  payment_terms: string;
  created_at: string;
}

type Tab = 'clients' | 'subcontractors';

export default function ContactsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { showSnackbar } = useSnackbar();

  const [activeTab, setActiveTab] = useState<Tab>((searchParams.get('tab') as Tab) || 'clients');
  const [searchTerm, setSearchTerm] = useState('');
  const [clients, setClients] = useState<Client[]>([]);
  const [subcontractors, setSubcontractors] = useState<Subcontractor[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');

  useEffect(() => {
    const tab = searchParams.get('tab') as Tab;
    if (tab && (tab === 'clients' || tab === 'subcontractors')) {
      setActiveTab(tab);
    }
  }, [searchParams]);

  useEffect(() => {
    if (activeTab === 'clients') {
      fetchClients();
    } else {
      fetchSubcontractors();
    }
  }, [activeTab]);

  const fetchClients = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('clients')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setClients(data || []);
    } catch (error: any) {
      showSnackbar(error.message || 'Błąd pobierania klientów', 'error');
    } finally {
      setLoading(false);
    }
  };

  const fetchSubcontractors = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('subcontractors')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setSubcontractors(data || []);
    } catch (error: any) {
      showSnackbar(error.message || 'Błąd pobierania podwykonawców', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleTabChange = (tab: Tab) => {
    setActiveTab(tab);
    router.push(`/crm/contacts?tab=${tab}`);
    setSearchTerm('');
    setFilterCategory('all');
    setFilterStatus('all');
  };

  const filteredClients = clients.filter((client) => {
    const matchesSearch =
      client.company_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      client.first_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      client.last_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      client.email?.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesCategory = filterCategory === 'all' || client.category === filterCategory;
    const matchesStatus = filterStatus === 'all' || client.status === filterStatus;

    return matchesSearch && matchesCategory && matchesStatus;
  });

  const filteredSubcontractors = subcontractors.filter((sub) => {
    const matchesSearch =
      sub.company_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      sub.contact_person?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      sub.email?.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesStatus = filterStatus === 'all' || sub.status === filterStatus;

    return matchesSearch && matchesStatus;
  });

  return (
    <div className="min-h-screen bg-[#0f1119] p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-[#d3bb73] mb-2">Kontakty</h1>
          <p className="text-gray-400">Zarządzaj klientami i podwykonawcami</p>
        </div>

        {/* Tabs */}
        <div className="flex space-x-1 mb-6 border-b border-gray-700">
          <button
            onClick={() => handleTabChange('clients')}
            className={`px-6 py-3 font-medium transition-colors relative ${
              activeTab === 'clients'
                ? 'text-[#d3bb73]'
                : 'text-gray-400 hover:text-gray-300'
            }`}
          >
            <div className="flex items-center space-x-2">
              <Building2 className="w-5 h-5" />
              <span>Klienci</span>
              <span className="ml-2 px-2 py-0.5 text-xs rounded-full bg-gray-700 text-gray-300">
                {clients.length}
              </span>
            </div>
            {activeTab === 'clients' && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#d3bb73]" />
            )}
          </button>

          <button
            onClick={() => handleTabChange('subcontractors')}
            className={`px-6 py-3 font-medium transition-colors relative ${
              activeTab === 'subcontractors'
                ? 'text-[#d3bb73]'
                : 'text-gray-400 hover:text-gray-300'
            }`}
          >
            <div className="flex items-center space-x-2">
              <UserCheck className="w-5 h-5" />
              <span>Podwykonawcy</span>
              <span className="ml-2 px-2 py-0.5 text-xs rounded-full bg-gray-700 text-gray-300">
                {subcontractors.length}
              </span>
            </div>
            {activeTab === 'subcontractors' && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#d3bb73]" />
            )}
          </button>
        </div>

        {/* Filters */}
        <div className="mb-6 flex flex-col sm:flex-row gap-4">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
            <input
              type="text"
              placeholder={activeTab === 'clients' ? 'Szukaj klientów...' : 'Szukaj podwykonawców...'}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-[#1a1d2e] border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-[#d3bb73]"
            />
          </div>

          {activeTab === 'clients' && (
            <select
              value={filterCategory}
              onChange={(e) => setFilterCategory(e.target.value)}
              className="px-4 py-2 bg-[#1a1d2e] border border-gray-700 rounded-lg text-white focus:outline-none focus:border-[#d3bb73]"
            >
              <option value="all">Wszystkie kategorie</option>
              <option value="corporate">Korporacje</option>
              <option value="small_business">Małe firmy</option>
              <option value="individual">Osoby prywatne</option>
            </select>
          )}

          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="px-4 py-2 bg-[#1a1d2e] border border-gray-700 rounded-lg text-white focus:outline-none focus:border-[#d3bb73]"
          >
            <option value="all">Wszystkie statusy</option>
            {activeTab === 'clients' ? (
              <>
                <option value="active">Aktywni</option>
                <option value="inactive">Nieaktywni</option>
                <option value="lead">Potencjalni</option>
              </>
            ) : (
              <>
                <option value="active">Aktywni</option>
                <option value="inactive">Nieaktywni</option>
                <option value="blacklisted">Czarna lista</option>
              </>
            )}
          </select>

          <button
            onClick={() => router.push(activeTab === 'clients' ? '/crm/clients/new' : '/crm/subcontractors/new')}
            className="px-4 py-2 bg-[#d3bb73] text-[#0f1119] rounded-lg hover:bg-[#c4a859] transition-colors flex items-center space-x-2 whitespace-nowrap"
          >
            <Plus className="w-5 h-5" />
            <span>Dodaj {activeTab === 'clients' ? 'klienta' : 'podwykonawcę'}</span>
          </button>
        </div>

        {/* Content */}
        {loading ? (
          <div className="flex justify-center items-center py-12">
            <div className="text-gray-400">Ładowanie...</div>
          </div>
        ) : activeTab === 'clients' ? (
          <ClientsList clients={filteredClients} router={router} />
        ) : (
          <SubcontractorsList subcontractors={filteredSubcontractors} router={router} />
        )}
      </div>
    </div>
  );
}

function ClientsList({ clients, router }: { clients: Client[]; router: any }) {
  if (clients.length === 0) {
    return (
      <div className="text-center py-12">
        <Building2 className="w-16 h-16 text-gray-600 mx-auto mb-4" />
        <p className="text-gray-400">Brak klientów do wyświetlenia</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {clients.map((client) => (
        <div
          key={client.id}
          onClick={() => router.push(`/crm/clients/${client.id}`)}
          className="bg-[#1a1d2e] border border-gray-700 rounded-lg p-5 hover:border-[#d3bb73] transition-colors cursor-pointer"
        >
          <div className="flex items-start justify-between mb-3">
            <div className="flex items-center space-x-3">
              {client.client_type === 'company' ? (
                <Building2 className="w-10 h-10 text-[#d3bb73]" />
              ) : (
                <User className="w-10 h-10 text-[#d3bb73]" />
              )}
              <div>
                <h3 className="font-semibold text-white">
                  {client.client_type === 'company'
                    ? client.company_name
                    : `${client.first_name} ${client.last_name}`}
                </h3>
                <span className={`text-xs px-2 py-1 rounded ${
                  client.status === 'active' ? 'bg-green-500/20 text-green-400' :
                  client.status === 'lead' ? 'bg-blue-500/20 text-blue-400' :
                  'bg-gray-500/20 text-gray-400'
                }`}>
                  {client.status === 'active' ? 'Aktywny' : client.status === 'lead' ? 'Potencjalny' : 'Nieaktywny'}
                </span>
              </div>
            </div>
          </div>

          <div className="space-y-2 text-sm">
            {client.email && (
              <div className="flex items-center text-gray-400">
                <Mail className="w-4 h-4 mr-2" />
                <span className="truncate">{client.email}</span>
              </div>
            )}
            {client.phone_number && (
              <div className="flex items-center text-gray-400">
                <Phone className="w-4 h-4 mr-2" />
                <span>{client.phone_number}</span>
              </div>
            )}
            {client.address_city && (
              <div className="flex items-center text-gray-400">
                <MapPin className="w-4 h-4 mr-2" />
                <span>{client.address_city}</span>
              </div>
            )}
          </div>

          <div className="mt-4 pt-4 border-t border-gray-700 flex items-center justify-between text-sm">
            <div className="text-gray-400">
              <Calendar className="w-4 h-4 inline mr-1" />
              {client.total_events} wydarzeń
            </div>
            {client.tags && client.tags.length > 0 && (
              <div className="flex items-center space-x-1">
                <Tag className="w-4 h-4 text-[#d3bb73]" />
                <span className="text-[#d3bb73]">{client.tags.length}</span>
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function SubcontractorsList({ subcontractors, router }: { subcontractors: Subcontractor[]; router: any }) {
  if (subcontractors.length === 0) {
    return (
      <div className="text-center py-12">
        <UserCheck className="w-16 h-16 text-gray-600 mx-auto mb-4" />
        <p className="text-gray-400">Brak podwykonawców do wyświetlenia</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {subcontractors.map((sub) => (
        <div
          key={sub.id}
          onClick={() => router.push(`/crm/subcontractors/${sub.id}`)}
          className="bg-[#1a1d2e] border border-gray-700 rounded-lg p-5 hover:border-[#d3bb73] transition-colors cursor-pointer"
        >
          <div className="flex items-start justify-between mb-3">
            <div className="flex items-center space-x-3">
              <Users className="w-10 h-10 text-[#d3bb73]" />
              <div>
                <h3 className="font-semibold text-white">{sub.company_name}</h3>
                <span className={`text-xs px-2 py-1 rounded ${
                  sub.status === 'active' ? 'bg-green-500/20 text-green-400' :
                  sub.status === 'blacklisted' ? 'bg-red-500/20 text-red-400' :
                  'bg-gray-500/20 text-gray-400'
                }`}>
                  {sub.status === 'active' ? 'Aktywny' : sub.status === 'blacklisted' ? 'Czarna lista' : 'Nieaktywny'}
                </span>
              </div>
            </div>
          </div>

          <div className="space-y-2 text-sm">
            {sub.contact_person && (
              <div className="flex items-center text-gray-400">
                <User className="w-4 h-4 mr-2" />
                <span>{sub.contact_person}</span>
              </div>
            )}
            {sub.email && (
              <div className="flex items-center text-gray-400">
                <Mail className="w-4 h-4 mr-2" />
                <span className="truncate">{sub.email}</span>
              </div>
            )}
            {sub.phone && (
              <div className="flex items-center text-gray-400">
                <Phone className="w-4 h-4 mr-2" />
                <span>{sub.phone}</span>
              </div>
            )}
          </div>

          <div className="mt-4 pt-4 border-t border-gray-700">
            <div className="flex items-center justify-between text-sm mb-2">
              <div className="flex items-center text-gray-400">
                <DollarSign className="w-4 h-4 mr-1" />
                <span>{sub.hourly_rate} zł/h</span>
              </div>
              {sub.rating && (
                <div className="flex items-center text-[#d3bb73]">
                  <Star className="w-4 h-4 mr-1 fill-current" />
                  <span>{sub.rating.toFixed(1)}</span>
                </div>
              )}
            </div>
            {sub.specialization && sub.specialization.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {sub.specialization.slice(0, 3).map((spec, idx) => (
                  <span key={idx} className="text-xs px-2 py-1 bg-[#d3bb73]/20 text-[#d3bb73] rounded">
                    {spec}
                  </span>
                ))}
                {sub.specialization.length > 3 && (
                  <span className="text-xs px-2 py-1 bg-gray-700 text-gray-400 rounded">
                    +{sub.specialization.length - 3}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
