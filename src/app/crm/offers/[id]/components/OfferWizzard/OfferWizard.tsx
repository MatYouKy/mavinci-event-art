'use client';

import { useState, useEffect } from 'react';
import {
  X,
  Plus,
  Trash2,
  ShoppingCart,
  Package,
  Search,
  ChevronRight,
  ChevronLeft,
  Check,
  AlertTriangle,
  Wrench,
  Users,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';
import { useDialog } from '@/contexts/DialogContext';
import { IEventCategory } from '@/app/crm/event-categories/types';
import EquipmentConflictsSummary from './EquipmentConflictsSummary';
import EquipmentConflictsModal from './EquipmentConflictsModal';
import OfferStep2 from './Steps/OfferStep2';
import OfferStep4 from './Steps/OfferStep4';
import AddClientModal from './components/AddClientModal';
import { OfferStep1 } from './Steps/OfferStep1';
import { useOfferWizardLogic } from './hooks/useOfferWizzard';
import { IProduct } from '../../../types';
import OfferStep3 from './Steps/OfferStep3';
import { ClientType } from '@/app/crm/clients/type';

interface OfferWizardProps {
  isOpen: boolean;
  onClose: () => void;
  eventId: string;
  organizationId?: string;
  contactId?: string;
  clientType?: ClientType;
  onSuccess: () => void;
}

export default function OfferWizard({
  isOpen,
  onClose,
  eventId,
  organizationId: propOrganizationId,
  contactId: propContactId,
  clientType: propClientType,
  onSuccess,
}: OfferWizardProps) {
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
    defaults: {
      clientType: propClientType || 'business' as ClientType,
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
      <div className="flex max-h-[90vh] w-full max-w-6xl flex-col rounded-xl border border-[#d3bb73]/20 bg-[#0f1119]">
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
        <div className="flex-1 overflow-y-auto p-6">
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
          {step === 2 && <OfferStep2 offerData={offerData} setOfferData={setOfferData} />}

          {/* Step 3: Katalog produktów */}
          {step === 3 && (
            <OfferStep3
              offerItems={offerItems}
              searchQuery={searchQuery}
              setSearchQuery={setSearchQuery}
              selectedCategory={selectedCategory}
              setSelectedCategory={setSelectedCategory}
              categories={categories}
              filteredProducts={filteredProducts}
              addProductToOffer={addProductToOffer}
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
              setCustomItem={setCustomItem}
            />
          )}
          {conflicts && conflicts.length > 0 && (
            <EquipmentConflictsSummary
              conflicts={conflicts ?? []}
              selectedAlt={selectedAlt}
              checkingConflicts={checkingConflicts}
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
      <EquipmentConflictsModal
        open={showConflictsModal}
        onClose={() => setShowConflictsModal(false)}
        conflicts={conflicts}
        offerItems={offerItems}
        selectedAlt={selectedAlt}
        setSelectedAlt={setSelectedAlt}
        equipmentSubstitutions={equipmentSubstitutions}
        setEquipmentSubstitutions={setEquipmentSubstitutions}
        checkCartConflicts={checkCartConflicts}
      />
    </div>
  );
}
