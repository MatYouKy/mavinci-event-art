'use client';

import { useState, useEffect } from 'react';
import { Building2, Calendar, DollarSign, FileText, Check, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useSnackbar } from '@/contexts/SnackbarContext';

interface OfferBasicInfoProps {
  offer: any;
  isEditing?: boolean;
  onUpdate: () => void;
}

export default function OfferBasicInfo({ offer, isEditing = false, onUpdate }: OfferBasicInfoProps) {
  const { showSnackbar } = useSnackbar();
  const [loading, setLoading] = useState(false);
  const [organizations, setOrganizations] = useState<any[]>([]);
  const [events, setEvents] = useState<any[]>([]);

  const [formData, setFormData] = useState({
    organization_id: offer.organization_id || '',
    event_id: offer.event_id || '',
    valid_until: offer.valid_until || '',
    notes: offer.notes || '',
  });

  useEffect(() => {
    if (isEditing) {
      fetchOrganizations();
      fetchEvents();
    }
  }, [isEditing]);

  useEffect(() => {
    setFormData({
      organization_id: offer.organization_id || '',
      event_id: offer.event_id || '',
      valid_until: offer.valid_until || '',
      notes: offer.notes || '',
    });
  }, [offer]);

  const fetchOrganizations = async () => {
    try {
      const { data, error } = await supabase
        .from('organizations')
        .select('id, name, email')
        .order('name');

      if (error) throw error;
      setOrganizations(data || []);
    } catch (err: any) {
      console.error('Error fetching organizations:', err);
      showSnackbar('Błąd podczas ładowania klientów', 'error');
    }
  };

  const fetchEvents = async () => {
    try {
      const { data, error } = await supabase
        .from('events')
        .select('id, name, event_date')
        .order('event_date', { ascending: false });

      if (error) throw error;
      setEvents(data || []);
    } catch (err: any) {
      console.error('Error fetching events:', err);
      showSnackbar('Błąd podczas ładowania wydarzeń', 'error');
    }
  };

  const handleSave = async () => {
    try {
      setLoading(true);

      const { error } = await supabase
        .from('offers')
        .update({
          organization_id: formData.organization_id || null,
          event_id: formData.event_id || null,
          valid_until: formData.valid_until || null,
          notes: formData.notes || '',
        })
        .eq('id', offer.id);

      if (error) throw error;

      showSnackbar('Oferta zaktualizowana', 'success');
      onUpdate();
    } catch (err: any) {
      console.error('Error updating offer:', err);
      showSnackbar(err.message || 'Błąd podczas aktualizacji oferty', 'error');
    } finally {
      setLoading(false);
    }
  };

  const getClientName = () => {
    if (offer.organization?.name) return offer.organization.name;
    return 'Brak klienta';
  };

  const getContactEmail = () => {
    if (offer.organization?.email) return offer.organization.email;
    if (offer.event?.contact?.email) return offer.event.contact.email;
    return '-';
  };

  if (!isEditing) {
    return (
      <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6">
        <h2 className="text-lg font-light text-[#e5e4e2] mb-4">
          Informacje podstawowe
        </h2>
        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <Building2 className="w-5 h-5 text-[#d3bb73] mt-0.5" />
            <div className="flex-1">
              <p className="text-xs text-[#e5e4e2]/60">Klient</p>
              <p className="text-sm text-[#e5e4e2] font-medium">{getClientName()}</p>
              <p className="text-xs text-[#e5e4e2]/60 mt-1">{getContactEmail()}</p>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <FileText className="w-5 h-5 text-[#d3bb73] mt-0.5" />
            <div className="flex-1">
              <p className="text-xs text-[#e5e4e2]/60">Wydarzenie</p>
              <p className="text-sm text-[#e5e4e2] font-medium">
                {offer.event?.name || '-'}
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <Calendar className="w-5 h-5 text-[#d3bb73] mt-0.5" />
            <div className="flex-1">
              <p className="text-xs text-[#e5e4e2]/60">Data wydarzenia</p>
              <p className="text-sm text-[#e5e4e2]">
                {offer.event?.event_date
                  ? new Date(offer.event.event_date).toLocaleDateString('pl-PL')
                  : '-'}
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <Calendar className="w-5 h-5 text-[#d3bb73] mt-0.5" />
            <div className="flex-1">
              <p className="text-xs text-[#e5e4e2]/60">Ważna do</p>
              <p className="text-sm text-[#e5e4e2]">
                {offer.valid_until
                  ? new Date(offer.valid_until).toLocaleDateString('pl-PL')
                  : '-'}
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <DollarSign className="w-5 h-5 text-[#d3bb73] mt-0.5" />
            <div className="flex-1">
              <p className="text-xs text-[#e5e4e2]/60">Wartość całkowita</p>
              <p className="text-lg text-[#d3bb73] font-medium">
                {offer.total_amount?.toFixed(2) || '0.00'} PLN
              </p>
            </div>
          </div>

          {offer.notes && (
            <div className="pt-4 border-t border-[#d3bb73]/10">
              <p className="text-xs text-[#e5e4e2]/60 mb-2">Notatki</p>
              <p className="text-sm text-[#e5e4e2] whitespace-pre-wrap">{offer.notes}</p>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-light text-[#e5e4e2]">
          Edytuj informacje podstawowe
        </h2>
      </div>

      <div className="space-y-4">
        <div>
          <label className="block text-xs text-[#e5e4e2]/60 mb-2">
            <Building2 className="w-4 h-4 inline mr-1" />
            Klient
          </label>
          <select
            value={formData.organization_id}
            onChange={(e) => setFormData({ ...formData, organization_id: e.target.value })}
            className="w-full bg-[#0f1118] border border-[#d3bb73]/20 rounded-lg px-3 py-2 text-[#e5e4e2] text-sm focus:outline-none focus:border-[#d3bb73]/50"
          >
            <option value="">Wybierz klienta</option>
            {organizations.map((org) => (
              <option key={org.id} value={org.id}>
                {org.name} {org.email ? `(${org.email})` : ''}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs text-[#e5e4e2]/60 mb-2">
            <FileText className="w-4 h-4 inline mr-1" />
            Wydarzenie
          </label>
          <select
            value={formData.event_id}
            onChange={(e) => setFormData({ ...formData, event_id: e.target.value })}
            className="w-full bg-[#0f1118] border border-[#d3bb73]/20 rounded-lg px-3 py-2 text-[#e5e4e2] text-sm focus:outline-none focus:border-[#d3bb73]/50"
          >
            <option value="">Wybierz wydarzenie</option>
            {events.map((event) => (
              <option key={event.id} value={event.id}>
                {event.name} ({event.event_date ? new Date(event.event_date).toLocaleDateString('pl-PL') : '-'})
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs text-[#e5e4e2]/60 mb-2">
            <Calendar className="w-4 h-4 inline mr-1" />
            Ważna do
          </label>
          <input
            type="date"
            value={formData.valid_until}
            onChange={(e) => setFormData({ ...formData, valid_until: e.target.value })}
            className="w-full bg-[#0f1118] border border-[#d3bb73]/20 rounded-lg px-3 py-2 text-[#e5e4e2] text-sm focus:outline-none focus:border-[#d3bb73]/50"
          />
        </div>

        <div>
          <label className="block text-xs text-[#e5e4e2]/60 mb-2">Notatki</label>
          <textarea
            value={formData.notes}
            onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
            rows={4}
            className="w-full bg-[#0f1118] border border-[#d3bb73]/20 rounded-lg px-3 py-2 text-[#e5e4e2] text-sm focus:outline-none focus:border-[#d3bb73]/50 resize-none"
            placeholder="Dodaj notatki..."
          />
        </div>

        <div className="flex gap-2 pt-2">
          <button
            onClick={handleSave}
            disabled={loading}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-[#d3bb73] text-[#1c1f33] rounded-lg hover:bg-[#d3bb73]/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Check className="w-4 h-4" />
            {loading ? 'Zapisywanie...' : 'Zapisz zmiany'}
          </button>
        </div>
      </div>
    </div>
  );
}
