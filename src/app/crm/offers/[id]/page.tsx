'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { ArrowLeft, FileText, Plus, Trash2, DollarSign, Calendar, Building2, CreditCard as Edit, Save, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';

interface Offer {
  id: string;
  offer_number: string;
  event_id: string;
  client_id: string;
  total_amount: number;
  valid_until: string;
  status: string;
  notes: string;
  created_at: string;
  client?: {
    company_name?: string;
    first_name?: string;
    last_name?: string;
  };
  event?: {
    name: string;
    event_date: string;
  };
}

const statusColors: Record<string, string> = {
  draft: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
  sent: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  accepted: 'bg-green-500/20 text-green-400 border-green-500/30',
  rejected: 'bg-red-500/20 text-red-400 border-red-500/30',
  expired: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
};

const statusLabels: Record<string, string> = {
  draft: 'Szkic',
  sent: 'Wysłana',
  accepted: 'Zaakceptowana',
  rejected: 'Odrzucona',
  expired: 'Wygasła',
};

export default function OfferDetailPage() {
  const router = useRouter();
  const params = useParams();
  const offerId = params.id as string;

  const [offer, setOffer] = useState<Offer | null>(null);
  const [loading, setLoading] = useState(true);
  const [isEditingNotes, setIsEditingNotes] = useState(false);
  const [editedNotes, setEditedNotes] = useState('');
  const [isEditingNumber, setIsEditingNumber] = useState(false);
  const [editedNumber, setEditedNumber] = useState('');

  useEffect(() => {
    if (offerId) {
      fetchOfferDetails();
    }
  }, [offerId]);

  const fetchOfferDetails = async () => {
    try {
      setLoading(true);

      const { data, error } = await supabase
        .from('offers')
        .select(`
          *,
          client:clients!client_id(company_name, first_name, last_name),
          event:events!event_id(name, event_date, location)
        `)
        .eq('id', offerId)
        .maybeSingle();

      if (error || !data) {
        console.error('Error fetching offer:', error);
        setOffer(null);
        setLoading(false);
        return;
      }

      setOffer(data);
      setLoading(false);
    } catch (err) {
      console.error('Error:', err);
      setLoading(false);
    }
  };

  const handleStatusChange = async (newStatus: string) => {
    if (!offer) return;

    try {
      const { error } = await supabase
        .from('offers')
        .update({ status: newStatus })
        .eq('id', offerId);

      if (error) {
        console.error('Error updating status:', error);
        alert('Błąd podczas aktualizacji statusu');
        return;
      }

      fetchOfferDetails();
    } catch (err) {
      console.error('Error:', err);
      alert('Wystąpił błąd');
    }
  };

  const handleSaveNotes = async () => {
    if (!offer) return;

    try {
      const { error } = await supabase
        .from('offers')
        .update({ notes: editedNotes })
        .eq('id', offerId);

      if (error) {
        console.error('Error updating notes:', error);
        alert('Błąd podczas zapisywania notatek');
        return;
      }

      setOffer({ ...offer, notes: editedNotes });
      setIsEditingNotes(false);
    } catch (err) {
      console.error('Error:', err);
      alert('Wystąpił błąd');
    }
  };

  const handleSaveNumber = async () => {
    if (!offer) return;

    if (!editedNumber.trim()) {
      alert('Numer oferty nie może być pusty');
      return;
    }

    try {
      const { error } = await supabase
        .from('offers')
        .update({ offer_number: editedNumber })
        .eq('id', offerId);

      if (error) {
        console.error('Error updating offer number:', error);
        if (error.message.includes('już istnieje')) {
          alert('Ten numer oferty już istnieje. Proszę wybrać inny.');
        } else {
          alert('Błąd podczas zapisywania numeru oferty');
        }
        return;
      }

      setOffer({ ...offer, offer_number: editedNumber });
      setIsEditingNumber(false);
      alert('Numer oferty zaktualizowany');
    } catch (err) {
      console.error('Error:', err);
      alert('Wystąpił błąd');
    }
  };

  const getClientName = (offer: Offer) => {
    if (offer.client?.company_name) return offer.client.company_name;
    if (offer.client?.first_name || offer.client?.last_name) {
      return `${offer.client.first_name || ''} ${offer.client.last_name || ''}`.trim();
    }
    return 'Brak klienta';
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-[#e5e4e2]">Ładowanie...</div>
      </div>
    );
  }

  if (!offer) {
    return (
      <div className="flex flex-col items-center justify-center h-screen space-y-4">
        <div className="text-[#e5e4e2] text-lg">Oferta nie została znaleziona</div>
        <button
          onClick={() => router.push('/crm/offers')}
          className="bg-[#d3bb73] text-[#1c1f33] px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#d3bb73]/90"
        >
          Wróć do listy
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            onClick={() => router.push('/crm/offers')}
            className="p-2 text-[#e5e4e2] hover:bg-[#1c1f33] rounded-lg transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-2xl font-light text-[#e5e4e2]">
              {offer.offer_number || 'Oferta'}
            </h1>
            <p className="text-sm text-[#e5e4e2]/60 mt-1">Szczegóły oferty</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span
            className={`px-4 py-2 rounded-lg text-sm border ${
              statusColors[offer.status] || 'bg-gray-500/20 text-gray-400'
            }`}
          >
            {statusLabels[offer.status] || offer.status}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6">
            <h2 className="text-lg font-light text-[#e5e4e2] mb-4">
              Informacje podstawowe
            </h2>
            <div className="space-y-4">
              <div className="flex items-start gap-3">
                <FileText className="w-5 h-5 text-[#d3bb73] mt-0.5" />
                <div className="flex-1">
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-sm text-[#e5e4e2]/60">Numer oferty</p>
                    {!isEditingNumber && (
                      <button
                        onClick={() => {
                          setEditedNumber(offer.offer_number || '');
                          setIsEditingNumber(true);
                        }}
                        className="text-[#d3bb73] hover:text-[#d3bb73]/80 text-sm"
                      >
                        <Edit className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                  {isEditingNumber ? (
                    <div className="space-y-2">
                      <input
                        type="text"
                        value={editedNumber}
                        onChange={(e) => setEditedNumber(e.target.value)}
                        className="w-full bg-[#0a0d1a] border border-[#d3bb73]/20 rounded-lg px-3 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
                        placeholder="np. OF/2025/10/001"
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={handleSaveNumber}
                          className="flex items-center gap-2 bg-[#d3bb73] text-[#1c1f33] px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-[#d3bb73]/90"
                        >
                          <Save className="w-3 h-3" />
                          Zapisz
                        </button>
                        <button
                          onClick={() => setIsEditingNumber(false)}
                          className="px-3 py-1.5 rounded-lg text-sm text-[#e5e4e2]/60 hover:bg-[#1c1f33]"
                        >
                          Anuluj
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className="text-[#e5e4e2]">{offer.offer_number || 'Brak numeru'}</p>
                  )}
                </div>
              </div>

              <div className="flex items-start gap-3">
                <Building2 className="w-5 h-5 text-[#d3bb73] mt-0.5" />
                <div>
                  <p className="text-sm text-[#e5e4e2]/60">Klient</p>
                  <p className="text-[#e5e4e2]">{getClientName(offer)}</p>
                </div>
              </div>

              {offer.event && (
                <div className="flex items-start gap-3">
                  <Calendar className="w-5 h-5 text-[#d3bb73] mt-0.5" />
                  <div>
                    <p className="text-sm text-[#e5e4e2]/60">Event</p>
                    <p className="text-[#e5e4e2]">{offer.event.name}</p>
                    <p className="text-sm text-[#e5e4e2]/40 mt-1">
                      {new Date(offer.event.event_date).toLocaleString('pl-PL', {
                        dateStyle: 'full',
                        timeStyle: 'short',
                      })}
                    </p>
                  </div>
                </div>
              )}

              <div className="flex items-start gap-3">
                <DollarSign className="w-5 h-5 text-[#d3bb73] mt-0.5" />
                <div>
                  <p className="text-sm text-[#e5e4e2]/60">Wartość oferty</p>
                  <p className="text-2xl font-light text-[#d3bb73]">
                    {offer.total_amount
                      ? offer.total_amount.toLocaleString('pl-PL')
                      : '0'}{' '}
                    zł
                  </p>
                </div>
              </div>

              {offer.valid_until && (
                <div className="flex items-start gap-3">
                  <Calendar className="w-5 h-5 text-[#d3bb73] mt-0.5" />
                  <div>
                    <p className="text-sm text-[#e5e4e2]/60">Ważna do</p>
                    <p className="text-[#e5e4e2]">
                      {new Date(offer.valid_until).toLocaleDateString('pl-PL')}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-light text-[#e5e4e2]">Notatki</h2>
              {!isEditingNotes && (
                <button
                  onClick={() => {
                    setEditedNotes(offer.notes || '');
                    setIsEditingNotes(true);
                  }}
                  className="text-[#d3bb73] hover:text-[#d3bb73]/80 text-sm"
                >
                  <Edit className="w-4 h-4" />
                </button>
              )}
            </div>
            {isEditingNotes ? (
              <div className="space-y-3">
                <textarea
                  value={editedNotes}
                  onChange={(e) => setEditedNotes(e.target.value)}
                  className="w-full bg-[#0a0d1a] border border-[#d3bb73]/20 rounded-lg p-3 text-[#e5e4e2] min-h-[120px] focus:outline-none focus:border-[#d3bb73]"
                  placeholder="Dodaj notatki..."
                />
                <div className="flex gap-2">
                  <button
                    onClick={handleSaveNotes}
                    className="flex items-center gap-2 bg-[#d3bb73] text-[#1c1f33] px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#d3bb73]/90"
                  >
                    <Save className="w-4 h-4" />
                    Zapisz
                  </button>
                  <button
                    onClick={() => setIsEditingNotes(false)}
                    className="px-4 py-2 rounded-lg text-sm text-[#e5e4e2]/60 hover:bg-[#1c1f33]"
                  >
                    Anuluj
                  </button>
                </div>
              </div>
            ) : (
              <p className="text-[#e5e4e2]/80 leading-relaxed">
                {offer.notes || 'Brak notatek'}
              </p>
            )}
          </div>

          <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6">
            <h2 className="text-lg font-light text-[#e5e4e2] mb-4">
              Pozycje oferty
            </h2>
            <div className="text-center py-12">
              <FileText className="w-12 h-12 text-[#e5e4e2]/20 mx-auto mb-4" />
              <p className="text-[#e5e4e2]/60 mb-4">
                Brak pozycji w ofercie
              </p>
              <button className="flex items-center gap-2 bg-[#d3bb73] text-[#1c1f33] px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#d3bb73]/90 mx-auto">
                <Plus className="w-4 h-4" />
                Dodaj pozycję
              </button>
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6">
            <h2 className="text-lg font-light text-[#e5e4e2] mb-4">
              Zmień status
            </h2>
            <div className="space-y-2">
              {Object.entries(statusLabels).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => handleStatusChange(key)}
                  className={`w-full text-left px-4 py-2 rounded-lg text-sm transition-colors ${
                    offer.status === key
                      ? 'bg-[#d3bb73]/20 text-[#d3bb73] border border-[#d3bb73]/30'
                      : 'text-[#e5e4e2]/60 hover:bg-[#0a0d1a]'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6">
            <h2 className="text-lg font-light text-[#e5e4e2] mb-4">
              Informacje
            </h2>
            <div className="space-y-3 text-sm">
              <div>
                <p className="text-[#e5e4e2]/60">Utworzona</p>
                <p className="text-[#e5e4e2]">
                  {new Date(offer.created_at).toLocaleString('pl-PL')}
                </p>
              </div>
            </div>
          </div>

          <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6">
            <h2 className="text-lg font-light text-[#e5e4e2] mb-4">
              Akcje
            </h2>
            <div className="space-y-2">
              <button
                onClick={() => {
                  if (offer.event_id) {
                    router.push(`/crm/events/${offer.event_id}`);
                  }
                }}
                disabled={!offer.event_id}
                className="w-full flex items-center gap-2 bg-[#d3bb73]/10 text-[#d3bb73] px-4 py-2 rounded-lg text-sm hover:bg-[#d3bb73]/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Calendar className="w-4 h-4" />
                Przejdź do eventu
              </button>
              <button
                onClick={() => alert('Funkcja generowania PDF w przygotowaniu')}
                className="w-full flex items-center gap-2 bg-blue-500/10 text-blue-400 px-4 py-2 rounded-lg text-sm hover:bg-blue-500/20 transition-colors"
              >
                <FileText className="w-4 h-4" />
                Generuj PDF
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
