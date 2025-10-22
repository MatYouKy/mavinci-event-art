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
  History,
  Users,
  Globe,
  CreditCard,
  Loader2,
  ExternalLink,
  Trash2,
  StickyNote,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { parseGoogleMapsUrl } from '@/lib/gus';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';

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
  notes: string | null;
  contacted_at: string;
  contacted_by: string | null;
}

type TabType = 'details' | 'contacts' | 'notes' | 'history';

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
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [contactPersons, setContactPersons] = useState<ContactPerson[]>([]);
  const [organizationNotes, setOrganizationNotes] = useState<OrganizationNote[]>([]);
  const [history, setHistory] = useState<ContactHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [editMode, setEditMode] = useState(false);
  const [editedData, setEditedData] = useState<Partial<Organization>>({});
  const [saving, setSaving] = useState(false);

  const [showAddContactModal, setShowAddContactModal] = useState(false);
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

      const { data: orgData, error: orgError } = await supabase
        .from('organizations')
        .select('*')
        .eq('id', organizationId)
        .maybeSingle();

      if (orgError) throw orgError;
      if (!orgData) {
        showSnackbar('Nie znaleziono organizacji', 'error');
        router.push('/crm/contacts');
        return;
      }

      setOrganization(orgData);

      const { data: contactsData } = await supabase
        .from('contact_persons')
        .select('*')
        .eq('organization_id', organizationId)
        .order('is_primary', { ascending: false });

      setContactPersons(contactsData || []);

      await fetchNotes();

      const { data: historyData } = await supabase
        .from('contact_history')
        .select('*')
        .eq('organization_id', organizationId)
        .order('contacted_at', { ascending: false })
        .limit(50);

      setHistory(historyData || []);
    } catch (error: any) {
      console.error('Error fetching data:', error);
      showSnackbar('Błąd podczas ładowania danych', 'error');
    } finally {
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

  const handleAddContact = async () => {
    if (!newContact.first_name.trim() || !newContact.last_name.trim()) {
      showSnackbar('Wprowadź imię i nazwisko', 'error');
      return;
    }

    try {
      const { error } = await supabase.from('contact_persons').insert({
        organization_id: organizationId,
        ...newContact,
      });

      if (error) throw error;

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

  const handleDeleteContact = async (contactId: string) => {
    if (!confirm('Czy na pewno chcesz usunąć tę osobę kontaktową?')) return;

    try {
      const { error } = await supabase.from('contact_persons').delete().eq('id', contactId);

      if (error) throw error;

      showSnackbar('Osoba usunięta', 'success');
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

        <div className="flex space-x-2 mb-6 border-b border-gray-700">
          {[
            { key: 'details' as TabType, label: 'Szczegóły', icon: FileText },
            { key: 'contacts' as TabType, label: `Kontakty (${contactPersons.length})`, icon: Users },
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
                onClick={() => setShowAddContactModal(true)}
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
                      onClick={() => handleDeleteContact(contact.id)}
                      className="text-red-400 hover:text-red-300 p-1"
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
                        {new Date(item.contacted_at).toLocaleDateString('pl-PL')}
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
            <h2 className="text-xl font-bold text-white mb-4">Dodaj osobę kontaktową</h2>
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
                Dodaj
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
