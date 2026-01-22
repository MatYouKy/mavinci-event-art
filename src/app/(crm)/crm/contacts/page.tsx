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
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useAppDispatch, useAppSelector } from '@/store/hooks';

import { useClients } from './hooks/useClient';
import { ClientEntityType, ContactRow } from './types';

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
  const { list: contacts, loading, create, updateById, deleteById } = useClients('all');

  const [searchTerm, setSearchTerm] = useState('');
  // const [contacts, setLocalContacts] = useState<UnifiedContact[]>([]);
  const [activeTab, setActiveTab] = useState<TabFilter>('all');
  const [typeFilter, setTypeFilter] = useState<ContactTypeFilter>('all');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');

  // const fetchAllContacts = async () => {
  //   try {
  //     setLoading(true);
  //     dispatch(setContactsLoading(true));
  //     const unified: UnifiedContact[] = [];

  //     // Pobierz wszystkie relacje jednym zapytaniem
  //     const { data: allRelations, error: relError } = await supabase
  //       .from('contact_organizations')
  //       .select('organization_id, contact_id')
  //       .eq('is_current', true);

  //     if (relError) throw relError;

  //     // Stwórz mapy liczników
  //     const orgContactCounts = new Map<string, number>();
  //     const contactOrgCounts = new Map<string, number>();

  //     for (const rel of allRelations || []) {
  //       if (rel.organization_id) {
  //         orgContactCounts.set(
  //           rel.organization_id,
  //           (orgContactCounts.get(rel.organization_id) || 0) + 1
  //         );
  //       }
  //       if (rel.contact_id) {
  //         contactOrgCounts.set(
  //           rel.contact_id,
  //           (contactOrgCounts.get(rel.contact_id) || 0) + 1
  //         );
  //       }
  //     }

  //     if (activeTab === 'all') {
  //       // Pobierz organizacje (NIE podwykonawców)
  //       const { data: orgs, error: orgsError } = await supabase
  //         .from('organizations')
  //         .select('*')
  //         .eq('organization_type', 'client')
  //         .order('created_at', { ascending: false });

  //       if (orgsError) throw orgsError;

  //       // Mapuj organizacje (bez dodatkowych zapytań!)
  //       for (const org of orgs || []) {
  //         unified.push({
  //           id: org.id,
  //           type: 'organization',
  //           source: 'organizations',
  //           name: org.alias || org.name,
  //           email: org.email,
  //           phone: org.phone,
  //           mobile: null,
  //           city: org.city,
  //           status: org.status,
  //           rating: null,
  //           avatar_url: null,
  //           tags: null,
  //           created_at: org.created_at,
  //           contacts_count: orgContactCounts.get(org.id) || 0,
  //         });
  //       }

  //       // Pobierz kontakty (typ 'contact' i 'individual')
  //       const { data: contactsData, error: contactsError } = await supabase
  //         .from('contacts')
  //         .select('*')
  //         .in('contact_type', ['contact', 'individual'])
  //         .order('created_at', { ascending: false });

  //       if (contactsError) throw contactsError;

  //       // Mapuj kontakty (bez dodatkowych zapytań!)
  //       for (const contact of contactsData || []) {
  //         unified.push({
  //           id: contact.id,
  //           type: contact.contact_type === 'individual' ? 'individual' : 'contact',
  //           source: 'contacts',
  //           name: contact.full_name,
  //           email: contact.email,
  //           phone: contact.phone,
  //           mobile: contact.mobile,
  //           city: contact.city,
  //           status: contact.status,
  //           rating: contact.rating,
  //           avatar_url: contact.avatar_url,
  //           tags: contact.tags,
  //           created_at: contact.created_at,
  //           organizations_count: contactOrgCounts.get(contact.id) || 0,
  //         });
  //       }
  //     } else if (activeTab === 'subcontractors') {
  //       // Pobierz tylko podwykonawców
  //       const { data: subs, error: subsError } = await supabase
  //         .from('organizations')
  //         .select('*')
  //         .eq('organization_type', 'subcontractor')
  //         .order('created_at', { ascending: false });

  //       if (subsError) throw subsError;

  //       // Mapuj podwykonawców (bez dodatkowych zapytań!)
  //       for (const sub of subs || []) {
  //         unified.push({
  //           id: sub.id,
  //           type: 'organization',
  //           source: 'organizations',
  //           name: sub.alias || sub.name,
  //           email: sub.email,
  //           phone: sub.phone,
  //           mobile: null,
  //           city: sub.city,
  //           status: sub.status,
  //           rating: null,
  //           avatar_url: null,
  //           tags: sub.specialization,
  //           created_at: sub.created_at,
  //           contacts_count: orgContactCounts.get(sub.id) || 0,
  //         });
  //       }
  //     }

  //     setLocalContacts(unified);
  //     dispatch(setContacts(unified));
  //   } catch (error: any) {
  //     console.error('Error fetching contacts:', error);
  //     showSnackbar('Błąd podczas ładowania kontaktów', 'error');
  //   } finally {
  //     setLoading(false);
  //     dispatch(setContactsLoading(false));
  //   }
  // };

  const filteredContacts = contacts
    .filter((contact) => {
      // Filtrowanie według typu (tylko dla taba "Wszystkie kontakty")
      if (activeTab === 'all' && typeFilter !== 'all') {
        return contact.entityType === typeFilter;
      }
      return true;
    })
    .filter(
      (contact) =>
        contact.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        contact.email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        contact.phone?.includes(searchTerm) ||
        contact.mobile?.includes(searchTerm),
    );

  const getContactTypeColor = (type: ClientEntityType) => {
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

  const handleContactClick = (contact: ContactRow) => {
    router.push(`/crm/contacts/${contact.id}`);
  };

  const renderGridView = () => (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {filteredContacts.map((contact) => {
        const Icon = contactTypeIcons[contact.entityType as ClientEntityType];
        return (
          <div
            key={`${contact.source}-${contact.id}`}
            onClick={() => handleContactClick(contact.raw as ContactRow)}
            className="cursor-pointer rounded-lg border border-gray-700 bg-[#1a1d2e] p-4 transition-colors hover:border-[#d3bb73]"
          >
            <div className="mb-3 flex flex-col items-center text-center">
              {contact.avatar_url ? (
                <img
                  src={contact.avatar_url}
                  alt={contact.name}
                  className="mb-3 h-20 w-20 rounded-full object-cover"
                />
              ) : (
                <div className="mb-3 flex h-20 w-20 items-center justify-center rounded-full bg-[#d3bb73]/10">
                  <Icon className="h-10 w-10 text-[#d3bb73]" />
                </div>
              )}
              <h3 className="mb-1 font-semibold text-white">{contact.name}</h3>
              <span
                className={`rounded-full px-2 py-1 text-xs ${getContactTypeColor(
                  contact.entityType as ClientEntityType,
                )}`}
              >
                {contactTypeLabels[contact.entityType as ClientEntityType]}
              </span>
            </div>

            <div className="space-y-2 text-sm">
              {contact.email && (
                <div className="flex items-center space-x-2 text-gray-400">
                  <Mail className="h-4 w-4 flex-shrink-0" />
                  <span className="truncate">{contact.email}</span>
                </div>
              )}
              {(contact.phone || contact.mobile) && (
                <div className="flex items-center space-x-2 text-gray-400">
                  <Phone className="h-4 w-4 flex-shrink-0" />
                  <span>{contact.mobile || contact.phone}</span>
                </div>
              )}
              {contact.city && (
                <div className="flex items-center space-x-2 text-gray-400">
                  <MapPin className="h-4 w-4 flex-shrink-0" />
                  <span>{contact.city}</span>
                </div>
              )}
              {contact.rating && (
                <div className="flex items-center space-x-1 text-[#d3bb73]">
                  {[...Array(5)].map((_, i) => (
                    <Star
                      key={i}
                      className={`h-3 w-3 ${
                        i < contact.rating! ? 'fill-current' : 'stroke-current'
                      }`}
                    />
                  ))}
                </div>
              )}
              {contact.tags && contact.tags.length > 0 && (
                <div className="flex items-center space-x-1 text-gray-400">
                  <Tag className="h-3 w-3 flex-shrink-0" />
                  <span className="truncate text-xs">{contact.tags.join(', ')}</span>
                </div>
              )}
            </div>

            <div className="mt-3 flex items-center justify-between border-t border-gray-700 pt-3 text-xs text-gray-500">
              <span>{new Date(contact.created_at).toLocaleDateString('pl-PL')}</span>
              {contact.entityType === 'organization' && (
                <div className="flex items-center space-x-1">
                  <Users className="h-3 w-3" />
                  <span>{contact.contacts_count || 0}</span>
                </div>
              )}
              {contact.entityType === 'contact' && contact.organizations_count! > 0 && (
                <div className="flex items-center space-x-1">
                  <Building2 className="h-3 w-3" />
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
        const Icon = contactTypeIcons[contact.entityType as ClientEntityType];
        return (
          <div
            key={`${contact.source}-${contact.id}`}
            onClick={() => handleContactClick(contact.raw as ContactRow)}
            className="cursor-pointer rounded-lg border border-gray-700 bg-[#1a1d2e] p-3 transition-colors hover:border-[#d3bb73]"
          >
            <div className="flex items-center gap-4">
              {contact.avatar_url ? (
                <img
                  src={contact.avatar_url}
                  alt={contact.name}
                  className="h-12 w-12 flex-shrink-0 rounded-full object-cover"
                />
              ) : (
                <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-[#d3bb73]/10">
                  <Icon className="h-6 w-6 text-[#d3bb73]" />
                </div>
              )}

              <div className="grid min-w-0 flex-1 grid-cols-5 items-center gap-4">
                <div className="col-span-1">
                  <h3 className="truncate font-semibold text-white">{contact.name}</h3>
                  <span
                    className={`inline-block rounded-full px-2 py-0.5 text-xs ${getContactTypeColor(
                      contact.entityType as ClientEntityType,
                    )}`}
                  >
                    {contactTypeLabels[contact.entityType as ClientEntityType]}
                  </span>
                </div>

                <div className="col-span-1 flex items-center space-x-2 text-sm text-gray-400">
                  {contact.email && (
                    <>
                      <Mail className="h-4 w-4 flex-shrink-0" />
                      <span className="truncate">{contact.email}</span>
                    </>
                  )}
                </div>

                <div className="col-span-1 flex items-center space-x-2 text-sm text-gray-400">
                  {(contact.phone || contact.mobile) && (
                    <>
                      <Phone className="h-4 w-4 flex-shrink-0" />
                      <span>{contact.mobile || contact.phone}</span>
                    </>
                  )}
                </div>

                <div className="col-span-1 flex items-center space-x-2 text-sm text-gray-400">
                  {contact.city && (
                    <>
                      <MapPin className="h-4 w-4 flex-shrink-0" />
                      <span>{contact.city}</span>
                    </>
                  )}
                  {contact.tags && contact.tags.length > 0 && (
                    <>
                      <Tag className="ml-2 h-4 w-4 flex-shrink-0" />
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
                          className={`h-3 w-3 ${
                            i < contact.rating! ? 'fill-current' : 'stroke-current'
                          }`}
                        />
                      ))}
                    </div>
                  )}
                  {contact.entityType === 'organization' && (
                    <div className="flex items-center space-x-1 text-gray-500">
                      <Users className="h-4 w-4" />
                      <span>{contact.contacts_count || 0}</span>
                    </div>
                  )}
                  {contact.entityType === 'contact' && contact.organizations_count! > 0 && (
                    <div className="flex items-center space-x-1 text-gray-500">
                      <Building2 className="h-4 w-4" />
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
      <div className="mx-auto max-w-7xl">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="mb-2 text-3xl font-bold text-white">Kontakty</h1>
            <p className="text-gray-400">
              Zarządzaj organizacjami, kontaktami i osobami prywatnymi
            </p>
          </div>
          <button
            onClick={handleNewContact}
            className="flex items-center space-x-2 rounded-lg bg-[#d3bb73] px-4 py-2 font-medium text-[#0f1119] transition-colors hover:bg-[#c4a859]"
          >
            <Plus className="h-5 w-5" />
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
              className={`flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium transition-colors ${
                activeTab === 'all'
                  ? 'border-[#d3bb73] text-[#d3bb73]'
                  : 'border-transparent text-gray-400 hover:text-white'
              }`}
            >
              <Users className="h-4 w-4" />
              Wszystkie kontakty
            </button>
            <button
              onClick={() => setActiveTab('subcontractors')}
              className={`flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium transition-colors ${
                activeTab === 'subcontractors'
                  ? 'border-[#d3bb73] text-[#d3bb73]'
                  : 'border-transparent text-gray-400 hover:text-white'
              }`}
            >
              <UserCheck className="h-4 w-4" />
              Podwykonawcy
            </button>
          </div>
        </div>

        {activeTab === 'all' && (
          <div className="mb-6 flex flex-wrap gap-2">
            <button
              onClick={() => setTypeFilter('all')}
              className={`rounded-lg px-4 py-2 text-sm transition-colors ${
                typeFilter === 'all'
                  ? 'bg-[#d3bb73] text-[#0f1119]'
                  : 'bg-[#1a1d2e] text-gray-400 hover:bg-[#252837]'
              }`}
            >
              Wszystkie typy
            </button>
            <button
              onClick={() => setTypeFilter('organization')}
              className={`flex items-center space-x-2 rounded-lg px-4 py-2 text-sm transition-colors ${
                typeFilter === 'organization'
                  ? 'bg-[#d3bb73] text-[#0f1119]'
                  : 'bg-[#1a1d2e] text-gray-400 hover:bg-[#252837]'
              }`}
            >
              <Building2 className="h-4 w-4" />
              <span>Organizacje</span>
            </button>
            <button
              onClick={() => setTypeFilter('contact')}
              className={`flex items-center space-x-2 rounded-lg px-4 py-2 text-sm transition-colors ${
                typeFilter === 'contact'
                  ? 'bg-[#d3bb73] text-[#0f1119]'
                  : 'bg-[#1a1d2e] text-gray-400 hover:bg-[#252837]'
              }`}
            >
              <User className="h-4 w-4" />
              <span>Kontakty</span>
            </button>
            <button
              onClick={() => setTypeFilter('individual')}
              className={`flex items-center space-x-2 rounded-lg px-4 py-2 text-sm transition-colors ${
                typeFilter === 'individual'
                  ? 'bg-[#d3bb73] text-[#0f1119]'
                  : 'bg-[#1a1d2e] text-gray-400 hover:bg-[#252837]'
              }`}
            >
              <UserCircle className="h-4 w-4" />
              <span>Osoby prywatne</span>
            </button>
          </div>
        )}

        <div className="mb-6 flex flex-col gap-4 md:flex-row">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 transform text-gray-400" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Szukaj kontaktów..."
              className="w-full rounded-lg border border-gray-700 bg-[#1a1d2e] py-2 pl-10 pr-4 text-white focus:border-[#d3bb73] focus:outline-none"
            />
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => setViewMode('grid')}
              className={`rounded-lg p-2 transition-colors ${
                viewMode === 'grid'
                  ? 'bg-[#d3bb73] text-[#0f1119]'
                  : 'bg-[#1a1d2e] text-gray-400 hover:bg-[#252837]'
              }`}
              title="Widok kafelków"
            >
              <LayoutGrid className="h-5 w-5" />
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={`rounded-lg p-2 transition-colors ${
                viewMode === 'list'
                  ? 'bg-[#d3bb73] text-[#0f1119]'
                  : 'bg-[#1a1d2e] text-gray-400 hover:bg-[#252837]'
              }`}
              title="Widok listy"
            >
              <List className="h-5 w-5" />
            </button>
          </div>
        </div>

        {loading ? (
          <div className="py-12 text-center">
            <div className="inline-block h-8 w-8 animate-spin rounded-full border-b-2 border-[#d3bb73]"></div>
          </div>
        ) : filteredContacts.length === 0 ? (
          <div className="rounded-lg border border-gray-700 bg-[#1a1d2e] p-12 text-center">
            <User className="mx-auto mb-4 h-16 w-16 text-gray-600" />
            <p className="mb-4 text-gray-400">
              {searchTerm ? 'Nie znaleziono kontaktów' : 'Brak kontaktów'}
            </p>
            <button
              onClick={handleNewContact}
              className="rounded-lg bg-[#d3bb73] px-4 py-2 text-[#0f1119] transition-colors hover:bg-[#c4a859]"
            >
              Dodaj pierwszy kontakt
            </button>
          </div>
        ) : (
          <>
            {viewMode === 'grid' ? renderGridView() : renderListView()}
            <div className="mt-6 text-center text-sm text-gray-500">
              Wyświetlono {filteredContacts.length}{' '}
              {activeTab === 'all' ? 'kontaktów' : 'podwykonawców'}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
