'use client';

import { useState, useEffect, useCallback, forwardRef, useImperativeHandle } from 'react';
import { Building2, Calendar, DollarSign, FileText, User } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';

export interface OfferBasicInfoProps {
  offer: any;
  isEditing?: boolean;
  onUpdate: () => void;
}

// 👇 To będzie typ używany w OfferDetailPage (ref)
export interface OfferBasicInfoHandle {
  submit: () => void;
}

const OfferBasicInfo = forwardRef<OfferBasicInfoHandle, OfferBasicInfoProps>(
  ({ offer, isEditing = false, onUpdate }, ref) => {
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

    // 👇 opakowujemy w useCallback, żeby ref miał stabilną funkcję
    const handleSave = useCallback(async () => {
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
    }, [formData, offer.id, onUpdate, showSnackbar]);

    // 👇 tu udostępniamy submit() na zewnątrz
    useImperativeHandle(
      ref,
      () => ({
        submit: () => {
          if (!loading) {
            void handleSave();
          }
        },
      }),
      [handleSave, loading],
    );

    const getClientName = () => {
      if (offer.event?.contact?.first_name) {
        return offer.event?.contact?.first_name + ' ' + offer.event?.contact?.last_name;
      }

      return 'Brak klienta';
    };

    const getContactEmail = () => {
      if (offer.organization?.email) return offer.organization.email;
      if (offer.event?.contact?.email) return offer.event.contact.email;
      return '-';
    };

    if (!isEditing) {
      return (
        <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
          <h2 className="mb-4 text-lg font-light text-[#e5e4e2]">Informacje podstawowe</h2>
          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <Building2 className="mt-0.5 h-5 w-5 text-[#d3bb73]" />
              <div className="flex-1">
                <p className="text-xs text-[#e5e4e2]/60">Klient</p>
                <p className="text-sm font-medium text-[#e5e4e2]">{getClientName()}</p>
                <p className="mt-1 text-xs text-[#e5e4e2]/60">{getContactEmail()}</p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <FileText className="mt-0.5 h-5 w-5 text-[#d3bb73]" />
              <div className="flex-1">
                <p className="text-xs text-[#e5e4e2]/60">Wydarzenie</p>
                <p className="text-sm font-medium text-[#e5e4e2]">{offer.event?.name || '-'}</p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <Calendar className="mt-0.5 h-5 w-5 text-[#d3bb73]" />
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
              <Calendar className="mt-0.5 h-5 w-5 text-[#d3bb73]" />
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
              <DollarSign className="mt-0.5 h-5 w-5 text-[#d3bb73]" />
              <div className="flex-1">
                <p className="text-xs text-[#e5e4e2]/60">Wartość całkowita</p>
                <p className="text-lg font-medium text-[#d3bb73]">
                  {offer.total_amount?.toFixed(2) || '0.00'} PLN
                </p>
              </div>
            </div>

            {offer.last_generated_by && offer.last_generated_at && (
              <div className="flex items-start gap-3">
                <User className="mt-0.5 h-5 w-5 text-[#d3bb73]" />
                <div className="flex-1">
                  <p className="text-xs text-[#e5e4e2]/60">Ostatnio wygenerowana przez</p>
                  <p className="text-sm font-medium text-[#e5e4e2]">
                    {offer.last_generated_by_employee?.name || ''}{' '}
                    {offer.last_generated_by_employee?.surname || 'Nieznany'}
                  </p>
                  <p className="mt-1 text-xs text-[#e5e4e2]/60">
                    {new Date(offer.last_generated_at).toLocaleString('pl-PL', {
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </p>
                </div>
              </div>
            )}

            {offer.notes && (
              <div className="border-t border-[#d3bb73]/10 pt-4">
                <p className="mb-2 text-xs text-[#e5e4e2]/60">Notatki</p>
                <p className="whitespace-pre-wrap text-sm text-[#e5e4e2]">{offer.notes}</p>
              </div>
            )}
          </div>
        </div>
      );
    }

    return (
      <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-light text-[#e5e4e2]">Edytuj informacje podstawowe</h2>
        </div>

        <div className="space-y-4">
          <div>
            <label className="mb-2 block text-xs text-[#e5e4e2]/60">
              <Building2 className="mr-1 inline h-4 w-4" />
              Klient
            </label>
            <select
              value={formData.organization_id}
              onChange={(e) => setFormData({ ...formData, organization_id: e.target.value })}
              className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1118] px-3 py-2 text-sm text-[#e5e4e2] focus:border-[#d3bb73]/50 focus:outline-none"
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
            <label className="mb-2 block text-xs text-[#e5e4e2]/60">
              <FileText className="mr-1 inline h-4 w-4" />
              Wydarzenie
            </label>
            <select
              value={formData.event_id}
              onChange={(e) => setFormData({ ...formData, event_id: e.target.value })}
              className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1118] px-3 py-2 text-sm text-[#e5e4e2] focus:border-[#d3bb73]/50 focus:outline-none"
            >
              <option value="">Wybierz wydarzenie</option>
              {events.map((event) => (
                <option key={event.id} value={event.id}>
                  {event.name}{' '}
                  {event.event_date
                    ? `(${new Date(event.event_date).toLocaleDateString('pl-PL')})`
                    : ''}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-2 block text-xs text-[#e5e4e2]/60">
              <Calendar className="mr-1 inline h-4 w-4" />
              Ważna do
            </label>
            <input
              type="date"
              value={formData.valid_until}
              onChange={(e) => setFormData({ ...formData, valid_until: e.target.value })}
              className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1118] px-3 py-2 text-sm text-[#e5e4e2] focus:border-[#d3bb73]/50 focus:outline-none"
            />
          </div>

          <div>
            <label className="mb-2 block text-xs text-[#e5e4e2]/60">Notatki</label>
            <textarea
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              rows={4}
              className="w-full resize-none rounded-lg border border-[#d3bb73]/20 bg-[#0f1118] px-3 py-2 text-sm text-[#e5e4e2] focus:border-[#d3bb73]/50 focus:outline-none"
              placeholder="Dodaj notatki..."
            />
          </div>

          {/* Brak lokalnego przycisku Zapisz – zapis obsługuje ActionBar */}
          {loading && <p className="pt-1 text-xs text-[#e5e4e2]/60">Zapisywanie zmian...</p>}
        </div>
      </div>
    );
  },
);

OfferBasicInfo.displayName = 'OfferBasicInfo';

export default OfferBasicInfo;
