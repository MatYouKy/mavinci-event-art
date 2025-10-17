'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Building2,
  User,
  Mail,
  Phone,
  MapPin,
  Globe,
  Calendar,
  Tag,
  DollarSign,
  FileText,
  Clock,
  Settings,
  Key,
  CheckCircle,
  XCircle,
  Save,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import ManageClientAttractions from '@/components/crm/ManageClientAttractions';

interface Client {
  id: string;
  client_type: 'company' | 'individual';
  company_name: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone_number: string | null;
  phone_secondary: string | null;
  website: string | null;
  address_street: string | null;
  address_city: string | null;
  address_postal_code: string | null;
  address_country: string | null;
  company_nip: string | null;
  company_regon: string | null;
  category: string;
  status: string;
  tags: string[] | null;
  notes: string | null;
  portal_access: boolean;
  portal_email: string | null;
  allowed_categories: string[] | null;
  custom_price_multiplier: number;
  portal_active_until: string | null;
  total_events: number;
  total_revenue: number;
  last_event_date: string | null;
  created_at: string;
}

interface Event {
  id: string;
  name: string;
  event_date: string;
  location: string;
  status: string;
  budget: number;
}

interface Offer {
  id: string;
  offer_number: string;
  title: string;
  event_date: string;
  total_final_price: number;
  status: string;
  created_at: string;
}

interface AllowedAttraction {
  id: string;
  attraction_id: string;
  attraction_name: string;
  category: string;
  base_price: number;
  custom_price: number | null;
  notes: string | null;
}

type TabType = 'details' | 'events' | 'offers' | 'portal';

export default function ClientDetailPage() {
  const params = useParams();
  const router = useRouter();
  const clientId = params.id as string;

  const [activeTab, setActiveTab] = useState<TabType>('details');
  const [client, setClient] = useState<Client | null>(null);
  const [events, setEvents] = useState<Event[]>([]);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [allowedAttractions, setAllowedAttractions] = useState<AllowedAttraction[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [editedClient, setEditedClient] = useState<Partial<Client>>({});
  const [showCredentialsPopup, setShowCredentialsPopup] = useState(false);
  const [generatedPassword, setGeneratedPassword] = useState('');
  const [createdEmail, setCreatedEmail] = useState('');
  const [emailConfirmed, setEmailConfirmed] = useState(false);
  const [showEmailConfirmationNotice, setShowEmailConfirmationNotice] = useState(false);
  const [pendingConfirmationEmail, setPendingConfirmationEmail] = useState('');

  const [portalSettings, setPortalSettings] = useState({
    portal_access: false,
    portal_email: '',
    portal_password: '',
    allowed_categories: [] as string[],
    custom_price_multiplier: 1.0,
    portal_active_until: '',
  });

  useEffect(() => {
    if (clientId) {
      fetchClientData();
    }
  }, [clientId]);

  const fetchClientData = async () => {
    try {
      setLoading(true);

      const { data: clientData, error: clientError } = await supabase
        .from('clients')
        .select('*')
        .eq('id', clientId)
        .maybeSingle();

      if (clientError) throw clientError;
      if (!clientData) {
        router.push('/crm/clients');
        return;
      }

      setClient(clientData);
      setPortalSettings({
        portal_access: clientData.portal_access || false,
        portal_email: clientData.portal_email || '',
        portal_password: '',
        allowed_categories: clientData.allowed_categories || [],
        custom_price_multiplier: clientData.custom_price_multiplier || 1.0,
        portal_active_until: clientData.portal_active_until
          ? clientData.portal_active_until.split('T')[0]
          : '',
      });

      if (clientData.portal_access && clientData.portal_email) {
        setEmailConfirmed(true);
      } else {
        setEmailConfirmed(false);
      }

      const { data: eventsData } = await supabase
        .from('events')
        .select('id, name, event_date, location, status, budget')
        .eq('client_id', clientId)
        .order('event_date', { ascending: false });

      setEvents(eventsData || []);

      const { data: offersData } = await supabase
        .from('offers')
        .select('id, offer_number, title, event_date, total_final_price, status, created_at')
        .eq('client_id', clientId)
        .order('created_at', { ascending: false });

      setOffers(offersData || []);

      const { data: allowedAttractionsData } = await supabase
        .from('client_allowed_attractions')
        .select(`
          id,
          attraction_id,
          custom_price,
          notes,
          attractions (
            name,
            category,
            base_price
          )
        `)
        .eq('client_id', clientId);

      const formattedAttractions = allowedAttractionsData?.map((item: any) => ({
        id: item.id,
        attraction_id: item.attraction_id,
        attraction_name: item.attractions.name,
        category: item.attractions.category,
        base_price: item.attractions.base_price,
        custom_price: item.custom_price,
        notes: item.notes,
      })) || [];

      setAllowedAttractions(formattedAttractions);
    } catch (error) {
      console.error('Error fetching client:', error);
    } finally {
      setLoading(false);
    }
  };

  const generatePassword = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%';
    let password = '';
    for (let i = 0; i < 12; i++) {
      password += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return password;
  };

  const handleResendConfirmationEmail = async () => {
    try {
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email: pendingConfirmationEmail,
      });

      if (error) {
        alert('Błąd podczas wysyłania emaila: ' + error.message);
      } else {
        alert('Email potwierdzający został wysłany ponownie na adres: ' + pendingConfirmationEmail);
      }
    } catch (err) {
      console.error('Error resending email:', err);
      alert('Wystąpił błąd podczas wysyłania emaila');
    }
  };

  const handleSavePortalSettings = async () => {
    try {
      setSaving(true);

      if (portalSettings.portal_access && !portalSettings.portal_email) {
        alert('Podaj email do logowania');
        setSaving(false);
        return;
      }

      let userCreated = false;
      let password = '';

      if (portalSettings.portal_access && portalSettings.portal_email) {
        try {
          password = portalSettings.portal_password || generatePassword();

          const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
            email: portalSettings.portal_email,
            password: password,
            options: {
              emailRedirectTo: `${window.location.origin}/client/portal`,
              data: {
                client_id: clientId,
                user_type: 'client',
                full_name: displayName,
              }
            }
          });

          if (signUpError) {
            if (signUpError.message.includes('already registered')) {
              alert('Użytkownik z tym emailem już istnieje. Użyj innego emaila lub skontaktuj się z administratorem.');
            } else {
              console.error('Error creating user:', signUpError);
              alert('Błąd podczas tworzenia użytkownika: ' + signUpError.message);
            }
            setSaving(false);
            return;
          }

          if (signUpData.user) {
            userCreated = true;
            setGeneratedPassword(password);
            setCreatedEmail(portalSettings.portal_email);
            setPendingConfirmationEmail(portalSettings.portal_email);
            setEmailConfirmed(!!signUpData.user.email_confirmed_at);

            if (!signUpData.user.email_confirmed_at) {
              setShowEmailConfirmationNotice(true);
            }
          }
        } catch (err) {
          console.error('Unexpected error:', err);
          alert('Nieoczekiwany błąd podczas tworzenia konta');
          setSaving(false);
          return;
        }
      }

      const { error } = await supabase
        .from('clients')
        .update({
          portal_access: portalSettings.portal_access,
          portal_email: portalSettings.portal_email || null,
          allowed_categories: portalSettings.allowed_categories,
          custom_price_multiplier: portalSettings.custom_price_multiplier,
          portal_active_until: portalSettings.portal_active_until || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', clientId);

      if (error) throw error;

      if (userCreated) {
        setShowCredentialsPopup(true);
      } else {
        alert('Ustawienia portalu zostały zapisane!');
      }

      await fetchClientData();
    } catch (error) {
      console.error('Error saving portal settings:', error);
      alert('Błąd podczas zapisywania ustawień');
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = () => {
    setEditMode(true);
    setEditedClient({ ...client });
  };

  const handleCancelEdit = () => {
    setEditMode(false);
    setEditedClient({});
  };

  const handleSaveClient = async () => {
    try {
      setSaving(true);

      const { error } = await supabase
        .from('clients')
        .update(editedClient)
        .eq('id', clientId);

      if (error) throw error;

      setClient({ ...client!, ...editedClient });
      setEditMode(false);
      setEditedClient({});
      alert('Dane klienta zaktualizowane pomyślnie!');
    } catch (error) {
      console.error('Error updating client:', error);
      alert('Błąd podczas aktualizacji danych klienta');
    } finally {
      setSaving(false);
    }
  };

  const handleFieldChange = (field: keyof Client, value: any) => {
    setEditedClient({ ...editedClient, [field]: value });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-[#e5e4e2]">Ładowanie...</div>
      </div>
    );
  }

  if (!client) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-red-400">Nie znaleziono klienta</div>
      </div>
    );
  }

  const displayName = client.client_type === 'company'
    ? client.company_name
    : `${client.first_name} ${client.last_name}`;

  const availableCategories = [
    'Nagłośnienie',
    'Oświetlenie',
    'Streaming',
    'VR/Symulatory',
    'Kasyno',
    'Quizy',
    'Konferencje',
  ];

  return (
    <div className="min-h-screen bg-[#0a0b0f] p-6">
      <div className="max-w-7xl mx-auto">
        <button
          onClick={() => router.push('/crm/clients')}
          className="mb-6 flex items-center gap-2 text-[#d3bb73] hover:text-[#d3bb73]/80 transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
          <span>Powrót do listy klientów</span>
        </button>

        <div className="bg-[#1c1f33] rounded-lg border border-[#d3bb73]/20 p-6 mb-6">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 bg-[#d3bb73]/10 rounded-lg flex items-center justify-center">
                {client.client_type === 'company' ? (
                  <Building2 className="w-8 h-8 text-[#d3bb73]" />
                ) : (
                  <User className="w-8 h-8 text-[#d3bb73]" />
                )}
              </div>
              <div>
                <h1 className="text-2xl font-bold text-[#e5e4e2] mb-1">{displayName}</h1>
                <div className="flex items-center gap-4 text-sm text-[#e5e4e2]/60">
                  <span className="flex items-center gap-1">
                    <Tag className="w-4 h-4" />
                    {client.category}
                  </span>
                  <span className="flex items-center gap-1">
                    <Calendar className="w-4 h-4" />
                    {client.total_events} wydarzeń
                  </span>
                  {client.total_revenue > 0 && (
                    <span className="flex items-center gap-1">
                      <DollarSign className="w-4 h-4" />
                      {client.total_revenue.toLocaleString('pl-PL')} PLN
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3">
              {client.portal_access && (
                <div className="flex items-center gap-2 px-3 py-1 bg-green-500/10 border border-green-500/20 rounded-lg">
                  <Key className="w-4 h-4 text-green-400" />
                  <span className="text-sm text-green-400">Portal aktywny</span>
                </div>
              )}

              {activeTab === 'details' && !editMode && (
                <button
                  onClick={handleEdit}
                  className="flex items-center gap-2 bg-[#d3bb73] text-[#1c1f33] px-4 py-2 rounded-lg hover:bg-[#d3bb73]/90 transition-colors"
                >
                  <Settings className="w-4 h-4" />
                  Edytuj
                </button>
              )}

              {activeTab === 'details' && editMode && (
                <>
                  <button
                    onClick={handleSaveClient}
                    disabled={saving}
                    className="flex items-center gap-2 bg-green-500 text-white px-4 py-2 rounded-lg hover:bg-green-600 transition-colors disabled:opacity-50"
                  >
                    <Save className="w-4 h-4" />
                    {saving ? 'Zapisywanie...' : 'Zapisz'}
                  </button>
                  <button
                    onClick={handleCancelEdit}
                    disabled={saving}
                    className="flex items-center gap-2 bg-red-500/20 text-red-400 px-4 py-2 rounded-lg hover:bg-red-500/30 transition-colors disabled:opacity-50"
                  >
                    Anuluj
                  </button>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="flex gap-4 mb-6">
          <button
            onClick={() => setActiveTab('details')}
            className={`px-4 py-2 rounded-lg font-medium transition-all ${
              activeTab === 'details'
                ? 'bg-[#d3bb73] text-[#1c1f33]'
                : 'bg-[#1c1f33] text-[#e5e4e2] hover:bg-[#1c1f33]/80'
            }`}
          >
            Szczegóły
          </button>
          <button
            onClick={() => setActiveTab('events')}
            className={`px-4 py-2 rounded-lg font-medium transition-all ${
              activeTab === 'events'
                ? 'bg-[#d3bb73] text-[#1c1f33]'
                : 'bg-[#1c1f33] text-[#e5e4e2] hover:bg-[#1c1f33]/80'
            }`}
          >
            Wydarzenia ({events.length})
          </button>
          <button
            onClick={() => setActiveTab('offers')}
            className={`px-4 py-2 rounded-lg font-medium transition-all ${
              activeTab === 'offers'
                ? 'bg-[#d3bb73] text-[#1c1f33]'
                : 'bg-[#1c1f33] text-[#e5e4e2] hover:bg-[#1c1f33]/80'
            }`}
          >
            Oferty ({offers.length})
          </button>
          <button
            onClick={() => setActiveTab('portal')}
            className={`px-4 py-2 rounded-lg font-medium transition-all ${
              activeTab === 'portal'
                ? 'bg-[#d3bb73] text-[#1c1f33]'
                : 'bg-[#1c1f33] text-[#e5e4e2] hover:bg-[#1c1f33]/80'
            }`}
          >
            <div className="flex items-center gap-2">
              <Settings className="w-4 h-4" />
              Portal klienta
            </div>
          </button>
        </div>

        {activeTab === 'details' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-[#1c1f33] rounded-lg border border-[#d3bb73]/20 p-6">
              <h2 className="text-xl font-bold text-[#e5e4e2] mb-4">Informacje kontaktowe</h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm text-[#e5e4e2]/60 mb-2">Email</label>
                  {editMode ? (
                    <input
                      type="email"
                      value={editedClient.email || ''}
                      onChange={(e) => handleFieldChange('email', e.target.value)}
                      className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
                    />
                  ) : (
                    <div className="flex items-center gap-3">
                      <Mail className="w-5 h-5 text-[#d3bb73]" />
                      <span className="text-[#e5e4e2]">{client.email || '-'}</span>
                    </div>
                  )}
                </div>

                <div>
                  <label className="block text-sm text-[#e5e4e2]/60 mb-2">Telefon główny</label>
                  {editMode ? (
                    <input
                      type="text"
                      value={editedClient.phone_number || ''}
                      onChange={(e) => handleFieldChange('phone_number', e.target.value)}
                      className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
                    />
                  ) : (
                    <div className="flex items-center gap-3">
                      <Phone className="w-5 h-5 text-[#d3bb73]" />
                      <span className="text-[#e5e4e2]">{client.phone_number || '-'}</span>
                    </div>
                  )}
                </div>

                <div>
                  <label className="block text-sm text-[#e5e4e2]/60 mb-2">Telefon dodatkowy</label>
                  {editMode ? (
                    <input
                      type="text"
                      value={editedClient.phone_secondary || ''}
                      onChange={(e) => handleFieldChange('phone_secondary', e.target.value)}
                      className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
                    />
                  ) : (
                    client.phone_secondary && (
                      <div className="flex items-center gap-3">
                        <Phone className="w-5 h-5 text-[#d3bb73]" />
                        <span className="text-[#e5e4e2]">{client.phone_secondary}</span>
                      </div>
                    )
                  )}
                </div>

                <div>
                  <label className="block text-sm text-[#e5e4e2]/60 mb-2">Strona WWW</label>
                  {editMode ? (
                    <input
                      type="url"
                      value={editedClient.website || ''}
                      onChange={(e) => handleFieldChange('website', e.target.value)}
                      className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
                    />
                  ) : (
                    client.website && (
                      <div className="flex items-center gap-3">
                        <Globe className="w-5 h-5 text-[#d3bb73]" />
                        <a
                          href={client.website}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[#d3bb73] hover:text-[#d3bb73]/80"
                        >
                          {client.website}
                        </a>
                      </div>
                    )
                  )}
                </div>
              </div>
            </div>

            <div className="bg-[#1c1f33] rounded-lg border border-[#d3bb73]/20 p-6">
              <h2 className="text-xl font-bold text-[#e5e4e2] mb-4">Adres</h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm text-[#e5e4e2]/60 mb-2">Ulica</label>
                  {editMode ? (
                    <input
                      type="text"
                      value={editedClient.address_street || ''}
                      onChange={(e) => handleFieldChange('address_street', e.target.value)}
                      className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
                    />
                  ) : (
                    <span className="text-[#e5e4e2]">{client.address_street || '-'}</span>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm text-[#e5e4e2]/60 mb-2">Kod pocztowy</label>
                    {editMode ? (
                      <input
                        type="text"
                        value={editedClient.address_postal_code || ''}
                        onChange={(e) => handleFieldChange('address_postal_code', e.target.value)}
                        className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
                      />
                    ) : (
                      <span className="text-[#e5e4e2]">{client.address_postal_code || '-'}</span>
                    )}
                  </div>

                  <div>
                    <label className="block text-sm text-[#e5e4e2]/60 mb-2">Miasto</label>
                    {editMode ? (
                      <input
                        type="text"
                        value={editedClient.address_city || ''}
                        onChange={(e) => handleFieldChange('address_city', e.target.value)}
                        className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
                      />
                    ) : (
                      <span className="text-[#e5e4e2]">{client.address_city || '-'}</span>
                    )}
                  </div>
                </div>

                <div>
                  <label className="block text-sm text-[#e5e4e2]/60 mb-2">Kraj</label>
                  {editMode ? (
                    <input
                      type="text"
                      value={editedClient.address_country || ''}
                      onChange={(e) => handleFieldChange('address_country', e.target.value)}
                      className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
                    />
                  ) : (
                    <span className="text-[#e5e4e2]">{client.address_country || '-'}</span>
                  )}
                </div>
              </div>
            </div>

            {client.client_type === 'company' && (
              <div className="bg-[#1c1f33] rounded-lg border border-[#d3bb73]/20 p-6">
                <h2 className="text-xl font-bold text-[#e5e4e2] mb-4">Dane firmy</h2>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm text-[#e5e4e2]/60 mb-2">Nazwa firmy</label>
                    {editMode ? (
                      <input
                        type="text"
                        value={editedClient.company_name || ''}
                        onChange={(e) => handleFieldChange('company_name', e.target.value)}
                        className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
                      />
                    ) : (
                      <span className="text-[#e5e4e2]">{client.company_name || '-'}</span>
                    )}
                  </div>

                  <div>
                    <label className="block text-sm text-[#e5e4e2]/60 mb-2">NIP</label>
                    {editMode ? (
                      <input
                        type="text"
                        value={editedClient.company_nip || ''}
                        onChange={(e) => handleFieldChange('company_nip', e.target.value)}
                        className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
                      />
                    ) : (
                      <span className="text-[#e5e4e2]">{client.company_nip || '-'}</span>
                    )}
                  </div>

                  <div>
                    <label className="block text-sm text-[#e5e4e2]/60 mb-2">REGON</label>
                    {editMode ? (
                      <input
                        type="text"
                        value={editedClient.company_regon || ''}
                        onChange={(e) => handleFieldChange('company_regon', e.target.value)}
                        className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
                      />
                    ) : (
                      <span className="text-[#e5e4e2]">{client.company_regon || '-'}</span>
                    )}
                  </div>
                </div>
              </div>
            )}

            {(client.client_type === 'individual' || editMode) && (
              <div className="bg-[#1c1f33] rounded-lg border border-[#d3bb73]/20 p-6">
                <h2 className="text-xl font-bold text-[#e5e4e2] mb-4">Dane osobowe</h2>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm text-[#e5e4e2]/60 mb-2">Imię</label>
                    {editMode ? (
                      <input
                        type="text"
                        value={editedClient.first_name || ''}
                        onChange={(e) => handleFieldChange('first_name', e.target.value)}
                        className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
                      />
                    ) : (
                      <span className="text-[#e5e4e2]">{client.first_name || '-'}</span>
                    )}
                  </div>

                  <div>
                    <label className="block text-sm text-[#e5e4e2]/60 mb-2">Nazwisko</label>
                    {editMode ? (
                      <input
                        type="text"
                        value={editedClient.last_name || ''}
                        onChange={(e) => handleFieldChange('last_name', e.target.value)}
                        className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
                      />
                    ) : (
                      <span className="text-[#e5e4e2]">{client.last_name || '-'}</span>
                    )}
                  </div>
                </div>
              </div>
            )}

            <div className="bg-[#1c1f33] rounded-lg border border-[#d3bb73]/20 p-6 lg:col-span-2">
              <h2 className="text-xl font-bold text-[#e5e4e2] mb-4">Notatki</h2>
              {editMode ? (
                <textarea
                  value={editedClient.notes || ''}
                  onChange={(e) => handleFieldChange('notes', e.target.value)}
                  rows={5}
                  className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73] resize-y"
                  placeholder="Dodaj notatki o kliencie..."
                />
              ) : (
                <p className="text-[#e5e4e2]/80 whitespace-pre-wrap">{client.notes || 'Brak notatek'}</p>
              )}
            </div>
          </div>
        )}

        {activeTab === 'events' && (
          <div className="bg-[#1c1f33] rounded-lg border border-[#d3bb73]/20 p-6">
            <h2 className="text-xl font-bold text-[#e5e4e2] mb-4">Wydarzenia klienta</h2>
            {events.length === 0 ? (
              <p className="text-[#e5e4e2]/60">Brak wydarzeń</p>
            ) : (
              <div className="space-y-3">
                {events.map((event) => (
                  <div
                    key={event.id}
                    className="bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg p-4 hover:border-[#d3bb73]/30 transition-colors cursor-pointer"
                    onClick={() => router.push(`/crm/events/${event.id}`)}
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <h3 className="text-lg font-semibold text-[#e5e4e2] mb-1">{event.name}</h3>
                        <div className="flex items-center gap-4 text-sm text-[#e5e4e2]/60">
                          <span className="flex items-center gap-1">
                            <Calendar className="w-4 h-4" />
                            {new Date(event.event_date).toLocaleDateString('pl-PL')}
                          </span>
                          {event.location && (
                            <span className="flex items-center gap-1">
                              <MapPin className="w-4 h-4" />
                              {event.location}
                            </span>
                          )}
                        </div>
                      </div>
                      <span className={`px-3 py-1 rounded-full text-sm ${
                        event.status === 'confirmed' ? 'bg-green-500/10 text-green-400' :
                        event.status === 'pending' ? 'bg-yellow-500/10 text-yellow-400' :
                        event.status === 'cancelled' ? 'bg-red-500/10 text-red-400' :
                        'bg-[#d3bb73]/10 text-[#d3bb73]'
                      }`}>
                        {event.status}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'offers' && (
          <div className="space-y-6">
            <div className="bg-[#1c1f33] rounded-lg border border-[#d3bb73]/20 p-6">
              <h2 className="text-xl font-bold text-[#e5e4e2] mb-4">Ustawienia cenowe</h2>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-[#e5e4e2] mb-2">
                    Mnożnik ceny dla tego klienta: {portalSettings.custom_price_multiplier.toFixed(2)}x
                  </label>
                  <input
                    type="range"
                    min="0.5"
                    max="1.5"
                    step="0.05"
                    value={portalSettings.custom_price_multiplier}
                    onChange={(e) => setPortalSettings({ ...portalSettings, custom_price_multiplier: parseFloat(e.target.value) })}
                    className="w-full accent-[#d3bb73]"
                  />
                  <div className="flex justify-between text-xs text-[#e5e4e2]/60 mt-1">
                    <span>50% rabatu (0.5x)</span>
                    <span>Cena bazowa (1.0x)</span>
                    <span>50% drożej (1.5x)</span>
                  </div>
                </div>

                <div className="bg-[#0f1119] rounded-lg p-4">
                  <div className="text-sm text-[#e5e4e2]/60 mb-2">Przykład:</div>
                  <div className="flex items-center justify-between">
                    <span className="text-[#e5e4e2]">Usługa za 1000 PLN</span>
                    <span className="text-[#d3bb73] font-semibold">
                      = {(1000 * portalSettings.custom_price_multiplier).toFixed(2)} PLN
                    </span>
                  </div>
                </div>

                <button
                  onClick={handleSavePortalSettings}
                  disabled={saving}
                  className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-[#d3bb73] text-[#1c1f33] rounded-lg font-medium hover:bg-[#d3bb73]/90 transition-all disabled:opacity-50"
                >
                  <Save className="w-5 h-5" />
                  {saving ? 'Zapisywanie...' : 'Zapisz mnożnik ceny'}
                </button>
              </div>
            </div>

            <div className="bg-[#1c1f33] rounded-lg border border-[#d3bb73]/20 p-6">
              <h2 className="text-xl font-bold text-[#e5e4e2] mb-4">Oferty dla klienta</h2>
              {offers.length === 0 ? (
                <p className="text-[#e5e4e2]/60">Brak ofert</p>
              ) : (
              <div className="space-y-3">
                {offers.map((offer) => (
                  <div
                    key={offer.id}
                    className="bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg p-4 hover:border-[#d3bb73]/30 transition-colors cursor-pointer"
                    onClick={() => router.push(`/crm/offers/${offer.id}`)}
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="flex items-center gap-3 mb-1">
                          <h3 className="text-lg font-semibold text-[#e5e4e2]">{offer.title}</h3>
                          <span className="text-sm text-[#e5e4e2]/60">#{offer.offer_number}</span>
                        </div>
                        <div className="flex items-center gap-4 text-sm text-[#e5e4e2]/60">
                          {offer.event_date && (
                            <span className="flex items-center gap-1">
                              <Calendar className="w-4 h-4" />
                              {new Date(offer.event_date).toLocaleDateString('pl-PL')}
                            </span>
                          )}
                          <span className="flex items-center gap-1">
                            <DollarSign className="w-4 h-4" />
                            {offer.total_final_price?.toLocaleString('pl-PL') || '0'} PLN
                          </span>
                        </div>
                      </div>
                      <span className={`px-3 py-1 rounded-full text-sm ${
                        offer.status === 'accepted' ? 'bg-green-500/10 text-green-400' :
                        offer.status === 'sent' ? 'bg-blue-500/10 text-blue-400' :
                        offer.status === 'rejected' ? 'bg-red-500/10 text-red-400' :
                        'bg-yellow-500/10 text-yellow-400'
                      }`}>
                        {offer.status}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'portal' && (
          <div className="space-y-6">
            <div className="bg-[#1c1f33] rounded-lg border border-[#d3bb73]/20 p-6">
              <h2 className="text-xl font-bold text-[#e5e4e2] mb-4">Ustawienia portalu klienta</h2>

              <div className="space-y-6">
                <div className="flex items-center justify-between p-4 bg-[#0f1119] rounded-lg">
                  <div className="flex items-center gap-3">
                    <Key className="w-5 h-5 text-[#d3bb73]" />
                    <div>
                      <div className="text-[#e5e4e2] font-medium">Dostęp do portalu</div>
                      <div className="text-sm text-[#e5e4e2]/60">
                        Czy klient może logować się do portalu samoobsługowego
                      </div>
                    </div>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={portalSettings.portal_access}
                      onChange={(e) => setPortalSettings({ ...portalSettings, portal_access: e.target.checked })}
                      className="sr-only peer"
                    />
                    <div className="w-14 h-7 bg-[#2a2d42] border-2 border-[#d3bb73]/30 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-[#d3bb73]/50 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[3px] after:left-[3px] after:bg-[#e5e4e2] after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#d3bb73] peer-checked:border-[#d3bb73]"></div>
                  </label>
                </div>

                {portalSettings.portal_access && (
                  <>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-[#e5e4e2] mb-2">
                          Email logowania *
                        </label>
                        <input
                          type="email"
                          value={portalSettings.portal_email}
                          onChange={(e) => setPortalSettings({ ...portalSettings, portal_email: e.target.value })}
                          placeholder="Email do logowania w portalu"
                          required
                          className="w-full px-4 py-2 bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg text-[#e5e4e2] placeholder-[#e5e4e2]/40 focus:outline-none focus:border-[#d3bb73]"
                        />
                        <p className="mt-1 text-xs text-[#e5e4e2]/60">
                          Jeśli użytkownik nie istnieje, zostanie utworzony
                        </p>
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-[#e5e4e2] mb-2">
                          Hasło (opcjonalne)
                        </label>
                        <input
                          type="text"
                          value={portalSettings.portal_password}
                          onChange={(e) => setPortalSettings({ ...portalSettings, portal_password: e.target.value })}
                          placeholder="Zostanie wygenerowane automatycznie"
                          className="w-full px-4 py-2 bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg text-[#e5e4e2] placeholder-[#e5e4e2]/40 focus:outline-none focus:border-[#d3bb73]"
                        />
                        <p className="mt-1 text-xs text-[#e5e4e2]/60">
                          Pozostaw puste dla automatycznego hasła
                        </p>
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-[#e5e4e2] mb-2">
                        Data wygaśnięcia dostępu
                      </label>
                      <input
                        type="date"
                        value={portalSettings.portal_active_until}
                        onChange={(e) => setPortalSettings({ ...portalSettings, portal_active_until: e.target.value })}
                        min={new Date().toISOString().split('T')[0]}
                        className="w-full px-4 py-2 bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73] [color-scheme:dark]"
                      />
                      <p className="mt-1 text-xs text-[#e5e4e2]/60">
                        Pozostaw puste dla nieograniczonego dostępu
                      </p>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-[#e5e4e2] mb-2">
                        Dozwolone kategorie usług
                      </label>
                      <div className="grid grid-cols-2 gap-2">
                        {availableCategories.map((category) => (
                          <label key={category} className="flex items-center gap-2 p-3 bg-[#0f1119] rounded-lg cursor-pointer hover:bg-[#0f1119]/80">
                            <input
                              type="checkbox"
                              checked={portalSettings.allowed_categories.includes(category)}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setPortalSettings({
                                    ...portalSettings,
                                    allowed_categories: [...portalSettings.allowed_categories, category]
                                  });
                                } else {
                                  setPortalSettings({
                                    ...portalSettings,
                                    allowed_categories: portalSettings.allowed_categories.filter(c => c !== category)
                                  });
                                }
                              }}
                              className="w-4 h-4 rounded border-[#d3bb73]/30 bg-[#1c1f33] text-[#d3bb73] focus:ring-[#d3bb73]"
                            />
                            <span className="text-[#e5e4e2]">{category}</span>
                          </label>
                        ))}
                      </div>
                      <p className="mt-2 text-xs text-[#e5e4e2]/60">
                        Klient zobaczy tylko usługi z wybranych kategorii
                      </p>
                    </div>
                  </>
                )}

                <button
                  onClick={handleSavePortalSettings}
                  disabled={saving}
                  className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-[#d3bb73] text-[#1c1f33] rounded-lg font-medium hover:bg-[#d3bb73]/90 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Save className="w-5 h-5" />
                  {saving ? 'Zapisywanie...' : 'Zapisz ustawienia'}
                </button>
              </div>
            </div>

            {showEmailConfirmationNotice && pendingConfirmationEmail && (
              <div className="bg-gradient-to-r from-blue-500/10 to-[#d3bb73]/10 rounded-lg border-2 border-[#d3bb73]/30 p-6">
                <div className="flex items-start gap-4">
                  <div className="flex-shrink-0 w-12 h-12 bg-[#d3bb73]/20 rounded-full flex items-center justify-center">
                    <Mail className="w-6 h-6 text-[#d3bb73]" />
                  </div>
                  <div className="flex-1">
                    <h3 className="text-lg font-bold text-[#e5e4e2] mb-2">
                      📧 Potwierdzenie rejestracji wymagane
                    </h3>
                    <p className="text-[#e5e4e2]/80 mb-3">
                      Konto zostało utworzone pomyślnie! Klient otrzymał email na adres:
                    </p>
                    <div className="bg-[#0f1119] rounded-lg p-3 mb-4 border border-[#d3bb73]/20">
                      <p className="text-[#d3bb73] font-mono font-semibold text-center">
                        {pendingConfirmationEmail}
                      </p>
                    </div>
                    <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-4 mb-4">
                      <p className="text-yellow-400 text-sm font-medium mb-2">
                        ⚠️ Ważne: Klient musi potwierdzić rejestrację
                      </p>
                      <p className="text-[#e5e4e2]/70 text-sm">
                        Poproś klienta, aby wszedł na swoją skrzynkę email <strong>{pendingConfirmationEmail}</strong> i kliknął
                        w link potwierdzający. Dopiero po potwierdzeniu będzie mógł się zalogować do portalu.
                      </p>
                    </div>
                    <div className="flex gap-3">
                      <button
                        onClick={handleResendConfirmationEmail}
                        className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-[#d3bb73] text-[#1c1f33] rounded-lg font-medium hover:bg-[#d3bb73]/90 transition-all"
                      >
                        <Mail className="w-4 h-4" />
                        Wyślij ponownie email
                      </button>
                      <button
                        onClick={() => setShowEmailConfirmationNotice(false)}
                        className="px-4 py-2 bg-[#0f1119] text-[#e5e4e2] rounded-lg font-medium hover:bg-[#0f1119]/80 transition-all border border-[#d3bb73]/20"
                      >
                        Rozumiem
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div className="bg-[#1c1f33] rounded-lg border border-[#d3bb73]/20 p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-bold text-[#e5e4e2]">
                  Przypisane atrakcje ({allowedAttractions.length})
                </h2>
                {(portalSettings.portal_access && portalSettings.portal_email) ? (
                  <ManageClientAttractions clientId={clientId} onUpdate={fetchClientData} />
                ) : (
                  <div className="text-sm text-orange-400 bg-orange-500/10 px-4 py-2 rounded-lg border border-orange-500/20">
                    💡 Najpierw włącz dostęp do portalu i podaj email
                  </div>
                )}
              </div>

              {!(portalSettings.portal_access && portalSettings.portal_email) ? (
                <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4 text-center">
                  <p className="text-blue-400 mb-2">
                    🔐 Aby przypisać atrakcje klientowi:
                  </p>
                  <ol className="text-sm text-[#e5e4e2]/60 text-left max-w-md mx-auto space-y-1">
                    <li>1. Włącz przełącznik "Dostęp do portalu"</li>
                    <li>2. Wpisz email logowania</li>
                    <li>3. Kliknij "Zapisz ustawienia"</li>
                    <li>4. Następnie będziesz mógł przypisać konkretne atrakcje</li>
                  </ol>
                </div>
              ) : allowedAttractions.length === 0 ? (
                <p className="text-[#e5e4e2]/60 text-center py-4">
                  Brak przypisanych atrakcji. Kliknij "Zarządzaj atrakcjami" aby dodać.
                </p>
              ) : (
                <div className="space-y-3">
                  {allowedAttractions.map((attraction) => (
                    <div
                      key={attraction.id}
                      className="bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg p-4"
                    >
                      <div className="flex items-start justify-between">
                        <div>
                          <h3 className="text-[#e5e4e2] font-medium mb-1">{attraction.attraction_name}</h3>
                          <div className="text-sm text-[#e5e4e2]/60">Kategoria: {attraction.category}</div>
                        </div>
                        <div className="text-right">
                          <div className="text-[#e5e4e2]">
                            {attraction.custom_price
                              ? attraction.custom_price.toLocaleString('pl-PL')
                              : attraction.base_price.toLocaleString('pl-PL')
                            } PLN
                          </div>
                          {attraction.custom_price && (
                            <div className="text-xs text-[#d3bb73]">Cena custom</div>
                          )}
                        </div>
                      </div>
                      {attraction.notes && (
                        <div className="mt-2 text-sm text-[#e5e4e2]/60">
                          {attraction.notes}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {showCredentialsPopup && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-[#1c1f33] rounded-lg border border-[#d3bb73]/20 max-w-md w-full p-6">
            <div className="text-center mb-6">
              <div className="w-16 h-16 bg-green-500/10 rounded-full flex items-center justify-center mx-auto mb-4">
                <CheckCircle className="w-8 h-8 text-green-400" />
              </div>
              <h2 className="text-2xl font-bold text-[#e5e4e2] mb-2">Użytkownik utworzony!</h2>
              <p className="text-[#e5e4e2]/60">Poniżej znajdziesz dane do logowania</p>
            </div>

            <div className="space-y-4 bg-[#0f1119] rounded-lg p-4 mb-6">
              <div>
                <div className="text-sm text-[#e5e4e2]/60 mb-1">Email logowania:</div>
                <div className="text-[#e5e4e2] font-mono font-semibold">{createdEmail}</div>
              </div>
              <div>
                <div className="text-sm text-[#e5e4e2]/60 mb-1">Hasło:</div>
                <div className="text-[#d3bb73] font-mono font-semibold text-lg">{generatedPassword}</div>
              </div>
            </div>

            <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-3 mb-6">
              <p className="text-yellow-400 text-sm">
                ⚠️ Zapisz te dane! Hasło nie będzie już wyświetlone ponownie.
              </p>
            </div>

            <button
              onClick={() => {
                navigator.clipboard.writeText(`Email: ${createdEmail}\nHasło: ${generatedPassword}`);
                alert('Dane skopiowane do schowka!');
              }}
              className="w-full mb-3 px-6 py-3 bg-[#d3bb73] text-[#1c1f33] rounded-lg font-medium hover:bg-[#d3bb73]/90 transition-all"
            >
              Skopiuj dane do schowka
            </button>

            <button
              onClick={() => {
                setShowCredentialsPopup(false);
                setGeneratedPassword('');
                setCreatedEmail('');
              }}
              className="w-full px-6 py-3 bg-[#0f1119] text-[#e5e4e2] rounded-lg font-medium hover:bg-[#0f1119]/80 transition-all"
            >
              Zamknij
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
