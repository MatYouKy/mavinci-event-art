'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import {
  ArrowLeft,
  FileText,
  Plus,
  Trash2,
  DollarSign,
  Calendar,
  Building2,
  CreditCard as Edit,
  Save,
  X,
} from 'lucide-react';
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
        .select(
          `
          *,
          client:clients!client_id(company_name, first_name, last_name),
          event:events!event_id(name, event_date, location)
        `,
        )
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
      <div className="flex h-screen items-center justify-center">
        <div className="text-[#e5e4e2]">Ładowanie...</div>
      </div>
    );
  }

  if (!offer) {
    return (
      <div className="flex h-screen flex-col items-center justify-center space-y-4">
        <div className="text-lg text-[#e5e4e2]">Oferta nie została znaleziona</div>
        <button
          onClick={() => router.push('/crm/offers')}
          className="rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#1c1f33] hover:bg-[#d3bb73]/90"
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
            className="rounded-lg p-2 text-[#e5e4e2] transition-colors hover:bg-[#1c1f33]"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div>
            <h1 className="text-2xl font-light text-[#e5e4e2]">{offer.offer_number || 'Oferta'}</h1>
            <p className="mt-1 text-sm text-[#e5e4e2]/60">Szczegóły oferty</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span
            className={`rounded-lg border px-4 py-2 text-sm ${
              statusColors[offer.status] || 'bg-gray-500/20 text-gray-400'
            }`}
          >
            {statusLabels[offer.status] || offer.status}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
            <h2 className="mb-4 text-lg font-light text-[#e5e4e2]">Informacje podstawowe</h2>
            <div className="space-y-4">
              <div className="flex items-start gap-3">
                <FileText className="mt-0.5 h-5 w-5 text-[#d3bb73]" />
                <div className="flex-1">
                  <div className="mb-1 flex items-center justify-between">
                    <p className="text-sm text-[#e5e4e2]/60">Numer oferty</p>
                    {!isEditingNumber && (
                      <button
                        onClick={() => {
                          setEditedNumber(offer.offer_number || '');
                          setIsEditingNumber(true);
                        }}
                        className="text-sm text-[#d3bb73] hover:text-[#d3bb73]/80"
                      >
                        <Edit className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                  {isEditingNumber ? (
                    <div className="space-y-2">
                      <input
                        type="text"
                        value={editedNumber}
                        onChange={(e) => setEditedNumber(e.target.value)}
                        className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-3 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                        placeholder="np. OF/2025/10/001"
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={handleSaveNumber}
                          className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-3 py-1.5 text-sm font-medium text-[#1c1f33] hover:bg-[#d3bb73]/90"
                        >
                          <Save className="h-3 w-3" />
                          Zapisz
                        </button>
                        <button
                          onClick={() => setIsEditingNumber(false)}
                          className="rounded-lg px-3 py-1.5 text-sm text-[#e5e4e2]/60 hover:bg-[#1c1f33]"
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
                <Building2 className="mt-0.5 h-5 w-5 text-[#d3bb73]" />
                <div>
                  <p className="text-sm text-[#e5e4e2]/60">Klient</p>
                  <p className="text-[#e5e4e2]">{getClientName(offer)}</p>
                </div>
              </div>

              {offer.event && (
                <div className="flex items-start gap-3">
                  <Calendar className="mt-0.5 h-5 w-5 text-[#d3bb73]" />
                  <div>
                    <p className="text-sm text-[#e5e4e2]/60">Event</p>
                    <p className="text-[#e5e4e2]">{offer.event.name}</p>
                    <p className="mt-1 text-sm text-[#e5e4e2]/40">
                      {new Date(offer.event.event_date).toLocaleString('pl-PL', {
                        dateStyle: 'full',
                        timeStyle: 'short',
                      })}
                    </p>
                  </div>
                </div>
              )}

              <div className="flex items-start gap-3">
                <DollarSign className="mt-0.5 h-5 w-5 text-[#d3bb73]" />
                <div>
                  <p className="text-sm text-[#e5e4e2]/60">Wartość oferty</p>
                  <p className="text-2xl font-light text-[#d3bb73]">
                    {offer.total_amount ? offer.total_amount.toLocaleString('pl-PL') : '0'} zł
                  </p>
                </div>
              </div>

              {offer.valid_until && (
                <div className="flex items-start gap-3">
                  <Calendar className="mt-0.5 h-5 w-5 text-[#d3bb73]" />
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

          <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-light text-[#e5e4e2]">Notatki</h2>
              {!isEditingNotes && (
                <button
                  onClick={() => {
                    setEditedNotes(offer.notes || '');
                    setIsEditingNotes(true);
                  }}
                  className="text-sm text-[#d3bb73] hover:text-[#d3bb73]/80"
                >
                  <Edit className="h-4 w-4" />
                </button>
              )}
            </div>
            {isEditingNotes ? (
              <div className="space-y-3">
                <textarea
                  value={editedNotes}
                  onChange={(e) => setEditedNotes(e.target.value)}
                  className="min-h-[120px] w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] p-3 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                  placeholder="Dodaj notatki..."
                />
                <div className="flex gap-2">
                  <button
                    onClick={handleSaveNotes}
                    className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#1c1f33] hover:bg-[#d3bb73]/90"
                  >
                    <Save className="h-4 w-4" />
                    Zapisz
                  </button>
                  <button
                    onClick={() => setIsEditingNotes(false)}
                    className="rounded-lg px-4 py-2 text-sm text-[#e5e4e2]/60 hover:bg-[#1c1f33]"
                  >
                    Anuluj
                  </button>
                </div>
              </div>
            ) : (
              <p className="leading-relaxed text-[#e5e4e2]/80">{offer.notes || 'Brak notatek'}</p>
            )}
          </div>

          <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
            <h2 className="mb-4 text-lg font-light text-[#e5e4e2]">Pozycje oferty</h2>
            <div className="py-12 text-center">
              <FileText className="mx-auto mb-4 h-12 w-12 text-[#e5e4e2]/20" />
              <p className="mb-4 text-[#e5e4e2]/60">Brak pozycji w ofercie</p>
              <button className="mx-auto flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#1c1f33] hover:bg-[#d3bb73]/90">
                <Plus className="h-4 w-4" />
                Dodaj pozycję
              </button>
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
            <h2 className="mb-4 text-lg font-light text-[#e5e4e2]">Zmień status</h2>
            <div className="space-y-2">
              {Object.entries(statusLabels).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => handleStatusChange(key)}
                  className={`w-full rounded-lg px-4 py-2 text-left text-sm transition-colors ${
                    offer.status === key
                      ? 'border border-[#d3bb73]/30 bg-[#d3bb73]/20 text-[#d3bb73]'
                      : 'text-[#e5e4e2]/60 hover:bg-[#0a0d1a]'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
            <h2 className="mb-4 text-lg font-light text-[#e5e4e2]">Informacje</h2>
            <div className="space-y-3 text-sm">
              <div>
                <p className="text-[#e5e4e2]/60">Utworzona</p>
                <p className="text-[#e5e4e2]">
                  {new Date(offer.created_at).toLocaleString('pl-PL')}
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
            <h2 className="mb-4 text-lg font-light text-[#e5e4e2]">Akcje</h2>
            <div className="space-y-2">
              <button
                onClick={() => {
                  if (offer.event_id) {
                    router.push(`/crm/events/${offer.event_id}`);
                  }
                }}
                disabled={!offer.event_id}
                className="flex w-full items-center gap-2 rounded-lg bg-[#d3bb73]/10 px-4 py-2 text-sm text-[#d3bb73] transition-colors hover:bg-[#d3bb73]/20 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Calendar className="h-4 w-4" />
                Przejdź do eventu
              </button>
              <button
                onClick={() => alert('Funkcja generowania PDF w przygotowaniu')}
                className="flex w-full items-center gap-2 rounded-lg bg-blue-500/10 px-4 py-2 text-sm text-blue-400 transition-colors hover:bg-blue-500/20"
              >
                <FileText className="h-4 w-4" />
                Generuj PDF
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
