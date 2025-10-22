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
  DollarSign,
  UserCheck,
  Hotel,
  UtensilsCrossed,
  Briefcase,
  ChevronRight,
  Bell,
  History,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useSnackbar } from '@/contexts/SnackbarContext';

interface Organization {
  id: string;
  name: string;
  type: 'client' | 'subcontractor';
  businessType: 'company' | 'hotel' | 'restaurant' | 'venue' | 'freelancer' | 'other';
  email: string | null;
  phone: string | null;
  city: string | null;
  status: string;
  rating: number | null;
  contactPersonsCount: number;
  eventsCount: number;
  tags: string[] | null;
  specialization: string[] | null;
  hourlyRate: number | null;
  created_at: string;
}

type Tab = 'clients' | 'subcontractors';
type BusinessTypeFilter = 'all' | 'company' | 'hotel' | 'restaurant' | 'venue' | 'freelancer' | 'other';

export default function ContactsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { showSnackbar } = useSnackbar();

  const [activeTab, setActiveTab] = useState<Tab>((searchParams.get('tab') as Tab) || 'clients');
  const [searchTerm, setSearchTerm] = useState('');
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterBusinessType, setFilterBusinessType] = useState<BusinessTypeFilter>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');

  useEffect(() => {
    const tab = searchParams.get('tab') as Tab;
    if (tab && (tab === 'clients' || tab === 'subcontractors')) {
      setActiveTab(tab);
    }
  }, [searchParams]);

  useEffect(() => {
    fetchOrganizations();
  }, [activeTab]);

  const fetchOrganizations = async () => {
    try {
      setLoading(true);

      const orgType = activeTab === 'clients' ? 'client' : 'subcontractor';

      const { data, error } = await supabase
        .from('organizations')
        .select(`
          *,
          contact_persons(count),
          events:events(count)
        `)
        .eq('organization_type', orgType)
        .order('created_at', { ascending: false });

      if (error) throw error;

      const orgs: Organization[] = (data || []).map((org: any) => ({
        id: org.id,
        name: org.name,
        type: org.organization_type as 'client' | 'subcontractor',
        businessType: org.business_type as any,
        email: org.email,
        phone: org.phone,
        city: org.city,
        status: org.status,
        rating: org.rating,
        contactPersonsCount: org.contact_persons?.[0]?.count || 0,
        eventsCount: org.events?.[0]?.count || 0,
        tags: org.tags,
        specialization: org.specialization,
        hourlyRate: org.hourly_rate,
        created_at: org.created_at,
      }));

      setOrganizations(orgs);
    } catch (error: any) {
      showSnackbar(error.message || 'Błąd pobierania danych', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleTabChange = (tab: Tab) => {
    setActiveTab(tab);
    router.push(`/crm/contacts?tab=${tab}`);
    setSearchTerm('');
    setFilterBusinessType('all');
    setFilterStatus('all');
  };

  const filteredOrganizations = organizations.filter((org) => {
    const matchesSearch =
      org.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      org.email?.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesBusinessType = filterBusinessType === 'all' || org.businessType === filterBusinessType;
    const matchesStatus = filterStatus === 'all' || org.status === filterStatus;

    return matchesSearch && matchesBusinessType && matchesStatus;
  });

  const getBusinessTypeIcon = (type: string) => {
    switch (type) {
      case 'hotel':
        return <Hotel className="w-10 h-10 text-[#d3bb73]" />;
      case 'restaurant':
        return <UtensilsCrossed className="w-10 h-10 text-[#d3bb73]" />;
      case 'venue':
        return <Building2 className="w-10 h-10 text-[#d3bb73]" />;
      case 'freelancer':
        return <User className="w-10 h-10 text-[#d3bb73]" />;
      case 'company':
        return <Briefcase className="w-10 h-10 text-[#d3bb73]" />;
      default:
        return <Building2 className="w-10 h-10 text-[#d3bb73]" />;
    }
  };

  const getBusinessTypeLabel = (type: string) => {
    switch (type) {
      case 'hotel':
        return 'Hotel';
      case 'restaurant':
        return 'Restauracja';
      case 'venue':
        return 'Sala eventowa';
      case 'freelancer':
        return 'Freelancer';
      case 'company':
        return 'Firma';
      default:
        return 'Inna';
    }
  };

  return (
    <div className="min-h-screen bg-[#0f1119] p-6">
      <div className="max-w-7xl mx-auto">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-[#d3bb73] mb-2">Kontakty</h1>
          <p className="text-gray-400">Zarządzaj organizacjami, klientami i podwykonawcami</p>
        </div>

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
                {activeTab === 'clients' ? organizations.length : 0}
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
                {activeTab === 'subcontractors' ? organizations.length : 0}
              </span>
            </div>
            {activeTab === 'subcontractors' && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#d3bb73]" />
            )}
          </button>
        </div>

        <div className="mb-6 flex flex-col sm:flex-row gap-4">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
            <input
              type="text"
              placeholder="Szukaj organizacji..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-[#1a1d2e] border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-[#d3bb73]"
            />
          </div>

          {activeTab === 'clients' && (
            <select
              value={filterBusinessType}
              onChange={(e) => setFilterBusinessType(e.target.value as BusinessTypeFilter)}
              className="px-4 py-2 bg-[#1a1d2e] border border-gray-700 rounded-lg text-white focus:outline-none focus:border-[#d3bb73]"
            >
              <option value="all">Wszystkie typy</option>
              <option value="company">Firmy</option>
              <option value="hotel">Hotele</option>
              <option value="restaurant">Restauracje</option>
              <option value="venue">Sale eventowe</option>
              <option value="other">Inne</option>
            </select>
          )}

          {activeTab === 'subcontractors' && (
            <select
              value={filterBusinessType}
              onChange={(e) => setFilterBusinessType(e.target.value as BusinessTypeFilter)}
              className="px-4 py-2 bg-[#1a1d2e] border border-gray-700 rounded-lg text-white focus:outline-none focus:border-[#d3bb73]"
            >
              <option value="all">Wszystkie typy</option>
              <option value="company">Firmy</option>
              <option value="freelancer">Freelancerzy</option>
            </select>
          )}

          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="px-4 py-2 bg-[#1a1d2e] border border-gray-700 rounded-lg text-white focus:outline-none focus:border-[#d3bb73]"
          >
            <option value="all">Wszystkie statusy</option>
            <option value="active">Aktywne</option>
            <option value="inactive">Nieaktywne</option>
            {activeTab === 'subcontractors' && <option value="blacklisted">Czarna lista</option>}
          </select>

          <button
            onClick={() => router.push('/crm/contacts/new')}
            className="px-4 py-2 bg-[#d3bb73] text-[#0f1119] rounded-lg hover:bg-[#c4a859] transition-colors flex items-center space-x-2 whitespace-nowrap font-medium"
          >
            <Plus className="w-5 h-5" />
            <span>Dodaj kontakt</span>
          </button>
        </div>

        {loading ? (
          <div className="flex justify-center items-center py-12">
            <div className="text-gray-400">Ładowanie...</div>
          </div>
        ) : (
          <OrganizationsList
            organizations={filteredOrganizations}
            router={router}
            activeTab={activeTab}
            getBusinessTypeIcon={getBusinessTypeIcon}
            getBusinessTypeLabel={getBusinessTypeLabel}
          />
        )}
      </div>
    </div>
  );
}

function OrganizationsList({
  organizations,
  router,
  activeTab,
  getBusinessTypeIcon,
  getBusinessTypeLabel,
}: {
  organizations: Organization[];
  router: any;
  activeTab: Tab;
  getBusinessTypeIcon: (type: string) => JSX.Element;
  getBusinessTypeLabel: (type: string) => string;
}) {
  if (organizations.length === 0) {
    return (
      <div className="text-center py-12">
        <Building2 className="w-16 h-16 text-gray-600 mx-auto mb-4" />
        <p className="text-gray-400">Brak organizacji do wyświetlenia</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {organizations.map((org) => (
        <div
          key={org.id}
          onClick={() => router.push(`/crm/contacts/${org.id}`)}
          className="bg-[#1a1d2e] border border-gray-700 rounded-lg p-5 hover:border-[#d3bb73] transition-all cursor-pointer group"
        >
          <div className="flex items-start justify-between mb-3">
            <div className="flex items-center space-x-3 flex-1 min-w-0">
              {getBusinessTypeIcon(org.businessType)}
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold text-white truncate group-hover:text-[#d3bb73] transition-colors">
                  {org.name}
                </h3>
                <div className="flex items-center space-x-2 mt-1">
                  <span className="text-xs px-2 py-0.5 rounded bg-[#d3bb73]/20 text-[#d3bb73]">
                    {getBusinessTypeLabel(org.businessType)}
                  </span>
                  <span className={`text-xs px-2 py-0.5 rounded ${
                    org.status === 'active' ? 'bg-green-500/20 text-green-400' :
                    org.status === 'blacklisted' ? 'bg-red-500/20 text-red-400' :
                    'bg-gray-500/20 text-gray-400'
                  }`}>
                    {org.status === 'active' ? 'Aktywne' : org.status === 'blacklisted' ? 'Czarna lista' : 'Nieaktywne'}
                  </span>
                </div>
              </div>
            </div>
            <ChevronRight className="w-5 h-5 text-gray-600 group-hover:text-[#d3bb73] transition-colors flex-shrink-0" />
          </div>

          <div className="space-y-2 text-sm mb-4">
            {org.email && (
              <div className="flex items-center text-gray-400">
                <Mail className="w-4 h-4 mr-2 flex-shrink-0" />
                <span className="truncate">{org.email}</span>
              </div>
            )}
            {org.phone && (
              <div className="flex items-center text-gray-400">
                <Phone className="w-4 h-4 mr-2 flex-shrink-0" />
                <span>{org.phone}</span>
              </div>
            )}
            {org.city && (
              <div className="flex items-center text-gray-400">
                <MapPin className="w-4 h-4 mr-2 flex-shrink-0" />
                <span>{org.city}</span>
              </div>
            )}
          </div>

          <div className="pt-4 border-t border-gray-700 space-y-3">
            <div className="flex items-center justify-between text-sm">
              <div className="flex items-center text-gray-400">
                <Users className="w-4 h-4 mr-1" />
                <span>{org.contactPersonsCount} {org.contactPersonsCount === 1 ? 'osoba' : 'osób'}</span>
              </div>
              {activeTab === 'clients' && (
                <div className="flex items-center text-gray-400">
                  <Calendar className="w-4 h-4 mr-1" />
                  <span>{org.eventsCount} wydarzeń</span>
                </div>
              )}
              {activeTab === 'subcontractors' && org.rating && (
                <div className="flex items-center text-[#d3bb73]">
                  <Star className="w-4 h-4 mr-1 fill-current" />
                  <span>{org.rating.toFixed(1)}</span>
                </div>
              )}
            </div>

            {activeTab === 'subcontractors' && org.hourlyRate && (
              <div className="flex items-center text-gray-400 text-sm">
                <DollarSign className="w-4 h-4 mr-1" />
                <span>{org.hourlyRate} zł/h</span>
              </div>
            )}

            {activeTab === 'subcontractors' && org.specialization && org.specialization.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {org.specialization.slice(0, 2).map((spec, idx) => (
                  <span key={idx} className="text-xs px-2 py-1 bg-[#d3bb73]/10 text-[#d3bb73] rounded">
                    {spec}
                  </span>
                ))}
                {org.specialization.length > 2 && (
                  <span className="text-xs px-2 py-1 bg-gray-700 text-gray-400 rounded">
                    +{org.specialization.length - 2}
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
