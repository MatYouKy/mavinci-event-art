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
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useSnackbar } from '@/contexts/SnackbarContext';

interface Contact {
  id: string;
  contact_type: 'organization' | 'contact' | 'subcontractor' | 'individual';
  first_name: string;
  last_name: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  mobile: string | null;
  city: string | null;
  status: string;
  rating: number | null;
  created_at: string;
  organizations_count?: number;
  contacts_count?: number;
}

type ContactTypeFilter = 'all' | 'organization' | 'contact' | 'subcontractor' | 'individual';

const contactTypeLabels = {
  organization: 'Organizacja',
  contact: 'Kontakt',
  subcontractor: 'Podwykonawca',
  individual: 'Osoba prywatna',
};

const contactTypeIcons = {
  organization: Building2,
  contact: User,
  subcontractor: Briefcase,
  individual: UserCircle,
};

export default function ContactsPage() {
  const router = useRouter();
  const { showSnackbar } = useSnackbar();

  const [searchTerm, setSearchTerm] = useState('');
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState<ContactTypeFilter>('all');

  useEffect(() => {
    fetchContacts();
  }, [filterType]);

  const fetchContacts = async () => {
    try {
      setLoading(true);

      let query = supabase
        .from('contacts')
        .select('*')
        .order('created_at', { ascending: false });

      if (filterType !== 'all') {
        query = query.eq('contact_type', filterType);
      }

      const { data, error } = await query;

      if (error) throw error;

      const contactsWithCounts = await Promise.all(
        (data || []).map(async (contact) => {
          if (contact.contact_type === 'organization' || contact.contact_type === 'subcontractor') {
            const { count: contactsCount } = await supabase
              .from('contact_organizations')
              .select('*', { count: 'exact', head: true })
              .eq('organization_id', contact.id)
              .eq('is_current', true);

            return { ...contact, contacts_count: contactsCount || 0 };
          } else if (contact.contact_type === 'contact') {
            const { count: orgsCount } = await supabase
              .from('contact_organizations')
              .select('*', { count: 'exact', head: true })
              .eq('contact_id', contact.id)
              .eq('is_current', true);

            return { ...contact, organizations_count: orgsCount || 0 };
          }
          return contact;
        })
      );

      setContacts(contactsWithCounts);
    } catch (error: any) {
      console.error('Error fetching contacts:', error);
      showSnackbar('Błąd podczas ładowania kontaktów', 'error');
    } finally {
      setLoading(false);
    }
  };

  const filteredContacts = contacts.filter((contact) =>
    contact.full_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    contact.email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    contact.phone?.includes(searchTerm)
  );

  const getContactTypeColor = (type: string) => {
    switch (type) {
      case 'organization':
        return 'bg-blue-900/30 text-blue-400';
      case 'contact':
        return 'bg-green-900/30 text-green-400';
      case 'subcontractor':
        return 'bg-purple-900/30 text-purple-400';
      case 'individual':
        return 'bg-gray-700/30 text-gray-400';
      default:
        return 'bg-gray-700/30 text-gray-400';
    }
  };

  const handleNewContact = () => {
    router.push('/crm/contacts/new');
  };

  return (
    <div className="min-h-screen bg-[#0f1119] p-6">
      <div className="max-w-7xl mx-auto">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-white mb-2">Kontakty</h1>
            <p className="text-gray-400">
              Zarządzaj organizacjami, kontaktami, podwykonawcami i osobami prywatnymi
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

          <div className="flex gap-2 flex-wrap">
            {(['all', 'organization', 'contact', 'subcontractor', 'individual'] as const).map((type) => (
              <button
                key={type}
                onClick={() => setFilterType(type)}
                className={`px-4 py-2 rounded-lg transition-colors flex items-center space-x-2 ${
                  filterType === type
                    ? 'bg-[#d3bb73] text-[#0f1119]'
                    : 'bg-[#1a1d2e] text-gray-400 hover:bg-[#252837]'
                }`}
              >
                {type !== 'all' && (() => {
                  const Icon = contactTypeIcons[type];
                  return <Icon className="w-4 h-4" />;
                })()}
                <span>{type === 'all' ? 'Wszystkie' : contactTypeLabels[type]}</span>
              </button>
            ))}
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
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredContacts.map((contact) => {
              const Icon = contactTypeIcons[contact.contact_type];
              return (
                <div
                  key={contact.id}
                  onClick={() => router.push(`/crm/contacts/${contact.id}`)}
                  className="bg-[#1a1d2e] border border-gray-700 rounded-lg p-4 hover:border-[#d3bb73] transition-colors cursor-pointer"
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center space-x-3">
                      <div className="w-12 h-12 bg-[#d3bb73]/10 rounded-full flex items-center justify-center">
                        <Icon className="w-6 h-6 text-[#d3bb73]" />
                      </div>
                      <div>
                        <h3 className="text-white font-semibold">{contact.full_name}</h3>
                        <span
                          className={`text-xs px-2 py-1 rounded-full ${getContactTypeColor(
                            contact.contact_type
                          )}`}
                        >
                          {contactTypeLabels[contact.contact_type]}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2 text-sm">
                    {contact.email && (
                      <div className="flex items-center space-x-2 text-gray-400">
                        <Mail className="w-4 h-4" />
                        <span className="truncate">{contact.email}</span>
                      </div>
                    )}
                    {(contact.phone || contact.mobile) && (
                      <div className="flex items-center space-x-2 text-gray-400">
                        <Phone className="w-4 h-4" />
                        <span>{contact.mobile || contact.phone}</span>
                      </div>
                    )}
                    {contact.city && (
                      <div className="flex items-center space-x-2 text-gray-400">
                        <MapPin className="w-4 h-4" />
                        <span>{contact.city}</span>
                      </div>
                    )}
                  </div>

                  <div className="mt-3 pt-3 border-t border-gray-700 flex items-center justify-between text-xs text-gray-500">
                    <span>{new Date(contact.created_at).toLocaleDateString('pl-PL')}</span>
                    {(contact.contact_type === 'organization' ||
                      contact.contact_type === 'subcontractor') && (
                      <div className="flex items-center space-x-1">
                        <Users className="w-3 h-3" />
                        <span>{contact.contacts_count || 0} kontaktów</span>
                      </div>
                    )}
                    {contact.contact_type === 'contact' && contact.organizations_count! > 0 && (
                      <div className="flex items-center space-x-1">
                        <Building2 className="w-3 h-3" />
                        <span>{contact.organizations_count} org.</span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
