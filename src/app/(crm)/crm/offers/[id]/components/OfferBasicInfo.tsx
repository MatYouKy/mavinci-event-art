'use client';

import { useState, useEffect, useCallback, forwardRef, useImperativeHandle, useRef } from 'react';
import { Building2, Calculator, Calendar, DollarSign, FileText, Image as ImageIcon, MapPin, Upload, User } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { EventAssumptionsEditor } from '@/components/crm/offers/EventAssumptionsEditor';
import {
  formatEventAssumptionItems,
  normalizeEventAssumptionItems,
} from '@/lib/CRM/Offers/eventAssumptions';
import ClientSelectorTabs from '@/components/crm/ClientSelectorTabs';
import LocationSelector from '@/components/crm/LocationSelector';
import { getOfferPricingTotals } from '@/lib/CRM/Offers/offerTotals';
import { getCalculationNumber } from '@/lib/CRM/calculations/calculationNumber';
import { optimizeOfferImage } from '@/lib/optimizeOfferImage';

export interface OfferBasicInfoProps {
  offer: any;
  isEditing?: boolean;
  onUpdate: () => void;
}

// 👇 To będzie typ używany w OfferDetailPage (ref)
export interface OfferBasicInfoHandle {
  submit: () => void;
}

type OfferInfoPageSection = {
  key: string;
  title: string;
  content: string;
};

const DEFAULT_INFO_PAGE_SECTIONS: OfferInfoPageSection[] = [
  { key: 'event_details', title: 'TERMIN I MIEJSCE', content: '' },
  { key: 'pricing_source', title: 'ZAKRES I WYCENA', content: '' },
  { key: 'coordination', title: 'KONTAKT I KOORDYNACJA', content: '' },
];

const normalizeInfoPageSections = (value: unknown): OfferInfoPageSection[] => {
  const source = Array.isArray(value) ? value : [];
  return DEFAULT_INFO_PAGE_SECTIONS.map((fallback, index) => {
    const stored = source[index];
    if (!stored || typeof stored !== 'object') return { ...fallback };
    return {
      key: String((stored as any).key || fallback.key),
      title: String((stored as any).title || fallback.title),
      content: String((stored as any).content || ''),
    };
  });
};

const OfferBasicInfo = forwardRef<OfferBasicInfoHandle, OfferBasicInfoProps>(
  ({ offer, isEditing = false, onUpdate }, ref) => {
    const { showSnackbar } = useSnackbar();
    const [loading, setLoading] = useState(false);
    const [events, setEvents] = useState<any[]>([]);
    const [heroFile, setHeroFile] = useState<File | null>(null);
    const [heroPreviewUrl, setHeroPreviewUrl] = useState('');
    const [removeHero, setRemoveHero] = useState(false);
    const [heroDragActive, setHeroDragActive] = useState(false);
    const heroDragDepth = useRef(0);
    const [eventCalculations, setEventCalculations] = useState<Array<{
      id: string;
      name: string;
      created_at: string | null;
      is_accepted: boolean;
    }>>([]);

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
    const inheritedOfferTitle = offer.event?.name
      || offer.inquiry?.title?.replace(/^Zapytanie:\s*/i, '')
      || '';

    const [formData, setFormData] = useState({
      title: offer.title || inheritedOfferTitle,
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
      hero_image_alt: offer.hero_image_alt || '',
      info_page_sections: normalizeInfoPageSections(offer.info_page_sections),
      pricing_source: offer.event?.financial_source === 'calculation' ? 'calculation' : 'offer',
      accepted_calculation_id: offer.event?.accepted_calculation_id || '',
    });

    useEffect(() => {
      if (isEditing) {
        fetchEvents();
      }
    }, [isEditing]);

    useEffect(() => {
      let cancelled = false;
      const loadCalculations = async () => {
        const eventId = String(formData.event_id || '').trim();
        const inquiryId = String(offer.inquiry?.id || offer.inquiry_id || '').trim();
        if (!eventId && !inquiryId) {
          setEventCalculations([]);
          return;
        }

        let query = supabase
          .from('event_calculations')
          .select('id, name, created_at, is_accepted')
          .order('created_at', { ascending: false });
        if (eventId && inquiryId) query = query.or(`event_id.eq.${eventId},inquiry_id.eq.${inquiryId}`);
        else if (eventId) query = query.eq('event_id', eventId);
        else query = query.eq('inquiry_id', inquiryId);

        const { data, error } = await query;
        if (cancelled) return;
        if (error) {
          setEventCalculations([]);
          return;
        }
        const calculations = (data || []) as Array<{
          id: string;
          name: string;
          created_at: string | null;
          is_accepted: boolean;
        }>;
        setEventCalculations(calculations);
        const accepted = calculations.find((calculation) => calculation.is_accepted)
          || calculations.find((calculation) => calculation.id === offer.event?.accepted_calculation_id);
        if (accepted) {
          setFormData((current) => ({
            ...current,
            pricing_source: 'calculation',
            accepted_calculation_id: accepted.id,
          }));
        }
      };
      void loadCalculations();
      return () => { cancelled = true; };
    }, [formData.event_id, offer.inquiry?.id, offer.inquiry_id, offer.event?.accepted_calculation_id]);

    useEffect(() => {
      setFormData({
        title: offer.title || inheritedOfferTitle,
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
        hero_image_alt: offer.hero_image_alt || '',
        info_page_sections: normalizeInfoPageSections(offer.info_page_sections),
        pricing_source: offer.event?.financial_source === 'calculation' ? 'calculation' : 'offer',
        accepted_calculation_id: offer.event?.accepted_calculation_id || '',
      });
      setHeroFile(null);
      setRemoveHero(false);
      setHeroDragActive(false);
      heroDragDepth.current = 0;
    }, [offer, legacyEventAssumptions, resolvedClientType]);

    useEffect(() => {
      let active = true;
      let objectUrl = '';

      if (heroFile) {
        objectUrl = URL.createObjectURL(heroFile);
        setHeroPreviewUrl(objectUrl);
      } else if (!removeHero && offer.hero_image_path) {
        supabase.storage
          .from('offer-template-pages')
          .createSignedUrl(offer.hero_image_path, 3600)
          .then(({ data }) => {
            if (active) setHeroPreviewUrl(data?.signedUrl || '');
          });
      } else {
        setHeroPreviewUrl('');
      }

      return () => {
        active = false;
        if (objectUrl) URL.revokeObjectURL(objectUrl);
      };
    }, [heroFile, offer.hero_image_path, removeHero]);

    const selectHeroFile = (file?: File) => {
      if (!file) return;
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
        showSnackbar('Wybierz zdjęcie JPG, PNG lub WEBP', 'error');
        return;
      }
      if (file.size > 12 * 1024 * 1024) {
        showSnackbar('Zdjęcie może mieć maksymalnie 12 MB', 'error');
        return;
      }
      setHeroFile(file);
      setRemoveHero(false);
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
        if (formData.client_type === 'individual' && !formData.contact_id) {
          showSnackbar('Wybierz klienta indywidualnego', 'warning');
          return;
        }
        if (formData.client_type === 'business' && !formData.organization_id) {
          showSnackbar('Wybierz organizację', 'warning');
          return;
        }
        if (formData.pricing_source === 'calculation' && !formData.accepted_calculation_id) {
          showSnackbar('Wybierz kalkulację, która ma stanowić podstawę wyceny', 'warning');
          return;
        }

        setLoading(true);

        const calculationIds = eventCalculations.map((calculation) => calculation.id);
        if (formData.pricing_source === 'calculation') {
          const otherCalculationIds = calculationIds.filter((id) => id !== formData.accepted_calculation_id);
          if (otherCalculationIds.length > 0) {
            const { error: clearCalculationError } = await supabase
              .from('event_calculations')
              .update({ is_accepted: false })
              .in('id', otherCalculationIds);
            if (clearCalculationError) throw clearCalculationError;
          }
          const { error: acceptCalculationError } = await supabase
            .from('event_calculations')
            .update({ is_accepted: true })
            .eq('id', formData.accepted_calculation_id);
          if (acceptCalculationError) throw acceptCalculationError;
        } else if (calculationIds.length > 0) {
          const { error: clearCalculationError } = await supabase
            .from('event_calculations')
            .update({ is_accepted: false })
            .in('id', calculationIds);
          if (clearCalculationError) throw clearCalculationError;
        }

        if (formData.event_id) {
          const { error: eventFinancialError } = await supabase
            .from('events')
            .update({
              financial_source: formData.pricing_source,
              accepted_calculation_id: formData.pricing_source === 'calculation'
                ? formData.accepted_calculation_id
                : null,
            })
            .eq('id', formData.event_id);
          if (eventFinancialError) throw eventFinancialError;
        }

        let heroImagePath = removeHero ? null : offer.hero_image_path || null;
        if (heroFile) {
          const optimizedHeroFile = await optimizeOfferImage(heroFile, {
            maxWidth: 1800,
            maxHeight: 1800,
            quality: 0.84,
            outputType: 'image/jpeg',
          });
          const extension = optimizedHeroFile.type === 'image/png'
            ? 'png'
            : optimizedHeroFile.type === 'image/webp'
              ? 'webp'
              : 'jpg';
          heroImagePath = `offer-heroes/${offer.id}/hero-${Date.now()}.${extension}`;
          const { error: heroUploadError } = await supabase.storage
            .from('offer-template-pages')
            .upload(heroImagePath, optimizedHeroFile, {
              contentType: optimizedHeroFile.type,
              upsert: true,
            });
          if (heroUploadError) throw heroUploadError;
        }

        const formattedAssumptions = formatEventAssumptionItems(formData.event_assumption_items);
        const { error } = await supabase
          .from('offers')
          .update({
            client_type: formData.client_type,
            title: formData.title.trim() || null,
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
            hero_image_path: heroImagePath,
            hero_image_alt: heroImagePath ? formData.hero_image_alt.trim() || null : null,
            info_page_sections: formData.info_page_sections.map((section) => ({
              key: section.key,
              title: section.title.trim(),
              content: section.content.trim(),
            })),
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
    }, [eventCalculations, formData, heroFile, offer.hero_image_path, offer.id, onUpdate, removeHero, showSnackbar]);

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
    const totals = getOfferPricingTotals(offer);
    const selectedPricingCalculation = eventCalculations.find((calculation) =>
      calculation.id === offer.event?.accepted_calculation_id || calculation.is_accepted,
    );
    const usesCalculationPricing = offer.event?.financial_source === 'calculation'
      || Boolean(selectedPricingCalculation);

    if (!isEditing) {
      return (
        <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
          <h2 className="mb-4 text-lg font-light text-[#e5e4e2]">Informacje podstawowe</h2>
          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <FileText className="mt-0.5 h-5 w-5 text-[#d3bb73]" />
              <div className="min-w-0 flex-1">
                <p className="text-xs text-[#e5e4e2]/60">Tytuł oferty</p>
                <p className="text-sm font-medium text-[#e5e4e2]">
                  {offer.title || inheritedOfferTitle || 'Bez tytułu'}
                </p>
                {!offer.title && inheritedOfferTitle && (
                  <p className="mt-1 text-[11px] text-[#e5e4e2]/35">Pobrany z wydarzenia lub zapytania</p>
                )}
              </div>
            </div>
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
              <Calculator className="mt-0.5 h-5 w-5 text-[#d3bb73]" />
              <div className="flex-1">
                <p className="text-xs text-[#e5e4e2]/60">Źródło wyceny</p>
                <p className="text-sm font-medium text-[#e5e4e2]">
                  {usesCalculationPricing ? 'Zaakceptowana kalkulacja' : 'Pozycje oferty'}
                </p>
                {usesCalculationPricing && selectedPricingCalculation && (
                  <p className="mt-1 text-xs text-[#d3bb73]">
                    {getCalculationNumber(selectedPricingCalculation.id, selectedPricingCalculation.created_at)} — {selectedPricingCalculation.name}
                  </p>
                )}
              </div>
            </div>

            <div className="flex items-start gap-3">
              <ImageIcon className="mt-0.5 h-5 w-5 text-[#d3bb73]" />
              <div className="min-w-0 flex-1">
                <p className="text-xs text-[#e5e4e2]/60">Grafika hero oferty</p>
                <p className="text-sm font-medium text-[#e5e4e2]">
                  {offer.hero_image_path ? 'Indywidualna grafika tej oferty' : 'Domyślna grafika szablonu'}
                </p>
                {offer.hero_image_path && heroPreviewUrl && (
                  <div className="mt-3 overflow-hidden rounded-xl border border-[#d3bb73]/15 bg-[#0f1118]">
                    <img
                      src={heroPreviewUrl}
                      alt={offer.hero_image_alt || 'Grafika hero oferty'}
                      className="h-44 w-full object-cover"
                    />
                  </div>
                )}
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
                    VAT ({totals.hasMixedVatRates ? 'wg stawek pozycji' : `${totals.taxPercent}%`}): {totals.taxAmount.toFixed(2)} PLN
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
              <FileText className="mr-1 inline h-4 w-4" />
              Tytuł oferty
            </label>
            <input
              type="text"
              value={formData.title}
              maxLength={180}
              onChange={(event) => setFormData({ ...formData, title: event.target.value })}
              placeholder={inheritedOfferTitle || 'Np. Obsługa techniczna konferencji'}
              className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1118] px-3 py-2.5 text-sm text-[#e5e4e2] outline-none placeholder:text-[#e5e4e2]/30 focus:border-[#d3bb73]/50"
            />
            <p className="mt-1.5 text-[11px] text-[#e5e4e2]/40">
              Ten tytuł będzie widoczny na stronie oferty i na okładce generowanego PDF.
            </p>
          </div>
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

          <div className="rounded-xl border border-[#d3bb73]/15 bg-[#0f1118] p-4">
            <div className="flex items-start gap-3">
              <FileText className="mt-0.5 h-4 w-4 flex-shrink-0 text-[#d3bb73]" />
              <div>
                <p className="text-xs font-medium text-[#e5e4e2]/75">Dodatkowe sekcje „Informacje i warunki”</p>
                <p className="mt-1 text-[11px] leading-5 text-[#e5e4e2]/40">
                  Te trzy karty uzupełniają dwie sekcje szablonu. Pusta treść zostanie automatycznie wypełniona danymi wydarzenia, wyceny i kontaktu.
                </p>
              </div>
            </div>

            <div className="mt-4 space-y-4">
              {formData.info_page_sections.map((section, index) => (
                <div key={section.key} className="rounded-lg border border-[#d3bb73]/10 bg-[#090b13] p-3">
                  <div className="mb-2 flex items-center gap-2">
                    <span className="flex h-6 w-6 items-center justify-center rounded-md bg-[#6b0024] text-[11px] font-medium text-[#f3e7bd]">
                      {String(index + 3).padStart(2, '0')}
                    </span>
                    <input
                      type="text"
                      value={section.title}
                      onChange={(event) => setFormData((current) => ({
                        ...current,
                        info_page_sections: current.info_page_sections.map((item, itemIndex) => (
                          itemIndex === index ? { ...item, title: event.target.value } : item
                        )),
                      }))}
                      className="min-w-0 flex-1 rounded-md border border-[#d3bb73]/15 bg-[#121625] px-3 py-2 text-xs font-medium uppercase tracking-wide text-[#d3bb73] outline-none focus:border-[#d3bb73]/50"
                    />
                  </div>
                  <textarea
                    rows={3}
                    value={section.content}
                    onChange={(event) => setFormData((current) => ({
                      ...current,
                      info_page_sections: current.info_page_sections.map((item, itemIndex) => (
                        itemIndex === index ? { ...item, content: event.target.value } : item
                      )),
                    }))}
                    className="w-full resize-y rounded-md border border-[#d3bb73]/15 bg-[#121625] px-3 py-2 text-sm leading-relaxed text-[#e5e4e2] outline-none focus:border-[#d3bb73]/50"
                    placeholder={index === 0
                      ? 'Automatycznie: termin i lokalizacja wydarzenia'
                      : index === 1
                        ? 'Automatycznie: źródło i podsumowanie wyceny'
                        : 'Automatycznie: osoba kontaktowa i sposób koordynacji'}
                  />
                </div>
              ))}
            </div>
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

          <div className="rounded-xl border border-[#d3bb73]/15 bg-[#0f1118] p-4">
            <label className="mb-2 flex items-center gap-2 text-xs text-[#e5e4e2]/60">
              <Calculator className="h-4 w-4 text-[#d3bb73]" />
              Źródło wyceny w ofercie
            </label>
            <select
              value={formData.pricing_source}
              onChange={(event) => setFormData({
                ...formData,
                pricing_source: event.target.value,
                accepted_calculation_id: event.target.value === 'calculation'
                  ? formData.accepted_calculation_id || eventCalculations.find((calculation) => calculation.is_accepted)?.id || eventCalculations[0]?.id || ''
                  : '',
              })}
              className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#090b13] px-3 py-2 text-sm text-[#e5e4e2] focus:border-[#d3bb73]/50 focus:outline-none"
            >
              <option value="offer">Wycena wynika z pozycji oferty</option>
              <option value="calculation" disabled={eventCalculations.length === 0}>
                Wycena wynika z zaakceptowanej kalkulacji
              </option>
            </select>

            {formData.pricing_source === 'calculation' && (
              <div className="mt-3">
                <label className="mb-1.5 block text-xs text-[#d3bb73]">Kalkulacja stanowiąca integralną część oferty</label>
                <select
                  value={formData.accepted_calculation_id}
                  onChange={(event) => setFormData({ ...formData, accepted_calculation_id: event.target.value })}
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#090b13] px-3 py-2 text-sm text-[#e5e4e2] focus:border-[#d3bb73]/50 focus:outline-none"
                >
                  <option value="">Wybierz kalkulację</option>
                  {eventCalculations.map((calculation) => (
                    <option key={calculation.id} value={calculation.id}>
                      {getCalculationNumber(calculation.id, calculation.created_at)} — {calculation.name}
                    </option>
                  ))}
                </select>
                <p className="mt-2 text-[11px] leading-5 text-[#e5e4e2]/40">
                  Po zapisaniu wybrana kalkulacja zostanie oznaczona jako zaakceptowana, a jej numer pojawi się w PDF.
                </p>
              </div>
            )}

            {eventCalculations.length === 0 && (
              <p className="mt-2 text-[11px] text-[#e5e4e2]/35">
                Brak kalkulacji powiązanych z tym wydarzeniem lub zapytaniem.
              </p>
            )}
          </div>

          <div className="rounded-xl border border-[#d3bb73]/15 bg-[#0f1118] p-4">
            <label className="mb-2 flex items-center gap-2 text-xs text-[#e5e4e2]/60">
              <ImageIcon className="h-4 w-4 text-[#d3bb73]" />
              Indywidualna grafika hero oferty
            </label>
            <p className="mb-3 text-[11px] leading-5 text-[#e5e4e2]/40">
              Po wgraniu zastąpi grafikę hero ustawioną w szablonie tylko dla tej oferty.
            </p>
            <label
              className={`relative flex min-h-40 cursor-pointer items-center justify-center overflow-hidden rounded-xl border-2 border-dashed transition-all duration-150 ${
                heroDragActive
                  ? 'scale-[1.01] border-[#d3bb73] bg-[#d3bb73]/15 shadow-[0_0_0_4px_rgba(211,187,115,0.12)]'
                  : 'border-[#d3bb73]/25 bg-[#090b13] hover:border-[#d3bb73]/55'
              }`}
              onDragEnter={(event) => {
                event.preventDefault();
                event.stopPropagation();
                heroDragDepth.current += 1;
                setHeroDragActive(true);
              }}
              onDragOver={(event) => {
                event.preventDefault();
                event.stopPropagation();
                event.dataTransfer.dropEffect = 'copy';
                setHeroDragActive(true);
              }}
              onDragLeave={(event) => {
                event.preventDefault();
                event.stopPropagation();
                heroDragDepth.current = Math.max(0, heroDragDepth.current - 1);
                if (heroDragDepth.current === 0) setHeroDragActive(false);
              }}
              onDrop={(event) => {
                event.preventDefault();
                event.stopPropagation();
                heroDragDepth.current = 0;
                setHeroDragActive(false);
                selectHeroFile(event.dataTransfer.files?.[0]);
              }}
            >
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={(event) => selectHeroFile(event.target.files?.[0])}
              />
              {heroPreviewUrl && !removeHero ? (
                <img
                  src={heroPreviewUrl}
                  alt={formData.hero_image_alt || 'Podgląd grafiki hero oferty'}
                  className="h-52 w-full object-cover"
                />
              ) : (
                <div className="px-6 py-8 text-center">
                  <Upload className="mx-auto h-9 w-9 text-[#d3bb73]/55" />
                  <p className="mt-3 text-sm text-[#e5e4e2]/70">Kliknij, aby wybrać zdjęcie</p>
                  <p className="mt-1 text-xs text-[#e5e4e2]/35">JPG, PNG lub WEBP, maks. 12 MB</p>
                </div>
              )}
              {heroDragActive && (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-[#090b13]/90 backdrop-blur-[2px]">
                  <div className="text-center">
                    <Upload className="mx-auto h-11 w-11 animate-bounce text-[#d3bb73]" />
                    <p className="mt-3 text-base font-medium text-[#f3e7bd]">Upuść zdjęcie tutaj</p>
                    <p className="mt-1 text-xs text-[#e5e4e2]/60">Zdjęcie zostanie użyte jako hero tej oferty</p>
                  </div>
                </div>
              )}
            </label>

            {(heroPreviewUrl || offer.hero_image_path) && !removeHero && (
              <div className="mt-3 flex items-center justify-between gap-3">
                <span className="text-xs text-green-300">
                  {heroFile ? 'Nowa grafika zostanie zapisana z ofertą' : 'Ta oferta ma własną grafikę hero'}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setHeroFile(null);
                    setRemoveHero(true);
                  }}
                  className="text-xs text-red-300 hover:text-red-200"
                >
                  Przywróć grafikę szablonu
                </button>
              </div>
            )}

            <div className="mt-3">
              <label className="mb-1.5 block text-xs text-[#e5e4e2]/55">Opis zdjęcia</label>
              <input
                type="text"
                value={formData.hero_image_alt}
                onChange={(event) => setFormData({ ...formData, hero_image_alt: event.target.value })}
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#090b13] px-3 py-2 text-sm text-[#e5e4e2] focus:border-[#d3bb73]/50 focus:outline-none"
                placeholder="np. Hotel i centrum konferencyjne klienta"
              />
            </div>
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
            aiContext={{
              inquiryId: offer.inquiry?.id || offer.inquiry_id || undefined,
              eventCategory: String(offer.event?.category?.name || ''),
              productNames: (offer.offer_items || [])
                .map((item: any) => item.name || item.product?.name)
                .filter(Boolean),
            }}
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
