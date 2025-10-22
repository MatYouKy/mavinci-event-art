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
  Users,
  Briefcase,
  UserCircle,
  LayoutGrid,
  List,
  Star,
  Tag,
  UserCheck,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import {
  setContacts,
  setLoading as setContactsLoading,
  selectContacts,
  selectContactsLoading,
  selectShouldRefetch,
} from '@/store/slices/contactsSlice';

interface UnifiedContact {
  id: string;
  type: 'organization' | 'contact' | 'individual';
  source: 'organizations' | 'contacts';
  name: string;
  email: string | null;
  phone: string | null;
  mobile: string | null;
  city: string | null;
  status: string;
  rating: number | null;
  avatar_url: string | null;
  tags: string[] | null;
  created_at: string;
  contacts_count?: number;
  organizations_count?: number;
}

type ViewMode = 'grid' | 'list';
type TabFilter = 'all' | 'subcontractors';
type ContactTypeFilter = 'all' | 'organization' | 'contact' | 'individual';

const contactTypeLabels = {
  organization: 'Organizacja',
  contact: 'Kontakt',
  individual: 'Osoba prywatna',
};

const contactTypeIcons = {
  organization: Building2,
  contact: User,
  individual: UserCircle,
};

export default function ContactsPage() {
  const router = useRouter();
  const { showSnackbar } = useSnackbar();
  const dispatch = useAppDispatch();

  const cachedContacts = useAppSelector(selectContacts);
  const cachedLoading = useAppSelector(selectContactsLoading);
  const shouldRefetch = useAppSelector(selectShouldRefetch);

  const [searchTerm, setSearchTerm] = useState('');
  const [contacts, setLocalContacts] = useState<UnifiedContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabFilter>('all');
  const [typeFilter, setTypeFilter] = useState<ContactTypeFilter>('all');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');

  useEffect(() => {
    // Sprawdź czy mamy cache i czy jest aktualny
    if (cachedContacts.length > 0 && !shouldRefetch) {
      setLocalContacts(cachedContacts);
      setLoading(false);
    } else {
      fetchAllContacts();
    }
  }, [activeTab, cachedContacts, shouldRefetch]);

  const fetchAllContacts = async () => {
    try {
      setLoading(true);
      const unified: UnifiedContact[] = [];

      if (activeTab === 'all') {
        // Pobierz organizacje (NIE podwykonawców)
        const { data: orgs, error: orgsError } = await supabase
          .from('organizations')
          .select('*')
          .eq('organization_type', 'client')
          .order('created_at', { ascending: false });

        if (orgsError) throw orgsError;

        // Mapuj organizacje
        for (const org of orgs || []) {
          const { count: contactsCount } = await supabase
            .from('contact_organizations')
            .select('*', { count: 'exact', head: true })
            .eq('organization_id', org.id)
            .eq('is_current', true);

          unified.push({
            id: org.id,
            type: 'organization',
            source: 'organizations',
            name: org.alias || org.name,
            email: org.email,
            phone: org.phone,
            mobile: null,
            city: org.city,
            status: org.status,
            rating: null,
            avatar_url: null,
            tags: null,
            created_at: org.created_at,
            contacts_count: contactsCount || 0,
          });
        }

        // Pobierz kontakty (typ 'contact' i 'individual')
        const { data: contactsData, error: contactsError } = await supabase
          .from('contacts')
          .select('*')
          .in('contact_type', ['contact', 'individual'])
          .order('created_at', { ascending: false });

        if (contactsError) throw contactsError;

        // Mapuj kontakty
        for (const contact of contactsData || []) {
          const { count: orgsCount } = await supabase
            .from('contact_organizations')
            .select('*', { count: 'exact', head: true })
            .eq('contact_id', contact.id)
            .eq('is_current', true);

          unified.push({
            id: contact.id,
            type: contact.contact_type === 'individual' ? 'individual' : 'contact',
            source: 'contacts',
            name: contact.full_name,
            email: contact.email,
            phone: contact.phone,
            mobile: contact.mobile,
            city: contact.city,
            status: contact.status,
            rating: contact.rating,
            avatar_url: contact.avatar_url,
            tags: contact.tags,
            created_at: contact.created_at,
            organizations_count: orgsCount || 0,
          });
        }
      } else if (activeTab === 'subcontractors') {
        // Pobierz tylko podwykonawców
        const { data: subs, error: subsError } = await supabase
          .from('organizations')
          .select('*')
          .eq('organization_type', 'subcontractor')
          .order('created_at', { ascending: false });

        if (subsError) throw subsError;

        // Mapuj podwykonawców
        for (const sub of subs || []) {
          const { count: contactsCount } = await supabase
            .from('contact_organizations')
            .select('*', { count: 'exact', head: true })
            .eq('organization_id', sub.id)
            .eq('is_current', true);

          unified.push({
            id: sub.id,
            type: 'organization',
            source: 'organizations',
            name: sub.alias || sub.name,
            email: sub.email,
            phone: sub.phone,
            mobile: null,
            city: sub.city,
            status: sub.status,
            rating: null,
            avatar_url: null,
            tags: sub.specialization,
            created_at: sub.created_at,
            contacts_count: contactsCount || 0,
          });
        }
      }

      setLocalContacts(unified);
      dispatch(setContacts(unified));
    } catch (error: any) {
      console.error('Error fetching contacts:', error);
      showSnackbar('Błąd podczas ładowania kontaktów', 'error');
    } finally {
      setLoading(false);
      dispatch(setContactsLoading(false));
    }
  };

  const filteredContacts = contacts
    .filter((contact) => {
      // Filtrowanie według typu (tylko dla taba "Wszystkie kontakty")
      if (activeTab === 'all' && typeFilter !== 'all') {
        return contact.type === typeFilter;
      }
      return true;
    })
    .filter((contact) =>
      contact.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      contact.email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      contact.phone?.includes(searchTerm) ||
      contact.mobile?.includes(searchTerm)
    );

  const getContactTypeColor = (type: string) => {
    switch (type) {
      case 'organization':
        return 'bg-blue-900/30 text-blue-400';
      case 'contact':
        return 'bg-green-900/30 text-green-400';
      case 'individual':
        return 'bg-gray-700/30 text-gray-400';
      default:
        return 'bg-gray-700/30 text-gray-400';
    }
  };

  const handleNewContact = () => {
    router.push('/crm/contacts/new');
  };

  const handleContactClick = (contact: UnifiedContact) => {
    router.push(`/crm/contacts/${contact.id}`);
  };

  const renderGridView = () => (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {filteredContacts.map((contact) => {
        const Icon = contactTypeIcons[contact.type];
        return (
          <div
            key={`${contact.source}-${contact.id}`}
            onClick={() => handleContactClick(contact)}
            className="bg-[#1a1d2e] border border-gray-700 rounded-lg p-4 hover:border-[#d3bb73] transition-colors cursor-pointer"
          >
            <div className="flex flex-col items-center text-center mb-3">
              {contact.avatar_url ? (
                <img
                  src={contact.avatar_url}
                  alt={contact.name}
                  className="w-20 h-20 rounded-full object-cover mb-3"
                />
              ) : (
                <div className="w-20 h-20 bg-[#d3bb73]/10 rounded-full flex items-center justify-center mb-3">
                  <Icon className="w-10 h-10 text-[#d3bb73]" />
                </div>
              )}
              <h3 className="text-white font-semibold mb-1">{contact.name}</h3>
              <span
                className={`text-xs px-2 py-1 rounded-full ${getContactTypeColor(
                  contact.type
                )}`}
              >
                {contactTypeLabels[contact.type]}
              </span>
            </div>

            <div className="space-y-2 text-sm">
              {contact.email && (
                <div className="flex items-center space-x-2 text-gray-400">
                  <Mail className="w-4 h-4 flex-shrink-0" />
                  <span className="truncate">{contact.email}</span>
                </div>
              )}
              {(contact.phone || contact.mobile) && (
                <div className="flex items-center space-x-2 text-gray-400">
                  <Phone className="w-4 h-4 flex-shrink-0" />
                  <span>{contact.mobile || contact.phone}</span>
                </div>
              )}
              {contact.city && (
                <div className="flex items-center space-x-2 text-gray-400">
                  <MapPin className="w-4 h-4 flex-shrink-0" />
                  <span>{contact.city}</span>
                </div>
              )}
              {contact.rating && (
                <div className="flex items-center space-x-1 text-[#d3bb73]">
                  {[...Array(5)].map((_, i) => (
                    <Star
                      key={i}
                      className={`w-3 h-3 ${
                        i < contact.rating! ? 'fill-current' : 'stroke-current'
                      }`}
                    />
                  ))}
                </div>
              )}
              {contact.tags && contact.tags.length > 0 && (
                <div className="flex items-center space-x-1 text-gray-400">
                  <Tag className="w-3 h-3 flex-shrink-0" />
                  <span className="text-xs truncate">{contact.tags.join(', ')}</span>
                </div>
              )}
            </div>

            <div className="mt-3 pt-3 border-t border-gray-700 flex items-center justify-between text-xs text-gray-500">
              <span>{new Date(contact.created_at).toLocaleDateString('pl-PL')}</span>
              {contact.type === 'organization' && (
                <div className="flex items-center space-x-1">
                  <Users className="w-3 h-3" />
                  <span>{contact.contacts_count || 0}</span>
                </div>
              )}
              {contact.type === 'contact' && contact.organizations_count! > 0 && (
                <div className="flex items-center space-x-1">
                  <Building2 className="w-3 h-3" />
                  <span>{contact.organizations_count}</span>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );

  const renderListView = () => (
    <div className="space-y-2">
      {filteredContacts.map((contact) => {
        const Icon = contactTypeIcons[contact.type];
        return (
          <div
            key={`${contact.source}-${contact.id}`}
            onClick={() => handleContactClick(contact)}
            className="bg-[#1a1d2e] border border-gray-700 rounded-lg p-3 hover:border-[#d3bb73] transition-colors cursor-pointer"
          >
            <div className="flex items-center gap-4">
              {contact.avatar_url ? (
                <img
                  src={contact.avatar_url}
                  alt={contact.name}
                  className="w-12 h-12 rounded-full object-cover flex-shrink-0"
                />
              ) : (
                <div className="w-12 h-12 bg-[#d3bb73]/10 rounded-full flex items-center justify-center flex-shrink-0">
                  <Icon className="w-6 h-6 text-[#d3bb73]" />
                </div>
              )}

              <div className="flex-1 min-w-0 grid grid-cols-5 gap-4 items-center">
                <div className="col-span-1">
                  <h3 className="text-white font-semibold truncate">{contact.name}</h3>
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full inline-block ${getContactTypeColor(
                      contact.type
                    )}`}
                  >
                    {contactTypeLabels[contact.type]}
                  </span>
                </div>

                <div className="col-span-1 text-sm text-gray-400 flex items-center space-x-2">
                  {contact.email && (
                    <>
                      <Mail className="w-4 h-4 flex-shrink-0" />
                      <span className="truncate">{contact.email}</span>
                    </>
                  )}
                </div>

                <div className="col-span-1 text-sm text-gray-400 flex items-center space-x-2">
                  {(contact.phone || contact.mobile) && (
                    <>
                      <Phone className="w-4 h-4 flex-shrink-0" />
                      <span>{contact.mobile || contact.phone}</span>
                    </>
                  )}
                </div>

                <div className="col-span-1 text-sm text-gray-400 flex items-center space-x-2">
                  {contact.city && (
                    <>
                      <MapPin className="w-4 h-4 flex-shrink-0" />
                      <span>{contact.city}</span>
                    </>
                  )}
                  {contact.tags && contact.tags.length > 0 && (
                    <>
                      <Tag className="w-4 h-4 flex-shrink-0 ml-2" />
                      <span>{contact.tags[0]}</span>
                      {contact.tags.length > 1 && (
                        <span className="text-xs">+{contact.tags.length - 1}</span>
                      )}
                    </>
                  )}
                </div>

                <div className="col-span-1 flex items-center justify-end space-x-4 text-sm">
                  {contact.rating && (
                    <div className="flex items-center space-x-1 text-[#d3bb73]">
                      {[...Array(5)].map((_, i) => (
                        <Star
                          key={i}
                          className={`w-3 h-3 ${
                            i < contact.rating! ? 'fill-current' : 'stroke-current'
                          }`}
                        />
                      ))}
                    </div>
                  )}
                  {contact.type === 'organization' && (
                    <div className="flex items-center space-x-1 text-gray-500">
                      <Users className="w-4 h-4" />
                      <span>{contact.contacts_count || 0}</span>
                    </div>
                  )}
                  {contact.type === 'contact' && contact.organizations_count! > 0 && (
                    <div className="flex items-center space-x-1 text-gray-500">
                      <Building2 className="w-4 h-4" />
                      <span>{contact.organizations_count}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );

  return (
    <div className="min-h-screen bg-[#0f1119] p-6">
      <div className="max-w-7xl mx-auto">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-white mb-2">Kontakty</h1>
            <p className="text-gray-400">
              Zarządzaj organizacjami, kontaktami i osobami prywatnymi
            </p>
          </div>
          <button
            onClick={handleNewContact}
            className="px-4 py-2 bg-[#d3bb73] text-[#0f1119] rounded-lg hover:bg-[#c4a859] transition-colors flex items-center space-x-2 font-medium"
          >
            <Plus className="w-5 h-5" />
            <span>Nowy kontakt</span>
          </button>
        </div>

        <div className="mb-6 border-b border-gray-700">
          <div className="flex gap-0">
            <button
              onClick={() => {
                setActiveTab('all');
                setTypeFilter('all');
              }}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors border-b-2 ${
                activeTab === 'all'
                  ? 'border-[#d3bb73] text-[#d3bb73]'
                  : 'border-transparent text-gray-400 hover:text-white'
              }`}
            >
              <Users className="w-4 h-4" />
              Wszystkie kontakty
            </button>
            <button
              onClick={() => setActiveTab('subcontractors')}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors border-b-2 ${
                activeTab === 'subcontractors'
                  ? 'border-[#d3bb73] text-[#d3bb73]'
                  : 'border-transparent text-gray-400 hover:text-white'
              }`}
            >
              <UserCheck className="w-4 h-4" />
              Podwykonawcy
            </button>
          </div>
        </div>

        {activeTab === 'all' && (
          <div className="mb-6 flex gap-2 flex-wrap">
            <button
              onClick={() => setTypeFilter('all')}
              className={`px-4 py-2 rounded-lg transition-colors text-sm ${
                typeFilter === 'all'
                  ? 'bg-[#d3bb73] text-[#0f1119]'
                  : 'bg-[#1a1d2e] text-gray-400 hover:bg-[#252837]'
              }`}
            >
              Wszystkie typy
            </button>
            <button
              onClick={() => setTypeFilter('organization')}
              className={`px-4 py-2 rounded-lg transition-colors flex items-center space-x-2 text-sm ${
                typeFilter === 'organization'
                  ? 'bg-[#d3bb73] text-[#0f1119]'
                  : 'bg-[#1a1d2e] text-gray-400 hover:bg-[#252837]'
              }`}
            >
              <Building2 className="w-4 h-4" />
              <span>Organizacje</span>
            </button>
            <button
              onClick={() => setTypeFilter('contact')}
              className={`px-4 py-2 rounded-lg transition-colors flex items-center space-x-2 text-sm ${
                typeFilter === 'contact'
                  ? 'bg-[#d3bb73] text-[#0f1119]'
                  : 'bg-[#1a1d2e] text-gray-400 hover:bg-[#252837]'
              }`}
            >
              <User className="w-4 h-4" />
              <span>Kontakty</span>
            </button>
            <button
              onClick={() => setTypeFilter('individual')}
              className={`px-4 py-2 rounded-lg transition-colors flex items-center space-x-2 text-sm ${
                typeFilter === 'individual'
                  ? 'bg-[#d3bb73] text-[#0f1119]'
                  : 'bg-[#1a1d2e] text-gray-400 hover:bg-[#252837]'
              }`}
            >
              <UserCircle className="w-4 h-4" />
              <span>Osoby prywatne</span>
            </button>
          </div>
        )}

        <div className="mb-6 flex flex-col md:flex-row gap-4">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Szukaj kontaktów..."
              className="w-full pl-10 pr-4 py-2 bg-[#1a1d2e] border border-gray-700 rounded-lg text-white focus:outline-none focus:border-[#d3bb73]"
            />
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => setViewMode('grid')}
              className={`p-2 rounded-lg transition-colors ${
                viewMode === 'grid'
                  ? 'bg-[#d3bb73] text-[#0f1119]'
                  : 'bg-[#1a1d2e] text-gray-400 hover:bg-[#252837]'
              }`}
              title="Widok kafelków"
            >
              <LayoutGrid className="w-5 h-5" />
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={`p-2 rounded-lg transition-colors ${
                viewMode === 'list'
                  ? 'bg-[#d3bb73] text-[#0f1119]'
                  : 'bg-[#1a1d2e] text-gray-400 hover:bg-[#252837]'
              }`}
              title="Widok listy"
            >
              <List className="w-5 h-5" />
            </button>
          </div>
        </div>

        {loading ? (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-[#d3bb73]"></div>
          </div>
        ) : filteredContacts.length === 0 ? (
          <div className="bg-[#1a1d2e] border border-gray-700 rounded-lg p-12 text-center">
            <User className="w-16 h-16 text-gray-600 mx-auto mb-4" />
            <p className="text-gray-400 mb-4">
              {searchTerm ? 'Nie znaleziono kontaktów' : 'Brak kontaktów'}
            </p>
            <button
              onClick={handleNewContact}
              className="px-4 py-2 bg-[#d3bb73] text-[#0f1119] rounded-lg hover:bg-[#c4a859] transition-colors"
            >
              Dodaj pierwszy kontakt
            </button>
          </div>
        ) : (
          <>
            {viewMode === 'grid' ? renderGridView() : renderListView()}
            <div className="mt-6 text-center text-sm text-gray-500">
              Wyświetlono {filteredContacts.length} {activeTab === 'all' ? 'kontaktów' : 'podwykonawców'}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
