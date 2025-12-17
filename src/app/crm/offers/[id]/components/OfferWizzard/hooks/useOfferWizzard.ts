'use client';

import { useMemo, useState } from 'react';
import { useDialog } from '@/contexts/DialogContext';

import { useOfferWizardClient } from './useOfferWizzardClient';
import { useOfferWizardCatalog } from './useOfferWizzardCatalog';
import { useOfferWizardResources } from './useOfferWizzardResources';
import { useOfferWizardItems } from './useOfferWizzardItems';
import { useOfferWizardConflicts } from './useOfferWizzardConflicts';
import { submitOfferWizard } from './useOfferWizzardSubmit';
import { IProduct } from '@/app/crm/offers/types';
import { ClientType } from '@/app/crm/clients/type';

export function useOfferWizardLogic(opts: {
  isOpen: boolean;
  eventId: string;
  employeeId?: string;
  defaults?: { clientType?: ClientType; organizationId?: string; contactId?: string };
  onSuccess: () => void;
  onClose: () => void;
}) {
  const { showDialog } = useDialog();

  const hasOrganization =
    opts.defaults?.organizationId && opts.defaults.organizationId.trim() !== '';
  const hasContact = opts.defaults?.contactId && opts.defaults.contactId.trim() !== '';
  const initialStep = opts.defaults?.clientType && (hasOrganization || hasContact) ? 2 : 1;
  const [step, setStep] = useState(initialStep);
  const [loading, setLoading] = useState(false);

  const client = useOfferWizardClient({ isOpen: opts.isOpen, step, defaults: opts.defaults });
  const catalog = useOfferWizardCatalog({ isOpen: opts.isOpen, step });
  const items = useOfferWizardItems();
  const conflicts = useOfferWizardConflicts({ eventId: opts.eventId });

  const [offerData, setOfferData] = useState({ offer_number: '', valid_until: '', notes: '' });

  /**
   * ✅ ID sprzętów do wykluczenia z listy “manualnego sprzętu”
   * - wybrane już manualnie
   * - oraz sprzęty w scope produktów już dodanych do koszyka
   *
   * Uwaga: ponieważ nie mamy tutaj pewności jak nazywa się pole na scope produktu,
   * robimy “bezpieczne” wyciąganie z kilku popularnych kluczy.
   */
  const excludedIds = useMemo(() => {
    const s = new Set<string>();

    for (const row of items.offerItems ?? []) {
      // 1) manualne pozycje sprzętu (najczęściej)
      const directEqId =
        (row as any)?.equipment_item_id ||
        (row as any)?.equipmentId ||
        (row as any)?.equipment_id ||
        null;

      if (directEqId) s.add(String(directEqId));

      // 2) scope produktu — próbujemy kilka wariantów nazw
      const scopeCandidates: any[] = [
        ...(Array.isArray((row as any)?.product_equipment) ? (row as any).product_equipment : []),
        ...(Array.isArray((row as any)?.productEquipment) ? (row as any).productEquipment : []),
        ...(Array.isArray((row as any)?.equipment_scope) ? (row as any).equipment_scope : []),
        ...(Array.isArray((row as any)?.equipmentScope) ? (row as any).equipmentScope : []),
        ...(Array.isArray((row as any)?.product?.equipment) ? (row as any).product.equipment : []),
        ...(Array.isArray((row as any)?.product?.equipment_scope)
          ? (row as any).product.equipment_scope
          : []),
        ...(Array.isArray((row as any)?.product?.product_equipment)
          ? (row as any).product.product_equipment
          : []),
      ];

      for (const pe of scopeCandidates) {
        const eqId =
          pe?.equipment_item_id ||
          pe?.equipmentId ||
          pe?.equipment_id ||
          pe?.item_id ||
          pe?.id ||
          null;
        if (eqId) s.add(String(eqId));
      }
    }

    return s;
  }, [items.offerItems]);

  /**
   * ✅ ID sprzętów “niedostępnych” do dodania manualnie w danym terminie
   * Bazujemy na wynikach conflicts (krótkie i skuteczne).
   * Jeśli masz “czyste availability” niezależne od koszyka, to to można podmienić.
   */
  const unavailableIds = useMemo(() => {
    const s = new Set<string>();

    for (const c of conflicts.conflicts ?? []) {
      const shortage = Number((c as any)?.shortage_qty ?? 0);
      const available = Number((c as any)?.available_qty ?? (c as any)?.available_quantity ?? 0);

      if (shortage > 0 || available <= 0) {
        const id = (c as any)?.item_id || (c as any)?.equipment_id || (c as any)?.id || null;
        if (id) s.add(String(id));
      }
    }

    return s;
  }, [conflicts.conflicts]);

  /**
   * ✅ resources dostaje sety filtrujące — a sam hook jest “głupi” (fetch + filter)
   * Uwaga: to wymaga, żeby useOfferWizardResources przyjmował te pola w opts
   * (czyli: { isOpen, step, excludedIds, unavailableIds }).
   */
  const resources = useOfferWizardResources({
    isOpen: opts.isOpen,
    step,
    excludedIds: excludedIds as any,
    unavailableIds: unavailableIds as any,
  } as any);

  const canGoNext = useMemo(() => {
    if (step !== 1) return true;
    return client.canProceedFromStep1;
  }, [step, client.canProceedFromStep1]);

  const addProductToOffer = async (product: IProduct) => {
    // ✅ dostajesz "next" od razu
    const nextItems = items.addProduct(product);

    const rows = await conflicts.checkCartConflicts(nextItems);
    if (rows.length > 0) {
      showDialog({
        title: 'Uwaga: braki sprzętu w terminie eventu. Zobacz szczegóły poniżej.',
        message: 'Uwaga: braki sprzętu w terminie eventu. Zobacz szczegóły poniżej.',
        type: 'warning',
      });
    }
  };

  const removeOfferItem = async (id: string) => {
    const nextItems = items.removeItem(id);
    await conflicts.checkCartConflicts(nextItems);
  };

  const updateOfferItem = async (id: string, patch: any) => {
    const nextItems = items.updateItem(id, patch);
    await conflicts.checkCartConflicts(nextItems);
  };

  const nextStep = () => setStep((s) => Math.min(4, s + 1));
  const prevStep = () => setStep((s) => Math.max(1, s - 1));

  const handleSubmit = async () => {
    if (items.offerItems.length === 0) {
      showDialog({
        title: 'Dodaj przynajmniej jedną pozycję do oferty',
        message: 'Dodaj przynajmniej jedną pozycję do oferty',
        type: 'warning',
      });
      return;
    }

    const rows = await conflicts.checkCartConflicts(items.offerItems);
    if (rows.length > 0) {
      showDialog({
        title: 'Nie możesz utworzyć oferty – brakuje sprzętu w terminie eventu. Sprawdź konflikty.',
        message:
          'Nie możesz utworzyć oferty – brakuje sprzętu w terminie eventu. Sprawdź konflikty.',
        type: 'warning',
      });
      return;
    }

    if (!opts.employeeId) {
      showDialog({
        title: 'Musisz być zalogowany aby utworzyć ofertę',
        message: 'Musisz być zalogowany aby utworzyć ofertę',
        type: 'error',
      });
      return;
    }

    if (!client.clientType) {
      showDialog({ title: 'Wybierz typ klienta', message: 'Wybierz typ klienta', type: 'warning' });
      return;
    }
    if (client.clientType === 'business' && !client.selectedOrganizationId) {
      showDialog({
        title: 'Wybierz organizację',
        message: 'Wybierz organizację',
        type: 'warning',
      });
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
