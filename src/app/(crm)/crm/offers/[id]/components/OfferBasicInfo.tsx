'use client';

import { useState, useEffect, useCallback, forwardRef, useImperativeHandle } from 'react';
import { Building2, Calendar, DollarSign, FileText, MapPin, User } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { EventAssumptionsEditor } from '@/components/crm/offers/EventAssumptionsEditor';
import {
  formatEventAssumptionItems,
  normalizeEventAssumptionItems,
} from '@/lib/CRM/Offers/eventAssumptions';
import ClientSelectorTabs from '@/components/crm/ClientSelectorTabs';
import LocationSelector from '@/components/crm/LocationSelector';
import { getOfferTotals } from '@/lib/CRM/Offers/offerTotals';

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
    const [events, setEvents] = useState<any[]>([]);

    const legacyEventAssumptions =
      offer.event_assumptions ||
      offer.inquiry?.inquiry_details?.event_assumptions ||
      offer.inquiry?.inquiry_details?.scope ||
      '';
    const eventLocationFromRelation = typeof offer.event?.location === 'string'
      ? offer.event.location
      : offer.event?.location?.name ||
        offer.event?.location?.formatted_address ||
        offer.event?.location?.address ||
        [
          offer.event?.location?.street,
          offer.event?.location?.postal_code,
          offer.event?.location?.city,
        ].filter(Boolean).join(' ');
    const resolvedEventLocation =
      offer.event_location ||
      eventLocationFromRelation ||
      offer.inquiry?.inquiry_details?.location_text ||
      '';
    const resolvedClientType = (offer.client_type === 'individual'
      ? 'individual'
      : offer.client_type === 'business' || offer.organization_id
        ? 'business'
        : offer.contact_id
          ? 'individual'
          : 'business') as 'individual' | 'business';

    const [formData, setFormData] = useState({
      client_type: resolvedClientType,
      organization_id: offer.organization_id || '',
      contact_id: offer.contact_id || '',
      event_id: offer.event_id || '',
      event_location: resolvedEventLocation,
      valid_until: offer.valid_until || '',
      notes: offer.notes || '',
      event_assumptions: legacyEventAssumptions,
      event_assumption_items: normalizeEventAssumptionItems(
        offer.event_assumption_items,
        legacyEventAssumptions,
      ),
      event_goal: offer.event_goal || offer.inquiry?.inquiry_details?.event_goal || '',
    });

    useEffect(() => {
      if (isEditing) {
        fetchEvents();
      }
    }, [isEditing]);

    useEffect(() => {
      setFormData({
        client_type: resolvedClientType,
        organization_id: offer.organization_id || '',
        contact_id: offer.contact_id || '',
        event_id: offer.event_id || '',
        event_location: resolvedEventLocation,
        valid_until: offer.valid_until || '',
        notes: offer.notes || '',
        event_assumptions: legacyEventAssumptions,
        event_assumption_items: normalizeEventAssumptionItems(
          offer.event_assumption_items,
          legacyEventAssumptions,
        ),
        event_goal: offer.event_goal || offer.inquiry?.inquiry_details?.event_goal || '',
      });
    }, [offer, legacyEventAssumptions, resolvedClientType]);

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
        if (formData.client_type === 'individual' && !formData.contact_id) {
          showSnackbar('Wybierz klienta indywidualnego', 'warning');
          return;
        }
        if (formData.client_type === 'business' && !formData.organization_id) {
          showSnackbar('Wybierz organizację', 'warning');
          return;
        }

        setLoading(true);

        const formattedAssumptions = formatEventAssumptionItems(formData.event_assumption_items);
        const { error } = await supabase
          .from('offers')
          .update({
            client_type: formData.client_type,
            organization_id:
              formData.client_type === 'business' ? formData.organization_id || null : null,
            contact_id: formData.contact_id || null,
            event_id: formData.event_id || null,
            event_location: formData.event_location.trim() || null,
            valid_until: formData.valid_until || null,
            notes: formData.notes || '',
            event_assumptions: formattedAssumptions || null,
            event_assumption_items: formData.event_assumption_items,
            event_goal: formData.event_goal.trim() || null,
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

    const individualContact = offer.contact;
    const businessContact = offer.contact_person || offer.contact;
    const fallbackEventContact = offer.event?.contact;
    const selectedContact = resolvedClientType === 'business'
      ? businessContact || fallbackEventContact
      : individualContact || fallbackEventContact;
    const selectedContactName = selectedContact?.full_name ||
      [selectedContact?.first_name, selectedContact?.last_name].filter(Boolean).join(' ');
    const organizationName = offer.organization?.alias || offer.organization?.name || '';
    const editingContact = formData.client_type === 'business'
      ? offer.contact_person || offer.contact
      : offer.contact;

    const assumptionItemsForDisplay = normalizeEventAssumptionItems(
      offer.event_assumption_items,
      legacyEventAssumptions,
    ).filter((item) => item.value.trim() || item.badge_value?.trim());
    const totals = getOfferTotals(offer);

    if (!isEditing) {
      return (
        <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
          <h2 className="mb-4 text-lg font-light text-[#e5e4e2]">Informacje podstawowe</h2>
          <div className="space-y-4">
            {resolvedClientType === 'business' ? (
              <div className="flex items-start gap-3">
                <Building2 className="mt-0.5 h-5 w-5 text-[#d3bb73]" />
                <div className="flex-1">
                  <p className="text-xs text-[#e5e4e2]/60">Organizacja</p>
                  <p className="text-sm font-medium text-[#e5e4e2]">
                    {organizationName || 'Brak organizacji'}
                  </p>
                  {offer.organization?.alias && offer.organization?.name && (
                    <p className="mt-1 text-xs text-[#e5e4e2]/45">
                      Nazwa prawna: {offer.organization.name}
                    </p>
                  )}
                  <p className="mt-3 text-xs text-[#e5e4e2]/60">Osoba kontaktowa</p>
                  <p className="text-sm font-medium text-[#e5e4e2]">
                    {selectedContactName || 'Nie wybrano osoby kontaktowej'}
                  </p>
                  {selectedContact?.email && (
                    <p className="mt-1 text-xs text-[#e5e4e2]/60">{selectedContact.email}</p>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-3">
                <User className="mt-0.5 h-5 w-5 text-[#d3bb73]" />
                <div className="flex-1">
                  <p className="text-xs text-[#e5e4e2]/60">Klient indywidualny</p>
                  <p className="text-sm font-medium text-[#e5e4e2]">
                    {selectedContactName || 'Brak klienta'}
                  </p>
                  {selectedContact?.email && (
                    <p className="mt-1 text-xs text-[#e5e4e2]/60">{selectedContact.email}</p>
                  )}
                </div>
              </div>
            )}

            <div className="flex items-start gap-3">
              <FileText className="mt-0.5 h-5 w-5 text-[#d3bb73]" />
              <div className="flex-1">
                <p className="text-xs text-[#e5e4e2]/60">Wydarzenie / zapytanie</p>
                <p className="text-sm font-medium text-[#e5e4e2]">
                  {offer.event?.name || offer.inquiry?.title?.replace(/^Zapytanie:\s*/i, '') || '-'}
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <Calendar className="mt-0.5 h-5 w-5 text-[#d3bb73]" />
              <div className="flex-1">
                <p className="text-xs text-[#e5e4e2]/60">Data wydarzenia</p>
                <p className="text-sm text-[#e5e4e2]">
                  {offer.event?.event_date || offer.inquiry?.due_date
                    ? new Date(offer.event?.event_date || offer.inquiry?.due_date).toLocaleDateString('pl-PL')
                    : '-'}
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <MapPin className="mt-0.5 h-5 w-5 text-[#d3bb73]" />
              <div className="flex-1">
                <p className="text-xs text-[#e5e4e2]/60">Miejsce wydarzenia</p>
                <p className="text-sm text-[#e5e4e2]">{resolvedEventLocation || '-'}</p>
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
                <p className="text-xs text-[#e5e4e2]/60">Wartość oferty</p>
                <p className="text-lg font-medium text-[#d3bb73]">
                  {totals.gross.toFixed(2)} PLN
                  <span className="ml-1 text-xs font-normal text-[#e5e4e2]/40">brutto</span>
                </p>
                <div className="mt-1 space-y-0.5 text-xs text-[#e5e4e2]/50">
                  {totals.discountAmount > 0 && (
                    <div className="text-green-400">
                      Rabat {totals.discountPercent.toFixed(2)}%: −{totals.discountAmount.toFixed(2)} PLN netto
                    </div>
                  )}
                  <div>
                    Netto: {totals.net.toFixed(2)} PLN
                  </div>
                  <div>
                    VAT ({totals.taxPercent}%): {totals.taxAmount.toFixed(2)} PLN
                  </div>
                </div>
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

            {assumptionItemsForDisplay.length > 0 ? (
              <div className="border-t border-[#d3bb73]/10 pt-4">
                <p className="mb-2 text-xs text-[#e5e4e2]/60">Założenia wydarzenia</p>
                <div className="grid grid-cols-1 gap-2 xl:grid-cols-3">
                  {assumptionItemsForDisplay.map((item, index) => {
                    const explicitBadge = item.badge_value?.trim() || '';
                    const rawValue = item.value.trim();
                    const canUseValueAsBadge = !explicitBadge
                      && rawValue.length > 0
                      && rawValue.length <= 7
                      && !rawValue.includes('\n');
                    const badgeValue = explicitBadge
                      || (canUseValueAsBadge ? rawValue : String(index + 1).padStart(2, '0'));
                    const detail = canUseValueAsBadge ? '' : rawValue;

                    return (
                      <div
                        key={`${item.key}-${index}`}
                        className="flex min-h-24 items-center gap-3 rounded-xl border border-[#d3bb73]/10 bg-[#0f1118] p-3"
                      >
                        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-[#6b0024] px-1 text-center font-medium uppercase text-white shadow-inner shadow-black/20">
                          <span className={badgeValue.length >= 6 ? 'text-xs' : badgeValue.length >= 4 ? 'text-sm' : 'text-base'}>
                            {badgeValue}
                          </span>
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-[11px] font-medium uppercase tracking-wide text-[#d3bb73]">
                            {item.label}
                          </p>
                          {detail && (
                            <p className="mt-1 whitespace-pre-wrap text-sm leading-5 text-[#e5e4e2]">
                              {detail}
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : legacyEventAssumptions ? (
              <div className="border-t border-[#d3bb73]/10 pt-4">
                <p className="mb-2 text-xs text-[#e5e4e2]/60">Założenia wydarzenia</p>
                <p className="whitespace-pre-wrap text-sm leading-6 text-[#e5e4e2]">{legacyEventAssumptions}</p>
              </div>
            ) : null}

            {(offer.event_goal || offer.inquiry?.inquiry_details?.event_goal) && (
              <div className="border-t border-[#d3bb73]/10 pt-4">
                <p className="mb-2 text-xs text-[#e5e4e2]/60">Cel wydarzenia</p>
                <p className="whitespace-pre-wrap text-sm leading-6 text-[#e5e4e2]">
                  {offer.event_goal || offer.inquiry?.inquiry_details?.event_goal}
                </p>
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
              Klient oferty
            </label>
            <ClientSelectorTabs
              initialClientType={formData.client_type}
              initialOrganizationId={formData.organization_id || null}
              initialContactPersonId={formData.contact_id || null}
              organizationTypeFilter={null}
              initialContact={editingContact ? {
                id: editingContact.id,
                full_name:
                  editingContact.full_name ||
                  `${editingContact.first_name || ''} ${editingContact.last_name || ''}`.trim(),
                first_name: editingContact.first_name || '',
                last_name: editingContact.last_name || '',
                email: editingContact.email || '',
                phone: editingContact.phone || editingContact.mobile || '',
                contact_type: formData.client_type === 'business' ? 'contact' : 'individual',
              } : undefined}
              onChange={(selection) => setFormData((current) => ({
                ...current,
                client_type: selection.client_type,
                organization_id: selection.organization_id || '',
                contact_id: selection.contact_person_id || '',
              }))}
            />
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
              <MapPin className="mr-1 inline h-4 w-4" />
              Miejsce wydarzenia
            </label>
            <LocationSelector
              value={formData.event_location}
              onChange={(value) => setFormData({ ...formData, event_location: value })}
              placeholder="Wyszukaj miejsce lub wpisz własną lokalizację..."
            />
            <p className="mt-1 text-[11px] text-[#e5e4e2]/40">
              Ta lokalizacja pojawi się na pierwszej stronie oferty.
            </p>
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

          <EventAssumptionsEditor
            value={formData.event_assumption_items}
            onChange={(eventAssumptionItems) => setFormData({
              ...formData,
              event_assumption_items: eventAssumptionItems,
              event_assumptions: formatEventAssumptionItems(eventAssumptionItems),
            })}
          />

          <div>
            <label className="mb-2 block text-xs text-[#e5e4e2]/60">Cel wydarzenia</label>
            <textarea
              value={formData.event_goal}
              onChange={(e) => setFormData({ ...formData, event_goal: e.target.value })}
              rows={3}
              className="w-full resize-y rounded-lg border border-[#d3bb73]/20 bg-[#0f1118] px-3 py-2 text-sm text-[#e5e4e2] focus:border-[#d3bb73]/50 focus:outline-none"
              placeholder="Rezultat, który klient chce osiągnąć…"
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
