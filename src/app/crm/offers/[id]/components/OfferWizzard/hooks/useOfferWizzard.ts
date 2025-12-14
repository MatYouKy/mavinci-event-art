'use client';

import { useMemo, useState } from 'react';
import { useDialog } from '@/contexts/DialogContext';

import { Product } from '../types';
import { useOfferWizardClient } from './useOfferWizzardClient';
import { useOfferWizardCatalog } from './useOfferWizzardCatalog';
import { useOfferWizardResources } from './useOfferWizzardResources';
import { useOfferWizardItems } from './useOfferWizzardItem';
import { useOfferWizardConflicts } from './useOfferWizzardConflicts';
import { submitOfferWizard } from './useOfferWizzardSubmit';

export function useOfferWizardLogic(opts: {
  isOpen: boolean;
  eventId: string;
  employeeId?: string;
  defaults?: { clientType?: 'individual' | 'business'; organizationId?: string; contactId?: string };
  onSuccess: () => void;
  onClose: () => void;
}) {
  const { showDialog } = useDialog();

  const initialStep = opts.defaults?.clientType && (opts.defaults.organizationId || opts.defaults.contactId) ? 2 : 1;
  const [step, setStep] = useState(initialStep);
  const [loading, setLoading] = useState(false);

  const client = useOfferWizardClient({ isOpen: opts.isOpen, step, defaults: opts.defaults });
  const catalog = useOfferWizardCatalog({ isOpen: opts.isOpen, step });
  const resources = useOfferWizardResources({ isOpen: opts.isOpen, step });
  const items = useOfferWizardItems();
  const conflicts = useOfferWizardConflicts({ eventId: opts.eventId });

  const [offerData, setOfferData] = useState({ offer_number: '', valid_until: '', notes: '' });

  const canGoNext = useMemo(() => {
    if (step !== 1) return true;
    return client.canProceedFromStep1;
  }, [step, client.canProceedFromStep1]);

  const addProductToOffer = async (product: Product) => {
    items.addProduct(product);

    // sprawdź po zmianie (na aktualnym stanie – najprościej: zrób to na bazie next tick)
    // tu wersja “bez kombinowania” – sprawdzamy na stanie po setState:
    setTimeout(async () => {
      const rows = await conflicts.checkCartConflicts(items.offerItems);
      if (rows.length > 0) {
        showDialog({
          title: 'Uwaga: braki sprzętu w terminie eventu. Zobacz szczegóły poniżej.',
          message: 'Uwaga: braki sprzętu w terminie eventu. Zobacz szczegóły poniżej.',
          type: 'warning',
        });
      }
    }, 0);
  };

  const removeOfferItem = async (id: string) => {
    items.removeItem(id);
    setTimeout(() => conflicts.checkCartConflicts(items.offerItems), 0);
  };

  const updateOfferItem = async (id: string, patch: any) => {
    items.updateItem(id, patch);
    setTimeout(() => conflicts.checkCartConflicts(items.offerItems), 0);
  };

  const nextStep = () => setStep((s) => Math.min(4, s + 1));
  const prevStep = () => setStep((s) => Math.max(1, s - 1));

  const handleSubmit = async () => {
    if (items.offerItems.length === 0) {
      showDialog({ title: 'Dodaj przynajmniej jedną pozycję do oferty', message: 'Dodaj przynajmniej jedną pozycję do oferty', type: 'warning' });
      return;
    }

    const rows = await conflicts.checkCartConflicts(items.offerItems);
    if (rows.length > 0) {
      showDialog({
        title: 'Nie możesz utworzyć oferty – brakuje sprzętu w terminie eventu. Sprawdź konflikty.',
        message: 'Nie możesz utworzyć oferty – brakuje sprzętu w terminie eventu. Sprawdź konflikty.',
        type: 'warning',
      });
      return;
    }

    if (!opts.employeeId) {
      showDialog({ title: 'Musisz być zalogowany aby utworzyć ofertę', message: 'Musisz być zalogowany aby utworzyć ofertę', type: 'error' });
      return;
    }

    if (!client.clientType) {
      showDialog({ title: 'Wybierz typ klienta', message: 'Wybierz typ klienta', type: 'warning' });
      return;
    }
    if (client.clientType === 'business' && !client.selectedOrganizationId) {
      showDialog({ title: 'Wybierz organizację', message: 'Wybierz organizację', type: 'warning' });
      return;
    }
    if (client.clientType === 'individual' && !client.selectedContactId) {
      showDialog({ title: 'Wybierz kontakt', message: 'Wybierz kontakt', type: 'warning' });
      return;
    }

    setLoading(true);
    try {
      const offer = await submitOfferWizard({
        eventId: opts.eventId,
        employeeId: opts.employeeId,
        clientType: client.clientType as any,
        organizationId: client.selectedOrganizationId,
        contactId: client.selectedContactId,
        offerData,
        offerItems: items.offerItems,
        selectedAlt: conflicts.selectedAlt,
        conflicts: conflicts.conflicts,
      });

      showDialog({
        title: `Utworzono ofertę: ${offer.offer_number}`,
        message: `Utworzono ofertę: ${offer.offer_number}`,
        type: 'success',
      });

      opts.onSuccess();
      opts.onClose();
    } catch (err: any) {
      console.error(err);
      showDialog({
        title: 'Błąd podczas tworzenia oferty: ' + (err?.message || 'unknown'),
        message: 'Błąd podczas tworzenia oferty: ' + (err?.message || 'unknown'),
        type: 'error',
      });
      conflicts.setConflicts([
        {
          item_type: 'item',
          item_id: '',
          item_name: 'Błąd sprawdzania dostępności',
          required_qty: 0,
          total_qty: 0,
          reserved_qty: 0,
          available_qty: 0,
          shortage_qty: 1,
          conflict_until: null,
          conflicts: [],
          alternatives: [],
        } as any,
      ]);
      conflicts.setShowConflictsModal(true);
    } finally {
      setLoading(false);
    }
  };

  console.log('conflicts:', conflicts);

  return {
    initialStep,
    step,
    setStep,
    loading,

    offerData,
    setOfferData,

    client,
    catalog,
    resources,
    items,
    conflicts,

    canGoNext,
    nextStep,
    prevStep,

    addProductToOffer,
    removeOfferItem,
    updateOfferItem,

    handleSubmit,
  };
}