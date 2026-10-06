'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase/browser';
import type { OfferWizardEventDefaults } from './hooks/useOfferWizzard';
import { X, ChevronRight, ChevronLeft } from 'lucide-react';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';
import EquipmentConflictsSummary from './EquipmentConflictsSummary';
import OfferStep2 from './Steps/OfferStep2';
import OfferStep4, { CustomItem } from './Steps/OfferStep4';
import AddClientModal from './components/AddClientModal';
import { OfferStep1 } from './Steps/OfferStep1';
import { useOfferWizardLogic } from './hooks/useOfferWizzard';
import OfferStep3 from './Steps/OfferStep3';
import { ClientType } from '@/app/(crm)/crm/clients/type';
import { IOfferWizardCustomItem } from '../../../types';

interface OfferWizardProps {
  isOpen: boolean;
  onClose: () => void;
  eventId: string;
  organizationId?: string;
  contactId?: string;
  clientType?: ClientType;
  onSuccess: () => void;
}

export default function OfferWizard(props: OfferWizardProps) {
  const [loaded, setLoaded] = useState<{ eventId: string; defaults: OfferWizardEventDefaults; clientType: ClientType; organizationId: string; contactId: string } | null>(null);
  const [loadError, setLoadError] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    setLoaded(null);
    setLoadError('');
    if (!props.isOpen || !props.eventId) return;
    void (async () => {
      try {
        const { data, error } = await supabase.from('events').select(`
          id, name, description, event_date, event_end_date, location, location_id,
          client_type, organization_id, contact_person_id,
          locations(name, city, postal_code, formatted_address, address), event_categories(name)
        `).eq('id', props.eventId).single();
        if (error || !data) throw error || new Error('Nie znaleziono wydarzenia.');
        const venue = Array.isArray(data.locations) ? data.locations[0] : data.locations;
        const category = Array.isArray(data.event_categories) ? data.event_categories[0] : data.event_categories;
        const locationText = venue
          ? [venue.name, venue.city, venue.postal_code].filter(Boolean).join(', ') || venue.formatted_address || venue.address || ''
          : '';
        if (!active) return;
        setLoaded({
          eventId: data.id,
          clientType: data.client_type || (data.organization_id ? 'business' : data.contact_person_id ? 'individual' : props.clientType || 'business'),
          organizationId: data.organization_id || '',
          contactId: data.contact_person_id || '',
          defaults: {
            name: data.name || '',
            description: data.description || '',
            location: locationText || (typeof data.location === 'string' ? data.location : ''),
            startsAt: data.event_date || '',
            endsAt: data.event_end_date || '',
            category: category?.name || '',
          },
        });
      } catch {
        if (active) setLoadError('Nie udało się pobrać danych wydarzenia. Spróbuj ponownie, aby uzupełnić ofertę zapisanymi informacjami.');
      }
    })();
    return () => { active = false; };
  }, [props.isOpen, props.eventId, attempt]);

  if (!props.isOpen) return null;
  if (!loaded || loaded.eventId !== props.eventId) return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div role="dialog" aria-modal="true" aria-label="Kreator oferty" className="w-full max-w-lg rounded-xl bg-[#0f1119] p-6">
        <div className="flex items-center justify-between gap-4"><h2 className="text-xl">Kreator oferty</h2><button type="button" onClick={props.onClose} aria-label="Zamknij kreator" className="rounded-lg p-2 text-white/60 hover:bg-white/5"><X className="h-5 w-5" /></button></div>
        <p role={loadError ? 'alert' : 'status'} className="mt-4 text-sm text-white/65">{loadError || 'Uzupełniam dane z wydarzenia…'}</p>
        {loadError && <button type="button" onClick={() => setAttempt(value => value + 1)} className="mt-4 rounded-lg bg-[#d3bb73] px-4 py-2 text-sm text-[#250914]">Spróbuj ponownie</button>}
      </div>
    </div>
  );
  return <OfferWizardContent {...props} key={loaded.eventId} eventDefaults={loaded.defaults}
    clientType={loaded.clientType} organizationId={loaded.organizationId} contactId={loaded.contactId} />;
}

function OfferWizardContent({
  isOpen,
  onClose,
  eventId,
  organizationId: propOrganizationId,
  contactId: propContactId,
  clientType: propClientType,
  onSuccess,
  eventDefaults,
}: OfferWizardProps & { eventDefaults: OfferWizardEventDefaults }) {
  const { employee } = useCurrentEmployee();
  const {
    handleSubmit,
    addProductToOffer,
    setOfferData,
    updateOfferItem,
    removeOfferItem,
    setStep,
    canGoNext,
    client: {
      setClientType,
      setSelectedOrganizationId,
      setSelectedContactId,
      clientType,
      selectedOrganizationId,
      selectedContactId,
      organizations,
      canProceedFromStep1,
      clientSearchQuery,
      contacts,
      setClientSearchQuery,
      setContacts,
      setShowAddClientModal,
      showAddClientModal,
    },
    nextStep,
    prevStep,
    step,
    loading,
    initialStep,
    pricing,
    targetNetPriceInput,
    setTargetNetPriceInput,
    catalog: {
      filteredProducts,
      categories,
      products,
      searchQuery,
      selectedCategory,
      setSearchQuery,
      setSelectedCategory,
    },
    items: {
      setCustomItem,
      addCustomItem,
      setShowCustomItemForm,
      setShowEquipmentSelector,
      setShowSubcontractorSelector,
      total,
      showSubcontractorSelector,
      showEquipmentSelector,
      showCustomItemForm,
      customItem,
      offerItems,
      addProduct,
      updateItem,
      removeItem,
      setOfferItems,
    },
    resources: { equipmentList, subcontractors },
    conflicts: {
      checkCartConflicts,
      setSelectedAlt,
      setEquipmentSubstitutions,
      equipmentSubstitutions,
      conflicts,
      selectedAlt,
      checkingConflicts,
      setConflicts,
      setShowConflictsModal,
      showConflictsModal,
    },
    offerData,
  } = useOfferWizardLogic({
    isOpen,
    eventId,
    employeeId: employee?.id,
    eventDefaults,
    defaults: {
      clientType: propClientType || ('business' as ClientType),
      organizationId: propOrganizationId || '',
      contactId: propContactId || '',
    },
    onSuccess,
    onClose,
  });

  const calculateTotal = () => {
    return offerItems.reduce((sum, item) => sum + item.subtotal, 0);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/50 p-4">
      <div className="flex h-[90vh] max-h-[90vh] w-full max-w-[1500px] flex-col rounded-xl border border-[#d3bb73]/20 bg-[#0f1119]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#d3bb73]/20 p-6">
          <div>
            <h2 className="text-2xl font-light text-[#e5e4e2]">Kreator oferty</h2>
            <p className="mt-1 text-sm text-[#e5e4e2]/60">
              Krok {initialStep === 2 ? step - 1 : step} z {initialStep === 2 ? 3 : 4}
            </p>
          </div>
          <button onClick={onClose} className="text-[#e5e4e2]/60 hover:text-[#e5e4e2]">
            <X className="h-6 w-6" />
          </button>
        </div>

        {/* Progress Steps */}
        <div className="border-b border-[#d3bb73]/10 px-6 py-4">
          <div className="mx-auto flex max-w-4xl items-center justify-between">
            {initialStep === 1 && (
              <>
                <div className="flex items-center gap-2">
                  <div
                    className={`flex h-8 w-8 items-center justify-center rounded-full ${
                      step >= 1 ? 'bg-[#d3bb73] text-[#1c1f33]' : 'bg-[#1c1f33] text-[#e5e4e2]/40'
                    }`}
                  >
                    1
                  </div>
                  <span className={`text-sm ${step >= 1 ? 'text-[#e5e4e2]' : 'text-[#e5e4e2]/40'}`}>
                    Wybór klienta
                  </span>
                </div>
                <ChevronRight className="h-5 w-5 text-[#e5e4e2]/40" />
              </>
            )}
            <div className="flex items-center gap-2">
              <div
                className={`flex h-8 w-8 items-center justify-center rounded-full ${
                  step >= 2 ? 'bg-[#d3bb73] text-[#1c1f33]' : 'bg-[#1c1f33] text-[#e5e4e2]/40'
                }`}
              >
                {initialStep === 2 ? 1 : 2}
              </div>
              <span className={`text-sm ${step >= 2 ? 'text-[#e5e4e2]' : 'text-[#e5e4e2]/40'}`}>
                Dane podstawowe
              </span>
            </div>
            <ChevronRight className="h-5 w-5 text-[#e5e4e2]/40" />
            <div className="flex items-center gap-2">
              <div
                className={`flex h-8 w-8 items-center justify-center rounded-full ${
                  step >= 3 ? 'bg-[#d3bb73] text-[#1c1f33]' : 'bg-[#1c1f33] text-[#e5e4e2]/40'
                }`}
              >
                {initialStep === 2 ? 2 : 3}
              </div>
              <span className={`text-sm ${step >= 3 ? 'text-[#e5e4e2]' : 'text-[#e5e4e2]/40'}`}>
                Katalog produktów
              </span>
            </div>
            <ChevronRight className="h-5 w-5 text-[#e5e4e2]/40" />
            <div className="flex items-center gap-2">
              <div
                className={`flex h-8 w-8 items-center justify-center rounded-full ${
                  step >= 4 ? 'bg-[#d3bb73] text-[#1c1f33]' : 'bg-[#1c1f33] text-[#e5e4e2]/40'
                }`}
              >
                {initialStep === 2 ? 3 : 4}
              </div>
              <span className={`text-sm ${step >= 4 ? 'text-[#e5e4e2]' : 'text-[#e5e4e2]/40'}`}>
                Pozycje i podsumowanie
              </span>
            </div>
          </div>
        </div>

        {/* Content */}
        <div
          className={`min-h-0 flex-1 p-6 ${
            step === 3 ? 'overflow-hidden' : 'overflow-y-auto'
          }`}
        >
          {/* Step 1: Wybór klienta */}

          {step === 1 && (
            <OfferStep1
              clientType={clientType}
              setClientType={setClientType}
              clientSearchQuery={clientSearchQuery}
              setClientSearchQuery={setClientSearchQuery}
              organizations={organizations}
              contacts={contacts}
              selectedOrganizationId={selectedOrganizationId}
              setSelectedOrganizationId={setSelectedOrganizationId}
              selectedContactId={selectedContactId}
              setSelectedContactId={setSelectedContactId}
              setShowAddClientModal={setShowAddClientModal}
            />
          )}

          {/* Step 2: Podstawowe dane */}
          {step === 2 && (
            <div className="space-y-4">
              <div className="mx-auto max-w-2xl rounded-lg bg-white/5 p-4 text-sm">
                <p className="font-medium">{eventDefaults.name}</p>
                {eventDefaults.startsAt && <p className="mt-1 text-white/65">Termin wydarzenia: {formatEventDate(eventDefaults.startsAt)}{eventDefaults.endsAt ? ` – ${formatEventDate(eventDefaults.endsAt)}` : ''}</p>}
                <p className="mt-2 text-xs text-white/50">Dostępne dane zostały uzupełnione z wydarzenia. Możesz je dostosować do tej oferty.</p>
              </div>
            <OfferStep2
              offerData={offerData}
              setOfferData={setOfferData}
            />
            </div>
          )}

          {/* Step 3: Katalog produktów */}
          {step === 3 && (
            <OfferStep3
              offerItems={offerItems}
              products={products}
              searchQuery={searchQuery}
              setSearchQuery={setSearchQuery}
              selectedCategory={selectedCategory}
              setSelectedCategory={setSelectedCategory}
              categories={categories}
              filteredProducts={filteredProducts}
              addProductToOffer={addProductToOffer}
              updateOfferItem={updateOfferItem}
              removeOfferItem={removeOfferItem}
            />
          )}

          {/* Step 4: Pozycje oferty */}
          {step === 4 && (
            <OfferStep4
              showCustomItemForm={showCustomItemForm}
              setShowCustomItemForm={setShowCustomItemForm}
              showEquipmentSelector={showEquipmentSelector}
              setShowEquipmentSelector={setShowEquipmentSelector}
              showSubcontractorSelector={showSubcontractorSelector}
              setShowSubcontractorSelector={setShowSubcontractorSelector}
              equipmentList={equipmentList}
              subcontractors={subcontractors}
              addCustomItem={addCustomItem}
              updateOfferItem={updateOfferItem}
              removeOfferItem={removeOfferItem}
              calculateTotal={calculateTotal}
              customItem={customItem}
              offerItems={offerItems}
              pricing={pricing}
              targetNetPriceInput={targetNetPriceInput}
              setTargetNetPriceInput={setTargetNetPriceInput}
              setCustomItem={(item: CustomItem) => setCustomItem(item as IOfferWizardCustomItem)}
            />
          )}
          {conflicts && conflicts.length > 0 && (
            <EquipmentConflictsSummary
              conflicts={conflicts ?? []}
              selectedAlt={selectedAlt}
              checkingConflicts={checkingConflicts}
              onRentalSelect={(conflictKey, rentalEquipmentId, subcontractorId, quantity) => {
                // Zapisujemy wybór rental equipment jako zamiennik
                setSelectedAlt((prev) => ({
                  ...prev,
                  [conflictKey]: {
                    item_id: rentalEquipmentId,
                    qty: quantity,
                    is_rental: true,
                    rental_equipment_id: rentalEquipmentId,
                    subcontractor_id: subcontractorId,
                  },
                }));
              }}
            />
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-[#d3bb73]/20 p-6">
          <button
            onClick={() => setStep(Math.max(1, step - 1))}
            disabled={step === 1}
            className="flex items-center gap-2 px-4 py-2 text-[#e5e4e2]/60 hover:text-[#e5e4e2] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ChevronLeft className="h-5 w-5" />
            <span>Wstecz</span>
          </button>

          <div className="flex gap-3">
            {step < 4 ? (
              <button
                onClick={() => setStep(step + 1)}
                disabled={
                  step === 1 &&
                  (!clientType ||
                    (clientType === 'business' && !selectedOrganizationId) ||
                    (clientType === 'individual' && !selectedContactId))
                }
                className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-6 py-2 font-medium text-[#1c1f33] hover:bg-[#d3bb73]/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <span>Dalej</span>
                <ChevronRight className="h-5 w-5" />
              </button>
            ) : (
              <button
                onClick={handleSubmit}
                disabled={loading || offerItems.length === 0}
                className="rounded-lg bg-[#d3bb73] px-6 py-2 font-medium text-[#1c1f33] hover:bg-[#d3bb73]/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loading ? 'Tworzenie...' : 'Utwórz ofertę'}
              </button>
            )}
          </div>
        </div>
      </div>

      <AddClientModal
        open={showAddClientModal}
        onClose={() => setShowAddClientModal(false)}
        contacts={contacts}
        setContacts={setContacts}
        setSelectedContactId={setSelectedContactId}
      />
      {/* Modal został usunięty - konflikty pokazują się w EquipmentConflictsSummary */}
    </div>
  );
}

function formatEventDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('pl-PL', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    ...(value.includes('T') || value.includes(' ') ? { hour: '2-digit' as const, minute: '2-digit' as const } : {}),
    timeZone: 'Europe/Warsaw',
  }).format(date);
}
