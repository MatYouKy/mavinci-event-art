'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Building2,
  Mail,
  Phone,
  MapPin,
  Star,
  DollarSign,
  FileText,
  Plus,
  Edit,
  Save,
  X,
  User,
  UserCircle,
  History,
  Users,
  Globe,
  CreditCard,
  Loader2,
  ExternalLink,
  Trash2,
  StickyNote,
  Receipt,
  Calendar,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { parseGoogleMapsUrl } from '@/lib/gus';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';
import { OrganizationLocationPicker } from '@/components/crm/OrganizationLocationPicker';

interface Organization {
  id: string;
  organization_type: 'client' | 'subcontractor';
  business_type: 'company' | 'hotel' | 'restaurant' | 'venue' | 'freelancer' | 'other';
  name: string;
  alias: string | null;
  nip: string | null;
  address: string | null;
  city: string | null;
  postal_code: string | null;
  country: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  status: string;
  rating: number | null;
  tags: string[] | null;
  notes: string | null;
  specialization: string[] | null;
  hourly_rate: number | null;
  payment_terms: string | null;
  bank_account: string | null;
  google_maps_url: string | null;
  latitude: number | null;
  longitude: number | null;
  location_notes: string | null;
  location_id: string | null;
  created_at: string;
  updated_at: string;
}

interface Contact {
  id: string;
  contact_type: 'contact' | 'individual';
  first_name: string;
  last_name: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  mobile: string | null;
  business_phone: string | null;
  position: string | null;
  nip: string | null;
  pesel: string | null;
  id_number: string | null;
  event_type: string | null;
  event_details: string | null;
  address: string | null;
  city: string | null;
  postal_code: string | null;
  status: string;
  rating: number | null;
  tags: string[] | null;
  notes: string | null;
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
}

interface ContactPerson {
  id: string;
  first_name: string;
  last_name: string;
  full_name?: string;
  position: string | null;
  email: string | null;
  phone: string | null;
  mobile: string | null;
  is_primary: boolean;
  relation_id?: string;
}

interface OrganizationNote {
  id: string;
  note: string;
  created_at: string;
  created_by: string | null;
  employees?: { name: string; surname: string } | null;
}

interface ContactHistory {
  id: string;
  contact_type: string;
  subject: string;
  description: string | null;
  contact_date: string;
  contacted_by: string | null;
  outcome: string | null;
  next_action: string | null;
}

type TabType = 'details' | 'contacts' | 'notes' | 'history' | 'invoices' | 'events';

const businessTypeLabels = {
  company: 'Firma',
  hotel: 'Hotel',
  restaurant: 'Restauracja',
  venue: 'Miejsce eventowe',
  freelancer: 'Freelancer',
  other: 'Inne',
};

const statusColors = {
  active: 'text-green-400 bg-green-900/30',
  inactive: 'text-gray-400 bg-gray-800/30',
  potential: 'text-blue-400 bg-blue-900/30',
  archived: 'text-red-400 bg-red-900/30',
};

export default function OrganizationDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { showSnackbar } = useSnackbar();
  const organizationId = params.id as string;
  const { currentEmployee } = useCurrentEmployee();

  const [activeTab, setActiveTab] = useState<TabType>('details');
  const [entityType, setEntityType] = useState<'organization' | 'contact' | null>(null);
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [contact, setContact] = useState<Contact | null>(null);
  const [contactPersons, setContactPersons] = useState<ContactPerson[]>([]);
  const [organizationNotes, setOrganizationNotes] = useState<OrganizationNote[]>([]);
  const [history, setHistory] = useState<ContactHistory[]>([]);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [events, setEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editMode, setEditMode] = useState(false);
  const [editedData, setEditedData] = useState<Partial<Organization | Contact>>({});
  const [saving, setSaving] = useState(false);

  const [showAddContactModal, setShowAddContactModal] = useState(false);
  const [addContactMode, setAddContactMode] = useState<'select' | 'create'>('select');
  const [availableContacts, setAvailableContacts] = useState<any[]>([]);
  const [selectedContactId, setSelectedContactId] = useState('');
  const [newContact, setNewContact] = useState({
    first_name: '',
    last_name: '',
    position: '',
    email: '',
    phone: '',
    mobile: '',
    is_primary: false,
  });

  const [newNoteText, setNewNoteText] = useState('');
  const [addingNote, setAddingNote] = useState(false);

  useEffect(() => {
    if (organizationId) {
      fetchData();
    }
  }, [organizationId]);

  useEffect(() => {
    if (activeTab === 'invoices') {
      fetchInvoices();
    } else if (activeTab === 'events') {
      fetchEvents();
    }
  }, [activeTab, organizationId]);

  useEffect(() => {
    const channel = supabase
      .channel('organization_notes_changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'organization_notes',
          filter: `organization_id=eq.${organizationId}`,
        },
        () => {
          fetchNotes();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [organizationId]);

  const fetchData = async () => {
    try {
      setLoading(true);

      // JEDNO zapytanie RPC dla wszystkiego!
      const { data: fullData, error: rpcError } = await supabase
        .rpc('get_contact_full_details', { entity_id: organizationId });

      if (rpcError) throw rpcError;

      if (!fullData || fullData.error) {
        showSnackbar('Nie znaleziono kontaktu', 'error');
        router.push('/crm/contacts');
        return;
      }

      const entityType = fullData.entity_type;
      const entityData = fullData.entity_data;

      if (entityType === 'contact') {
        // To jest kontakt/osoba prywatna
        setEntityType('contact');
        setContact(entityData);
        setLoading(false);
      } else if (entityType === 'organization') {
        // To jest organizacja
        setEntityType('organization');
        setOrganization(entityData);

        // Mapuj kontakty
        const mappedContacts = (fullData.contacts || []).map((c: any) => ({
          id: c.contact_id,
          first_name: c.first_name,
          last_name: c.last_name,
          full_name: c.full_name,
          position: c.position,
          email: c.email,
          phone: c.phone,
          mobile: c.mobile,
          is_primary: c.is_primary,
          relation_id: c.id,
        }));

        setContactPersons(mappedContacts);

        // Mapuj notatki
        const mappedNotes = (fullData.notes || []).map((n: any) => ({
          id: n.id,
          note: n.note,
          created_at: n.created_at,
          created_by: n.created_by,
          employees: n.employee_name ? { name: n.employee_name.split(' ')[0], surname: n.employee_name.split(' ')[1] } : null,
        }));

        setOrganizationNotes(mappedNotes);

        // Mapuj historię
        setHistory(fullData.history || []);

        setLoading(false);
      }
    } catch (error: any) {
      console.error('Error fetching data:', error);
      showSnackbar('Błąd podczas ładowania danych', 'error');
      setLoading(false);
    }
  };

  const fetchNotes = async () => {
    const { data: notesData } = await supabase
      .from('organization_notes')
      .select('*, employees(name, surname)')
      .eq('organization_id', organizationId)
      .order('created_at', { ascending: false });

    setOrganizationNotes(notesData || []);
  };

  const fetchInvoices = async () => {
    const { data: invoicesData } = await supabase
      .from('invoices')
      .select('*')
      .eq('organization_id', organizationId)
      .order('issue_date', { ascending: false });

    setInvoices(invoicesData || []);
  };

  const fetchEvents = async () => {
    const { data: eventsData } = await supabase
      .from('events')
      .select('id, name, event_date, status')
      .eq('organization_id', organizationId)
      .order('event_date', { ascending: false });

    setEvents(eventsData || []);
  };

  const handleEdit = () => {
    setEditMode(true);
    setEditedData({ ...organization });
  };

  const handleCancelEdit = () => {
    setEditMode(false);
    setEditedData({});
  };

  const handleSave = async () => {
    if (!organization) return;

    try {
      setSaving(true);

      const { error } = await supabase
        .from('organizations')
        .update({
          ...editedData,
          updated_at: new Date().toISOString(),
        })
        .eq('id', organization.id);

      if (error) throw error;

      showSnackbar('Dane zaktualizowane', 'success');
      setEditMode(false);
      fetchData();
    } catch (error: any) {
      showSnackbar(error.message || 'Błąd podczas zapisywania', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleParseGoogleMaps = () => {
    if (!editedData.google_maps_url) {
      showSnackbar('Wprowadź URL Google Maps', 'error');
      return;
    }

    try {
      const coords = parseGoogleMapsUrl(editedData.google_maps_url);
      if (coords) {
        setEditedData({
          ...editedData,
          latitude: coords.latitude,
          longitude: coords.longitude,
        });
        showSnackbar('Współrzędne pobrane z URL', 'success');
      } else {
        showSnackbar('Nie udało się odczytać współrzędnych. Sprawdź format linku.', 'error');
      }
    } catch (error: any) {
      showSnackbar(error.message || 'Błąd podczas parsowania URL', 'error');
    }
  };

  const fetchAvailableContacts = async () => {
    try {
      const { data, error } = await supabase
        .from('contacts')
        .select('id, full_name, first_name, last_name, email, phone, contact_type')
        .in('contact_type', ['contact', 'individual']);

      if (error) throw error;

      const alreadyLinkedIds = contactPersons.map(cp => cp.id);
      const available = (data || []).filter(c => !alreadyLinkedIds.includes(c.id));

      setAvailableContacts(available);
    } catch (error: any) {
      console.error('Error fetching contacts:', error);
    }
  };

  const handleLinkExistingContact = async () => {
    if (!selectedContactId) {
      showSnackbar('Wybierz osobę kontaktową', 'error');
      return;
    }

    try {
      const { error } = await supabase
        .from('contact_organizations')
        .insert({
          contact_id: selectedContactId,
          organization_id: organizationId,
          is_current: true,
        });

      if (error) throw error;

      showSnackbar('Osoba kontaktowa przypisana do organizacji', 'success');
      setShowAddContactModal(false);
      setSelectedContactId('');
      setAddContactMode('select');
      fetchData();
    } catch (error: any) {
      showSnackbar(error.message || 'Błąd podczas przypisywania', 'error');
    }
  };

  const handleAddContact = async () => {
    if (!newContact.first_name.trim() || !newContact.last_name.trim()) {
      showSnackbar('Wprowadź imię i nazwisko', 'error');
      return;
    }

    try {
      const fullName = `${newContact.first_name} ${newContact.last_name}`.trim();

      const { data: newContactData, error: contactError } = await supabase
        .from('contacts')
        .insert({
          first_name: newContact.first_name,
          last_name: newContact.last_name,
          full_name: fullName,
          email: newContact.email || null,
          phone: newContact.phone || null,
          mobile: newContact.mobile || null,
          contact_type: 'contact',
          status: 'active',
          created_by: currentEmployee?.id || null,
        })
        .select()
        .single();

      if (contactError) throw contactError;

      const { error: relationError } = await supabase
        .from('contact_organizations')
        .insert({
          contact_id: newContactData.id,
          organization_id: organizationId,
          position: newContact.position || null,
          is_primary: newContact.is_primary,
          is_current: true,
        });

      if (relationError) throw relationError;

      showSnackbar('Osoba kontaktowa dodana', 'success');
      setShowAddContactModal(false);
      setNewContact({
        first_name: '',
        last_name: '',
        position: '',
        email: '',
        phone: '',
        mobile: '',
        is_primary: false,
      });
      fetchData();
    } catch (error: any) {
      showSnackbar(error.message || 'Błąd podczas dodawania', 'error');
    }
  };

  const handleAddNote = async () => {
    if (!newNoteText.trim()) {
      showSnackbar('Wprowadź treść notatki', 'error');
      return;
    }

    try {
      setAddingNote(true);

      const { error } = await supabase.from('organization_notes').insert({
        organization_id: organizationId,
        note: newNoteText,
        created_by: currentEmployee?.id || null,
      });

      if (error) throw error;

      showSnackbar('Notatka dodana', 'success');
      setNewNoteText('');
    } catch (error: any) {
      showSnackbar(error.message || 'Błąd podczas dodawania notatki', 'error');
    } finally {
      setAddingNote(false);
    }
  };

  const handleDeleteNote = async (noteId: string) => {
    if (!confirm('Czy na pewno chcesz usunąć tę notatkę?')) return;

    try {
      const { error } = await supabase.from('organization_notes').delete().eq('id', noteId);

      if (error) throw error;

      showSnackbar('Notatka usunięta', 'success');
    } catch (error: any) {
      showSnackbar(error.message || 'Błąd podczas usuwania', 'error');
    }
  };

  const handleDeleteContact = async (relationId: string) => {
    if (!confirm('Czy na pewno chcesz usunąć powiązanie tej osoby z organizacją?')) return;

    try {
      const { error } = await supabase
        .from('contact_organizations')
        .delete()
        .eq('id', relationId);

      if (error) throw error;

      showSnackbar('Powiązanie usunięte', 'success');
      fetchData();
    } catch (error: any) {
      showSnackbar(error.message || 'Błąd podczas usuwania', 'error');
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0f1119] flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-[#d3bb73]" />
      </div>
    );
  }

  if (!organization) {
    return null;
  }

  const displayName = organization.alias || organization.name;

  const renderRating = (rating: number | null) => {
    if (!rating) return null;
    return (
      <div className="flex items-center space-x-1">
        {[1, 2, 3, 4, 5].map((star) => (
          <Star
            key={star}
            className={`w-4 h-4 ${
              star <= rating ? 'fill-yellow-400 text-yellow-400' : 'text-gray-600'
            }`}
          />
        ))}
      </div>
    );
  };

  // Renderowanie dla kontaktu/osoby prywatnej
  if (entityType === 'contact' && contact) {
    const Icon = contact.contact_type === 'individual' ? UserCircle : User;
    return (
      <div className="min-h-screen bg-[#0f1119] p-6">
        <div className="max-w-7xl mx-auto">
          <div className="mb-6 flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <button
                onClick={() => router.push('/crm/contacts')}
                className="p-2 hover:bg-[#1a1d2e] rounded-lg transition-colors"
              >
                <ArrowLeft className="w-6 h-6 text-gray-400" />
              </button>
              <div>
                <div className="flex items-center space-x-3">
                  <Icon className="w-8 h-8 text-[#d3bb73]" />
                  <h1 className="text-3xl font-bold text-white">{contact.full_name}</h1>
                  <span
                    className={`px-3 py-1 rounded-full text-xs font-medium ${
                      contact.contact_type === 'individual'
                        ? 'bg-gray-700/30 text-gray-400'
                        : 'bg-green-900/30 text-green-400'
                    }`}
                  >
                    {contact.contact_type === 'individual' ? 'Osoba prywatna' : 'Kontakt'}
                  </span>
                </div>
                {contact.position && (
                  <p className="text-gray-400 mt-1">{contact.position}</p>
                )}
              </div>
            </div>
          </div>

          {/* Dane kontaktu */}
          <div className="bg-[#1a1d2e] border border-gray-700 rounded-lg p-6">
            <h2 className="text-xl font-semibold text-white mb-4">Dane kontaktowe</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {contact.email && (
                <div className="flex items-center space-x-3">
                  <Mail className="w-5 h-5 text-[#d3bb73]" />
                  <div>
                    <p className="text-sm text-gray-400">Email</p>
                    <p className="text-white">{contact.email}</p>
                  </div>
                </div>
              )}
              {contact.phone && (
                <div className="flex items-center space-x-3">
                  <Phone className="w-5 h-5 text-[#d3bb73]" />
                  <div>
                    <p className="text-sm text-gray-400">Telefon prywatny</p>
                    <p className="text-white">{contact.phone}</p>
                  </div>
                </div>
              )}
              {contact.business_phone && (
                <div className="flex items-center space-x-3">
                  <Phone className="w-5 h-5 text-[#d3bb73]" />
                  <div>
                    <p className="text-sm text-gray-400">Telefon firmowy</p>
                    <p className="text-white">{contact.business_phone}</p>
                  </div>
                </div>
              )}
              {contact.city && (
                <div className="flex items-center space-x-3">
                  <MapPin className="w-5 h-5 text-[#d3bb73]" />
                  <div>
                    <p className="text-sm text-gray-400">Miasto</p>
                    <p className="text-white">{contact.city}</p>
                  </div>
                </div>
              )}
              {contact.nip && (
                <div className="flex items-center space-x-3">
                  <FileText className="w-5 h-5 text-[#d3bb73]" />
                  <div>
                    <p className="text-sm text-gray-400">NIP</p>
                    <p className="text-white">{contact.nip}</p>
                  </div>
                </div>
              )}
              {contact.pesel && (
                <div className="flex items-center space-x-3">
                  <CreditCard className="w-5 h-5 text-[#d3bb73]" />
                  <div>
                    <p className="text-sm text-gray-400">PESEL</p>
                    <p className="text-white">{contact.pesel}</p>
                  </div>
                </div>
              )}
              {contact.id_number && (
                <div className="flex items-center space-x-3">
                  <CreditCard className="w-5 h-5 text-[#d3bb73]" />
                  <div>
                    <p className="text-sm text-gray-400">Numer dowodu</p>
                    <p className="text-white">{contact.id_number}</p>
                  </div>
                </div>
              )}
              {contact.event_type && (
                <div className="flex items-center space-x-3">
                  <Star className="w-5 h-5 text-[#d3bb73]" />
                  <div>
                    <p className="text-sm text-gray-400">Rodzaj uroczystości</p>
                    <p className="text-white capitalize">{contact.event_type}</p>
                  </div>
                </div>
              )}
            </div>
            {contact.event_details && (
              <div className="mt-6 pt-6 border-t border-gray-700">
                <p className="text-sm text-gray-400 mb-2">Szczegóły uroczystości</p>
                <p className="text-white">{contact.event_details}</p>
              </div>
            )}
            {contact.notes && (
              <div className="mt-6 pt-6 border-t border-gray-700">
                <p className="text-sm text-gray-400 mb-2">Notatki</p>
                <p className="text-white whitespace-pre-wrap">{contact.notes}</p>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Renderowanie dla organizacji
  if (!organization) {
    return (
      <div className="min-h-screen bg-[#0f1119] p-6 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-12 h-12 text-[#d3bb73] animate-spin mx-auto mb-4" />
          <p className="text-gray-400">Ładowanie...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0f1119] p-6">
      <div className="max-w-7xl mx-auto">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <button
              onClick={() => router.push('/crm/contacts')}
              className="p-2 hover:bg-[#1a1d2e] rounded-lg transition-colors"
            >
              <ArrowLeft className="w-6 h-6 text-gray-400" />
            </button>
            <div>
              <div className="flex items-center space-x-3">
                <Building2 className="w-8 h-8 text-[#d3bb73]" />
                <h1 className="text-3xl font-bold text-white">{displayName}</h1>
                <span
                  className={`px-3 py-1 rounded-full text-xs font-medium ${
                    statusColors[organization.status as keyof typeof statusColors] ||
                    'text-gray-400 bg-gray-800/30'
                  }`}
                >
                  {organization.status}
                </span>
              </div>
              <p className="text-gray-400 mt-1">
                {businessTypeLabels[organization.business_type]} •{' '}
                {organization.organization_type === 'client' ? 'Klient' : 'Podwykonawca'}
              </p>
              {organization.alias && (
                <p className="text-xs text-gray-500 mt-1">Pełna nazwa: {organization.name}</p>
              )}
            </div>
          </div>
          {!editMode ? (
            <button
              onClick={handleEdit}
              className="px-4 py-2 bg-[#d3bb73] text-[#0f1119] rounded-lg hover:bg-[#c4a859] transition-colors flex items-center space-x-2 font-medium"
            >
              <Edit className="w-5 h-5" />
              <span>Edytuj</span>
            </button>
          ) : (
            <div className="flex items-center space-x-2">
              <button
                onClick={handleCancelEdit}
                disabled={saving}
                className="px-4 py-2 border border-gray-700 text-gray-300 rounded-lg hover:bg-[#1a1d2e] transition-colors"
              >
                Anuluj
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-4 py-2 bg-[#d3bb73] text-[#0f1119] rounded-lg hover:bg-[#c4a859] transition-colors flex items-center space-x-2 font-medium disabled:opacity-50"
              >
                {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
                <span>Zapisz</span>
              </button>
            </div>
          )}
        </div>

        <div className="flex space-x-2 mb-6 border-b border-gray-700 overflow-x-auto">
          {[
            { key: 'details' as TabType, label: 'Szczegóły', icon: FileText },
            { key: 'contacts' as TabType, label: `Kontakty (${contactPersons.length})`, icon: Users },
            { key: 'invoices' as TabType, label: `Faktury (${invoices.length})`, icon: Receipt },
            { key: 'events' as TabType, label: `Realizacje (${events.length})`, icon: Calendar },
            { key: 'notes' as TabType, label: `Notatki (${organizationNotes.length})`, icon: StickyNote },
            { key: 'history' as TabType, label: 'Historia', icon: History },
          ].map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={`px-4 py-3 font-medium transition-colors flex items-center space-x-2 ${
                activeTab === key
                  ? 'text-[#d3bb73] border-b-2 border-[#d3bb73]'
                  : 'text-gray-400 hover:text-gray-300'
              }`}
            >
              <Icon className="w-5 h-5" />
              <span>{label}</span>
            </button>
          ))}
        </div>

        {activeTab === 'details' && (
          <div className="space-y-6">
            <div className="bg-[#1a1d2e] border border-gray-700 rounded-lg p-6">
              <h2 className="text-xl font-semibold text-white mb-4">Informacje podstawowe</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-1">Nazwa pełna</label>
                  {editMode ? (
                    <input
                      type="text"
                      value={editedData.name || ''}
                      onChange={(e) => setEditedData({ ...editedData, name: e.target.value })}
                      className="w-full px-4 py-2 bg-[#0f1119] border border-gray-700 rounded-lg text-white focus:outline-none focus:border-[#d3bb73]"
                    />
                  ) : (
                    <p className="text-white">{organization.name}</p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-1">Alias (krótka nazwa)</label>
                  {editMode ? (
                    <input
                      type="text"
                      value={editedData.alias || ''}
                      onChange={(e) => setEditedData({ ...editedData, alias: e.target.value })}
                      className="w-full px-4 py-2 bg-[#0f1119] border border-gray-700 rounded-lg text-white focus:outline-none focus:border-[#d3bb73]"
                      placeholder="np. OMEGA HOTEL"
                    />
                  ) : (
                    <p className="text-white">{organization.alias || '-'}</p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-1">NIP</label>
                  {editMode ? (
                    <input
                      type="text"
                      value={editedData.nip || ''}
                      onChange={(e) => setEditedData({ ...editedData, nip: e.target.value })}
                      className="w-full px-4 py-2 bg-[#0f1119] border border-gray-700 rounded-lg text-white focus:outline-none focus:border-[#d3bb73]"
                    />
                  ) : (
                    <p className="text-white">{organization.nip || '-'}</p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-1 flex items-center space-x-1">
                    <Mail className="w-4 h-4" />
                    <span>Email</span>
                  </label>
                  {editMode ? (
                    <input
                      type="email"
                      value={editedData.email || ''}
                      onChange={(e) => setEditedData({ ...editedData, email: e.target.value })}
                      className="w-full px-4 py-2 bg-[#0f1119] border border-gray-700 rounded-lg text-white focus:outline-none focus:border-[#d3bb73]"
                    />
                  ) : (
                    <p className="text-white">{organization.email || '-'}</p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-1 flex items-center space-x-1">
                    <Phone className="w-4 h-4" />
                    <span>Telefon</span>
                  </label>
                  {editMode ? (
                    <input
                      type="tel"
                      value={editedData.phone || ''}
                      onChange={(e) => setEditedData({ ...editedData, phone: e.target.value })}
                      className="w-full px-4 py-2 bg-[#0f1119] border border-gray-700 rounded-lg text-white focus:outline-none focus:border-[#d3bb73]"
                    />
                  ) : (
                    <p className="text-white">{organization.phone || '-'}</p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-1 flex items-center space-x-1">
                    <Globe className="w-4 h-4" />
                    <span>Strona www</span>
                  </label>
                  {editMode ? (
                    <input
                      type="url"
                      value={editedData.website || ''}
                      onChange={(e) => setEditedData({ ...editedData, website: e.target.value })}
                      className="w-full px-4 py-2 bg-[#0f1119] border border-gray-700 rounded-lg text-white focus:outline-none focus:border-[#d3bb73]"
                    />
                  ) : organization.website ? (
                    <a
                      href={organization.website}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[#d3bb73] hover:underline flex items-center space-x-1"
                    >
                      <span>{organization.website}</span>
                      <ExternalLink className="w-4 h-4" />
                    </a>
                  ) : (
                    <p className="text-white">-</p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-1">Ocena</label>
                  {editMode ? (
                    <select
                      value={editedData.rating || 0}
                      onChange={(e) =>
                        setEditedData({ ...editedData, rating: parseInt(e.target.value) || null })
                      }
                      className="w-full px-4 py-2 bg-[#0f1119] border border-gray-700 rounded-lg text-white focus:outline-none focus:border-[#d3bb73]"
                    >
                      <option value="0">Brak oceny</option>
                      {[1, 2, 3, 4, 5].map((r) => (
                        <option key={r} value={r}>
                          {r} ⭐
                        </option>
                      ))}
                    </select>
                  ) : (
                    <div>{renderRating(organization.rating)}</div>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-1">Status</label>
                  {editMode ? (
                    <select
                      value={editedData.status || 'active'}
                      onChange={(e) => setEditedData({ ...editedData, status: e.target.value })}
                      className="w-full px-4 py-2 bg-[#0f1119] border border-gray-700 rounded-lg text-white focus:outline-none focus:border-[#d3bb73]"
                    >
                      <option value="active">Aktywny</option>
                      <option value="inactive">Nieaktywny</option>
                      <option value="potential">Potencjalny</option>
                      <option value="archived">Zarchiwizowany</option>
                    </select>
                  ) : (
                    <p className="text-white">{organization.status}</p>
                  )}
                </div>
              </div>
            </div>

            <div className="bg-[#1a1d2e] border border-gray-700 rounded-lg p-6">
              <h2 className="text-xl font-semibold text-white mb-4">Adres i lokalizacja</h2>

              <div className="mb-6">
                <label className="block text-sm font-medium text-gray-400 mb-2">
                  Lokalizacja z bazy danych
                </label>
                <OrganizationLocationPicker
                  organizationId={params.id}
                  currentLocationId={editMode ? editedData.location_id : organization.location_id}
                  onLocationChange={(locationId) => setEditedData({ ...editedData, location_id: locationId })}
                  editMode={editMode}
                />
              </div>

              {!(editMode ? editedData.location_id : organization.location_id) && (
                <div className="border-t border-gray-700 pt-6 mt-6">
                  <h3 className="text-lg font-medium text-white mb-4">Ręczny adres (opcjonalnie)</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-gray-400 mb-1">Adres</label>
                  {editMode ? (
                    <input
                      type="text"
                      value={editedData.address || ''}
                      onChange={(e) => setEditedData({ ...editedData, address: e.target.value })}
                      className="w-full px-4 py-2 bg-[#0f1119] border border-gray-700 rounded-lg text-white focus:outline-none focus:border-[#d3bb73]"
                    />
                  ) : (
                    <p className="text-white">{organization.address || '-'}</p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-1">Miasto</label>
                  {editMode ? (
                    <input
                      type="text"
                      value={editedData.city || ''}
                      onChange={(e) => setEditedData({ ...editedData, city: e.target.value })}
                      className="w-full px-4 py-2 bg-[#0f1119] border border-gray-700 rounded-lg text-white focus:outline-none focus:border-[#d3bb73]"
                    />
                  ) : (
                    <p className="text-white">{organization.city || '-'}</p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-1">Kod pocztowy</label>
                  {editMode ? (
                    <input
                      type="text"
                      value={editedData.postal_code || ''}
                      onChange={(e) => setEditedData({ ...editedData, postal_code: e.target.value })}
                      className="w-full px-4 py-2 bg-[#0f1119] border border-gray-700 rounded-lg text-white focus:outline-none focus:border-[#d3bb73]"
                    />
                  ) : (
                    <p className="text-white">{organization.postal_code || '-'}</p>
                  )}
                </div>

                {editMode && (
                  <>
                    <div className="md:col-span-2">
                      <label className="block text-sm font-medium text-gray-400 mb-1">
                        URL Google Maps
                      </label>
                      <div className="flex space-x-2">
                        <input
                          type="url"
                          value={editedData.google_maps_url || ''}
                          onChange={(e) =>
                            setEditedData({ ...editedData, google_maps_url: e.target.value })
                          }
                          className="flex-1 px-4 py-2 bg-[#0f1119] border border-gray-700 rounded-lg text-white focus:outline-none focus:border-[#d3bb73]"
                          placeholder="https://maps.google.com/..."
                        />
                        <button
                          type="button"
                          onClick={handleParseGoogleMaps}
                          className="px-4 py-2 bg-[#d3bb73] text-[#0f1119] rounded-lg hover:bg-[#c4a859] transition-colors flex items-center space-x-2"
                        >
                          <MapPin className="w-5 h-5" />
                          <span>Pobierz</span>
                        </button>
                      </div>
                      <p className="text-xs text-gray-500 mt-1">
                        Otwórz miejsce w Google Maps, skopiuj PEŁNY URL z paska adresu
                      </p>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-400 mb-1">
                        Szerokość geograficzna
                      </label>
                      <input
                        type="number"
                        step="0.00000001"
                        value={editedData.latitude || ''}
                        onChange={(e) =>
                          setEditedData({ ...editedData, latitude: parseFloat(e.target.value) || null })
                        }
                        className="w-full px-4 py-2 bg-[#0f1119] border border-gray-700 rounded-lg text-white focus:outline-none focus:border-[#d3bb73]"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-400 mb-1">
                        Długość geograficzna
                      </label>
                      <input
                        type="number"
                        step="0.00000001"
                        value={editedData.longitude || ''}
                        onChange={(e) =>
                          setEditedData({ ...editedData, longitude: parseFloat(e.target.value) || null })
                        }
                        className="w-full px-4 py-2 bg-[#0f1119] border border-gray-700 rounded-lg text-white focus:outline-none focus:border-[#d3bb73]"
                      />
                    </div>
                  </>
                )}

                {!editMode && organization.google_maps_url && (
                  <div className="md:col-span-2">
                    <a
                      href={organization.google_maps_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center space-x-2 text-[#d3bb73] hover:underline"
                    >
                      <MapPin className="w-5 h-5" />
                      <span>Otwórz w Google Maps</span>
                      <ExternalLink className="w-4 h-4" />
                    </a>
                  </div>
                )}
                </div>
                </div>
              )}
            </div>

            {organization.organization_type === 'subcontractor' && (
              <div className="bg-[#1a1d2e] border border-gray-700 rounded-lg p-6">
                <h2 className="text-xl font-semibold text-white mb-4">Informacje handlowe</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-400 mb-1 flex items-center space-x-1">
                      <DollarSign className="w-4 h-4" />
                      <span>Stawka godzinowa</span>
                    </label>
                    {editMode ? (
                      <input
                        type="number"
                        value={editedData.hourly_rate || ''}
                        onChange={(e) =>
                          setEditedData({
                            ...editedData,
                            hourly_rate: parseFloat(e.target.value) || null,
                          })
                        }
                        className="w-full px-4 py-2 bg-[#0f1119] border border-gray-700 rounded-lg text-white focus:outline-none focus:border-[#d3bb73]"
                      />
                    ) : (
                      <p className="text-white">
                        {organization.hourly_rate ? `${organization.hourly_rate} PLN` : '-'}
                      </p>
                    )}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-400 mb-1">
                      Warunki płatności
                    </label>
                    {editMode ? (
                      <input
                        type="text"
                        value={editedData.payment_terms || ''}
                        onChange={(e) =>
                          setEditedData({ ...editedData, payment_terms: e.target.value })
                        }
                        className="w-full px-4 py-2 bg-[#0f1119] border border-gray-700 rounded-lg text-white focus:outline-none focus:border-[#d3bb73]"
                      />
                    ) : (
                      <p className="text-white">{organization.payment_terms || '-'}</p>
                    )}
                  </div>

                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-gray-400 mb-1 flex items-center space-x-1">
                      <CreditCard className="w-4 h-4" />
                      <span>Numer konta bankowego</span>
                    </label>
                    {editMode ? (
                      <input
                        type="text"
                        value={editedData.bank_account || ''}
                        onChange={(e) =>
                          setEditedData({ ...editedData, bank_account: e.target.value })
                        }
                        className="w-full px-4 py-2 bg-[#0f1119] border border-gray-700 rounded-lg text-white focus:outline-none focus:border-[#d3bb73]"
                      />
                    ) : (
                      <p className="text-white font-mono">{organization.bank_account || '-'}</p>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'contacts' && (
          <div className="bg-[#1a1d2e] border border-gray-700 rounded-lg p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-semibold text-white">Osoby kontaktowe</h2>
              <button
                onClick={() => {
                  setAddContactMode('select');
                  fetchAvailableContacts();
                  setShowAddContactModal(true);
                }}
                className="px-4 py-2 bg-[#d3bb73] text-[#0f1119] rounded-lg hover:bg-[#c4a859] transition-colors flex items-center space-x-2"
              >
                <Plus className="w-5 h-5" />
                <span>Dodaj osobę</span>
              </button>
            </div>

            {contactPersons.length === 0 ? (
              <p className="text-gray-400 text-center py-8">Brak osób kontaktowych</p>
            ) : (
              <div className="space-y-3">
                {contactPersons.map((contact) => (
                  <div
                    key={contact.id}
                    className="bg-[#0f1119] border border-gray-700 rounded-lg p-4 flex items-start justify-between"
                  >
                    <div className="flex items-start space-x-3">
                      <User className="w-5 h-5 text-[#d3bb73] mt-1" />
                      <div>
                        <div className="flex items-center space-x-2">
                          <h3 className="text-white font-medium">
                            {contact.full_name || `${contact.first_name} ${contact.last_name}`}
                          </h3>
                          {contact.is_primary && (
                            <span className="px-2 py-0.5 bg-[#d3bb73]/20 text-[#d3bb73] text-xs rounded-full">
                              Główny kontakt
                            </span>
                          )}
                        </div>
                        {contact.position && (
                          <p className="text-sm text-gray-400">{contact.position}</p>
                        )}
                        <div className="mt-2 space-y-1">
                          {contact.email && (
                            <p className="text-sm text-gray-300 flex items-center space-x-2">
                              <Mail className="w-4 h-4" />
                              <span>{contact.email}</span>
                            </p>
                          )}
                          {contact.phone && (
                            <p className="text-sm text-gray-300 flex items-center space-x-2">
                              <Phone className="w-4 h-4" />
                              <span>{contact.phone}</span>
                            </p>
                          )}
                          {contact.mobile && (
                            <p className="text-sm text-gray-300 flex items-center space-x-2">
                              <Phone className="w-4 h-4" />
                              <span>{contact.mobile} (mobile)</span>
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={() => handleDeleteContact(contact.relation_id!)}
                      className="text-red-400 hover:text-red-300 p-1"
                      title="Usuń powiązanie z organizacją"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'notes' && (
          <div className="bg-[#1a1d2e] border border-gray-700 rounded-lg p-6">
            <h2 className="text-xl font-semibold text-white mb-4">Szybkie notatki</h2>

            <div className="mb-6">
              <div className="flex space-x-2">
                <input
                  type="text"
                  value={newNoteText}
                  onChange={(e) => setNewNoteText(e.target.value)}
                  onKeyPress={(e) => {
                    if (e.key === 'Enter' && !addingNote) {
                      handleAddNote();
                    }
                  }}
                  placeholder="Dodaj szybką notatkę..."
                  className="flex-1 px-4 py-2 bg-[#0f1119] border border-gray-700 rounded-lg text-white focus:outline-none focus:border-[#d3bb73]"
                />
                <button
                  onClick={handleAddNote}
                  disabled={addingNote || !newNoteText.trim()}
                  className="px-4 py-2 bg-[#d3bb73] text-[#0f1119] rounded-lg hover:bg-[#c4a859] transition-colors flex items-center space-x-2 disabled:opacity-50"
                >
                  {addingNote ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    <Plus className="w-5 h-5" />
                  )}
                  <span>Dodaj</span>
                </button>
              </div>
            </div>

            {organizationNotes.length === 0 ? (
              <p className="text-gray-400 text-center py-8">Brak notatek</p>
            ) : (
              <div className="space-y-2">
                {organizationNotes.map((note) => (
                  <div
                    key={note.id}
                    className="bg-[#0f1119] border border-gray-700 rounded-lg p-3 flex items-start justify-between"
                  >
                    <div className="flex-1">
                      <p className="text-white">{note.note}</p>
                      <p className="text-xs text-gray-500 mt-1">
                        {new Date(note.created_at).toLocaleString('pl-PL')}
                        {note.employees && (
                          <span> • {note.employees.name} {note.employees.surname}</span>
                        )}
                      </p>
                    </div>
                    <button
                      onClick={() => handleDeleteNote(note.id)}
                      className="text-red-400 hover:text-red-300 p-1 ml-2"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'invoices' && (
          <div className="space-y-6">
            <div className="bg-[#1a1d2e] border border-gray-700 rounded-lg p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-semibold text-white">Podsumowanie</h2>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div className="bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg p-4">
                  <div className="text-sm text-gray-400 mb-1">Liczba faktur</div>
                  <div className="text-2xl font-bold text-[#d3bb73]">{invoices.length}</div>
                </div>
                <div className="bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg p-4">
                  <div className="text-sm text-gray-400 mb-1">Wartość brutto</div>
                  <div className="text-2xl font-bold text-[#d3bb73]">
                    {invoices.reduce((sum, inv) => sum + (inv.total_gross || 0), 0).toFixed(2)} PLN
                  </div>
                </div>
                <div className="bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg p-4">
                  <div className="text-sm text-gray-400 mb-1">Wartość netto</div>
                  <div className="text-2xl font-bold text-[#d3bb73]">
                    {invoices.reduce((sum, inv) => sum + (inv.total_net || 0), 0).toFixed(2)} PLN
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-[#1a1d2e] border border-gray-700 rounded-lg p-6">
              <h2 className="text-xl font-semibold text-white mb-4">Faktury</h2>
              {invoices.length === 0 ? (
                <p className="text-gray-400 text-center py-8">Brak faktur</p>
              ) : (
                <div className="space-y-3">
                  {invoices.map((invoice) => (
                    <div
                      key={invoice.id}
                      onClick={() => router.push(`/crm/invoices/${invoice.id}`)}
                      className="bg-[#0f1119] border border-gray-700 rounded-lg p-4 hover:border-[#d3bb73]/40 cursor-pointer transition-colors"
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-3 mb-2">
                            <h3 className="text-white font-medium">{invoice.invoice_number}</h3>
                            <span className={`px-2 py-1 text-xs rounded ${
                              invoice.status === 'paid' ? 'bg-green-500/20 text-green-400' :
                              invoice.status === 'issued' ? 'bg-blue-500/20 text-blue-400' :
                              invoice.status === 'draft' ? 'bg-gray-500/20 text-gray-400' :
                              'bg-red-500/20 text-red-400'
                            }`}>
                              {invoice.status === 'paid' ? 'Opłacona' :
                               invoice.status === 'issued' ? 'Wystawiona' :
                               invoice.status === 'draft' ? 'Szkic' : invoice.status}
                            </span>
                          </div>
                          <div className="text-sm text-gray-400">
                            Data wystawienia: {new Date(invoice.issue_date).toLocaleDateString('pl-PL')}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-lg font-bold text-[#d3bb73]">
                            {invoice.total_gross?.toFixed(2)} PLN
                          </div>
                          <div className="text-xs text-gray-500">
                            Netto: {invoice.total_net?.toFixed(2)} PLN
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'events' && (
          <div className="space-y-6">
            <div className="bg-[#1a1d2e] border border-gray-700 rounded-lg p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-semibold text-white">Podsumowanie realizacji</h2>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg p-4">
                  <div className="text-sm text-gray-400 mb-1">Liczba realizacji</div>
                  <div className="text-2xl font-bold text-[#d3bb73]">{events.length}</div>
                </div>
                <div className="bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg p-4">
                  <div className="text-sm text-gray-400 mb-1">Zakończonych</div>
                  <div className="text-2xl font-bold text-[#d3bb73]">
                    {events.filter(e => e.status === 'completed').length}
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-[#1a1d2e] border border-gray-700 rounded-lg p-6">
              <h2 className="text-xl font-semibold text-white mb-4">Realizacje</h2>
              {events.length === 0 ? (
                <p className="text-gray-400 text-center py-8">Brak realizacji</p>
              ) : (
                <div className="space-y-3">
                  {events.map((event) => (
                    <div
                      key={event.id}
                      onClick={() => router.push(`/crm/events/${event.id}`)}
                      className="bg-[#0f1119] border border-gray-700 rounded-lg p-4 hover:border-[#d3bb73]/40 cursor-pointer transition-colors"
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-3 mb-2">
                            <h3 className="text-white font-medium">{event.name}</h3>
                            <span className={`px-2 py-1 text-xs rounded ${
                              event.status === 'completed' ? 'bg-green-500/20 text-green-400' :
                              event.status === 'in_progress' ? 'bg-blue-500/20 text-blue-400' :
                              event.status === 'planning' ? 'bg-yellow-500/20 text-yellow-400' :
                              'bg-gray-500/20 text-gray-400'
                            }`}>
                              {event.status === 'completed' ? 'Zakończone' :
                               event.status === 'in_progress' ? 'W trakcie' :
                               event.status === 'planning' ? 'Planowanie' : event.status}
                            </span>
                          </div>
                          <div className="text-sm text-gray-400">
                            Data wydarzenia: {new Date(event.event_date).toLocaleDateString('pl-PL')}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'history' && (
          <div className="bg-[#1a1d2e] border border-gray-700 rounded-lg p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-semibold text-white">Historia kontaktów</h2>
              <button className="px-4 py-2 bg-[#d3bb73] text-[#0f1119] rounded-lg hover:bg-[#c4a859] transition-colors flex items-center space-x-2">
                <Plus className="w-5 h-5" />
                <span>Dodaj wpis</span>
              </button>
            </div>

            {history.length === 0 ? (
              <p className="text-gray-400 text-center py-8">Brak historii kontaktów</p>
            ) : (
              <div className="space-y-3">
                {history.map((item) => (
                  <div
                    key={item.id}
                    className="bg-[#0f1119] border border-gray-700 rounded-lg p-4"
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <h3 className="text-white font-medium">{item.subject}</h3>
                        <p className="text-sm text-gray-400">{item.contact_type}</p>
                      </div>
                      <p className="text-xs text-gray-500">
                        {new Date(item.contact_date).toLocaleDateString('pl-PL')}
                      </p>
                    </div>
                    {item.notes && <p className="text-sm text-gray-300 mt-2">{item.notes}</p>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {showAddContactModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-[#1a1d2e] border border-gray-700 rounded-lg p-6 max-w-md w-full">
            <h2 className="text-xl font-bold text-white mb-4">
              {addContactMode === 'select' ? 'Wybierz osobę kontaktową' : 'Utwórz nową osobę kontaktową'}
            </h2>

            {addContactMode === 'select' ? (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Wybierz z listy kontaktów
                  </label>
                  <select
                    value={selectedContactId}
                    onChange={(e) => setSelectedContactId(e.target.value)}
                    className="w-full px-4 py-2 bg-[#0f1119] border border-gray-700 rounded-lg text-white focus:outline-none focus:border-[#d3bb73]"
                  >
                    <option value="">-- Wybierz kontakt --</option>
                    {availableContacts.map((contact) => (
                      <option key={contact.id} value={contact.id}>
                        {contact.full_name || `${contact.first_name} ${contact.last_name}`}
                        {contact.email && ` (${contact.email})`}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="pt-4 border-t border-gray-700">
                  <button
                    onClick={() => setAddContactMode('create')}
                    className="w-full px-4 py-2 border border-[#d3bb73] text-[#d3bb73] rounded-lg hover:bg-[#d3bb73]/10 transition-colors flex items-center justify-center space-x-2"
                  >
                    <Plus className="w-4 h-4" />
                    <span>Lub utwórz nowy kontakt</span>
                  </button>
                </div>

                <div className="flex items-center space-x-2 mt-6">
                  <button
                    onClick={() => {
                      setShowAddContactModal(false);
                      setSelectedContactId('');
                    }}
                    className="flex-1 px-4 py-2 border border-gray-700 text-gray-300 rounded-lg hover:bg-[#0f1119] transition-colors"
                  >
                    Anuluj
                  </button>
                  <button
                    onClick={handleLinkExistingContact}
                    disabled={!selectedContactId}
                    className="flex-1 px-4 py-2 bg-[#d3bb73] text-[#0f1119] rounded-lg hover:bg-[#c4a859] transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Dodaj
                  </button>
                </div>
              </div>
            ) : (
              <div>
                <button
                  onClick={() => setAddContactMode('select')}
                  className="mb-4 text-sm text-[#d3bb73] hover:underline flex items-center space-x-1"
                >
                  <span>← Wróć do wyboru z listy</span>
                </button>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Imię *
                  </label>
                  <input
                    type="text"
                    value={newContact.first_name}
                    onChange={(e) => setNewContact({ ...newContact, first_name: e.target.value })}
                    className="w-full px-4 py-2 bg-[#0f1119] border border-gray-700 rounded-lg text-white focus:outline-none focus:border-[#d3bb73]"
                    placeholder="Jan"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Nazwisko *
                  </label>
                  <input
                    type="text"
                    value={newContact.last_name}
                    onChange={(e) => setNewContact({ ...newContact, last_name: e.target.value })}
                    className="w-full px-4 py-2 bg-[#0f1119] border border-gray-700 rounded-lg text-white focus:outline-none focus:border-[#d3bb73]"
                    placeholder="Kowalski"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Stanowisko</label>
                <input
                  type="text"
                  value={newContact.position}
                  onChange={(e) => setNewContact({ ...newContact, position: e.target.value })}
                  className="w-full px-4 py-2 bg-[#0f1119] border border-gray-700 rounded-lg text-white focus:outline-none focus:border-[#d3bb73]"
                  placeholder="Menedżer"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Email</label>
                <input
                  type="email"
                  value={newContact.email}
                  onChange={(e) => setNewContact({ ...newContact, email: e.target.value })}
                  className="w-full px-4 py-2 bg-[#0f1119] border border-gray-700 rounded-lg text-white focus:outline-none focus:border-[#d3bb73]"
                  placeholder="jan.kowalski@example.com"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">Telefon stacjonarny</label>
                  <input
                    type="tel"
                    value={newContact.phone}
                    onChange={(e) => setNewContact({ ...newContact, phone: e.target.value })}
                    className="w-full px-4 py-2 bg-[#0f1119] border border-gray-700 rounded-lg text-white focus:outline-none focus:border-[#d3bb73]"
                    placeholder="22 123 45 67"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">Telefon komórkowy</label>
                  <input
                    type="tel"
                    value={newContact.mobile}
                    onChange={(e) => setNewContact({ ...newContact, mobile: e.target.value })}
                    className="w-full px-4 py-2 bg-[#0f1119] border border-gray-700 rounded-lg text-white focus:outline-none focus:border-[#d3bb73]"
                    placeholder="500 123 456"
                  />
                </div>
              </div>
              <div className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  checked={newContact.is_primary}
                  onChange={(e) => setNewContact({ ...newContact, is_primary: e.target.checked })}
                  className="w-4 h-4"
                />
                <label className="text-sm text-gray-300">Główny kontakt</label>
              </div>
            </div>
            <div className="flex items-center space-x-2 mt-6">
              <button
                onClick={() => setShowAddContactModal(false)}
                className="flex-1 px-4 py-2 border border-gray-700 text-gray-300 rounded-lg hover:bg-[#0f1119] transition-colors"
              >
                Anuluj
              </button>
              <button
                onClick={handleAddContact}
                className="flex-1 px-4 py-2 bg-[#d3bb73] text-[#0f1119] rounded-lg hover:bg-[#c4a859] transition-colors font-medium"
              >
                Utwórz
              </button>
            </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
